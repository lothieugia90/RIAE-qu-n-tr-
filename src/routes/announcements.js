const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/announcementController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { announcementUpload } = require('../config/upload');

router.use(requireAuth);

router.get('/', ctrl.index);
router.get('/create', requireRole('admin', 'director', 'pm'), ctrl.getCreate);

router.post('/', requireRole('admin', 'director', 'pm'), announcementUpload.array('files', 10), ctrl.postCreate);
router.post('/create', requireRole('admin', 'director', 'pm'), announcementUpload.array('files', 10), ctrl.postCreate);

router.get('/:id', ctrl.detail);
router.get('/:id/edit', requireRole('admin', 'director', 'pm'), ctrl.getEditForm);

router.put('/:id', requireRole('admin', 'director', 'pm'), announcementUpload.array('files', 10), ctrl.edit);
router.post('/:id/edit', requireRole('admin', 'director', 'pm'), announcementUpload.array('files', 10), ctrl.edit);

router.delete('/:id', requireRole('admin', 'director'), ctrl.deleteAnnouncement);
router.post('/:id/delete', requireRole('admin', 'director'), ctrl.deleteAnnouncement);

router.post('/:id/read', ctrl.markRead);
router.post('/:id/react', ctrl.react);
router.post('/:id/files/:fileId/delete', requireRole('admin', 'director', 'pm'), ctrl.deleteFile);

module.exports = router;
