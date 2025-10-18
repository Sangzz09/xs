// server.js
// Project: botrumsunwinapi (v4.0 - persistent state + auto-reset mỗi 15 phiên)
// Endpoint: /sunwinapi
// Nguồn dữ liệu: https://hackvn.xyz/apisun.php

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SOURCE_API = 'https://hackvn.xyz/apisun.php';
const DATA_FILE = path.join(__dirname, 'data.json'); // file lưu trạng thái

// ======= State in-memory (will persist to DATA_FILE) =======
let history = []; // mỗi phần tử: { phien, result, predicted, thuat_toan, correct (true/false/null), correctChecked (bool), xuc_xac, tong, timestamp }
let correctCount = 0;
let incorrectCount = 0;
let processedSinceReset = 0; // tăng khi thêm phiên; nếu >=15 -> reset (giữ 5)
const AUTO_RESET_THRESHOLD = 15;
const KEEP_AFTER_RESET = 5;
let lastSavedAt = 0;

// ======= Helpers =======
function safeLast(arr, n) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  return arr.slice(-n);
}
function countIn(arr, val) {
  return arr.filter(x => x === val).length;
}

// ======= Persistence =======
async function loadState() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    history = obj.history || [];
    correctCount = obj.correctCount || 0;
    incorrectCount = obj.incorrectCount || 0;
    processedSinceReset = obj.processedSinceReset || 0;
    console.log('🟢 State loaded from', DATA_FILE);
  } catch (err) {
    // nếu file không tồn tại thì bắt đầu từ state rỗng
    console.log('ℹ️ No saved state found, starting fresh.');
    history = [];
    correctCount = 0;
    incorrectCount = 0;
    processedSinceReset = 0;
  }
}

