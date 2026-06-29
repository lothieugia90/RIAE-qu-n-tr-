const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/projectController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', ctrl.index);
router.get('/create', requireRole('admin', 'director', 'pm'), ctrl.getCreate);

// Create: form posts to both /projects and /projects/create
router.post('/', requireRole('admin', 'director', 'pm'), ctrl.postCreate);
router.post('/create', requireRole('admin', 'director', 'pm'), ctrl.postCreate);

router.get('/:id', ctrl.detail);
router.get('/:id/kanban', ctrl.kanban);
router.get('/:id/gantt', ctrl.gantt);
router.get('/:id/edit', requireRole('admin', 'director', 'pm'), ctrl.getEdit);

// Edit: form posts with ?_method=PUT → goes to PUT /:id
router.put('/:id', requireRole('admin', 'director', 'pm'), ctrl.postEdit);
router.post('/:id/edit', requireRole('admin', 'director', 'pm'), ctrl.postEdit);

// Delete: form uses ?_method=DELETE → goes to DELETE /:id
router.delete('/:id', requireRole('admin', 'director'), ctrl.deleteProject);
router.post('/:id/delete', requireRole('admin', 'director'), ctrl.deleteProject);

// Members: view posts to /projects/:id/members
router.post('/:id/members', requireRole('admin', 'director', 'pm'), ctrl.addMember);
router.post('/:id/add-member', requireRole('admin', 'director', 'pm'), ctrl.addMember);

// Remove member: view posts to /projects/:id/members/remove?_method=DELETE
router.delete('/:id/members/remove', requireRole('admin', 'director', 'pm'), ctrl.removeMember);
router.post('/:id/members/remove', requireRole('admin', 'director', 'pm'), ctrl.removeMember);
router.post('/:id/remove-member', requireRole('admin', 'director', 'pm'), ctrl.removeMember);

// Documents
const { anyUpload } = require('../config/upload');
router.post('/:id/documents', anyUpload.single('file'), ctrl.uploadDocument);
router.post('/:id/documents/:docId/delete', ctrl.deleteDocument);

// Members JSON for AJAX
router.get('/:id/members-json', ctrl.membersJson);

// Progress: view posts to /projects/:id/progress
router.post('/:id/progress', ctrl.updateProgress);
router.post('/:id/update-progress', ctrl.updateProgress);

// Assign workflow
router.post('/:id/set-workflow', requireRole('admin', 'director', 'pm'), ctrl.setWorkflow);

module.exports = router;
