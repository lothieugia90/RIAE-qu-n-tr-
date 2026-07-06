const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/quoteController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requirePermission('quotes', 'view'), ctrl.index);
router.get('/create', requirePermission('quotes', 'edit'), ctrl.getForm);
router.post('/', requirePermission('quotes', 'edit'), ctrl.save);
router.get('/:id', requirePermission('quotes', 'view'), ctrl.detail);
router.get('/:id/edit', requirePermission('quotes', 'edit'), ctrl.getForm);
router.post('/:id/status', requirePermission('quotes', 'edit'), ctrl.setStatus);

module.exports = router;
