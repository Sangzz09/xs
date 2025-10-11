// index.js
// BOTRUMSUNWIN API — Menchining VIP (Adaptive Ensemble + Backtest)
// Node >= 14 recommended
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

// ====== Cấu hình ======
const SOURCE_API = "https://hackvn.xyz/apisun.php"; // nguồn gốc
const DATA_FILE = "./data.json"; // lưu 20 cầu gần nhất (cho UI/clients)
const FULL_FILE = "./full_history.json"; // lưu toàn bộ lịch sử
const MAX_HISTORY = 20; // giữ 20 bản ghi gần nhất
const FETCH_INTERVAL_MS = 5000; // 5s
const BACKTEST_MAX_STEPS = 400; // giới hạn bước backtest (giảm nếu nặng)
const BACKTEST_ALPHA = 3; // nhấn mạnh trọng số cho chiến lược tốt (tăng => tập trung hơn)

// ====== State ======
let history = []; // recent (MAX_HISTORY)
let fullHistory = []; // toàn bộ
let lastPredictionCache = null; // cache kết quả predictAdvanced để tránh tính quá nhiều lần

// ====== Load / Save lịch sử ======
function loadHistory() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      try { history = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
      catch (e) { console.warn("⚠️ data.json lỗi định dạng — reset history"); history = []; }
    }
    if (fs.existsSync(FULL_FILE)) {
      try { fullHistory = JSON.parse(fs.readFileSync(FULL_FILE, "utf8")); }
      catch (e) { console.warn("⚠️ full_history.json lỗi định dạng — reset fullHistory"); fullHistory = []; }
    }
    console.log(`📂 Loaded ${history.length} (recent) / ${fullHistory.length} (full)`);
  } catch (err) {
    console.error("❌ Lỗi load:", err.message);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
    fs.writeFileSync(FULL_FILE, JSON.stringify(fullHistory, null, 2));
  } catch (err) {
    console.error("❌ Lỗi save:", err.message);
  }
}

// ====== Helpers ======
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function buildPattern(list) {
  return list.map(h => (h.result === "Tài" ? "t" : "x")).join("");
}
function safeParseInt(v) { const n = parseInt(v); return isNaN(n) ? 0 : n; }

