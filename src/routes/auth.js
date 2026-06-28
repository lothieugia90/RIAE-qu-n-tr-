const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { avatarUpload } = require('../config/upload');

router.get('/login', ctrl.getLogin);
router.post('/login', ctrl.postLogin);
router.get('/logout', ctrl.logout);
router.get('/profile', requireAuth, ctrl.getProfile);
router.post('/profile', requireAuth, avatarUpload.single('avatar'), ctrl.updateProfile);
router.post('/change-password', requireAuth, ctrl.changePassword);

module.exports = router;
