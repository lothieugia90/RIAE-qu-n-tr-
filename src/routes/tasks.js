const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/taskController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/my-tasks', ctrl.myTasks);
// Việc cá nhân: mọi user tự tạo cho mình (không cần quyền tasks:edit)
router.post('/personal', ctrl.createPersonalTask);

router.post('/', requirePermission('tasks', 'edit'), ctrl.createTask);
router.get('/:id', ctrl.detail);
router.post('/:id', requirePermission('tasks', 'edit'), ctrl.updateTask);
router.post('/:id/status', requirePermission('tasks', 'edit'), ctrl.updateStatus);
// Xóa task: chỉ cần đăng nhập — controller tự kiểm tra là người tạo/được giao/admin
router.post('/:id/delete', ctrl.deleteTask);
router.post('/:id/comments', requirePermission('tasks', 'edit'), ctrl.addComment);
router.post('/:id/time-logs', requirePermission('tasks', 'edit'), ctrl.logTime);

// Checklist (AJAX)
router.post('/:id/checklists', requirePermission('tasks', 'edit'), ctrl.addChecklist);
router.post('/:id/checklists/:cid/toggle', requirePermission('tasks', 'edit'), ctrl.toggleChecklist);
router.post('/:id/checklists/:cid/delete', requirePermission('tasks', 'edit'), ctrl.deleteChecklist);

module.exports = router;
