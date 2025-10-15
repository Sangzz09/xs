// HYBRIDPLUS v25.4 - FULL Hybrid AI (Stable + StatSync)
// Author: @minhsangdangcap (adapted)
// Run: Node 16+
// Dependencies: express, axios, chalk
//
// Features:
// - Hybrid ensemble predictor (pattern + trend + dice + momentum + memory)
// - Snapshot per prediction for proper offline tuning
// - Safe file writes and debounce
// - Pending prediction map to avoid mis-sync between predictPhien and actual
// - Auto-nudge and simpleTune using snapshots
// - No node-fetch (uses axios)
// - Endpoints for diagnostics, weights, history, stats
// --------------------------------------------------------

const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const chalk = require('chalk');

const app = express();
app.use(express.json());

/* ---------------- Config ---------------- */
const PORT = process.env.PORT || 3000;
const API_HISTORY = process.env.API_HISTORY || 'https://hackvn.xyz/apisun.php';
const DATA_FILE = path.join(__dirname, 'data.json');
const STATS_FILE = path.join(__dirname, 'stats.json');
const FETCH_INTERVAL_MS = Number(process.env.FETCH_INTERVAL_MS) || 8000;
const MAX_HISTORY = Number(process.env.MAX_HISTORY) || 800;

const ABSTAIN_MODE = process.env.ABSTAIN_MODE === 'true';
const ABSTAIN_THRESHOLD = Number(process.env.ABSTAIN_THRESHOLD) || 0.58;
const TUNE_WINDOW = Number(process.env.TUNE_WINDOW) || 20;
const TUNE_STEP = Number(process.env.TUNE_STEP) || 0.05;

const MIN_WEIGHT = 0.05;
const SAFE_SAVE_TMP = true;

/* ---------------- State ---------------- */
let data = {
  history: [], // newest-first
  pendingPredictions: {}, // map predictPhien -> predictObj
  lastPredict: null,
  lastPhienSeen: 0,
  streakLose: 0,
  streakWin: 0,
  weights: { pattern: 0.28, trend: 0.22, dice: 0.18, momentum: 0.16, memory: 0.16 },
  prediction_history: [] // entries with snapshot + actual when available
};

let stats = { tong: 0, dung: 0, sai: 0, reset: 0 };

/* ---------------- Safe IO ---------------- */
function safeWrite(file, obj) {
  const tmp = file + '.tmp';
  const str = JSON.stringify(obj, null, 2);
  try {
    if (SAFE_SAVE_TMP) {
      fs.writeFileSync(tmp, str, 'utf8');
      fs.renameSync(tmp, file);
    } else {
      fs.writeFileSync(file, str, 'utf8');
    }
  } catch (e) {
    console.error('safeWrite err', e.message);
  }
}

function loadAll() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      Object.assign(data, raw);
      if (!data.weights) data.weights = { pattern: 0.28, trend: 0.22, dice: 0.18, momentum: 0.16, memory: 0.16 };
      if (!Array.isArray(data.prediction_history)) data.prediction_history = [];
      if (!data.pendingPredictions) data.pendingPredictions = {};
    }
    if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (e) {
    console.error('loadAll err', e.message);
  }
}

let savePending = false;
let saveTimer = null;
function saveAllDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    safeWrite(DATA_FILE, data);
    safeWrite(STATS_FILE, stats);
    saveTimer = null;
  }, 600);
}
function saveAllImmediate() {
  safeWrite(DATA_FILE, data);
  safeWrite(STATS_FILE, stats);
}

loadAll();

/* ---------------- Helpers & Predictor ---------------- */
function safeInt(v) { const n = parseInt(v); return Number.isFinite(n) ? n : 0; }
function now() { return Date.now(); }

