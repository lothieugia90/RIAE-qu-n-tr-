const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/', async (req, res) => {
  try {
    const users = await query('SELECT * FROM users ORDER BY created_at DESC');
    const logs = await query(`
      SELECT al.*, u.full_name FROM activity_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.created_at DESC LIMIT 100
    `);
    const stats = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_active=true) as active_users,
        (SELECT COUNT(*) FROM projects WHERE status='active') as active_projects,
        (SELECT COUNT(*) FROM tasks WHERE status!='done') as open_tasks,
        (SELECT COUNT(*) FROM warehouse_items WHERE quantity <= min_quantity) as low_stock
    `);
    res.render('admin/index', {
      title: 'Quản trị Hệ thống',
      users: users.rows,
      logs: logs.rows,
      stats: stats.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

router.post('/users/:id/toggle', async (req, res) => {
  await query('UPDATE users SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  req.flash('success', 'Đã thay đổi trạng thái tài khoản');
  res.redirect('/admin');
});

router.post('/users/:id/reset-password', async (req, res) => {
  const hash = await bcrypt.hash('Riae@2024', 12);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  req.flash('success', 'Đã reset mật khẩu về: Riae@2024');
  res.redirect('/admin');
});

router.post('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  const audit = require('../utils/audit');
  const old = await query('SELECT role, full_name FROM users WHERE id=$1', [req.params.id]);
  await query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  if (old.rows.length) {
    audit.log(req.session.userId, 'ROLE_CHANGE', 'user', req.params.id,
      `Đổi vai trò ${old.rows[0].full_name}: ${old.rows[0].role} → ${role}`,
      { role: old.rows[0].role }, { role }, req.ip);
  }
  req.flash('success', 'Đã cập nhật vai trò');
  res.redirect('/admin');
});

// Audit log viewer
router.get('/audit', async (req, res) => {
  const { entity_type, action, page = 1 } = req.query;
  const limit = 50, offset = (page - 1) * limit;
  let sql = `SELECT al.*, u.full_name as actor_name FROM audit_logs al
             LEFT JOIN users u ON u.id=al.user_id WHERE 1=1`;
  const params = [];
  if (entity_type) { params.push(entity_type); sql += ` AND al.entity_type=$${params.length}`; }
  if (action) { params.push(action); sql += ` AND al.action=$${params.length}`; }
  sql += ` ORDER BY al.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(limit, offset);

  const [logs, totalRes] = await Promise.all([
    query(sql, params),
    query(`SELECT COUNT(*)::int as total FROM audit_logs al WHERE 1=1${entity_type ? " AND entity_type='"+entity_type+"'" : ''}${action ? " AND action='"+action+"'" : ''}`)
  ]);
  res.render('admin/audit', {
    title: 'Nhật ký thao tác',
    logs: logs.rows,
    total: totalRes.rows[0].total,
    page: +page, limit,
    filters: req.query
  });
});

module.exports = router;
