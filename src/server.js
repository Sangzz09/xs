// MINHSANG SUNWIN HYBRIDPLUS v18.3
// Full API by @minhsangdangcap
// Tự động phân tích pattern, cầu, thống kê, reset, và dự đoán thông minh

const express = require("express");
const fs = require("fs-extra");
const app = express();
app.use(express.json());

const DATA_FILE = "data.json";
const STATS_FILE = "stats.json";

let history = [];
let stats = { total: 0, correct: 0, wrong: 0, resetCount: 0 };

// ====== Load dữ liệu khi khởi động ======
if (fs.existsSync(DATA_FILE)) history = fs.readJSONSync(DATA_FILE, { throws: false }) || [];
if (fs.existsSync(STATS_FILE)) stats = fs.readJSONSync(STATS_FILE, { throws: false }) || stats;

// ====== Helper: lưu file ======
const saveAll = async () => {
  await fs.writeJSON(DATA_FILE, history, { spaces: 2 });
  await fs.writeJSON(STATS_FILE, stats, { spaces: 2 });
};

// ====== Phân loại cầu ======
function detectCau(pattern) {
  if (/^(T{3,}|X{3,})$/.test(pattern)) return "Cầu bệt";
  if (/^(TX){3,}$/.test(pattern) || /^(XT){3,}$/.test(pattern)) return "Cầu đảo";
  if (/^(TTX|XXT){2,}$/.test(pattern)) return "Cầu 3-2";
  return "Cầu ngẫu nhiên";
}

// ====== AI dự đoán thông minh ======
function alDuDoanThongMinh(lastResults) {
  if (!lastResults.length) return "Tài";
  const last = lastResults[lastResults.length - 1];
  const tong = last.tong;
  let alGuess = tong >= 11 ? "Tài" : "Xỉu";

  // phân tích sâu hơn xúc xắc
  const highDice = last.xuc_xac.filter(n => n >= 5).length;
  if (highDice >= 2) alGuess = "Tài";
  if (highDice === 0) alGuess = "Xỉu";

  // kết hợp với kết quả gần nhất
  const recent = lastResults.slice(-3).map(v => v.ketqua);
  const taiCount = recent.filter(v => v === "Tài").length;
  const xiuCount = recent.filter(v => v === "Xỉu").length;
  if (taiCount > xiuCount) alGuess = "Tài";
  if (xiuCount > taiCount) alGuess = "Xỉu";

  return alGuess;
}

// ====== Reset pattern khi sai nhiều ======
function checkResetCondition() {
  const accuracy = stats.correct / (stats.total || 1);
  if (stats.total >= 5 && (accuracy < 0.55 || checkLastThreeWrong())) {
    history = history.slice(-5);
    stats.resetCount++;
  }
}

function checkLastThreeWrong() {
  const last3 = history.slice(-3);
  return last3.length === 3 && last3.every(v => v.isCorrect === false);
}

// ====== POST /sunwinapi ======
app.post("/sunwinapi", async (req, res) => {
  try {
    const { phien, ketqua, xuc_xac } = req.body;
    if (!phien || !ketqua || !xuc_xac || !Array.isArray(xuc_xac))
      return res.status(400).json({ error: "Thiếu dữ liệu đầu vào" });

    const tong = xuc_xac.reduce((a, b) => a + b, 0);

    // Tạo pattern chuỗi kết quả gần nhất
    const pattern = history.slice(-30).map(i => i.ketqua[0]).join("");

    // Dự đoán
    let duDoan;
    let loaiCau = detectCau(pattern);
    if (history.length < 6) duDoan = alDuDoanThongMinh(history);
    else {
      const last = pattern.slice(-5);
      duDoan = last.includes("TTT") ? "Xỉu" : last.includes("XXX") ? "Tài" : alDuDoanThongMinh(history);
    }

    // Đánh giá đúng sai
    const isCorrect = duDoan === ketqua;
    if (isCorrect) stats.correct++; else stats.wrong++;
    stats.total++;

    // Reset nếu cần
    checkResetCondition();

    // Lưu lại
    const record = {
      phien,
      ketqua,
      xuc_xac,
      tong,
      du_doan: duDoan,
      pattern: pattern.slice(-30),
      thuat_toan: "Hybrid AI v18.3",
      loai_cau: loaiCau,
      isCorrect,
      Dev: "@minhsangdangcap"
    };

    history.push(record);
    await saveAll();

    res.json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi xử lý dữ liệu" });
  }
});

// ====== GET /stats ======
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

// ====== GET / ======
app.get("/", (req, res) => {
  res.json({
    message: "MINHSANG SUNWIN HYBRIDPLUS v18.3",
    api: ["/sunwinapi (POST)", "/stats (GET)"],
    Dev: "@minhsangdangcap"
  });
});

// ====== RUN SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
