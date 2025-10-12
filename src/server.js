// BOTRUMSUNWIN HYBRIDPLUS v12
// SmartPattern (bám cầu + đảo cầu) + SmartMarkov + SunWin Fallback
// Full từ A → Z — chạy ngay
// By @minhsangdangcap (2025)

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();

const PORT = process.env.PORT || 3000;
const API_URL = process.env.SOURCE_API || "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.resolve(__dirname, "data.json");

const FETCH_INTERVAL_MS = 5000;
const MAX_HISTORY = 100; // giữ nhiều lịch sử để pattern sâu có dữ liệu
const MIN_HISTORY_FOR_AI = 6; // nếu <6 thì dùng fallback
const RESET_AFTER = 200; // thông báo reset chu kỳ (tùy chỉnh)

let data = {
  history: [], // { phien, ket_qua, xuc_xac, tong_xuc_xac, du_doan, thuat_toan, confidence, patternName, details }
  stats: { tong: 0, dung: 0, sai: 0 },
  // lưu trạng thái flow: dùng để quyết định bám/đảo
  flow: {
    lastWins: 0,         // số thắng liền
    lastLosses: 0,       // số thua liền
    lastPattern: null,   // tên pattern last detection
    lastPredictionCorrect: null
  }
};

// load existing data
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    data = Object.assign(data, parsed);
    data.history = data.history || [];
    data.stats = data.stats || { tong: 0, dung: 0, sai: 0 };
    data.flow = data.flow || data.flow;
  }
} catch (e) {
  console.log("⚠️ Không đọc được data.json, khởi tạo mới.");
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("⚠️ Lỗi ghi data.json:", e.message);
  }
}

function safeParseInt(v) { const n = parseInt(v); return isNaN(n) ? 0 : n; }
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");

// ---------------- SunWin fallback (từ file bạn gửi) ----------------
function fallbackByFormula(sum, dices) {
  const raw = dices.map(d => safeParseInt(d));
  const code = raw.join("");
  const sortedAsc = [...raw].sort((a,b)=>a-b).join("");

  if (sum === 3) return { du_doan: "Xỉu", note: "Sum=3 ⇒ Xỉu (100%)" };
  if (sum === 4) return { du_doan: "Xỉu", note: "Sum=4 ⇒ ưu Xỉu (68%)" };
  if (sum === 5) return { du_doan: "Xỉu", note: "Sum=5 ⇒ Xỉu (100%)" };
  if (sum === 6) return { du_doan: "Xỉu", note: "Sum=6 ⇒ ưu Xỉu (cân nhắc nghỉ tay)" };
  if (sum === 7) {
    const strong = ["124","223","133"];
    if (strong.includes(code) || strong.includes(sortedAsc)) return { du_doan: "Xỉu", note: "Sum=7 pattern strong ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=7 other ⇒ lean Tài" };
  }
  if (sum === 8) {
    if (code === "134" || sortedAsc === "134") return { du_doan: "Xỉu", note: "Sum=8 pattern 134 ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=8 other ⇒ Tài" };
  }
  if (sum === 9) {
    if (code === "234" || sortedAsc === "234") return { du_doan: "Xỉu", note: "Sum=9 pattern 234 ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=9 other ⇒ lean Tài" };
  }
  if (sum === 10) return { du_doan: "Xỉu", note: "Sum=10 ⇒ Xỉu" };
  if (sum === 11) return { du_doan: "Tài", note: "Sum=11 ⇒ lean Tài" };
  if (sum === 12) {
    const px = ["246","156","336","255"];
    if (px.includes(code) || px.includes(sortedAsc)) return { du_doan: "Xỉu", note: "Sum=12 pattern ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=12 other ⇒ Tài" };
  }
  if (sum === 13) {
    const px = ["553","661","531","631"];
    if (px.includes(code) || px.includes(sortedAsc)) return { du_doan: "Xỉu", note: "Sum=13 pattern ⇒ Xỉu" };
    return { du_doan: "Tài", note: "Sum=13 other ⇒ Tài" };
  }
  if (sum === 14) return { du_doan: "Tài", note: "Sum=14 ⇒ 50/50 -> choose Tài" };
  if (sum === 15) return { du_doan: "Tài", note: "Sum=15 ⇒ Tài" };
  if (sum === 16) return { du_doan: "Xỉu", note: "Sum=16 ⇒ Xỉu" };
  if (sum === 17) return { du_doan: "Tài", note: "Sum=17 ⇒ lean Tài" };
  if (sum === 18) return { du_doan: "Tài", note: "Sum=18 ⇒ Tài" };
  return { du_doan: Math.random()>0.5?"Tài":"Xỉu", note: "Fallback random" };
}

