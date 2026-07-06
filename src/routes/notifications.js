const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Danh sách thông báo của tôi
router.get('/', async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [req.session.userId]
    );
    res.render('notifications/index', { title: 'Thông báo', notifications: r.rows });
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

// Đánh dấu tất cả đã đọc
router.post('/mark-all-read', async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false', [req.session.userId]);
    req.flash('success', 'Đã đánh dấu tất cả là đã đọc');
  } catch (err) { req.flash('error', 'Lỗi cập nhật thông báo'); }
  res.redirect('/notifications');
});

// Mở 1 thông báo: đánh dấu đã đọc rồi chuyển tới link
router.get('/:id/open', async (req, res) => {
  try {
    const r = await query(
      `UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING link`,
      [req.params.id, req.session.userId]
    );
    res.redirect(r.rows[0]?.link || '/notifications');
  } catch (err) { res.redirect('/notifications'); }
});

module.exports = router;
