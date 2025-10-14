// HYBRIDPLUS v23.4 — FIXED STATS
// ✅ Phiên hiển thị = đúng với hackvn
// ✅ Dự đoán = cho phiên kế tiếp
// ✅ Stats đúng 100% (so sánh kết quả thật của phiên dự đoán trước)
// ✅ Reset pattern sau 3 sai, giữ nguyên đúng/sai
// ✅ Confidence hiển thị rõ
// Dev: @minhsangdangcap

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_HISTORY = "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.join(__dirname, "data.json");
const STATS_FILE = path.join(__dirname, "stats.json");
const FETCH_INTERVAL_MS = 10000;

let data = { history: [], lastPredict: null, streakLose: 0, streakWin: 0 };
let stats = { tong: 0, dung: 0, sai: 0, reset: 0 };

// ====== Load dữ liệu ======
try {
  if (fs.existsSync(DATA_FILE))
    Object.assign(data, JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  if (fs.existsSync(STATS_FILE))
    stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
} catch (e) {
  console.log("⚠️ Lỗi load:", e.message);
}

function saveAll() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");
}

function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

// ====== Pattern ======
function patternTXT(history, n = 30) {
  return history.slice(0, n).reverse().map(h => (h.ket_qua === "Tài" ? "T" : "X")).join("");
}

function analyzePattern(seq) {
  if (!seq || seq.length < 6) return { name: "Thiếu dữ liệu", score: 0.5 };
  if (/T{3,}$/.test(seq)) return { name: "Bệt Tài", score: 0.8 };
  if (/X{3,}$/.test(seq)) return { name: "Bệt Xỉu", score: 0.8 };
  if (/(TX){3,}$/.test(seq) || /(XT){3,}$/.test(seq)) return { name: "Đảo 1-1", score: 0.75 };
  if (/TTXX$/.test(seq)) return { name: "Cầu 2-2", score: 0.7 };
  if (/(TXTX|XTXT)$/.test(seq)) return { name: "Cầu xiên", score: 0.65 };
  return { name: "Không rõ ràng", score: 0.5 };
}

// ====== AI cầu đa yếu tố ======
function aiCauDaYeuTo(history) {
  const seq = patternTXT(history, 30);
  const pattern = analyzePattern(seq);

  const last10 = history.slice(0, 10);
  const tai = last10.filter(h => h.ket_qua === "Tài").length;
  const xiu = last10.length - tai;
  const momentum = (tai - xiu) / (last10.length || 1);
  const avgTong = last10.reduce((a, b) => a + (b.tong_xuc_xac || 0), 0) / (last10.length || 1);

  let predict = avgTong >= 11 ? "Tài" : "Xỉu";
  let conf = 0.55;

  if (pattern.name.includes("Bệt")) {
    predict = pattern.name.includes("Tài") ? "Tài" : "Xỉu";
    conf = pattern.score;
  } else if (pattern.name === "Đảo 1-1") {
    const last = history[0]?.ket_qua;
    predict = last === "Tài" ? "Xỉu" : "Tài";
    conf = 0.7;
  } else if (pattern.name === "Cầu 2-2") {
    predict = avgTong >= 11 ? "Tài" : "Xỉu";
    conf = 0.68;
  } else if (pattern.name === "Cầu xiên") {
    predict = avgTong >= 11 ? "Xỉu" : "Tài";
    conf = 0.65;
  } else {
    predict = momentum > 0 ? "Tài" : "Xỉu";
    conf = 0.55 + Math.abs(momentum) * 0.3;
  }

  // Xét xúc xắc gần nhất
  const last = history[0];
  if (last?.xuc_xac) {
    const high = last.xuc_xac.filter(x => x >= 5).length;
    const low = last.xuc_xac.filter(x => x <= 2).length;
    if (high >= 2) predict = "Tài";
    if (low >= 2) predict = "Xỉu";
  }

  return { du_doan: predict, confidence: Math.min(0.95, conf), pattern };
}