async function saveState() {
  try {
    const obj = {
      history,
      correctCount,
      incorrectCount,
      processedSinceReset,
      savedAt: Date.now()
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
    lastSavedAt = Date.now();
    // console.log('💾 State saved to', DATA_FILE);
  } catch (err) {
    console.error('❌ Lỗi khi lưu state:', err.message);
  }
}

// ======= Thuật toán dự đoán (tập hợp "cầu") =======
function predictAdvanced(hist) {
  const n = Array.isArray(hist) ? hist.length : 0;
  if (n < 3) {
    return { du_doan: Math.random() > 0.5 ? 'Tài' : 'Xỉu', thuat_toan: 'Ngẫu nhiên (ít dữ liệu)', confidence: 0.45 };
  }

  const results = hist.map(h => h.result);
  const last2 = safeLast(results, 2);
  const last3 = safeLast(results, 3);
  const last4 = safeLast(results, 4);
  const last5 = safeLast(results, 5);
  const last6 = safeLast(results, 6);
  const last10 = safeLast(results, 10);
  const last15 = safeLast(results, 15);

  // 1) Cầu bệt >=5 -> đảo
  if (last5.length >= 5 && last5.every(r => r === last5[0])) {
    return { du_doan: last5[0] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Cầu bệt (>=5) -> Đảo', confidence: 0.85 };
  }

  // 2) Xen kẽ trong 4 -> đảo
  if (last4.length >= 4) {
    let isAlt = true;
    for (let i = 1; i < last4.length; i++) {
      if (last4[i] === last4[i - 1]) { isAlt = false; break; }
    }
    if (isAlt) {
      return { du_doan: last4[last4.length - 1] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Cầu xen kẽ', confidence: 0.75 };
    }
  }

  // 3) Cặp đôi TTXX
  if (last4.length === 4 && last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    return { du_doan: last4[2], thuat_toan: 'Cặp đôi TT|XX', confidence: 0.7 };
  }

  // 4) Đảo sau 3 cùng / 2 cùng
  if (last3.length === 3 && last3.every(r => r === last3[0])) {
    return { du_doan: last3[0] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Đảo sau 3 cùng', confidence: 0.82 };
  }
  if (last2.length === 2 && last2[0] === last2[1]) {
    return { du_doan: last2[0] === 'Tài' ? 'Xỉu' : 'Tài', thuat_toan: 'Đảo sau 2 cùng', confidence: 0.65 };
  }

  // 5) Trend 3/4
  if (last4.length >= 4) {
    const taiIn4 = countIn(last4, 'Tài');
    if (taiIn4 >= 3) return { du_doan: 'Tài', thuat_toan: 'Trend 3/4', confidence: 0.72 };
    if (taiIn4 <= 1) return { du_doan: 'Xỉu', thuat_toan: 'Trend 3/4', confidence: 0.72 };
  }

  // 6) Chu kỳ 6
  if (last6.length === 6) {
    const first3 = last6.slice(0, 3).join('');
    const last3Str = last6.slice(3, 6).join('');
    if (first3 === last3Str) {
      return { du_doan: last6[0], thuat_toan: 'Chu kỳ 6', confidence: 0.78 };
    }
  }

  // 7) Markov (cơ bản) nếu có nhiều dữ liệu
  if (n >= 15) {
    let taiToXiu = 0, taiToTai = 0, xiuToTai = 0, xiuToXiu = 0;
    for (let i = 1; i < hist.length; i++) {
      if (hist[i - 1].result === 'Tài') {
        if (hist[i].result === 'Xỉu') taiToXiu++; else taiToTai++;
      } else {
        if (hist[i].result === 'Tài') xiuToTai++; else xiuToXiu++;
      }
    }
    const last = results[results.length - 1];
    if (last === 'Tài') {
      const pred = taiToXiu > taiToTai ? 'Xỉu' : 'Tài';
      return { du_doan: pred, thuat_toan: 'Markov (Tài->?)', confidence: 0.6 };
    } else {
      const pred = xiuToTai > xiuToXiu ? 'Tài' : 'Xỉu';
      return { du_doan: pred, thuat_toan: 'Markov (Xỉu->?)', confidence: 0.6 };
    }
  }

  // 8) Độ lệch chuẩn 15 phiên
  if (last15.length >= 15) {
    const taiCount = countIn(last15, 'Tài');
    const ratio = taiCount / 15;
    if (ratio >= 0.75) return { du_doan: 'Xỉu', thuat_toan: 'Lệch chuẩn 15 (T nhiều) -> Đảo', confidence: 0.78 };
    if (ratio <= 0.25) return { du_doan: 'Tài', thuat_toan: 'Lệch chuẩn 15 (X nhiều) -> Đảo', confidence: 0.78 };
  }

  // 9) Pattern TTX / XXT (dự đoán lặp lại)
  if (last3.length === 3) {
    if (last3[0] === 'Tài' && last3[1] === 'Tài' && last3[2] === 'Xỉu') return { du_doan: 'Tài', thuat_toan: 'Pattern TTX', confidence: 0.66 };
    if (last3[0] === 'Xỉu' && last3[1] === 'Xỉu' && last3[2] === 'Tài') return { du_doan: 'Xỉu', thuat_toan: 'Pattern XXT', confidence: 0.66 };
  }

  // Fallback: đa số trong 5
  const taiIn5 = countIn(last5, 'Tài');
  return { du_doan: taiIn5 >= 3 ? 'Tài' : 'Xỉu', thuat_toan: 'Đa số 5 (fallback)', confidence: 0.55 };
}

// ======= Endpoint chính =======
app.get('/sunwinapi', async (req, res) => {
  try {
    // Lấy dữ liệu nguồn
    const response = await axios.get(SOURCE_API, { timeout: 8000 });
    const item = response.data;

    const phien = parseInt(item.phien);
    const x1 = parseInt(item.xuc_xac_1);
    const x2 = parseInt(item.xuc_xac_2);
    const x3 = parseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = (item.ket_qua || '').trim() === 'Tài' ? 'Tài' : 'Xỉu';

    if (isNaN(phien) || isNaN(tong) || tong < 3 || tong > 18) {
      throw new Error('Dữ liệu nguồn không hợp lệ');
    }

    // 1) Tạo dự đoán cho "phiên kế tiếp" dựa trên lịch sử hiện tại (chưa push kết quả mới)
    const prediction = predictAdvanced(history);

    // 2) Nếu có phiên trước trong history mà đã có predicted nhưng chưa check đúng/sai -> so sánh với kết quả hiện tại
    if (history.length > 0) {
      const last = history[history.length - 1];
      // last.predicted là dự đoán đã lưu trước đó cho phiên sau nó.
      if (last.predicted && !last.correctChecked) {
        last.correct = (last.predicted === ket_qua);
        last.correctChecked = true;
        if (last.correct) correctCount++;
        else incorrectCount++;
      }
    }

    // 3) Nếu phien mới hơn so với phien cuối history thì push record mới (kèm predicted vừa tạo)
    if (history.length === 0 || history[history.length - 1].phien !== phien) {
      const record = {
        phien,
        result: ket_qua,
        predicted: prediction.du_doan,      // dự đoán cho phiên kế tiếp (lưu kèm)
        thuat_toan: prediction.thuat_toan,
        confidence: Math.round((prediction.confidence || 0) * 100) / 100,
        correct: null,
        correctChecked: false,
        xuc_xac: [x1, x2, x3],
        tong,
        timestamp: Date.now()
      };
      history.push(record);

      // tăng bộ đếm processedSinceReset
      processedSinceReset++;

      // Nếu đạt ngưỡng reset -> giữ lại KEEP_AFTER_RESET phiên gần nhất
      if (processedSinceReset >= AUTO_RESET_THRESHOLD) {
        const kept = safeLast(history, KEEP_AFTER_RESET);
        history = kept.map(h => {
          // reset correctChecked nếu cần (giữ nguyên đúng/sai đã check nếu có)
          return {
            phien: h.phien,
            result: h.result,
            predicted: h.predicted,
            thuat_toan: h.thuat_toan,
            confidence: h.confidence,
            correct: h.correct,
            correctChecked: h.correctChecked,
            xuc_xac: h.xuc_xac,
            tong: h.tong,
            timestamp: h.timestamp
          };
        });
        processedSinceReset = 0;
        console.log(`♻️ Auto-reset sau ${AUTO_RESET_THRESHOLD} phiên — giữ lại ${KEEP_AFTER_RESET} phiên gần nhất.`);
      }

      // Giữ tổng history không quá lớn (để tránh memory leak), tối đa 500
      if (history.length > 500) history = safeLast(history, 500);

      // Lưu state vào file
      saveState().catch(err => console.error('Lỗi khi lưu state:', err.message));
    }

    // Tạo pattern hiện tại (sau khi push)
    const pattern = history.map(h => h.result === 'Tài' ? 't' : 'x').join('');

    res.json({
      phien,
      ket_qua,
      xuc_xac: [x1, x2, x3],
      tong_xuc_xac: tong,
      du_doan_ke_tiep: prediction.du_doan,
      thuat_toan: prediction.thuat_toan,
      confidence: Math.round((prediction.confidence || 0) * 100) / 100,
      pattern,
      correctCount,
      incorrectCount,
      history_length: history.length,
      processedSinceReset,
      id: "@minhsangdangcap"
    });
  } catch (err) {
    console.error('❌ Lỗi khi gọi /sunwinapi:', err.message);
    res.status(500).json({
      phien: 0,
      ket_qua: "Lỗi",
      xuc_xac: [0,0,0],
      tong_xuc_xac: 0,
      du_doan_ke_tiep: "Lỗi",
      thuat_toan: "Lỗi hệ thống",
      correctCount,
      incorrectCount,
      history_length: history.length,
      id: "@minhsangdangcap"
    });
  }
});

// ======= Optional: endpoint trả về toàn bộ history + stats (truy vấn nội bộ) =======
app.get('/stats', (req, res) => {
  // Trả về summary và 20 phiên gần nhất
  const recent = safeLast(history, 20);
  res.json({
    correctCount,
    incorrectCount,
    history_length: history.length,
    processedSinceReset,
    recent,
  });
});

app.get('/', (req, res) => {
  res.json({ message: "✅ botrumsunwinapi - SUN.WIN (v4.0 persistent + auto-reset)", endpoint: "/sunwinapi" });
});

// ======= Start: load saved state trước khi listen =======
(async () => {
  await loadState();
  // lưu state ban đầu (để tạo file nếu chưa có)
  await saveState();
  app.listen(PORT, () => console.log(`🚀 Server chạy trên cổng ${PORT}`));
})();