// ---------------- SmartPattern: detect pattern types ----------------
function detectPattern(hist) {
  // return { name, confidence, hint }
  if (!hist.length) return { name: "NoData", confidence: 0 };

  // collect last sequence of results
  const seq = hist.map(h => h.ket_qua[0]).join(""); // 'T'/'X'
  const L = seq.length;

  // 1) detect 'bệt' (same result repeated)
  for (let n = 6; n >= 3; n--) {
    if (L >= n && seq.slice(-n).split('').every(ch => ch === seq.slice(-1))) {
      return { name: `Bệt ${seq.slice(-1)==='T'?'Tài':'Xỉu'}`, confidence: 0.7 + (n-3)*0.08, type: "bet" };
    }
  }

  // 2) detect 1-1 pattern (alternating), e.g., TXTXTX or XTX...
  const last4 = seq.slice(-6);
  const alt = last4.split('').every((ch, i) => (i%2===0?ch: oppositeLetter(ch)) );
  // but need robust detection: check alternation for last 4..6
  function isAlternating(s) {
    if (s.length < 4) return false;
    for (let i=2;i<s.length;i++){
      if (s[i] !== s[i-2]) return false;
    }
    // ensure at least two alternations
    return true;
  }
  if (isAlternating(seq.slice(-6))) return { name: "1-1 (Alternating)", confidence: 0.65, type: "alt" };

  // 3) detect 2-1 pattern (pattern like TTX TTX ... or XXT XXT)
  // check last 6 for format A A B A A B
  if (L >= 6) {
    const last6 = seq.slice(-6);
    const a = last6[0], b = last6[2];
    if (last6[0] === last6[1] && last6[3] === last6[4] && last6[2] === last6[5]) {
      return { name: `2-1 pattern (${a}${a}${b})`, confidence: 0.68, type: "21" };
    }
  }

  // 4) nhấp nhả (small oscillations) detection: check last 5 contains short flips
  if (L >= 5) {
    const last5 = seq.slice(-5);
    // count runs lengths
    const runs = [];
    let runChar = last5[0], runLen = 1;
    for (let i=1;i<last5.length;i++){
      if (last5[i] === runChar) runLen++; else { runs.push(runLen); runChar = last5[i]; runLen = 1; }
    }
    runs.push(runLen);
    if (runs.length >= 3 && runs.every(r => r <= 2)) {
      return { name: "Nhấp nhả (choppy)", confidence: 0.55, type: "choppy" };
    }
  }

  // 5) đảo nhẹ (recent small reversal)
  if (L >= 4) {
    const last3 = seq.slice(-3);
    if (last3[0] === last3[1] && last3[2] !== last3[1]) {
      return { name: "Đảo nhẹ", confidence: 0.58, type: "rev" };
    }
  }

  // 6) default: no strong pattern
  return { name: "No strong pattern", confidence: 0.35, type: "none" };
}

function oppositeLetter(ch) { return ch === 'T' ? 'X' : 'T'; }

