// HYBRIDPLUS v24 - Deep Adaptive
// Dev: @minhsangdangcap
// - Phiên hiện tại = giống API hackvn
// - Dự đoán = cho phiên tiếp theo
// - Deep adaptive algorithm: pattern vector, trend engine, long-memory (30), adaptive confidence
// - Reset pattern khi sai 3 lần liên tiếp (giữ nguyên thống kê)

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
const FETCH_INTERVAL_MS = 10000; // 10s

// ---------- DỮ LIỆU ----------
let data = {
  history: [],
  lastPredict: null,
  streakLose: 0,
  streakWin: 0
};
let stats = { tong: 0, dung: 0, sai: 0, reset: 0 };

// ---------- HÀM PHỤ ----------
function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}
function saveAll() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");
}
function loadAll() {
  if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE));
  if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE));
}
loadAll();

// ---------- XỬ LÝ PATTERN ----------
function buildSeq(history, n = 30) {
  return history
    .slice(0, n)
    .reverse()
    .map((h) => (h.ket_qua === "Tài" ? "T" : "X"))
    .join("");
}

function computePatternVector(seq) {
  if (!seq || seq.length < 6) return { score: 0, type: "none" };
  const s = seq;
  const L = s.length;
  let last = s[L - 1];
  let lastRun = 1;
  for (let i = L - 2; i >= 0; i--) {
    if (s[i] === last) lastRun++;
    else break;
  }

  const altRatio = [...s].filter((_, i) => i && s[i] !== s[i - 1]).length / (L - 1);
  const net = [...s].reduce((a, c) => a + (c === "T" ? 1 : -1), 0) / L;
  const score = (Math.tanh((lastRun - 2) / 4) + net * 0.6 - altRatio * 0.3) * (last === "T" ? 1 : -1);
  const type =
    lastRun >= 4 ? "Bệt mạnh" : altRatio < 0.4 ? "Cầu ổn định" : altRatio > 0.6 ? "Đảo liên tục" : "Không rõ";
  return { score, type, lastRun };
}

function computeTrend(history) {
  const arr = history.slice(0, 5).map((h) => h.tong_xuc_xac || 0);
  if (arr.length < 2) return 0;
  let up = 0,
    down = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[i - 1]) up++;
    else if (arr[i] < arr[i - 1]) down++;
  }
  return (up - down) / arr.length;
}

// ---------- AI DỰ ĐOÁN ----------
function deepAdaptivePredict(history) {
  const seq = buildSeq(history, 30);
  const pat = computePatternVector(seq);
  const trend = computeTrend(history);
  const last10 = history.slice(0, 10);
  const tai = last10.filter((h) => h.ket_qua === "Tài").length;
  const momentum = (tai - (last10.length - tai)) / (last10.length || 1);
  const avgTong = last10.reduce((a, b) => a + (b.tong_xuc_xac || 0), 0) / (last10.length || 1);

  let totalBias = avgTong >= 11 ? 0.4 : -0.4;
  let raw = pat.score * 0.5 + trend * 0.25 + momentum * 0.2 + totalBias * 0.3;
  const du_doan = raw >= 0 ? "Tài" : "Xỉu";
  const confidence = Math.min(0.95, 0.55 + Math.abs(raw) * 0.4);

  return {
    du_doan,
    confidence,
    pattern: seq,
    patternType: pat.type
  };
}

// ---------- FETCH DỮ LIỆU ----------
async function fetchAPI() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 8000 });
    const raw = Array.isArray(res.data) ? res.data[0] : res.data;
    const phien = safeInt(raw.phien || raw.id);
    const tong = safeInt(raw.tong || raw.total);
    const ket_qua = raw.ket_qua || (tong >= 11 ? "Tài" : "Xỉu");
    const xuc_xac = [safeInt(raw.xuc_xac_1), safeInt(raw.xuc_xac_2), safeInt(raw.xuc_xac_3)].filter(Boolean);
    return { phien, ket_qua, tong_xuc_xac: tong, xuc_xac };
  } catch (e) {
    console.log("⚠️ Lỗi API:", e.message);
    return null;
  }
}

// ---------- XỬ LÝ CHÍNH ----------
async function importAndPredict() {
  const item = await fetchAPI();
  if (!item) return;

  const lastPhien = data.history[0]?.phien;
  if (lastPhien && item.phien <= lastPhien) return;

  data.history.unshift(item);
  if (data.history.length > 500) data.history = data.history.slice(0, 500);

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

  if (data.streakLose >= 3) {
    console.log(chalk.yellow("♻ Sai 3 lần liên tiếp → reset pattern còn 5 phiên"));
    data.history = data.history.slice(0, 5);
    data.streakLose = 0;
    stats.reset++;
  }

  const ai = deepAdaptivePredict(data.history);
  const next = {
    phien: item.phien + 1,
    du_doan: ai.du_doan,
    confidence: ai.confidence,
    patternSeq: ai.pattern,
    patternType: ai.patternType,
    last_phien: item.phien,
    last_ket_qua: item.ket_qua,
    tong: item.tong_xuc_xac,
    xuc_xac: item.xuc_xac
  };

  data.lastPredict = next;
  stats.tong++;
  saveAll();

  console.log(
    chalk.green(
      `🔮 Phiên ${next.phien}: ${next.du_doan} (${Math.round(next.confidence * 100)}%) | ${next.patternType}`
    )
  );
}

// ---------- LOOP ----------
setInterval(importAndPredict, FETCH_INTERVAL_MS);
importAndPredict();

// ---------- API ----------
app.get("/sunwinapi", (req, res) => {
  const p = data.lastPredict;
  if (!p)
    return res.json({
      message: "Chưa có dữ liệu"
    });

  res.json({
    Phien: p.last_phien,
    Ket_qua: p.last_ket_qua,
    Tong: p.tong,
    Xuc_xac: p.xuc_xac,
    Du_doan: p.du_doan,
    Confidence: `${Math.round(p.confidence * 100)}%`,
    Pattern: p.patternSeq,
    Loai_cau: p.patternType,
    Thuat_toan: "HYBRID+ DEEP_ADAPTIVE_V24",
    So_lan_du_doan: stats.tong,
    So_dung: stats.dung,
    So_sai: stats.sai,
    Dev: "@minhsangdangcap"
  });
});

app.get("/stats", (req, res) => res.json(stats));
app.get("/history", (req, res) => res.json(data.history));
app.get("/resetpattern", (req, res) => {
  data.history = data.history.slice(0, 5);
  data.streakLose = 0;
  data.streakWin = 0;
  stats.reset++;
  saveAll();
  res.json({ ok: true, message: "Đã reset pattern (giữ thống kê)" });
});
app.get("/resetall", (req, res) => {
  data = { history: [], lastPredict: null, streakLose: 0, streakWin: 0 };
  stats = { tong: 0, dung: 0, sai: 0, reset: 0 };
  saveAll();
  res.json({ ok: true, message: "Đã reset toàn bộ dữ liệu" });
});

app.listen(PORT, () => console.log(chalk.green(`🚀 HYBRIDPLUS v24 chạy tại http://0.0.0.0:${PORT}`)));
