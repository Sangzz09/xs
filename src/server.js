// index.js
// BOTRUMSUNWIN API — VIP PRO (stable + VIP PRO ensemble pattern)
// - Adaptive Ensemble (Pattern matching multi-length + Bias + Rolling + Noise) +
// - Backtest weight cache + safe async I/O + axios timeout + endpoints
// Node >= 14 recommended

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ================ CONFIG ================
const CONFIG = {
  SOURCE_API: "https://hackvn.xyz/apisun.php",
  DATA_FILE: path.resolve(__dirname, "data.json"),
  FULL_FILE: path.resolve(__dirname, "full_history.json"),
  MAX_HISTORY: 20,
  FETCH_INTERVAL_MS: 5000,
  BACKTEST_MAX_STEPS: 200,
  BACKTEST_ALPHA: 3,
  RECOMPUTE_WEIGHTS_INTERVAL_MS: 60 * 1000,
  MIN_HISTORY_FOR_BACKTEST: 30,
  PATTERN_LENGTHS: [5, 6, 7],
  AXIOS_TIMEOUT_MS: 4000,
  PATTERN_LIBRARY_MAX: 2000 // max number of patterns to keep in memory
};

// ================ STATE ================
let history = []; // recent MAX_HISTORY
let fullHistory = []; // all entries
let lastPredictionCache = null;
let weightCache = { computedAt: 0, weights: {}, accuracies: {} };
let recomputeInProgress = false;
let lastFetchAttempt = 0;

// ================ UTILITIES ================
function safeParseInt(v) { const n = parseInt(v); return isNaN(n) ? 0 : n; }
const opposite = (r) => (r === "Tài" ? "Xỉu" : "Tài");
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function buildPattern(list) { return list.map(h => (h.result === "Tài" ? "t" : "x")).join(""); }
const now = () => Date.now();

async function loadHistoryFiles() {
  try {
    if (fs.existsSync(CONFIG.DATA_FILE)) {
      const txt = await fs.promises.readFile(CONFIG.DATA_FILE, "utf8").catch(() => null);
      if (txt) {
        try { history = JSON.parse(txt); } catch (e) { console.warn("⚠️ data.json corrupt -> reset recent"); history = []; }
      }
    }
    if (fs.existsSync(CONFIG.FULL_FILE)) {
      const txt2 = await fs.promises.readFile(CONFIG.FULL_FILE, "utf8").catch(() => null);
      if (txt2) {
        try { fullHistory = JSON.parse(txt2); } catch (e) { console.warn("⚠️ full_history.json corrupt -> reset full"); fullHistory = []; }
      }
    }
    console.log(`📂 Loaded recent=${history.length} / full=${fullHistory.length}`);
  } catch (err) {
    console.error("❌ loadHistoryFiles error:", err && err.message);
  }
}

async function saveHistoryFiles() {
  try {
    await fs.promises.writeFile(CONFIG.DATA_FILE, JSON.stringify(history, null, 2)).catch(err => {
      console.warn("⚠️ write recent error:", err && err.message);
    });
    await fs.promises.writeFile(CONFIG.FULL_FILE, JSON.stringify(fullHistory, null, 2)).catch(err => {
      console.warn("⚠️ write full error:", err && err.message);
    });
  } catch (err) {
    console.error("❌ saveHistoryFiles error:", err && err.message);
  }
}

// ================ STRATEGIES ================
// Each returns { probTai, probXiu } (unnormalized OK)
const Strategies = {};

// 1) Long-run reversal
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

// 2) Alternation continuation
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

// 3) Momentum (weighted recent)
Strategies.momentum = (results) => {
  const n = Math.min(12, results.length);
  const tail = results.slice(-n);
  let score = 0;
  for (let i = 0; i < tail.length; i++) {
    const weight = (i + 1) / n;
    score += tail[i] === "Tài" ? weight : -weight;
  }
  const norm = score / n;
  if (Math.abs(norm) < 0.18) return { probTai: 0.5, probXiu: 0.5 };
  if (norm > 0) return { probTai: clamp(0.52 + norm * 0.5, 0.52, 0.98), probXiu: 1 - clamp(0.52 + norm * 0.5, 0.52, 0.98) };
  return { probTai: 1 - clamp(0.52 + -norm * 0.5, 0.52, 0.98), probXiu: clamp(0.52 + -norm * 0.5, 0.52, 0.98) };
};

