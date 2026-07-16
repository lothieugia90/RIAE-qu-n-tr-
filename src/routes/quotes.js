const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const ctrl = require('../controllers/quoteController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { uploadDir } = require('../config/uploads');

router.use(requireAuth);

// Upload file báo giá Excel (.xlsx/.xls)
const xlsUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir('quotes'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.xlsm', '.csv'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Chỉ chấp nhận file Excel (.xlsx/.xls/.csv)'), ok);
  }
});

router.get('/', requirePermission('quotes', 'view'), ctrl.index);
router.get('/create', requirePermission('quotes', 'edit'), ctrl.getForm);
router.post('/', requirePermission('quotes', 'edit'), xlsUpload.single('quote_file'), ctrl.save);
router.get('/:id', requirePermission('quotes', 'view'), ctrl.detail);
router.get('/:id/edit', requirePermission('quotes', 'edit'), ctrl.getForm);
router.post('/:id/status', requirePermission('quotes', 'edit'), ctrl.setStatus);

module.exports = router;
