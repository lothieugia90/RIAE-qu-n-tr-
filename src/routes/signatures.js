const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(requireAuth);

router.get('/payroll/:id', async (req, res) => {
  try {
    const payroll = await query(
      `SELECT pr.*, u.full_name, u.position, u.department
       FROM payroll_records pr JOIN users u ON u.id=pr.user_id WHERE pr.id=$1`,
      [req.params.id]
    );
    if (!payroll.rows.length) return res.redirect('/attendance/payroll');
    res.render('signatures/payroll', { title: 'Ký xác nhận lương', record: payroll.rows[0] });
  } catch(err) { console.error(err); res.redirect('/attendance/payroll'); }
});

router.post('/payroll/:id/sign', async (req, res) => {
  const { pin } = req.body;
  try {
    const user = await query('SELECT password_hash FROM users WHERE id=$1', [req.session.userId]);
    const valid = await bcrypt.compare(pin, user.rows[0].password_hash);
    if (!valid) {
      req.flash('error', 'Mật khẩu không đúng. Vui lòng thử lại.');
      return res.redirect('/signatures/payroll/' + req.params.id);
    }
    await query(
      "UPDATE payroll_records SET status='paid', signed_at=NOW(), signed_by=$1 WHERE id=$2",
      [req.session.userId, req.params.id]
    );
    req.flash('success', 'Đã ký xác nhận lương thành công');
    res.redirect('/attendance/payroll');
  } catch(err) {
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/signatures/payroll/' + req.params.id);
  }
});

module.exports = router;
