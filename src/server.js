// server.js
// Project: botrumsunwinapi v5.0 (Tiếng Việt + loại cầu + auto reset)
// Endpoint: /sunwinapi
// Author: @minhsangdangcap

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SOURCE_API = "https://hackvn.xyz/apisun.php";
const DATA_FILE = path.join(__dirname, "data.json");

// ================== BIẾN LƯU TRẠNG THÁI ==================
let lichSu = []; // mỗi phần tử: { phien, ket_qua, du_doan, thuat_toan, loai_cau, dung_sai, xuc_xac, tong }
let soLanDung = 0;
let soLanSai = 0;
let demPhien = 0;
const NGUONG_RESET = 15;
const GIU_LAI = 5;

// ================== HÀM HỖ TRỢ ==================
function layCuoi(arr, n) {
  return arr.slice(-n);
}

async function luuTrangThai() {
  const duLieu = {
    lichSu,
    soLanDung,
    soLanSai,
    demPhien,
  };
  await fs.writeFile(DATA_FILE, JSON.stringify(duLieu, null, 2), "utf8");
}

async function taiTrangThai() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    lichSu = data.lichSu || [];
    soLanDung = data.soLanDung || 0;
    soLanSai = data.soLanSai || 0;
    demPhien = data.demPhien || 0;
    console.log("🟢 Đã tải dữ liệu từ data.json");
  } catch {
    console.log("ℹ️ Bắt đầu mới, chưa có file data.json");
  }
}

// ================== CÁC LOẠI CẦU / THUẬT TOÁN ==================
function duDoanCau(lichSu) {
  const n = lichSu.length;
  const ketQua = lichSu.map((h) => h.ket_qua);
  const cuoi3 = layCuoi(ketQua, 3);
  const cuoi4 = layCuoi(ketQua, 4);
  const cuoi5 = layCuoi(ketQua, 5);
  const cuoi6 = layCuoi(ketQua, 6);
  const cuoi10 = layCuoi(ketQua, 10);
  const cuoi15 = layCuoi(ketQua, 15);

  // 🧩 1. Cầu bệt >=5
  if (cuoi5.length === 5 && cuoi5.every((r) => r === cuoi5[0])) {
    return {
      du_doan: cuoi5[0] === "Tài" ? "Xỉu" : "Tài",
      thuat_toan: "Đảo sau bệt 5",
      loai_cau: "Cầu bệt",
    };
  }

  // 🌀 2. Cầu xen kẽ
  if (cuoi4.length === 4 && cuoi4.every((v, i, arr) => i === 0 || v !== arr[i - 1])) {
    return {
      du_doan: cuoi4[3] === "Tài" ? "Xỉu" : "Tài",
      thuat_toan: "Đảo sau xen kẽ",
      loai_cau: "Cầu xen kẽ",
    };
  }

  // ⚖️ 3. Cầu cân bằng 10
  const tai10 = cuoi10.filter((r) => r === "Tài").length;
  if (tai10 >= 8)
    return { du_doan: "Xỉu", thuat_toan: "Cân bằng 10", loai_cau: "Cầu cân bằng" };
  if (cuoi10.length - tai10 >= 8)
    return { du_doan: "Tài", thuat_toan: "Cân bằng 10", loai_cau: "Cầu cân bằng" };

  // 📈 4. Cầu trend 3/4
  const tai4 = cuoi4.filter((r) => r === "Tài").length;
  if (tai4 >= 3)
    return { du_doan: "Tài", thuat_toan: "Trend 3/4", loai_cau: "Cầu xu hướng" };
  if (tai4 <= 1)
    return { du_doan: "Xỉu", thuat_toan: "Trend 3/4", loai_cau: "Cầu xu hướng" };

  // 🔁 5. Cặp đôi TTXX
  if (
    cuoi4.length === 4 &&
    cuoi4[0] === cuoi4[1] &&
    cuoi4[2] === cuoi4[3] &&
    cuoi4[0] !== cuoi4[2]
  ) {
    return { du_doan: cuoi4[2], thuat_toan: "Cặp đôi TT|XX", loai_cau: "Cầu cặp đôi" };
  }

  // 🔄 6. Đảo sau 3 cùng
  if (cuoi3.length === 3 && cuoi3.every((r) => r === cuoi3[0])) {
    return {
      du_doan: cuoi3[0] === "Tài" ? "Xỉu" : "Tài",
      thuat_toan: "Đảo sau 3 cùng",
      loai_cau: "Cầu đảo",
    };
  }

  // 🔂 7. Chu kỳ 6
  if (cuoi6.length === 6) {
    const dau3 = cuoi6.slice(0, 3).join("");
    const sau3 = cuoi6.slice(3).join("");
    if (dau3 === sau3) {
      return {
        du_doan: cuoi6[0],
        thuat_toan: "Chu kỳ 6",
        loai_cau: "Cầu chu kỳ",
      };
    }
  }

  // 🧮 8. Markov cơ bản
  if (n >= 10) {
    let taiToXiu = 0,
      taiToTai = 0,
      xiuToTai = 0,
      xiuToXiu = 0;
    for (let i = 1; i < n; i++) {
      const prev = ketQua[i - 1];
      const curr = ketQua[i];
      if (prev === "Tài") curr === "Xỉu" ? taiToXiu++ : taiToTai++;
      else curr === "Tài" ? xiuToTai++ : xiuToXiu++;
    }
    const last = ketQua[n - 1];
    if (last === "Tài")
      return {
        du_doan: taiToXiu > taiToTai ? "Xỉu" : "Tài",
        thuat_toan: "Markov (Tài→?)",
        loai_cau: "Cầu xác suất",
      };
    else
      return {
        du_doan: xiuToTai > xiuToXiu ? "Tài" : "Xỉu",
        thuat_toan: "Markov (Xỉu→?)",
        loai_cau: "Cầu xác suất",
      };
  }

  // 📊 9. Lệch chuẩn 15
  if (cuoi15.length === 15) {
    const tai15 = cuoi15.filter((r) => r === "Tài").length;
    const lech = tai15 / 15;
    if (lech >= 0.75)
      return {
        du_doan: "Xỉu",
        thuat_toan: "Lệch chuẩn 15 (Tài nhiều)",
        loai_cau: "Cầu lệch chuẩn",
      };
    if (lech <= 0.25)
      return {
        du_doan: "Tài",
        thuat_toan: "Lệch chuẩn 15 (Xỉu nhiều)",
        loai_cau: "Cầu lệch chuẩn",
      };
  }

  // ⚙️ 10. Dự đoán mặc định
  const tai5 = cuoi5.filter((r) => r === "Tài").length;
  return {
    du_doan: tai5 >= 3 ? "Tài" : "Xỉu",
    thuat_toan: "Đa số 5",
    loai_cau: "Cầu thống kê",
  };
}