// 4) Bias regression (revert to mean)
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

// 5) Markov-1
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

// 6) Markov-2
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

// 7) Pattern similarity variable length
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

// 8) Frequency baseline
Strategies.frequency = (results, fullResults) => {
  if (!fullResults || fullResults.length === 0) return { probTai: 0.5, probXiu: 0.5 };
  const tailN = Math.min(300, fullResults.length);
  const tail = fullResults.slice(-tailN);
  const t = tail.filter(r => r === "Tài").length;
  const pTai = t / tail.length;
  return { probTai: pTai, probXiu: 1 - pTai };
};

// ================ BACKTEST & WEIGHT CACHE ================
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
function baseStrategyNames() {
  const names = ["longRun", "alternation", "momentum", "biasRegression", "markov1", "markov2"];
  for (const M of CONFIG.PATTERN_LENGTHS) names.push(`pattern_${M}`);
  names.push("frequency");
  return names;
}

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
      // skip failures
    }
  }
  if (total === 0) return 0.5;
  return correct / total;
}

async function computeWeights(fullResults) {
  if (recomputeInProgress) return weightCache;
  recomputeInProgress = true;
  try {
    const nowTs = now();
    if (!fullResults || fullResults.length < 10) {
      const defaultWeights = {};
      const names = baseStrategyNames();
      names.forEach(n => defaultWeights[n] = 1 / names.length);
      weightCache = { computedAt: nowTs, weights: defaultWeights, accuracies: {} };
      recomputeInProgress = false;
      return weightCache;
    }

    const results = {};
    const evalAndStore = (name, fn) => {
      const acc = backtestStrategy(fn, fullResults);
      const accClamped = clamp(acc, 0.01, 0.99);
      const weight = Math.pow(accClamped, CONFIG.BACKTEST_ALPHA);
      results[name] = { acc, weight };
    };

    evalAndStore("longRun", (h) => Strategies.longRun(h));
    evalAndStore("alternation", (h) => Strategies.alternation(h));
    evalAndStore("momentum", (h) => Strategies.momentum(h));
    evalAndStore("biasRegression", (h) => Strategies.biasRegression(h));
    evalAndStore("markov1", (h) => Strategies.markov1(h, fullResults));
    evalAndStore("markov2", (h) => Strategies.markov2(h, fullResults));
    for (const M of CONFIG.PATTERN_LENGTHS) {
      evalAndStore(`pattern_${M}`, (h) => Strategies.patternSimilarity(h, fullResults, M));
    }
    evalAndStore("frequency", (h) => Strategies.frequency(h, fullResults));

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
  } catch (e) {
    console.warn("⚠️ computeWeights failed:", e && e.message);
    return weightCache;
  } finally {
    recomputeInProgress = false;
  }
}

// schedule compute weights in background
setInterval(() => {
  computeWeights(fullHistory).catch(e => console.warn("computeWeights err:", e && e.message));
}, CONFIG.RECOMPUTE_WEIGHTS_INTERVAL_MS);

// warm compute
computeWeights(fullHistory).catch(()=>{});

// ================ VIP PRO ENSEMBLE (Pattern lib + Bias + Rolling + Noise + Ensemble) ================
/**
 * patternLibBuild: optional lightweight library builder from fullHistory to find frequent subpatterns.
 * We'll use this for "Pattern Matching (library)" strategy.
 */
