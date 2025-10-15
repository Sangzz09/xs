// HYBRIDPLUS v25 — Deep Ensemble AI
// Dev: @minhsangdangcap
// - Giữ nguyên JSON & API format
// - AI tổ hợp 5 tầng (ensemble prediction)
// - Tự điều chỉnh trọng số khi sai nhiều
// - Reset pattern còn 5 phiên khi sai 3 lần liên tiếp

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

// =================== STATE ===================
let data = {
  history: [],
  lastPredict: null,
  streakLose: 0,
  streakWin: 0,
  weights: { pattern: 0.25, trend: 0.25, dice: 0.2, momentum: 0.15, memory: 0.15 }
};
let stats = { tong: 0, dung: 0, sai: 0, reset: 0 };

// =================== LOAD/SAVE ===================
function loadAll() {
  try {
    if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch (e) {
    console.log("⚠️ Lỗi load file:", e.message);
  }
}
function saveAll() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}
loadAll();

function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

// =================== UTILS ===================
function seqTX(history, n = 30) {
  return history
    .slice(0, n)
    .reverse()
    .map((h) => (h.ket_qua === "Tài" ? "T" : "X"))
    .join("");
}

function getTrend(history, n = 6) {
  const totals = history.slice(0, n).map((h) => h.tong_xuc_xac || 0);
  if (totals.length < 2) return 0;
  let up = 0,
    down = 0;
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[i - 1]) up++;
    else if (totals[i] < totals[i - 1]) down++;
  }
  return (up - down) / n;
}

function analyzePattern(seq) {
  if (!seq || seq.length < 6) return { score: 0, type: "none" };
  const L = seq.length;
  const last = seq[L - 1];
  let run = 1;
  for (let i = L - 2; i >= 0 && seq[i] === last; i--) run++;
  const alt = [...seq].filter((_, i) => i && seq[i] !== seq[i - 1]).length / (L - 1);
  const net = [...seq].reduce((a, c) => a + (c === "T" ? 1 : -1), 0) / L;
  const s = (Math.tanh((run - 2) / 3) + net * 0.5 - alt * 0.3) * (last === "T" ? 1 : -1);
  let type = "Không rõ";
  if (run >= 4) type = "Bệt";
  else if (alt > 0.6) type = "Đảo liên tục";
  else if (alt < 0.3) type = "Ổn định";
  return { score: s, type };
}

function diceBias(last) {
  if (!last || !Array.isArray(last.xuc_xac)) return 0;
  const high = last.xuc_xac.filter((x) => x >= 5).length;
  const low = last.xuc_xac.filter((x) => x <= 2).length;
  if (high >= 2) return 0.6;
  if (low >= 2) return -0.6;
  return 0;
}

function momentum(history) {
  const h10 = history.slice(0, 10);
  const tai = h10.filter((h) => h.ket_qua === "Tài").length;
  const xiu = h10.length - tai;
  return (tai - xiu) / (h10.length || 1);
}

function memoryPattern(history) {
  if (history.length < 20) return 0;
  const last10 = seqTX(history, 10);
  for (let i = 15; i < 50 && i + 10 < history.length; i++) {
    const past10 = seqTX(history.slice(i), 10);
    if (past10 === last10) return 0.7 * (last10.endsWith("T") ? 1 : -1);
  }
  return 0;
}

// =================== ENSEMBLE AI ===================
function hybridEnsemblePredict(history) {
  const seq = seqTX(history, 30);
  const pat = analyzePattern(seq);
  const t = getTrend(history, 6);
  const dice = diceBias(history[0]);
  const mom = momentum(history);
  const mem = memoryPattern(history);

  const w = data.weights;
  let raw =
    pat.score * w.pattern +
    t * w.trend +
    dice * w.dice +
    mom * w.momentum +
    mem * w.memory;

  // bias theo tổng trung bình
  const avg = history
    .slice(0, 8)
    .reduce((a, b) => a + (b.tong_xuc_xac || 0), 0) / (Math.min(8, history.length) || 1);
  raw += (avg - 10.5) * 0.05;

  const du_doan = raw >= 0 ? "Tài" : "Xỉu";
  const confidence = Math.min(0.95, 0.55 + Math.abs(raw) * 0.45);

  return {
    du_doan,
    confidence,
    patternSeq: seq,
    patternType: pat.type,
    raw
  };
}

// =================== FETCH ===================
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

// =================== MAIN ===================
async function importAndPredict() {
  const item = await fetchAPI();
  if (!item) return;

  const lastPhien = data.history[0]?.phien;
  if (lastPhien && item.phien <= lastPhien) return;

  data.history.unshift(item);
  if (data.history.length > 600) data.history = data.history.slice(0, 600);

  // kiểm tra đúng/sai
  if (data.lastPredict && data.lastPredict.phien === item.phien) {
    const ok = data.lastPredict.du_doan === item.ket_qua;
    if (ok) {
      stats.dung++;
      data.streakWin++;
      data.streakLose = 0;
      console.log(chalk.green(`✅ Đúng phiên ${item.phien}: ${item.ket_qua}`));
    } else {
      stats.sai++;
      data.streakLose++;
      data.streakWin = 0;
      console.log(chalk.red(`❌ Sai phiên ${item.phien}: ${item.ket_qua}`));
      // nếu sai nhiều → giảm trọng số mô hình yếu
      if (data.streakLose >= 2) {
        const keys = Object.keys(data.weights);
        const k = keys[Math.floor(Math.random() * keys.length)];
        data.weights[k] = Math.max(0.1, data.weights[k] * 0.9);
        console.log(chalk.yellow(`⚙️ Giảm trọng số ${k} xuống còn ${data.weights[k].toFixed(2)}`));
      }
    }
  }

  if (data.streakLose >= 3) {
    console.log(chalk.yellow("♻ Sai 3 lần liên tiếp → reset pattern về 5 phiên"));
    data.history = data.history.slice(0, 5);
    data.streakLose = 0;
    stats.reset++;
  }

  const ai = hybridEnsemblePredict(data.history);
  const next = {
    phien: item.phien + 1,
    du_doan: ai.du_doan,
    confidence: ai.confidence,
    patternSeq: ai.patternSeq,
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
    chalk.cyanBright(
      `🔮 Phiên ${next.phien}: ${next.du_doan} (${Math.round(next.confidence * 100)}%) | ${next.patternType}`
    )
  );
}

// =================== LOOP ===================
setInterval(importAndPredict, FETCH_INTERVAL_MS);
importAndPredict();

// =================== API ===================
app.get("/sunwinapi", (req, res) => {
  const p = data.lastPredict;
  if (!p) return res.json({ message: "Chưa có dữ liệu" });
  res.json({
    Phien: p.last_phien,
    Ket_qua: p.last_ket_qua,
    Tong: p.tong,
    Xuc_xac: p.xuc_xac,
    Du_doan: p.du_doan,
    Confidence: `${Math.round(p.confidence * 100)}%`,
    Pattern: p.patternSeq,
    Loai_cau: p.patternType,
    Thuat_toan: "HYBRID+ DEEP_ENSEMBLE_V25",
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
  data = { history: [], lastPredict: null, streakLose: 0, streakWin: 0, weights: data.weights };
  stats = { tong: 0, dung: 0, sai: 0, reset: 0 };
  saveAll();
  res.json({ ok: true, message: "Đã reset toàn bộ dữ liệu" });
});

app.listen(PORT, () =>
  console.log(chalk.green(`🚀 HYBRIDPLUS v25 (Deep Ensemble) chạy tại http://0.0.0.0:${PORT}`))
);
