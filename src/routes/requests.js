const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ctrl = require('../controllers/requestController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

const reqDir = path.join(__dirname, '../../public/uploads/requests');
if (!fs.existsSync(reqDir)) fs.mkdirSync(reqDir, { recursive: true });
const attachUpload = multer({
  storage: multer.diskStorage({
    destination: reqDir,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Định dạng file không hỗ trợ'), ok);
  }
});

router.get('/', requirePermission('requests', 'view'), ctrl.index);

// Quản lý quy trình (đặt trước /:id để không bị nuốt route)
router.get('/forms', requirePermission('requests', 'full'), ctrl.listForms);
router.post('/forms', requirePermission('requests', 'full'), ctrl.createForm);
router.post('/forms/:id/edit', requirePermission('requests', 'full'), ctrl.editForm);
router.post('/forms/:id/toggle', requirePermission('requests', 'full'), ctrl.toggleForm);

router.get('/new/:formId', requirePermission('requests', 'edit'), ctrl.getNew);
router.post('/submit', requirePermission('requests', 'edit'), attachUpload.array('attachments', 5), ctrl.submit);

router.get('/:id', requirePermission('requests', 'view'), ctrl.detail);
router.post('/:id/approve', requirePermission('requests', 'edit'), ctrl.approve);
router.post('/:id/reopen', requirePermission('requests', 'full'), ctrl.reopen);

module.exports = router;