// ---------------- SmartMarkov: dynamic transition model ----------------
function smartMarkovPredict(hist) {
  // Build transition counts for orders 1..3 on letters 'T'/'X'
  const seq = hist.map(h => h.ket_qua[0]).join("");
  const orders = [3,2,1];
  const laplace = 1;
  let combined = { "Tài": 0, "Xỉu": 0 };
  let totalWeight = 0;

  for (const k of orders) {
    if (seq.length < k) continue;
    const context = seq.slice(-k);
    let countT = 0, countX = 0, total = 0;
    for (let i = 0; i + k < seq.length; i++) {
      if (seq.slice(i, i+k) === context) {
        const nxt = seq[i+k];
        if (nxt === 'T') countT++; else countX++;
        total++;
      }
    }
    // smoothing
    const pT = (countT + laplace) / (total + 2*laplace);
    const pX = (countX + laplace) / (total + 2*laplace);
    // weight by evidence amount and order preference
    const evidence = Math.min(1, total / 12); // more occurrences => stronger
    const orderWeight = k === 3 ? 0.5 : k === 2 ? 0.3 : 0.2;
    const w = orderWeight * (0.3 + 0.7 * evidence);
    combined["Tài"] += pT * w;
    combined["Xỉu"] += pX * w;
    totalWeight += w;
  }

  if (totalWeight === 0) {
    // fallback frequency of last window
    const w = hist.slice(-6);
    const tai = w.filter(x => x.ket_qua === "Tài").length;
    const xiu = w.length - tai;
    return { probs: { "Tài": tai/(w.length||1), "Xỉu": xiu/(w.length||1) }, name: "MarkovFallback" };
  }

  // normalize
  const s = combined["Tài"] + combined["Xỉu"] || 1;
  combined["Tài"] /= s; combined["Xỉu"] /= s;
  return { probs: combined, name: "SmartMarkov" };
}

// ---------------- Decision logic: combine SmartPattern + SmartMarkov + flow rules ----------------
function decidePrediction(hist) {
  // If not enough history -> null (caller should fallback)
  if (hist.length < MIN_HISTORY_FOR_AI) return null;

  const pattern = detectPattern(hist);
  const markov = smartMarkovPredict(hist);

  // Base: if pattern strong (confidence >= 0.65) then bám/đảo theo rule
  // Decision matrix:
  // - Bệt: bám cầu (if bệt length >=3 → predict same) but if lastLosses >1 then consider đảo
  // - 1-1 (alternating): đảo (predict opposite of last)
  // - 2-1: follow the 2-1 rhythm (predict based on last cycle)
  // - Nhấp nhả: bám nhẹ theo majority in window
  // - Đảo nhẹ: predict opposite of last (small reversal)
  // - No strong pattern: use markov probs

  let pick = null;
  let reason = "";
  let confidence = 0.5;

  const lastResult = hist[hist.length - 1].ket_qua;

  // quick flow state
  const flow = data.flow;

  // if pattern is bệt
  if (pattern.type === "bet") {
    // bám cầu by default
    pick = (pattern.name.includes('Tài') ? "Tài" : "Xỉu");
    reason = `Bám cầu ${pattern.name}`;
    // reduce confidence if recent losses occurred on same pick
    if (flow.lastLosses >= 2) {
      // suspect bẻ cầu -> lower confidence and maybe invert
      confidence = 0.45;
      // if many losses, invert (đảo) with small prob
      if (flow.lastLosses >= 3) {
        pick = opposite(pick);
        reason += " | Đảo do mất chuỗi (flow.lastLosses>=3)";
        confidence = 0.55;
      } else {
        confidence = 0.6;
      }
    } else {
      // increase confidence proportionally to run length
      const runLen = getLastRunLength(hist);
      confidence = Math.min(0.95, 0.6 + (runLen - 2) * 0.12); // runLen 3 => ~0.72
    }
    return { pick, reason, confidence, pattern };
  }

  // 1-1 alternating -> predict opposite of last (đảo)
  if (pattern.type === "alt") {
    pick = opposite(lastResult);
    reason = "1-1 (Alternating) => Đảo";
    confidence = 0.68;
    // if lastWins high and last was correct, keep slight bias to last instead (protective)
    if (flow.lastWins >= 2 && hist[hist.length-1].du_doan === hist[hist.length-1].ket_qua) {
      // but we follow rule: alternate is strong
    }
    return { pick, reason, confidence, pattern };
  }

  // 2-1 pattern: attempt to infer the cycle
  if (pattern.type === "21") {
    // Attempt: look at last 3 or 6, predict based on cycle
    // If last 3 like AAB and before that AAB, then next is A again
    const cyclePick = infer21Next(hist);
    pick = cyclePick || markov.probs["Tài"] >= markov.probs["Xỉu"] ? "Tài" : "Xỉu";
    reason = "2-1 pattern => follow cycle";
    confidence = 0.66;
    // if many recent losses, lower confidence
    if (flow.lastLosses >= 2) confidence -= 0.12;
    return { pick, reason, confidence, pattern };
  }

  // nhấp nhả (choppy) => take majority in last window
  if (pattern.type === "choppy") {
    const window = hist.slice(-8);
    const tai = window.filter(h=>h.ket_qua==="Tài").length;
    pick = tai >= (window.length - tai) ? "Tài" : "Xỉu";
    reason = "Nhấp nhả => majority in window";
    confidence = 0.58;
    return { pick, reason, confidence, pattern };
  }

  // đảo nhẹ => predict opposite of last
  if (pattern.type === "rev") {
    pick = opposite(lastResult);
    reason = "Đảo nhẹ => Đảo 1";
    confidence = 0.6;
    return { pick, reason, confidence, pattern };
  }

  // no strong pattern -> use markov
  const probs = markov.probs || markov;
  pick = probs["Tài"] >= probs["Xỉu"] ? "Tài" : "Xỉu";
  reason = `SmartMarkov (${(probs["Tài"]*100).toFixed(0)}% vs ${(probs["Xỉu"]*100).toFixed(0)}%)`;
  confidence = Math.max(0.35, Math.min(0.9, Math.abs(probs["Tài"] - probs["Xỉu"]) + 0.35));
  // adjust confidence by flow: long loss streak reduces confidence
  if (flow.lastLosses >= 2) confidence *= 0.85;
  if (flow.lastWins >= 2) confidence = Math.min(0.99, confidence * 1.08);

  return { pick, reason, confidence, pattern, markov };
}

