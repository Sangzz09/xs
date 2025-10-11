// ✅ BOTRUMSUNWIN HYBRID AI PRO v11 (Ultra Pattern + SuperVIP Statistical)
// - Pattern Ultra: phân tích chuỗi cầu (T/X) sâu, tìm motif lặp, đánh trọng số theo độ gần.
// - SuperVIP: mô hình xác suất thống kê (Markov-like order 1..3 + Laplace smoothing).
// - Không bỏ lượt; nếu lịch sử < MIN_HISTORY_FOR_AI => fallbackByFormula (file bạn cung cấp).
// - Chỉ trả 1 dự đoán mỗi phiên.
// By @minhsangdangcap (2025)

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();

const PORT = process.env.PORT || 3000;
const API_URL = process.env.SOURCE_API || "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.resolve(__dirname, "data.json");

const FETCH_INTERVAL_MS = 5000;
const MAX_HISTORY = 60; // lưu lâu chút để pattern ultra có đủ dữ liệu
const MIN_HISTORY_FOR_AI = 5; // nếu <5 => fallbackByFormula
const RESET_AFTER = 60; // reset mốc (tuỳ chỉnh)

// ---------------- Persistent storage ----------------
let data = {
  history: [], // entry: {phien, ket_qua, xuc_xac, tong_xuc_xac, du_doan, thuat_toan, confidence, details}
  stats: { tong: 0, dung: 0, sai: 0 },
  algoStats: {
    balance: { ewma: 0.5, alpha: 0.12 },
    streak: { ewma: 0.5, alpha: 0.12 },
    momentum: { ewma: 0.5, alpha: 0.12 },
    pattern: { ewma: 0.5, alpha: 0.12 },
    antibias: { ewma: 0.5, alpha: 0.12 },
    ultra: { ewma: 0.5, alpha: 0.12 },
    supervip: { ewma: 0.5, alpha: 0.12 }
  },
  baseWeights: { balance: 1, streak: 1, momentum: 1, pattern: 1, antibias: 1, ultra: 1.5, supervip: 2.0 },
  lastPredicted: 0
};

// load data
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    data = Object.assign(data, parsed);
    data.history = data.history || [];
    data.stats = data.stats || { tong: 0, dung: 0, sai: 0 };
  }
} catch (e) {
  console.log("⚠️ Không thể đọc data.json — khởi tạo mới.", e.message);
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("⚠️ Lỗi ghi data.json:", e.message);
  }
}

function safeParseInt(v){ const n = parseInt(v); return isNaN(n) ? 0 : n; }
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");

// normalize numeric object to sum 1
function normalize(obj){
  const s = Object.values(obj).reduce((a,b)=>a+b,0) || 1;
  const out = {};
  for(const k of Object.keys(obj)) out[k] = obj[k] / s;
  return out;
}

