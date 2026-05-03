const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// API gốc mới
// ==========================
const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=62385f65eb49fcb34c72a7d6489ad91d";

// ==========================
// Cache dữ liệu
// ==========================
let CACHE = {
  phien: "0",
  ket_qua: "đang tải",
  xuc_xac: "0-0-0",
  du_doan: "đang phân tích",
  do_tin_cay: "0%",
  cau_dang_chay: "-",
  loai_cau: "đang phân tích",
};

// ==========================
// Hàm xác định Tài/Xỉu dựa trên tổng điểm
// ==========================
function getTaiXiu(total) {
  return total >= 11 ? "tài" : "xỉu";
}

// ==========================
// Hàm tạo chuỗi cầu từ dữ liệu (dùng để hiển thị)
// ==========================
function buildCau(data, len = 12) {
  return data
    .slice(0, len)
    .map((i) => (i.ket_qua === "tài" ? "t" : "x"))
    .join("");
}

// ==========================
// Hàm phân tích chuỗi cầu (streak)
// ==========================
function getStreak(data) {
  if (!data.length) {
    return { side: "tài", count: 1 };
  }
  const first = data[0].ket_qua;
  let count = 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i].ket_qua === first) {
      count++;
    } else {
      break;
    }
  }
  return { side: first, count };
}

// ==========================
// Hàm thống kê tần suất Tài/Xỉu
// ==========================
function analyzePattern(data) {
  let tai = 0;
  let xiu = 0;
  data.slice(0, 20).forEach((i) => {
    if (i.ket_qua === "tài") {
      tai++;
    } else {
      xiu++;
    }
  });
  return { tai, xiu };
}

// ==========================
// Hàm nhận diện các loại cầu
// ==========================
function detectPatterns(data) {
  const len = data.length;
  if (len < 6) return { type: "không đủ dữ liệu", confidence: 0 };

  // Lấy kết quả dưới dạng mảng các ký tự 't' hoặc 'x'
  const arr = data.slice(0, 20).map((i) => (i.ket_qua === "tài" ? "t" : "x"));

  // --- Cầu bệt (chuỗi liên tiếp) ---
  const streak = getStreak(data);
  if (streak.count >= 5) {
    return { type: `cầu bệt ${streak.side}`, confidence: 80, streak };
  }

  // --- Cầu 1-1 (luân phiên) ---
  let is1_1 = true;
  for (let i = 1; i < 10; i++) {
    if (arr[i] === arr[i - 1]) {
      is1_1 = false;
      break;
    }
  }
  if (is1_1) {
    return { type: "cầu 1-1", confidence: 85 };
  }

  // --- Cầu 2-2 (lặp cặp) ---
  let is2_2 = true;
  for (let i = 0; i < 8; i += 2) {
    if (arr[i] !== arr[i + 1] || (i > 0 && arr[i] === arr[i - 2])) {
      is2_2 = false;
      break;
    }
  }
  if (is2_2) {
    return { type: "cầu 2-2", confidence: 80 };
  }

  // --- Cầu 1-2 (một tài, hai xỉu hoặc ngược lại) ---
  let is1_2 = true;
  let pattern1_2 = [];
  for (let i = 0; i < 9; i += 3) {
    if (arr[i] === arr[i + 1] || arr[i + 1] !== arr[i + 2]) {
      is1_2 = false;
      break;
    }
    pattern1_2.push(arr[i]);
  }
  if (is1_2 && pattern1_2.length >= 3) {
    return { type: "cầu 1-2", confidence: 75 };
  }

  // --- Cầu 3-3 (ba tài, ba xỉu) ---
  let is3_3 = true;
  for (let i = 0; i < 6; i += 3) {
    if (arr[i] !== arr[i + 1] || arr[i + 1] !== arr[i + 2]) {
      is3_3 = false;
      break;
    }
  }
  if (is3_3 && arr[0] !== arr[3]) {
    return { type: "cầu 3-3", confidence: 85 };
  }

  // --- Nếu không phát hiện mẫu cụ thể, dùng thống kê ---
  const stats = analyzePattern(data);
  const dominant = stats.tai > stats.xiu ? "tài" : "xỉu";
  const diff = Math.abs(stats.tai - stats.xiu);
  let conf = 55 + Math.min(diff * 5, 20); // 55-75%
  return { type: `thống kê (nghiêng ${dominant})`, confidence: conf };
}