function getLastRunLength(hist) {
  if (!hist.length) return 0;
  const last = hist[hist.length-1].ket_qua;
  let len = 0;
  for (let i = hist.length-1; i >= 0; i--) {
    if (hist[i].ket_qua === last) len++; else break;
  }
  return len;
}

function infer21Next(hist) {
  // try to detect A A B pattern and predict next
  const seq = hist.map(h=>h.ket_qua[0]).join("");
  if (seq.length < 6) return null;
  const last6 = seq.slice(-6);
  // pattern like AAB AAB -> next A
  if (last6[0] === last6[1] && last6[2] !== last6[0] && last6.slice(0,3) === last6.slice(3,6)) {
    return last6[0] === 'T' ? "Tài" : "Xỉu";
  }
  // fallback null
  return null;
}

// ---------------- Fetch & main loop ----------------
async function fetchAndPredict() {
  try {
    const res = await axios.get(API_URL, { timeout: 5000 });
    const d = res.data || {};
    const phien = safeParseInt(d.phien || d.Phiên || 0);
    if (!phien) return;

    // avoid duplicate
    const lastInHistory = data.history.length ? data.history[data.history.length-1].phien : null;
    if (phien === lastInHistory) return;

    // parse dice
    let xuc_xac = null;
    if (Array.isArray(d.xuc_xac)) xuc_xac = d.xuc_xac.map(v=>safeParseInt(v));
    else if (d.xuc_xac_1 !== undefined) xuc_xac = [safeParseInt(d.xuc_xac_1), safeParseInt(d.xuc_xac_2), safeParseInt(d.xuc_xac_3)];
    else xuc_xac = [safeParseInt(d.X1||d.x1), safeParseInt(d.X2||d.x2), safeParseInt(d.X3||d.x3)];

    const tong = (xuc_xac || [0,0,0]).reduce((a,b)=>a+b,0);
    const ket_qua = (d.ket_qua || d.Kết_quả || "").toString().trim() || (tong>=11 ? "Tài" : "Xỉu");

    // decide prediction
    let entry = null;
    if (data.history.length < MIN_HISTORY_FOR_AI) {
      // use fallback formula
      const fb = fallbackByFormula(tong, xuc_xac);
      let confidence = 0.55;
      if (fb.note && fb.note.includes("100%")) confidence = 0.95;
      else if (fb.note && fb.note.includes("mạnh")) confidence = 0.8;
      else if (fb.note && fb.note.includes("yếu")) confidence = 0.6;
      entry = {
        phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
        du_doan: fb.du_doan,
        thuat_toan: `Fallback(${fb.note||'rule'})`,
        confidence,
        patternName: "Fallback",
        details: { note: fb.note || '' }
      };

      // push & update stats
      data.history.push(entry);
      if (data.history.length > MAX_HISTORY) data.history.shift();
      data.stats.tong++;
      if (entry.du_doan === ket_qua) {
        data.stats.dung++; data.flow.lastWins = (data.flow.lastWins || 0) + 1; data.flow.lastLosses = 0;
        data.flow.lastPredictionCorrect = true;
      } else {
        data.stats.sai++; data.flow.lastLosses = (data.flow.lastLosses || 0) + 1; data.flow.lastWins = 0;
        data.flow.lastPredictionCorrect = false;
      }

      save();
      console.log(`🔁 Phiên ${phien} (fallback): KQ=${ket_qua} | Dự đoán=${entry.du_doan} | note=${fb.note||''}`);
      return;
    }

    // have enough history -> smart hybridplus
    const decision = decidePrediction(data.history);
    // decision should be an object
    const pick = decision.pick;
    const reason = decision.reason;
    const confidence = decision.confidence;

    entry = {
      phien, ket_qua, xuc_xac, tong_xuc_xac: tong,
      du_doan: pick, thuat_toan: `HybridPlus v12 (${reason})`,
      confidence: Number(confidence.toFixed(3)),
      patternName: decision.pattern ? decision.pattern.name : "None",
      details: {
        pattern: decision.pattern || null,
        markov: decision.markov || null
      }
    };

    // push & stats
    data.history.push(entry);
    if (data.history.length > MAX_HISTORY) data.history.shift();
    data.stats.tong++;
    if (entry.du_doan === ket_qua) {
      data.stats.dung++;
      data.flow.lastWins = (data.flow.lastWins || 0) + 1;
      data.flow.lastLosses = 0;
      data.flow.lastPredictionCorrect = true;
    } else {
      data.stats.sai++;
      data.flow.lastLosses = (data.flow.lastLosses || 0) + 1;
      data.flow.lastWins = 0;
      data.flow.lastPredictionCorrect = false;
    }
    data.flow.lastPattern = entry.patternName;

    // minor learning: if we get 2 losses in a row, slightly increase tendency to invert on bệt
    if (data.flow.lastLosses >= 2) {
      // adjust nothing structural — just log & will affect decision via flow checks
    }

    save();
    console.log(`✅ Phiên ${phien}: KQ=${ket_qua} | Dự đoán=${entry.du_doan} | Pattern=${entry.patternName} | Conf=${(entry.confidence*100).toFixed(0)}%`);
  } catch (err) {
    console.log("⚠️ Lỗi fetch API:", err.message);
  }
}

