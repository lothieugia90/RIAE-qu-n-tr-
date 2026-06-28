const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/payrollSettingsController');

const guard = [requireAuth, requireRole('admin', 'director', 'hr')];

router.get('/',                  ...guard, ctrl.index);
router.post('/',                 ...guard, ctrl.create);
router.put('/:id',               ...guard, ctrl.update);
router.delete('/:id',            ...guard, ctrl.remove);
router.get('/audit',             ...guard, ctrl.auditLog);
router.get('/:id/preview',       ...guard, ctrl.preview);

module.exports = router;
