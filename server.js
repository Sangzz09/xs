// File: server.js
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// Giả lập lịch sử kết quả SunWin
let history = []; // lưu chuỗi các phiên trước

// Thống kê dự đoán
let stats = {
  total: 0,
  correct: 0,
  wrong: 0
};

// Hàm random xúc xắc
function rollDice() {
  return [rand1to6(), rand1to6(), rand1to6()];
}

function rand1to6() {
  return Math.floor(Math.random() * 6) + 1;
}

// Tính tổng xúc xắc
function sumDice(dice) {
  return dice.reduce((a, b) => a + b, 0);
}

// Xác định kết quả Tài/Xỉu
function getResult(total) {
  return total > 10 ? "Tài" : "Xỉu";
}

// Hàm Markov bậc 3-4
function markovPredict(history) {
  if (history.length < 3) return null; // chưa đủ dữ liệu

  // Chọn bậc: 3 hoặc 4 tùy dữ liệu
  const order = history.length >= 4 ? 4 : 3;
  const lastSeq = history.slice(-order).map(h => h.result).join("");
  const counts = { Tài: 0, Xỉu: 0 };

  // Đếm xác suất xuất hiện tiếp theo trong lịch sử
  for (let i = 0; i <= history.length - order - 1; i++) {
    const seq = history.slice(i, i + order).map(h => h.result).join("");
    if (seq === lastSeq) {
      const next = history[i + order].result;
      counts[next] = (counts[next] || 0) + 1;
    }
  }

  const totalNext = counts["Tài"] + counts["Xỉu"];
  if (totalNext === 0) return null;

  const pT = counts["Tài"] / totalNext;
  const pX = counts["Xỉu"] / totalNext;

  return { prediction: pT >= pX ? "Tài" : "Xỉu", pT, pX, order };
}

// Hàm áp dụng SunWin Formula
function sunwinFormula(diceSum, history) {
  // Rule mới theo yêu cầu
  if (diceSum === 11) return "Tài";
  if (diceSum === 17) {
    // Theo pattern nếu có
    if (history.length >= 2) {
      const last = history[history.length - 2].result;
      return last === "Xỉu" ? "Tài" : "Xỉu";
    }
    return "Xỉu";
  }
  // Rule khác (tham khảo)
  if (diceSum <= 5) return "Xỉu";
  if (diceSum >= 15) return "Tài";
  return null;
}

// Nhận diện cầu bệt / 1-1
function detectPattern(history) {
  if (history.length < 2) return null;
  const last = history[history.length - 1].result;
  const secondLast = history[history.length - 2].result;

  if (last === secondLast) return "Cầu bệt";
  if (last !== secondLast) return "Cầu 1-1";
  return null;
}

// AI/ChatGPT Hybrid giả lập dự đoán (tăng confidence)
function aiHybridPredict(diceSum, markovPrediction) {
  let base = markovPrediction ? markovPrediction.prediction : null;
  let confidence = markovPrediction ? Math.max(markovPrediction.pT, markovPrediction.pX) : 0.5;

  // AI bổ sung rule
  if (!base) {
    base = diceSum > 10 ? "Tài" : "Xỉu";
    confidence = 0.6;
  } else {
    confidence = Math.min(confidence + 0.15, 0.95);
  }

  return { prediction: base, confidence };
}

// API SunWin
app.get("/sunwinapi", (req, res) => {
  const dice = rollDice();
  const total = sumDice(dice);
  const result = getResult(total);

  const markov = markovPredict(history);
  const aiPred = aiHybridPredict(total, markov);

  let sunwinPred = null;
  if (!markov) {
    sunwinPred = sunwinFormula(total, history);
    if (sunwinPred) {
      aiPred.prediction = sunwinPred;
      aiPred.confidence = 0.75;
    }
  }

  const pattern = detectPattern(history);

  stats.total += 1;
  if (aiPred.prediction === result) stats.correct += 1;
  else stats.wrong += 1;

  const response = {
    Phiên: history.length + 1,
    Kết_quả: result,
    Xúc_xắc: dice,
    Tổng_xúc_xắc: total,
    Dự_đoán: aiPred.prediction,
    Confidence: parseFloat(aiPred.confidence.toFixed(2)),
    Thuật_toán: markov
      ? `Hybrid(Markov bậc ${markov.order}:${markov.pT}->Tài, AI Hybrid:${aiPred.confidence}->${aiPred.prediction})`
      : `SunWinFormula + AI Hybrid`,
    "Pattern hiện tại": pattern || "Không",
    "SuperVIP hiện tại": markov
      ? `Markov(${markov.order}) → ${aiPred.prediction} (P_Tài=${markov.pT.toFixed(2)}, P_Xỉu=${markov.pX.toFixed(2)})`
      : "SunWinFormula → " + aiPred.prediction,
    "Số_lần_dự_đoán": stats.total,
    "Số_đúng": stats.correct,
    "Số_sai": stats.wrong,
    Id: "@minhsangdangcap"
  };

  // Lưu lịch sử
  history.push({ result, dice, total });

  // Giới hạn lịch sử 50 phiên
  if (history.length > 50) history.shift();

  res.json(response);
});

// Test endpoint
app.get("/", (req, res) => {
  res.send("SunWin API VIP is running.");
});

app.listen(PORT, () => {
  console.log(`SunWin API running on port ${PORT}`);
});