function seqTX(history, n = 30) {
  return history.slice(0, n).reverse().map(h => (h.ket_qua === 'Tài' || h.ket_qua === 'T' ? 'T' : 'X')).join('');
}
function getTrend(history, n = 6) {
  const arr = history.slice(0, n).map(h => h.tong_xuc_xac || 0);
  if (arr.length < 2) return 0;
  let up = 0, down = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[i - 1]) up++; else if (arr[i] < arr[i - 1]) down++;
  }
  return (up - down) / n;
}
function analyzePattern(seq) {
  if (!seq || seq.length < 6) return { score: 0, type: 'none' };
  const L = seq.length, last = seq[L - 1];
  let run = 1;
  for (let i = L - 2; i >= 0 && seq[i] === last; i--) run++;
  const alt = [...seq].filter((_, i) => i && seq[i] !== seq[i - 1]).length / (L - 1);
  const net = [...seq].reduce((a, c) => a + (c === 'T' ? 1 : -1), 0) / L;
  const s = (Math.tanh((run - 2) / 3) + net * 0.55 - alt * 0.25) * (last === 'T' ? 1 : -1);
  let type = 'Không rõ';
  if (run >= 4) type = 'Bệt';
  else if (alt > 0.6) type = 'Đảo liên tục';
  else if (alt < 0.3) type = 'Ổn định';
  return { score: s, type };
}
function diceBias(last) {
  if (!last || !Array.isArray(last.xuc_xac)) return 0;
  const arr = last.xuc_xac;
  const high = arr.filter(x => x >= 5).length;
  const low = arr.filter(x => x <= 2).length;
  if (high >= 2) return 0.7;
  if (low >= 2) return -0.7;
  // also bias by total
  const tot = (arr[0] || 0) + (arr[1] || 0) + (arr[2] || 0);
  if (tot >= 12) return 0.3;
  if (tot <= 9) return -0.3;
  return 0;
}
function momentum(history) {
  const h = history.slice(0, 10);
  if (!h.length) return 0;
  const tai = h.filter(r => r.ket_qua === 'Tài' || r.ket_qua === 'T').length;
  const xiu = h.length - tai;
  return (tai - xiu) / (h.length || 1);
}
function memoryPattern(history) {
  if (history.length < 20) return 0;
  const last10 = seqTX(history, 10);
  for (let i = 15; i < 50 && i + 10 < history.length; i++) {
    const past10 = seqTX(history.slice(i), 10);
    if (past10 === last10) return 0.65 * (last10.endsWith('T') ? 1 : -1);
  }
  return 0;
}

function normalizeWeights(w) {
  const keys = Object.keys(w);
  keys.forEach(k => w[k] = Math.max(MIN_WEIGHT, Math.min(0.9, Number(w[k]) || MIN_WEIGHT)));
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  keys.forEach(k => w[k] = w[k] / sum);
  return w;
}

function hybridEnsemblePredict(history, weights) {
  const seq = seqTX(history, 30);
  const pat = analyzePattern(seq);
  const t = getTrend(history, 6);
  const dice = diceBias(history[0]);
  const mom = momentum(history);
  const mem = memoryPattern(history);
  const w = normalizeWeights(Object.assign({}, weights || data.weights));
  // stronger weighting on pattern + momentum + dice for hybrid
  let raw = pat.score * w.pattern + t * w.trend + dice * w.dice + mom * w.momentum + mem * w.memory;
  // adjust by average dice total shift
  const avg = history.slice(0, 8).reduce((a, b) => a + (b.tong_xuc_xac || 0), 0) / (Math.min(8, history.length) || 1);
  raw += (avg - 10.5) * 0.04;
  const du_doan = raw >= 0 ? 'Tài' : 'Xỉu';
  const confidence = Math.min(0.97, 0.55 + Math.abs(raw) * 0.45 + Math.min(0.15, Math.abs(pat.score) * 0.15));
  return { du_doan, confidence, patternSeq: seq, patternType: pat.type, raw, components: { pat: pat.score, trend: t, dice, mom, mem } };
}

/* ---------------- Fetch API (robust) ---------------- */
async function fetchFromApi() {
  try {
    const res = await axios.get(API_HISTORY, { timeout: 8000 });
    let raw = Array.isArray(res.data) ? res.data[0] : res.data;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { /* pass */ }
    }
    const phien = safeInt(raw.phien || raw.id || raw.session || raw.PHIEN);
    const tong = safeInt(raw.tong || raw.total || raw.tong_xuc_xac || raw.Tong);
    const ket_qua = (raw.ket_qua || raw.ketqua || (tong >= 11 ? 'Tài' : 'Xỉu')) .toString();
    const xuc_xac = [safeInt(raw.xuc_xac_1), safeInt(raw.xuc_xac_2), safeInt(raw.xuc_xac_3)].filter(n => n > 0);
    if (!phien) return null;
    return { phien, ket_qua, tong_xuc_xac: tong, xuc_xac };
  } catch (e) {
    return null;
  }
}

