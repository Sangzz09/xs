// ✅ BOTRUMSUNWIN HYBRID AI PRO v9 (Advanced Pattern + Normalize Weights)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ Config
const SOURCE_API = "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.resolve(__dirname, "data.json");
const MAX_HISTORY = 30;
const RESET_AFTER = 30;

let history = [];
let stats = { tong: 0, dung: 0, sai: 0 };
let weights = { balance: 1, streak: 1, momentum: 1, pattern: 1 };
let lastPredicted = 0;

// ========== Helper Functions ==========
function safeParseInt(v) {
  const n = parseInt(v);
  return isNaN(n) ? 0 : n;
}
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      history = data.history || [];
      stats = data.stats || stats;
      weights = data.weights || weights;
    }
  } catch {}
}
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ history, stats, weights }, null, 2), "utf8");
}

// 🔧 Chuẩn hóa trọng số (Normalize)
function normalizeWeights() {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total === 0) return;
  for (let key in weights) {
    weights[key] = (weights[key] / total) * 4; // luôn tổng ~4 để cân bằng
  }
}

// ========== AI Sub-algorithms ==========
function algoBalance(hist) {
  const tai = hist.filter(h => h.ket_qua === "Tài").length;
  const xiu = hist.length - tai;
  return { du_doan: tai > xiu ? "Xỉu" : "Tài", name: "Cân bằng" };
}

function algoStreak(hist) {
  const last3 = hist.slice(-3).map(h => h.ket_qua);
  if (last3.length === 3 && last3.every(v => v === last3[0]))
    return { du_doan: opposite(last3[0]), name: "Đảo chuỗi 3" };
  return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", name: "Ngẫu nhiên chuỗi" };
}

function algoMomentum(hist) {
  const last10 = hist.slice(-10);
  let wT = 0, wX = 0;
  last10.forEach((h, i) => {
    const w = (i + 1) / 10;
    if (h.ket_qua === "Tài") wT += w;
    else wX += w;
  });
  return { du_doan: wT > wX ? "Tài" : "Xỉu", name: "Xu hướng động lượng" };
}

// 🧩 Pattern nâng cao (phân tích chuỗi xuất hiện lặp)
function algoPattern(hist) {
  if (hist.length < 8)
    return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", name: "Pattern v9 (ít dữ liệu)" };

  const last4 = hist.slice(-4).map(h => h.ket_qua[0]).join("");
  let patternStats = { "Tài": 0, "Xỉu": 0 };

  for (let i = 0; i < hist.length - 4; i++) {
    const seq = hist.slice(i, i + 4).map(h => h.ket_qua[0]).join("");
    const next = hist[i + 4].ket_qua;
    if (seq === last4) patternStats[next]++;
  }

  const taiCount = patternStats["Tài"];
  const xiuCount = patternStats["Xỉu"];
  const du_doan =
    taiCount > xiuCount
      ? "Tài"
      : xiuCount > taiCount
      ? "Xỉu"
      : Math.random() > 0.5
      ? "Tài"
      : "Xỉu";

  const confidence = Math.abs(taiCount - xiuCount);
  const note = confidence > 2 ? " (mạnh)" : " (yếu)";
  return { du_doan, name: `Pattern v9${note}` };
}

// ========== Hybrid AI ==========
function hybridPredict(hist) {
  if (hist.length < 5)
    return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "Khởi tạo" };

  const algos = [
    { ...algoBalance(hist), weight: weights.balance },
    { ...algoStreak(hist), weight: weights.streak },
    { ...algoMomentum(hist), weight: weights.momentum },
    { ...algoPattern(hist), weight: weights.pattern }
  ];

  const taiScore = algos.filter(a => a.du_doan === "Tài").reduce((s, a) => s + a.weight, 0);
  const xiuScore = algos.filter(a => a.du_doan === "Xỉu").reduce((s, a) => s + a.weight, 0);
  const du_doan = taiScore > xiuScore ? "Tài" : "Xỉu";

  console.log("🧠 [AI ĐÁNH GIÁ]");
  algos.forEach(a => console.log(`- ${a.name.padEnd(25)} → ${a.du_doan} (w=${a.weight.toFixed(2)})`));
  console.log(`👉 Tổng Tài: ${taiScore.toFixed(2)} | Xỉu: ${xiuScore.toFixed(2)} → ✅ Dự đoán: ${du_doan}\n`);

  const used = algos.map(a => `${a.name}:${a.weight.toFixed(1)}`).join(", ");
  return { du_doan, thuat_toan: `Hybrid(${used})` };
}

