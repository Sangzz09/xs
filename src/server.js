// HYBRIDPLUS v25.3 — Auto-tune + Abstain + History
// Dev: @minhsangdangcap
// - Ensemble v25.1 base
// - Adds: prediction_history, abstain low-confidence, online weight tuning, diagnostics endpoints

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_HISTORY = process.env.API_HISTORY || "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.join(__dirname, "data.json");
const STATS_FILE = path.join(__dirname, "stats.json");
const FETCH_INTERVAL_MS = 10000;

// Behaviour flags (can set via env)
const ABSTAIN_MODE = process.env.ABSTAIN_MODE === "true"; // default false
const ABSTAIN_THRESHOLD = Number(process.env.ABSTAIN_THRESHOLD) || 0.58; // confidence threshold
const TUNE_WINDOW = Number(process.env.TUNE_WINDOW) || 20; // use last N rounds to evaluate tuning
const TUNE_STEP = Number(process.env.TUNE_STEP) || 0.05; // +/-5% step for weight tuning

// ---------- state ----------
let data = {
  history: [],            // newest-first rows from API
  lastPredict: null,      // pending prediction for next phien
  streakLose: 0,
  streakWin: 0,
  weights: { pattern: 0.25, trend: 0.25, dice: 0.2, momentum: 0.15, memory: 0.15 },
  prediction_history: []  // { predictPhien, du_doan, confidence, actualPhien (when available), actual, correct, ts }
};
let stats = { tong: 0, dung: 0, sai: 0, reset: 0 };

// load/save helpers
function safeInt(v){ const n = parseInt(v); return Number.isFinite(n) ? n : 0; }
function loadAll(){
  try{
    if (fs.existsSync(DATA_FILE)){
      const raw = JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));
      Object.assign(data, raw);
      if (!data.weights) data.weights = { pattern:0.25, trend:0.25, dice:0.2, momentum:0.15, memory:0.15 };
      if (!Array.isArray(data.prediction_history)) data.prediction_history = [];
    }
    if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE,"utf8"));
  }catch(e){ console.log("loadAll err", e.message); }
}
function saveAll(){
  try{
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");
  }catch(e){ console.log("saveAll err", e.message); }
}
loadAll();

// ---------- helpers ----------
function seqTX(history, n=30){ return history.slice(0,n).reverse().map(h=> (h.ket_qua==="Tài"?"T":"X")).join(""); }
function getTrend(history,n=6){ const arr = history.slice(0,n).map(h=>h.tong_xuc_xac||0); if (arr.length<2) return 0; let up=0,down=0; for(let i=1;i<arr.length;i++){ if(arr[i]>arr[i-1]) up++; else if(arr[i]<arr[i-1]) down++; } return (up-down)/n; }
function analyzePattern(seq){ if(!seq||seq.length<6) return {score:0,type:"none"}; const L=seq.length,last=seq[L-1]; let run=1; for(let i=L-2;i>=0&&seq[i]===last;i--) run++; const alt=[...seq].filter((_,i)=>i&&seq[i]!==seq[i-1]).length/(L-1); const net=[...seq].reduce((a,c)=>a+(c==="T"?1:-1),0)/L; const s=(Math.tanh((run-2)/3)+net*0.5-alt*0.3)*(last==="T"?1:-1); let type="Không rõ"; if(run>=4) type="Bệt"; else if(alt>0.6) type="Đảo liên tục"; else if(alt<0.3) type="Ổn định"; return {score:s,type}; }
function diceBias(last){ if(!last||!Array.isArray(last.xuc_xac)) return 0; const high = last.xuc_xac.filter(x=>x>=5).length; const low = last.xuc_xac.filter(x=>x<=2).length; if(high>=2) return 0.6; if(low>=2) return -0.6; return 0; }
function momentum(history){ const h10 = history.slice(0,10); const tai=h10.filter(h=>h.ket_qua==="Tài").length; const xiu=h10.length-tai; return (tai-xiu)/(h10.length||1); }
function memoryPattern(history){ if(history.length<20) return 0; const last10 = seqTX(history,10); for(let i=15;i<50 && i+10<history.length;i++){ const past10 = seqTX(history.slice(i),10); if(past10===last10) return 0.7*(last10.endsWith("T")?1:-1); } return 0; }

