// index.js
// BOTRUMSUNWIN — ULTRA VIP (Chỉ phân tích 20 phiên gần nhất)
// Trả về tiếng Việt với các trường: phiên, kết_quả, xúc_xắc, tổng_xúc_xắc, dự_đoán, thuật_toán, pattern, số_phiên_dự_đoán, số_lần_đúng, số_lần_sai, tỉ_lệ_đúng, id

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

// ====== Cấu hình ======
const CONFIG = {
  SOURCE_API: "https://hackvn.xyz/apisun.php",
  DATA_FILE: path.resolve(__dirname, "data.json"),   // lưu 20 phiên gần nhất
  STATS_FILE: path.resolve(__dirname, "stats.json"), // lưu model & stats
  MAX_HISTORY: 20,
  FETCH_INTERVAL_MS: 5000,
  AXIOS_TIMEOUT_MS: 4000,
  MODEL_LR: 0.05,
  MODEL_L2: 0.001,
  EPSILON: 0.02,
  SMOOTHING: 1,
  STRATEGIES: [ "longRun","alternation","momentum","bias","markov1","markov2","pattern4","pattern5","pattern6","noise" ]
};

// ====== State ======
let history = []; // last up to 20 entries: {phien, ket_qua, xuc_xac, tong_xuc_xac, du_doan, thuat_toan, do_tin_cay, time}
let stats = {
  total_phien: 0,
  so_dung: 0,
  so_sai: 0,
  strategies: {}, // name -> {correct,total,ema}
  model: null // { w:[], bias }
};

// ====== Helpers ======
const nowISO = () => new Date().toISOString();
const safeInt = v => { const n = parseInt(v); return isNaN(n) ? 0 : n; };
const clamp = (v,a=-Infinity,b=Infinity) => Math.max(a,Math.min(b,v));
const sigmoid = z => 1/(1+Math.exp(-z));

// load/save files
async function loadFiles(){
  try {
    if (fs.existsSync(CONFIG.DATA_FILE)) {
      const t = await fs.promises.readFile(CONFIG.DATA_FILE, "utf8").catch(()=>null);
      if (t) history = JSON.parse(t);
    }
  } catch(e){ console.warn("⚠ load data.json:", e && e.message); history = []; }
  try {
    if (fs.existsSync(CONFIG.STATS_FILE)) {
      const s = await fs.promises.readFile(CONFIG.STATS_FILE, "utf8").catch(()=>null);
      if (s) stats = JSON.parse(s);
    }
  } catch(e){ console.warn("⚠ load stats.json:", e && e.message); stats = { total_phien:0, so_dung:0, so_sai:0, strategies:{}, model:null }; }

  // init strategy keys
  CONFIG.STRATEGIES.forEach(n => {
    if (!stats.strategies[n]) stats.strategies[n] = { correct:0, total:0, ema:0.5 };
  });

  // init model
  initModelIfNeeded();
  console.log(`📂 Loaded history=${history.length}, stats.total_phien=${stats.total_phien}`);
}

async function saveFiles(){
  try {
    await fs.promises.writeFile(CONFIG.DATA_FILE, JSON.stringify(history, null, 2)).catch(()=>{});
    await fs.promises.writeFile(CONFIG.STATS_FILE, JSON.stringify(stats, null, 2)).catch(()=>{});
  } catch(e){ console.warn("⚠ saveFiles:", e && e.message); }
}

function initModelIfNeeded(){
  const featCount = CONFIG.STRATEGIES.length + 3; // +3 extra features
  if (!stats.model || !Array.isArray(stats.model.w) || stats.model.w.length !== featCount) {
    stats.model = { w: new Array(featCount).fill(0).map(()=> (Math.random()-0.5)*0.02), bias: 0, lr: CONFIG.MODEL_LR, l2: CONFIG.MODEL_L2 };
  }
}

function resultsArray(h) { return (h||[]).map(x => x.ket_qua); }
function patternString(h) { return (h||[]).map(x => x.ket_qua === "Tài" ? "t" : "x").join(""); }

