// BOTRUMSUNWIN HYBRIDPLUS v18.1
// By @minhsangdangcap — AI cầu đa yếu tố + AutoReset + JSON chuẩn
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_HISTORY = process.env.API_HISTORY || "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.resolve(__dirname, "data.json");
const FETCH_INTERVAL_MS = 5000;

let data = {
  history: [],
  stats: { tong: 0, dung: 0, sai: 0 },
  flow: { streakWrong: 0 }
};

// ====== đọc data.json ======
try {
  if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (saved && Array.isArray(saved.history)) data = saved;
  }
} catch (e) {
  console.log("⚠️ Không đọc được data.json:", e.message);
}
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ====== parse item ======
function safeInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}
function parseItem(item) {
  if (!item) return null;
  const phien = safeInt(item.phien || item.id || item.session);
  const tong = safeInt(item.tong || item.total);
  const ket_qua = (item.ket_qua || item.result || (tong >= 11 ? "Tài" : "Xỉu")).trim();
  const xuc_xac = [safeInt(item.xuc_xac_1), safeInt(item.xuc_xac_2), safeInt(item.xuc_xac_3)].filter(Boolean);
  return { phien, ket_qua, xuc_xac, tong_xuc_xac: tong };
}

// ====== build chuỗi TX ======
function seq(history, limit = 30) {
  return history.slice(0, limit).map(h => h.ket_qua[0] === "T" ? "T" : "X").join("");
}

// ====== phân tích cầu sunwin ======
function analyzeCau(seqStr) {
  if (!seqStr || seqStr.length < 6)
    return { type: "none", name: "Thiếu dữ liệu", score: 0.5 };

  // Bệt
  for (let n = Math.min(8, seqStr.length); n >= 3; n--) {
    const head = seqStr.slice(0, n);
    if (head.split("").every(c => c === head[0])) {
      return { type: "bet", name: `Bệt ${head[0] === "T" ? "Tài" : "Xỉu"} ${n}`, score: 0.7 + (n - 3) * 0.05 };
    }
  }

  // Đảo
  if (/^(TX){3,}$/.test(seqStr.slice(0, 6)) || /^(XT){3,}$/.test(seqStr.slice(0, 6)))
    return { type: "alt", name: "Đảo 1-1 (liên tục)", score: 0.75 };

  // 2-2
  const p4 = seqStr.slice(0, 4);
  if (p4[0] === p4[1] && p4[2] === p4[3] && p4[0] !== p4[2])
    return { type: "22", name: `Cầu 2-2 (${p4})`, score: 0.68 };

  // Zigzag
  if (/^TXTXTX/.test(seqStr.slice(0, 6)) || /^XTXTXT/.test(seqStr.slice(0, 6)))
    return { type: "zigzag", name: "Xiên (zigzag)", score: 0.6 };

  // Cầu gãy
  if (seqStr.startsWith("TTX") || seqStr.startsWith("XXT"))
    return { type: "break", name: "Cầu gãy 2-1", score: 0.65 };

  // Ngẫu nhiên nhẹ
  return { type: "none", name: "Không có pattern mạnh", score: 0.5 };
}

// ====== AI cầu đa yếu tố ======
function aiCauDaYeuTo(history) {
  const seqStr = seq(history, 30);
  const pattern = analyzeCau(seqStr);
  const last10 = history.slice(0, 10);
  const taiCount = last10.filter(h => h.ket_qua === "Tài").length;
  const xiuCount = last10.length - taiCount;
  const avgTong = last10.reduce((a, b) => a + (b.tong_xuc_xac || 0), 0) / (last10.length || 1);
  const momentum = (taiCount - xiuCount) / (last10.length || 1);
  const trend = avgTong >= 11 ? "Tài" : "Xỉu";

  let predict = "Tài";
  let conf = 0.55;

  if (pattern.type === "bet") {
    predict = pattern.name.includes("Tài") ? "Tài" : "Xỉu";
    conf = pattern.score;
  } else if (pattern.type === "alt") {
    const last = history[0]?.ket_qua;
    predict = last === "Tài" ? "Xỉu" : "Tài";
    conf = 0.7;
  } else if (pattern.type === "22") {
    predict = trend;
    conf = 0.66;
  } else if (pattern.type === "zigzag" || pattern.type === "break") {
    predict = trend === "Tài" ? "Xỉu" : "Tài";
    conf = 0.65;
  } else {
    // khi thiếu dữ liệu → dựa vào tổng xúc xắc
    const last = history[0];
    if (!pattern || pattern.name.includes("Thiếu")) {
      predict = last?.tong_xuc_xac >= 10 ? "Tài" : "Xỉu";
      conf = 0.6;
    } else {
      predict = momentum > 0 ? "Xỉu" : "Tài";
      conf = 0.55 + Math.abs(momentum) * 0.3;
    }
  }

  return {
    du_doan: predict,
    confidence: Math.min(0.95, conf),
    pattern
  };
}