// ---------------- Fallback (CÔNG THỨC SUNWIN) ----------------
function fallbackByFormula(sum, dices) {
  const raw = dices.map(d=>safeParseInt(d));
  const code = raw.join("");
  const sortedAsc = [...raw].sort((a,b)=>a-b).join("");

  if (sum === 3) return { du_doan: "Xỉu", note: "Sum=3 ⇒ Xỉu (100%)" };
  if (sum === 4) return { du_do_an: null, du_doan: "Xỉu", note: "Sum=4 ⇒ ưu Xỉu (68%)" };
  if (sum === 5) return { du_doan: "Xỉu", note: "Sum=5 ⇒ Xỉu (100%)" };
  if (sum === 6) return { du_doan: "Xỉu", note: "Sum=6 ⇒ ưu Xỉu (cân nhắc nghỉ tay)" };
  if (sum === 7) {
    const strong = ["124","223","133"];
    if (strong.includes(code) || strong.includes(sortedAsc)) return { du_doan: "Xỉu", note: "Sum=7 pattern strong ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=7 other ⇒ lean Tài" };
  }
  if (sum === 8) {
    if (code === "134" || sortedAsc === "134") return { du_doan: "Xỉu", note: "Sum=8 pattern 134 ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=8 other ⇒ Tài" };
  }
  if (sum === 9) {
    if (code === "234" || sortedAsc === "234") return { du_doan: "Xỉu", note: "Sum=9 pattern 234 ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=9 other ⇒ lean Tài" };
  }
  if (sum === 10) return { du_doan: "Xỉu", note: "Sum=10 ⇒ Xỉu" };
  if (sum === 11) return { du_doan: "Tài", note: "Sum=11 ⇒ lean Tài" };
  if (sum === 12) {
    const px = ["246","156","336","255"];
    if (px.includes(code) || px.includes(sortedAsc)) return { du_doan: "Xỉu", note: "Sum=12 pattern ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=12 other ⇒ Tài" };
  }
  if (sum === 13) {
    const px = ["553","661","531","631"];
    if (px.includes(code) || px.includes(sortedAsc)) return { du_doan: "Xỉu", note: "Sum=13 pattern ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=13 other ⇒ Tài" };
  }
  if (sum === 14) return { du_doan: "Tài", note: "Sum=14 ⇒ 50/50 -> choose Tài" };
  if (sum === 15) return { du_doan: "Tài", note: "Sum=15 ⇒ Tài" };
  if (sum === 16) return { du_doan: "Xỉu", note: "Sum=16 ⇒ Xỉu" };
  if (sum === 17) return { du_doan: "Tài", note: "Sum=17 ⇒ lean Tài" };
  if (sum === 18) return { du_doan: "Tài", note: "Sum=18 ⇒ Tài" };
  return { du_doan: Math.random()>0.5?"Tài":"Xỉu", note: "Fallback random" };
}

// ---------------- Sub-algo basic (keep existing) ----------------
function algoBalance(hist) {
  const window = hist.slice(-20);
  const tai = window.filter(h=>h.ket_qua==="Tài").length;
  const xiu = window.length - tai;
  return { du_doan: tai > xiu ? "Xỉu" : "Tài", name: "Cân bằng" };
}

function algoStreak(hist) {
  const last3 = hist.slice(-3).map(h=>h.ket_qua);
  if (last3.length===3 && last3.every(v=>v===last3[0])) return { du_doan: opposite(last3[0]), name: "Đảo chuỗi 3" };
  if (!hist.length) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "Ngẫu nhiên chuỗi" };
  return { du_doan: hist.at(-1).ket_qua, name: "Ngẫu nhiên chuỗi" };
}

function algoMomentum(hist) {
  const last10 = hist.slice(-10);
  let wT=0,wX=0;
  for(let i=0;i<last10.length;i++){
    const w=(i+1)/(last10.length||1);
    if(last10[i].ket_qua==="Tài") wT+=w; else wX+=w;
  }
  return { du_doan: wT>=wX ? "Tài":"Xỉu", name: "Xu hướng động lượng" };
}

function algoPatternAdvanced(hist) {
  if(hist.length<6) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "Pattern (ít dữ liệu)" };
  const s = hist.map(h=>h.ket_qua[0]).join("");
  const maxN = 5;
  let counts = {"Tài":0,"Xỉu":0};
  for(let n=Math.min(maxN, Math.floor(s.length/2)); n>=2; n--){
    const lastN = s.slice(-n);
    for(let i=0;i+n<s.length;i++){
      if(s.slice(i,i+n)===lastN){
        const nextChar = s[i+n];
        const nextLabel = nextChar==="T" ? "Tài":"Xỉu";
        counts[nextLabel]++;
      }
    }
    if(counts["Tài"]+counts["Xỉu"]>=2) break;
  }
  if(counts["Tài"]+counts["Xỉu"]===0){
    const window = hist.slice(-8);
    const tai = window.filter(h=>h.ket_qua==="Tài").length;
    const xiu = window.length - tai;
    return { du_doan: tai>=xiu ? "Tài":"Xỉu", name: "Pattern v10 (freq fallback)" };
  }
  const du_doan = counts["Tài"]>counts["Xỉu"] ? "Tài":"Xỉu";
  const confidenceNote = Math.abs(counts["Tài"]-counts["Xỉu"])>=2 ? "mạnh":"yếu";
  return { du_doan, name: `Pattern v10 (${confidenceNote})`, evidence: counts };
}