// ====== Predict (VIP Ensemble with Backtesting) ======
function predictAdvanced(hist, fullHist) {
  // convert to arrays of "Tài"/"Xỉu"
  const recent = (hist || []).map(h => h.result);
  const full = (fullHist || []).map(h => h.result);

  // not enough data fallback
  if (full.length < 6) {
    const all = recent.concat(full);
    const taiCount = all.filter(r => r === "Tài").length;
    const pTai = all.length ? taiCount / all.length : 0.5;
    const pred = pTai >= 0.5 ? "Tài" : "Xỉu";
    return {
      du_doan: pred,
      thuat_toan: "Fallback: ít dữ liệu (frequency)",
      confidence: clamp(Math.abs(pTai - 0.5) * 2, 0.05, 0.95),
      agg: { pTai, pXiu: 1 - pTai },
      votes: { fallback: { pred, pTai } }
    };
  }

  // --- Strategies ---
  const strategies = {};

  // 1) Long-run Reversal
  strategies.longRun = (results) => {
    const n = Math.min(6, Math.floor(results.length / 2));
    if (n >= 3) {
      const lastK = results.slice(-n);
      if (lastK.every(r => r === lastK[0])) {
        const opp = opposite(lastK[0]);
        return opp === "Tài" ? { probTai: 0.86, probXiu: 0.14 } : { probTai: 0.14, probXiu: 0.86 };
      }
    }
    return { probTai: 0.5, probXiu: 0.5 };
  };

  // 2) Alternation continuation
  strategies.alternation = (results) => {
    if (results.length < 4) return { probTai: 0.5, probXiu: 0.5 };
    const last4 = results.slice(-4);
    let alt = true;
    for (let i = 1; i < last4.length; i++) if (last4[i] === last4[i - 1]) alt = false;
    if (alt) {
      const next = opposite(last4[last4.length - 1]);
      return next === "Tài" ? { probTai: 0.75, probXiu: 0.25 } : { probTai: 0.25, probXiu: 0.75 };
    }
    return { probTai: 0.5, probXiu: 0.5 };
  };

  // 3) Momentum (weighted recent vote)
  strategies.momentum = (results) => {
    const n = Math.min(10, results.length);
    const tail = results.slice(-n);
    let score = 0;
    for (let i = 0; i < tail.length; i++) {
      const weight = (i + 1) / n;
      score += tail[i] === "Tài" ? weight : -weight;
    }
    const norm = score / n;
    if (Math.abs(norm) < 0.2) return { probTai: 0.5, probXiu: 0.5 };
    if (norm > 0) return { probTai: clamp(0.52 + norm * 0.48, 0.52, 0.95), probXiu: 1 - clamp(0.52 + norm * 0.48, 0.52, 0.95) };
    return { probTai: 1 - clamp(0.52 + -norm * 0.48, 0.52, 0.95), probXiu: clamp(0.52 + -norm * 0.48, 0.52, 0.95) };
  };

  // 4) Bias Regression (revert to mean)
  strategies.biasRegression = (results) => {
    const n = Math.min(30, results.length);
    const tail = results.slice(-n);
    const tai = tail.filter(r => r === "Tài").length;
    const p = tai / tail.length;
    const diff = p - 0.5;
    if (Math.abs(diff) < 0.08) return { probTai: 0.5, probXiu: 0.5 };
    if (diff > 0) {
      const probX = clamp(0.55 + (diff - 0.08) * 2.5, 0.55, 0.92);
      return { probTai: 1 - probX, probXiu: probX };
    } else {
      const probT = clamp(0.55 + (-diff - 0.08) * 2.5, 0.55, 0.92);
      return { probTai: probT, probXiu: 1 - probT };
    }
  };

  // 5) Markov order-1 (full history)
  strategies.markov1 = (results, fullResults) => {
    if (fullResults.length < 10 || results.length < 1) return { probTai: 0.5, probXiu: 0.5 };
    const counts = { "Tài": { "Tài": 0, "Xỉu": 0 }, "Xỉu": { "Tài": 0, "Xỉu": 0 } };
    for (let i = 0; i < fullResults.length - 1; i++) {
      const a = fullResults[i], b = fullResults[i + 1];
      if (counts[a]) counts[a][b]++;
    }
    const last = results[results.length - 1];
    const total = (counts[last]["Tài"] + counts[last]["Xỉu"]) || 0;
    if (total < 3) return { probTai: 0.5, probXiu: 0.5 };
    return { probTai: counts[last]["Tài"] / total, probXiu: counts[last]["Xỉu"] / total };
  };

  // 6) Markov order-2 (full history)
  strategies.markov2 = (results, fullResults) => {
    if (fullResults.length < 20 || results.length < 2) return { probTai: 0.5, probXiu: 0.5 };
    const counts = {};
    for (let i = 0; i < fullResults.length - 2; i++) {
      const key = fullResults[i] + "|" + fullResults[i + 1];
      const next = fullResults[i + 2];
      counts[key] = counts[key] || { "Tài": 0, "Xỉu": 0, total: 0 };
      counts[key][next]++; counts[key].total++;
    }
    const last2 = results.slice(-2).join("|");
    if (!counts[last2] || counts[last2].total < 3) return { probTai: 0.5, probXiu: 0.5 };
    return { probTai: counts[last2]["Tài"] / counts[last2].total, probXiu: counts[last2]["Xỉu"] / counts[last2].total };
  };

  // 7) Pattern similarity (last M)
  strategies.patternSimilarity = (results, fullResults) => {
    const M = Math.min(5, results.length);
    if (fullResults.length < M + 3) return { probTai: 0.5, probXiu: 0.5 };
    const pattern = results.slice(-M).join("");
    let taiNext = 0, xiuNext = 0, matches = 0;
    for (let i = 0; i <= fullResults.length - M - 1; i++) {
      const seq = fullResults.slice(i, i + M).join("");
      if (seq === pattern) {
        const next = fullResults[i + M];
        if (!next) continue;
        matches++;
        if (next === "Tài") taiNext++;
        else xiuNext++;
      }
    }
    if (matches < 3) return { probTai: 0.5, probXiu: 0.5 };
    return { probTai: taiNext / (taiNext + xiuNext), probXiu: 1 - (taiNext / (taiNext + xiuNext)) };
  };

  // 8) Global frequency baseline
  strategies.frequency = (results, fullResults) => {
    const lastN = Math.min(200, fullResults.length);
    const tail = fullResults.slice(-lastN);
    const tai = tail.filter(r => r === "Tài").length;
    const pTai = tai / tail.length;
    return { probTai: pTai, probXiu: 1 - pTai };
  };

  // assemble strategy list
  const stratFns = [
    { name: "longRun", fn: (r) => strategies.longRun(r) },
    { name: "alternation", fn: (r) => strategies.alternation(r) },
    { name: "momentum", fn: (r) => strategies.momentum(r) },
    { name: "biasRegression", fn: (r) => strategies.biasRegression(r) },
    { name: "markov1", fn: (r) => strategies.markov1(r, full) },
    { name: "markov2", fn: (r) => strategies.markov2(r, full) },
    { name: "patternSimilarity", fn: (r) => strategies.patternSimilarity(r, full) },
    { name: "frequency", fn: (r) => strategies.frequency(r, full) }
  ];

  // --- Backtest each strategy to get accuracy ---
  function backtest(fn, fullResults, maxSteps = BACKTEST_MAX_STEPS) {
    if (!fullResults || fullResults.length < 20) return 0.5;
    let correct = 0, total = 0;
    const start = Math.max(6, Math.floor(fullResults.length / 10));
    const end = fullResults.length - 1;
    const limit = Math.min(maxSteps, end - start);
    for (let k = 0; k < limit; k++) {
      const i = start + k;
      const histSlice = fullResults.slice(0, i);
      if (histSlice.length < 3) continue;
      try {
        const prob = fn(histSlice);
        if (!prob) continue;
        const pred = (prob.probTai || 0) >= (prob.probXiu || 0) ? "Tài" : "Xỉu";
        const actual = fullResults[i];
        if (pred === actual) correct++;
        total++;
      } catch (e) {
        // skip
      }
    }
    if (total === 0) return 0.5;
    return correct / total;
  }

  // evaluate strategies
  const resultsByStrategy = {};
  stratFns.forEach(s => {
    let prob;
    try { prob = s.fn(recent); } catch (e) { prob = { probTai: 0.5, probXiu: 0.5 }; }
    const sum = (prob.probTai || 0) + (prob.probXiu || 0);
    if (sum <= 0) prob = { probTai: 0.5, probXiu: 0.5 };
    else { prob.probTai = (prob.probTai || 0) / sum; prob.probXiu = (prob.probXiu || 0) / sum; }
    const acc = backtest((histSlice) => {
      let p;
      try { p = s.fn(histSlice); } catch (e) { p = { probTai: 0.5, probXiu: 0.5 }; }
      const ssum = (p.probTai || 0) + (p.probXiu || 0);
      if (ssum <= 0) return { probTai: 0.5, probXiu: 0.5 };
      return { probTai: (p.probTai || 0) / ssum, probXiu: (p.probXiu || 0) / ssum };
    }, full, BACKTEST_MAX_STEPS);
    resultsByStrategy[s.name] = { prob, backtestAcc: acc };
  });

  // compute weights from backtest accuracies
  let weightSum = 0;
  const weights = {};
  Object.keys(resultsByStrategy).forEach(name => {
    const acc = clamp(resultsByStrategy[name].backtestAcc, 0.01, 0.99);
    const w = Math.pow(acc, BACKTEST_ALPHA);
    weights[name] = w;
    weightSum += w;
  });
  if (weightSum <= 0) weightSum = 1;

  // aggregate probabilities
  let aggTai = 0, aggXiu = 0;
  Object.keys(resultsByStrategy).forEach(name => {
    const w = weights[name] / weightSum;
    const p = resultsByStrategy[name].prob;
    aggTai += w * p.probTai;
    aggXiu += w * p.probXiu;
  });

  // normalize
  const totalAgg = aggTai + aggXiu || 1;
  aggTai = aggTai / totalAgg;
  aggXiu = aggXiu / totalAgg;

  const finalPred = aggTai >= aggXiu ? "Tài" : "Xỉu";
  const confidence = clamp(Math.abs(aggTai - aggXiu), 0.01, 0.999);

  // prepare votes
  const votes = {};
  Object.keys(resultsByStrategy).forEach(name => {
    const r = resultsByStrategy[name];
    const pTai = Math.round((r.prob.probTai || 0) * 1000) / 1000;
    const pXiu = Math.round((r.prob.probXiu || 0) * 1000) / 1000;
    votes[name] = {
      pred: pTai >= pXiu ? "Tài" : "Xỉu",
      pTai,
      pXiu,
      backtestAcc: Math.round((r.backtestAcc || 0) * 1000) / 1000,
      weight: Math.round(((weights[name] || 0) / weightSum) * 1000) / 1000
    };
  });

  return {
    du_doan: finalPred,
    thuat_toan: "VIP Ensemble (Adaptive Weighted + Backtest)",
    confidence: Math.round(confidence * 1000) / 1000,
    agg: { pTai: Math.round(aggTai * 1000) / 1000, pXiu: Math.round(aggXiu * 1000) / 1000 },
    votes
  };
}

