// BOTRUMSUNWIN HYBRID+ (HybridPlus) — v1
// Node.js + Express — nâng cấp thuật toán Hybrid với PatternDeep, AdaptiveTrend, MirrorPredict, ReverseBias, AutoLearn
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
const MAX_HISTORY = 200; // lưu nhiều để pattern deep có dữ liệu
const MIN_HISTORY_FOR_AI = 6; // nếu <6 => fallbackByFormula
const RESET_AFTER = 200; // reset mốc (tuỳ chỉnh)
const AUTOLEARN_RATE = 0.04; // mức điều chỉnh trọng số mỗi phiên

// ---------------- Persistent storage ----------------
let data = {
  history: [], // mỗi entry {phien, ket_qua, xuc_xac, tong_xuc_xac, du_doan, thuat_toan, confidence, details, timestamp}
  stats: { tong: 0, dung: 0, sai: 0 },
  algoStats: {
    balance: { ewma: 0.5, alpha: 0.12 },
    streak: { ewma: 0.5, alpha: 0.12 },
    momentum: { ewma: 0.5, alpha: 0.12 },
    pattern: { ewma: 0.5, alpha: 0.12 },
    antibias: { ewma: 0.5, alpha: 0.12 },
    ultra: { ewma: 0.5, alpha: 0.12 },
    supervip: { ewma: 0.5, alpha: 0.12 },
    // new modules
    patterndeep: { ewma: 0.5, alpha: 0.12 },
    adaptivetrend: { ewma: 0.5, alpha: 0.12 },
    mirror: { ewma: 0.5, alpha: 0.12 },
    reversebias: { ewma: 0.5, alpha: 0.12 },
    autolearn: { ewma: 0.5, alpha: 0.12 }
  },
  baseWeights: { 
    balance: 1, streak: 1, momentum: 1, pattern: 1, antibias: 1, ultra: 1.5, supervip: 2.0,
    patterndeep: 1.6, adaptivetrend: 1.2, mirror: 0.9, reversebias: 1.0, autolearn: 1.4
  },
  lastPredicted: 0,
  meta: { created: Date.now() }
};

// load saved data if exist
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
function now(){ return new Date().toISOString(); }
function normalize(obj){
  const s = Object.values(obj).reduce((a,b)=>a+b,0) || 1;
  const out = {};
  for(const k of Object.keys(obj)) out[k] = obj[k] / s;
  return out;
}

// ---------------- Fallback (CÔNG THỨC SUNWIN) ----------------
function fallbackByFormula(sum, dices) {
  const raw = (dices || []).map(d=>safeParseInt(d));
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

// ---------------- Existing modules (kept) ----------------
function algoBalance(hist) {
  const window = hist.slice(-20);
  const tai = window.filter(h=>h.ket_qua==="Tài").length;
  const xiu = window.length - tai;
  return { du_doan: tai > xiu ? "Xỉu" : "Tài", name: "Cân bằng" };
}

function algoStreak(hist) {
  const last3 = hist.slice(-3).map(h=>h.ket_qua);
  if (last3.length===3 && last3.every(v=>v===last3[0])) return { du_doan: opposite(last3[0]), name: "Anti-streak (3)" };
  if (!hist.length) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "Streak (ngẫu nhiên)" };
  return { du_doan: hist.at(-1).ket_qua, name: "Streak fallback" };
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

// ---------------- New modules (Hybrid+) ----------------

// PatternDeep: tìm motif dài (3..12) với weighting phức hợp
function algoPatternDeep(hist) {
  if(hist.length < 12) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "PatternDeep (ít dữ liệu)" };
  const s = hist.map(h=>h.ket_qua[0]).join("");
  const maxLen = Math.min(12, Math.floor(s.length/2));
  const scores = {"Tài":0,"Xỉu":0};
  const nowIndex = s.length - 1;
  for(let L = Math.min(maxLen,12); L>=3; L--){
    const tail = s.slice(-L);
    for(let i=0;i+L<s.length;i++){
      if(s.slice(i,i+L) === tail){
        const next = s[i+L];
        const label = next==="T"?"Tài":"Xỉu";
        const distance = nowIndex - (i+L);
        const recency = 1 / (1 + distance*0.08);
        const lengthBonus = 1 + (L-3)*0.2;
        // positional bonus: earlier repeats less weight
        scores[label] += recency * lengthBonus;
      }
    }
    if(scores["Tài"] + scores["Xỉu"] >= 1) break;
  }
  if(scores["Tài"] + scores["Xỉu"] === 0){
    const window = hist.slice(-20);
    const tai = window.filter(h=>h.ket_qua==="Tài").length;
    const xiu = window.length - tai;
    return { du_doan: tai>=xiu?"Tài":"Xỉu", name: "PatternDeep (freq fallback)" };
  }
  const du_doan = scores["Tài"]>=scores["Xỉu"]?"Tài":"Xỉu";
  const conf = Math.min(0.99, Math.abs(scores["Tài"]-scores["Xỉu"])/(scores["Tài"]+scores["Xỉu"]));
  return { du_doan, name: "PatternDeep", evidence: scores, confidence: conf };
}