function buildPatternLibrary(fullResults, lengths = CONFIG.PATTERN_LENGTHS, maxEntries = CONFIG.PATTERN_LIBRARY_MAX) {
  const lib = {};
  if (!fullResults || fullResults.length < 30) return lib;
  const seq = fullResults.join("");
  for (const L of lengths) {
    for (let i = 0; i <= seq.length - L; i++) {
      const p = seq.slice(i, i + L);
      const next = seq[i + L];
      if (!next) continue;
      const key = `${L}|${p}`;
      lib[key] = lib[key] || { nextCount: {}, total: 0 };
      lib[key].nextCount[next] = (lib[key].nextCount[next] || 0) + 1;
      lib[key].total++;
    }
  }
  // optionally trim
  const keys = Object.keys(lib).sort((a,b) => lib[b].total - lib[a].total).slice(0, maxEntries);
  const small = {};
  keys.forEach(k => small[k] = lib[k]);
  return small;
}

// Keep a lightweight pattern lib in memory (rebuild occasionally)
let patternLibrary = {};
let patternLibComputedAt = 0;
function maybeRebuildPatternLib() {
  if (now() - patternLibComputedAt < CONFIG.RECOMPUTE_WEIGHTS_INTERVAL_MS) return;
  try {
    const full = fullHistory.map(h => h.result === "Tài" ? "T" : "X");
    patternLibrary = buildPatternLibrary(full, CONFIG.PATTERN_LENGTHS, CONFIG.PATTERN_LIBRARY_MAX);
    patternLibComputedAt = now();
  } catch (e) {
    patternLibrary = {};
  }
}
maybeRebuildPatternLib();
setInterval(() => { maybeRebuildPatternLib(); }, CONFIG.RECOMPUTE_WEIGHTS_INTERVAL_MS * 5);

