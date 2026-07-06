const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/projectController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requirePermission('projects', 'view'), ctrl.index);
router.get('/create', requirePermission('projects', 'edit'), ctrl.getCreate);
router.post('/', requirePermission('projects', 'edit'), ctrl.postCreate);

router.get('/:id', requirePermission('projects', 'view'), ctrl.detail);
router.get('/:id/kanban', requirePermission('projects', 'view'), ctrl.kanban);
router.get('/:id/edit', requirePermission('projects', 'edit'), ctrl.getEdit);
router.post('/:id', requirePermission('projects', 'edit'), ctrl.postEdit);
router.post('/:id/cancel', requirePermission('projects', 'full'), ctrl.cancelProject);

router.post('/:id/members', requirePermission('projects', 'edit'), ctrl.addMember);
router.post('/:id/members/remove', requirePermission('projects', 'edit'), ctrl.removeMember);

module.exports = router;