// AdaptiveTrend: trọng số học từ recent window, dùng EWMA momentum
function algoAdaptiveTrend(hist) {
  const window = hist.slice(-30);
  if(window.length < 4) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "AdaptiveTrend (ngắn)" };
  // give more weight to recent outcomes with EWMA
  let scoreT=0, scoreX=0;
  let alpha = 0.2;
  let w = 1;
  for(let i=window.length-1;i>=0;i--){
    const res = window[i].ket_qua;
    if(res==="Tài") scoreT += w; else scoreX += w;
    w *= (1 - alpha); // decaying weight
  }
  const du_doan = scoreT >= scoreX ? "Tài":"Xỉu";
  const conf = Math.min(0.99, Math.abs(scoreT-scoreX)/(scoreT+scoreX || 1));
  return { du_doan, name: "AdaptiveTrend", confidence: conf, evidence: {scoreT, scoreX} };
}

// MirrorPredict: dự đoán theo pattern lặp tắc / mirror cycle (nếu tồn tại)
function algoMirrorPredict(hist) {
  if(hist.length < 8) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "MirrorPredict (ít dữ liệu)" };
  const s = hist.map(h=>h.ket_qua[0]).join("");
  // tìm chu kỳ ngắn nhất 2..8 mà chuỗi hiện tại có mirror repeat trước đó
  for(let p=2;p<=8;p++){
    if(s.length < p*2) continue;
    const tail = s.slice(-p);
    // kiểm tra nếu trước đó có đoạn tail nhưng ngược (mirror)
    for(let i=0;i+ p < s.length; i++){
      const seg = s.slice(i,i+p);
      if(seg === tail){ // exact repeat => assume follow same next
        const nextChar = s[i+p];
        const pick = nextChar === "T" ? "Tài":"Xỉu";
        return { du_doan: pick, name: `MirrorPredict(p=${p})` };
      }
    }
  }
  // fallback simple
  const last = hist.at(-1).ket_qua;
  return { du_doan: opposite(last), name: "MirrorPredict (fallback invert)" };
}

// ReverseBias: nếu nhìn thấy bias dài, cố gắng đảo chiều có trọng số
function algoReverseBias(hist) {
  const lastN = hist.slice(-12);
  if(lastN.length < 6) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "ReverseBias (ngẫu nhiên)" };
  const tai = lastN.filter(h=>h.ket_qua==="Tài").length;
  const xiu = lastN.length - tai;
  if(tai / lastN.length >= 0.7) return { du_doan: "Xỉu", name: "ReverseBias (over-Tài)" };
  if(xiu / lastN.length >= 0.7) return { du_doan: "Tài", name: "ReverseBias (over-Xỉu)" };
  // else small inversion chance
  const last = hist.at(-1).ket_qua;
  return { du_doan: last, name: "ReverseBias (fallback copy last)" };
}

