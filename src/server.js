// index.js
// BOTRUMSUNWIN HYBRIDPLUS v16 (cleaned + safer runtime)
// By @minhsangdangcap (v16) - preserved algorithm logic

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

process.on("unhandledRejection", err => console.error("⚠️ unhandledRejection:", err && err.message ? err.message : err));
process.on("uncaughtException", err => console.error("⚠️ uncaughtException:", err && err.message ? err.message : err));

const PORT = process.env.PORT || 3000;
const API_HISTORY = process.env.API_HISTORY || "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.resolve(__dirname, "data.json");

const FETCH_INTERVAL_MS = parseInt(process.env.FETCH_INTERVAL_MS || "5000", 10);
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || "400", 10);
const MIN_HISTORY_FOR_AI = parseInt(process.env.MIN_HISTORY_FOR_AI || "6", 10);
const RESET_THRESHOLD = parseInt(process.env.RESET_THRESHOLD || "3", 10);
const RESET_KEEP = parseInt(process.env.RESET_KEEP || "5", 10);

let data = {
  history: [], // newest-first array of entries
  stats: { tong: 0, dung: 0, sai: 0 },
  flow: { lastWins: 0, lastLosses: 0, lastPattern: null, lastPredictionCorrect: null }
};

let isFetching = false; // prevent overlapping fetches

// ======== load/save =========
try {
  if (fs.existsSync(DATA_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (parsed && typeof parsed === "object") {
      data = Object.assign(data, parsed);
      data.history = Array.isArray(data.history) ? data.history : [];
    }
  }
} catch (e) {
  console.error("⚠️ Không đọc được data.json:", e.message);
}
function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("⚠️ Lỗi ghi data.json:", e.message);
  }
}

// ======== utils =========
const safeInt = v => {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
};
const opposite = r => (r === "Tài" ? "Xỉu" : "Tài");

// ======== parse history item =========
function parseHistoryItem(item) {
  if (!item || typeof item !== "object") return null;

  // New API format: {"id":"11347","phien":"2836255","xuc_xac_1":"6","xuc_xac_2":"6","xuc_xac_3":"2","tong":"14","ket_qua":"Tài"}
  const phien = safeInt(item.session || item.phien || item.Phiên || item.id);
  if (!phien) return null;

  // dice may appear in multiple shapes
  let xuc_xac = null;
  
  // Check for xuc_xac_1, xuc_xac_2, xuc_xac_3 format (new API)
  if (item.xuc_xac_1 !== undefined || item.xuc_xac_2 !== undefined || item.xuc_xac_3 !== undefined) {
    xuc_xac = [safeInt(item.xuc_xac_1), safeInt(item.xuc_xac_2), safeInt(item.xuc_xac_3)];
  } else if (Array.isArray(item.dice) && item.dice.length) {
    xuc_xac = item.dice.map(v => safeInt(v));
  } else if (Array.isArray(item.xuc_xac) && item.xuc_xac.length) {
    xuc_xac = item.xuc_xac.map(v => safeInt(v));
  } else if (Array.isArray(item.x1 ? [item.x1, item.x2, item.x3] : [])) {
    xuc_xac = [safeInt(item.x1), safeInt(item.x2), safeInt(item.x3)];
  } else if (Array.isArray(item.resultDice) && item.resultDice.length) {
    xuc_xac = item.resultDice.map(v => safeInt(v));
  }

  // if still null try to parse numeric fields
  if (!xuc_xac) {
    if (typeof item.dice === "string" && item.dice.includes(",")) {
      xuc_xac = item.dice.split(",").map(s => safeInt(s));
    }
  }

  const tong = safeInt(item.total || item.tong || (Array.isArray(xuc_xac) ? xuc_xac.reduce((a, b) => a + b, 0) : 0));
  let ket_qua = (item.result || item.ket_qua || item.Kết_quả || item.out || item.kq || "").toString().trim();
  if (!ket_qua) {
    ket_qua = (tong >= 11 ? "Tài" : "Xỉu");
  }
  // normalize to Vietnamese words Tài/Xỉu
  if (ket_qua[0] === 'T' || /^t/i.test(ket_qua)) ket_qua = "Tài";
  else if (ket_qua[0] === 'X' || /^x/i.test(ket_qua)) ket_qua = "Xỉu";
  else if (ket_qua[0] === '1' && tong >= 11) ket_qua = "Tài";

  return { phien, ket_qua, xuc_xac: xuc_xac || [], tong_xuc_xac: tong };
}

