// BOTRUMSUNWIN HYBRIDPLUS v13.2
// 2 API (Sunwin + History) + Pattern chuỗi + Tỷ lệ thắng
// By @minhsangdangcap (2025)

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();

const PORT = process.env.PORT || 3000;
const API_MAIN = "https://ongmattroiahiihikiet-production.up.railway.app/api/taixiu/sunwin";
const API_HISTORY = "https://ongmattroiahiihikiet-production.up.railway.app/api/taixiu/history";
const DATA_FILE = path.resolve(__dirname, "data.json");

const FETCH_INTERVAL_MS = 5000;
const MAX_HISTORY = 100;
const MIN_HISTORY_FOR_AI = 6;

let data = {
  history: [],
  stats: { tong: 0, dung: 0, sai: 0 },
  flow: { lastWins: 0, lastLosses: 0, lastPattern: null, lastPredictionCorrect: null }
};

// ========== Load/Save ==========
try {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch {
  console.log("⚠️ Không thể đọc data.json, tạo mới.");
}
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

const safeInt = (v) => (isNaN(parseInt(v)) ? 0 : parseInt(v));
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");

// ========== Fallback công thức Sunwin ==========
function fallbackByFormula(sum, dices) {
  const raw = dices.map(d => safeInt(d));
  const code = raw.join("");
  const sorted = [...raw].sort((a, b) => a - b).join("");

  if (sum <= 4) return { du_doan: "Xỉu", note: "Sum ≤ 4 → Xỉu mạnh" };
  if (sum >= 17) return { du_doan: "Tài", note: "Sum ≥ 17 → Tài mạnh" };
  if (sum === 7 && (code === "124" || sorted === "124")) return { du_doan: "Xỉu", note: "Sum=7 pattern 124 → Xỉu" };
  if (sum === 12 && (code === "246" || sorted === "246")) return { du_doan: "Xỉu", note: "Sum=12 pattern 246 → Xỉu" };
  if (sum === 10 || sum === 11) return { du_doan: "Tài", note: "Sum=10–11 → Tài nhẹ" };
  return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", note: "Fallback random" };
}

// ========== Pattern Detection ==========
function detectPattern(hist) {
  const seq = hist.map(h => h.ket_qua[0]).join("");
  const L = seq.length;
  if (L < 3) return { name: "Thiếu dữ liệu", confidence: 0.3, type: "none" };

  // Bệt
  for (let n = 6; n >= 3; n--) {
    if (L >= n && seq.slice(-n).split("").every(c => c === seq.slice(-1))) {
      return { name: `Bệt ${seq.endsWith("T") ? "Tài" : "Xỉu"}`, confidence: 0.7 + (n - 3) * 0.08, type: "bet" };
    }
  }

  // 1-1
  const last6 = seq.slice(-6);
  if (/^(TX){2,3}$/.test(last6) || /^(XT){2,3}$/.test(last6)) {
    return { name: "1-1 (Đảo liên tục)", confidence: 0.65, type: "alt" };
  }

  // 2-1
  if (L >= 6) {
    const p = seq.slice(-6);
    if (p[0] === p[1] && p[3] === p[4] && p[2] === p[5]) {
      return { name: `2-1 pattern (${p[0]}${p[0]}${p[2]})`, confidence: 0.68, type: "21" };
    }
  }

  // Nhấp nhả
  if (L >= 5 && seq.slice(-5).match(/TTXTX|XXTXT/)) {
    return { name: "Nhấp nhả", confidence: 0.55, type: "choppy" };
  }

  // Đảo nhẹ
  if (L >= 4) {
    const last3 = seq.slice(-3);
    if (last3[0] === last3[1] && last3[2] !== last3[1])
      return { name: "Đảo nhẹ", confidence: 0.58, type: "rev" };
  }

  return { name: "Không có pattern mạnh", confidence: 0.4, type: "none" };
}

// ========== SmartMarkov ==========
function smartMarkov(hist) {
  const seq = hist.map(h => h.ket_qua[0]).join("");
  const laplace = 1;
  let count = { T: 0, X: 0 };
  for (let i = 0; i < seq.length - 1; i++) seq[i + 1] === "T" ? count.T++ : count.X++;
  const pT = (count.T + laplace) / (seq.length + 2 * laplace);
  const pX = 1 - pT;
  return { "Tài": pT, "Xỉu": pX };
}

// ========== Quyết định ==========
function decide(hist) {
  const pattern = detectPattern(hist);
  const markov = smartMarkov(hist);
  const flow = data.flow;
  const last = hist[hist.length - 1].ket_qua;

  let pick = "Tài";
  let reason = "";
  let conf = 0.6;

  if (pattern.type === "bet") {
    pick = pattern.name.includes("Tài") ? "Tài" : "Xỉu";
    reason = `Bám cầu ${pattern.name}`;
    conf = pattern.confidence;
    if (flow.lastLosses >= 2) {
      pick = opposite(pick);
      reason += " → Đảo do gãy cầu";
      conf -= 0.1;
    }
  } else if (pattern.type === "alt") {
    pick = opposite(last);
    reason = "1-1 đảo liên tục → Đánh đảo";
    conf = 0.68;
  } else if (pattern.type === "21") {
    pick = pattern.name.includes("T") ? "Tài" : "Xỉu";
    reason = "2-1 → Giữ pattern 2-1";
    conf = 0.66;
  } else if (pattern.type === "choppy") {
    pick = markov["Tài"] > markov["Xỉu"] ? "Tài" : "Xỉu";
    reason = "Nhấp nhả → theo Markov";
    conf = 0.58;
  } else if (pattern.type === "rev") {
    pick = opposite(last);
    reason = "Đảo nhẹ → Đánh ngược";
    conf = 0.6;
  } else {
    pick = markov["Tài"] > markov["Xỉu"] ? "Tài" : "Xỉu";
    reason = "Không rõ pattern → Theo xác suất Markov";
    conf = Math.abs(markov["Tài"] - markov["Xỉu"]) + 0.35;
  }

  return { du_doan: pick, reason, confidence: conf, pattern };
}

// ========== Merge history from API ==========
function mergeHistory(apiData) {
  if (!Array.isArray(apiData)) return 0;
  const existing = new Set(data.history.map(h => h.phien));
  let added = 0;

  apiData.forEach(obj => {
    const phien = safeInt(obj.phien || obj.Phiên || obj.id);
    if (!phien || existing.has(phien)) return;
    const xuc_xac = [
      safeInt(obj.xuc_xac_1 || obj.X1),
      safeInt(obj.xuc_xac_2 || obj.X2),
      safeInt(obj.xuc_xac_3 || obj.X3)
    ];
    const tong = xuc_xac.reduce((a, b) => a + b, 0);
    const ket_qua = (obj.ket_qua || obj.Kết_quả || "").trim() || (tong >= 11 ? "Tài" : "Xỉu");
    data.history.push({ phien, ket_qua, xuc_xac, tong_xuc_xac: tong });
    added++;
    if (data.history.length > MAX_HISTORY) data.history.shift();
  });

  save();
  return added;
}

// ========== Fetch ==========
async function fetchAndPredict() {
  try {
    const mainRes = await axios.get(API_MAIN, { timeout: 4000 }).catch(() => null);
    if (!mainRes || !mainRes.data) {
      const histRes = await axios.get(API_HISTORY).catch(() => null);
      if (histRes && Array.isArray(histRes.data)) mergeHistory(histRes.data);
      return;
    }

    const d = mainRes.data;
    const phien = safeInt(d.phien || d.Phiên);
    if (!phien) return;
    const xuc_xac = [
      safeInt(d.xuc_xac_1 || d.X1),
      safeInt(d.xuc_xac_2 || d.X2),
      safeInt(d.xuc_xac_3 || d.X3)
    ];
    const tong = xuc_xac.reduce((a, b) => a + b, 0);
    const ket_qua = (d.ket_qua || d.Kết_quả || "").trim() || (tong >= 11 ? "Tài" : "Xỉu");

    if (data.history.length && data.history.at(-1).phien === phien) return;

    if (data.history.length < MIN_HISTORY_FOR_AI) {
      const fb = fallbackByFormula(tong, xuc_xac);
      data.history.push({
        phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
        du_doan: fb.du_doan, thuat_toan: `Fallback (${fb.note})`,
        confidence: 0.6, patternName: "Fallback"
      });
    } else {
      const { du_doan, reason, confidence, pattern } = decide(data.history);
      data.history.push({
        phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
        du_doan, thuat_toan: `HybridPlus v13.2 (${reason})`,
        confidence: Number(confidence.toFixed(2)), patternName: pattern.name
      });
    }

    if (data.history.length > MAX_HISTORY) data.history.shift();

    const last = data.history.at(-1);
    data.stats.tong++;
    if (last.du_doan === ket_qua) {
      data.stats.dung++; data.flow.lastWins++; data.flow.lastLosses = 0;
    } else {
      data.stats.sai++; data.flow.lastLosses++; data.flow.lastWins = 0;
    }
    data.flow.lastPattern = last.patternName;
    save();

    console.log(`✅ Phiên ${phien}: ${ket_qua} | Dự đoán=${last.du_doan} | Pattern=${last.patternName} | Conf=${(last.confidence * 100).toFixed(0)}%`);
  } catch (err) {
    console.log("⚠️ Lỗi fetch:", err.message);
  }
}

// ========== API JSON ==========
app.get("/sunwinapi", (req, res) => {
  if (!data.history.length) return res.json({ message: "Chưa có dữ liệu" });
  const last = data.history.at(-1);
  const acc = data.stats.tong ? ((data.stats.dung / data.stats.tong) * 100).toFixed(2) : 0;

  // Lấy pattern chuỗi 10 phiên gần nhất
  const patternSeq = data.history.slice(-10).map(h => h.ket_qua[0]).join("") || "";

  res.json({
    Phiên: last.phien,
    Kết_quả: last.ket_qua,
    Xúc_xắc: last.xuc_xac,
    Tổng_xúc_xắc: last.tong_xuc_xac,
    Cầu_hiện_tại: last.patternName || "Không rõ",
    Pattern_chuỗi: patternSeq,
    Dự_đoán: last.du_doan,
    Confidence: last.confidence,
    Thuật_toán: last.thuat_toan,
    Tỷ_lệ_thắng: `${acc}%`,
    Số_lần_dự_đoán: data.stats.tong,
    Số_đúng: data.stats.dung,
    Số_sai: data.stats.sai,
    Id: "@minhsangdangcap"
  });
});

app.get("/history", (req, res) => res.json(data.history));
app.get("/stats", (req, res) => res.json(data.stats));

setInterval(fetchAndPredict, FETCH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`🚀 HYBRIDPLUS v13.2 đang chạy tại cổng ${PORT}`);
  console.log(`   - API chính: ${API_MAIN}`);
  console.log(`   - API history: ${API_HISTORY}`);
});
