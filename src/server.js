// BOTRUMSUNWIN HYBRIDPLUS v22.7 FINAL
// @minhsangdangcap
// Reset pattern khi sai 3 lần liên tiếp (chỉ giữ 5 phiên)
// KHÔNG reset stats — vẫn hiển thị đầy đủ ở /sunwinapi

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

let data = {
  history: [],
  lastPredict: null,
  streakLose: 0,
  streakWin: 0
};
let stats = { tong: 0, dung: 0, sai: 0, reset: 0 };

// ====== Đọc file lưu ======
if (fs.existsSync(DATA_FILE)) {
  try { Object.assign(data, JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); } catch {}
}
if (fs.existsSync(STATS_FILE)) {
  try { stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8")); } catch {}
}

function saveAll() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

// ====== Fetch API hackvn ======
async function fetchLatest() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 8000 });
    let payload = res.data;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { return; }
    }
    if (Array.isArray(payload) && payload.length > 0) payload = payload[0];

    const phien = safeInt(payload.phien || payload.id || payload.session);
    const tong = safeInt(payload.tong || payload.total);
    const ket_qua = (payload.ket_qua || (tong >= 11 ? "Tài" : "Xỉu")).trim();
    const xuc_xac = [
      safeInt(payload.xuc_xac_1),
      safeInt(payload.xuc_xac_2),
      safeInt(payload.xuc_xac_3)
    ].filter(n => n > 0);

    if (!phien) return;
    const lastPhien = data.history[0]?.phien;

    if (!lastPhien || phien > lastPhien) {
      const item = { phien, ket_qua, tong_xuc_xac: tong, xuc_xac };
      data.history.unshift(item);
      if (data.history.length > 400) data.history = data.history.slice(0, 400);
      handlePredict(item);
    }
  } catch (e) {
    console.log(chalk.red("❌ Lỗi fetch API:"), e.message);
  }
}

// ====== Hàm phân tích pattern ======
function seq(history, n = 20) {
  return history.slice(0, n).map(h => (h.ket_qua[0] === "T" ? "T" : "X")).join("");
}

function analyzePattern(seqStr) {
  if (!seqStr || seqStr.length < 6) return { type: "none", name: "Thiếu dữ liệu", score: 0.5 };
  if (/^T{3,}/.test(seqStr)) return { type: "bet", name: "Bệt Tài", score: 0.8 };
  if (/^X{3,}/.test(seqStr)) return { type: "bet", name: "Bệt Xỉu", score: 0.8 };
  if (/^(TX){3,}$/.test(seqStr) || /^(XT){3,}$/.test(seqStr)) return { type: "alt", name: "Đảo 1-1", score: 0.75 };
  if (/^TTXX/.test(seqStr)) return { type: "22", name: "Cầu 2-2", score: 0.68 };
  if (/^TXTX/.test(seqStr) || /^XTXT/.test(seqStr)) return { type: "zigzag", name: "Cầu xiên", score: 0.6 };
  return { type: "none", name: "Không có pattern mạnh", score: 0.5 };
}

function aiCauDaYeuTo(history) {
  const seqStr = seq(history, 20);
  const pattern = analyzePattern(seqStr);
  const last10 = history.slice(0, 10);
  const taiCount = last10.filter(h => h.ket_qua === "Tài").length;
  const xiuCount = last10.length - taiCount;
  const momentum = (taiCount - xiuCount) / (last10.length || 1);
  const trend = taiCount >= xiuCount ? "Tài" : "Xỉu";

  let du_doan = trend;
  let conf = pattern.score || 0.55;

  if (pattern.type === "alt") du_doan = history[0]?.ket_qua === "Tài" ? "Xỉu" : "Tài";
  else if (pattern.type === "zigzag") du_doan = trend === "Tài" ? "Xỉu" : "Tài";
  else {
    du_doan = momentum > 0 ? "Tài" : "Xỉu";
    conf = Math.min(0.95, conf + Math.abs(momentum) * 0.2);
  }

  return { du_doan, confidence: conf, pattern };
}

