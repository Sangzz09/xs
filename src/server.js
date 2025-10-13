// MINHSANG SUNWIN HYBRIDPLUS v18.5 FINAL
// By @minhsangdangcap — AI cầu đa yếu tố, học pattern tự động, reset thông minh

const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const app = express();

app.use(express.json());

const DATA_FILE = path.resolve(__dirname, "data.json");
const STATS_FILE = path.resolve(__dirname, "stats.json");

// === KHỞI TẠO ===
let history = [];
let stats = { total: 0, correct: 0, wrong: 0, resetCount: 0 };

// === LOAD DỮ LIỆU ===
if (fs.existsSync(DATA_FILE)) history = fs.readJSONSync(DATA_FILE, { throws: false }) || [];
if (fs.existsSync(STATS_FILE)) stats = fs.readJSONSync(STATS_FILE, { throws: false }) || stats;

// === LƯU FILE ===
async function saveAll() {
  await fs.writeJSON(DATA_FILE, history, { spaces: 2 });
  await fs.writeJSON(STATS_FILE, stats, { spaces: 2 });
}

// === PHÂN TÍCH LOẠI CẦU ===
function detectCau(pattern) {
  if (/^(T{3,}|X{3,})$/.test(pattern)) return "Cầu bệt";
  if (/^(TX){3,}$/.test(pattern) || /^(XT){3,}$/.test(pattern)) return "Cầu đảo";
  if (/^(TTX|XXT){2,}$/.test(pattern)) return "Cầu 3-2";
  if (/^(TTXX|XXTT){2,}$/.test(pattern)) return "Cầu 2-2";
  if (/^(TXTXTX|XTXTXT)/.test(pattern)) return "Cầu xiên (zigzag)";
  return "Cầu ngẫu nhiên";
}

// === AI THÔNG MINH KHI THIẾU DỮ LIỆU ===
function alDuDoanThongMinh(lastResults) {
  if (!lastResults.length) return "Tài";

  const last = lastResults[lastResults.length - 1];
  const tong = last.tong;
  let alGuess = tong >= 11 ? "Tài" : "Xỉu";

  const highDice = last.xuc_xac.filter(n => n >= 5).length;
  if (highDice >= 2) alGuess = "Tài";
  if (highDice === 0) alGuess = "Xỉu";

  const recent = lastResults.slice(-3).map(v => v.ketqua);
  const taiCount = recent.filter(v => v === "Tài").length;
  const xiuCount = recent.filter(v => v === "Xỉu").length;
  if (taiCount > xiuCount) alGuess = "Tài";
  if (xiuCount > taiCount) alGuess = "Xỉu";

  return alGuess;
}

// === KIỂM TRA RESET ===
function checkResetCondition() {
  const accuracy = stats.correct / (stats.total || 1);
  const last3 = history.slice(-3);
  const threeWrong = last3.length === 3 && last3.every(v => v.isCorrect === false);

  if ((stats.total >= 6 && accuracy < 0.55) || threeWrong) {
    history = history.slice(-5);
    stats.resetCount++;
  }
}

// === POST /sunwinapi ===
// Thêm dữ liệu mới, AI tự học & dự đoán
app.post("/sunwinapi", async (req, res) => {
  try {
    const { phien, ketqua, xuc_xac } = req.body;
    if (!phien || !ketqua || !xuc_xac || !Array.isArray(xuc_xac))
      return res.status(400).json({ error: "Thiếu dữ liệu đầu vào" });

    const tong = xuc_xac.reduce((a, b) => a + b, 0);

    // Cập nhật pattern
    let pattern = history.map(i => i.ketqua[0]).join("") + ketqua[0];
    pattern = pattern.slice(-30);

    // Loại cầu
    let loaiCau = detectCau(pattern);

    // Dự đoán
    let duDoan;
    if (history.length < 6) {
      duDoan = alDuDoanThongMinh(history);
    } else {
      const last = pattern.slice(-5);
      if (last.includes("TTT")) duDoan = "Xỉu";
      else if (last.includes("XXX")) duDoan = "Tài";
      else duDoan = alDuDoanThongMinh(history);
    }

    const isCorrect = duDoan === ketqua;
    if (isCorrect) stats.correct++;
    else stats.wrong++;
    stats.total++;

    checkResetCondition();

    const record = {
      phien,
      ketqua,
      xuc_xac,
      tong,
      du_doan: duDoan,
      pattern,
      thuat_toan: "HybridPlus AI v18.5 Final",
      loai_cau: loaiCau,
      isCorrect,
      Dev: "@minhsangdangcap"
    };

    history.push(record);
    await saveAll();

    res.json(record);
  } catch (err) {
    console.error("❌ Lỗi xử lý:", err);
    res.status(500).json({ error: "Lỗi xử lý dữ liệu" });
  }
});

// === GET /sunwinapi (xem dự đoán mới nhất) ===
app.get("/sunwinapi", (req, res) => {
  if (!history.length) return res.json({ message: "Chưa có dữ liệu" });
  const last = history[history.length - 1];
  res.json(last);
});

// === GET /pattern (xem toàn bộ pattern TX) ===
app.get("/pattern", (req, res) => {
  const pattern = history.map(i => i.ketqua[0]).join("").slice(-30);
  res.json({ pattern, length: pattern.length, Dev: "@minhsangdangcap" });
});

// === GET /stats (xem thống kê) ===
app.get("/stats", (req, res) => {
  const accuracy = ((stats.correct / (stats.total || 1)) * 100).toFixed(2);
  res.json({
    tong_phien: stats.total,
    dung: stats.correct,
    sai: stats.wrong,
    tile_dung: `${accuracy}%`,
    so_lan_reset: stats.resetCount,
    Dev: "@minhsangdangcap"
  });
});

// === GET /history (toàn bộ lịch sử) ===
app.get("/history", (req, res) => res.json(history));

// === GET /clear (xoá toàn bộ dữ liệu) ===
app.get("/clear", async (req, res) => {
  history = [];
  stats = { total: 0, correct: 0, wrong: 0, resetCount: 0 };
  await saveAll();
  res.json({ ok: true, Dev: "@minhsangdangcap" });
});

// === CHẠY SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 MINHSANG SUNWIN HYBRIDPLUS v18.5 chạy tại cổng ${PORT}`));