// ==========================
// Thuật toán dự đoán nâng cao
// ==========================
function predict(data) {
  if (!data.length) {
    return { du_doan: "tài", do_tin_cay: "50%", loai_cau: "không có dữ liệu" };
  }

  const patterns = detectPatterns(data);
  const streak = getStreak(data);
  const stats = analyzePattern(data);
  let du_doan = "tài";
  let confidence = 60;

  // Xử lý dựa trên loại cầu đã phát hiện
  switch (patterns.type) {
    case "cầu bệt tài":
      // Nếu bệt quá dài (>=7), bẻ cầu
      if (streak.count >= 7) {
        du_doan = "xỉu";
        confidence = 90;
      } else {
        du_doan = "tài";
        confidence = 70 + streak.count * 2;
      }
      break;
    case "cầu bệt xỉu":
      if (streak.count >= 7) {
        du_doan = "tài";
        confidence = 90;
      } else {
        du_doan = "xỉu";
        confidence = 70 + streak.count * 2;
      }
      break;
    case "cầu 1-1":
      // Đảo chiều so với phiên cuối
      du_doan = data[0].ket_qua === "tài" ? "xỉu" : "tài";
      confidence = 80;
      break;
    case "cầu 2-2":
      // Tiếp tục xu hướng cặp hiện tại
      du_doan = data[1].ket_qua;
      confidence = 75;
      break;
    case "cầu 1-2":
      // Dự đoán dựa trên mẫu 1-2
      du_doan = data[0].ket_qua === "tài" ? "xỉu" : "tài";
      confidence = 70;
      break;
    case "cầu 3-3":
      // Tiếp tục mẫu 3-3
      du_doan = data[0].ket_qua;
      confidence = 80;
      break;
    default:
      // Dùng thống kê
      if (stats.tai > stats.xiu + 2) {
        du_doan = "tài";
        confidence = 55 + Math.min((stats.tai - stats.xiu) * 3, 20);
      } else if (stats.xiu > stats.tai + 2) {
        du_doan = "xỉu";
        confidence = 55 + Math.min((stats.xiu - stats.tai) * 3, 20);
      } else {
        du_doan = data[0].ket_qua === "tài" ? "xỉu" : "tài"; // đảo chiều
        confidence = 55;
      }
  }

  // Giới hạn độ tin cậy
  if (confidence > 92) confidence = 92;
  if (confidence < 55) confidence = 55;

  return {
    du_doan,
    do_tin_cay: confidence + "%",
    loai_cau: patterns.type,
  };
}

// ==========================
// Hàm lấy dữ liệu từ API gốc và cập nhật cache
// ==========================
async function updateData() {
  try {
    const res = await axios.get(API_URL);
    const json = res.data;

    // API mới trả về { list: [...] }
    let sessions = json.list || [];
    if (!Array.isArray(sessions) || !sessions.length) {
      console.log("Không có dữ liệu từ API");
      return;
    }

    // Sắp xếp giảm dần theo id (mới nhất trước)
    sessions.sort((a, b) => b.id - a.id);
    sessions = sessions.slice(0, 100);

    // Chuẩn hóa dữ liệu
    const parsed = sessions.map((item) => {
      const x1 = item.dices[0] || 1;
      const x2 = item.dices[1] || 1;
      const x3 = item.dices[2] || 1;
      const total = x1 + x2 + x3;
      // resultTruyenThong có thể là "TAI" hoặc "XIU"
      const ket_qua = item.resultTruyenThong === "TAI" ? "tài" : "xỉu";
      return {
        phien: item.id,
        ket_qua,
        xuc_xac: `${x1}-${x2}-${x3}`,
      };
    });

    const newest = parsed[0];
    const prediction = predict(parsed);

    CACHE = {
      phien: newest.phien,
      ket_qua: newest.ket_qua,
      xuc_xac: newest.xuc_xac,
      du_doan: prediction.du_doan,
      do_tin_cay: prediction.do_tin_cay,
      cau_dang_chay: buildCau(parsed),
      loai_cau: prediction.loai_cau,
    };

    console.log("Đã cập nhật:", CACHE);
  } catch (err) {
    console.log("Lỗi API:", err.message);
  }
}

// ==========================
// API endpoint chính
// ==========================
app.get("/", (req, res) => {
  res.json(CACHE);
});

// ==========================
// API endpoint dự đoán
// ==========================
app.get("/predict", (req, res) => {
  res.json({
    status: "success",
    data: CACHE,
  });
});

// ==========================
// Tự động cập nhật mỗi 5 giây
// ==========================
updateData();
setInterval(updateData, 5000);

// ==========================
// Khởi động server
// ==========================
app.listen(PORT, () => {
  console.log(`Server running port ${PORT}`);
});