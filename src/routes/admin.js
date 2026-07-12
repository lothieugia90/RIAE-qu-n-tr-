const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Người dùng
router.get('/users', requirePermission('users', 'view'), adminController.listUsers);
router.post('/users', requirePermission('users', 'full'), adminController.createUser);
router.post('/users/:id', requirePermission('users', 'full'), adminController.updateUser);
router.post('/users/:id/reset-password', requirePermission('users', 'full'), adminController.resetPassword);

// Phân quyền
router.get('/permissions', requirePermission('permissions', 'view'), adminController.getPermissions);
router.post('/permissions', requirePermission('permissions', 'full'), adminController.savePermissions);

// Nhật ký
router.get('/audit', requirePermission('audit', 'view'), adminController.getAuditLog);

// Dọn dữ liệu hệ thống — CHỈ quản trị viên (thao tác xóa vĩnh viễn)
router.get('/cleanup', requireRole('admin'), adminController.getCleanup);
router.post('/cleanup/:category', requireRole('admin'), adminController.doCleanup);

// /admin → trang người dùng
router.get('/', requirePermission('users', 'view'), (req, res) => res.redirect('/admin/users'));

module.exports = router;
