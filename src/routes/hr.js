const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/hrController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { avatarUpload, documentUpload } = require('../config/upload');

router.use(requireAuth);

router.get('/', ctrl.index);
router.get('/create', requireRole('admin', 'director'), ctrl.getCreate);
router.post('/create', requireRole('admin', 'director'), avatarUpload.single('avatar'), ctrl.postCreate);
router.post('/', requireRole('admin', 'director'), avatarUpload.single('avatar'), ctrl.postCreate);

router.get('/:id', ctrl.detail);
router.get('/:id/edit', requireRole('admin', 'director'), ctrl.getEdit);
router.post('/:id/edit', requireRole('admin', 'director'), avatarUpload.single('avatar'), ctrl.postEdit);
router.put('/:id', requireRole('admin', 'director'), avatarUpload.single('avatar'), ctrl.postEdit);

router.post('/:id/toggle-active', requireRole('admin', 'director'), ctrl.toggleActive);
router.post('/:id/quick-role', requireRole('admin'), ctrl.quickRole);
router.get('/:id/history-json', ctrl.historyJson);

// Document upload
router.post('/:id/documents', documentUpload.single('file'), ctrl.uploadDocument);
router.post('/:id/documents/:docId/delete', requireRole('admin', 'director'), ctrl.deleteDocument);

// Leave requests
router.post('/:id/leave', ctrl.createLeaveRequest);
router.post('/:id/leave-request', ctrl.createLeaveRequest);
router.post('/:id/leaves/:leaveId/approve', requireRole('admin', 'director'), ctrl.approveLeave);
router.post('/:id/reset-password', requireRole('admin', 'director'), ctrl.resetPassword);

module.exports = router;
