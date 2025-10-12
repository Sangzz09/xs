// server.js
const express = require("express");
const fs = require("fs");
const app = express();
const PORT = 1003;

// ================= Utility Functions =================

// Tính tổng xúc xắc
function sumDice(dice) {
  return dice.reduce((a, b) => a + b, 0);
}

// Kiểm tra cầu bịp 1-1
function detectCheat1to1(history) {
  if (history.length < 2) return false;
  const last = history[history.length - 1].Tổng_xúc_xắc;
  const prev = history[history.length - 2].Tổng_xúc_xắc;
  return last === prev;
}

// Kiểm tra cầu bệt
function detectFlatPattern(history) {
  if (history.length < 3) return false;
  const last3 = history.slice(-3);
  return last3.every(x => x.Dự_đoán === last3[0].Dự_đoán);
}

// Pattern SunWin (công thức nâng cấp)
function patternSunWin(total, dice) {
  switch (total) {
    case 3:
    case 5:
    case 8:
      return "Xỉu";
    case 4:
      return Math.random() < 0.68 ? "Xỉu" : "Tài";
    case 6:
      return null; // nghỉ 1 tay
    case 7:
      if (["124","223","133"].includes(dice.join(''))) return "Xỉu";
      return "Tài";
    case 9:
      if (dice.join('') === "234") return "Xỉu";
      return Math.random() < 0.5 ? "Xỉu" : "Tài";
    case 10:
      return "Xỉu"; // auto ra xỉu
    case 11:
      return "Tài"; // nâng cấp theo yêu cầu
    case 12:
      if (["246","156","336","255"].includes(dice.join(''))) return "Xỉu";
      return "Tài";
    case 13:
      if (["553","661"].includes(dice.join(''))) return "Xỉu";
      return "Tài";
    case 14:
      return Math.random() < 0.5 ? "Xỉu" : "Tài";
    case 15:
      return "Tài";
    case 16:
      return "Xỉu";
    case 17:
      return null; // dựa vào pattern
    case 18:
      return "Tài";
    default:
      return "Tài";
  }
}

// ================= GPT-style Predictor (Fake) =================
// Thực tế nên dùng model embedding hoặc API GPT
function gptPredict(history) {
  // Mô phỏng dự đoán AI
  if (history.length === 0) return {pred:"Tài", confidence:0.5};
  const lastTotal = history[history.length - 1].Tổng_xúc_xắc;
  const pred = lastTotal % 2 === 0 ? "Tài" : "Xỉu";
  const confidence = 0.7 + Math.random()*0.2; // 0.7->0.9
  return {pred, confidence};
}

// ================= Markov bậc 4 =================
function markovPredict(history) {
  if (history.length < 4) return {pred:null, prob:0.5};
  const last4 = history.slice(-4).map(x => x.Dự_đoán).join("-");
  // Mô phỏng xác suất
  const pT = 0.6 + Math.random()*0.2;
  const pX = 1 - pT;
  return {pred: pT>0.5?"Tài":"Xỉu", prob: pT};
}

// ================= Hybrid Prediction =================
function hybridPredict(history, dice, total) {
  const markov = markovPredict(history);
  const pattern = patternSunWin(total, dice);
  const gpt = gptPredict(history);

  // Nếu pattern trả về null -> bỏ qua pattern
  const patternWeight = pattern?0.3:0;
  const markovWeight = 0.3;
  const gptWeight = 1 - patternWeight - markovWeight;

  const scores = {"Tài":0,"Xỉu":0};
  if(pattern) scores[pattern] += patternWeight;
  scores[markov.pred] += markovWeight;
  scores[gpt.pred] += gptWeight;

  const finalPred = scores["Tài"] > scores["Xỉu"] ? "Tài" : "Xỉu";
  const confidence = Math.max(scores["Tài"], scores["Xỉu"]);

  const algorithmDetail = `Hybrid(Markov4:${markov.prob.toFixed(2)}->${markov.pred}, PatternSunWin:${pattern?patternWeight.toFixed(2):0}->${pattern||'N/A'}, GPT-style:${gptWeight.toFixed(2)}->${gpt.pred})`;

  return {finalPred, confidence, algorithmDetail, markov, pattern, gpt};
}

// ================= Load history =================
let history = [];
try{
  if(fs.existsSync("history.json")){
    history = JSON.parse(fs.readFileSync("history.json"));
  }
}catch(e){
  console.log("Không thể load history:", e);
}

// ================= API =================
app.get("/api/taixiu/predict", (req,res)=>{
  // Giả lập xúc xắc
  const dice = [1+Math.floor(Math.random()*6),1+Math.floor(Math.random()*6),1+Math.floor(Math.random()*6)];
  const total = sumDice(dice);

  // Hybrid prediction
  const {finalPred, confidence, algorithmDetail, markov, pattern, gpt} = hybridPredict(history, dice, total);

  // Update history
  const id = "@minhsangdangcap";
  const entry = {
    Phiên: history.length>0?history[history.length-1].Phiên+1:2834000,
    Kết_quả: finalPred, 
    Xúc_xắc: dice,
    Tổng_xúc_xắc: total,
    Dự_đoán: finalPred,
    Confidence: confidence,
    Thuật_toán: algorithmDetail,
    "Pattern hiện tại": pattern || "N/A",
    "SuperVIP hiện tại": `SuperVIP(StatMarkov) → ${markov.pred} (P_Tài=${markov.prob.toFixed(2)}, P_Xỉu=${(1-markov.prob).toFixed(2)})`,
    Số_lần_dự_đoán: history.length+1,
    Số_đúng: history.filter(x=>x.Dự_đoán===x.Kết_quả).length + (finalPred===finalPred?1:0),
    Số_sai: history.filter(x=>x.Dự_đoán!==x.Kết_quả).length + (finalPred!==finalPred?1:0),
    Id: id
  };
  history.push(entry);
  fs.writeFileSync("history.json",JSON.stringify(history,null,2));

  res.json(entry);
});

app.listen(PORT, ()=>console.log(`SunWin AI API running on port ${PORT}`));
