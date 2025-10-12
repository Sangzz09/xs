// BOTRUMSUNWIN HYBRIDPLUS v16
// - Single API (history newest-first)
// - Auto-init 5 phiên khi bật
// - Pattern Bết/1-1/2-1/nhấp nhả/đảo nhẹ
// - NEW: Momentum Trend AI + Pattern DeepLink (fake-bết detector)
// - Adaptive reset khi thua liên tiếp >= 3 (giữ 5 phiên)
// - Endpoint /forcefetch để import + predict ngay
// By @minhsangdangcap (v16)

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();

process.on("unhandledRejection", err => console.error("⚠️ unhandledRejection:", err && err.message ? err.message : err));
process.on("uncaughtException", err => console.error("⚠️ uncaughtException:", err && err.message ? err.message : err));

const PORT = process.env.PORT || 3000;
const API_HISTORY = "https://ongmattroiahiihikiet-production.up.railway.app/api/taixiu/history";
const DATA_FILE = path.resolve(__dirname, "data.json");

const FETCH_INTERVAL_MS = 5000;
const MAX_HISTORY = 400;
const MIN_HISTORY_FOR_AI = 6;
const RESET_THRESHOLD = 3;
const RESET_KEEP = 5;

let data = {
  history: [], // newest-first array of entries
  stats: { tong: 0, dung: 0, sai: 0 },
  flow: { lastWins: 0, lastLosses: 0, lastPattern: null, lastPredictionCorrect: null }
};

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
const safeInt = v => { const n = parseInt(v); return Number.isFinite(n) ? n : 0; };
const opposite = r => (r === "Tài" ? "Xỉu" : "Tài");

// ======== parse history item =========
function parseHistoryItem(item) {
  if (!item || typeof item !== "object") return null;
  const phien = safeInt(item.session || item.phien || item.Phiên || item.id);
  if (!phien) return null;
  const xuc_xac = Array.isArray(item.dice) ? item.dice.map(v => safeInt(v)) :
                   Array.isArray(item.xuc_xac) ? item.xuc_xac.map(v => safeInt(v)) :
                   [safeInt(item.x1), safeInt(item.x2), safeInt(item.x3)];
  const tong = safeInt(item.total || item.tong || xuc_xac.reduce((a,b)=>a+b,0));
  const ket_qua = (item.result || item.ket_qua || item.Kết_quả || "").toString().trim() || (tong >= 11 ? "Tài" : "Xỉu");
  return { phien, ket_qua, xuc_xac, tong_xuc_xac: tong };
}

// ======== build seq (newest-first) =========
function buildSeqFromLocal(limit = null) {
  if (!Array.isArray(data.history) || data.history.length === 0) return "";
  const arr = data.history.slice(0, limit || data.history.length);
  return arr.map(h => (h.ket_qua ? h.ket_qua[0] : "")).join("");
}
function buildSeqFromArray(arr, limit = null) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const take = arr.slice(0, limit || arr.length);
  return take.map(it => (it.result || it.ket_qua || "").toString().trim()[0] || "").join("");
}

// ======== pattern detectors (newest-first) =========
function detectPatternFromSeq(seq) {
  if (!seq || seq.length < 3) return { name: "Thiếu dữ liệu", confidence: 0.3, type: "none" };
  const L = seq.length;

  // Bệt: check head (newest-first) for runs of same char
  for (let n = Math.min(6, L); n >= 3; n--) {
    const head = seq.slice(0, n);
    if (head.split("").every(c => c === head[0])) return { name: `Bệt ${head[0]==='T'?'Tài':'Xỉu'}`, confidence: 0.7 + (n-3)*0.08, type: "bet", runLen: n };
  }

  // 1-1 alt in head 6
  const head6 = seq.slice(0,6);
  if (/^(TX){2,3}$/.test(head6) || /^(XT){2,3}$/.test(head6)) return { name: "1-1 (Đảo liên tục)", confidence: 0.65, type: "alt" };

  // 2-1
  if (L >= 6) {
    const p = seq.slice(0,6);
    if (p[0] === p[1] && p[3] === p[4] && p[2] === p[5]) return { name: `2-1 pattern (${p[0]}${p[0]}${p[2]})`, confidence: 0.68, type: "21" };
  }

  // nhấp nhả check head5
  if (L >= 5) {
    const h5 = seq.slice(0,5);
    if (/TTXTX|XXTXT/.test(h5)) return { name: "Nhấp nhả", confidence: 0.55, type: "choppy" };
  }

  // đảo nhẹ
  if (L >= 3) {
    const h3 = seq.slice(0,3);
    if (h3[0] === h3[1] && h3[2] !== h3[1]) return { name: "Đảo nhẹ", confidence: 0.58, type: "rev" };
  }

  return { name: "Không có pattern mạnh", confidence: 0.4, type: "none" };
}