function algoAntiBias(hist) {
  const last5 = hist.slice(-5).map(h=>h.ket_qua);
  if(last5.length < 4) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "Anti-bias (ngẫu nhiên)" };
  const same = last5.every(v=>v===last5[0]);
  return { du_doan: same ? opposite(last5[0]) : (Math.random()>0.5?"Tài":"Xỉu"), name: "Anti-bias" };
}

// ---------------- New: Pattern Ultra (phân tích chuỗi cầu sâu) ----------------
/*
  Ý tưởng:
  - Biến lịch sử thành chuỗi 'T'/'X'.
  - Tìm các motif (length 3..8) xuất hiện trước đó.
  - Với mỗi motif khớp phần cuối, lấy phân phối kết quả tiếp theo từ các lần motif xuất hiện.
  - Cộng điểm với trọng số theo recency (gần hơn có weight lớn hơn), and theo motif length (dài hơn ưu tiên).
  - Trả về dự đoán có tổng trọng số lớn hơn.
*/
function algoPatternUltra(hist) {
  if(hist.length < 6) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "PatternUltra (ít dữ liệu)" };
  const letters = hist.map(h=>h.ket_qua[0]).join(""); // "TXXTT..."
  const maxLen = Math.min(8, Math.floor(letters.length/2));
  const scores = { "Tài": 0, "Xỉu": 0 };
  // weight by recency decay factor
  const nowIndex = letters.length - 1;
  for(let L = Math.min(maxLen,6); L >= 3; L--){ // ưu motif 6..3
    const tail = letters.slice(-L);
    // scan previous occurrences
    for(let i=0;i+L<letters.length;i++){
      if(letters.slice(i,i+L) === tail){
        const nextChar = letters[i+L];
        const label = nextChar === "T" ? "Tài" : "Xỉu";
        // recency weight: closer occurrences have higher weight
        const recencyDistance = nowIndex - (i+L-1); // smaller -> closer
        const recencyWeight = 1 / (1 + recencyDistance * 0.12); // decay
        // length bonus
        const lengthBonus = 1 + (L-2) * 0.25;
        scores[label] += recencyWeight * lengthBonus;
      }
    }
    // if found at least 2 evidence for this length, break to prefer longer motif
    const evidence = scores["Tài"] + scores["Xỉu"];
    if(evidence >= 0.5) break;
  }
  // if no evidence, fallback to frequency in last window
  if(scores["Tài"] + scores["Xỉu"] === 0){
    const window = hist.slice(-10);
    const tai = window.filter(h=>h.ket_qua==="Tài").length;
    const xiu = window.length - tai;
    return { du_doan: tai>=xiu ? "Tài":"Xỉu", name: "PatternUltra (freq fallback)" };
  }
  const du_doan = scores["Tài"] >= scores["Xỉu"] ? "Tài":"Xỉu";
  const conf = Math.min(0.99, Math.abs(scores["Tài"] - scores["Xỉu"]) / (scores["Tài"] + scores["Xỉu"]));
  return { du_doan, name: "PatternUltra", evidence: scores, confidenceEst: conf };
}

