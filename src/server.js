// server.js — Botrumsunwin API Auto (Full JSON format)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ Cấu hình
const DATA_FILE = "./data.json";              // lưu 20 cầu gần nhất
const FULL_HISTORY_FILE = "./full_history.json"; // lưu toàn bộ lịch sử
const SOURCE_API = "https://hackvn.xyz/apisun.php"; // API gốc
const MAX_HISTORY = 20; // chỉ hiển thị 20 cầu gần nhất

let history = [];
let fullHistory = [];

// 🔹 Load dữ liệu cũ
function loadHistory() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      history = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      console.log(`📂 Đã load ${history.length} phiên (20 gần nhất)`);
    }
    if (fs.existsSync(FULL_HISTORY_FILE)) {
      fullHistory = JSON.parse(fs.readFileSync(FULL_HISTORY_FILE, "utf8"));
      console.log(`📜 Đã load ${fullHistory.length} phiên full`);
    }
  } catch (err) {
    console.error("❌ Lỗi load dữ liệu:", err.message);
  }
}

// 🔹 Lưu dữ liệu ra file
function saveHistory() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
  fs.writeFileSync(FULL_HISTORY_FILE, JSON.stringify(fullHistory, null, 2));
}

// 🔹 Hàm dự đoán nâng cao (10 thuật toán)
function predictAdvanced(hist) {
  if (hist.length < 4) {
    return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "Dữ liệu ít" };
  }

  const results = hist.map(h => h.result);
  const last3 = results.slice(-3);
  const last4 = results.slice(-4);
  const last5 = results.slice(-5);
  const last6 = results.slice(-6);
  const last10 = results.slice(-10);
  const last15 = results.slice(-15);

  if (last5.length >= 5 && last5.every(r => r === last5[0]))
    return { du_doan: last5[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Lặp dài" };

  if (last4.length >= 4) {
    let isAlt = true;
    for (let i = 1; i < last4.length; i++) if (last4[i] === last4[i - 1]) isAlt = false;
    if (isAlt)
      return { du_doan: last4[last4.length - 1] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Xen kẽ" };
  }

  const taiCount10 = last10.filter(r => r === "Tài").length;
  if (taiCount10 >= 8) return { du_doan: "Xỉu", thuat_toan: "Cân bằng 10" };
  if (last10.length - taiCount10 >= 8) return { du_doan: "Tài", thuat_toan: "Cân bằng 10" };

  const taiIn4 = last4.filter(r => r === "Tài").length;
  if (taiIn4 >= 3) return { du_doan: "Tài", thuat_toan: "Trend 3/4" };
  if (taiIn4 <= 1) return { du_doan: "Xỉu", thuat_toan: "Trend 3/4" };

  if (last3.length >= 3) {
    if (last3.join("") === "TTX") return { du_doan: "Tài", thuat_toan: "Pattern TTX" };
    if (last3.join("") === "XXT") return { du_doan: "Xỉu", thuat_toan: "Pattern XXT" };
  }

  if (hist.length >= 20) {
    let taiToXiu = 0,
      taiToTai = 0;
    for (let i = 1; i < hist.length; i++) {
      if (hist[i - 1].result === "Tài") {
        if (hist[i].result === "Xỉu") taiToXiu++;
        else taiToTai++;
      }
    }
    if (last3[2] === "Tài" && taiToXiu > taiToTai * 1.3)
      return { du_doan: "Xỉu", thuat_toan: "Markov Chain" };
  }

  if (last4.length === 4 && last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2])
    return { du_doan: last4[0], thuat_toan: "Cặp đôi TTXX" };

  if (last3.length === 3 && last3.every(r => r === last3[0]))
    return { du_doan: last3[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Đảo sau 3 cùng" };

  if (last6.length === 6) {
    const first3 = last6.slice(0, 3).join("");
    const last3Str = last6.slice(3, 6).join("");
    if (first3 === last3Str) return { du_doan: last6[0], thuat_toan: "Chu kỳ 6" };
  }

  if (last15.length >= 15) {
    const taiCount15 = last15.filter(r => r === "Tài").length;
    const ratio = taiCount15 / 15;
    if (ratio >= 0.75) return { du_doan: "Xỉu", thuat_toan: "Độ lệch chuẩn" };
    if (ratio <= 0.25) return { du_doan: "Tài", thuat_toan: "Độ lệch chuẩn" };
  }

  const taiIn5 = last5.filter(r => r === "Tài").length;
  return { du_doan: taiIn5 >= 3 ? "Tài" : "Xỉu", thuat_toan: "Đa số 5" };
}

// 🔹 Hàm tạo pattern (chỉ 20 cầu)
function buildPattern(list) {
  return list.map(h => (h.result === "Tài" ? "t" : "x")).join("");
}

// 🔹 Tự động fetch API gốc mỗi 5 giây
async function fetchOnceAndSave() {
  try {
    const response = await axios.get(SOURCE_API);
    const item = response.data;

    const phien = parseInt(item.phien);
    const x1 = parseInt(item.xuc_xac_1);
    const x2 = parseInt(item.xuc_xac_2);
    const x3 = parseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = item.ket_qua.trim() === "Tài" ? "Tài" : "Xỉu";

    if (!isNaN(phien) && tong >= 3 && tong <= 18) {
      if (!fullHistory.find(h => h.phien === phien)) {
        const entry = { phien, result: ket_qua, xuc_xac: [x1, x2, x3], tong_xuc_xac: tong };
        fullHistory.push(entry);

        history.push(entry);
        while (history.length > MAX_HISTORY) history.shift();

        saveHistory();
        console.log(`✅ Cập nhật phiên ${phien}: ${ket_qua} (Tổng ${tong})`);
      }
    }
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// 🔹 Endpoint chính (JSON format như cũ)
app.get("/sunwinapi", (req, res) => {
  try {
    const latest = history.length ? history[history.length - 1] : null;
    const { du_doan, thuat_toan } = predictAdvanced(history);

    res.json({
      phien: latest ? latest.phien : 0,
      ket_qua: latest ? latest.result : "Lỗi",
      xuc_xac: latest ? latest.xuc_xac : [0, 0, 0],
      tong_xuc_xac: latest ? latest.tong_xuc_xac : 0,
      du_doan,
      pattern: buildPattern(history),
      thuat_toan,
      id: "@minhsangdangcap",
    });
  } catch (err) {
    res.status(500).json({
      phien: 0,
      ket_qua: "Lỗi",
      xuc_xac: [0, 0, 0],
      tong_xuc_xac: 0,
      du_doan: "Lỗi",
      pattern: "",
      thuat_toan: "Lỗi hệ thống",
      id: "@minhsangdangcap",
    });
  }
});

// 🔹 Endpoint xem toàn bộ lịch sử
app.get("/fullhistory", (req, res) => {
  res.json({
    total: fullHistory.length,
    fullHistory,
  });
});

// 🔹 Chạy định kỳ 5s
setInterval(fetchOnceAndSave, 5000);

// 🔹 Start server
app.listen(PORT, () => {
  loadHistory();
  console.log(`🚀 Botrumsunwin API đang chạy tại cổng ${PORT}`);
});
