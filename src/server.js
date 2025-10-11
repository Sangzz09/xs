// index.js
// BOTRUMSUNWIN API — Menchining VIP PRO (Adaptive Ensemble, Multi-length Pattern + Backtest + Weight Cache)
// Node >= 14 recommended
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// CONFIG (tùy chỉnh nhanh)
// =====================
const CONFIG = {
  SOURCE_API: "https://hackvn.xyz/apisun.php",
  DATA_FILE: "./data.json",
  FULL_FILE: "./full_history.json",
  MAX_HISTORY: 20,
  FETCH_INTERVAL_MS: 5000,
  BACKTEST_MAX_STEPS: 400,
  BACKTEST_ALPHA: 3, // exponent to emphasize better strategies
  RECOMPUTE_WEIGHTS_INTERVAL_MS: 60 * 1000, // compute weights every 60s (reduce CPU)
  MIN_HISTORY_FOR_BACKTEST: 30, // need at least this many records to meaningfully backtest
  PATTERN_LENGTHS: [5, 6, 7] // pattern similarity lengths to consider
};

// =====================
// State
// =====================
let history = []; // recent MAX_HISTORY items
let fullHistory = []; // all items
let lastPredictionCache = null; // cached prediction (recompute on new fetch)
let weightCache = { computedAt: 0, weights: {}, accuracies: {} }; // cached weights/backtest results
let lastFetchTime = 0;

// =====================
// Utilities
// =====================
function safeParseInt(v) { const n = parseInt(v); return isNaN(n) ? 0 : n; }
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function buildPattern(list) { return list.map(h => (h.result === "Tài" ? "t" : "x")).join(""); }
function now() { return Date.now(); }

function loadHistoryFiles() {
  try {
    if (fs.existsSync(CONFIG.DATA_FILE)) {
      try { history = JSON.parse(fs.readFileSync(CONFIG.DATA_FILE, "utf8")); }
      catch (e) { console.warn("⚠️ data.json bị lỗi — reset history"); history = []; }
    }
    if (fs.existsSync(CONFIG.FULL_FILE)) {
      try { fullHistory = JSON.parse(fs.readFileSync(CONFIG.FULL_FILE, "utf8")); }
      catch (e) { console.warn("⚠️ full_history.json bị lỗi — reset fullHistory"); fullHistory = []; }
    }
    console.log(`📂 Loaded recent=${history.length} / full=${fullHistory.length}`);
  } catch (err) {
    console.error("❌ Lỗi load history:", err.message);
  }
}

function saveHistoryFiles() {
  try {
    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(history, null, 2));
    fs.writeFileSync(CONFIG.FULL_FILE, JSON.stringify(fullHistory, null, 2));
  } catch (err) {
    console.error("❌ Lỗi save history:", err.message);
  }
}

// =====================
// Strategy Implementations
// Each returns { probTai, probXiu } (not necessarily normalized; normalize later).
// =====================

const Strategies = {};

// 1. long-run reversal (detect k repeats -> predict reversal)
Strategies.longRun = (results) => {
  const n = Math.min(8, Math.floor(results.length / 2));
  if (n >= 3) {
    const lastK = results.slice(-n);
    if (lastK.every(r => r === lastK[0])) {
      const opp = opposite(lastK[0]);
      return opp === "Tài" ? { probTai: 0.9, probXiu: 0.1 } : { probTai: 0.1, probXiu: 0.9 };
    }
  }
  return { probTai: 0.5, probXiu: 0.5 };
};

// 2. alternation continuation
Strategies.alternation = (results) => {
  if (results.length < 4) return { probTai: 0.5, probXiu: 0.5 };
  const last4 = results.slice(-4);
  let alt = true;
  for (let i = 1; i < last4.length; i++) if (last4[i] === last4[i - 1]) alt = false;
  if (alt) {
    const next = opposite(last4[last4.length - 1]);
    return next === "Tài" ? { probTai: 0.8, probXiu: 0.2 } : { probTai: 0.2, probXiu: 0.8 };
  }
  return { probTai: 0.5, probXiu: 0.5 };
};