// ====== Fetch & Save loop ======
async function fetchOnceAndSave() {
  try {
    const res = await axios.get(SOURCE_API, { timeout: 4000 });
    const item = res.data || {};

    const phien = safeParseInt(item.phien);
    const x1 = safeParseInt(item.xuc_xac_1);
    const x2 = safeParseInt(item.xuc_xac_2);
    const x3 = safeParseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = (item.ket_qua || "").trim() === "Tài" ? "Tài" : "Xỉu";

    if (!isNaN(phien) && tong >= 3 && tong <= 18) {
      // avoid duplicates
      if (!fullHistory.find(h => h.phien === phien)) {
        const entry = {
          phien,
          result: ket_qua,
          xuc_xac: [x1, x2, x3],
          tong_xuc_xac: tong,
          time: new Date().toISOString()
        };
        fullHistory.push(entry);
        history.push(entry);
        while (history.length > MAX_HISTORY) history.shift();
        saveHistory();
        // clear cached prediction so next request recomputes
        lastPredictionCache = null;
        console.log(`✅ Phiên ${phien}: ${ket_qua} (t=${tong}) — recent ${history.length}/20 / full ${fullHistory.length}`);
      } else {
        // optional: update existing if changed
      }
    }
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// ====== Endpoints ======
app.get("/sunwinapi", (req, res) => {
  const latest = history[history.length - 1] || {};
  // use cached prediction if exists to save CPU
  if (!lastPredictionCache) {
    try {
      lastPredictionCache = predictAdvanced(history, fullHistory);
      lastPredictionCache.generated_at = new Date().toISOString();
    } catch (e) {
      lastPredictionCache = {
        du_doan: "Tài",
        thuat_toan: "ErrorFallback",
        confidence: 0.5,
        agg: { pTai: 0.5, pXiu: 0.5 },
        votes: {}
      };
    }
  }
  res.json({
    phien: latest.phien || 0,
    ket_qua: latest.result || "Đang cập nhật",
    xuc_xac: latest.xuc_xac || [0, 0, 0],
    tong_xuc_xac: latest.tong_xuc_xac || 0,
    du_doan: lastPredictionCache.du_doan,
    confidence: lastPredictionCache.confidence,
    pattern: buildPattern(history),
    thuat_toan: lastPredictionCache.thuat_toan,
    details: lastPredictionCache,
    id: "@minhsangdangcap"
  });
});

app.get("/fullhistory", (req, res) => {
  res.json({ total: fullHistory.length, fullHistory });
});

app.get("/stats", (req, res) => {
  const total = fullHistory.length;
  const tai = fullHistory.filter(h => h.result === "Tài").length;
  res.json({ total, tai, xiu: total - tai, ratio_tai: total ? +(tai / total).toFixed(4) : 0 });
});

// ====== Start ======
loadHistory();
setInterval(fetchOnceAndSave, FETCH_INTERVAL_MS);
app.listen(PORT, () => {
  console.log(`🚀 Botrumsunwin API Menchining (VIP) running on port ${PORT}`);
});
