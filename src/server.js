// ✅ BOTRUMSUNWIN API - VIP PRO AI LEARNING (By @minhsangdangcap)
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

// 🔹 Tạo pattern (t/x)
function buildPattern(list) {
  return list.map(h => (h.ket_qua === "Tài" ? "t" : "x")).join("");
}

// 🔮 Thuật toán VIP Cấp 1–10
function predictBase(hist) {
  if (hist.length < 5)
    return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "Ngẫu nhiên" };

  const results = hist.map(h => h.ket_qua);
  const last3 = results.slice(-3);
  const last5 = results.slice(-5);
  const last10 = results.slice(-10);
  const last20 = results.slice(-20);

  // 1️⃣ Lặp dài
  if (last5.every(r => r === last5[0]))
    return { du_doan: last5[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Đảo chuỗi dài" };

  // 2️⃣ Xen kẽ
  let alternating = true;
  for (let i = 1; i < last3.length; i++)
    if (last3[i] === last3[i - 1]) alternating = false;
  if (alternating)
    return {
      du_doan: last3[last3.length - 1] === "Tài" ? "Xỉu" : "Tài",
      thuat_toan: "Xen kẽ chu kỳ"
    };

  // 3️⃣ Cân bằng 10
  const tai10 = last10.filter(r => r === "Tài").length;
  if (tai10 >= 7) return { du_doan: "Xỉu", thuat_toan: "Cân bằng 10" };
  if (tai10 <= 3) return { du_doan: "Tài", thuat_toan: "Cân bằng 10" };

  // 4️⃣ Pattern đặc biệt
  if (last3.join("") === "TTX") return { du_doan: "Tài", thuat_toan: "Pattern TTX" };
  if (last3.join("") === "XXT") return { du_doan: "Xỉu", thuat_toan: "Pattern XXT" };

  // 5️⃣ Weighted Momentum
  let weightT = 0,
    weightX = 0;
  last20.forEach((r, i) => {
    const w = (i + 1) / last20.length;
    if (r === "Tài") weightT += w;
    else weightX += w;
  });
  if (Math.abs(weightT - weightX) > 2)
    return {
      du_doan: weightT > weightX ? "Xỉu" : "Tài",
      thuat_toan: "Xu hướng trọng số"
    };

  // 6️⃣ Xu hướng tăng giảm
  const trend = last10.map(r => (r === "Tài" ? 1 : -1)).reduce((a, b) => a + b, 0);
  if (trend >= 5) return { du_doan: "Tài", thuat_toan: "Xu hướng tăng" };
  if (trend <= -5) return { du_doan: "Xỉu", thuat_toan: "Xu hướng giảm" };

  // 7️⃣ fallback đa số
  const tai5 = last5.filter(r => r === "Tài").length;
  return { du_doan: tai5 >= 3 ? "Tài" : "Xỉu", thuat_toan: "Đa số 5 gần nhất" };
}

// 🧠 Lớp AI học theo lịch sử
function aiLearning(hist, duDoanGoc) {
  if (hist.length < 10) return { du_doan: duDoanGoc, do_tin_cay: 50 };

  const gan10 = hist.slice(-10);
  const dungGan = gan10.filter(h => h.ket_qua === h.du_doan).length;
  const saiGan = gan10.length - dungGan;
  let tinCay = 60 + (dungGan - saiGan) * 4;

  // điều chỉnh độ tin cậy
  tinCay = Math.max(30, Math.min(95, tinCay));

  // Nếu sai quá 3 lần liên tục, đảo chiều dự đoán
  const chain = hist.slice(-3).map(h => (h.ket_qua === h.du_doan ? "✅" : "❌"));
  if (chain.every(x => x === "❌")) {
    duDoanGoc = duDoanGoc === "Tài" ? "Xỉu" : "Tài";
    tinCay -= 10;
  }

  return { du_doan: duDoanGoc, do_tin_cay: tinCay };
}

// 🔹 Fetch dữ liệu 5s / lần
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
        const base = predictBase(history);
        const ai = aiLearning(history, base.du_doan);
        const du_doan = ai.du_doan;

        const entry = {
          phien,
          ket_qua,
          xuc_xac: [x1, x2, x3],
          tong_xuc_xac: tong,
          du_doan,
          do_tin_cay: ai.do_tin_cay
        };

        // Thống kê đúng/sai
        if (history.length > 0) {
          stats.tong_du_doan++;
          const last = history[history.length - 1];
          if (last.du_doan && last.du_doan === entry.ket_qua) stats.dung++;
          else if (last.du_doan) stats.sai++;
        }

        history.push(entry);
        while (history.length > MAX_HISTORY) history.shift();

        saveHistory();
        console.log(
          `✅ Phiên ${phien}: ${ket_qua} (${tong}) — AI: ${du_doan} (${ai.do_tin_cay}%)`
        );
      }
    }
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// 🔹 API chính
app.get("/sunwinapi", (req, res) => {
  const latest = history[history.length - 1] || {};
  const base = predictBase(history);
  const ai = aiLearning(history, base.du_doan);

  const tileDung =
    stats.tong_du_doan > 0
      ? ((stats.dung / stats.tong_du_doan) * 100).toFixed(1) + "%"
      : "0%";

  res.json({
    phiên: latest.phien || 0,
    kết_quả: latest.ket_qua || "Đang cập nhật",
    xúc_xắc: latest.xuc_xac || [0, 0, 0],
    tổng_xúc_xắc: latest.tong_xuc_xac || 0,
    dự_đoán: ai.du_doan,
    thuật_toán: base.thuat_toan,
    pattern: buildPattern(history),
    độ_tin_cậy: ai.do_tin_cay + "%",
    số_phiên_dự_đoán: stats.tong_du_doan,
    số_lần_đúng: stats.dung,
    số_lần_sai: stats.sai,
    tỉ_lệ_đúng: tileDung,
    id: "@minhsangdangcap"
  });
});

// 🔹 Tự động cập nhật
setInterval(fetchOnceAndSave, 5000);

// 🔹 Chạy server
app.listen(PORT, () => {
  loadHistory();
  console.log(`🚀 BOTRUMSUNWIN AI LEARNING PRO chạy tại cổng ${PORT}`);
});