/* ---------------- Tuning helpers ---------------- */
function recentLabeled(windowSize = TUNE_WINDOW) {
  return data.prediction_history.filter(p => typeof p.correct === 'boolean').slice(-windowSize);
}

function computeAccuracy(records) {
  if (!records || records.length === 0) return null;
  const valid = records.filter(r => typeof r.correct === 'boolean');
  if (valid.length === 0) return null;
  return valid.filter(r => r.correct).length / valid.length;
}

function simpleTune() {
  const labeled = recentLabeled(TUNE_WINDOW);
  if (labeled.length < Math.max(8, Math.floor(TUNE_WINDOW / 2))) return;
  const baseAcc = computeAccuracy(labeled);
  if (baseAcc === null) return;
  const keys = Object.keys(data.weights);
  for (const k of keys) {
    for (const dir of [1, -1]) {
      const trial = Object.assign({}, data.weights);
      trial[k] = Math.max(MIN_WEIGHT, Math.min(0.9, trial[k] * (1 + dir * TUNE_STEP)));
      normalizeWeights(trial);
      let tot = 0, correct = 0;
      for (const rec of labeled) {
        if (!rec.snapshot) continue;
        const h = rec.snapshot;
        const out = hybridEnsemblePredict(h, trial);
        tot++;
        if (out.du_doan === rec.actual) correct++;
      }
      if (tot === 0) continue;
      const acc = correct / tot;
      if (acc > baseAcc + 0.015) {
        data.weights = normalizeWeights(trial);
        console.log(chalk.green(`🔧 simpleTune: improved ${k} ${dir>0?'+':'-'} -> acc ${Math.round(acc*100)}% (base ${Math.round(baseAcc*100)}%)`));
        saveAllDebounced();
        return;
      }
    }
  }
}

/* ---------------- Process incoming item (sync-safe) ---------------- */
let failCount = 0;
let lastResetAt = 0;