// ---------------- API endpoints ----------------
app.get("/sunwinapi", (req, res) => {
  if (!data.history.length) return res.json({ message: "Chưa có dữ liệu" });
  const last = data.history[data.history.length - 1];
  res.json({
    Phiên: last.phien,
    Kết_quả: last.ket_qua,
    Xúc_xắc: last.xuc_xac,
    Tổng_xúc_xắc: last.tong_xuc_xac,
    Cầu_hiện_tại: last.patternName || "Không rõ",
    Dự_đoán: last.du_doan,
    Confidence: last.confidence,
    Thuật_toán: last.thuat_toan,
    Số_lần_dự_đoán: data.stats.tong,
    Số_đúng: data.stats.dung,
    Số_sai: data.stats.sai,
    Id: "@minhsangdangcap"
  });
});

app.get("/history", (req, res) => {
  res.json({ count: data.history.length, history: data.history, stats: data.stats, flow: data.flow });
});

app.get("/stats", (req, res) => {
  const acc = data.stats.tong ? (data.stats.dung / data.stats.tong) : 0;
  res.json({
    totalRounds: data.stats.tong,
    wins: data.stats.dung,
    losses: data.stats.sai,
    accuracy: (acc * 100).toFixed(2) + "%",
    flow: data.flow
  });
});

app.get("/clear", (req, res) => {
  data = {
    history: [], stats: { tong: 0, dung: 0, sai: 0 },
    flow: { lastWins: 0, lastLosses: 0, lastPattern: null, lastPredictionCorrect: null }
  };
  save();
  res.json({ ok: true, message: "Đã reset toàn bộ data" });
});

// start loop
setInterval(fetchAndPredict, FETCH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`🚀 BOTRUMSUNWIN HYBRIDPLUS v12 đang chạy tại http://localhost:${PORT}`);
  console.log(`   - API nguồn: ${API_URL}`);
  console.log(`   - Lưu data: ${DATA_FILE}`);
});
