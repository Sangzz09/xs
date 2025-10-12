// BOTRUMSUNWIN HYBRIDPLUS v13.4
// - API1 (current) cung cấp: Phiên, Kết quả, Xúc xắc, Thuật toán
// - API2 (history) cung cấp: mảng lịch sử để build pattern & học
// - Robust checks để tránh lỗi "reading 'map' of undefined"
// - Adaptive reset: nếu thua liên tiếp >= RESET_THRESHOLD -> giữ 5 phiên gần nhất
// - Trả JSON /sunwinapi có Pattern_chuỗi (10) + Pattern_chuỗi_full (30)
// By @minhsangdangcap (2025)

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();

process.on("unhandledRejection", err => console.error("⚠️ unhandledRejection:", err && err.message ? err.message : err));
process.on("uncaughtException", err => console.error("⚠️ uncaughtException:", err && err.message ? err.message : err));

const PORT = process.env.PORT || 3000;
// API1: current round (phiên hiện tại)
const API_MAIN = "https://ongmattroiahiihikiet-production.up.railway.app/api/taixiu/sunwin";
// API2: history array to build pattern
const API_HISTORY = "https://ongmattroiahiihikiet-production.up.railway.app/api/taixiu/history";

const DATA_FILE = path.resolve(__dirname, "data.json");
const FETCH_INTERVAL_MS = 5000;
const MAX_HISTORY = 200;
const MIN_HISTORY_FOR_AI = 6;
const RESET_THRESHOLD = 3; // thua liên tiếp -> reset pattern
const RESET_KEEP = 5; // giữ số phiên khi reset

// persistent store
let data = {
  history: [], // each entry: { phien, ket_qua, xuc_xac:[x1,x2,x3], tong_xuc_xac, du_doan, thuat_toan, confidence, patternName, details }
  stats: { tong: 0, dung: 0, sai: 0 },
  flow: { lastWins: 0, lastLosses: 0, lastPattern: null, lastPredictionCorrect: null }
};

// load data safely
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    data = Object.assign(data, JSON.parse(raw) || {});
    data.history = Array.isArray(data.history) ? data.history : [];
    data.stats = data.stats || { tong: 0, dung: 0, sai: 0 };
    data.flow = data.flow || { lastWins: 0, lastLosses: 0, lastPattern: null, lastPredictionCorrect: null };
  }
} catch (e) {
  console.error("⚠️ Không thể đọc data.json:", e.message);
}
function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("⚠️ Lỗi ghi data.json:", e.message);
  }
}

const safeInt = (v) => {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
};
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");

// -------------------- Helpers & Parsers --------------------
function parseCurrentApi(obj) {
  // parse API_MAIN's response expected to contain current round
  // try many possible field names
  if (!obj) return null;
  const phien = safeInt(obj.phien || obj.Phiên || obj.id || obj.phien_id);
  // xuc_xac can be array or 3 separate fields
  let xuc_xac = null;
  if (Array.isArray(obj.xuc_xac)) xuc_xac = obj.xuc_xac.map(v => safeInt(v));
  else if (Array.isArray(obj["Xúc_xắc"])) xuc_xac = obj["Xúc_xắc"].map(v => safeInt(v));
  else if (obj.xuc_xac_1 !== undefined) xuc_xac = [safeInt(obj.xuc_xac_1), safeInt(obj.xuc_xac_2), safeInt(obj.xuc_xac_3)];
  else if (obj.X1 !== undefined) xuc_xac = [safeInt(obj.X1), safeInt(obj.X2), safeInt(obj.X3)];
  // ket_qua
  const ket_qua_raw = (obj.ket_qua || obj.Kết_quả || obj.result || "").toString().trim();
  const ket_qua = ket_qua_raw || (xuc_xac ? (xuc_xac.reduce((a,b)=>a+b,0) >= 11 ? "Tài" : "Xỉu") : null);
  const thuat_toan = (obj.thuat_toan || obj.Thuật_toán || obj.algorithm || "").toString().trim();
  if (!phien) return null;
  return { phien, xuc_xac: xuc_xac || [0,0,0], tong: xuc_xac ? xuc_xac.reduce((a,b)=>a+b,0) : 0, ket_qua, thuat_toan };
}