// AutoLearn: meta module that returns aggregated signal from weight history (acts as advisor)
function algoAutoLearn(hist) {
  // compute simple weighted vote from algoStats ewma
  const weights = data.baseWeights || {};
  let scoreT=0, scoreX=0;
  const algKeys = Object.keys(data.algoStats || {});
  for(const k of algKeys){
    const ewma = data.algoStats[k] ? data.algoStats[k].ewma : 0.5;
    const w = (weights[k] || 1) * (0.5 + (ewma - 0.5)); // combine base weight and perf
    // use each algo's last pick if available in last history entry details
    const lastEntry = hist.length ? hist[hist.length-1] : null;
    let pick = null;
    if(lastEntry && lastEntry.details) {
      const found = lastEntry.details.find(d => (d.name||"").toLowerCase().includes(k.slice(0,5)));
      if(found && found.pick) pick = found.pick;
    }
    // else fallback alternate
    if(!pick) pick = Math.random()>0.5?"Tài":"Xỉu";
    if(pick === "Tài") scoreT += w; else scoreX += w;
  }
  const du_doan = scoreT >= scoreX ? "Tài":"Xỉu";
  return { du_doan, name: "AutoLearn" };
}

// ---------------- SuperVIP & PatternUltra kept ----------------
function algoPatternUltra(hist) {
  if(hist.length < 6) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "PatternUltra (ít dữ liệu)" };
  const letters = hist.map(h=>h.ket_qua[0]).join("");
  const maxLen = Math.min(8, Math.floor(letters.length/2));
  const scores = { "Tài": 0, "Xỉu": 0 };
  const nowIndex = letters.length - 1;
  for(let L = Math.min(maxLen,6); L >= 3; L--){
    const tail = letters.slice(-L);
    for(let i=0;i+L<letters.length;i++){
      if(letters.slice(i,i+L) === tail){
        const nextChar = letters[i+L];
        const label = nextChar === "T" ? "Tài" : "Xỉu";
        const recencyDistance = nowIndex - (i+L);
        const recencyWeight = 1 / (1 + Math.max(0, recencyDistance) * 0.12);
        const lengthBonus = 1 + (L-2) * 0.25;
        scores[label] += recencyWeight * lengthBonus;
      }
    }
    const evidence = scores["Tài"] + scores["Xỉu"];
    if(evidence >= 0.5) break;
  }
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

function algoSuperVIP(hist) {
  if(hist.length < 4) return { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: "SuperVIP (ít dữ liệu)" };
  const seq = hist.map(h=>h.ket_qua[0]).join("");
  const orders = [3,2,1];
  const probs = { "Tài": 0, "Xỉu": 0 };
  const weights = { 3: 0.5, 2: 0.3, 1: 0.2 };
  for(const k of orders){
    const context = seq.slice(-k);
    if(context.length < k) continue;
    let countT = 0, countX = 0, total = 0;
    for(let i=0;i+k<seq.length;i++){
      if(seq.slice(i,i+k) === context){
        const nxt = seq[i+k];
        if(nxt === "T") countT++; else countX++;
        total++;
      }
    }
    const alpha = 1;
    const pT = (countT + alpha) / (total + 2*alpha);
    const pX = (countX + alpha) / (total + 2*alpha);
    const evidenceStrength = Math.min(1, total / 12);
    const w = weights[k] * (0.3 + 0.7 * evidenceStrength);
    probs["Tài"] += pT * w;
    probs["Xỉu"] += pX * w;
  }
  const s = probs["Tài"] + probs["Xỉu"] || 1;
  probs["Tài"] /= s; probs["Xỉu"] /= s;
  const du_doan = probs["Tài"] >= probs["Xỉu"] ? "Tài":"Xỉu";
  const confidence = Math.max(0.01, Math.min(0.99, Math.abs(probs["Tài"] - probs["Xỉu"])));
  return { du_doan, name: "SuperVIP(StatMarkov)", probs, confidence };
}

// ---------------- Meta combine & predict (Hybrid+) ----------------
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

