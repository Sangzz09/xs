// HYBRIDPLUS v18.4 — Sunwin Predictor Auto Fetch
// by @minhsangdangcap (2025)
// Node.js + Express + AutoFetch + SmartAI + Reset + Stats

const express = require("express");
const fs = require("fs");
const axios = require("axios");
const app = express();
app.use(express.json());

const DATA_FILE = "data.json";
const STATS_FILE = "stats.json";
const LOG_FILE = "logs.json";
const FETCH_URL = "https://hackvn.xyz/apisun.php"; // API Sunwin
const FETCH_INTERVAL = 5000;

// ====== KHỞI TẠO ======
let data = [];
let stats = { tong: 0, dung: 0, sai: 0, tile: 0, reset: 0 };
let logs = [];

function load(file, def) {
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file)); } catch { return def; }
  } else return def;
}

data = load(DATA_FILE, []);
stats = load(STATS_FILE, stats);
logs = load(LOG_FILE, []);

// ====== GHI FILE ======
function saveAll() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

// ====== PHÂN TÍCH ======
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
  if (/XỉuTàiXỉuTài/.test(last.join(""))) return "Cầu đảo chéo";
  return "Cầu hỗn hợp";
}

// ====== AI thông minh ======
function aiThongMinh(xucxac = [1, 2, 3], ketquaGan = "Tài") {
  const tong = xucxac.reduce((a, b) => a + b, 0);
  if (tong >= 11) return "Tài";
  if (tong <= 10) return "Xỉu";
  return ketquaGan || (Math.random() > 0.5 ? "Tài" : "Xỉu");
}

// ====== Dự đoán ======
function duDoan() {
  const last = data.slice(-30);
  if (last.length < 5) {
    return {
      du_doan: aiThongMinh(last[last.length - 1]?.xuc_xac, last[last.length - 1]?.ketqua),
      pattern: "Thiếu dữ liệu",
      thuat_toan: "AI Thông Minh",
      loai_cau: "Phân tích xúc xắc + kết quả gần nhất",
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
    thuat_toan: "Hybrid AI v18.4",
    loai_cau: loaiCau,
  };
}

// ====== IMPORT API ======
async function fetchSunwin() {
  try {
    const res = await axios.get(FETCH_URL);
    const arr = Array.isArray(res.data) ? res.data : [res.data];
    const item = arr[0];
    if (!item) return;

    const phien = parseInt(item.phien || item.id || item.session);
    const tong = parseInt(item.tong || item.total);
    const ketqua = (item.ket_qua || (tong >= 11 ? "Tài" : "Xỉu")).trim();
    const xuc_xac = [parseInt(item.xuc_xac_1), parseInt(item.xuc_xac_2), parseInt(item.xuc_xac_3)];

    // Check trùng
    if (data.length && data[data.length - 1].phien === phien) return;

    const prev = duDoan();
    data.push({ phien, ketqua, xuc_xac, tong });

    // Cập nhật thống kê
    let dung = prev.du_doan === ketqua;
    if (dung) stats.dung++; else stats.sai++;
    stats.tong = stats.dung + stats.sai;
    stats.tile = Math.round((stats.dung / (stats.tong || 1)) * 100);

    logs.push({
      time: new Date().toLocaleString("vi-VN"),
      phien,
      du_doan: prev.du_doan,
      ketqua,
      ketquaDung: dung,
      tile_hientai: stats.tile + "%",
    });

    // Reset nếu sai nhiều hoặc tỉ lệ thấp
    const last3 = logs.slice(-3).filter((l) => l.ketquaDung === false);
    if (last3.length === 3 || stats.tile <= 55) {
      stats.reset++;
      data = data.slice(-5);
      logs.push({
        time: new Date().toLocaleString("vi-VN"),
        action: "🔁 Reset pattern (do sai 3 lần hoặc tỉ lệ thấp)",
      });
    }

    saveAll();
    console.log(`🔮 Phiên ${phien} → ${ketqua} | Dự đoán: ${prev.du_doan} | Tỉ lệ: ${stats.tile}%`);
  } catch (e) {
    console.log("⚠️ Lỗi fetch:", e.message);
  }
}

// Auto fetch mỗi 5s
setInterval(fetchSunwin, FETCH_INTERVAL);

// ====== API ======
app.get("/sunwinapi", (req, res) => {
  const duDoanData = duDoan();
  const last = data[data.length - 1];
  const phien = last ? last.phien + 1 : 1;
  res.json({
    phien,
    ketqua: last?.ketqua || "Chưa có",
    xuc_xac: last?.xuc_xac || [],
    tong: last?.tong || 0,
    du_doan: duDoanData.du_doan,
    pattern: duDoanData.pattern,
    thuat_toan: duDoanData.thuat_toan,
    loai_cau: duDoanData.loai_cau,
    Dev: "@minhsangdangcap",
  });
});

app.get("/stats", (req, res) => res.json({ stats, Dev: "@minhsangdangcap" }));
app.get("/logs", (req, res) => res.json({ logs }));
app.get("/forcefetch", async (req, res) => { await fetchSunwin(); res.json({ ok: true }); });
app.get("/clear", (req, res) => {
  data = [];
  stats = { tong: 0, dung: 0, sai: 0, tile: 0, reset: 0 };
  logs = [];
  saveAll();
  res.json({ message: "Đã reset toàn bộ dữ liệu" });
});

// ====== CHẠY SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 HYBRIDPLUS v18.4 đang chạy cổng ${PORT}`));