async function processIncoming(item) {
  const lastPhien = data.history[0]?.phien || 0;
  if (lastPhien && item.phien <= lastPhien) {
    console.log(chalk.gray(`Ignored phien ${item.phien} (<= last ${lastPhien})`));
    return;
  }

  data.history.unshift(item);
  if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
  if (item.phien > (data.lastPhienSeen || 0)) data.lastPhienSeen = item.phien;

  // finalize pending prediction for this phien if exists
  const target = data.pendingPredictions[item.phien];
  if (target) {
    const predRec = target;
    const correct = predRec.du_doan === item.ket_qua;
    if (!predRec.abstain) {
      stats.tong = (stats.tong || 0) + 1;
      if (correct) { stats.dung = (stats.dung || 0) + 1; data.streakWin = (data.streakWin || 0) + 1; data.streakLose = 0; }
      else { stats.sai = (stats.sai || 0) + 1; data.streakLose = (data.streakLose || 0) + 1; data.streakWin = 0; }
    }
    const entry = data.prediction_history.find(p => p.predictPhien === predRec.predictPhien && typeof p.actualPhien === 'undefined');
    if (entry) {
      entry.actualPhien = item.phien;
      entry.actual = item.ket_qua;
      entry.correct = correct;
      entry.tsActual = now();
    }
    console.log(chalk.green(`✅ Finalized ${predRec.predictPhien}: predicted ${predRec.du_doan} (${Math.round(predRec.confidence*100)}%) -> actual ${item.ket_qua} => ${correct ? 'CORRECT' : 'WRONG'}`));
    delete data.pendingPredictions[item.phien];
    data.lastPredict = (() => {
      const keys = Object.keys(data.pendingPredictions).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
      if (!keys.length) return null;
      const max = Math.max(...keys);
      return data.pendingPredictions[max];
    })();

    // tuning
    const labeled = recentLabeled(TUNE_WINDOW);
    if (labeled.length >= 8) {
      const acc = computeAccuracy(labeled);
      if (acc < 0.55) {
        // random nudge
        const keys = Object.keys(data.weights);
        const k = keys[Math.floor(Math.random() * keys.length)];
        const old = data.weights[k];
        const neww = Math.max(MIN_WEIGHT, Math.min(0.9, old * (1 - (Math.random() * 0.12))));
        data.weights[k] = neww;
        normalizeWeights(data.weights);
        console.log(chalk.yellow(`⚙️ Auto-nudge ${k} -> ${data.weights[k].toFixed(3)} (acc ${Math.round(acc*100)}%)`));
        saveAllDebounced();
      } else {
        simpleTune();
      }
    }
  } else {
    console.log(chalk.gray(`No pending predict for phien ${item.phien}.`));
    // expire older pending predictions < item.phien
    const expired = Object.keys(data.pendingPredictions).map(k => parseInt(k, 10)).filter(n => !isNaN(n) && n < item.phien);
    if (expired.length) {
      expired.sort((a, b) => a - b);
      for (const ph of expired) {
        const rec = data.pendingPredictions[ph];
        const histEntry = data.prediction_history.find(p => p.predictPhien === ph && typeof p.actualPhien === 'undefined');
        if (histEntry) {
          histEntry.actualPhien = null;
          histEntry.actual = null;
          histEntry.correct = null;
          histEntry.tsActual = now();
        }
        console.log(chalk.yellow(`⏳ Pending predict ${ph} expired -> marked unknown.`));
        delete data.pendingPredictions[ph];
      }
      data.lastPredict = null;
      saveAllDebounced();
    }
  }

  // shrink pattern on loss streak (rate-limited)
  if ((data.streakLose || 0) >= 3) {
    const nowTs = now();
    if (nowTs - lastResetAt > 10 * 60 * 1000) {
      const recent = data.prediction_history.slice(-6).filter(p => typeof p.correct === 'boolean');
      const recentAcc = computeAccuracy(recent) || 0;
      if (recentAcc < 0.5) {
        console.log(chalk.yellow('♻ Shrink pattern to 5 entries due to losses'));
        data.history = data.history.slice(0, 5);
        data.streakLose = 0;
        stats.reset = (stats.reset || 0) + 1;
        data.pendingPredictions = {};
        data.lastPredict = null;
        lastResetAt = nowTs;
        saveAllDebounced();
        return;
      }
    }
  }

  // create prediction for nextPhien
  const nextPhien = item.phien + 1;
  if (!data.pendingPredictions[nextPhien]) {
    const snapshot = JSON.parse(JSON.stringify(data.history.slice(0, 100)));
    const ai = hybridEnsemblePredict(data.history, data.weights);
    const abstain = ABSTAIN_MODE && ai.confidence < ABSTAIN_THRESHOLD;
    const predictObj = {
      predictPhien: nextPhien,
      du_doan: abstain ? 'Không chắc' : ai.du_doan,
      confidence: ai.confidence,
      abstain: !!abstain,
      patternSeq: ai.patternSeq,
      patternType: ai.patternType,
      raw: ai.raw,
      components: ai.components,
      last_phien: item.phien,
      last_ket_qua: item.ket_qua,
      tong: item.tong_xuc_xac,
      xuc_xac: item.xuc_xac,
      createdAt: now()
    };
    data.pendingPredictions[nextPhien] = predictObj;
    data.lastPredict = predictObj;
    data.prediction_history.push({
      predictPhien: predictObj.predictPhien,
      du_doan: predictObj.du_doan,
      confidence: predictObj.confidence,
      abstain: predictObj.abstain,
      snapshot: snapshot,
      createdAt: predictObj.createdAt
    });
    if (!abstain) stats.tong = (stats.tong || 0) + 1;
    saveAllDebounced();
    console.log(chalk.cyan(`🔮 Predicted Phien ${nextPhien}: ${predictObj.du_doan} (${Math.round(predictObj.confidence*100)}%) ${predictObj.abstain ? '(ABSTAIN)' : ''}`));
  } else {
    // refresh metadata
    const exist = data.pendingPredictions[nextPhien];
    exist.last_phien = item.phien;
    exist.last_ket_qua = item.ket_qua;
    exist.tong = item.tong_xuc_xac;
    exist.xuc_xac = item.xuc_xac;
    saveAllDebounced();
  }
}

/* ---------------- Main import loop ---------------- */
async function importAndPredict() {
  const item = await fetchFromApi();
  if (!item) {
    failCount++;
    if (failCount < 6) return;
    if (failCount % 6 === 0) console.warn(chalk.red('⛔ Repeated fetch failures — check API source'));
    return;
  }
  failCount = 0;
  await processIncoming(item);
}