function parseHistoryItem(obj) {
  // parse one history item from API_HISTORY
  if (!obj) return null;
  const phien = safeInt(obj.phien || obj.Phiên || obj.id || obj.phien_id);
  let xuc_xac = null;
  if (Array.isArray(obj.xuc_xac)) xuc_xac = obj.xuc_xac.map(v => safeInt(v));
  else if (obj.xuc_xac_1 !== undefined) xuc_xac = [safeInt(obj.xuc_xac_1), safeInt(obj.xuc_xac_2), safeInt(obj.xuc_xac_3)];
  else if (obj.X1 !== undefined) xuc_xac = [safeInt(obj.X1), safeInt(obj.X2), safeInt(obj.X3)];
  const tong = xuc_xac ? xuc_xac.reduce((a,b)=>a+b,0) : (safeInt(obj.tong) || 0);
  const ket_qua_raw = (obj.ket_qua || obj.Kết_quả || obj.result || "").toString().trim();
  const ket_qua = ket_qua_raw || (tong ? (tong >= 11 ? "Tài" : "Xỉu") : null);
  if (!phien) return null;
  return { phien, xuc_xac: xuc_xac || [0,0,0], tong, ket_qua };
}

// -------------------- Merge history from API2 --------------------
function mergeHistoryArray(arr) {
  if (!Array.isArray(arr)) return 0;
  const existing = new Set(data.history.map(h => h.phien));
  let added = 0;
  // sort ascending by phien if possible
  const sorted = arr.slice().sort((a,b) => {
    const pa = safeInt(a.phien || a.Phiên || a.id || a.phien_id);
    const pb = safeInt(b.phien || b.Phiên || b.id || b.phien_id);
    return pa - pb;
  });
  for (const item of sorted) {
    const parsed = parseHistoryItem(item);
    if (!parsed) continue;
    if (existing.has(parsed.phien)) continue;
    data.history.push({
      phien: parsed.phien,
      ket_qua: parsed.ket_qua || (parsed.tong >= 11 ? "Tài" : "Xỉu"),
      xuc_xac: parsed.xuc_xac,
      tong_xuc_xac: parsed.tong,
      du_doan: null, thuat_toan: "imported", confidence: 0, patternName: null, details: null
    });
    existing.add(parsed.phien);
    added++;
    if (data.history.length > MAX_HISTORY) data.history.shift();
  }
  if (added) save();
  return added;
}

// -------------------- Pattern detection (robust) --------------------
function buildSeq(hist) {
  if (!Array.isArray(hist) || hist.length === 0) return "";
  return hist.map(h => ((h && h.ket_qua) ? (h.ket_qua[0] || "") : "")).join("");
}
function detectPattern(hist) {
  if (!Array.isArray(hist) || hist.length === 0) return { name: "Không có dữ liệu", confidence: 0.3, type: "none" };
  const seq = buildSeq(hist);
  if (!seq || seq.length < 3) return { name: "Thiếu dữ liệu", confidence: 0.3, type: "none" };
  const L = seq.length;
  // bệt
  for (let n = 6; n >= 3; n--) {
    if (L >= n && seq.slice(-n).split("").every(c => c === seq.slice(-1))) {
      return { name: `Bệt ${seq.slice(-1)==='T' ? 'Tài' : 'Xỉu'}`, confidence: 0.7 + (n-3)*0.08, type: "bet" };
    }
  }
  // 1-1 alt
  const last6 = seq.slice(-6);
  if (/^(TX){2,3}$/.test(last6) || /^(XT){2,3}$/.test(last6)) return { name: "1-1 (Đảo liên tục)", confidence: 0.65, type: "alt" };
  // 2-1
  if (L >= 6) {
    const p = seq.slice(-6);
    if (p[0] === p[1] && p[3] === p[4] && p[2] === p[5]) return { name: `2-1 pattern (${p[0]}${p[0]}${p[2]})`, confidence: 0.68, type: "21" };
  }
  // nhấp nhả
  if (L >= 5 && /TTXTX|XXTXT/.test(seq.slice(-5))) return { name: "Nhấp nhả", confidence: 0.55, type: "choppy" };
  // đảo nhẹ
  if (L >= 4) {
    const last3 = seq.slice(-3);
    if (last3[0] === last3[1] && last3[2] !== last3[1]) return { name: "Đảo nhẹ", confidence: 0.58, type: "rev" };
  }
  return { name: "Không có pattern mạnh", confidence: 0.4, type: "none" };
}

// -------------------- SmartMarkov (simple) --------------------
function smartMarkov(hist) {
  const seq = buildSeq(hist);
  if (!seq || seq.length < 2) return { "Tài": 0.5, "Xỉu": 0.5 };
  let countT = 0, countX = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === 'T') countT++; else if (seq[i] === 'X') countX++;
  }
  const laplace = 1;
  const total = countT + countX;
  const pT = (countT + laplace) / (total + 2 * laplace);
  return { "Tài": pT, "Xỉu": 1 - pT };
}