// ======== NEW: Pattern DeepLink (fake-bệt detector) ========
// Detect "fake bệt": sequences where a short run (3) is often followed by immediate flip historically
// Approach: scan history (newest-first) for recent occurrences of runLen n followed by opposite within 1-2 steps; compute frequency.
function detectDeepLink(seq, localHistory) {
  // seq is newest-first. find head run length
  if (!seq || seq.length < 3) return { deep: false, reason: null, score: 0 };
  let runChar = seq[0];
  let runLen = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === runChar) runLen++; else break;
  }
  if (runLen < 3 || runLen > 5) return { deep: false, reason: null, score: 0 }; // target suspicious run of 3-5

  // analyze localHistory chronological behavior: count how often runLen followed by flip within 1 step
  // localHistory is newest-first array of entries
  let occurrences = 0, flips = 0;
  const seqAll = localHistory.map(h => (h.ket_qua ? h.ket_qua[0] : "")).join("");
  // iterate windows where runLen occurs in head of a window
  for (let i = 0; i + runLen < seqAll.length; i++) {
    const window = seqAll.slice(i, i + runLen);
    if (window.split("").every(c => c === runChar)) {
      occurrences++;
      const next = seqAll[i + runLen];
      if (next && next !== runChar) flips++;
    }
  }
  const score = occurrences ? flips / occurrences : 0;
  // if flips occur often (e.g., >60%) then treat as deep-link (fake-bệt)
  const deep = score >= 0.6 && occurrences >= 3;
  return { deep, reason: `runLen=${runLen}, flips/${occurrences}=${score.toFixed(2)}`, score };
}