// ====== Strategies (return probability pTai in [0..1]) ======
const STR = {};
STR.longRun = (results) => {
  const n = Math.min(8, Math.floor(results.length/2));
  if (n>=3) {
    const last = results.slice(-n);
    if (last.every(r=>r===last[0])) return last[0]==="Tài"?0.15:0.85;
  }
  return 0.5;
};
STR.alternation = (results) => {
  if (results.length<4) return 0.5;
  const last4 = results.slice(-4);
  if (last4[0]!==last4[1] && last4[1]!==last4[2] && last4[2]!==last4[3]) return last4[last4.length-1]==="Tài"?0.15:0.85;
  return 0.5;
};
STR.momentum = (results) => {
  if (results.length<3) return 0.5;
  const n = Math.min(10, results.length);
  const tail = results.slice(-n);
  let score=0;
  for (let i=0;i<tail.length;i++){ const w=(i+1)/n; score += tail[i]==="Tài"? w : -w; }
  const norm = Math.tanh(score/n*2);
  return 0.5*(1+norm);
};
STR.bias = (results) => {
  const n = Math.min(10, results.length);
  if (n<6) return 0.5;
  const tail = results.slice(-n), c = tail.filter(r=>r==="Tài").length;
  if (c/n >= 0.72) return 0.3;
  if ((n-c)/n >= 0.72) return 0.7;
  return 0.5;
};
STR.markov1 = (results) => {
  if (results.length<4) return 0.5;
  const counts = {"Tài":{"Tài":0,"Xỉu":0},"Xỉu":{"Tài":0,"Xỉu":0}};
  for (let i=0;i<results.length-1;i++){ counts[results[i]][results[i+1]]++; }
  const last = results[results.length-1]; const tot = counts[last]["Tài"]+counts[last]["Xỉu"];
  if (!tot) return 0.5; return (counts[last]["Tài"]+CONFIG.SMOOTHING)/(tot+2*CONFIG.SMOOTHING);
};
STR.markov2 = (results) => {
  if (results.length<6) return 0.5;
  const map={};
  for (let i=0;i<results.length-2;i++){ const key=results[i]+"|"+results[i+1]; map[key]=map[key]||{"Tài":0,"Xỉu":0}; map[key][results[i+2]]++; }
  const key=results[results.length-2]+"|"+results[results.length-1]; const info=map[key];
  if (!info) return 0.5; const tot=info["Tài"]+info["Xỉu"]; return (info["Tài"]+CONFIG.SMOOTHING)/(tot+2*CONFIG.SMOOTHING);
};
STR.patternGeneric = (results, M) => {
  if (results.length < M+3) return 0.5;
  const pattern = results.slice(-M).join("|"); let tai=0,xiu=0,matches=0;
  for (let i=0;i<=results.length-M-1;i++){ const seq = results.slice(i,i+M).join("|"); if (seq===pattern){ const next = results[i+M]; matches++; if (next==="Tài") tai++; else xiu++; } }
  if (matches===0) return 0.5; return (tai+CONFIG.SMOOTHING)/(tai+xiu+2*CONFIG.SMOOTHING);
};
STR.pattern4 = r => STR.patternGeneric(r,4);
STR.pattern5 = r => STR.patternGeneric(r,5);
STR.pattern6 = r => STR.patternGeneric(r,6);
STR.noise = (results, phien) => { if (!phien) return 0.5; const v=Math.abs(Math.sin(phien*877)); return 0.5 + (v-0.5)*0.12; };

// ====== Feature builder (only uses last up to 20) ======
function buildFeatureVector(results, phien){
  const feats = [];
  CONFIG.STRATEGIES.forEach(name => {
    let p=0.5;
    if (name==="longRun") p=STR.longRun(results);
    else if (name==="alternation") p=STR.alternation(results);
    else if (name==="momentum") p=STR.momentum(results);
    else if (name==="bias") p=STR.bias(results);
    else if (name==="markov1") p=STR.markov1(results);
    else if (name==="markov2") p=STR.markov2(results);
    else if (name==="pattern4") p=STR.pattern4(results);
    else if (name==="pattern5") p=STR.pattern5(results);
    else if (name==="pattern6") p=STR.pattern6(results);
    else if (name==="noise") p=STR.noise(results, phien);
    feats.push(clamp(p,0.01,0.99));
  });
  // extra features (from last up to 10 inside the 20-window)
  const n = Math.min(10, results.length);
  const tail = results.slice(-n);
  const freqTai = n? tail.filter(x=>x==="Tài").length / n : 0.5;
  feats.push(freqTai);
  // streak normalized
  let streak=1;
  for (let i=results.length-2;i>=0;i--){ if (results[i]===results[i+1]) streak++; else break; }
  feats.push(clamp(streak/10,0,1));
  // bias normalized
  const bias = n ? (tail.filter(x=>x==="Tài").length - tail.filter(x=>x==="Xỉu").length)/n : 0;
  feats.push(clamp((bias+1)/2, 0, 1));
  return feats;
}

