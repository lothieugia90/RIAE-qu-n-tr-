const multer = require('multer');
const path = require('path');
const fs = require('fs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const storage = (subfolder) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads', subfolder);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  }
});

const fileFilter = (allowed) => (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Định dạng file không hỗ trợ: ' + ext));
};

const avatarUpload = multer({
  storage: storage('avatars'),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: fileFilter(['.jpg', '.jpeg', '.png', '.webp'])
});

const documentUpload = multer({
  storage: storage('documents'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter(['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'])
});

const anyUpload = multer({
  storage: storage('files'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const announcementUpload = multer({
  storage: storage('announcements'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: fileFilter(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'])
});

module.exports = { avatarUpload, documentUpload, anyUpload, announcementUpload };