// ======== NEW: Momentum Trend AI ========
// Weighted recent window: last 10 items, more weight to newest. compute weighted sum toward Tài/Xỉu
function momentumTrend(seq, window = 10) {
  if (!seq || seq.length === 0) return { Tài: 0.5, Xỉu: 0.5, score: 0 };
  const s = seq.slice(0, window).split("");
  let wTotal = 0, wT = 0, wX = 0;
  for (let i = 0; i < s.length; i++) {
    // weight decays with position (newest index 0 -> highest weight)
    const weight = (s.length - i) / s.length; // e.g., for len=10, weights 1.0,0.9,...0.1
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
  // seq newest-first
  const pattern = detectPatternFromSeq(seq);
  const markov = smartMarkovFromSeq(seq);
  const momentum = momentumTrend(seq, 10);
  const deepLink = detectDeepLink(seq, localHistory);

  // Priority:
  // 1) If deepLink detected => invert immediate (bẻ cầu) with moderate confidence
  // 2) Strong bệt but deepLink => invert
  // 3) Strong bệt without deepLink => bám cầu (unless recent losses)
  // 4) 1-1 => đảo
  // 5) 2-1 => follow cycle/markov
  // 6) Choppy => use momentum+markov combined
  // 7) else => use momentum trend if strong, else markov

  const lastLetter = seq && seq.length ? seq[0] : null;
  const lastResult = lastLetter === 'T' ? "Tài" : lastLetter === 'X' ? "Xỉu" : null;
  const flow = data.flow;

  // DeepLink high priority
  if (deepLink.deep) {
    const inverted = lastResult ? opposite(lastResult) : (momentum.score > 0 ? (momentum.score > 0 ? "Tài" : "Xỉu") : (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu"));
    return {
      du_doan: inverted,
      reason: `PatternDeepLink detected (${deepLink.reason}) → Đảo`,
      confidence: Math.min(0.88, 0.6 + deepLink.score * 0.4),
      details: { pattern, deepLink, momentum, markov }
    };
  }

  // If bệt detected
  if (pattern.type === "bet") {
    let pick = pattern.name.includes("Tài") ? "Tài" : "Xỉu";
    let conf = pattern.confidence;
    // check momentum: if momentum strongly contradicts bệt (momentum.score negative large) maybe lower confidence
    if ((momentum.score > 0.25 && pick === "Xỉu") || (momentum.score < -0.25 && pick === "Tài")) {
      conf -= 0.15; // reduce
    }
    // if recent losses, invert
    if (flow.lastLosses >= 2) {
      pick = opposite(pick);
      conf = Math.max(0.35, conf - 0.1);
      return { du_doan: pick, reason: `Bệt nhưng đảo do lastLosses=${flow.lastLosses}`, confidence: conf, details: { pattern, momentum, markov } };
    }
    return { du_doan: pick, reason: `Bám cầu ${pattern.name}`, confidence: conf, details: { pattern, momentum, markov } };
  }

  // 1-1
  if (pattern.type === "alt") {
    const pick = lastResult ? opposite(lastResult) : (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "1-1 (Alternating) => Đảo", confidence: 0.68, details: { pattern, momentum, markov } };
  }

  // 2-1
  if (pattern.type === "21") {
    const pick = markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu";
    return { du_doan: pick, reason: "2-1 => Theo chu kỳ/Markov", confidence: 0.66, details: { pattern, momentum, markov } };
  }

  // choppy: rely on combined momentum+markov
  if (pattern.type === "choppy") {
    // combine: weighted average momentum (0.6) + markov (0.4)
    const score = momentum.score * 0.6 + (markov.Tài - markov.Xỉu) * 0.4;
    const pick = score >= 0 ? "Tài" : "Xỉu";
    const conf = Math.min(0.9, 0.5 + Math.abs(score));
    return { du_doan: pick, reason: "Nhấp nhả => Momentum+Markov", confidence: conf, details: { pattern, momentum, markov } };
  }

  // rev: small inversion
  if (pattern.type === "rev") {
    const pick = lastResult ? opposite(lastResult) : (markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu");
    return { du_doan: pick, reason: "Đảo nhẹ => Đảo", confidence: 0.6, details: { pattern, momentum, markov } };
  }

  // default: use momentum if strong, else markov
  if (Math.abs(momentum.score) >= 0.18) { // threshold: momentum decisive
    const pick = momentum.score > 0 ? "Tài" : "Xỉu";
    const conf = Math.min(0.9, 0.5 + Math.abs(momentum.score));
    return { du_doan: pick, reason: `MomentumTrend decisive (${(momentum.score).toFixed(2)})`, confidence: conf, details: { pattern, momentum, markov } };
  }

  // fallback to markov
  const pick = markov.Tài >= markov.Xỉu ? "Tài" : "Xỉu";
  const conf = Math.min(0.9, Math.abs(markov.Tài - markov.Xỉu) + 0.35);
  return { du_doan: pick, reason: `Markov fallback (${Math.round(markov.Tài*100)}%)`, confidence: conf, details: { pattern, momentum, markov } };
}

// ======== mergeHistoryFromApiArray =========
function mergeHistoryFromApiArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  // arr newest-first
  const existing = new Set(data.history.map(h => h.phien));
  let added = 0;
  for (const it of arr) {
    const parsed = parseHistoryItem(it);
    if (!parsed) continue;
    if (existing.has(parsed.phien)) continue;
    // push newest-first => unshift
    data.history.unshift(parsed);
    existing.add(parsed.phien);
    added++;
    // keep newest-first up to MAX_HISTORY
    if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
  }
  // ensure newest-first sorted by phien descending
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
    if (Array.isArray(res.data)) return { ok: true, arr: res.data };
    if (res.data && Array.isArray(res.data.data)) return { ok: true, arr: res.data.data };
    try {
      const parsed = JSON.parse(res.data);
      if (Array.isArray(parsed)) return { ok: true, arr: parsed };
    } catch (e) {}
    return { ok: false, err: "Unexpected response format (not array)" };
  } catch (e) {
    return { ok: false, err: e.message || String(e) };
  }
}

// ======== main: import + predict once (used on loop + forcefetch) =========
async function importAndPredictOnce() {
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

    // merge arr into local (only new items)
    const added = mergeHistoryFromApiArray(arr);
    if (added) console.log(`ℹ️ Đã import ${added} new entries từ API_HISTORY`);

    // pick current = arr[0] (newest-first)
    const currentRaw = arr[0];
    const current = parseHistoryItem(currentRaw);
    if (!current) return { ok: false, err: "Không parse được item hiện tại" };

    // avoid duplicate (if already present as newest)
    const lastLocalPhien = data.history.length ? data.history[0].phien : null;
    if (lastLocalPhien === current.phien) {
      // but update current data if needed (e.g., replace with parsed full entry)
      // compute seq from local
      const seq = buildSeqFromLocal();
      // decide (still produce details)
      const decision = decideFromSeqAndLocal(seq, data.history);
      // update top entry with decision
      data.history[0].du_doan = decision.du_doan;
      data.history[0].thuat_toan = `HybridPlus v16 (${decision.reason})`;
      data.history[0].confidence = decision.confidence;
      data.history[0].patternName = decision.details && decision.details.pattern ? decision.details.pattern.name : data.history[0].patternName;
      save();
      return { ok: true, processed: false, reason: "Already up-to-date" };
    }

    // build seq (newest-first) from local history
    const seq = buildSeqFromLocal() || buildSeqFromArray(arr); // fallback to arr if local empty
    const decision = decideFromSeqAndLocal(seq, data.history);

    // create entry for current with decision
    const entry = {
      phien: current.phien,
      ket_qua: current.ket_qua,
      xuc_xac: current.xuc_xac,
      tong_xuc_xac: current.tong_xuc_xac,
      du_doan: decision.du_doan,
      thuat_toan: `HybridPlus v16 (${decision.reason})`,
      confidence: decision.confidence,
      patternName: decision.details && decision.details.pattern ? decision.details.pattern.name : null,
      details: decision.details || null
    };

    // remove duplicates & unshift (newest-first)
    data.history = data.history.filter(h => h.phien !== entry.phien);
    data.history.unshift(entry);
    if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);

    // update stats
    data.stats.tong++;
    if (entry.du_doan === entry.ket_qua) {
      data.stats.dung++; data.flow.lastWins = (data.flow.lastWins || 0) + 1; data.flow.lastLosses = 0; data.flow.lastPredictionCorrect = true;
    } else {
      data.stats.sai++; data.flow.lastLosses = (data.flow.lastLosses || 0) + 1; data.flow.lastWins = 0; data.flow.lastPredictionCorrect = false;
    }

    // Adaptive reset
    if (data.flow.lastLosses >= RESET_THRESHOLD) {
      console.log(`⚠️ Reset chuỗi pattern xuống ${RESET_KEEP} phiên (thua liên tiếp ${RESET_THRESHOLD})`);
      data.history = data.history.slice(0, RESET_KEEP);
      data.flow.lastLosses = 0;
    }

    data.flow.lastPattern = entry.patternName;
    save();
    console.log(`✅ Phiên ${entry.phien} processed: KQ=${entry.ket_qua} | Dự đoán=${entry.du_doan} | Pattern=${entry.patternName} | Conf=${Math.round(entry.confidence*100)}%`);
    return { ok: true, processed: true, phien: entry.phien };

  } catch (e) {
    console.error("⚠️ Lỗi importAndPredictOnce:", e && e.message ? e.message : e);
    return { ok: false, err: e.message || String(e) };
  }
}

