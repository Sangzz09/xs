// server.js
// Project: botrumsunwinapi - tự động cập nhật + lưu dữ liệu
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SOURCE_API = 'https://hackvn.xyz/apisun.php';

app.use(cors());
app.use(express.json());

// 🧠 Đọc lịch sử cũ từ file (nếu có)
let history = [];
try {
  if (fs.existsSync('data.json')) {
    history = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    console.log(`✅ Đã tải lịch sử cũ: ${history.length} phiên`);
  }
} catch (err) {
  console.error('⚠️ Lỗi đọc file data.json:', err.message);
}

// ✅ Lưu lịch sử ra file
function saveHistory() {
  try {
    fs.writeFileSync('data.json', JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️ Lỗi ghi file:', err.message);
  }
}

// 🔮 10 THUẬT TOÁN DỰ ĐOÁN (giữ nguyên như bản cũ của bạn)
function predictAdvanced(hist) {
  if (hist.length < 4) {
    return { du_doan: Math.random() > 0.5 ? 'Tài' : 'Xỉu', thuat_toan: 'Dữ liệu ít' };
  }

  const results = hist.map(h => h.result);
  const last3 = results.slice(-3);
  const last4 = results.slice(-4);
  const last5 = results.slice(-5);
  const last6 = results.slice(-6);
  const last10 = results.slice(-10);
  const last15 = results.slice(-15);

  if (last5.length >= 5 && last5.every(r => r === last5[0])) {
    return { du_doan: last5[0] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Lặp dài' };
  }

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

  const taiCount10 = last10.filter(r => r === 'Tài').length;
  if (taiCount10 >= 8) return { du_doan: 'Xỉu', thuat_toan: 'Cân bằng 10' };
  if (last10.length - taiCount10 >= 8) return { du_doan: 'Tài', thuat_toan: 'Cân bằng 10' };

  const taiIn4 = last4.filter(r => r === 'Tài').length;
  if (taiIn4 >= 3) return { du_doan: 'Tài', thuat_toan: 'Trend 3/4' };
  if (taiIn4 <= 1) return { du_doan: 'Xỉu', thuat_toan: 'Trend 3/4' };

  if (last3.length >= 3) {
    if (last3[0] === 'Tài' && last3[1] === 'Tài' && last3[2] === 'Xỉu')
      return { du_doan: 'Tài', thuat_toan: 'Pattern TTX' };
    if (last3[0] === 'Xỉu' && last3[1] === 'Xỉu' && last3[2] === 'Tài')
      return { du_doan: 'Xỉu', thuat_toan: 'Pattern XXT' };
  }

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

  if (last4.length === 4 && last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    return { du_doan: last4[0], thuat_toan: 'Cặp đôi TTXX' };
  }

  if (last3.length === 3 && last3.every(r => r === last3[0])) {
    return { du_doan: last3[0] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Đảo sau 3 cùng' };
  }

  if (last6.length === 6) {
    const first3 = last6.slice(0, 3).join('');
    const last3Str = last6.slice(3, 6).join('');
    if (first3 === last3Str) {
      return { du_doan: last6[0], thuat_toan: 'Chu kỳ 6' };
    }
  }

  if (last15.length >= 15) {
    const taiCount15 = last15.filter(r => r === 'Tài').length;
    const ratio = taiCount15 / 15;
    if (ratio >= 0.75) return { du_doan: 'Xỉu', thuat_toan: 'Độ lệch chuẩn' };
    if (ratio <= 0.25) return { du_doan: 'Tài', thuat_toan: 'Độ lệch chuẩn' };
  }

  const taiIn5 = last5.filter(r => r === 'Tài').length;
  return { du_doan: taiIn5 >= 3 ? 'Tài' : 'Xỉu', thuat_toan: 'Đa số 5' };
}

// 🕒 Tự động cập nhật dữ liệu mỗi 10 giây
setInterval(async () => {
  try {
    const response = await axios.get(SOURCE_API);
    const item = response.data;
    const phien = parseInt(item.phien);
    const ket_qua = item.ket_qua.trim() === "Tài" ? "Tài" : "Xỉu";

    if (!isNaN(phien) && (history.length === 0 || history[history.length - 1].phien !== phien)) {
      history.push({ phien, result: ket_qua });
      if (history.length > 100) history.shift();
      saveHistory();
      console.log(`✅ Cập nhật phiên ${phien}: ${ket_qua}`);
    }
  } catch (err) {
    console.error("❌ Lỗi cập nhật tự động:", err.message);
  }
}, 10000); // 10 giây

// 🌐 API chính
app.get('/sunwinapi', (req, res) => {
  const { du_doan, thuat_toan } = predictAdvanced(history);
  res.json({
    phien_moi_nhat: history.length ? history[history.length - 1].phien : 0,
    so_phien: history.length,
    du_doan,
    thuat_toan,
    lich_su: history.slice(-10)
  });
});

// 🌍 Trang chủ
app.get('/', (req, res) => {
  res.json({ message: "✅ botrumsunwinapi - SUN.WIN", endpoint: "/sunwinapi" });
});

app.listen(PORT, () => {
  console.log(`🚀 API chạy trên cổng ${PORT}`);
});