function hybridPlusPredict(hist){
  if(hist.length < MIN_HISTORY_FOR_AI) return null;

  const adaptive = computeAdaptiveWeights();
  const algos = [
    { fn: algoBalance, key: "balance" },
    { fn: algoStreak, key: "streak" },
    { fn: algoMomentum, key: "momentum" },
    { fn: algoPatternAdvanced, key: "pattern" },
    { fn: algoAntiBias, key: "antibias" },
    { fn: algoPatternUltra, key: "ultra" },
    { fn: algoSuperVIP, key: "supervip" },
    // new ones
    { fn: algoPatternDeep, key: "patterndeep" },
    { fn: algoAdaptiveTrend, key: "adaptivetrend" },
    { fn: algoMirrorPredict, key: "mirror" },
    { fn: algoReverseBias, key: "reversebias" },
    { fn: algoAutoLearn, key: "autolearn" }
  ];

  const voteScores = { "Tài":0, "Xỉu":0 };
  const details = [];

  for(const a of algos){
    let r;
    try { r = a.fn(hist); } catch(e) { r = { du_doan: Math.random()>0.5?"Tài":"Xỉu", name: a.key }; }
    const w = adaptive[a.key] || 0;
    voteScores[r.du_doan] += w;
    details.push({ name: r.name, pick: r.du_doan, w, info: r.evidence || r.probs || null, confEst: r.confidence || r.confidenceEst || 0 });
  }

  const taiScore = voteScores["Tài"], xiuScore = voteScores["Xỉu"];
  const total = taiScore + xiuScore || 1;
  const winner = taiScore >= xiuScore ? "Tài":"Xỉu";
  const margin = Math.abs(taiScore - xiuScore);
  const rawConfidence = margin / total;

  // boost if deep/supervip provided high confidence
  const deepDetail = details.find(d=>d.name && d.name.toLowerCase().includes("deep"));
  const superDetail = details.find(d=>d.name && d.name.toLowerCase().includes("supervip"));
  let boost = 0;
  if(deepDetail && deepDetail.confEst) boost += Math.min(0.25, deepDetail.confEst * 0.35);
  if(superDetail && superDetail.confidence) boost += Math.min(0.25, superDetail.confidence * 0.35);

  let confidence = Math.min(0.99, rawConfidence * 0.75 + 0.15 + boost);
  confidence = Math.max(0.01, Math.min(0.99, confidence));

  const summary = details.map(d=>`${d.name}:${d.w.toFixed(2)}->${d.pick}`).join(",");

  return { du_doan: winner, thuat_toan: `HybridPlus(${summary})`, confidence, details, scores: voteScores };
}

