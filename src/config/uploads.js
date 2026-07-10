const path = require('path');
const fs = require('fs');

// Thư mục gốc chứa file người dùng tải lên (avatar, tài liệu, đính kèm, chat...).
// Trên Hostinger PHẢI đặt UPLOADS_DIR trong .env trỏ ra NGOÀI git repo
// (vd ~/domains/<site>/uploads) — vì auto-deploy chạy git clean xóa sạch
// mọi file untracked bên trong repo, làm mất toàn bộ file đã upload
// sau mỗi lần deploy (cùng bản chất với vụ .env bị xóa trước đây).
// Dev local không set biến này → dùng public/uploads như cũ.
const UPLOADS_BASE = process.env.UPLOADS_DIR || path.join(__dirname, '../../public/uploads');

// Trả về đường dẫn thư mục con (tự tạo nếu chưa có) — dùng làm multer destination
function uploadDir(sub) {
  const dir = path.join(UPLOADS_BASE, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Đổi URL công khai (/uploads/xxx/yyy) thành đường dẫn file thật trên đĩa
function uploadPathFromUrl(fileUrl) {
  const rel = String(fileUrl || '').replace(/^\/uploads\//, '');
  return path.join(UPLOADS_BASE, rel);
}

module.exports = { UPLOADS_BASE, uploadDir, uploadPathFromUrl };