// ---------------- New: SuperVIP (statistical Markov-like order 1..3) ----------------
/*
  Ý tưởng:
  - Xây dựng bảng chuyển tiếp P(next | last_k) cho k = 1..3 từ lịch sử.
  - Dùng Laplace smoothing.
  - Lấy trọng số bằng độ tin cậy của từng order (longer order nếu có nhiều evidence).
  - Trả về xác suất P(Tài) và P(Xỉu) -> dự đoán theo xác suất cao hơn.
*/
function algoSuperVIP(hist) {
  if(hist.length < 4) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "SuperVIP (ít dữ liệu)" };
  // produce sequence of 'T'/'X'
  const seq = hist.map(h=>h.ket_qua[0]).join("");
  const orders = [3,2,1];
  const probs = { "Tài": 0, "Xỉu": 0 };
  const weights = { 3: 0.5, 2: 0.3, 1: 0.2 }; // base weights for orders
  // but adapt weights by amount of evidence for each order
  for(const k of orders){
    const context = seq.slice(-k);
    if(context.length < k) continue;
    // count occurrences of context and what followed
    let countT = 0, countX = 0, total = 0;
    for(let i=0;i+k<seq.length;i++){
      if(seq.slice(i,i+k) === context){
        const nxt = seq[i+k];
        if(nxt === "T") countT++; else countX++;
        total++;
      }
    }
    // Laplace smoothing
    const alpha = 1;
    const pT = (countT + alpha) / (total + 2*alpha);
    const pX = (countX + alpha) / (total + 2*alpha);
    // evidence strength: total occurrences normalized (more occurrences => more reliable)
    const evidenceStrength = Math.min(1, total / 12); // 12 occurrences gives full strength
    const w = weights[k] * (0.3 + 0.7 * evidenceStrength); // between 0.3..weight
    probs["Tài"] += pT * w;
    probs["Xỉu"] += pX * w;
  }
  // normalize
  const s = probs["Tài"] + probs["Xỉu"] || 1;
  probs["Tài"] /= s; probs["Xỉu"] /= s;
  const du_doan = probs["Tài"] >= probs["Xỉu"] ? "Tài":"Xỉu";
  const confidence = Math.max(0.01, Math.min(0.99, Math.abs(probs["Tài"] - probs["Xỉu"])));
  return { du_doan, name: "SuperVIP(StatMarkov)", probs, confidence };
}

// ---------------- Meta combine & predict (include new algos) ----------------
function computeAdaptiveWeights(){
  const weights = {};
  for(const k of Object.keys(data.baseWeights)){
    const base = data.baseWeights[k] || 1;
    const perf = (data.algoStats[k] && data.algoStats[k].ewma) ? data.algoStats[k].ewma : 0.5;
    const final = base * (1 + (perf - 0.5) * 2);
    weights[k] = Math.max(0.01, final);
  }
  return normalize(weights);
}

// hybridPredict returns null if not enough history (caller will fallback)
function hybridPredict(hist){
  if(hist.length < MIN_HISTORY_FOR_AI) return null;

  const adaptive = computeAdaptiveWeights();
  const algos = [
    { fn: algoBalance, key: "balance" },
    { fn: algoStreak, key: "streak" },
    { fn: algoMomentum, key: "momentum" },
    { fn: algoPatternAdvanced, key: "pattern" },
    { fn: algoAntiBias, key: "antibias" },
    { fn: algoPatternUltra, key: "ultra" },
    { fn: algoSuperVIP, key: "supervip" }
  ];

  const voteScores = { "Tài":0, "Xỉu":0 };
  const details = [];

  for(const a of algos){
    const r = a.fn(hist);
    const w = adaptive[a.key] || 0;
    voteScores[r.du_doan] += w;
    details.push({ name: r.name, pick: r.du_doan, w, info: r.evidence || r.probs || null, confEst: r.confidence || r.confidenceEst || 0 });
  }

  const taiScore = voteScores["Tài"], xiuScore = voteScores["Xỉu"];
  const total = taiScore + xiuScore || 1;
  const winner = taiScore >= xiuScore ? "Tài":"Xỉu";
  const margin = Math.abs(taiScore - xiuScore);
  const rawConfidence = margin / total;
  // boost if ultra or supervip provided evidence
  const ultraDetail = details.find(d=>d.name && d.name.toLowerCase().includes("ultra"));
  const superDetail = details.find(d=>d.name && d.name.toLowerCase().includes("supervip"));
  let boost = 0;
  if(ultraDetail && ultraDetail.confEst) boost += Math.min(0.25, ultraDetail.confEst * 0.3);
  if(superDetail && superDetail.confidence) boost += Math.min(0.25, superDetail.confidence * 0.3);
  let confidence = Math.min(0.99, rawConfidence * 0.75 + 0.15 + boost);
  confidence = Math.max(0.01, Math.min(0.99, confidence));

  // produce algorithm summary
  const summary = details.map(d=>`${d.name}:${d.w.toFixed(2)}->${d.pick}`).join(",");

  return { du_doan: winner, thuat_toan: `Hybrid(${summary})`, confidence, details, scores: voteScores };
}

