const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const ctrl = require('../controllers/announcementController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { uploadDir } = require('../config/uploads');

router.use(requireAuth);

const annDir = uploadDir('announcements');
const upload = multer({
  storage: multer.diskStorage({
    destination: annDir,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Định dạng file không hỗ trợ'), ok);
  }
});

router.get('/', requirePermission('announcements', 'view'), ctrl.index);
router.get('/create', requirePermission('announcements', 'full'), ctrl.getCreate);
router.post('/', requirePermission('announcements', 'full'), upload.array('files', 5), ctrl.postCreate);
router.get('/:id', requirePermission('announcements', 'view'), ctrl.detail);
router.get('/:id/edit', requirePermission('announcements', 'full'), ctrl.getEdit);
router.post('/:id', requirePermission('announcements', 'full'), upload.array('files', 5), ctrl.postEdit);
router.post('/:id/delete', requirePermission('announcements', 'full'), ctrl.remove);
router.post('/:id/files/:fileId/delete', requirePermission('announcements', 'full'), ctrl.deleteFile);

module.exports = router;
