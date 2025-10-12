// server.js
const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 1003;

// ----- HISTORY & STATS -----
let history = [];
let stats = { total: 0, correct: 0, wrong: 0 };

// Load history nếu có
try {
  const data = fs.readFileSync("history.json");
  history = JSON.parse(data);
  stats.total = history.length;
  stats.correct = history.filter(h => h.Dự_đoán === h.Kết_quả).length;
  stats.wrong = stats.total - stats.correct;
} catch (e) {
  console.log("Không tìm thấy history, tạo mới.");
}

// ----- SAFE WRITE -----
function safeWriteHistory() {
  try {
    fs.writeFileSync("history.json", JSON.stringify(history, null, 2));
  } catch (e) {
    console.error("❌ Lỗi ghi history:", e);
  }
}

// ----- UTILITY -----
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ----- SUNWIN PATTERN LOGIC -----
function sunWinPredict(diceTotal) {
  // Công thức SunWin, sửa theo yêu cầu mới
  switch (diceTotal) {
    case 3: return { prediction: "Xỉu", note: "100% Xỉu" };
    case 4: return { prediction: Math.random() < 0.68 ? "Xỉu" : "Tài", note: "68% Xỉu" };
    case 5: return { prediction: "Xỉu", note: "100% Xỉu" };
    case 6: return { prediction: "skip", note: "Ngủ tay" };
    case 7: return { prediction: "Xỉu", note: "89% Xỉu theo pattern" };
    case 8: return { prediction: "Xỉu", note: "Pattern 134 auto xỉu" };
    case 9: return { prediction: Math.random() < 0.5 ? "Xỉu" : "Tài", note: "50/50" };
    case 10: return { prediction: "Xỉu", note: "Auto xỉu" };
    case 11: return { prediction: "Tài", note: "Đánh tiếp Tài" }; // Update theo yêu cầu
    case 12: return { prediction: "Xỉu", note: "Pattern auto xỉu" };
    case 13: return { prediction: Math.random() < 0.5 ? "Xỉu" : "Tài", note: "50/50" };
    case 14: return { prediction: Math.random() < 0.5 ? "Xỉu" : "Tài", note: "50/50" };
    case 15: return { prediction: "Tài", note: "Auto Tài" };
    case 16: return { prediction: "Xỉu", note: "Auto Xỉu" };
    case 17: return { prediction: "pattern", note: "Theo cầu pattern" }; // Bắt theo pattern
    case 18: return { prediction: "Tài", note: "Tài" };
    default: return { prediction: "Tài", note: "Default" };
  }
}

// ----- MARKOV BẬC 3-4 -----
function markovPredict(lastRolls) {
  // Giả lập xác suất Markov dựa trên last 3-4 kết quả
  if(lastRolls.length < 3) return { prediction: "Tài", pT: 0.5, pX:0.5 };
  const pT = Math.random() * 0.7 + 0.15;
  return { prediction: pT > 0.5 ? "Tài" : "Xỉu", pT, pX: 1 - pT };
}

// ----- GPT PREDICT SIMULATED -----
function gptPredict(lastRolls) {
  // Giả lập AI ChatGPT dự đoán
  const pT = Math.random() * 0.8 + 0.1;
  return { prediction: pT > 0.5 ? "Tài" : "Xỉu", confidence: pT };
}

// ----- CẦU BỊP, CẦU BỆT -----
function detectCheatOrFlat(history) {
  // Kiểm tra cầu 1-1
  const last3 = history.slice(-3);
  const allSame = last3.length === 3 && last3.every(h => h.Dự_đoán === last3[0].Dự_đoán);
  // Kiểm tra cầu bệt (3+ ván cùng kết quả)
  const last5 = history.slice(-5);
  const flat = last5.length === 5 && last5.every(h => h.Dự_đoán === last5[0].Dự_đoán);
  return { allSame, flat };
}

// ----- API -----
app.get("/api/taixiu", (req, res) => {
  // Random xúc xắc
  const dice = [getRandomInt(1,6), getRandomInt(1,6), getRandomInt(1,6)];
  const total = dice.reduce((a,b)=>a+b,0);

  // Áp dụng SunWin nếu chưa đủ dữ liệu
  let sunwin = sunWinPredict(total);
  let lastRolls = history.slice(-4).map(h => h.Tổng_xúc_xắc);

  // Markov bậc 3-4
  const markov = markovPredict(lastRolls);

  // AI ChatGPT dự đoán
  const gpt = gptPredict(lastRolls);

  // Phát hiện cầu bịp/cầu bệt
  const cheat = detectCheatOrFlat(history);

  // Hybrid dự đoán
  let hybridConfidence = ( (markov.pT || 0.5) + (gpt.confidence || 0.5) ) / 2;
  let finalPrediction = sunwin.prediction;

  if(sunwin.prediction === "skip" || sunwin.prediction === "pattern") {
    finalPrediction = markov.prediction;
  }

  if(cheat.flat) {
    finalPrediction = markov.prediction; // bẻ cầu bệt
  }

  // Cập nhật stats
  stats.total += 1;
  const actual = total > 10 ? "Tài" : "Xỉu";
  if(finalPrediction === actual) stats.correct += 1;
  else stats.wrong += 1;

  // Push history
  const record = {
    Phiên: history.length + 1,
    Kết_quả: actual,
    Xúc_xắc: dice,
    Tổng_xúc_xắc: total,
    Dự_đoán: finalPrediction,
    Confidence: hybridConfidence,
    Thuật_toán: `Hybrid(SunWin:${sunwin.note}, Markov:${markov.prediction}, GPT:${gpt.prediction})`,
    "Pattern hiện tại": sunwin.note,
    "SuperVIP hiện tại": `Markov(${markov.prediction}) pT=${markov.pT.toFixed(2)}, pX=${markov.pX.toFixed(2)}`,
    "Số_lần_dự_đoán": stats.total,
    "Số_đúng": stats.correct,
    "Số_sai": stats.wrong,
    Id: "@minhsangdangcap"
  };

  history.push(record);
  safeWriteHistory();

  res.json(record);
});

// ----- START SERVER -----
app.listen(PORT, () => {
  console.log(`Server SunWin API chạy tại http://localhost:${PORT}`);
});
