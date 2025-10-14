// BOTRUMSUNWIN HYBRIDPLUS v22
// by @minhsangdangcap

const express = require("express");
const fs = require("fs");
const axios = require("axios");
const chalk = require("chalk");
const ThuatToanTaiXiu = require("./thuattoan.js");

const app = express();
const PORT = process.env.PORT || 3000;

const API_SOURCE = "https://hackvn.xyz/apisun.php";
const DATA_FILE = "data.json";
const STATS_FILE = "stats.json";

let lastPredict = null;
let stats = { tong: 0, dung: 0, sai: 0, tile: 0, reset: 0 };

if (fs.existsSync(STATS_FILE)) {
  stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
}

async function fetchLatest() {
  try {
    const res = await axios.get(API_SOURCE, { timeout: 5000 });
    const newData = res.data;
    if (!newData || !newData.phien) return;

    let data = fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE))
      : [];

    const isNew = !data.some(d => d.phien === newData.phien);
    if (!isNew) return;

    data.push(newData);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    console.log(chalk.green(`✅ Cập nhật phiên ${newData.phien} (${newData.ket_qua})`));
    xuLyPhien(data, newData);
  } catch (e) {
    console.log(chalk.red("❌ Lỗi lấy API:"), e.message);
  }
}

function xuLyPhien(ds, newData) {
  const dsCo = ds.slice(-30);
  const duDoanAI = ThuatToanTaiXiu.duDoan(dsCo);

  if (lastPredict && lastPredict.phien !== newData.phien) {
    stats.tong++;
    if (lastPredict.duDoan === newData.ket_qua) stats.dung++;
    else stats.sai++;

    stats.tile = Math.round((stats.dung / stats.tong) * 100);
  }

  if (stats.sai >= 3 || stats.tile <= 55) {
    console.log(chalk.yellow("⚠️ Reset pattern do sai nhiều"));
    stats.reset++;
    stats.sai = 0;
    stats.dung = 0;
    stats.tong = 0;
  }

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));

  const jsonResponse = {
    phien: newData.phien,
    ketqua: newData.ket_qua,
    xucxac: [newData.xuc_xac_1, newData.xuc_xac_2, newData.xuc_xac_3],
    tong: newData.tong,
    duDoan: duDoanAI.duDoan,
    pattern: duDoanAI.pattern,
    tile: duDoanAI.tiLe,
    loaiCau: duDoanAI.loaiCau,
    thuatToan: duDoanAI.thuatToan,
    Dev: "@minhsangdangcap"
  };

  lastPredict = jsonResponse;
  console.log(
    chalk.cyan(
      `🔮 Phiên ${jsonResponse.phien}: Dự đoán ${jsonResponse.duDoan} (${jsonResponse.tile}%) | ${jsonResponse.loaiCau}`
    )
  );
}

app.get("/sunwinapi", (req, res) => {
  if (!lastPredict) return res.json({ message: "Chưa có dữ liệu" });
  res.json(lastPredict);
});

app.get("/stats", (req, res) => res.json({ stats, Dev: "@minhsangdangcap" }));

app.get("/api/update", async (req, res) => {
  await fetchLatest();
  res.json({ message: "Đã cập nhật" });
});

setInterval(fetchLatest, 10000);

app.listen(PORT, () =>
  console.log(chalk.cyan(`🚀 BOTRUMSUNWIN HYBRIDPLUS v22 đang chạy tại cổng ${PORT}`))
);
