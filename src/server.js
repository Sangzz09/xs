// BOTRUMSUNWIN HYBRIDPLUS v21 — SmartPattern + AutoRecover AI
// Dev: @minhsangdangcap
// API nguồn: https://hackvn.xyz/apisun.php

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const chalk = require("chalk");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const DATA_FILE = "./data.json";
const STATS_FILE = "./stats.json";

let data = { pattern: [] };
let stats = { tong: 0, dung: 0, sai: 0, tile: 0, reset: 0 };

// Đọc dữ liệu cũ nếu có
if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));

const API_URL = "https://hackvn.xyz/apisun.php";
const MAX_PATTERN = 30;

// 📘 Hàm lưu file an toàn
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function saveStats() {
  stats.tile = stats.tong ? ((stats.dung / stats.tong) * 100).toFixed(2) : 0;
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// 📘 Hàm reset pattern khi sai nhiều
function resetPattern(reason) {
  data.pattern = data.pattern.slice(-5);
  stats.reset++;
  console.log(chalk.yellow(`⚠️ Pattern reset do: ${reason}`));
  saveData();
  saveStats();
}

// 📘 Dự đoán thông minh khi chưa đủ dữ liệu
function aiFallback(kq, xucsac) {
  const tong = xucsac.reduce((a, b) => a + b, 0);
  if (tong >= 11) return "Tài";
  if (tong <= 10) return "Xỉu";
  return kq === "Tài" ? "Xỉu" : "Tài";
}

// 📘 Hàm xác định loại cầu
function detectCau(pattern) {
  if (pattern.length < 4) return "Cầu ngắn";
  const last = pattern.slice(-5);
  const t = last.filter(v => v === "Tài").length;
  const x = last.filter(v => v === "Xỉu").length;
  if (t === 5) return "Cầu Bệt Tài 5";
  if (x === 5) return "Cầu Bệt Xỉu 5";
  if (t >= 3 && x >= 2) return "Cầu Tài mạnh";
  if (x >= 3 && t >= 2) return "Cầu Xỉu mạnh";
  return "Cầu hỗn hợp";
}

// 📘 Tạo chuỗi patternTXT
function patternToTXT(pattern) {
  return pattern.map(p => (p === "Tài" ? "T" : "X")).join("");
}

// 📘 Logic dự đoán chính
function predictNext(pattern, kq, xucsac) {
  if (pattern.length < 5) {
    return aiFallback(kq, xucsac);
  }

  const last = pattern.slice(-5);
  const t = last.filter(v => v === "Tài").length;
  const x = last.filter(v => v === "Xỉu").length;

  if (t > x) return "Tài";
  if (x > t) return "Xỉu";
  return aiFallback(kq, xucsac);
}

// 📘 API chính
app.get("/predict", async (req, res) => {
  try {
    const { data: response } = await axios.get(API_URL);
    const { phien, ketqua, xucsac, tong } = response;

    // Nếu có dữ liệu cũ thì dự đoán dựa theo pattern
    const duDoan = predictNext(data.pattern, ketqua, xucsac);
    const loaiCau = detectCau(data.pattern);
    const patternTXT = patternToTXT(data.pattern);

    // Cập nhật pattern
    data.pattern.push(ketqua);
    if (data.pattern.length > MAX_PATTERN) data.pattern.shift();

    // Đánh giá kết quả
    stats.tong++;
    if (duDoan === ketqua) stats.dung++;
    else stats.sai++;

    const tile = (stats.dung / stats.tong) * 100;
    if (stats.sai >= 3 && stats.sai % 3 === 0) resetPattern("Sai 3 lần liên tiếp");
    if (tile < 55 && stats.tong > 10) resetPattern("Tỉ lệ thấp < 55%");

    saveData();
    saveStats();

    const output = {
      phien,
      ketqua,
      xucsac,
      tong,
      duDoan,
      pattern: data.pattern,
      patternTXT,
      thuatToan: "AL-SmartPattern",
      loaiCau,
      Dev: "@minhsangdangcap",
    };

    console.log(
      chalk.cyan(`🔮 Phiên ${phien}: ${duDoan} | KQ: ${ketqua} | Cầu: ${loaiCau}`)
    );

    res.json(output);
  } catch (err) {
    console.error(chalk.red("❌ Lỗi API:"), err.message);
    res.status(500).json({ error: "Lỗi lấy dữ liệu API" });
  }
});

// 📘 API thống kê
app.get("/stats", (req, res) => {
  res.json({ stats, Dev: "@minhsangdangcap" });
});

// 📘 Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.green(`🚀 BOTRUMSUNWIN HYBRIDPLUS v21 đang chạy tại cổng ${PORT}`));
});
