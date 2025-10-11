// ✅ BOTRUMSUNWIN VIP AI PRO (By @minhsangdangcap)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_API = "https://hackvn.xyz/apisun.php";
const DATA_FILE = "./data.json";
const MAX_HISTORY = 20;

let history = [];
let stats = { tong_du_doan: 0, dung: 0, sai: 0 };

// 🔹 Load dữ liệu
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

// 🔹 Lưu dữ liệu
function saveHistory() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ history, stats }, null, 2),
    "utf8"
  );
}

// 🔹 Tạo pattern
function buildPattern(list) {
  return list.map(h => (h.ket_qua === "Tài" ? "t" : "x")).join("");
}

// 🔹 Thuật toán VIP + AI CẤP CAO
function predictVIP(hist) {
  // Nếu chưa đủ dữ liệu, phân tích AI dựa vào tổng xúc xắc
  if (hist.length < 5) {
    if (hist.length === 0)
      return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "Khởi tạo ngẫu nhiên" };

    const avgTong = hist.reduce((a, b) => a + b.tong_xuc_xac, 0) / hist.length;
    const last = hist[hist.length - 1];
    if (avgTong > 10 && last.tong_xuc_xac >= 10)
      return { du_doan: "Tài", thuat_toan: "AI phân tích tổng xúc xắc" };
    if (avgTong < 11 && last.tong_xuc_xac <= 11)
      return { du_doan: "Xỉu", thuat_toan: "AI phân tích tổng xúc xắc" };
    return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "AI khởi động" };
  }

  const results = hist.map(h => h.ket_qua);
  const last3 = results.slice(-3);
  const last5 = results.slice(-5);
  const last10 = results.slice(-10);
  const last20 = results.slice(-20);

  // 1️⃣ Chuỗi dài → đảo
  if (last5.every(r => r === last5[0]))
    return { du_doan: last5[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Đảo chuỗi dài" };

  // 2️⃣ Xen kẽ
  let alt = true;
  for (let i = 1; i < last5.length; i++)
    if (last5[i] === last5[i - 1]) alt = false;
  if (alt)
    return {
      du_doan: last3[last3.length - 1] === "Tài" ? "Xỉu" : "Tài",
      thuat_toan: "Xen kẽ chu kỳ"
    };

  // 3️⃣ Cân bằng ngắn (10 phiên)
  const tai10 = last10.filter(r => r === "Tài").length;
  if (tai10 >= 7) return { du_doan: "Xỉu", thuat_toan: "Cân bằng 10" };
  if (tai10 <= 3) return { du_doan: "Tài", thuat_toan: "Cân bằng 10" };

  // 4️⃣ Cân bằng dài (20 phiên)
  const tai20 = last20.filter(r => r === "Tài").length;
  const ratio = tai20 / last20.length;
  if (ratio >= 0.65) return { du_doan: "Xỉu", thuat_toan: "Cân bằng 20" };
  if (ratio <= 0.35) return { du_doan: "Tài", thuat_toan: "Cân bằng 20" };

  // 5️⃣ Mẫu đặc biệt
  if (last3.join("") === "TTX") return { du_doan: "Tài", thuat_toan: "Pattern TTX" };
  if (last3.join("") === "XXT") return { du_doan: "Xỉu", thuat_toan: "Pattern XXT" };

  // 6️⃣ Sau 3 cùng → đảo
  if (last3.every(r => r === last3[0]))
    return { du_doan: last3[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Đảo sau 3 cùng" };

  // 7️⃣ Trọng số xu hướng (weighted momentum)
  let wT = 0, wX = 0;
  last20.forEach((r, i) => {
    const w = (i + 1) / last20.length;
    if (r === "Tài") wT += w; else wX += w;
  });
  if (Math.abs(wT - wX) > 2)
    return {
      du_doan: wT > wX ? "Xỉu" : "Tài",
      thuat_toan: "Xu hướng trọng số"
    };

  // 8️⃣ Xu hướng tăng / giảm
  const trend = last10.map(r => (r === "Tài" ? 1 : -1)).reduce((a, b) => a + b, 0);
  if (trend >= 5) return { du_doan: "Tài", thuat_toan: "Xu hướng tăng" };
  if (trend <= -5) return { du_doan: "Xỉu", thuat_toan: "Xu hướng giảm" };

  // 9️⃣ AI phân tích tổng trung bình gần nhất
  const avg = hist.slice(-5).reduce((a, b) => a + b.tong_xuc_xac, 0) / 5;
  if (avg >= 11.5) return { du_doan: "Tài", thuat_toan: "AI trung bình tổng" };
  if (avg <= 10.5) return { du_doan: "Xỉu", thuat_toan: "AI trung bình tổng" };

  // 🔟 fallback thông minh
  const tai5 = last5.filter(r => r === "Tài").length;
  return { du_doan: tai5 >= 3 ? "Tài" : "Xỉu", thuat_toan: "Đa số 5 gần nhất" };
}

// 🔹 Fetch dữ liệu
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
        // 🔮 Lấy dự đoán trước khi có kết quả mới
        const { du_doan } = predictVIP(history);
        const entry = { phien, ket_qua, xuc_xac: [x1, x2, x3], tong_xuc_xac: tong, du_doan };

        // Cập nhật thống kê đúng/sai cho phiên trước đó
        if (history.length > 0) {
          const prev = history[history.length - 1];
          if (prev.du_doan) {
            stats.tong_du_doan++;
            if (prev.du_doan === ket_qua) stats.dung++;
            else stats.sai++;
          }
        }

        history.push(entry);
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

// 🔹 Auto cập nhật
setInterval(fetchOnceAndSave, 5000);

// 🔹 Khởi động
app.listen(PORT, () => {
  loadHistory();
  console.log(`🚀 BOTRUMSUNWIN VIP AI PRO đang chạy tại cổng ${PORT}`);
});