// ---------- ensemble ----------
function hybridEnsemblePredict(history, weights){
  const seq = seqTX(history,30);
  const pat = analyzePattern(seq);
  const t = getTrend(history,6);
  const dice = diceBias(history[0]);
  const mom = momentum(history);
  const mem = memoryPattern(history);
  const w = weights || data.weights || {pattern:0.25,trend:0.25,dice:0.2,momentum:0.15,memory:0.15};
  let raw = pat.score * w.pattern + t * w.trend + dice * w.dice + mom * w.momentum + mem * w.memory;
  const avg = history.slice(0,8).reduce((a,b)=>a+(b.tong_xuc_xac||0),0)/(Math.min(8,history.length)||1);
  raw += (avg - 10.5) * 0.05;
  const du_doan = raw >= 0 ? "Tài" : "Xỉu";
  const confidence = Math.min(0.95, 0.55 + Math.abs(raw) * 0.45);
  return {du_doan,confidence,patternSeq:seq,patternType:pat.type,raw};
}

// ---------- fetch API ----------
async function fetchAPI(){
  try{
    const res = await axios.get(API_HISTORY, { timeout: 8000 });
    let raw = Array.isArray(res.data) ? res.data[0] : res.data;
    if(typeof raw === "string"){ try{ raw = JSON.parse(raw); }catch(e){} }
    const phien = safeInt(raw.phien || raw.id || raw.session);
    const tong = safeInt(raw.tong || raw.total);
    const ket_qua = (raw.ket_qua || (tong>=11?"Tài":"Xỉu")).toString();
    const xuc_xac = [safeInt(raw.xuc_xac_1), safeInt(raw.xuc_xac_2), safeInt(raw.xuc_xac_3)].filter(n=>n>0);
    if(!phien) return null;
    return {phien, ket_qua, tong_xuc_xac: tong, xuc_xac};
  }catch(e){
    // avoid noisy log
    // console.log("fetchAPI err", e.message);
    return null;
  }
}

// ---------- tuning helper ----------
function recentAccuracy(windowSize = TUNE_WINDOW){
  const ph = data.prediction_history.slice(-windowSize);
  if(ph.length===0) return null;
  const valid = ph.filter(p=>typeof p.correct === "boolean");
  if(valid.length===0) return null;
  const acc = valid.filter(p=>p.correct).length / valid.length;
  return acc;
}
function tryTuneWeights(){
  // simple hill-climb: for each weight, try +step and -step, keep if improves recent accuracy
  const baseAcc = recentAccuracy();
  if(baseAcc === null) return; // not enough data
  const keys = Object.keys(data.weights);
  let bestWeights = Object.assign({}, data.weights);
  let bestAcc = baseAcc;
  for(const k of keys){
    for(const dir of [1,-1]){
      const w2 = Object.assign({}, data.weights);
      w2[k] = Math.max(0.05, Math.min(0.9, w2[k] * (1 + dir * TUNE_STEP)));
      // renormalize roughly to sum ~1 (optional)
      const sum = Object.values(w2).reduce((a,b)=>a+b,0);
      Object.keys(w2).forEach(kk => w2[kk] = w2[kk]/sum);
      // simulate past N rounds with w2 and compute acc quickly
      const ph = data.prediction_history.slice(-TUNE_WINDOW);
      if(ph.length===0) continue;
      let correctCount = 0, total = 0;
      for(const rec of ph){
        if(typeof rec.actual === "undefined") continue;
        // recompute what we would have predicted for rec.predictPhien using the stored input snapshot? we don't store snapshots -> fallback: skip tuning if no snapshots
        // To keep simple we only tune using current live history (less ideal but safe)
        total++;
      }
      // Because we don't have per-round input snapshots (heavy), we'll instead use last TUNE_WINDOW predictions and compare
      // If we cannot evaluate -> skip (this is safe)
    }
  }
  // Note: Full proper tuning requires storing input snapshot per prediction. We adopt minimal online tuning below when concrete actuals are available.
}

