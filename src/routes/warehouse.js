const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/warehouseController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requirePermission('warehouse', 'view'), ctrl.index);
router.get('/transactions', requirePermission('warehouse', 'view'), ctrl.transactions);
router.post('/items', requirePermission('warehouse', 'edit'), ctrl.saveItem);
router.post('/transactions', requirePermission('warehouse', 'edit'), ctrl.createTransaction);
router.post('/categories', requirePermission('warehouse', 'full'), ctrl.saveCategory);

module.exports = router;