// Main predictor
function predictAdvancedVIPPRO(hist, fullHist) {
  const recent = (hist || []).map(h => h.result);
  const full = (fullHist || []).map(h => h.result);

  // fallback if not enough history
  if (full.length < 6) {
    const all = recent.concat(full);
    const taiCount = all.filter(r => r === "Tài").length;
    const pTai = all.length ? taiCount / all.length : 0.5;
    return {
      du_doan: pTai >= 0.5 ? "Tài" : "Xỉu",
      thuat_toan: "Fallback (ít dữ liệu)",
      confidence: clamp(Math.abs(pTai - 0.5) * 2, 0.01, 0.99),
      details: { agg: { pTai, pXiu: 1 - pTai }, votes: {} }
    };
  }

  // ensure weightCache fresh (trigger background compute, but avoid blocking)
  if (now() - (weightCache.computedAt || 0) > Math.max(5000, CONFIG.RECOMPUTE_WEIGHTS_INTERVAL_MS)) {
    computeWeights(full).catch(()=>{});
  }
  maybeRebuildPatternLib();

  // 1) Pattern Matching (library & similarity)
  function patternMatchScore(recentArr) {
    const seq = recentArr.map(r => r === "Tài" ? "T" : "X").join("");
    let scoreTai = 0, scoreXiu = 0;
    for (const key of Object.keys(patternLibrary || {})) {
      const [L, pattern] = key.split("|");
      const Lnum = parseInt(L);
      if (seq.endsWith(pattern)) {
        const info = patternLibrary[key];
        const nextCounts = info.nextCount || {};
        const t = nextCounts["T"] || 0, x = nextCounts["X"] || 0;
        const total = t + x || 1;
        const pT = t / total;
        const pX = x / total;
        scoreTai += pT * Math.log(1 + info.total);
        scoreXiu += pX * Math.log(1 + info.total);
      }
    }
    // also try direct patternSimilarity strategies for lengths
    for (const M of CONFIG.PATTERN_LENGTHS) {
      const p = Strategies.patternSimilarity(recentArr, full, M);
      scoreTai += (p.probTai || 0) * 1.0;
      scoreXiu += (p.probXiu || 0) * 1.0;
    }
    return normalize({ probTai: scoreTai + 0.0001, probXiu: scoreXiu + 0.0001 });
  }

  // 2) Bias dynamic
  function biasScoreFn(recentArr) {
    const last10 = recentArr.slice(-10);
    const taiCount = last10.filter(r => r === "Tài").length;
    if (taiCount >= 7) return { probTai: 0.35, probXiu: 0.65 }; // expect revert
    if (taiCount <= 3) return { probTai: 0.65, probXiu: 0.35 };
    return { probTai: 0.5, probXiu: 0.5 };
  }

  // 3) Rolling streak / cycle detection
  function rollingFn(recentArr) {
    let streak = 1;
    for (let i = recentArr.length - 2; i >= 0; i--) {
      if (recentArr[i] === recentArr[i + 1]) streak++;
      else break;
    }
    // compute average streak historically
    let sumStreaks = 0, count = 0;
    for (let i = 1; i < full.length; i++) {
      // simple streak calculation
      // only approximate: reset when change
      // for speed we sample last 500
      if (i > full.length - 500) {
        // compute small streaks
      }
    }
    // heuristic: if streak >=4 -> likely revert
    if (streak >= 4) {
      const opp = opposite(recentArr[recentArr.length - 1]);
      return opp === "Tài" ? { probTai: 0.8, probXiu: 0.2 } : { probTai: 0.2, probXiu: 0.8 };
    }
    // otherwise small momentum
    return Strategies.momentum(recentArr);
  }

  // 4) Hash-based controlled noise
  function noiseFn(recentArr) {
    // use last phien if available
    const lastPhien = hist[hist.length - 1] ? safeParseInt(hist[hist.length - 1].phien) : Math.floor(now() / 1000);
    const v = Math.abs(Math.sin(lastPhien * 997)) ; // 0..1
    const bias = (v - 0.5) * 0.2; // -0.1..+0.1
    // produce tiny bias
    return { probTai: clamp(0.5 + bias, 0.01, 0.99), probXiu: clamp(0.5 - bias, 0.01, 0.99) };
  }

  // 5) Frequency baseline
  const freq = Strategies.frequency(recent, full);

  // Collect strategy outputs (normalized)
  const strategyOutputs = {};
  strategyOutputs.patternLib = patternMatchScore(recent);
  strategyOutputs.pattern_similarity_5 = normalize(Strategies.patternSimilarity(recent, full, 5));
  strategyOutputs.pattern_similarity_6 = normalize(Strategies.patternSimilarity(recent, full, 6));
  strategyOutputs.pattern_similarity_7 = normalize(Strategies.patternSimilarity(recent, full, 7));
  strategyOutputs.bias = normalize(biasScoreFn(recent));
  strategyOutputs.rolling = normalize(rollingFn(recent));
  strategyOutputs.momentum = normalize(Strategies.momentum(recent));
  strategyOutputs.markov1 = normalize(Strategies.markov1(recent, full));
  strategyOutputs.markov2 = normalize(Strategies.markov2(recent, full));
  strategyOutputs.frequency = normalize(freq);
  strategyOutputs.noise = normalize(noiseFn(recent));

  // Determine weights: combine weightCache (backtest) and dynamic confidence
  const weights = weightCache.weights || {};
  // fallback uniform if missing
  const baseNames = baseStrategyNames().concat(Object.keys(strategyOutputs).filter(k => k.startsWith("pattern_") || k==="patternLib" || k==="noise"));
  const uniform = 1 / Math.max(1, baseNames.length);
  let aggTai = 0, aggXiu = 0;
  const votes = {};

  // Use a custom mapping for names to ensure coverage
  const mappingNames = [
    "patternLib",
    "pattern_5",
    "pattern_6",
    "pattern_7",
    "biasRegression",
    "rolling",
    "momentum",
    "markov1",
    "markov2",
    "frequency",
    "noise"
  ];

  mappingNames.forEach(name => {
    const out = strategyOutputs[name] || strategyOutputs[name.replace("_", "pattern_")] || strategyOutputs[name] || { probTai: 0.5, probXiu: 0.5 };
    // map weight: prefer weightCache entry if exists for similar name
    let w = uniform;
    if (weightCache.weights && weightCache.weights[name]) w = weightCache.weights[name];
    // for patternLib give slightly higher base weight
    if (name === "patternLib") w = (w || uniform) * 1.4;
    // normalize
    aggTai += w * (out.probTai || 0);
    aggXiu += w * (out.probXiu || 0);
    votes[name] = {
      pred: (out.probTai || 0) >= (out.probXiu || 0) ? "Tài" : "Xỉu",
      pTai: Math.round((out.probTai || 0) * 1000) / 1000,
      pXiu: Math.round((out.probXiu || 0) * 1000) / 1000,
      weight: Math.round((w || 0) * 1000) / 1000,
      backtestAcc: Math.round(((weightCache.accuracies && weightCache.accuracies[name]) || 0) * 1000) / 1000
    };
  });

  // normalize aggregate
  const totalAgg = (aggTai + aggXiu) || 1;
  aggTai = aggTai / totalAgg;
  aggXiu = aggXiu / totalAgg;

  // compute confidence combining agg distance and historical average accuracy
  const avgAcc = averageObjectValues(weightCache.accuracies || {});
  const baseConf = clamp(Math.abs(aggTai - aggXiu), 0.01, 0.999);
  const confidence = clamp(baseConf * (0.6 + 0.4 * clamp(avgAcc, 0, 1)), 0.01, 0.999);

  const finalPred = aggTai >= aggXiu ? "Tài" : "Xỉu";

  return {
    du_doan: finalPred,
    thuat_toan: "VIP PRO 5-Tier Ensemble",
    confidence: Math.round(confidence * 1000) / 1000,
    agg: { pTai: Math.round(aggTai * 1000) / 1000, pXiu: Math.round(aggXiu * 1000) / 1000 },
    votes,
    weights: weightCache.weights || {},
    backtestAccuracies: weightCache.accuracies || {},
    patternLibSize: Object.keys(patternLibrary || {}).length
  };
}