// ================== API CHÍNH ==================
app.get("/sunwinapi", async (req, res) => {
  try {
    const resAPI = await axios.get(SOURCE_API);
    const data = resAPI.data;

    const phien = parseInt(data.phien);
    const x1 = parseInt(data.xuc_xac_1);
    const x2 = parseInt(data.xuc_xac_2);
    const x3 = parseInt(data.xuc_xac_3);
    const tong = x1 + x2 + x3;
    const ket_qua = data.ket_qua.trim() === "Tài" ? "Tài" : "Xỉu";

    if (isNaN(phien) || isNaN(tong)) throw new Error("Dữ liệu lỗi!");

    // Kiểm tra đúng/sai so với dự đoán trước
    if (lichSu.length > 0) {
      const truoc = lichSu[lichSu.length - 1];
      if (truoc.du_doan && truoc.dung_sai === null) {
        truoc.dung_sai = truoc.du_doan === ket_qua ? "Đúng" : "Sai";
        if (truoc.dung_sai === "Đúng") soLanDung++;
        else soLanSai++;
      }
    }

    // Tạo dự đoán mới
    const duDoan = duDoanCau(lichSu);

    // Cập nhật lịch sử
    if (lichSu.length === 0 || lichSu[lichSu.length - 1].phien !== phien) {
      lichSu.push({
        phien,
        ket_qua,
        du_doan: duDoan.du_doan,
        thuat_toan: duDoan.thuat_toan,
        loai_cau: duDoan.loai_cau,
        dung_sai: null,
        xuc_xac: [x1, x2, x3],
        tong,
      });

      demPhien++;

      // Reset nếu đạt ngưỡng
      if (demPhien >= NGUONG_RESET) {
        lichSu = layCuoi(lichSu, GIU_LAI);
        demPhien = 0;
        console.log(`♻️ Reset sau ${NGUONG_RESET} phiên, giữ ${GIU_LAI} gần nhất.`);
      }

      await luuTrangThai();
    }

    const pattern = lichSu.map((h) => (h.ket_qua === "Tài" ? "t" : "x")).join("");

    res.json({
      phien,
      ket_qua,
      xuc_xac: [x1, x2, x3],
      tong_xuc_xac: tong,
      du_doan_tiep_theo: duDoan.du_doan,
      loai_cau: duDoan.loai_cau,
      thuat_toan: duDoan.thuat_toan,
      so_lan_dung: soLanDung,
      so_lan_sai: soLanSai,
      pattern,
      tong_lich_su: lichSu.length,
      id: "@minhsangdangcap",
    });
  } catch (err) {
    console.error("❌ Lỗi:", err.message);
    res.status(500).json({ loi: "Lỗi hệ thống hoặc nguồn API" });
  }
});

app.get("/", (req, res) => {
  res.json({ thong_bao: "✅ API Dự đoán SUN.WIN hoạt động", duong_dan: "/sunwinapi" });
});

// ================== KHỞI CHẠY ==================
(async () => {
  await taiTrangThai();
  app.listen(PORT, () => console.log(`🚀 Server chạy trên cổng ${PORT}`));
})();