// 3. adaptive momentum (weighted recent)
Strategies.momentum = (results) => {
  const n = Math.min(12, results.length);
  const tail = results.slice(-n);
  let score = 0;
  for (let i = 0; i < tail.length; i++) {
    const weight = (i + 1) / n;
    score += tail[i] === "Tài" ? weight : -weight;
  }
  const norm = score / n; // -1..1
  if (Math.abs(norm) < 0.18) return { probTai: 0.5, probXiu: 0.5 };
  if (norm > 0) return { probTai: clamp(0.52 + norm * 0.5, 0.52, 0.98), probXiu: 1 - clamp(0.52 + norm * 0.5, 0.52, 0.98) };
  return { probTai: 1 - clamp(0.52 + -norm * 0.5, 0.52, 0.98), probXiu: clamp(0.52 + -norm * 0.5, 0.52, 0.98) };
};

// 4. bias regression (revert when strong bias present)
Strategies.biasRegression = (results) => {
  const n = Math.min(40, results.length);
  const tail = results.slice(-n);
  const tai = tail.filter(r => r === "Tài").length, p = tai / tail.length;
  const diff = p - 0.5;
  if (Math.abs(diff) < 0.08) return { probTai: 0.5, probXiu: 0.5 };
  if (diff > 0) {
    const probX = clamp(0.56 + (diff - 0.08) * 2.2, 0.56, 0.95);
    return { probTai: 1 - probX, probXiu: probX };
  } else {
    const probT = clamp(0.56 + (-diff - 0.08) * 2.2, 0.56, 0.95);
    return { probTai: probT, probXiu: 1 - probT };
  }
};