// -------------------- Decision --------------------
function decide(hist) {
  const pattern = detectPattern(hist);
  const markov = smartMarkov(hist);
  const flow = data.flow;
  const last = Array.isArray(hist) && hist.length ? hist[hist.length-1].ket_qua : null;
  let pick = "Tài", reason = "Default", conf = 0.5;

  if (pattern.type === "bet") {
    pick = pattern.name.includes("Tài") ? "Tài" : "Xỉu";
    reason = `Bám cầu ${pattern.name}`;
    conf = pattern.confidence;
    if (flow.lastLosses >= 2) {
      // invert if many losses
      pick = opposite(pick);
      reason += " | Đảo do mất chuỗi";
      conf = Math.max(0.35, conf - 0.12);
    }
  } else if (pattern.type === "alt") {
    pick = last ? opposite(last) : (markov["Tài"] >= markov["Xỉu"] ? "Tài" : "Xỉu");
    reason = "1-1 (Đảo) => Đảo";
    conf = 0.68;
  } else if (pattern.type === "21") {
    // try infer cycle else markov
    pick = markov["Tài"] >= markov["Xỉu"] ? "Tài" : "Xỉu";
    reason = "2-1 detected => follow cycle/markov";
    conf = 0.66;
  } else if (pattern.type === "choppy") {
    pick = markov["Tài"] > markov["Xỉu"] ? "Tài" : "Xỉu";
    reason = "Nhấp nhả => Markov";
    conf = 0.58;
  } else if (pattern.type === "rev") {
    pick = last ? opposite(last) : (markov["Tài"] >= markov["Xỉu"] ? "Tài" : "Xỉu");
    reason = "Đảo nhẹ => Đảo";
    conf = 0.6;
  } else {
    pick = markov["Tài"] >= markov["Xỉu"] ? "Tài" : "Xỉu";
    reason = `No strong pattern => Markov ${Math.round(markov["Tài"]*100)}%`;
    conf = Math.min(0.9, Math.abs(markov["Tài"] - markov["Xỉu"]) + 0.35);
  }

  return { du_doan: pick, reason, confidence: Number(conf.toFixed(3)), pattern, markov };
}

// -------------------- Fetching logic (API1 current, API2 history) --------------------
async function fetchCurrentFromMain() {
  try {
    const res = await axios.get(API_MAIN, { timeout: 4000 });
    if (res && res.data) {
      const parsed = parseCurrentApi(res.data);
      if (parsed) return { ok: true, parsed, raw: res.data, source: "main" };
    }
    return { ok: false, err: "No usable data from API_MAIN" };
  } catch (e) {
    return { ok: false, err: e.message || String(e) };
  }
}
async function fetchHistoryArray() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 6000 });
    if (res && res.data && Array.isArray(res.data)) return { ok: true, arr: res.data };
    // some APIs wrap data under .data or .result
    if (res && res.data && Array.isArray(res.data.data)) return { ok: true, arr: res.data.data };
    return { ok: false, err: "History response not array" };
  } catch (e) {
    return { ok: false, err: e.message || String(e) };
  }
}