// ---------------- Learning: update EWMA per-algo + AutoLearn weight adapt ----------------
function updateAlgoStats(prevEntry){
  if(!prevEntry) return;
  const actual = prevEntry.ket_qua;
  const algosToCheck = {
    balance: algoBalance, streak: algoStreak, momentum: algoMomentum, pattern: algoPatternAdvanced, antibias: algoAntiBias,
    ultra: algoPatternUltra, supervip: algoSuperVIP,
    patterndeep: algoPatternDeep, adaptivetrend: algoAdaptiveTrend, mirror: algoMirrorPredict, reversebias: algoReverseBias, autolearn: algoAutoLearn
  };
  const priorHistory = data.history.slice(0, -1);

  const keyNameMap = {
    balance: ["cân","balance"], streak: ["streak","anti-streak"], momentum: ["xu hướng","momentum"],
    pattern: ["pattern v10","pattern"], antibias: ["anti-bias","anti-bias"],
    ultra: ["patternultra","pattern ultra","ultra"], supervip: ["supervip","markov"],
    patterndeep: ["patterndeep","patterndeep"], adaptivetrend: ["adaptivetrend","adaptive"], mirror: ["mirrorpredict","mirror"], reversebias: ["reversebias"], autolearn: ["autolearn"]
  };

  for(const key of Object.keys(algosToCheck)){
    const stat = data.algoStats[key];
    if(!stat) continue;
    let predicted;
    if(prevEntry.details && Array.isArray(prevEntry.details)){
      const candidates = keyNameMap[key] || [];
      const found = prevEntry.details.find(d => {
        const n = (d.name||"").toLowerCase();
        return candidates.some(c => n.includes((c||"").toLowerCase()));
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

  // AutoLearn: adjust baseWeights gently using algoStats performance
  // For each key, delta = (ewma - 0.5) -> apply small multiplier
  for(const k of Object.keys(data.baseWeights)){
    const perf = (data.algoStats[k] && data.algoStats[k].ewma) ? data.algoStats[k].ewma : 0.5;
    const delta = perf - 0.5;
    // gentle update
    data.baseWeights[k] = Math.max(0.01, data.baseWeights[k] * (1 + delta * AUTOLEARN_RATE));
  }
}

// ---------------- Fetch & Learn Loop ----------------
async function fetchAndLearn(){
  try {
    const res = await axios.get(API_URL, { timeout: 7000 });
    const d = res.data || {};

    // robust phien extraction
    const phien = safeParseInt(d.phien || d.Phiên || d.id || d.version || 0);
    if(!phien) { console.log(`[${now()}] ⚠️ fetch: không có phien trong response.`); return; }
    if(phien === data.lastPredicted) return;
    data.lastPredicted = phien;

    // parse dice robustly
    let xuc_xac = null;
    if(Array.isArray(d.xuc_xac)) xuc_xac = d.xuc_xac.map(v=>safeParseInt(v));
    else if(Array.isArray(d.Xúc_xắc)) xuc_xac = d["Xúc_xắc"].map(v=>safeParseInt(v));
    else if(d.xuc_xac_1 !== undefined) xuc_xac = [safeParseInt(d.xuc_xac_1), safeParseInt(d.xuc_xac_2), safeParseInt(d.xuc_xac_3)];
    else if(d.X1 !== undefined || d.x1 !== undefined) xuc_xac = [safeParseInt(d.X1||d.x1), safeParseInt(d.X2||d.x2), safeParseInt(d.X3||d.x3)];
    else if(d.dice && Array.isArray(d.dice)) xuc_xac = d.dice.map(v=>safeParseInt(v));
    else xuc_xac = [0,0,0];

    const tong = (xuc_xac || [0,0,0]).reduce((a,b)=>a+b,0);
    const ket_qua = (d.ket_qua || d.Kết_quả || d.result || "").toString().trim() || (tong>=11 ? "Tài" : "Xỉu");

    // build entry
    let entry = null;
    if(data.history.length < MIN_HISTORY_FOR_AI){
      const fb = fallbackByFormula(tong, xuc_xac);
      let confidence = (fb.note && fb.note.includes("100%")) ? 0.95 : (fb.note && fb.note.includes("mạnh")) ? 0.8 : 0.6;
      entry = {
        phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
        du_doan: fb.du_doan, thuat_toan: `Fallback(${fb.note||'rule'})`, confidence, details: null, timestamp: now()
      };
      data.history.push(entry);
      if(data.history.length > MAX_HISTORY) data.history.shift();
      data.stats.tong++; if(entry.du_doan === ket_qua) data.stats.dung++; else data.stats.sai++;
      updateAlgoStats(entry);
      save();
      console.log(`[${now()}] 🔁 Phiên ${phien} (fallback): KQ=${ket_qua} | Dự đoán=${entry.du_doan}`);
      return;
    }

    // hybrid+
    const meta = hybridPlusPredict(data.history);
    if(!meta){
      const fb = fallbackByFormula(tong, xuc_xac);
      entry = {
        phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
        du_doan: fb.du_doan, thuat_toan: `Fallback(${fb.note||'rule'})`, confidence: 0.5, details: null, timestamp: now()
      };
    } else {
      entry = {
        phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
        du_doan: meta.du_doan, thuat_toan: meta.thuat_toan, confidence: meta.confidence, details: meta.details, scores: meta.scores, timestamp: now()
      };
    }

    data.history.push(entry);
    if(data.history.length > MAX_HISTORY) data.history.shift();
    data.stats.tong++; if(entry.du_doan === ket_qua) data.stats.dung++; else data.stats.sai++;

    updateAlgoStats(entry);

    // optional: periodic message
    if(data.stats.tong > 0 && data.stats.tong % RESET_AFTER === 0){
      console.log(`♻️ [INFO] Đã chạy ${RESET_AFTER} phiên — cân nhắc reset / đánh giá.`);
    }

    save();
    console.log(`[${now()}] ✅ Phiên ${phien}: KQ=${ket_qua} | Dự đoán=${entry.du_doan} | Conf=${(entry.confidence*100).toFixed(0)}%`);
  } catch (err) {
    console.log(`[${now()}] ⚠️ Lỗi fetch API:`, err.message);
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
    Id: "@minhsangdangcap",
    timestamp: last.timestamp || null
  });
});

app.get("/history", (req, res) => {
  res.json({ count: data.history.length, history: data.history, stats: data.stats, algoStats: data.algoStats, baseWeights: data.baseWeights, meta: data.meta });
});

app.get("/stats", (req,res) => {
  const acc = data.stats.tong ? (data.stats.dung / data.stats.tong) : 0;
  // also include per-module ewma
  res.json({ totalRounds: data.stats.tong, wins: data.stats.dung, losses: data.stats.sai, accuracy: (acc*100).toFixed(2)+"%", algoStats: data.algoStats, baseWeights: data.baseWeights });
});

app.get("/clear", (req,res) => {
  data = {
    history: [], stats: { tong:0,dung:0,sai:0 },
    algoStats: {
      balance:{ewma:0.5,alpha:0.12}, streak:{ewma:0.5,alpha:0.12}, momentum:{ewma:0.5,alpha:0.12},
      pattern:{ewma:0.5,alpha:0.12}, antibias:{ewma:0.5,alpha:0.12}, ultra:{ewma:0.5,alpha:0.12}, supervip:{ewma:0.5,alpha:0.12},
      patterndeep:{ewma:0.5,alpha:0.12}, adaptivetrend:{ewma:0.5,alpha:0.12}, mirror:{ewma:0.5,alpha:0.12}, reversebias:{ewma:0.5,alpha:0.12}, autolearn:{ewma:0.5,alpha:0.12}
    },
    baseWeights: { 
      balance:1, streak:1, momentum:1, pattern:1, antibias:1, ultra:1.5, supervip:2.0,
      patterndeep:1.6, adaptivetrend:1.2, mirror:0.9, reversebias:1.0, autolearn:1.4
    },
    lastPredicted: 0,
    meta: { created: Date.now() }
  };
  save();
  res.json({ ok:true, message: "Đã reset toàn bộ data" });
});

// force fetch endpoint
app.get("/fetch-now", async (req, res) => {
  try {
    await fetchAndLearn();
    res.json({ ok: true, message: "Fetched now (check logs)", lastPredicted: data.lastPredicted });
  } catch(e){
    res.status(500).json({ ok:false, error: e.message });
  }
});

// endpoint export minimal CSV history (download)
app.get("/export-csv", (req, res) => {
  try{
    const rows = [["Phiên","Timestamp","Xúc_xắc","Tổng","Kết_quả","Dự_đoán","Confidence","Thuật_toán"]];
    for(const h of data.history){
      rows.push([h.phien, h.timestamp||"", JSON.stringify(h.xuc_xac||[]), h.tong_xuc_xac||"", h.ket_qua, h.du_doan, h.confidence||"", JSON.stringify(h.thuat_toan||"")]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    res.setHeader('Content-disposition', 'attachment; filename=history.csv');
    res.set('Content-Type', 'text/csv');
    res.send(csv);
  } catch(e){
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ---------------- Start loop & server ----------------
setInterval(fetchAndLearn, FETCH_INTERVAL_MS);
// call immediately once
fetchAndLearn().catch(e=>console.log("Initial fetch error:", e.message));

app.listen(PORT, () => {
  console.log(`🚀 BOTRUMSUNWIN HYBRID+ đang chạy tại http://localhost:${PORT}`);
  console.log(`   - API nguồn: ${API_URL}`);
  console.log(`   - Lưu data: ${DATA_FILE}`);
});