// ======== build seq (newest-first) =========
function buildSeqFromLocal(limit = null) {
  if (!Array.isArray(data.history) || data.history.length === 0) return "";
  const arr = data.history.slice(0, limit || data.history.length);
  return arr.map(h => (h.ket_qua ? (h.ket_qua[0] === 'T' || h.ket_qua[0] === 't' ? 'T' : 'X') : "")).join("");
}
function buildSeqFromArray(arr, limit = null) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const take = arr.slice(0, limit || arr.length);
  return take.map(it => {
    const raw = (it.result || it.ket_qua || it.Kết_quả || "").toString().trim();
    if (!raw) {
      // try total
      const t = safeInt(it.total || it.tong || 0);
      return t >= 11 ? 'T' : 'X';
    }
    return raw[0] === 'T' || raw[0] === 't' ? 'T' : 'X';
  }).join("");
}

// ======== pattern detectors (newest-first) =========
function detectPatternFromSeq(seq) {
  if (!seq || seq.length < 3) return { name: "Thiếu dữ liệu", confidence: 0.3, type: "none" };
  const L = seq.length;

  // Bệt: check head (newest-first) for runs of same char
  for (let n = Math.min(8, L); n >= 3; n--) {
    const head = seq.slice(0, n);
    if (head.split("").every(c => c === head[0])) return { name: `Bệt ${head[0]==='T'?'Tài':'Xỉu'} ${n} nháy`, confidence: 0.7 + (n-3)*0.08, type: "bet", runLen: n };
  }

  // Cầu 1-1 (đảo liên tục)
  const head6 = seq.slice(0,6);
  if (/^(TX){3,}$/.test(head6) || /^(XT){3,}$/.test(head6)) return { name: "1-1 (Đảo liên tục)", confidence: 0.72, type: "alt" };
  if (/^(TX){2}$/.test(head6.slice(0,4)) || /^(XT){2}$/.test(head6.slice(0,4))) return { name: "1-1 đảo", confidence: 0.65, type: "alt" };

  // Cầu 2-1
  if (L >= 6) {
    const p = seq.slice(0,6);
    if (p[0] === p[1] && p[3] === p[4] && p[2] === p[5]) return { name: `Cầu 2-1 (${p[0]}${p[0]}${p[2]})`, confidence: 0.68, type: "21" };
  }

  // Cầu 2-2
  if (L >= 4) {
    const p = seq.slice(0,4);
    if (p[0] === p[1] && p[2] === p[3] && p[0] !== p[2]) return { name: `Cầu 2-2 (${p[0]}${p[0]}${p[2]}${p[2]})`, confidence: 0.66, type: "22" };
  }

  // Cầu 3-1
  if (L >= 8) {
    const p = seq.slice(0,8);
    if (p[0] === p[1] && p[1] === p[2] && p[4] === p[5] && p[5] === p[6] && p[3] === p[7]) return { name: `Cầu 3-1 (${p[0]}${p[0]}${p[0]}${p[3]})`, confidence: 0.70, type: "31" };
  }

  // Cầu 3-2
  if (L >= 10) {
    const p = seq.slice(0,10);
    if (p[0]===p[1] && p[1]===p[2] && p[3]===p[4] && p[5]===p[6] && p[6]===p[7] && p[8]===p[9]) return { name: `Cầu 3-2 (${p[0]}${p[0]}${p[0]}${p[3]}${p[3]})`, confidence: 0.71, type: "32" };
  }

  // Cầu dọc (cùng loại liên tiếp ở vị trí cách đều)
  if (L >= 6) {
    const p = seq.slice(0,6);
    if (p[0] === p[2] && p[2] === p[4] && p[1] !== p[0]) return { name: `Cầu dọc ${p[0]==='T'?'Tài':'Xỉu'}`, confidence: 0.63, type: "vertical" };
  }

  // Cầu ngang (cùng loại nhưng ngắt quãng)
  if (L >= 5) {
    const p = seq.slice(0,5);
    if (p[0] === p[1] && p[3] === p[4] && p[0] === p[3] && p[2] !== p[0]) return { name: `Cầu ngang ${p[0]==='T'?'Tài':'Xỉu'}`, confidence: 0.61, type: "horizontal" };
  }

  // Nhấp nhả check head5
  if (L >= 5) {
    const h5 = seq.slice(0,5);
    if (/TTXTX|XXTXT|TXTXT|XTXTX/.test(h5)) return { name: "Nhấp nhả", confidence: 0.55, type: "choppy" };
  }

  // Đảo nhẹ
  if (L >= 3) {
    const h3 = seq.slice(0,3);
    if (h3[0] === h3[1] && h3[2] !== h3[1]) return { name: "Đảo nhẹ", confidence: 0.58, type: "rev" };
  }

  // Cầu xiên (zigzag pattern)
  if (L >= 7) {
    const p = seq.slice(0,7);
    if (p[0] !== p[1] && p[1] !== p[2] && p[2] !== p[3] && p[3] !== p[4]) return { name: "Cầu xiên (zigzag)", confidence: 0.59, type: "zigzag" };
  }

  return { name: "Không có pattern mạnh", confidence: 0.4, type: "none" };
}

