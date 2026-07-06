const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

// Giới hạn brute-force: 10 lần thử đăng nhập / 15 phút / IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'Quá nhiều lần thử đăng nhập. Vui lòng đợi 15 phút.');
    res.redirect('/auth/login');
  }
});

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../public/uploads/avatars'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.session.userId}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Chỉ chấp nhận ảnh JPG/PNG/WebP'), ok);
  }
});

router.get('/login', authController.getLogin);
router.post('/login', loginLimiter, authController.postLogin);
router.get('/logout', requireAuth, authController.logout);
router.get('/profile', requireAuth, authController.getProfile);
router.post('/profile', requireAuth, avatarUpload.single('avatar'), authController.updateProfile);
router.post('/change-password', requireAuth, authController.changePassword);
router.post('/signature', requireAuth, authController.saveSignature);

module.exports = router;