// ---------- process incoming ----------
async function processIncoming(item){
  const lastPhien = data.history[0]?.phien;
  if(lastPhien && item.phien <= lastPhien) return; // already have
  data.history.unshift(item);
  if(data.history.length>800) data.history = data.history.slice(0,800);

  // compare with prediction that targeted THIS phien
  if(data.lastPredict && data.lastPredict.predictPhien === item.phien){
    const predRec = data.lastPredict;
    const correct = predRec.du_doan === item.ket_qua;
    // update stats only if the prediction was not an abstain record
    if(!predRec.abstain){
      stats.tong = (stats.tong||0); // ensure exists
      if(correct){ stats.dung = (stats.dung||0)+1; data.streakWin=(data.streakWin||0)+1; data.streakLose=0; }
      else { stats.sai=(stats.sai||0)+1; data.streakLose=(data.streakLose||0)+1; data.streakWin=0; }
    }
    // update prediction_history entry if present
    const phArr = data.prediction_history;
    const entry = phArr.find(p => p.predictPhien === predRec.predictPhien && !p.actualPhien);
    if(entry){
      entry.actualPhien = item.phien;
      entry.actual = item.ket_qua;
      entry.correct = correct;
      entry.tsActual = Date.now();
    }
    // auto-tune: if we have a run of recent actuals, attempt small tuning
    // Basic heuristic: if accuracy over last 10 changed, try small adjustments
    const recent = data.prediction_history.slice(-Math.max(20, TUNE_WINDOW)).filter(p=>typeof p.correct === "boolean");
    const recentCount = recent.length;
    if(recentCount >= 8){
      const acc = recent.filter(p=>p.correct).length / recentCount;
      // if acc < 0.55 -> try a tiny random nudge on weights (to escape local minima)
      if(acc < 0.55){
        const keys = Object.keys(data.weights);
        const k = keys[Math.floor(Math.random()*keys.length)];
        const old = data.weights[k];
        const neww = Math.max(0.05, Math.min(0.9, old * (1 - (Math.random()*0.12)))); // nudge down up to 12%
        data.weights[k] = neww;
        // renormalize
        const sum = Object.values(data.weights).reduce((a,b)=>a+b,0);
        Object.keys(data.weights).forEach(kk => data.weights[kk] = data.weights[kk]/sum);
        console.log(chalk.yellow(`⚙️ Auto-nudge weight ${k} -> ${data.weights[k].toFixed(3)} (acc ${Math.round(acc*100)}%)`));
      }
    }
  }

  // if too many consecutive losses => shrink pattern to 5 but keep stats
  if((data.streakLose||0) >= 3){
    console.log(chalk.yellow("♻ Sai 3 lần → shrink pattern còn 5 phiên (stats giữ nguyên)"));
    data.history = data.history.slice(0,5);
    data.streakLose = 0;
    stats.reset = (stats.reset||0)+1;
    // clear pending prediction so fresh prediction will be generated
    data.lastPredict = null;
    saveAll();
    return;
  }

  // if there's already a pending prediction for nextPhien, update its last_phien data and exit
  const nextPhien = item.phien + 1;
  if(data.lastPredict && data.lastPredict.predictPhien === nextPhien){
    // update metadata so /sunwinapi shows fresh current phien info
    data.lastPredict.last_phien = item.phien;
    data.lastPredict.last_ket_qua = item.ket_qua;
    data.lastPredict.tong = item.tong_xuc_xac;
    data.lastPredict.xuc_xac = item.xuc_xac;
    saveAll();
    return;
  }

  // create new prediction for nextPhien
  const ai = hybridEnsemblePredict(data.history, data.weights);
  // handle abstain: if ABSTAIN_MODE true and confidence low, mark abstain and DO NOT increment stats.tong
  const abstain = ABSTAIN_MODE && ai.confidence < ABSTAIN_THRESHOLD;
  const predictObj = {
    predictPhien: nextPhien,
    du_doan: abstain ? "Không chắc" : ai.du_doan,
    confidence: ai.confidence,
    abstain: !!abstain,
    patternSeq: ai.patternSeq,
    patternType: ai.patternType,
    raw: ai.raw,
    last_phien: item.phien,
    last_ket_qua: item.ket_qua,
    tong: item.tong_xuc_xac,
    xuc_xac: item.xuc_xac,
    createdAt: Date.now()
  };
  data.lastPredict = predictObj;
  // push prediction_history entry (we will fill actual later)
  data.prediction_history.push({
    predictPhien: predictObj.predictPhien,
    du_doan: predictObj.du_doan,
    confidence: predictObj.confidence,
    abstain: predictObj.abstain,
    createdAt: predictObj.createdAt
  });
  // increment stats.tong only if not abstain
  if(!abstain) stats.tong = (stats.tong||0) + 1;
  saveAll();
  console.log(chalk.cyan(`🔮 Phiên ${nextPhien}: ${predictObj.du_doan} (${Math.round(predictObj.confidence*100)}%) ${predictObj.abstain?"(ABSTAIN)":""}`));
}