setInterval(importAndPredict, FETCH_INTERVAL_MS);
importAndPredict();

/* ---------------- HTTP Endpoints ---------------- */
app.get('/sunwinapi', (req, res) => {
  const p = data.lastPredict || (() => {
    const keys = Object.keys(data.pendingPredictions).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
    if (!keys.length) return null;
    const max = Math.max(...keys);
    return data.pendingPredictions[max];
  })();
  if (!p) return res.json({ message: 'Chưa có dữ liệu' });
  res.json({
    Phien: p.last_phien || null,
    Ket_qua: p.last_ket_qua || null,
    Tong: p.tong || null,
    Xuc_xac: p.xuc_xac || [],
    Du_doan: p.du_doan,
    Confidence: `${Math.round(p.confidence * 100)}%`,
    Pattern: p.patternSeq,
    Loai_cau: p.patternType,
    Thuat_toan: 'HYBRID+ DEEP_ENSEMBLE_V25.4',
    So_lan_du_doan: stats.tong || 0,
    So_dung: stats.dung || 0,
    So_sai: stats.sai || 0,
    Dev: '@minhsangdangcap'
  });
});

app.get('/stats', (req, res) => res.json(stats));
app.get('/weights', (req, res) => res.json(data.weights));

app.post('/setweights', (req, res) => {
  const w = req.body;
  if (!w || typeof w !== 'object') return res.status(400).json({ error: 'send JSON weights' });
  data.weights = normalizeWeights(Object.assign({}, data.weights, w));
  saveAllDebounced();
  res.json({ ok: true, weights: data.weights });
});

app.get('/predhistory', (req, res) => {
  const out = data.prediction_history.slice(-200).map(p => ({
    predictPhien: p.predictPhien,
    du_doan: p.du_doan,
    confidence: p.confidence,
    abstain: p.abstain,
    actualPhien: p.actualPhien,
    actual: p.actual,
    correct: p.correct,
    createdAt: p.createdAt,
    tsActual: p.tsActual
  }));
  res.json(out);
});

app.get('/history', (req, res) => res.json(data.history));

app.post('/tune', (req, res) => {
  const body = req.body || {};
  if (body.action === 'nudge' && body.key && data.weights[body.key] !== undefined) {
    data.weights[body.key] = Math.max(MIN_WEIGHT, Math.min(0.9, data.weights[body.key] * (body.factor || 0.9)));
    normalizeWeights(data.weights);
    saveAllDebounced();
    return res.json({ ok: true, weights: data.weights });
  }
  return res.status(400).json({ error: 'invalid' });
});

app.get('/diagnostics', (req, res) => {
  const labeled = data.prediction_history.filter(p => typeof p.correct === 'boolean');
  const acc = computeAccuracy(labeled) || 0;
  res.json({
    weights: data.weights,
    lastPredict: data.lastPredict,
    pendingCount: Object.keys(data.pendingPredictions).length,
    rolling_accuracy: Math.round(acc * 10000) / 100,
    labeled_count: labeled.length,
    failCount,
    streakWin: data.streakWin,
    streakLose: data.streakLose,
    lastPhienSeen: data.lastPhienSeen
  });
});

app.get('/resetpattern', (req, res) => {
  data.history = data.history.slice(0, 5);
  data.streakLose = 0; data.streakWin = 0;
  data.pendingPredictions = {};
  stats.reset = (stats.reset || 0) + 1;
  saveAllDebounced();
  res.json({ ok: true, message: 'reset pattern (stats giữ)' });
});

app.get('/resetall', (req, res) => {
  data = { history: [], pendingPredictions: {}, lastPredict: null, lastPhienSeen: 0, streakLose: 0, streakWin: 0, weights: { pattern: 0.28, trend: 0.22, dice: 0.18, momentum: 0.16, memory: 0.16 }, prediction_history: [] };
  stats = { tong: 0, dung: 0, sai: 0, reset: 0 };
  saveAllImmediate();
  res.json({ ok: true, message: 'reset all' });
});

/* ---------------- Start Server ---------------- */
app.listen(PORT, () => console.log(chalk.green(`🚀 HYBRIDPLUS v25.4 running at http://0.0.0.0:${PORT}`)));