// ====== Meta-learner (logistic) ======
function modelPredict(features){
  initModelIfNeeded();
  const m = stats.model; let z = m.bias || 0;
  for (let i=0;i<features.length;i++) z += (m.w[i]||0) * features[i];
  return sigmoid(z); // pTai
}
function modelUpdate(features, y){
  initModelIfNeeded();
  const m = stats.model;
  let z = m.bias || 0;
  for (let i=0;i<features.length;i++) z += (m.w[i]||0) * features[i];
  const p = sigmoid(z);
  const err = p - y;
  const lr = m.lr || CONFIG.MODEL_LR;
  const l2 = m.l2 || CONFIG.MODEL_L2;
  for (let i=0;i<features.length;i++){
    const grad = err * features[i] + l2 * (m.w[i]||0);
    m.w[i] = (m.w[i]||0) - lr * grad;
  }
  m.bias = (m.bias||0) - lr * err;
}

// ====== Ensemble predict (only uses last up to 20) ======
function predictEnsemble(historyArr, phien){
  const results = resultsArray(historyArr);
  const features = buildFeatureVector(results, phien);
  const pModel = modelPredict(features);
  // epsilon exploration
  const finalP = Math.random() < CONFIG.EPSILON ? clamp(pModel + (Math.random()*2-1)*0.12, 0.01, 0.99) : pModel;
  const du = finalP >= 0.5 ? "Tài" : "Xỉu";
  const do_tin_cay = Math.round(Math.abs(finalP - 0.5)*2*1000)/1000;
  // details: per-strategy probs
  const details = {};
  CONFIG.STRATEGIES.forEach((n,i)=> details[n] = Math.round(features[i]*1000)/1000);
  details.model_pTai = Math.round(pModel*1000)/1000;
  return { du_doan: du, thuat_toan: "Meta-learner Logistic (20-phiên)", do_tin_cay, details, features };
}

// ====== Update stats after know real result (called when new entry arrives) ======
function updateAfterResult(features, ensemblePred, real){
  // update per-strategy stats using features threshold 0.5
  CONFIG.STRATEGIES.forEach((name, idx) => {
    const p = features[idx];
    const pred = p >= 0.5 ? "Tài" : "Xỉu";
    const s = stats.strategies[name] || {correct:0, total:0, ema:0.5};
    s.total = (s.total||0) + 1;
    if (pred === real) s.correct = (s.correct||0) + 1;
    const accNow = (s.correct + CONFIG.SMOOTHING) / (s.total + 2*CONFIG.SMOOTHING);
    s.ema = (s.ema||0.5) * 0.995 + accNow * 0.005;
    stats.strategies[name] = s;
  });
  // update overall
  stats.total_phien = (stats.total_phien||0) + 1;
  if (ensemblePred === real) stats.so_dung = (stats.so_dung||0) + 1; else stats.so_sai = (stats.so_sai||0) + 1;
  // train model
  const y = real === "Tài" ? 1 : 0;
  modelUpdate(features, y);
}