// ---------------- Learning: update EWMA per-algo ----------------
function updateAlgoStats(prevEntry){
  if(!prevEntry) return;
  const actual = prevEntry.ket_qua;
  const algosToCheck = {
    balance: algoBalance,
    streak: algoStreak,
    momentum: algoMomentum,
    pattern: algoPatternAdvanced,
    antibias: algoAntiBias,
    ultra: algoPatternUltra,
    supervip: algoSuperVIP
  };
  const priorHistory = data.history.slice(0, -1);
  for(const key of Object.keys(algosToCheck)){
    const stat = data.algoStats[key];
    if(!stat) continue;
    let predicted;
    if(prevEntry.details && Array.isArray(prevEntry.details)){
      const found = prevEntry.details.find(d => {
        const n = (d.name||"").toLowerCase();
        if(key==="ultra") return n.includes("ultra");
        if(key==="supervip") return n.includes("supervip") || n.includes("markov");
        return n.includes(key.slice(0,3));
      });
      if(found && found.pick) predicted = found.pick;
    }
    if(!predicted){
      try { predicted = algosToCheck[key](priorHistory).du_doan; }
      catch(e){ predicted = Math.random()>0.5?"Tài":"Xỉu"; }
    }
    const correct = predicted === actual ? 1 : 0;
    const alpha = stat.alpha || 0.12;
    stat.ewma = alpha * correct + (1 - alpha) * (stat.ewma || 0.5);
  }
}

// ---------------- Fetch & Learn Loop ----------------
async function fetchAndLearn(){
  try {
    const res = await axios.get(API_URL, { timeout: 5000 });
    const d = res.data || {};

    const phien = safeParseInt(d.phien || d.Phiên || 0);
    if(!phien || phien === data.lastPredicted) return;
    data.lastPredicted = phien;

    // parse dice
    let xuc_xac = null;
    if(Array.isArray(d.xuc_xac)) xuc_xac = d.xuc_xac.map(v=>safeParseInt(v));
    else if(d.xuc_xac_1 !== undefined) xuc_xac = [safeParseInt(d.xuc_xac_1), safeParseInt(d.xuc_xac_2), safeParseInt(d.xuc_xac_3)];
    else if(Array.isArray(d["Xúc_xắc"])) xuc_xac = d["Xúc_xắc"].map(v=>safeParseInt(v));
    else xuc_xac = [safeParseInt(d.X1||d.x1), safeParseInt(d.X2||d.x2), safeParseInt(d.X3||d.x3)];

    const tong = (xuc_xac || [0,0,0]).reduce((a,b)=>a+b,0);
    const ket_qua = (d.ket_qua || d.Kết_quả || "").toString().trim() || (tong>=11 ? "Tài" : "Xỉu");

    // decide prediction
    let entry = null;
    if(data.history.length < MIN_HISTORY_FOR_AI){
      const fb = fallbackByFormula(tong, xuc_xac);
      let confidence = (fb.note && fb.note.includes("100%")) ? 0.95 : (fb.note && fb.note.includes("mạnh")) ? 0.8 : 0.6;
      entry = {
        phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
        du_doan: fb.du_doan, thuat_toan: `Fallback(${fb.note||'rule'})`, confidence, details: null
      };
      data.history.push(entry);
      if(data.history.length > MAX_HISTORY) data.history.shift();
      data.stats.tong++; if(entry.du_doan === ket_qua) data.stats.dung++; else data.stats.sai++;
      updateAlgoStats(entry);
      // mild baseWeights tweak
      for(const k of Object.keys(data.baseWeights)) data.baseWeights[k] *= (entry.du_doan === ket_qua ? 1.01 : 0.995);
      save();
      console.log(`🔁 Phiên ${phien} (fallback): KQ=${ket_qua} | Dự đoán=${entry.du_doan} | note=${fb.note||''}`);
      return;
    }

    // use hybrid
    const meta = hybridPredict(data.history);
    // meta should not be null here
    entry = {
      phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
      du_doan: meta.du_doan, thuat_toan: meta.thuat_toan, confidence: meta.confidence, details: meta.details
    };

    data.history.push(entry);
    if(data.history.length > MAX_HISTORY) data.history.shift();
    data.stats.tong++; if(entry.du_doan === ket_qua) data.stats.dung++; else data.stats.sai++;

    updateAlgoStats(entry);

    // adapt baseWeights gently
    for(const k of Object.keys(data.baseWeights)){
      const perf = (data.algoStats[k] && data.algoStats[k].ewma) ? data.algoStats[k].ewma : 0.5;
      if(perf > 0.58) data.baseWeights[k] *= 1.02;
      else if(perf < 0.42) data.baseWeights[k] *= 0.99;
    }

    // optional: reset message
    if(data.stats.tong > 0 && data.stats.tong % RESET_AFTER === 0){
      console.log(`♻️ [INFO] Đã học ${RESET_AFTER} phiên — bạn có thể /clear nếu muốn reset hoàn toàn.`);
    }

    save();
    console.log(`✅ Phiên ${phien}: KQ=${ket_qua} | Dự đoán=${entry.du_doan} | Conf=${(entry.confidence*100).toFixed(0)}%`);
  } catch (err) {
    console.log("⚠️ Lỗi fetch API:", err.message);
  }
}

