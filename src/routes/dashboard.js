const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/', ctrl.index);

module.exports = router;
