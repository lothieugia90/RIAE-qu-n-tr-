const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/dropdown', ctrl.dropdown);
router.get('/unread-count', ctrl.unreadCount);
router.post('/:id/read', ctrl.markRead);
router.post('/read-all', ctrl.markAllRead);

module.exports = router;