// ---------------- Endpoints ----------------
app.get("/sunwinapi", (req, res) => {
  if(!data.history.length) return res.json({ message: "Chưa có dữ liệu" });
  const last = data.history[data.history.length-1];
  res.json({
    Phiên: last.phien,
    Kết_quả: last.ket_qua,
    Xúc_xắc: last.xuc_xac,
    Tổng_xúc_xắc: last.tong_xuc_xac,
    Dự_đoán: last.du_doan,
    Thuật_toán: last.thuat_toan,
    Confidence: last.confidence,
    Số_lần_dự_đoán: data.stats.tong,
    Số_đúng: data.stats.dung,
    Số_sai: data.stats.sai,
    Id: "@minhsangdangcap"
  });
});

app.get("/history", (req, res) => {
  res.json({ count: data.history.length, history: data.history, stats: data.stats, algoStats: data.algoStats, baseWeights: data.baseWeights });
});

app.get("/stats", (req,res) => {
  const acc = data.stats.tong ? (data.stats.dung / data.stats.tong) : 0;
  res.json({ totalRounds: data.stats.tong, wins: data.stats.dung, losses: data.stats.sai, accuracy: (acc*100).toFixed(2)+"%", algoStats: data.algoStats, baseWeights: data.baseWeights });
});

app.get("/clear", (req,res) => {
  data = {
    history: [], stats: { tong:0,dung:0,sai:0 },
    algoStats: {
      balance:{ewma:0.5,alpha:0.12}, streak:{ewma:0.5,alpha:0.12}, momentum:{ewma:0.5,alpha:0.12},
      pattern:{ewma:0.5,alpha:0.12}, antibias:{ewma:0.5,alpha:0.12}, ultra:{ewma:0.5,alpha:0.12}, supervip:{ewma:0.5,alpha:0.12}
    },
    baseWeights: { balance:1, streak:1, momentum:1, pattern:1, antibias:1, ultra:1.5, supervip:2.0 },
    lastPredicted: 0
  };
  save();
  res.json({ ok:true, message: "Đã reset toàn bộ data" });
});

// ---------------- Start loop & server ----------------
setInterval(fetchAndLearn, FETCH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`🚀 BOTRUMSUNWIN HYBRID AI PRO v11 đang chạy tại http://localhost:${PORT}`);
  console.log(`   - API nguồn: ${API_URL}`);
  console.log(`   - Lưu data: ${DATA_FILE}`);
});
