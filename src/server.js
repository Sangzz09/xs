// BOTRUMSUNWIN HYBRIDPLUS v22.2
// @minhsangdangcap — Tích hợp AI Cầu Đa Yếu Tố + Đa Tầng Linh Hoạt
// Hiển thị kết quả, tổng xúc xắc, pattern, loại cầu, thống kê đầy đủ

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

let data = { history: [], lastPredict: null };
let stats = { tong: 0, dung: 0, sai: 0, reset: 0 };

if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));

function saveAll() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

function parseItem(item) {
  const phien = safeInt(item.phien || item.id);
  const tong = safeInt(item.tong);
  const ket_qua = item.ket_qua?.trim() || (tong >= 11 ? "Tài" : "Xỉu");
  const xuc_xac = [
    safeInt(item.xuc_xac_1),
    safeInt(item.xuc_xac_2),
    safeInt(item.xuc_xac_3),
  ].filter(Boolean);
  return { phien, ket_qua, xuc_xac, tong_xuc_xac: tong };
}

function analyzePattern(seq) {
  if (seq.length < 6) return { type: "none", name: "Thiếu dữ liệu", score: 0.5 };
  if (/^T{3,}/.test(seq)) return { type: "bet", name: "Bệt Tài", score: 0.8 };
  if (/^X{3,}/.test(seq)) return { type: "bet", name: "Bệt Xỉu", score: 0.8 };
  if (/^(TX){3,}$/.test(seq) || /^(XT){3,}$/.test(seq))
    return { type: "alt", name: "Đảo 1-1", score: 0.75 };
  if (/^TTXX/.test(seq)) return { type: "22", name: "Cầu 2-2", score: 0.68 };
  if (/^TXTX/.test(seq) || /^XTXT/.test(seq))
    return { type: "zigzag", name: "Cầu xiên", score: 0.6 };
  return { type: "none", name: "Không có pattern mạnh", score: 0.5 };
}

function seq(history, n = 20) {
  return history
    .slice(0, n)
    .map((h) => (h.ket_qua[0] === "T" ? "T" : "X"))
    .join("");
}

function aiCauDaYeuTo(history) {
  const seqStr = seq(history);
  const pattern = analyzePattern(seqStr);
  const last10 = history.slice(0, 10);
  const taiCount = last10.filter((h) => h.ket_qua === "Tài").length;
  const xiuCount = last10.length - taiCount;
  const momentum = (taiCount - xiuCount) / (last10.length || 1);
  const trend = taiCount > xiuCount ? "Tài" : "Xỉu";
  let du_doan = trend;
  let conf = 0.55;
  switch (pattern.type) {
    case "bet":
      du_doan = pattern.name.includes("Tài") ? "Tài" : "Xỉu";
      conf = pattern.score;
      break;
    case "alt":
      du_doan = history[0]?.ket_qua === "Tài" ? "Xỉu" : "Tài";
      conf = 0.7;
      break;
    case "22":
      du_doan = trend;
      conf = 0.68;
      break;
    case "zigzag":
      du_doan = trend === "Tài" ? "Xỉu" : "Tài";
      conf = 0.65;
      break;
    default:
      du_doan = momentum > 0 ? "Tài" : "Xỉu";
      conf = 0.55 + Math.abs(momentum) * 0.3;
  }
  return { du_doan, confidence: conf, pattern };
}

function aiDaTangLinhHoat(history) {
  if (history.length < 5) {
    const tongTb =
      history.reduce((a, b) => a + (b.tong_xuc_xac || 0), 0) /
      (history.length || 1);
    return {
      du_doan: tongTb >= 11 ? "Tài" : "Xỉu",
      confidence: 0.6,
      name: "Dựa tổng xúc xắc",
    };
  }
  const last = history.slice(0, 10);
  const counts = { Tài: 0, Xỉu: 0 };
  for (const h of last) counts[h.ket_qua]++;
  const trend = counts.Tài > counts.Xỉu ? "Tài" : "Xỉu";
  const rate = Math.abs(counts.Tài - counts.Xỉu) / 10;
  return {
    du_doan: trend,
    confidence: 0.6 + rate * 0.3,
    name: "Đa tầng linh hoạt V1",
  };
}

async function fetchLatest() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 6000 });
    const arr = Array.isArray(res.data) ? res.data : [res.data];
    const parsed = arr.map(parseItem).filter(Boolean);
    if (!parsed.length) return console.log(chalk.yellow("⚠️ Không có dữ liệu mới"));
    const item = parsed[0];
    const lastPhien = data.history[0]?.phien;
    if (lastPhien && item.phien <= lastPhien) return;

    data.history.unshift(item);
    if (data.history.length > 400) data.history = data.history.slice(0, 400);

    if (data.lastPredict) {
      if (data.lastPredict.du_doan === item.ket_qua) stats.dung++;
      else stats.sai++;
      const total = stats.dung + stats.sai;
      const tile = total ? (stats.dung / total) * 100 : 0;
      if (stats.sai >= 3 && stats.dung <= stats.sai) {
        console.log(chalk.red("⚠️ Sai 3 lần liên tiếp → RESET pattern!"));
        data.history = data.history.slice(0, 5);
        stats.reset++;
        stats.sai = 0;
        stats.dung = 0;
      } else if (tile < 55 && total > 10) {
        console.log(chalk.yellow("⚠️ Tỷ lệ đúng thấp → Reset nhẹ!"));
        data.history = data.history.slice(0, 10);
        stats.reset++;
      }
    }

    const h = data.history.filter((h) => h.ket_qua !== "Chưa có");
    const ai1 = aiCauDaYeuTo(h);
    const ai2 = aiDaTangLinhHoat(h);
    const final = ai1.confidence >= ai2.confidence ? ai1 : ai2;
    const nextPhien = item.phien + 1;

    const predict = {
      phien: nextPhien,
      du_doan: final.du_doan,
      confidence: final.confidence,
      thuat_toan: final.pattern?.name || final.name,
      pattern: seq(h, 10),
      last_ket_qua: item.ket_qua,
      tong: item.tong_xuc_xac,
      xuc_xac: item.xuc_xac,
    };

    data.lastPredict = predict;
    stats.tong++;
    saveAll();

    console.log(
      chalk.green(
        `🔮 Phiên ${nextPhien}: ${final.du_doan} (${Math.round(
          final.confidence * 100
        )}%) | ${final.thuat_toan}`
      )
    );
  } catch (e) {
    console.log(chalk.red("❌ Lỗi API:"), e.message);
    if (e.response)
      console.log("🔎 Response:", e.response.status, e.response.data);
  }
}

fetchLatest();
setInterval(fetchLatest, 10000);

// ========== API ==========
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
    Reset: stats.reset,
    Dev: "@minhsangdangcap",
  });
});

app.get("/stats", (req, res) => res.json(stats));
app.get("/history", (req, res) => res.json(data.history));
app.get("/api/update", async (req, res) => {
  await fetchLatest();
  res.json({ ok: true });
});

app.listen(PORT, () =>
  console.log(chalk.green(`🚀 HYBRIDPLUS v22.2 chạy tại cổng ${PORT}`))
);
