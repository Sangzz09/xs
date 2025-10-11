// ✅ BOTRUMSUNWIN API (Final Menchining Edition)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ Cấu hình
const SOURCE_API = "https://hackvn.xyz/apisun.php"; // API gốc
const DATA_FILE = "./data.json"; // lưu 20 cầu gần nhất
const FULL_FILE = "./full_history.json"; // lưu toàn bộ lịch sử
const MAX_HISTORY = 20; // chỉ hiển thị 20 cầu gần nhất

let history = [];
let fullHistory = [];

// 🔹 Load dữ liệu cũ
function loadHistory() {
  try {
    if (fs.existsSync(DATA_FILE))
      history = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (fs.existsSync(FULL_FILE))
      fullHistory = JSON.parse(fs.readFileSync(FULL_FILE, "utf8"));
    console.log(`📂 Đã load ${history.length}/${fullHistory.length} phiên`);
  } catch (err) {
    console.error("❌ Lỗi load dữ liệu:", err.message);
  }
}

// 🔹 Lưu dữ liệu
function saveHistory() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
  fs.writeFileSync(FULL_FILE, JSON.stringify(fullHistory, null, 2));
}

// 🔹 Tạo pattern (t/x)
function buildPattern(list) {
  return list.map(h => (h.result === "Tài" ? "t" : "x")).join("");
}

// 🔮 Thuật toán dự đoán cấp cao (Menchining logic)
function predictAdvanced(hist) {
  if (hist.length < 4)
    return { du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu", thuat_toan: "Random Base" };

  const results = hist.map(h => h.result);
  const last3 = results.slice(-3);
  const last4 = results.slice(-4);
  const last5 = results.slice(-5);
  const last10 = results.slice(-10);
  const last20 = results.slice(-20);

  // --- 1. Lặp dài ---
  if (last5.every(r => r === last5[0]))
    return { du_doan: last5[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Lặp dài" };

  // --- 2. Xen kẽ ---
  let alt = true;
  for (let i = 1; i < last4.length; i++) if (last4[i] === last4[i - 1]) alt = false;
  if (alt)
    return {
      du_doan: last4[last4.length - 1] === "Tài" ? "Xỉu" : "Tài",
      thuat_toan: "Xen kẽ"
    };

  // --- 3. Cân bằng 10 ---
  const taiCount10 = last10.filter(r => r === "Tài").length;
  if (taiCount10 >= 8) return { du_doan: "Xỉu", thuat_toan: "Cân bằng 10" };
  if (last10.length - taiCount10 >= 8)
    return { du_doan: "Tài", thuat_toan: "Cân bằng 10" };

  // --- 4. Pattern đặc biệt ---
  if (last3.join("") === "TTX") return { du_doan: "Tài", thuat_toan: "Pattern TTX" };
  if (last3.join("") === "XXT") return { du_doan: "Xỉu", thuat_toan: "Pattern XXT" };

  // --- 5. Đảo sau 3 cùng ---
  if (last3.every(r => r === last3[0]))
    return { du_doan: last3[0] === "Tài" ? "Xỉu" : "Tài", thuat_toan: "Đảo sau 3 cùng" };

  // --- 6. Weighted Probability ---
  let taiScore = 0,
    xiuScore = 0;
  last20.forEach((r, i) => {
    const weight = (i + 1) / last20.length;
    if (r === "Tài") taiScore += weight;
    else xiuScore += weight;
  });
  const diff = Math.abs(taiScore - xiuScore);
  if (diff >= 2)
    return {
      du_doan: taiScore > xiuScore ? "Xỉu" : "Tài",
      thuat_toan: "Weighted Probability"
    };

  // --- 7. Momentum Trend ---
  const trend = last10.map(r => (r === "Tài" ? 1 : -1)).reduce((a, b) => a + b, 0);
  if (trend >= 6) return { du_doan: "Tài", thuat_toan: "Momentum ↑" };
  if (trend <= -6) return { du_doan: "Xỉu", thuat_toan: "Momentum ↓" };

  // --- 8. Reversal Detection ---
  const last6 = results.slice(-6);
  let changes = 0;
  for (let i = 1; i < last6.length; i++)
    if (last6[i] !== last6[i - 1]) changes++;
  if (changes >= 4)
    return {
      du_doan: last6[last6.length - 1] === "Tài" ? "Xỉu" : "Tài",
      thuat_toan: "Reversal Detection"
    };

  // --- 9. Pattern Similarity ---
  if (hist.length > 25) {
    const pattern5 = results.slice(-5).join("");
    const similar = hist
      .map((h, i) => {
        if (i < hist.length - 6) {
          const seq = results.slice(i, i + 5).join("");
          const next = results[i + 5];
          return seq === pattern5 ? next : null;
        }
      })
      .filter(Boolean);
    if (similar.length >= 3) {
      const taiNext = similar.filter(r => r === "Tài").length;
      const xiuNext = similar.filter(r => r === "Xỉu").length;
      if (taiNext > xiuNext)
        return { du_doan: "Tài", thuat_toan: "Pattern Similarity" };
      if (xiuNext > taiNext)
        return { du_doan: "Xỉu", thuat_toan: "Pattern Similarity" };
    }
  }

  // --- 10. Dynamic Bias Adjust ---
  const totalTai = hist.filter(h => h.result === "Tài").length;
  const ratio = totalTai / hist.length;
  if (ratio >= 0.65) return { du_doan: "Xỉu", thuat_toan: "Bias Adjust" };
  if (ratio <= 0.35) return { du_doan: "Tài", thuat_toan: "Bias Adjust" };

  // --- fallback ---
  const taiIn5 = last5.filter(r => r === "Tài").length;
  return { du_doan: taiIn5 >= 3 ? "Tài" : "Xỉu", thuat_toan: "Đa số 5 (Fallback)" };
}

// 🔹 Fetch dữ liệu mỗi 5s
async function fetchOnceAndSave() {
  try {
    const res = await axios.get(SOURCE_API);
    const item = res.data;

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
        console.log(`✅ Phiên ${phien}: ${ket_qua} (t=${tong}) — ${history.length}/20`);
      }
    }
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// 🔹 Endpoint chính
app.get("/sunwinapi", (req, res) => {
  const latest = history[history.length - 1] || {};
  const { du_doan, thuat_toan } = predictAdvanced(history);

  res.json({
    phien: latest.phien || 0,
    ket_qua: latest.result || "Đang cập nhật",
    xuc_xac: latest.xuc_xac || [0, 0, 0],
    tong_xuc_xac: latest.tong_xuc_xac || 0,
    du_doan,
    pattern: buildPattern(history),
    thuat_toan,
    id: "@minhsangdangcap"
  });
});

// 🔹 Xem toàn bộ lịch sử
app.get("/fullhistory", (req, res) => {
  res.json({
    total: fullHistory.length,
    fullHistory
  });
});

// 🔹 Cập nhật mỗi 5s
setInterval(fetchOnceAndSave, 5000);

// 🔹 Khởi động server
app.listen(PORT, () => {
  loadHistory();
  console.log(`🚀 Botrumsunwin API Menchining đang chạy tại cổng ${PORT}`);
});
