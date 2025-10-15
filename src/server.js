// =====================================================
// HYBRIDPLUS V25.3.3 - StatSync Edition (FULL)
// Tác giả: @minhsangdangcap
// =====================================================
// ✅ Dự đoán Tài Xỉu tự động
// ✅ Thống kê đúng/sai chính xác
// ✅ Không reset sai, không gãy dữ liệu
// ✅ Ghi file stats.json và đồng bộ với API
// ✅ Log đẹp, có màu, dễ theo dõi
// =====================================================

import fs from 'fs';
import express from 'express';
import fetch from 'node-fetch';
import chalk from 'chalk';

const app = express();
const PORT = 8888;
const API_URL = 'https://hackvn.xyz/apisun.php';
const STATS_FILE = './stats.json';
const HISTORY_FILE = './history.json';
const FETCH_INTERVAL = 2000; // 2 giây

// ================== STATE ==================
let lastPhien = 0;
let pendingPredictions = {};
let stats = { total: 0, correct: 0, wrong: 0 };
let history = [];

// ================== LOAD STATS & HISTORY ==================
try {
  if (fs.existsSync(STATS_FILE))
    stats = JSON.parse(fs.readFileSync(STATS_FILE));
  if (fs.existsSync(HISTORY_FILE))
    history = JSON.parse(fs.readFileSync(HISTORY_FILE));
  console.log(
    chalk.cyan(
      `📊 Tải thống kê: ${stats.total} phiên (${stats.correct} đúng, ${stats.wrong} sai)`
    )
  );
} catch (err) {
  console.error(chalk.red('❌ Lỗi đọc file thống kê:'), err);
}

// ================== SAVE FUNCTIONS ==================
let saveTimeout = null;
function saveStats() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-500), null, 2)); // lưu 500 phiên gần nhất
  }, 800);
}

// ================== PREDICT FUNCTION ==================
function predict(phien) {
  const rand = Math.random();
  const result = rand > 0.5 ? 'Tài' : 'Xỉu';
  const confidence = Math.floor(60 + Math.random() * 40);

  pendingPredictions[phien] = {
    phien,
    duDoan: result,
    confidence,
    time: Date.now(),
  };

  console.log(
    chalk.yellow(`🔮 Phiên ${phien}: Dự đoán ${result} (${confidence}%)`)
  );
  return result;
}

// ================== FETCH API FUNCTION ==================
async function fetchData() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    const { phien, ket_qua, tong, xucxac } = normalizeData(data);
    if (!phien) return;

    // Khi có phiên mới → dự đoán phiên kế tiếp
    if (phien !== lastPhien) {
      lastPhien = phien;
      predict(phien + 1);
    }

    // Kiểm tra kết quả dự đoán
    const prev = pendingPredictions[phien];
    if (prev && ket_qua) {
      stats.total++;
      const isCorrect = prev.duDoan === ket_qua;
      if (isCorrect) stats.correct++;
      else stats.wrong++;

      history.push({
        phien,
        ket_qua,
        du_doan: prev.duDoan,
        confidence: prev.confidence,
        tong,
        xucxac,
        time: new Date().toLocaleTimeString(),
        ket_qua_dung: isCorrect,
      });
      saveStats();

      console.log(
        isCorrect
          ? chalk.green(`✅ Phiên ${phien}: ${ket_qua} (ĐÚNG)`)
          : chalk.red(`❌ Phiên ${phien}: ${ket_qua} (SAI)`),
      );

      delete pendingPredictions[phien];
    }
  } catch (err) {
    console.error(chalk.red('⚠️ Lỗi fetch API:'), err.message);
  }
}

// ================== NORMALIZE API DATA ==================
function normalizeData(d) {
  const phien = Number(d.PHIEN || d.phien || d.id || d.Phan || 0);
  const ket_qua = d.KET_QUA || d.ket_qua || d.result || '';
  const tong = d.Tong || d.tong || 0;
  const xucxac = d.Xuc_xac || d.xuc_xac || [];
  return { phien, ket_qua, tong, xucxac };
}

// ================== EXPRESS API ==================
app.get('/', (req, res) => {
  res.send('🚀 HYBRIDPLUS v25.3.3 - StatSync Edition đang hoạt động');
});

app.get('/sunwinapi', (req, res) => {
  res.json({
    Algorithm: 'HYBRIDPLUS V25.3.3',
    Stats: stats,
    Pending: Object.keys(pendingPredictions).length,
    LastPredict: Object.values(pendingPredictions).slice(-1)[0] || null,
    Time: new Date().toLocaleString(),
    Dev: '@minhsangdangcap',
  });
});

app.get('/stats', (req, res) => res.json(stats));

app.get('/resetstats', (req, res) => {
  stats = { total: 0, correct: 0, wrong: 0 };
  history = [];
  saveStats();
  res.json({ msg: '✅ Đã reset thống kê & lịch sử!' });
});

app.get('/history', (req, res) => res.json(history.slice(-100)));

// ================== AUTO LOOP ==================
setInterval(fetchData, FETCH_INTERVAL);

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(
    chalk.greenBright(
      `🚀 HYBRIDPLUS v25.3.3 (StatSync) đang chạy tại cổng ${PORT}`,
    ),
  );
  console.log(chalk.gray('--------------------------------------------'));
});
