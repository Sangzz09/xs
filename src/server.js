// BOTRUMSUNWIN HYBRIDPLUS v22.4 FINAL
// @minhsangdangcap — AI Cầu Đa Yếu Tố + Đa Tầng Linh Hoạt
// Đồng bộ chuẩn phiên hackvn.xyz, auto reset thông minh
// Không hiển thị trường "Reset" trong JSON API

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

// Đọc file lưu nếu có
if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));

// Lưu toàn bộ dữ liệu
function saveAll() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

// ========================== LẤY DỮ LIỆU API ==========================
async function fetchLatest() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 8000 });
    let payload = res.data;

    // Nếu API trả chuỗi JSON → parse lại
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        console.log(chalk.red("⚠️ API trả chuỗi không hợp lệ JSON"));
        return;
      }
    }

    // Nếu trả mảng → lấy phần tử đầu tiên
    if (Array.isArray(payload) && payload.length > 0) payload = payload[0];

    // Chuẩn hoá dữ liệu
    const phien = safeInt(payload.phien || payload.id || payload.session);
    const tong = safeInt(payload.tong || payload.total);
    const ket_qua = (payload.ket_qua || (tong >= 11 ? "Tài" : "Xỉu")).trim();
    const xuc_xac = [
      safeInt(payload.xuc_xac_1),
      safeInt(payload.xuc_xac_2),
      safeInt(payload.xuc_xac_3),
    ].filter(Boolean);

    if (!phien) {
      console.log(chalk.yellow("⚠️ Không có số phiên hợp lệ từ API"));
      return;
    }

    const lastPhien = data.history[0]?.phien;
    console.log(chalk.gray(`API trả phien=${phien} | lastPhien=${lastPhien}`));

    // Nếu là phiên mới
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

// ========================== PHÂN TÍCH & DỰ ĐOÁN ==========================
function seq(history, n = 20) {
  return history.slice(0, n).map(h => (h.ket_qua[0] === "T" ? "T" : "X")).join("");
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

function aiCauDaYeuTo(history) {
  const seqStr = seq(history, 20);
  const pattern = analyzePattern(seqStr);
  const last10 = history.slice(0, 10);
  const taiCount = last10.filter(h => h.ket_qua === "Tài").length;
  const xiuCount = last10.length - taiCount;
  const trend = taiCount >= xiuCount ? "Tài" : "Xỉu";
  let du_doan = trend;
  let conf = pattern.score || 0.55;

  if (pattern.type === "alt") du_doan = history[0]?.ket_qua === "Tài" ? "Xỉu" : "Tài";
  else if (pattern.type === "zigzag") du_doan = trend === "Tài" ? "Xỉu" : "Tài";

  return { du_doan, confidence: conf, pattern };
}

function aiDaTangLinhHoat(history) {
  const last = history.slice(0, 10);
  const counts = { Tài: 0, Xỉu: 0 };
  for (const h of last) counts[h.ket_qua]++;
  const trend = counts.Tài >= counts.Xỉu ? "Tài" : "Xỉu";
  const conf = 0.6 + Math.abs(counts.Tài - counts.Xỉu) * 0.03;
  return { du_doan: trend, confidence: conf, name: "Đa tầng linh hoạt V1" };
}

// ========================== DỰ ĐOÁN VÀ GHI ==========================
function handlePredict(current) {
  // Xử lý đúng/sai của phiên trước
  if (data.lastPredict) {
    if (data.lastPredict.du_doan === current.ket_qua) stats.dung++;
    else stats.sai++;

    const total = stats.dung + stats.sai;
    const tile = total ? (stats.dung / total) * 100 : 0;

    if (stats.sai >= 3 && stats.dung <= stats.sai) {
      console.log(chalk.red("⚠️ Sai 3 lần liên tiếp → reset pattern"));
      data.history = data.history.slice(0, 5);
      stats.reset++;
      stats.sai = 0;
      stats.dung = 0;
    } else if (tile < 55 && total > 10) {
      console.log(chalk.yellow("⚠️ Tỷ lệ đúng thấp → reset nhẹ"));
      data.history = data.history.slice(0, 10);
      stats.reset++;
    }
  }

  // Phân tích và dự đoán
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
  stats.tong++;
  saveAll();

  console.log(chalk.green(`🔮 Phiên ${predict.phien}: ${predict.du_doan} (${Math.round(predict.confidence * 100)}%) | ${predict.thuat_toan}`));
}

// ========================== API ENDPOINTS ==========================
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
    Dev: "@minhsangdangcap",
  });
});

app.get("/stats", (req, res) => res.json(stats));
app.get("/history", (req, res) => res.json(data.history));
app.get("/api/update", async (req, res) => {
  await fetchLatest();
  res.json({ ok: true });
});

// Tự động fetch liên tục
fetchLatest();
setInterval(fetchLatest, 10000);

app.listen(PORT, () => {
  console.log(chalk.green(`🚀 HYBRIDPLUS v22.4 FINAL đang chạy tại cổng ${PORT}`));
});
