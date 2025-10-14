// THUẬT TOÁN TÀI XỈU ĐA TẦNG LINH HOẠT V1
// by @minhsangdangcap (2025)

class ThuatToanTaiXiu {
  constructor() {
    this.patternLength = 30;
  }

  duDoan(ds) {
    if (ds.length < 5) return "Không đủ dữ liệu";

    const ganNhat = ds.slice(-5);
    const pattern = ganNhat.map(i => i.ket_qua).join("-");
    let duDoan = "Tài";
    let tiLe = 50;
    let loaiCau = "random";

    const demTai = ganNhat.filter(i => i.ket_qua === "Tài").length;
    const demXiu = ganNhat.filter(i => i.ket_qua === "Xỉu").length;

    if (demTai > demXiu) {
      duDoan = "Xỉu";
      tiLe = 70;
      loaiCau = "nghịch cầu";
    } else if (demXiu > demTai) {
      duDoan = "Tài";
      tiLe = 70;
      loaiCau = "bệt cầu";
    } else {
      const tong = ganNhat.reduce((a, b) => a + parseInt(b.tong), 0);
      duDoan = tong % 2 === 0 ? "Tài" : "Xỉu";
      loaiCau = "chẵn lẻ xúc xắc";
      tiLe = 60;
    }

    return {
      pattern,
      duDoan,
      tiLe,
      loaiCau,
      thuatToan: "DA_TANG_LINH_HOAT_V1"
    };
  }
}

module.exports = new ThuatToanTaiXiu();