// ======== NEW: Pattern DeepLink (fake-bệt detector) ========
function detectDeepLink(seq, localHistory) {
  if (!seq || seq.length < 3) return { deep: false, reason: null, score: 0 };
  let runChar = seq[0];
  let runLen = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === runChar) runLen++; else break;
  }
  if (runLen < 3 || runLen > 5) return { deep: false, reason: null, score: 0 };

  let occurrences = 0, flips = 0;
  const seqAll = (Array.isArray(localHistory) ? localHistory : []).map(h => (h.ket_qua ? (h.ket_qua[0] === 'T' ? 'T' : 'X') : "")).join("");
  for (let i = 0; i + runLen < seqAll.length; i++) {
    const window = seqAll.slice(i, i + runLen);
    if (window.split("").every(c => c === runChar)) {
      occurrences++;
      const next = seqAll[i + runLen];
      if (next && next !== runChar) flips++;
    }
  }
  const score = occurrences ? flips / occurrences : 0;
  const deep = score >= 0.6 && occurrences >= 3;
  return { deep, reason: `runLen=${runLen}, flips/${occurrences}=${score.toFixed(2)}`, score };
}

// ======== NEW: Formula-based prediction (from CÔNG THỨC SUNWIN) ========
function formulaBasedPredict(tong, xuc_xac) {
  // Xỉu cases
  if (tong === 3) return { du_doan: "Xỉu", confidence: 1.0, reason: "CT: Xỉu 3 → 100% Xỉu" };
  if (tong === 4) return { du_doan: "Xỉu", confidence: 0.68, reason: "CT: Xỉu 4 → 68% Xỉu" };
  if (tong === 5) return { du_doan: "Xỉu", confidence: 1.0, reason: "CT: Xỉu 5 → 100% Xỉu" };
  if (tong === 6) return { du_doan: "Skip", confidence: 0, reason: "CT: Xỉu 6 → Nghỉ (hay bịp)" };
  
  if (tong === 7) {
    const dice = xuc_xac.sort().join("");
    if (["124", "223", "133"].includes(dice)) {
      return { du_doan: "Xỉu", confidence: 0.89, reason: `CT: Xỉu 7 (${dice}) → 89% Xỉu` };
    }
    return { du_doan: "Tài", confidence: 0.7, reason: `CT: Xỉu 7 (${dice}) → Tài` };
  }
  
  if (tong === 8) {
    const dice = xuc_xac.sort().join("");
    if (dice === "134") {
      return { du_doan: "Xỉu", confidence: 1.0, reason: "CT: Xỉu 8 (134) → auto Xỉu" };
    }
    return { du_doan: "Tài", confidence: 0.8, reason: `CT: Xỉu 8 (${dice}) → Tài` };
  }
  
  if (tong === 9) {
    const dice = xuc_xac.sort().join("");
    if (dice === "234") {
      return { du_doan: "Xỉu", confidence: 0.75, reason: "CT: Xỉu 9 (234) → Xỉu" };
    }
    return { du_doan: "Tài", confidence: 0.5, reason: `CT: Xỉu 9 (${dice}) → 50/50 Tài` };
  }
  
  if (tong === 10) {
    return { du_doan: "Xỉu", confidence: 0.9, reason: "CT: Xỉu 10 → auto Xỉu (cẩn thận cầu 1-1)" };
  }
  
  // Tài cases
  if (tong === 11) return { du_doan: "Skip", confidence: 0, reason: "CT: Tài 11 → Nghỉ (Nát nhà)" };
  
  if (tong === 12) {
    const dice = xuc_xac.sort().join("");
    if (["246", "156", "336", "255"].includes(dice)) {
      return { du_doan: "Xỉu", confidence: 0.85, reason: `CT: Tài 12 (${dice}) → auto Xỉu` };
    }
    return { du_doan: "Tài", confidence: 0.7, reason: `CT: Tài 12 (${dice}) → Tài` };
  }
  
  if (tong === 13) {
    const dice = xuc_xac.sort().join("");
    if (["355", "166"].includes(dice)) {
      return { du_doan: "Xỉu", confidence: 0.85, reason: `CT: Tài 13 (${dice}) → auto Xỉu` };
    }
    if (["135", "136"].includes(dice)) {
      return { du_doan: "Tài", confidence: 0.7, reason: `CT: Tài 13 (${dice}) → Tài` };
    }
    return { du_doan: "Tài", confidence: 0.65, reason: `CT: Tài 13 (${dice}) → Tài` };
  }
  
  if (tong === 14) return { du_doan: "Tài", confidence: 0.5, reason: "CT: Tài 14 → 50/50" };
  if (tong === 15) return { du_doan: "Tài", confidence: 0.95, reason: "CT: Tài 15 → auto Tài" };
  if (tong === 16) return { du_doan: "Xỉu", confidence: 0.8, reason: "CT: Tài 16 → Xỉu" };
  if (tong === 17) return { du_doan: "Xỉu", confidence: 0.75, reason: "CT: Tài 17 → có thể bay xuống 10" };
  if (tong === 18) return { du_doan: "Tài", confidence: 0.9, reason: "CT: Tài 18 → Tài" };
  
  // Default
  return { du_doan: tong >= 11 ? "Tài" : "Xỉu", confidence: 0.5, reason: "CT: Mặc định theo tổng" };
}