// -------------------- Main loop --------------------
async function fetchAndPredict() {
  try {
    // 1) Ensure we have history - if not enough, try to import from API_HISTORY
    if (!Array.isArray(data.history) || data.history.length < MIN_HISTORY_FOR_AI) {
      const histRes = await fetchHistoryArray();
      if (histRes.ok) {
        const added = mergeHistoryArray(histRes.arr);
        if (added > 0) console.log(`ℹ️ Đã import ${added} history items từ API_HISTORY`);
      } else {
        // ignore if history API fails; we'll still try main
        console.log("⚠️ Không lấy được history từ API_HISTORY:", histRes.err);
      }
    }

    // 2) Get current round from API_MAIN (preferred)
    let current = null;
    let source = "main";
    const mainRes = await fetchCurrentFromMain();
    if (mainRes.ok) {
      current = mainRes.parsed;
      source = mainRes.source;
    } else {
      // fallback to latest element from API_HISTORY if available
      const histRes = await fetchHistoryArray();
      if (histRes.ok && histRes.arr.length) {
        // take last item
        const lastRaw = histRes.arr[histRes.arr.length - 1];
        const parsed = parseHistoryItem(lastRaw);
        if (parsed) {
          current = { phien: parsed.phien, xuc_xac: parsed.xuc_xac, tong: parsed.tong, ket_qua: parsed.ket_qua, thuat_toan: "from_history_fallback" };
          source = "history_fallback";
        }
      }
      if (!current) {
        console.log("⚠️ Không lấy được phiên hiện tại từ API_MAIN hoặc API_HISTORY.");
        return;
      }
    }

    // 3) If this phien is same as last, skip
    const lastPhien = data.history.length ? data.history[data.history.length-1].phien : null;
    if (current.phien && lastPhien === current.phien) {
      // still might update thuat_toan if main provided algorithm though we previously imported from history
      // Update last entry's thuat_toan if main provided different
      if (source === "main" && data.history.length) {
        const lastEntry = data.history[data.history.length-1];
        if (current.thuat_toan && lastEntry.thuat_toan !== current.thuat_toan) {
          lastEntry.thuat_toan = current.thuat_toan;
          save();
        }
      }
      return;
    }

    // 4) Now produce prediction
    let entry = null;
    const xuc_xac = Array.isArray(current.xuc_xac) ? current.xuc_xac : [safeInt(current.xuc_xac?.[0]||0), safeInt(current.xuc_xac?.[1]||0), safeInt(current.xuc_xac?.[2]||0)];
    const tong = current.tong || xuc_xac.reduce((a,b)=>a+b,0);
    const ket_qua = current.ket_qua || (tong >= 11 ? "Tài" : "Xỉu");

    if (!Array.isArray(data.history) || data.history.length < MIN_HISTORY_FOR_AI) {
      // fallback by formula
      const fb = fallbackByFormula(tong, xuc_xac);
      entry = {
        phien: current.phien,
        ket_qua,
        xuc_xac,
        tong_xuc_xac: tong,
        du_doan: fb.du_doan,
        thuat_toan: `Fallback (${fb.note})`,
        confidence: fb.note && fb.note.includes("strong") ? 0.9 : 0.6,
        patternName: "Fallback",
        details: null
      };
    } else {
      const decision = decide(data.history);
      entry = {
        phien: current.phien,
        ket_qua,
        xuc_xac,
        tong_xuc_xac: tong,
        du_doan: decision.du_doan,
        thuat_toan: `HybridPlus v13.4 (${decision.reason})`,
        confidence: decision.confidence,
        patternName: decision.pattern ? decision.pattern.name : "None",
        details: { pattern: decision.pattern || null, markov: decision.markov || null }
      };
    }

    // push to history and update stats
    data.history.push(entry);
    if (data.history.length > MAX_HISTORY) data.history.shift();

    data.stats.tong++;
    if (entry.du_doan === ket_qua) {
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

    // adaptive reset if too many consecutive losses
    if (data.flow.lastLosses >= RESET_THRESHOLD) {
      console.log(`⚠️ Reset chuỗi pattern xuống ${RESET_KEEP} phiên (do thua liên tiếp ${RESET_THRESHOLD})`);
      data.history = data.history.slice(-RESET_KEEP);
      // note: keep stats (tong/dung/sai) as requested
      data.flow.lastLosses = 0; // reset loss counter after trimming
    }

    data.flow.lastPattern = entry.patternName;
    save();

    console.log(`✅ Phiên ${entry.phien} processed (source=${source}): KQ=${ket_qua} | Dự đoán=${entry.du_doan} | Pattern=${entry.patternName} | Conf=${(entry.confidence*100).toFixed(0)}%`);

  } catch (err) {
    console.error("⚠️ Lỗi fetchAndPredict:", err && err.message ? err.message : err);
  }
}

// -------------------- API endpoints --------------------
app.get("/sunwinapi", (req, res) => {
  try {
    if (!Array.isArray(data.history) || data.history.length === 0) return res.json({ message: "Chưa có dữ liệu" });
    const last = data.history[data.history.length - 1];
    const acc = data.stats.tong ? ((data.stats.dung / data.stats.tong) * 100).toFixed(2) : "0.00";
    const patternSeq = data.history.slice(-10).map(h => (h.ket_qua||"")[0]||"").join("");
    const patternFull = data.history.slice(-30).map(h => (h.ket_qua||"")[0]||"").join("");

    return res.json({
      Phiên: last.phien,
      Kết_quả: last.ket_qua,
      Xúc_xắc: last.xuc_xac,
      Tổng_xúc_xắc: last.tong_xuc_xac,
      Cầu_hiện_tại: last.patternName || "Không rõ",
      Pattern_chuỗi: patternSeq,
      Pattern_chuỗi_full: patternFull,
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

app.get("/history", (req, res) => res.json({ count: data.history.length, history: data.history }));
app.get("/stats", (req, res) => res.json(data.stats));
app.get("/clear", (req, res) => {
  data.history = []; data.stats = { tong:0,dung:0,sai:0 }; data.flow = { lastWins:0,lastLosses:0,lastPattern:null,lastPredictionCorrect:null };
  save();
  res.json({ ok: true, message: "Đã reset local history (stats cleared)" });
});

// start loop
setInterval(fetchAndPredict, FETCH_INTERVAL_MS);

// start server
app.listen(PORT, () => {
  console.log(`🚀 HYBRIDPLUS v13.4 đang chạy tại http://localhost:${PORT}`);
  console.log(`   - API_MAIN (current): ${API_MAIN}`);
  console.log(`   - API_HISTORY (history): ${API_HISTORY}`);
  console.log(`   - Lưu data file: ${DATA_FILE}`);
});