// ======== Auto-init on start: import first 5 newest items =========
(async function autoInit() {
  try {
    console.log("⚙️ HYBRIDPLUS v16: Khởi tạo dữ liệu ban đầu (5 phiên)...");
    const res = await axios.get(API_HISTORY, { timeout: 7000 }).catch(() => null);
    if (res && res.data && Array.isArray(res.data) && res.data.length >= 1) {
      // take up to 5 newest items (arr[0] newest)
      const first5 = res.data.slice(0, 5);
      // convert -> local history (newest-first)
      data.history = first5.map(parseHistoryItem).filter(Boolean);
      // ensure newest-first sort
      data.history.sort((a,b) => b.phien - a.phien);
      if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
      save();
      console.log(`✅ Khởi tạo ${data.history.length} phiên đầu tiên từ API_HISTORY`);
      // perform immediate prediction cycle (process newest)
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
    const last = data.history[0]; // newest-first
    const seq10 = buildSeqFromLocal(10);
    const seq30 = buildSeqFromLocal(30);
    const acc = data.stats.tong ? ((data.stats.dung / data.stats.tong) * 100).toFixed(2) : "0.00";
    return res.json({
      Phiên: last.phien,
      Kết_quả: last.ket_qua,
      Xúc_xắc: last.xuc_xac,
      Tổng_xúc_xắc: last.tong_xuc_xac,
      Cầu_hiện_tại: last.patternName || "Không rõ",
      Pattern_chuỗi: seq10,
      Pattern_chuỗi_full: seq30,
      Dự_đoán: last.du_doan,
      Confidence: last.confidence,
      Thuật_toán: last.thuat_toan,
      Tỷ_lệ_thắng: `${acc}%`,
      Số_lần_dự_đoán: data.stats.tong,
      Số_đúng: data.stats.dung,
      Số_sai: data.stats.sai,
      Id: "@minhsangdangcap"
    });
  } catch (e) {
    console.error("⚠️ Lỗi /sunwinapi:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// forcefetch endpoint to manually import + predict immediately
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
app.listen(PORT, () => {
  console.log(`🚀 HYBRIDPLUS v16 running at http://localhost:${PORT}`);
  console.log(`   - Using history API: ${API_HISTORY}`);
  console.log(`   - Data file: ${DATA_FILE}`);
});
