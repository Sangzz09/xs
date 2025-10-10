// server.js
// Project: botrumsunwinapi
// Endpoint: /sunwinapi
// Nguồn: https://hackvn.xyz/apisun.php

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SOURCE_API = 'https://hackvn.xyz/apisun.php';

// Lưu lịch sử theo thứ tự: [cũ nhất, ..., mới nhất]
let history = [];

// 🔮 10 THUẬT TOÁN DỰ ĐOÁN
function predictAdvanced(hist) {
  if (hist.length < 4) {
    return { du_doan: Math.random() > 0.5 ? 'Tài' : 'Xỉu', thuat_toan: 'Dữ liệu ít' };
  }

  const results = hist.map(h => h.result);
  const last3 = results.slice(-3);
  const last4 = results.slice(-4);
  const last5 = results.slice(-5);
  const last10 = results.slice(-10);
  const last15 = results.slice(-15);

  // 1. Lặp ≥5
  if (last5.length >= 5 && last5.every(r => r === last5[0])) {
    return { du_doan: last5[0] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Lặp dài' };
  }

  // 2. Xen kẽ
  if (last4.length >= 4) {
    let isAlt = true;
    for (let i = 1; i < last4.length; i++) {
      if (last4[i] === last4[i - 1]) {
        isAlt = false;
        break;
      }
    }
    if (isAlt) {
      return { du_doan: last4[last4.length - 1] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Xen kẽ' };
    }
  }

  // 3. Cân bằng 10
  const taiCount10 = last10.filter(r => r === 'Tài').length;
  if (taiCount10 >= 8) return { du_doan: 'Xỉu', thuat_toan: 'Cân bằng 10' };
  if (last10.length - taiCount10 >= 8) return { du_doan: 'Tài', thuat_toan: 'Cân bằng 10' };

  // 4. Trend 3/4
  const taiIn4 = last4.filter(r => r === 'Tài').length;
  if (taiIn4 >= 3) return { du_doan: 'Tài', thuat_toan: 'Trend 3/4' };
  if (taiIn4 <= 1) return { du_doan: 'Xỉu', thuat_toan: 'Trend 3/4' };

  // 5. Pattern TTX / XXT
  if (last3.length >= 3) {
    if (last3[0] === 'Tài' && last3[1] === 'Tài' && last3[2] === 'Xỉu') {
      return { du_doan: 'Tài', thuat_toan: 'Pattern TTX' };
    }
    if (last3[0] === 'Xỉu' && last3[1] === 'Xỉu' && last3[2] === 'Tài') {
      return { du_doan: 'Xỉu', thuat_toan: 'Pattern XXT' };
    }
  }

  // 6. Markov Chain
  if (hist.length >= 20) {
    let taiToXiu = 0, taiToTai = 0;
    for (let i = 1; i < hist.length; i++) {
      if (hist[i - 1].result === 'Tài') {
        if (hist[i].result === 'Xỉu') taiToXiu++;
        else taiToTai++;
      }
    }
    if (last3[2] === 'Tài' && taiToXiu > taiToTai * 1.3) {
      return { du_doan: 'Xỉu', thuat_toan: 'Markov Chain' };
    }
  }

  // 7. Cặp đôi TTXX
  if (last4.length === 4 && last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    return { du_doan: last4[0], thuat_toan: 'Cặp đôi TTXX' };
  }

  // 8. Đảo sau 3 cùng
  if (last3.length === 3 && last3.every(r => r === last3[0])) {
    return { du_doan: last3[0] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Đảo sau 3 cùng' };
  }

  // 9. Chu kỳ 6
  if (last6.length === 6) {
    const first3 = last6.slice(0, 3).join('');
    const last3Str = last6.slice(3, 6).join('');
    if (first3 === last3Str) {
      return { du_doan: last6[0], thuat_toan: 'Chu kỳ 6' };
    }
  }

  // 10. Độ lệch chuẩn (15 phiên)
  if (last15.length >= 15) {
    const taiCount15 = last15.filter(r => r === 'Tài').length;
    const ratio = taiCount15 / 15;
    if (ratio >= 0.75) return { du_doan: 'Xỉu', thuat_toan: 'Độ lệch chuẩn' };
    if (ratio <= 0.25) return { du_doan: 'Tài', thuat_toan: 'Độ lệch chuẩn' };
  }

  // Fallback
  const taiIn5 = last5.filter(r => r === 'Tài').length;
  return { du_doan: taiIn5 >= 3 ? 'Tài' : 'Xỉu', thuat_toan: 'Đa số 5' };
}

// 🌐 ENDPOINT CHÍNH
app.get('/sunwinapi', async (req, res) => {
  try {
    const response = await axios.get(SOURCE_API);
    const item = response.data;

    const phien = parseInt(item.phien);
    const x1 = parseInt(item.xuc_xac_1);
    const x2 = parseInt(item.xuc_xac_2);
    const x3 = parseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = item.ket_qua.trim() === "Tài" ? "Tài" : "Xỉu";

    if (isNaN(phien) || isNaN(tong) || tong < 3 || tong > 18) {
      throw new Error('Dữ liệu không hợp lệ');
    }

    // ✅ CẬP NHẬT LỊCH SỬ KẾT QUẢ THẬT (theo thứ tự: cũ → mới)
    if (history.length === 0 || history[history.length - 1].phien !== phien) {
      history.push({ phien, result: ket_qua });
      if (history.length > 50) history.shift(); // giữ 50 phiên mới nhất
    }

    // ✅ TẠO PATTERN TỰ ĐỘNG: "t" cho Tài, "x" cho Xỉu
    const pattern = history.map(h => h.result === 'Tài' ? 't' : 'x').join('');

    // Dự đoán
    const { du_doan, thuat_toan } = predictAdvanced(history);

    res.json({
      phien: phien,
      ket_qua: ket_qua,
      xuc_xac: [x1, x2, x3],
      tong_xuc_xac: tong,
      du_doan: du_doan,
      pattern: pattern, // ← CẬP NHẬT LIÊN TỤC TỪ KẾT QUẢ THẬT
      thuat_toan: thuat_toan,
      id: "@minhsangdangcap"
    });

  } catch (error) {
    console.error('❌ Lỗi:', error.message);
    res.status(500).json({
      phien: 0,
      ket_qua: "Lỗi",
      xuc_xac: [0, 0, 0],
      tong_xuc_xac: 0,
      du_doan: "Lỗi",
      pattern: "",
      thuat_toan: "Lỗi hệ thống",
      id: "@minhsangdangcap"
    });
  }
});

app.get('/', (req, res) => {
  res.json({ message: "✅ botrumsunwinapi - SUN.WIN", endpoint: "/sunwinapi" });
});

app.listen(PORT, () => {
  console.log(`🚀 API chạy trên cổng ${PORT}`);
});
