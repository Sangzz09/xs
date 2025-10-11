// ✅ BOTRUMSUNWIN API - VIP PRO V2 (By @minhsangdangcap)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_API = "https://hackvn.xyz/apisun.php"; // API gốc
const DATA_FILE = "./data.json";
const MAX_HISTORY = 20; // chỉ lưu 20 phiên gần nhất

let history = [];
let stats = { tong_du_doan: 0, dung: 0, sai: 0 };

// 🔹 Load dữ liệu từ file (nếu có)
function loadHistory() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      history = data.history || [];
      stats = data.stats || stats;
    }
    console.log(`📂 Đã load ${history.length} phiên gần nhất`);
  } catch (err) {
    console.error("❌ Lỗi load dữ liệu:", err.message);
  }
}

// 🔹 Lưu dữ liệu ra file
function saveHistory() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ history, stats }, null, 2),
    "utf8"
  );
}

// 🔹 Tạo pattern (t = tài, x = xỉu)
function buildPattern(list) {
  return list.map(h => (h.ket_qua === "Tài" ? "t" : "x")).join("");
}

// 🔮 THUẬT TOÁN VIP PRO V2 (phân tích 20 phiên + phiên trước)
function predictVIP(hist) {
  const len = hist.length;

  // Nếu chưa đủ dữ liệu → dự đoán theo phiên gần nhất
  if (len < 5) {
    if (len === 0)
      return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "Ngẫu nhiên khởi động" };
    const last = hist[hist.length - 1];
    const tong = last.tong_xuc_xac;
    let du_doan = "Tài";
    if (tong <= 10) du_doan = "Xỉu";
    return { du_doan, thuat_toan: "Phân tích phiên trước" };
  }

  const results = hist.map(h => h.ket_qua);
  const last3 = results.slice(-3);
  const last5 = results.slice(-5);
  const last10 = results.slice(-10);
  const last20 = results.slice(-20);

  // 1️⃣ Đảo chuỗi dài
  if (last5.every(r => r === last5[0]))
    return { du_doan: last5[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Đảo chuỗi dài" };

  // 2️⃣ Cân bằng 10
  const tai10 = last10.filter(r => r === "Tài").length;
  if (tai10 >= 7) return { du_doan: "Xỉu", thuat_toan: "Cân bằng 10" };
  if (tai10 <= 3) return { du_doan: "Tài", thuat_toan: "Cân bằng 10" };

  // 3️⃣ Cân bằng 20
  const tai20 = last20.filter(r => r === "Tài").length;
  const ratio = tai20 / last20.length;
  if (ratio >= 0.65) return { du_doan: "Xỉu", thuat_toan: "Cân bằng 20" };
  if (ratio <= 0.35) return { du_doan: "Tài", thuat_toan: "Cân bằng 20" };

  // 4️⃣ Xu hướng trọng số
  let weightT = 0, weightX = 0;
  last20.forEach((r, i) => {
    const w = (i + 1) / last20.length;
    if (r === "Tài") weightT += w;
    else weightX += w;
  });
  const weightDiff = weightT - weightX;

  // 5️⃣ Nếu xu hướng cân → kết hợp phiên gần nhất
  if (Math.abs(weightDiff) < 1.5) {
    const last = hist[hist.length - 1];
    const tong = last.tong_xuc_xac;
    const guess = tong >= 11 ? "Tài" : "Xỉu";
    return { du_doan: guess, thuat_toan: "Kết hợp phiên gần nhất" };
  }

  // 6️⃣ Nếu xu hướng nghiêng rõ ràng → theo xu hướng
  return {
    du_doan: weightT > weightX ? "Tài" : "Xỉu",
    thuat_toan: "Xu hướng trọng số VIP"
  };
}

// 🔹 Fetch dữ liệu từ API gốc
async function fetchOnceAndSave() {
  try {
    const res = await axios.get(SOURCE_API);
    const item = res.data;
    const phien = parseInt(item.phien);
    const x1 = parseInt(item.xuc_xac_1);
    const x2 = parseInt(item.xuc_xac_2);
    const x3 = parseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = item.ket_qua.trim();

    if (!isNaN(phien) && tong >= 3 && tong <= 18) {
      if (!history.find(h => h.phien === phien)) {
        const { du_doan } = predictVIP(history);
        const entry = { phien, ket_qua, xuc_xac: [x1, x2, x3], tong_xuc_xac: tong };

        // thống kê đúng/sai
        if (history.length > 0 && du_doan) {
          stats.tong_du_doan++;
          const last = history[history.length - 1];
          if (last.du_doan && last.du_doan === entry.ket_qua) stats.dung++;
          else if (last.du_doan) stats.sai++;
        }

        history.push({ ...entry, du_doan });
        while (history.length > MAX_HISTORY) history.shift();

        saveHistory();
        console.log(`✅ Phiên ${phien}: ${ket_qua} (${tong})`);
      }
    }
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// 🔹 API chính
app.get("/sunwinapi", (req, res) => {
  const latest = history[history.length - 1] || {};
  const { du_doan, thuat_toan } = predictVIP(history);

  const tileDung =
    stats.tong_du_doan > 0
      ? ((stats.dung / stats.tong_du_doan) * 100).toFixed(1) + "%"
      : "0%";

  res.json({
    phiên: latest.phien || 0,
    kết_quả: latest.ket_qua || "Đang cập nhật",
    xúc_xắc: latest.xuc_xac || [0, 0, 0],
    tổng_xúc_xắc: latest.tong_xuc_xac || 0,
    dự_đoán: du_doan,
    thuật_toán: thuat_toan,
    pattern: buildPattern(history),
    số_phiên_dự_đoán: stats.tong_du_doan,
    số_lần_đúng: stats.dung,
    số_lần_sai: stats.sai,
    tỉ_lệ_đúng: tileDung,
    id: "@minhsangdangcap"
  });
});

// 🔹 Chạy định kỳ 5s/lần
setInterval(fetchOnceAndSave, 5000);

// 🔹 Khởi động
app.listen(PORT, () => {
  loadHistory();
  console.log(`🚀 BOTRUMSUNWIN VIP PRO V2 đang chạy tại cổng ${PORT}`);
});