// ====== Fetch loop ======
async function fetchOnceAndSave(){
  try {
    const res = await axios.get(CONFIG.SOURCE_API, { timeout: CONFIG.AXIOS_TIMEOUT_MS });
    const data = res.data;
    if (!data) return;
    const phien = safeInt(data.phien);
    const x1 = safeInt(data.xuc_xac_1), x2 = safeInt(data.xuc_xac_2), x3 = safeInt(data.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = (data.ket_qua || "").trim() === "Tài" ? "Tài" : "Xỉu";
    if (!phien || tong < 3 || tong > 18) return;

    // avoid duplicate
    if (history.length && history[history.length-1].phien === phien) return;

    // predict based on current 20 (history not include this new phien yet)
    const ensemble = predictEnsemble(history, phien);

    // create entry
    const entry = {
      phien,
      ket_qua,
      xuc_xac: [x1,x2,x3],
      tong_xuc_xac: tong,
      du_doan: ensemble.du_doan,
      thuat_toan: ensemble.thuat_toan,
      do_tin_cay: ensemble.do_tin_cay,
      time: nowISO()
    };

    // update model & stats using features & real result
    updateAfterResult(ensemble.features, ensemble.du_doan, ket_qua);

    // push into history (only keep 20)
    history.push(entry);
    while (history.length > CONFIG.MAX_HISTORY) history.shift();

    // persist
    saveFiles().catch(()=>{});

    console.log(`✅ Phiên ${phien}: ${ket_qua} — Dự đoán: ${ensemble.du_doan} (conf=${ensemble.do_tin_cay}) — tổng=${stats.total_phien} đúng=${stats.so_dung}`);
  } catch (err) {
    console.warn("⚠ fetch error:", err && err.message);
  }
}

setInterval(()=>{ fetchOnceAndSave().catch(e=>console.warn(e&&e.message)); }, CONFIG.FETCH_INTERVAL_MS);

// ====== Endpoints (Tiếng Việt) ======
app.get("/", (req,res) => res.json({ status: "ok", mode: "BOTRUMSUNWIN ULTRA-VIP (20 phiên)", now: nowISO() }));

app.get("/sunwinapi", (req,res) => {
  const latest = history[history.length-1] || {};
  const tong = stats.total_phien || 0;
  const dung = stats.so_dung || 0;
  const sai = stats.so_sai || 0;
  const tile = (() => {
    const t = dung + sai; return t===0 ? "0.00%" : ((dung / t * 100).toFixed(2) + "%");
  })();

  res.json({
    phiên: latest.phien || 0,
    kết_quả: latest.ket_qua || "Đang cập nhật",
    xúc_xắc: latest.xuc_xac || [0,0,0],
    tổng_xúc_xắc: latest.tong_xuc_xac || 0,
    dự_đoán: latest.du_doan || "Đang dự đoán",
    thuật_toán: latest.thuat_toán || "",
    pattern: patternString(history),
    số_phiên_dự_đoán: tong,
    số_lần_đúng: dung,
    số_lần_sai: sai,
    tỉ_lệ_đúng: tile,
    id: "@minhsangdangcap"
  });
});

// history endpoint (recent 20)
app.get("/history", (req,res) => res.json({ tong: history.length, history }));

// stats endpoint (chi tiết strategies & model)
app.get("/thongke", (req,res) => {
  const strat = {};
  Object.keys(stats.strategies||{}).forEach(k=>{
    const s = stats.strategies[k];
    strat[k] = { correct: s.correct||0, total: s.total||0, ema: Math.round((s.ema||0)*1000)/1000, acc: s.total? ((s.correct/s.total*100).toFixed(2)+"%") : "n/a" };
  });
  res.json({
    tổng_phien: stats.total_phien||0,
    số_dúng: stats.so_dung||0,
    số_sai: stats.so_sai||0,
    tỉ_lệ: (()=>{ const t=(stats.so_dung||0)+(stats.so_sai||0); return t===0?"0.00%":((stats.so_dung||0)/t*100).toFixed(2)+"%"; })(),
    strategies: strat,
    model: { w: stats.model.w.map(v=>Math.round(v*100000)/100000), bias: Math.round((stats.model.bias||0)*100000)/100000 }
  });
});

// admin: fetch now
app.post("/admin/fetch-now", (req,res) => {
  fetchOnceAndSave().then(()=>res.json({ok:true})).catch(e=>res.status(500).json({ok:false,error:e&&e.message}));
});

// admin: reset model & stats
app.post("/admin/reset-model", (req,res) => {
  initModelIfNeeded();
  CONFIG.STRATEGIES.forEach(n => stats.strategies[n] = { correct:0, total:0, ema:0.5 });
  stats.total_phien = 0; stats.so_dung = 0; stats.so_sai = 0;
  saveFiles().catch(()=>{});
  res.json({ ok:true, note: "Model & thống kê đã reset" });
});

// ====== Start ======
process.on("uncaughtException", (err) => console.error("uncaughtException:", err && (err.stack||err)));
process.on("unhandledRejection", (r) => console.warn("unhandledRejection:", r));

(async ()=> {
  await loadFiles();
  // initial fetch
  fetchOnceAndSave().catch(()=>{});
  app.listen(PORT, ()=>console.log(`🚀 Botrumsunwin ULTRA-VIP (20) running on port ${PORT}`));
})();