// ======== NEW: Momentum Trend AI ========
function momentumTrend(seq, window = 10) {
  if (!seq || seq.length === 0) return { Tài: 0.5, Xỉu: 0.5, score: 0 };
  const s = seq.slice(0, window).split("");
  let wTotal = 0, wT = 0, wX = 0;
  for (let i = 0; i < s.length; i++) {
    const weight = (s.length - i) / s.length;
    wTotal += weight;
    if (s[i] === 'T') wT += weight; else if (s[i] === 'X') wX += weight;
  }
  const pT = (wT + 1e-9) / (wTotal + 1e-9);
  return { Tài: pT, Xỉu: 1 - pT, score: pT - (1 - pT) };
}

// ======== SmartMarkov (chronological conversion) =========
function smartMarkovFromSeq(seq) {
  if (!seq || seq.length < 2) return { Tài: 0.5, Xỉu: 0.5 };
  const chrono = seq.split("").reverse().join("");
  let countT = 0, countX = 0;
  for (let i = 1; i < chrono.length; i++) {
    if (chrono[i] === 'T') countT++; else if (chrono[i] === 'X') countX++;
  }
  const laplace = 1;
  const total = countT + countX;
  const pT = (countT + laplace) / (total + 2*laplace);
  return { Tài: pT, Xỉu: 1 - pT };
}