// ====== lấy dữ liệu API ======
async function fetchApi() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 6000 });
    const arr = Array.isArray(res.data) ? res.data : [res.data];
    return arr.map(parseItem).filter(Boolean);
  } catch (e) {
    console.log("⚠️ Lỗi API:", e.message);
    return [];
  }
}

// ====== xử lý reset auto ======
function checkAutoReset() {
  const { dung, sai, tong } = data.stats;
  const rate = tong > 0 ? (dung / tong) * 100 : 100;

  if (data.flow.streakWrong >= 3 || rate <= 55) {
    console.log("♻️ Reset pattern (AI tự học lại 5 phiên gần nhất)");
    data.history = data.history.slice(0, 5);
    data.flow.streakWrong = 0;
    save();
  }
}

// ====== import & predict ======
async function importAndPredict() {
  const arr = await fetchApi();
  if (!arr.length) return;

  const current = arr[0];
  const lastPhien = data.history[0]?.phien;
  if (lastPhien && current.phien <= lastPhien) return;

  // cập nhật kết quả cũ
  if (data.history[0] && data.history[0].ket_qua === "Chưa có") {
    const pred = data.history[0];
    if (pred.du_doan === current.ket_qua) {
      data.stats.dung++;
      data.flow.streakWrong = 0;
    } else {
      data.stats.sai++;
      data.flow.streakWrong++;
    }
  }

  data.history.unshift(current);
  if (data.history.length > 400) data.history = data.history.slice(0, 400);

  checkAutoReset();

  const seqHistory = data.history.filter(h => h.ket_qua && h.ket_qua !== "Chưa có");
  const nextPhien = current.phien + 1;

  const ai = aiCauDaYeuTo(seqHistory);
  const next = {
    phien: nextPhien,
    ketqua: "Chưa có",
    "xuc_xac": [],
    tong: 0,
    "du_doan": ai.du_doan,
    "pattern": seq(seqHistory, 10),
    "thuat_toan": `HybridPlus v18.1 (AI cầu đa yếu tố - ${ai.pattern.name})`,
    "loai_cau": ai.pattern.name,
    "Dev": "@minhsangdangcap"
  };

  data.history.unshift(next);
  data.stats.tong++;
  save();

  console.log(`🔮 Phiên ${nextPhien}: ${ai.du_doan} (${Math.round(ai.confidence * 100)}%) | ${ai.pattern.name}`);
}

// ====== auto loop ======
setInterval(importAndPredict, FETCH_INTERVAL_MS);

// ====== API ======
app.get("/sunwinapi", (req, res) => {
  const predicted = data.history.find(h => h.du_doan && h.ketqua === "Chưa có");
  const current = data.history.find(h => h.ketqua && h.ketqua !== "Chưa có");

  if (!predicted || !current)
    return res.json({ message: "Chưa có dữ liệu" });

  res.json({
    phien: predicted.phien,
    ketqua: current.ketqua,
    "xuc_xac": current.xuc_xac,
    tong: current.tong,
    du_doan: predicted.du_doan,
    pattern: predicted.pattern,
    thuat_toan: predicted.thuat_toan,
    loai_cau: predicted.loai_cau,
    Dev: "@minhsangdangcap"
  });
});

app.get("/history", (req, res) => res.json(data.history));
app.get("/stats", (req, res) => res.json(data.stats));
app.get("/clear", (req, res) => {
  data = { history: [], stats: { tong: 0, dung: 0, sai: 0 }, flow: { streakWrong: 0 } };
  save();
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HYBRIDPLUS v18.1 chạy tại http://0.0.0.0:${PORT}`);
});
