const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ctrl = require('../controllers/taskController');
const { requireAuth, requireTaskAccess } = require('../middleware/auth');

router.use(requireAuth);

// Task file upload config
const taskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/tasks');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});
const taskUpload = multer({ storage: taskStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Personal task list
router.get('/my-tasks', ctrl.myTasks);

// Create
router.post('/create', ctrl.createTask);
router.post('/', ctrl.createTask);

// Edit view
router.get('/:id/edit', ctrl.getEdit);

// Update (POST for Hostinger compatibility)
router.post('/:id/edit', requireTaskAccess, ctrl.updateTask);
router.put('/:id', requireTaskAccess, ctrl.updateTask);

// Status update (AJAX from Kanban)
router.put('/:id/status', requireTaskAccess, ctrl.updateStatus);
router.post('/:id/status', requireTaskAccess, ctrl.updateStatus);

// Delete
router.delete('/:id', ctrl.deleteTask);
router.post('/:id/delete', ctrl.deleteTask);

// Comment
router.post('/:id/comment', ctrl.addComment);

// Time logging
router.post('/:id/log-time', ctrl.logTime);

// File attachments
router.post('/:id/attach', taskUpload.single('file'), ctrl.uploadAttachment);
router.post('/:id/attach/:attachId/delete', ctrl.deleteAttachment);

// Workflow stage move
router.post('/:id/move-stage', ctrl.moveStage);

// Checklist CRUD (AJAX JSON)
router.post('/:id/checklist',                  ctrl.addChecklist);
router.post('/:id/checklist/:cid/toggle',      ctrl.toggleChecklist);
router.post('/:id/checklist/:cid/delete',      ctrl.deleteChecklist);

module.exports = router;