// ======== decision combining everything =========
function decideFromSeqAndLocal(seq, localHistory) {
  // kept logic identical to your original version
  const pattern = detectPatternFromSeq(seq);
  const markov = smartMarkovFromSeq(seq);
  const momentum = momentumTrend(seq, 10);
  const deepLink = detectDeepLink(seq, localHistory);

  const lastLetter = seq && seq.length ? seq[0] : null;
  const lastResult = lastLetter === 'T' ? "Tài" : lastLetter === 'X' ? "Xỉu" : null;
  const flow = data.flow;

  if (deepLink.deep) {
    const inverted = lastResult ? opposite(lastResult) : (momentum.score > 0 ? "Tài" : "Xỉu");
    return {
      du_doan: inverted,
      reason: `PatternDeepLink detected (${deepLink.reason}) → Đảo`,
      confidence: Math.min(0.88, 0.6 + deepLink.score * 0.4),
      details: { pattern, deepLink, momentum, markov }
    };
  }

  if (pattern.type === "bet") {
    let pick = pattern.name.includes("Tài") ? "Tài" : "Xỉu";
    let conf = pattern.confidence;
    if ((momentum.score > 0.25 && pick === "Xỉu") || (momentum.score < -0.25 && pick === "Tài")) {
      conf -= 0.15;
    }
    if (flow.lastLosses >= 2) {
      pick = opposite(pick);
      conf = Math.max(0.35, conf - 0.1);
      return { du_doan: pick, reason: `Bệt nhưng đảo do lastLosses=${flow.lastLosses}`, confidence: conf, details: { pattern, momentum, markov } };
    }
    return { du_doan: pick, reason: `Bám cầu ${pattern.name}`, confidence: conf, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "alt") {
    const pick = lastResult ? opposite(lastResult) : (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "1-1 (Alternating) => Đảo", confidence: 0.68, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "21") {
    const pick = markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu";
    return { du_doan: pick, reason: "Cầu 2-1 => Theo chu kỳ/Markov", confidence: 0.66, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "22") {
    const pick = lastResult ? opposite(lastResult) : (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "Cầu 2-2 => Đảo sau cặp đôi", confidence: 0.67, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "31") {
    const pick = markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu";
    return { du_doan: pick, reason: "Cầu 3-1 => Theo Markov", confidence: 0.69, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "32") {
    const pick = momentum.score > 0 ? "Tài" : "Xỉu";
    return { du_doan: pick, reason: "Cầu 3-2 => Theo Momentum", confidence: 0.70, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "vertical") {
    const pick = lastResult || (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "Cầu dọc => Bám cầu", confidence: 0.64, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "horizontal") {
    const pick = lastResult || (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "Cầu ngang => Bám cầu", confidence: 0.62, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "zigzag") {
    const pick = lastResult ? opposite(lastResult) : (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "Cầu xiên => Đảo", confidence: 0.60, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "choppy") {
    const score = momentum.score * 0.6 + (markov.Tài - markov.Xỉu) * 0.4;
    const pick = score >= 0 ? "Tài" : "Xỉu";
    const conf = Math.min(0.9, 0.5 + Math.abs(score));
    return { du_doan: pick, reason: "Nhấp nhả => Momentum+Markov", confidence: conf, details: { pattern, momentum, markov } };
  }

  if (pattern.type === "rev") {
    const pick = lastResult ? opposite(lastResult) : (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "Đảo nhẹ => Đảo", confidence: 0.6, details: { pattern, momentum, markov } };
  }

  if (Math.abs(momentum.score) >= 0.18) {
    const pick = momentum.score > 0 ? "Tài" : "Xỉu";
    const conf = Math.min(0.9, 0.5 + Math.abs(momentum.score));
    return { du_doan: pick, reason: `MomentumTrend decisive (${(momentum.score).toFixed(2)})`, confidence: conf, details: { pattern, momentum, markov } };
  }

  const pick = markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu";
  const conf = Math.min(0.9, Math.abs(markov.Tài - markov.Xỉu) + 0.35);
  return { du_doan: pick, reason: `Markov fallback (${Math.round(markov.Tài*100)}%)`, confidence: conf, details: { pattern, momentum, markov } };
}

// ======== mergeHistoryFromApiArray =========
function mergeHistoryFromApiArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const existing = new Set(data.history.map(h => h.phien));
  let added = 0;
  for (const it of arr) {
    const parsed = parseHistoryItem(it);
    if (!parsed) continue;
    if (existing.has(parsed.phien)) continue;
    data.history.unshift(parsed);
    existing.add(parsed.phien);
    added++;
    if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
  }
  data.history.sort((a,b) => b.phien - a.phien);
  if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
  if (added) save();
  return added;
}

// ======== fetch API history array =========
async function fetchHistoryApiArray() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 7000 });
    if (!res || !res.data) return { ok: false, err: "No data" };
    
    // New API returns single object, convert to array
    if (res.data && typeof res.data === "object" && !Array.isArray(res.data) && res.data.phien) {
      return { ok: true, arr: [res.data] };
    }
    
    if (Array.isArray(res.data)) return { ok: true, arr: res.data };
    if (res.data && Array.isArray(res.data.data)) return { ok: true, arr: res.data.data };
    
    // try string parse
    if (typeof res.data === "string") {
      try {
        const parsed = JSON.parse(res.data);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.phien) {
          return { ok: true, arr: [parsed] };
        }
        if (Array.isArray(parsed)) return { ok: true, arr: parsed };
      } catch (e) {}
    }
    return { ok: false, err: "Unexpected response format (not array)" };
  } catch (e) {
    return { ok: false, err: e.message || String(e) };
  }
}

// ======== main: import + predict once (used on loop + forcefetch) =========
async function importAndPredictOnce() {
  if (isFetching) return { ok: false, err: "busy" };
  isFetching = true;
  try {
    const histRes = await fetchHistoryApiArray();
    if (!histRes.ok) {
      console.log("⚠️ Lỗi gọi API history:", histRes.err);
      return { ok: false, err: histRes.err };
    }
    const arr = histRes.arr;
    if (!Array.isArray(arr) || arr.length === 0) {
      return { ok: false, err: "API trả về mảng rỗng" };
    }

    // API chỉ trả về 1 phiên mới nhất
    const currentRaw = arr[0];
    const current = parseHistoryItem(currentRaw);
    if (!current) return { ok: false, err: "Không parse được item hiện tại" };

    const lastLocalPhien = data.history.length ? data.history[0].phien : null;
    
    // Kiểm tra xem có dự đoán trước đó cho phiên này không
    const previousPrediction = data.history.find(h => h.phien === current.phien);
    
    if (lastLocalPhien === current.phien && previousPrediction && previousPrediction.du_doan) {
      // Phiên này đã có dự đoán, chỉ cần kiểm tra kết quả
      if (!previousPrediction.ket_qua || previousPrediction.ket_qua === "Chưa có") {
        // Cập nhật kết quả thực tế
        previousPrediction.ket_qua = current.ket_qua;
        previousPrediction.xuc_xac = current.xuc_xac;
        previousPrediction.tong_xuc_xac = current.tong_xuc_xac;
        
        // Cập nhật thống kê
        data.stats.tong++;
        if (previousPrediction.du_doan === current.ket_qua) {
          data.stats.dung++;
          data.flow.lastWins = (data.flow.lastWins || 0) + 1;
          data.flow.lastLosses = 0;
          data.flow.lastPredictionCorrect = true;
        } else {
          data.stats.sai++;
          data.flow.lastLosses = (data.flow.lastLosses || 0) + 1;
          data.flow.lastWins = 0;
          data.flow.lastPredictionCorrect = false;
        }
        
        save();
        console.log(`✅ Cập nhật kết quả phiên ${current.phien}: KQ=${current.ket_qua} | Dự đoán=${previousPrediction.du_doan} | ${previousPrediction.du_doan === current.ket_qua ? 'Đúng ✓' : 'Sai ✗'}`);
      }
      return { ok: true, processed: false, reason: "Already have prediction for this session" };
    }

    // Lưu phiên hiện tại với kết quả thực tế (nếu chưa có)
    let currentEntry = data.history.find(h => h.phien === current.phien);
    if (!currentEntry) {
      currentEntry = {
        phien: current.phien,
        ket_qua: current.ket_qua,
        xuc_xac: current.xuc_xac,
        tong_xuc_xac: current.tong_xuc_xac,
        du_doan: null,
        thuat_toan: null,
        confidence: null,
        patternName: null,
        details: null
      };
      data.history.unshift(currentEntry);
      if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
      console.log(`📝 Lưu phiên ${currentEntry.phien}: KQ=${currentEntry.ket_qua}, Tổng=${currentEntry.tong_xuc_xac}`);
    }

    // Tạo dự đoán cho phiên TIẾP THEO (chỉ nếu chưa có)
    const nextPhien = current.phien + 1;
    const existingNextPrediction = data.history.find(h => h.phien === nextPhien && h.du_doan);
    
    if (existingNextPrediction) {
      console.log(`⏭️ Phiên ${nextPhien} đã có dự đoán: ${existingNextPrediction.du_doan}`);
      return { ok: true, processed: false, reason: "Already have prediction for next session" };
    }

    // Lọc các phiên có kết quả thực tế để tính toán
    const completedHistory = data.history.filter(h => h.ket_qua && h.ket_qua !== "Chưa có");
    const seq = buildSeqFromArray(completedHistory);
    
    let nextDecision;
    
    // Nếu chưa đủ dữ liệu lịch sử (< 6 phiên), dùng công thức
    if (completedHistory.length < MIN_HISTORY_FOR_AI) {
      const formulaResult = formulaBasedPredict(current.tong_xuc_xac, current.xuc_xac);
      if (formulaResult.du_doan === "Skip") {
        console.log(`⏸️ Công thức khuyên nghỉ phiên ${nextPhien}: ${formulaResult.reason}`);
        return { ok: true, processed: false, reason: "Formula suggests skip" };
      }
      nextDecision = {
        du_doan: formulaResult.du_doan,
        reason: formulaResult.reason,
        confidence: formulaResult.confidence,
        details: { pattern: { name: "Công thức Sunwin", type: "formula" } }
      };
    } else {
      // Đủ dữ liệu thì dùng AI
      nextDecision = decideFromSeqAndLocal(seq, completedHistory);
    }

    // Lưu dự đoán cho phiên tiếp theo
    const nextEntry = {
      phien: nextPhien,
      ket_qua: "Chưa có",
      xuc_xac: [],
      tong_xuc_xac: 0,
      du_doan: nextDecision.du_doan,
      thuat_toan: `HybridPlus v16 (${nextDecision.reason})`,
      confidence: nextDecision.confidence,
      patternName: nextDecision.details && nextDecision.details.pattern ? nextDecision.details.pattern.name : null,
      details: nextDecision.details || null
    };

    // Thêm dự đoán phiên tiếp theo vào history
    data.history.unshift(nextEntry);
    if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);

    if (data.flow.lastLosses >= RESET_THRESHOLD) {
      console.log(`⚠️ Reset chuỗi pattern xuống ${RESET_KEEP} phiên (thua liên tiếp ${RESET_THRESHOLD})`);
      data.history = data.history.slice(0, RESET_KEEP);
      data.flow.lastLosses = 0;
    }

    data.flow.lastPattern = nextEntry.patternName;
    save();
    console.log(`🔮 Dự đoán phiên ${nextPhien}: ${nextDecision.du_doan} | Pattern=${nextEntry.patternName} | Conf=${Math.round(nextEntry.confidence*100)}%`);
    return { ok: true, processed: true, phien: current.phien };

  } catch (e) {
    console.error("⚠️ Lỗi importAndPredictOnce:", e && e.message ? e.message : e);
    return { ok: false, err: e.message || String(e) };
  } finally {
    isFetching = false;
  }
}

// ======== Auto-init on start: import first 5 newest items =========
(async function autoInit() {
  try {
    console.log("⚙️ HYBRIDPLUS v16: Khởi tạo dữ liệu ban đầu (5 phiên)...");
    const res = await axios.get(API_HISTORY, { timeout: 7000 }).catch(() => null);
    if (res && res.data && Array.isArray(res.data) && res.data.length >= 1) {
      const first5 = res.data.slice(0, 5);
      data.history = first5.map(parseHistoryItem).filter(Boolean);
      data.history.sort((a,b) => b.phien - a.phien);
      if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
      save();
      console.log(`✅ Khởi tạo ${data.history.length} phiên đầu tiên từ API_HISTORY`);
      await importAndPredictOnce();
    } else {
      console.log("⚠️ Không lấy được dữ liệu để khởi tạo (API trả về rỗng hoặc lỗi).");
    }
  } catch (e) {
    console.log("⚠️ Lỗi autoInit:", e.message || e);
  }
})();

// ======== auto loop ========
setInterval(() => {
  importAndPredictOnce().catch(e => console.error("⚠️ auto loop error:", e));
}, FETCH_INTERVAL_MS);

// ======== endpoints ========
app.get("/sunwinapi", (req, res) => {
  try {
    if (!Array.isArray(data.history) || data.history.length === 0) return res.json({ message: "Chưa có dữ liệu" });
    
    // Tìm phiên có dự đoán (phiên tiếp theo)
    const predicted = data.history.find(h => h.du_doan && h.du_doan !== "Chưa có");
    if (!predicted) return res.json({ message: "Chưa có dự đoán" });
    
    // Tìm phiên hiện tại (có kết quả thực tế)
    const current = data.history.find(h => h.ket_qua && h.ket_qua !== "Chưa có");
    
    // Tạo pattern sequence (lowercase t/x) từ các phiên đã có kết quả
    const completedHistory = data.history.filter(h => h.ket_qua && h.ket_qua !== "Chưa có");
    const patternSeq = completedHistory.slice(0, 10).map(h => (h.ket_qua[0] === 'T' ? 't' : 'x')).join("");
    
    return res.json({
      Phien: predicted.phien,
      Ket_qua: current ? current.ket_qua : "Đang chờ",
      Xuc_xac: current ? current.xuc_xac : [],
      Tong: current ? current.tong_xuc_xac : 0,
      Du_doan: predicted.du_doan,
      Pattern: patternSeq || "txtxttxtt",
      Thuat_toan: predicted.thuat_toan || "HybridPlus v16",
      Loai_cau: predicted.details?.pattern?.type || "none",
      So_lan_du_doan: data.stats.tong,
      So_dung: data.stats.dung,
      So_sai: data.stats.sai,
      Id: predicted.phien,
      Dev: "@minhsangdangcap"
    });
  } catch (e) {
    console.error("⚠️ Lỗi /sunwinapi:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/forcefetch", async (req, res) => {
  try {
    const out = await importAndPredictOnce();
    if (out.ok) return res.json({ ok: true, out });
    return res.status(500).json({ ok: false, err: out.err || "unknown" });
  } catch (e) {
    return res.status(500).json({ ok: false, err: e.message || String(e) });
  }
});

app.get("/history", (req, res) => res.json({ count: data.history.length, history: data.history }));
app.get("/stats", (req, res) => res.json(data.stats));
app.get("/clear", (req, res) => {
  data.history = []; data.stats = { tong:0,dung:0,sai:0 }; data.flow = { lastWins:0,lastLosses:0,lastPattern:null,lastPredictionCorrect:null };
  save();
  return res.json({ ok:true, message: "Đã reset local history & stats" });
});

// start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 HYBRIDPLUS v16 Enhanced running at http://0.0.0.0:${PORT}`);
  console.log(`   - Using history API: ${API_HISTORY}`);
  console.log(`   - Data file: ${DATA_FILE}`);
  console.log(`   - Enhanced with multiple Sunwin patterns`);
});
