// BOTRUMSUNWIN HYBRIDPLUS v21.5 — tích hợp “ĐA TẦNG LINH HOẠT V1”
// Dev: @minhsangdangcap — chạy ổn định trên Render
// Tự động lấy dữ liệu hackvn.xyz/apisun.php, phân tích pattern + AI linh hoạt đa tầng

const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const chalk = require("chalk");
const ThuatToanTaiXiu = require("./thuattoan.js"); // import module bạn gửi

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_SOURCE = "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.join(__dirname, "data.json");
const STATS_FILE = path.join(__dirname, "stats.json");

const FETCH_INTERVAL_MS = 10000;
const MAX_HISTORY = 400;

// === tiện ích ===
function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}
function now() {
  return new Date().toLocaleString("vi-VN");
}
function readJSON(f, d = {}) {
  try {
    if (!fs.existsSync(f)) return d;
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
}
function writeJSON(f, d) {
  fs.writeFileSync(f, JSON.stringify(d, null, 2), "utf8");
}

// === dữ liệu ===
let store = readJSON(DATA_FILE, { history: [], predictions: [] });
let stats = readJSON(STATS_FILE, { tong: 0, dung: 0, sai: 0, tile: 0, reset: 0 });

// === phân tích đơn giản (AI gốc) ===
function getSeq(h, limit = 20) {
  return h.slice(0, limit).map(x => (x.ket_qua[0] === "T" ? "T" : "X")).join("");
}
function analyze(seq) {
  if (!seq || seq.length < 4) return { type: "none", name: "Thiếu dữ liệu", score: 0.55 };
  if (/^(T){4,}/.test(seq)) return { type: "bet", name: "Bệt Tài", score: 0.75 };
  if (/^(X){4,}/.test(seq)) return { type: "bet", name: "Bệt Xỉu", score: 0.75 };
  if (/^(TX){3,}/.test(seq) || /^(XT){3,}/.test(seq)) return { type: "alt", name: "Cầu đảo 1-1", score: 0.68 };
  return { type: "none", name: "Ngẫu nhiên", score: 0.55 };
}
function aiHybrid(history) {
  const seq = getSeq(history, 20);
  const p = analyze(seq);
  const last10 = history.slice(0, 10);
  const tai = last10.filter(x => x.ket_qua === "Tài").length;
  const xiu = last10.length - tai;
  const momentum = (tai - xiu) / (last10.length || 1);
  let du_doan = p.type === "bet" ? (p.name.includes("Tài") ? "Tài" : "Xỉu") : momentum > 0 ? "Tài" : "Xỉu";
  let conf = p.score + Math.abs(momentum) * 0.1;
  return { du_doan, confidence: Math.min(0.95, conf), pattern: p };
}

// === lấy dữ liệu hackvn ===
async function fetchAPI() {
  try {
    const r = await axios.get(API_SOURCE, { timeout: 5000 });
    const d = Array.isArray(r.data) ? r.data[0] : r.data;
    const phien = safeInt(d.phien || d.id);
    const xuc_xac = [safeInt(d.xuc_xac_1), safeInt(d.xuc_xac_2), safeInt(d.xuc_xac_3)].filter(Boolean);
    const tong = safeInt(d.tong);
    const ket_qua = d.ket_qua?.trim() || (tong >= 11 ? "Tài" : "Xỉu");
    const item = { phien, ket_qua, tong, xuc_xac };
    if (!store.history.length || store.history[0].phien !== phien) {
      store.history.unshift(item);
      if (store.history.length > MAX_HISTORY) store.history = store.history.slice(0, MAX_HISTORY);
      writeJSON(DATA_FILE, store);
      console.log(chalk.green(`✅ Phiên ${phien}: ${ket_qua} (${tong})`));
    }
  } catch (e) {
    console.log("⚠️ API lỗi:", e.message);
  }
}

// === dự đoán (AI kép) ===
function dualAI(history) {
  const ai1 = aiHybrid(history);
  const ai2 = ThuatToanTaiXiu.predict
    ? ThuatToanTaiXiu.predict(history.map(h => h.ket_qua))
    : { ketqua: "Xỉu", score: 0.5, cau: "fallback" };

  // chọn thuật toán mạnh hơn
  const hybridScore = ai1.confidence;
  const linhhoatScore = ai2.score || 0.6;
  const useAI = linhhoatScore > hybridScore ? "LinhHoat" : "Hybrid";

  const final = useAI === "LinhHoat"
    ? { du_doan: ai2.ketqua || "Xỉu", confidence: linhhoatScore, thuat_toan: "ĐA TẦNG LINH HOẠT V1", loai_cau: ai2.cau }
    : { du_doan: ai1.du_doan, confidence: ai1.confidence, thuat_toan: "HybridPlus", loai_cau: ai1.pattern.name };

  return { ...final, used: useAI };
}

// === cập nhật và dự đoán ===
async function updateAndPredict() {
  await fetchAPI();
  if (store.history.length < 3) return;
  const current = store.history[0];
  const nextPhien = current.phien + 1;
  const pred = dualAI(store.history);
  const result = {
    phien: nextPhien,
    du_doan: pred.du_doan,
    confidence: pred.confidence,
    thuat_toan: pred.thuat_toan,
    loai_cau: pred.loai_cau,
    used: pred.used,
    time: now(),
    Dev: "@minhsangdangcap"
  };
  store.predictions.unshift(result);
  if (store.predictions.length > 200) store.predictions = store.predictions.slice(0, 200);
  writeJSON(DATA_FILE, store);
  console.log(chalk.cyan(`🔮 Phiên ${nextPhien}: ${pred.du_doan} (${Math.round(pred.confidence * 100)}%) | ${pred.thuat_toan}`));
}

// === auto loop ===
setInterval(updateAndPredict, FETCH_INTERVAL_MS);

// === API ===
app.get("/api/data", (req, res) => res.json(store));
app.get("/api/predict", (req, res) => res.json(store.predictions[0] || {}));
app.get("/api/stats", (req, res) => res.json(stats));
app.get("/api/update", async (req, res) => {
  await updateAndPredict();
  res.json(store.predictions[0] || {});
});

app.listen(PORT, () => {
  console.log(chalk.green(`🚀 HybridPlus v21.5 (AI kép) đang chạy tại cổng ${PORT}`));
  updateAndPredict();
});
