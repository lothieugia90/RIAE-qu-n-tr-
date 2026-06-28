const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/taskController');
const { requireAuth, requireTaskAccess } = require('../middleware/auth');

router.use(requireAuth);

router.post('/', ctrl.createTask);
router.put('/:id', requireTaskAccess, ctrl.updateTask);
router.delete('/:id', ctrl.deleteTask);
router.post('/:id/comment', ctrl.addComment);
router.put('/:id/status', requireTaskAccess, ctrl.updateStatus);
router.get('/:id/edit', ctrl.getEdit);

module.exports = router;
