// HYBRIDPLUS v18.2 — Sunwin Predictor
// Author: @minhsangdangcap (2025)
// Node.js + Express — Lưu lịch sử + AI thông minh + /stats
// Reset khi sai 3 lần liên tiếp hoặc tỉ lệ đúng <= 55%

const express = require("express");
const fs = require("fs");
const app = express();
app.use(express.json());

const DATA_FILE = "data.json";
const STATS_FILE = "stats.json";

// ====== KHỞI TẠO DỮ LIỆU ======
let data = [];
let stats = { tong: 0, dung: 0, sai: 0, tile: 0, reset: 0 };

// Load dữ liệu nếu có
if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    data = [];
  }
}
if (fs.existsSync(STATS_FILE)) {
  try {
    stats = JSON.parse(fs.readFileSync(STATS_FILE));
  } catch {
    stats = { tong: 0, dung: 0, sai: 0, tile: 0, reset: 0 };
  }
}

// ====== HÀM PHỤ ======
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function saveStats() {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// ====== PHÂN TÍCH CẦU ======
function detectPattern() {
  const last = data.slice(-30).map((d) => d.ketqua);
  return last.join("").replace(/\s+/g, "");
}

function detectLoaiCau() {
  const last = data.slice(-6).map((d) => d.ketqua);
  if (last.every((v) => v === "Tài")) return "Cầu bệt Tài";
  if (last.every((v) => v === "Xỉu")) return "Cầu bệt Xỉu";
  if (/TàiXỉuTàiXỉu/.test(last.join(""))) return "Cầu đảo đều";
  if (/TàiTàiXỉuXỉu/.test(last.join(""))) return "Cầu 2-2";
  return "Cầu hỗn hợp";
}

// ====== AI THÔNG MINH ======
function aiThongMinh(xucxac, ketquaGanNhat) {
  const tong = xucxac.reduce((a, b) => a + b, 0);
  // Logic đơn giản nhưng học nhanh từ kết quả và xúc xắc
  if (tong >= 11) return "Tài";
  if (tong <= 10) return "Xỉu";
  // nếu tổng = 10-11 thì học theo kết quả gần nhất
  return ketquaGanNhat || (Math.random() > 0.5 ? "Tài" : "Xỉu");
}

// ====== HÀM DỰ ĐOÁN ======
function duDoan() {
  const last = data.slice(-30);
  if (last.length < 5) {
    // Không đủ dữ liệu => dùng AI thông minh
    return {
      du_doan: aiThongMinh([2, 3, 4], last[last.length - 1]?.ketqua),
      pattern: "Thiếu dữ liệu",
      thuat_toan: "AI Thông Minh",
      loai_cau: "Học theo xúc xắc",
    };
  }

  const pattern = detectPattern();
  const loaiCau = detectLoaiCau();
  const last5 = last.slice(-5).map((d) => d.ketqua);
  const countTai = last5.filter((v) => v === "Tài").length;
  const countXiu = 5 - countTai;

  let duDoan = "Tài";
  if (countXiu > countTai) duDoan = "Xỉu";

  return {
    du_doan: duDoan,
    pattern,
    thuat_toan: "Hybrid AI v18.2",
    loai_cau: loaiCau,
  };
}

// ====== API ======

// GET: xem dự đoán hiện tại
app.get("/sunwinapi", (req, res) => {
  let phien = data.length + 1;
  let last = data[data.length - 1];

  const duDoanData = duDoan();

  const json = {
    phien,
    ketqua: last?.ketqua || "Chưa có",
    xuc_xac: last?.xuc_xac || [],
    tong: last?.tong || 0,
    du_doan: duDoanData.du_doan,
    pattern: duDoanData.pattern,
    thuat_toan: duDoanData.thuat_toan,
    loai_cau: duDoanData.loai_cau,
    Dev: "@minhsangdangcap",
  };

  res.json(json);
});

// POST: gửi dữ liệu phiên mới
app.post("/sunwinapi", (req, res) => {
  const { phien, ketqua, xuc_xac, tong } = req.body;
  if (!phien || !ketqua || !xuc_xac || !tong)
    return res.status(400).json({ message: "Thiếu dữ liệu" });

  data.push({ phien, ketqua, xuc_xac, tong });
  if (data.length > 200) data.shift();
  saveData();

  // Kiểm tra dự đoán gần nhất đúng sai
  if (data.length > 1) {
    const prevPredict = duDoan();
    if (prevPredict.du_doan === ketqua) {
      stats.dung++;
    } else {
      stats.sai++;
    }
    stats.tong = stats.dung + stats.sai;
    stats.tile = Math.round((stats.dung / (stats.tong || 1)) * 100);

    // Reset khi sai 3 lần liên tiếp hoặc tỉ lệ <= 55%
    const last3 = data.slice(-3).map((d) => d.ketqua);
    const allWrong =
      last3.length === 3 &&
      last3.every((v) => v !== prevPredict.du_doan);

    if (allWrong || stats.tile <= 55) {
      stats.reset++;
      data = data.slice(-5); // reset pattern xuống 5 phiên
      saveData();
    }
    saveStats();
  }

  res.json({ message: "Đã thêm phiên mới", stats });
});

// GET: thống kê
app.get("/stats", (req, res) => {
  res.json({
    thong_ke: stats,
    Dev: "@minhsangdangcap",
  });
});

// ====== KHỞI CHẠY SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ HYBRIDPLUS v18.2 đang chạy trên cổng ${PORT}`)
);
