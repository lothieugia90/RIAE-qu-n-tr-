const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/payrollSettingsController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/audit', requirePermission('payroll', 'view'), ctrl.auditLog);
router.get('/:id/preview', requirePermission('payroll', 'edit'), ctrl.preview);

router.get('/', requirePermission('payroll', 'view'), ctrl.index);
router.post('/', requirePermission('payroll', 'full'), ctrl.create);
// method-override (app.js) đã chuyển POST + _method=PUT/DELETE thành đúng verb trước khi tới đây
router.put('/:id', requirePermission('payroll', 'edit'), ctrl.update);
router.delete('/:id', requirePermission('payroll', 'full'), ctrl.remove);

module.exports = router;