// ====== Fetch API ======
async function fetchAPI() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 8000 });
    const raw = Array.isArray(res.data) ? res.data[0] : res.data;
    const phien = safeInt(raw.phien || raw.id);
    const tong = safeInt(raw.tong || raw.total);
    const ket_qua = (raw.ket_qua || (tong >= 11 ? "Tài" : "Xỉu")).trim();
    const xuc_xac = [safeInt(raw.xuc_xac_1), safeInt(raw.xuc_xac_2), safeInt(raw.xuc_xac_3)].filter(Boolean);
    return { phien, ket_qua, tong_xuc_xac: tong, xuc_xac };
  } catch (e) {
    console.log("⚠️ Lỗi fetch:", e.message);
    return null;
  }
}

// ====== Logic chính ======
async function importAndPredict() {
  const item = await fetchAPI();
  if (!item) return;

  const lastPhien = data.history[0]?.phien;
  if (lastPhien && item.phien <= lastPhien) return;

  data.history.unshift(item);
  if (data.history.length > 500) data.history = data.history.slice(0, 500);

  // cập nhật đúng/sai khi kết quả trùng với dự đoán đã lưu
  if (data.lastPredict && data.lastPredict.phien === item.phien) {
    if (data.lastPredict.du_doan === item.ket_qua) {
      stats.dung++;
      data.streakWin++;
      data.streakLose = 0;
      console.log(chalk.green(`✅ Đúng phiên ${item.phien}: ${item.ket_qua}`));
    } else {
      stats.sai++;
      data.streakLose++;
      data.streakWin = 0;
      console.log(chalk.red(`❌ Sai phiên ${item.phien}: ${item.ket_qua}`));
    }
  }

  // reset pattern nếu sai 3 lần liên tiếp
  if (data.streakLose >= 3) {
    console.log(chalk.yellow("♻ Sai 3 lần liên tiếp → reset pattern còn 5 phiên"));
    data.history = data.history.slice(0, 5);
    data.streakLose = 0;
    stats.reset++;
  }

  // tạo dự đoán mới (cho phiên kế tiếp)
  const ai = aiCauDaYeuTo(data.history);
  data.lastPredict = {
    phien: item.phien + 1,
    du_doan: ai.du_doan,
    confidence: ai.confidence,
    pattern: ai.pattern.name,
    seq: patternTXT(data.history, 10),
    loai_cau: "Đa tầng linh hoạt V1",
    thuat_toan: "HYBRID+ DA_TANG_V1",
    last_phien: item.phien,
    last_ket_qua: item.ket_qua,
    tong: item.tong_xuc_xac,
    xuc_xac: item.xuc_xac
  };

  stats.tong++;
  saveAll();
  console.log(chalk.green(`🔮 Phiên ${item.phien + 1}: ${ai.du_doan} (${Math.round(ai.confidence * 100)}%) | ${ai.pattern.name}`));
}

setInterval(importAndPredict, FETCH_INTERVAL_MS);
importAndPredict();

// ====== API ======
app.get("/sunwinapi", (req, res) => {
  if (!data.lastPredict) return res.json({ message: "Chưa có dữ liệu" });
  const p = data.lastPredict;
  res.json({
    Phien: p.last_phien,
    Ket_qua: p.last_ket_qua,
    Tong: p.tong,
    Xuc_xac: p.xuc_xac,
    Du_doan: p.du_doan,
    Confidence: Math.round(p.confidence * 100) + "%",
    Pattern: p.seq,
    Loai_cau: p.loai_cau,
    Thuat_toan: p.thuat_toan,
    So_lan_du_doan: stats.tong,
    So_dung: stats.dung,
    So_sai: stats.sai,
    Dev: "@minhsangdangcap"
  });
});

app.get("/stats", (req, res) => res.json(stats));

app.get("/resetpattern", (req, res) => {
  data.history = data.history.slice(0, 5);
  data.streakLose = 0;
  data.streakWin = 0;
  stats.reset++;
  saveAll();
  res.json({ ok: true, message: "Đã reset pattern (không mất thống kê)" });
});

app.get("/resetall", (req, res) => {
  data = { history: [], lastPredict: null, streakLose: 0, streakWin: 0 };
  stats = { tong: 0, dung: 0, sai: 0, reset: 0 };
  saveAll();
  res.json({ ok: true, message: "Đã reset toàn bộ dữ liệu" });
});

app.listen(PORT, () =>
  console.log(chalk.green(`🚀 HYBRIDPLUS v23.4 chạy tại cổng ${PORT}`))
);
