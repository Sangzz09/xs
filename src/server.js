// ==============================
// BOTRUMSUNWIN API VIP FULL A-Z
// ==============================
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_API = "https://hackvn.xyz/apisun.php";
const DATA_FILE = "./data.json";
const FULL_FILE = "./full_history.json";
const MAX_HISTORY = 20;

let history = [];
let fullHistory = [];

// 🔹 Load dữ liệu
function loadHistory() {
  try {
    if (fs.existsSync(DATA_FILE)) history = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (fs.existsSync(FULL_FILE)) fullHistory = JSON.parse(fs.readFileSync(FULL_FILE, "utf8"));
    console.log(`📂 Đã load ${history.length}/${fullHistory.length} phiên`);
  } catch (err) {
    console.error("❌ Lỗi load dữ liệu:", err.message);
  }
}

// 🔹 Lưu dữ liệu
function saveHistory() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
    fs.writeFileSync(FULL_FILE, JSON.stringify(fullHistory, null, 2));
  } catch (err) {
    console.error("❌ Lỗi save dữ liệu:", err.message);
  }
}

// 🔹 Tạo pattern t/x
function buildPattern(list) {
  return list.map(h => (h.result === "Tài" ? "t" : "x")).join("");
}

// 🔮 Thuật toán VIP + Rolling Probability + Adaptive Rebalance
function predictAdvanced(hist) {
  if (hist.length < 10) {
    return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "Random Base" };
  }

  const recent = hist.slice(-30);
  const last = recent[recent.length - 1];

  // --- Rolling Probability ---
  const rolling = { Tài: 0, Xỉu: 0 };
  for (let len = 2; len <= 5; len++) {
    if (recent.length < len) continue;
    const seq = recent.slice(-len).map(h => h.result).join("");
    const matches = [];
    for (let i = 0; i <= recent.length - len - 1; i++) {
      const sub = recent.slice(i, i + len).map(h => h.result).join("");
      if (sub === seq) matches.push(recent[i + len].result);
    }
    matches.forEach(r => rolling[r] += 1);
  }

  // --- Pattern matching ---
  const seq20 = recent.map(h => (h.result === "Tài" ? "t" : "x")).join("");
  const patterns = ["ttxxtx","xxttxt","ttxx","txtx","xxtt","tttt","xxxx"];
  let patternScore = 0;
  patterns.forEach(p => {
    if (seq20.endsWith(p)) patternScore += p.includes("t") ? 2 : -2;
  });

  // --- Bias cân bằng ---
  const taiCount = recent.filter(h => h.result === "Tài").length;
  let biasScore = 0;
  if (taiCount / recent.length > 0.65) biasScore -= 3;
  if ((recent.length - taiCount) / recent.length > 0.65) biasScore += 3;

  // --- Streak đảo hướng ---
  let streak = 1;
  for (let i = recent.length - 2; i >= 0; i--) {
    if (recent[i].result === recent[i + 1].result) streak++;
    else break;
  }
  const streakScore = streak >= 3 ? -2 : 1;

  // --- Momentum ---
  const trend = recent.map(r => (r.result === "Tài" ? 1 : -1)).reduce((a, b) => a + b, 0);
  const trendScore = trend > 5 ? 2 : trend < -5 ? -2 : 0;

  // --- Noise ---
  const noise = Math.sin(last.phien * 37.77) * 3;

  // --- Tổng hợp điểm ---
  let totalScore = rolling["Tài"] - rolling["Xỉu"];
  totalScore += patternScore + biasScore + streakScore + trendScore + noise;

  // --- Adaptive Rebalance ---
  if (hist.length >= 23) {
    const last3 = hist.slice(-3);
    const wrongCount = last3.filter(h => h.du_doan && h.du_doan !== h.result).length;
    if (wrongCount >= 2) return { du_doan: last.result === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Rebalance" };
  }

  const du_doan = totalScore >= 0 ? "Tài" : "Xỉu";
  const thuat_toan = `VIP + RollingProbability ${totalScore >= 0 ? "↑" : "↓"}`;
  return { du_doan, thuat_toan };
}

// 🔹 Tính tổng đúng/sai tích lũy
function calcStats() {
  let correct = 0, wrong = 0;
  fullHistory.forEach(h => {
    if (h.du_doan && h.result) {
      if (h.du_doan === h.result) correct++;
      else wrong++;
    }
  });
  return { correct, wrong, total_phien: fullHistory.length };
}

// 🔹 Fetch dữ liệu mỗi 5s
async function fetchOnceAndSave() {
  try {
    const res = await axios.get(SOURCE_API, { timeout: 4000 });
    const item = res.data;

    const phien = parseInt(item.phien);
    const x1 = parseInt(item.xuc_xac_1);
    const x2 = parseInt(item.xuc_xac_2);
    const x3 = parseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = item.ket_qua.trim() === "Tài" ? "Tài" : "Xỉu";

    if (!isNaN(phien) && tong >= 3 && tong <= 18) {
      if (!fullHistory.find(h => h.phien === phien)) {
        const { du_doan, thuat_toan } = predictAdvanced(history);

        const entry = {
          phien,
          result: ket_qua,
          xuc_xac: [x1, x2, x3],
          tong_xuc_xac: tong,
          du_doan,
          thuat_toan
        };

        fullHistory.push(entry);

        history.push(entry);
        while (history.length > MAX_HISTORY) history.shift();

        saveHistory();
        console.log(`✅ Phiên ${phien}: ${ket_qua} — Dự đoán: ${du_doan} — ${history.length}/20`);
      }
    }
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// 🔹 Endpoint chính
app.get("/sunwinapi", (req, res) => {
  const latest = history[history.length - 1] || {};
  const { du_doan, thuat_toan } = predictAdvanced(history);
  const stats = calcStats();

  if (latest.phien) latest.du_doan = du_doan;

  res.json({
    phien: latest.phien || 0,
    ket_qua: latest.result || "Đang cập nhật",
    xuc_xac: latest.xuc_xac || [0, 0, 0],
    tong_xuc_xac: latest.tong_xuc_xac || 0,
    du_doan,
    pattern: buildPattern(history),
    thuat_toan,
    total_phien: stats.total_phien,
    correct: stats.correct,
    wrong: stats.wrong,
    id: "@minhsangdangcap"
  });
});

// 🔹 Xem toàn bộ lịch sử
app.get("/fullhistory", (req, res) => {
  res.json({
    total: fullHistory.length,
    fullHistory
  });
});

// 🔹 Cập nhật mỗi 5s
setInterval(fetchOnceAndSave, 5000);

// 🔹 Khởi động server
app.listen(PORT, () => {
  loadHistory();
  console.log(`🚀 Botrumsunwin API VIP FULL đang chạy tại cổng ${PORT}`);
});