// ========== Fetch & Learn ==========
async function fetchAndPredict() {
  try {
    const res = await axios.get(SOURCE_API, { timeout: 5000 });
    const d = res.data;
    const phien = safeParseInt(d.phien);
    const x1 = safeParseInt(d.xuc_xac_1);
    const x2 = safeParseInt(d.xuc_xac_2);
    const x3 = safeParseInt(d.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = (d.ket_qua || "").trim();

    if (!phien || phien === lastPredicted || tong < 3 || tong > 18) return;
    lastPredicted = phien;

    const { du_doan, thuat_toan } = hybridPredict(history);

    if (history.length > 0) {
      const prev = history.at(-1);
      if (prev.du_doan) {
        stats.tong++;
        if (prev.du_doan === ket_qua) {
          stats.dung++;
          if (prev.thuat_toan.includes("Cân bằng")) weights.balance += 0.1;
          if (prev.thuat_toan.includes("Đảo chuỗi")) weights.streak += 0.1;
          if (prev.thuat_toan.includes("Xu hướng")) weights.momentum += 0.1;
          if (prev.thuat_toan.includes("Pattern")) weights.pattern += 0.1;
        } else {
          stats.sai++;
          if (prev.thuat_toan.includes("Cân bằng")) weights.balance = Math.max(0.5, weights.balance - 0.1);
          if (prev.thuat_toan.includes("Đảo chuỗi")) weights.streak = Math.max(0.5, weights.streak - 0.1);
          if (prev.thuat_toan.includes("Xu hướng")) weights.momentum = Math.max(0.5, weights.momentum - 0.1);
          if (prev.thuat_toan.includes("Pattern")) weights.pattern = Math.max(0.5, weights.pattern - 0.1);
        }
        normalizeWeights();
      }
    }

    if (stats.tong > 0 && stats.tong % RESET_AFTER === 0) {
      console.log("♻️ Reset trọng số về mặc định (30 phiên)");
      weights = { balance: 1, streak: 1, momentum: 1, pattern: 1 };
    }

    const entry = { phien, ket_qua, xuc_xac: [x1, x2, x3], tong_xuc_xac: tong, du_doan, thuat_toan };
    history.push(entry);
    if (history.length > MAX_HISTORY) history.shift();
    saveData();

    console.log(`✅ Phiên ${phien}: ${ket_qua} (${tong})\n`);
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// ========== API JSON ==========
app.get("/sunwinapi", (req, res) => {
  const latest = history.at(-1) || {};
  res.json({
    "Phiên": latest.phien || 0,
    "Kết quả": latest.ket_qua || "Đang cập nhật",
    "Xúc xắc": latest.xuc_xac || [0, 0, 0],
    "Tổng xúc xắc": latest.tong_xuc_xac || 0,
    "Dự đoán": latest.du_doan || "Đang phân tích",
    "Thuật toán": latest.thuat_toan || "Đang khởi tạo",
    "Số lần dự đoán": stats.tong,
    "Số đúng": stats.dung,
    "Số thua": stats.sai,
    "Id": "@minhsangdangcap"
  });
});

// ========== Auto Loop ==========
setInterval(fetchAndPredict, 5000);

// ========== Start ==========
app.listen(PORT, () => {
  loadData();
  console.log(`🚀 BOTRUMSUNWIN HYBRID AI PRO v9 (Pattern Advanced + Normalize) đang chạy tại cổng ${PORT}`);
});