function aiDaTangLinhHoat(history) {
  if (!history || history.length < 5) {
    const tongAvg = history.reduce((a,b)=>a + (b.tong_xuc_xac||0), 0) / (history.length||1);
    return { du_doan: tongAvg >= 11 ? "Tài" : "Xỉu", confidence: 0.6, name: "Dựa tổng xúc xắc" };
  }
  const last = history.slice(0, 10);
  const counts = { Tài: 0, Xỉu: 0 };
  for (const h of last) counts[h.ket_qua]++;
  const trend = counts.Tài >= counts.Xỉu ? "Tài" : "Xỉu";
  const conf = Math.min(0.95, 0.6 + Math.abs(counts.Tài - counts.Xỉu) * 0.03);
  return { du_doan: trend, confidence: conf, name: "Đa tầng linh hoạt V1" };
}

// ====== Dự đoán và xử lý reset ======
function handlePredict(current) {
  if (data.lastPredict) {
    if (data.lastPredict.du_doan === current.ket_qua) {
      stats.dung++;
      data.streakWin++;
      data.streakLose = 0;
    } else {
      stats.sai++;
      data.streakLose++;
      data.streakWin = 0;
    }
  }

  // Reset pattern nếu sai 3 lần liên tiếp
  if (data.streakLose >= 3) {
    console.log(chalk.yellow("⚠️ Sai 3 lần liên tiếp → reset pattern (giữ 5 phiên, không reset stats)"));
    data.history = data.history.slice(0, 5);
    data.streakLose = 0;
    data.streakWin = 0;
    stats.reset++;
    saveAll();
  }

  // Tạo dự đoán mới
  const h = data.history.filter(h => h.ket_qua !== "Chưa có");
  const ai1 = aiCauDaYeuTo(h);
  const ai2 = aiDaTangLinhHoat(h);
  const final = ai1.confidence >= ai2.confidence ? ai1 : ai2;

  const predict = {
    phien: current.phien + 1,
    du_doan: final.du_doan,
    confidence: final.confidence,
    thuat_toan: final.pattern?.name || final.name,
    pattern: seq(h, 10),
    last_ket_qua: current.ket_qua,
    tong: current.tong_xuc_xac,
    xuc_xac: current.xuc_xac,
  };

  data.lastPredict = predict;
  stats.tong = (stats.tong || 0) + 1;
  saveAll();

  console.log(chalk.cyan(`🔮 Phiên ${predict.phien}: ${predict.du_doan} (${Math.round(predict.confidence*100)}%) | ${predict.thuat_toan}`));
}

// ====== API ======
app.get("/sunwinapi", (req, res) => {
  if (!data.lastPredict) return res.json({ message: "Chưa có dữ liệu" });
  res.json({
    Phien: data.lastPredict.phien,
    Ket_qua: data.lastPredict.last_ket_qua,
    Tong: data.lastPredict.tong,
    Xuc_xac: data.lastPredict.xuc_xac,
    Du_doan: data.lastPredict.du_doan,
    Pattern: data.lastPredict.pattern,
    Loai_cau: data.lastPredict.thuat_toan,
    Thuat_toan: "HYBRID+ DA_TANG_V1",
    So_lan_du_doan: stats.tong,
    So_dung: stats.dung,
    So_sai: stats.sai,
    Dev: "@minhsangdangcap"
  });
});

app.get("/stats", (req, res) => res.json(stats));
app.get("/history", (req, res) => res.json(data.history));
app.get("/api/update", async (req, res) => { await fetchLatest(); res.json({ ok: true }); });

app.get("/resetpattern", (req, res) => {
  data.history = data.history.slice(0, 5);
  data.streakLose = 0;
  data.streakWin = 0;
  stats.reset++;
  saveAll();
  console.log(chalk.yellow("🔁 Reset pattern (giữ nguyên stats)"));
  res.json({ message: "Đã reset pattern, thống kê vẫn giữ nguyên" });
});

app.get("/resetall", (req, res) => {
  data = { history: [], lastPredict: null, streakLose: 0, streakWin: 0 };
  stats = { tong: 0, dung: 0, sai: 0, reset: 0 };
  saveAll();
  console.log(chalk.red("🔥 Reset toàn bộ dữ liệu & thống kê"));
  res.json({ message: "Đã reset toàn bộ dữ liệu & thống kê" });
});

// ====== LOOP ======
fetchLatest();
setInterval(fetchLatest, 10000);

app.listen(PORT, () => {
  console.log(chalk.green(`🚀 HYBRIDPLUS v22.7 FINAL chạy tại cổng ${PORT}`));
});