// 5. markov order-1 (learn P(next|last))
Strategies.markov1 = (results, fullResults) => {
  if (!fullResults || fullResults.length < 10 || results.length < 1) return { probTai: 0.5, probXiu: 0.5 };
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

// 6. markov order-2
Strategies.markov2 = (results, fullResults) => {
  if (!fullResults || fullResults.length < 20 || results.length < 2) return { probTai: 0.5, probXiu: 0.5 };
  const counts = {};
  for (let i = 0; i < fullResults.length - 2; i++) {
    const key = fullResults[i] + "|" + fullResults[i + 1];
    const next = fullResults[i + 2];
    counts[key] = counts[key] || { "Tài": 0, "Xỉu": 0, total: 0 };
    counts[key][next]++; counts[key].total++;
  }
  const key = results.slice(-2).join("|");
  if (!counts[key] || counts[key].total < 3) return { probTai: 0.5, probXiu: 0.5 };
  return { probTai: counts[key]["Tài"] / counts[key].total, probXiu: counts[key]["Xỉu"] / counts[key].total };
};

// 7. pattern similarity for many lengths (5,6,7) - we will wrap below
Strategies.patternSimilarity = (results, fullResults, M) => {
  if (!fullResults || fullResults.length < M + 4) return { probTai: 0.5, probXiu: 0.5 };
  const pattern = results.slice(-M).join("");
  let taiNext = 0, xiuNext = 0, matches = 0;
  for (let i = 0; i <= fullResults.length - M - 1; i++) {
    const seq = fullResults.slice(i, i + M).join("");
    if (seq === pattern) {
      const next = fullResults[i + M];
      if (!next) continue;
      matches++;
      if (next === "Tài") taiNext++; else xiuNext++;
    }
  }
  if (matches < 3) return { probTai: 0.5, probXiu: 0.5 };
  const pTai = taiNext / (taiNext + xiuNext);
  return { probTai: pTai, probXiu: 1 - pTai };
};

// 8. frequency baseline
Strategies.frequency = (results, fullResults) => {
  if (!fullResults || fullResults.length === 0) return { probTai: 0.5, probXiu: 0.5 };
  const tailN = Math.min(300, fullResults.length);
  const tail = fullResults.slice(-tailN);
  const t = tail.filter(r => r === "Tài").length;
  const pTai = t / tail.length;
  return { probTai: pTai, probXiu: 1 - pTai };
};

// =====================
// Backtest & Weight Computation (cached periodically)
// =====================

/**
 * backtest(fn, fullResults) -> accuracy (0..1)
 * fn: function(histSlice) => { probTai, probXiu }
 */
function backtestStrategy(fn, fullResults, maxSteps = CONFIG.BACKTEST_MAX_STEPS) {
  if (!fullResults || fullResults.length < CONFIG.MIN_HISTORY_FOR_BACKTEST) return 0.5;
  let correct = 0, total = 0;
  const start = Math.max(6, Math.floor(fullResults.length / 10));
  const end = fullResults.length - 1;
  const limit = Math.min(maxSteps, end - start);
  for (let k = 0; k < limit; k++) {
    const i = start + k;
    const histSlice = fullResults.slice(0, i);
    if (histSlice.length < 3) continue;
    try {
      const p = fn(histSlice);
      if (!p) continue;
      const pred = (p.probTai || 0) >= (p.probXiu || 0) ? "Tài" : "Xỉu";
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

/**
 * computeWeights(fullResults) -> fills weightCache.weights and accuracies
 * - Uses configured strategies (including pattern lengths)
 */
function computeWeights(fullResults) {
  const nowTs = now();
  if (!fullResults || fullResults.length < 10) {
    // default equal weights
    const defaultWeights = {};
    const names = baseStrategyNames();
    names.forEach(n => defaultWeights[n] = 1);
    weightCache = { computedAt: nowTs, weights: defaultWeights, accuracies: {} };
    return weightCache;
  }

  const results = {}; // { name: { acc, weight, info } }

  // helper to run backtest for a strategy wrapper
  const evalAndStore = (name, fn) => {
    const acc = backtestStrategy(fn, fullResults);
    const accClamped = clamp(acc, 0.01, 0.99);
    const weight = Math.pow(accClamped, CONFIG.BACKTEST_ALPHA);
    results[name] = { acc, weight };
  };

  // evaluate built-in strategies
  evalAndStore("longRun", (h) => Strategies.longRun(h));
  evalAndStore("alternation", (h) => Strategies.alternation(h));
  evalAndStore("momentum", (h) => Strategies.momentum(h));
  evalAndStore("biasRegression", (h) => Strategies.biasRegression(h));
  evalAndStore("markov1", (h) => Strategies.markov1(h, fullResults));
  evalAndStore("markov2", (h) => Strategies.markov2(h, fullResults));
  // pattern lengths
  for (const M of CONFIG.PATTERN_LENGTHS) {
    evalAndStore(`pattern_${M}`, (h) => Strategies.patternSimilarity(h, fullResults, M));
  }
  evalAndStore("frequency", (h) => Strategies.frequency(h, fullResults));

  // normalize weights
  let sumW = 0;
  Object.keys(results).forEach(k => sumW += results[k].weight);
  if (sumW <= 0) sumW = 1;
  const weights = {};
  const accuracies = {};
  Object.keys(results).forEach(k => {
    weights[k] = results[k].weight / sumW;
    accuracies[k] = results[k].acc;
  });

  weightCache = { computedAt: nowTs, weights, accuracies };
  return weightCache;
}

function baseStrategyNames() {
  const names = ["longRun", "alternation", "momentum", "biasRegression", "markov1", "markov2"];
  for (const M of CONFIG.PATTERN_LENGTHS) names.push(`pattern_${M}`);
  names.push("frequency");
  return names;
}

// Recompute on schedule
setInterval(() => {
  try {
    computeWeights(fullHistory);
    // console.log("🔁 Weights recomputed at", new Date().toISOString());
  } catch (e) {
    console.warn("⚠️ Lỗi khi computeWeights:", e.message);
  }
}, CONFIG.RECOMPUTE_WEIGHTS_INTERVAL_MS);

// compute once on start if possible
computeWeights(fullHistory);

// =====================
// Main Ensemble prediction function (VIP PRO)
// Uses weights from weightCache (recomputes if stale)
// =====================
function predictAdvancedVIP(hist, fullHist) {
  const recent = (hist || []).map(h => h.result);
  const full = (fullHist || []).map(h => h.result);

  // If insufficient full history, fallback simple frequency of recent
  if (full.length < 6) {
    const all = recent.concat(full);
    const taiCount = all.filter(r => r === "Tài").length;
    const pTai = all.length ? taiCount / all.length : 0.5;
    const pred = pTai >= 0.5 ? "Tài" : "Xỉu";
    return {
      du_doan: pred,
      thuat_toan: "Fallback (ít dữ liệu)",
      confidence: clamp(Math.abs(pTai - 0.5) * 2, 0.05, 0.99),
      details: { agg: { pTai, pXiu: 1 - pTai }, votes: {} }
    };
  }

  // ensure weights are recent enough; recompute if too old
  if (now() - (weightCache.computedAt || 0) > Math.max(5000, CONFIG.RECOMPUTE_WEIGHTS_INTERVAL_MS)) {
    computeWeights(full);
  }

  const strategyFns = {};
  // map names -> functions that accept recent and return normalized {probTai, probXiu}
  strategyFns.longRun = (r) => normalize(Strategies.longRun(r));
  strategyFns.alternation = (r) => normalize(Strategies.alternation(r));
  strategyFns.momentum = (r) => normalize(Strategies.momentum(r));
  strategyFns.biasRegression = (r) => normalize(Strategies.biasRegression(r));
  strategyFns.markov1 = (r) => normalize(Strategies.markov1(r, full));
  strategyFns.markov2 = (r) => normalize(Strategies.markov2(r, full));
  for (const M of CONFIG.PATTERN_LENGTHS) {
    strategyFns[`pattern_${M}`] = (r) => normalize(Strategies.patternSimilarity(r, full, M));
  }
  strategyFns.frequency = (r) => normalize(Strategies.frequency(r, full));

  // collect votes
  const votes = {};
  let aggTai = 0, aggXiu = 0;
  const weights = weightCache.weights || {};
  const accuracies = weightCache.accuracies || {};

  Object.keys(strategyFns).forEach(name => {
    const fn = strategyFns[name];
    let p = { probTai: 0.5, probXiu: 0.5 };
    try { p = fn(recent); } catch (e) { p = { probTai: 0.5, probXiu: 0.5 }; }
    // normalize
    p = normalize(p);
    const w = weights[name] || (1 / Object.keys(strategyFns).length);
    aggTai += w * (p.probTai || 0);
    aggXiu += w * (p.probXiu || 0);

    votes[name] = {
      pred: (p.probTai || 0) >= (p.probXiu || 0) ? "Tài" : "Xỉu",
      pTai: Math.round((p.probTai || 0) * 1000) / 1000,
      pXiu: Math.round((p.probXiu || 0) * 1000) / 1000,
      weight: Math.round((w || 0) * 1000) / 1000,
      backtestAcc: Math.round(((accuracies && accuracies[name]) || 0) * 1000) / 1000
    };
  });

  // normalize aggregate
  const sumAgg = (aggTai + aggXiu) || 1;
  aggTai = aggTai / sumAgg;
  aggXiu = aggXiu / sumAgg;

  // confidence derived from distance and average backtest quality
  const avgAcc = averageObjectValues(weightCache.accuracies || {});
  const baseConf = clamp(Math.abs(aggTai - aggXiu), 0.01, 0.999);
  const confidence = clamp(baseConf * (0.6 + 0.4 * clamp(avgAcc, 0, 1)), 0.01, 0.999);

  const finalPred = aggTai >= aggXiu ? "Tài" : "Xỉu";

  return {
    du_doan: finalPred,
    thuat_toan: "VIP PRO Ensemble (weighted multi-strategy)",
    confidence: Math.round(confidence * 1000) / 1000,
    agg: { pTai: Math.round(aggTai * 1000) / 1000, pXiu: Math.round(aggXiu * 1000) / 1000 },
    votes,
    weights: weightCache.weights || {},
    backtestAccuracies: weightCache.accuracies || {}
  };
}

function normalize(p) {
  const a = (p.probTai || 0), b = (p.probXiu || 0);
  const s = a + b;
  if (!s || !isFinite(s)) return { probTai: 0.5, probXiu: 0.5 };
  return { probTai: a / s, probXiu: b / s };
}

function averageObjectValues(obj) {
  const keys = Object.keys(obj || {});
  if (keys.length === 0) return 0;
  const sum = keys.reduce((a, k) => a + (obj[k] || 0), 0);
  return sum / keys.length;
}

// =====================
// Fetch loop (every FETCH_INTERVAL_MS)
// =====================
async function fetchOnceAndSave() {
  try {
    const res = await axios.get(CONFIG.SOURCE_API, { timeout: 4000 });
    const item = res.data || {};
    const phien = safeParseInt(item.phien);
    const x1 = safeParseInt(item.xuc_xac_1);
    const x2 = safeParseInt(item.xuc_xac_2);
    const x3 = safeParseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = (item.ket_qua || "").trim() === "Tài" ? "Tài" : "Xỉu";

    if (!isNaN(phien) && tong >= 3 && tong <= 18) {
      // avoid duplicate
      if (!fullHistory.find(h => h.phien === phien)) {
        const entry = { phien, result: ket_qua, xuc_xac: [x1, x2, x3], tong_xuc_xac: tong, time: new Date().toISOString() };
        fullHistory.push(entry);
        history.push(entry);
        while (history.length > CONFIG.MAX_HISTORY) history.shift();
        saveHistoryFiles();
        lastPredictionCache = null; // invalidate cache
        // optionally recompute weights in background if many new entries
        // but recomputation is scheduled periodically already
        console.log(`✅ Phiên ${phien}: ${ket_qua} (t=${tong}) — recent ${history.length}/20 full ${fullHistory.length}`);
      } else {
        // option: check update if changed, currently ignore
      }
    }
  } catch (err) {
    console.error("⚠️ Lỗi fetch:", err.message);
  }
}

// =====================
// Endpoints
// =====================

app.get("/sunwinapi", (req, res) => {
  const latest = history[history.length - 1] || {};
  if (!lastPredictionCache) {
    try {
      lastPredictionCache = predictAdvancedVIP(history, fullHistory);
      lastPredictionCache.generated_at = new Date().toISOString();
    } catch (e) {
      lastPredictionCache = { du_doan: "Tài", thuat_toan: "error_fallback", confidence: 0.5, agg: { pTai: 0.5, pXiu: 0.5 }, votes: {} };
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

// full history
app.get("/fullhistory", (req, res) => {
  res.json({ total: fullHistory.length, fullHistory });
});

// stats
app.get("/stats", (req, res) => {
  const total = fullHistory.length;
  const tai = fullHistory.filter(h => h.result === "Tài").length;
  res.json({ total, tai, xiu: total - tai, ratio_tai: total ? +(tai / total).toFixed(4) : 0 });
});

// debug single algorithm: /algo/markov1 or /algo/pattern_6
app.get("/algo/:name", (req, res) => {
  const name = req.params.name;
  const recent = (history || []).map(h => h.result);
  const full = (fullHistory || []).map(h => h.result);
  const available = baseStrategyNames();
  if (!available.includes(name)) return res.status(404).json({ error: "Không tồn tại thuật toán: " + name, available });

  // function wrapper
  let p = { probTai: 0.5, probXiu: 0.5 };
  try {
    if (name === "longRun") p = Strategies.longRun(recent);
    else if (name === "alternation") p = Strategies.alternation(recent);
    else if (name === "momentum") p = Strategies.momentum(recent);
    else if (name === "biasRegression") p = Strategies.biasRegression(recent);
    else if (name === "markov1") p = Strategies.markov1(recent, full);
    else if (name === "markov2") p = Strategies.markov2(recent, full);
    else if (name.startsWith("pattern_")) {
      const M = parseInt(name.split("_")[1]); p = Strategies.patternSimilarity(recent, full, M);
    } else if (name === "frequency") p = Strategies.frequency(recent, full);
    p = normalize(p);
  } catch (e) { p = { probTai: 0.5, probXiu: 0.5 }; }

  const acc = (weightCache.accuracies && weightCache.accuracies[name]) || null;
  res.json({ algo: name, prob: { pTai: p.probTai, pXiu: p.probXiu }, backtestAcc: acc });
});

// get config
app.get("/config", (req, res) => {
  res.json({ CONFIG });
});

// force recompute weights (admin)
app.post("/admin/recompute-weights", (req, res) => {
  try {
    computeWeights(fullHistory);
    res.json({ ok: true, computedAt: weightCache.computedAt, weights: weightCache.weights });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================
// Start server & timers
// =====================
loadHistoryFiles();
setInterval(fetchOnceAndSave, CONFIG.FETCH_INTERVAL_MS);
app.listen(PORT, () => {
  console.log(`🚀 Botrumsunwin API Menchining (VIP PRO) running on port ${PORT}`);
});
