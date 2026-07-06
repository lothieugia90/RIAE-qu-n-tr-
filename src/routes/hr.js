const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ctrl = require('../controllers/hrController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

const docsDir = path.join(__dirname, '../../public/uploads/documents');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
const docUpload = multer({
  storage: multer.diskStorage({
    destination: docsDir,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Định dạng file không hỗ trợ'), ok);
  }
});

router.get('/', requirePermission('hr', 'view'), ctrl.index);
router.get('/create', requirePermission('hr', 'edit'), ctrl.getCreate);
router.post('/create', requirePermission('hr', 'edit'), ctrl.postCreate);
router.get('/:id', requirePermission('hr', 'view'), ctrl.detail);
router.get('/:id/edit', requirePermission('hr', 'edit'), ctrl.getEdit);
router.post('/:id', requirePermission('hr', 'edit'), ctrl.postEdit);
router.post('/:id/toggle-active', requirePermission('hr', 'full'), ctrl.toggleActive);
router.post('/:id/documents', requirePermission('hr', 'edit'), docUpload.single('file'), ctrl.uploadDocument);
router.post('/:id/documents/:docId/delete', requirePermission('hr', 'edit'), ctrl.deleteDocument);

module.exports = router;