// ---------- main fetch loop ----------
async function importAndPredict(){
  const item = await fetchAPI();
  if(!item) return;
  await processIncoming(item);
}
async function fetchAPI(){
  try{
    const r = await axios.get(API_HISTORY, { timeout: 8000 });
    let p = Array.isArray(r.data) ? r.data[0] : r.data;
    if(typeof p === "string"){ try{ p = JSON.parse(p); }catch(e){} }
    const phien = safeInt(p.phien||p.id||p.session);
    const tong = safeInt(p.tong||p.total);
    const ket_qua = (p.ket_qua || (tong>=11?"Tài":"Xỉu")).toString();
    const xuc_xac = [safeInt(p.xuc_xac_1), safeInt(p.xuc_xac_2), safeInt(p.xuc_xac_3)].filter(n=>n>0);
    if(!phien) return null;
    return {phien, ket_qua, tong_xuc_xac:tong, xuc_xac};
  }catch(e){
    return null;
  }
}
setInterval(importAndPredict, FETCH_INTERVAL_MS);
importAndPredict();

// ---------- API endpoints for user ----------
app.get("/sunwinapi", (req, res) => {
  if(!data.lastPredict) return res.json({message:"Chưa có dữ liệu"});
  const p = data.lastPredict;
  res.json({
    Phien: p.last_phien,
    Ket_qua: p.last_ket_qua,
    Tong: p.tong,
    Xuc_xac: p.xuc_xac,
    Du_doan: p.du_doan,
    Confidence: `${Math.round(p.confidence*100)}%`,
    Pattern: p.patternSeq,
    Loai_cau: p.patternType,
    Thuat_toan: "HYBRID+ DEEP_ENSEMBLE_V25.3",
    So_lan_du_doan: stats.tong,
    So_dung: stats.dung,
    So_sai: stats.sai,
    Dev: "@minhsangdangcap"
  });
});

app.get("/stats", (req, res) => res.json(stats));
app.get("/weights", (req,res)=> res.json(data.weights));
app.post("/setweights", (req,res)=>{
  const w = req.body;
  if(!w) return res.status(400).json({error:"send JSON weights"});
  data.weights = Object.assign(data.weights || {}, w);
  // renormalize
  const sum = Object.values(data.weights).reduce((a,b)=>a+b,0);
  Object.keys(data.weights).forEach(k=> data.weights[k] = data.weights[k]/sum);
  saveAll();
  res.json({ok:true, weights:data.weights});
});
app.get("/predhistory", (req,res)=> {
  // return last 200 for UI
  const out = data.prediction_history.slice(-200);
  res.json(out);
});
app.get("/history", (req,res)=> res.json(data.history));

// manual tune endpoint (unsafe but useful)
app.post("/tune", (req,res)=>{
  // body: { action: "nudge", key:"pattern", factor:0.9 }
  const body = req.body||{};
  if(body.action==="nudge" && body.key && data.weights[body.key]!==undefined){
    data.weights[body.key] = Math.max(0.05, Math.min(0.9, data.weights[body.key] * (body.factor||0.9)));
    // renormalize
    const sum = Object.values(data.weights).reduce((a,b)=>a+b,0);
    Object.keys(data.weights).forEach(k=> data.weights[k] = data.weights[k]/sum);
    saveAll();
    return res.json({ok:true, weights:data.weights});
  }
  return res.status(400).json({error:"invalid"});
});

// reset endpoints
app.get("/resetpattern", (req,res)=>{
  data.history = data.history.slice(0,5);
  data.streakLose = 0; data.streakWin = 0;
  stats.reset = (stats.reset||0)+1;
  saveAll();
  res.json({ok:true, message:"reset pattern (stats giữ)"}); 
});
app.get("/resetall", (req,res)=>{
  data = { history:[], lastPredict:null, streakLose:0, streakWin:0, weights:{pattern:0.25,trend:0.25,dice:0.2,momentum:0.15,memory:0.15}, prediction_history:[] };
  stats = { tong:0, dung:0, sai:0, reset:0 };
  saveAll();
  res.json({ok:true, message:"reset all"});
});

app.listen(PORT, ()=> console.log(chalk.green(`🚀 HYBRIDPLUS v25.3 chạy tại http://0.0.0.0:${PORT}`)));