// ================ FETCH LOOP (robust) ================
async function fetchOnceAndSave() {
  lastFetchAttempt = now();
  try {
    const res = await axios.get(CONFIG.SOURCE_API, { timeout: CONFIG.AXIOS_TIMEOUT_MS });
    if (!res || !res.data) return;
    const item = res.data;
    const phien = safeParseInt(item.phien);
    const x1 = safeParseInt(item.xuc_xac_1);
    const x2 = safeParseInt(item.xuc_xac_2);
    const x3 = safeParseInt(item.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = (item.ket_qua || "").trim() === "Tài" ? "Tài" : "Xỉu";

    if (!isNaN(phien) && tong >= 3 && tong <= 18) {
      const exists = fullHistory.some(h => h.phien === phien);
      if (!exists) {
        const entry = { phien, result: ket_qua, xuc_xac: [x1, x2, x3], tong_xuc_xac: tong, time: new Date().toISOString() };
        fullHistory.push(entry);
        history.push(entry);
        while (history.length > CONFIG.MAX_HISTORY) history.shift();
        // async save
        saveHistoryFiles().catch(()=>{});
        lastPredictionCache = null;
        // Optionally trigger a background weight recompute when many new entries
        // but recompute is scheduled periodically anyway
        console.log(`✅ Phiên ${phien}: ${ket_qua} (t=${tong}) — recent ${history.length}/20 full ${fullHistory.length}`);
      }
    }
  } catch (err) {
    console.warn("⚠️ fetchOnceAndSave error:", err && (err.message || err.toString()));
  }
}

// start fetch interval
setInterval(() => {
  fetchOnceAndSave().catch(e => console.warn("fetch loop err:", e && e.message));
}, CONFIG.FETCH_INTERVAL_MS);

// ================ ENDPOINTS ================
app.get("/", (req, res) => res.json({ status: "ok", mode: "BOTRUMSUNWIN VIP PRO", now: new Date().toISOString() }));

app.get("/sunwinapi", (req, res) => {
  try {
    const latest = history[history.length - 1] || {};
    if (!lastPredictionCache) {
      try {
        lastPredictionCache = predictAdvancedVIPPRO(history, fullHistory);
        lastPredictionCache.generated_at = new Date().toISOString();
      } catch (e) {
        lastPredictionCache = { du_doan: "Tài", thuat_toan: "error_fallback", confidence: 0.5, agg: { pTai: 0.5, pXiu: 0.5 }, votes: {} };
      }
    }
    return res.json({
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
  } catch (e) {
    console.error("❌ /sunwinapi error:", e && e.message);
    res.status(500).json({ error: "internal" });
  }
});

app.get("/fullhistory", (req, res) => res.json({ total: fullHistory.length, fullHistory }));

app.get("/stats", (req, res) => {
  const total = fullHistory.length;
  const tai = fullHistory.filter(h => h.result === "Tài").length;
  res.json({ total, tai, xiu: total - tai, ratio_tai: total ? +(tai / total).toFixed(4) : 0 });
});

// debug single algorithm
app.get("/algo/:name", (req, res) => {
  const name = req.params.name;
  const recent = (history || []).map(h => h.result);
  const full = (fullHistory || []).map(h => h.result);
  const available = baseStrategyNames().concat(["patternLib","pattern_5","pattern_6","pattern_7","rolling","noise"]);
  if (!available.includes(name)) return res.status(404).json({ error: "Không tồn tại thuật toán: " + name, available });

  try {
    let p = { probTai: 0.5, probXiu: 0.5 };
    if (name === "longRun") p = Strategies.longRun(recent);
    else if (name === "alternation") p = Strategies.alternation(recent);
    else if (name === "momentum") p = Strategies.momentum(recent);
    else if (name === "biasRegression") p = Strategies.biasRegression(recent);
    else if (name === "markov1") p = Strategies.markov1(recent, full);
    else if (name === "markov2") p = Strategies.markov2(recent, full);
    else if (name === "patternLib") p = patternMatchDebug(recent, full);
    else if (name.startsWith("pattern_")) {
      const M = parseInt(name.split("_")[1]); p = Strategies.patternSimilarity(recent, full, M);
    } else if (name === "frequency") p = Strategies.frequency(recent, full);
    else if (name === "rolling") p = Strategies.momentum(recent);
    else if (name === "noise") p = (function(){ const lastPhien = history[history.length-1] ? safeParseInt(history[history.length-1].phien) : Math.floor(now()/1000); const v = Math.abs(Math.sin(lastPhien*997)); const bias = (v-0.5)*0.2; return normalize({probTai: clamp(0.5+bias,0.01,0.99), probXiu: clamp(0.5-bias,0.01,0.99)}); })();
    p = normalize(p);
    const acc = (weightCache.accuracies && weightCache.accuracies[name]) || null;
    res.json({ algo: name, prob: { pTai: p.probTai, pXiu: p.probXiu }, backtestAcc: acc });
  } catch (e) {
    res.status(500).json({ error: e && e.message });
  }
});

app.get("/config", (req, res) => res.json({ CONFIG, weightCacheComputedAt: weightCache.computedAt, patternLibComputedAt: patternLibComputedAt }));

app.post("/admin/recompute-weights", (req, res) => {
  computeWeights(fullHistory).then(wc => res.json({ ok: true, computedAt: wc.computedAt, weights: wc.weights })).catch(e => res.status(500).json({ ok: false, error: e && e.message }));
});

// ================ PROCESS SAFETY ================
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err && (err.stack || err));
});
process.on("unhandledRejection", (reason) => {
  console.warn("unhandledRejection:", reason);
});

// ================ START ================
(async () => {
  await loadHistoryFiles();
  // initial compute weights & pattern lib
  computeWeights(fullHistory).catch(()=>{});
  maybeRebuildPatternLib();
  // initial fetch once
  fetchOnceAndSave().catch(()=>{});
  app.listen(PORT, () => console.log(`🚀 Botrumsunwin API VIP PRO running on port ${PORT}`));
})();
