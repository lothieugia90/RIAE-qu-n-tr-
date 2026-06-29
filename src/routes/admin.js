const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const { ROLES, MODULES, DEFAULT_PERMISSIONS } = require('../utils/roles');

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

// ─── Config: Departments ───────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  const [depts, positions, permsRes] = await Promise.all([
    query('SELECT * FROM departments ORDER BY sort_order, name'),
    query(`SELECT p.*, d.name as dept_name FROM positions p LEFT JOIN departments d ON d.id=p.department_id ORDER BY p.sort_order, p.name`),
    query('SELECT * FROM role_permissions ORDER BY role, module'),
  ]);
  // Build permission map: { role: { module: perm_level } }
  const permMap = {};
  for (const row of permsRes.rows) {
    if (!permMap[row.role]) permMap[row.role] = {};
    permMap[row.role][row.module] = row.perm_level;
  }
  res.render('admin/config', {
    title: 'Cấu hình hệ thống',
    departments: depts.rows,
    positions: positions.rows,
    permMap,
    ROLES,
    MODULES,
  });
});

router.post('/config/departments', async (req, res) => {
  const { name, code, sort_order } = req.body;
  await query('INSERT INTO departments (name, code, sort_order) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET code=$2, sort_order=$3',
    [name.trim(), code || null, sort_order || 0]);
  req.flash('success', 'Đã lưu phòng ban');
  res.redirect('/admin/config#departments');
});

router.post('/config/departments/:id/edit', async (req, res) => {
  const { name, code, sort_order, is_active } = req.body;
  await query('UPDATE departments SET name=$1, code=$2, sort_order=$3, is_active=$4 WHERE id=$5',
    [name.trim(), code || null, sort_order || 0, is_active === '1', req.params.id]);
  req.flash('success', 'Đã cập nhật phòng ban');
  res.redirect('/admin/config#departments');
});

router.post('/config/departments/:id/delete', async (req, res) => {
  await query('DELETE FROM departments WHERE id=$1', [req.params.id]);
  req.flash('success', 'Đã xóa phòng ban');
  res.redirect('/admin/config#departments');
});

router.post('/config/positions', async (req, res) => {
  const { name, department_id, sort_order } = req.body;
  await query('INSERT INTO positions (name, department_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT (name, department_id) DO UPDATE SET sort_order=$3',
    [name.trim(), department_id || null, sort_order || 0]);
  req.flash('success', 'Đã lưu chức vụ');
  res.redirect('/admin/config#positions');
});

router.post('/config/positions/:id/edit', async (req, res) => {
  const { name, department_id, sort_order, is_active } = req.body;
  await query('UPDATE positions SET name=$1, department_id=$2, sort_order=$3, is_active=$4 WHERE id=$5',
    [name.trim(), department_id || null, sort_order || 0, is_active === '1', req.params.id]);
  req.flash('success', 'Đã cập nhật chức vụ');
  res.redirect('/admin/config#positions');
});

router.post('/config/positions/:id/delete', async (req, res) => {
  await query('DELETE FROM positions WHERE id=$1', [req.params.id]);
  req.flash('success', 'Đã xóa chức vụ');
  res.redirect('/admin/config#positions');
});

router.post('/config/permissions', async (req, res) => {
  // body: { role_module: perm_level } e.g. { "pm_projects": "manage" }
  const entries = Object.entries(req.body);
  for (const [key, perm] of entries) {
    const [role, ...modParts] = key.split('_');
    const module = modParts.join('_');
    if (!role || !module) continue;
    await query(
      `INSERT INTO role_permissions (role, module, perm_level) VALUES ($1,$2,$3)
       ON CONFLICT (role, module) DO UPDATE SET perm_level=$3, updated_at=NOW()`,
      [role, module, perm]
    );
  }
  req.flash('success', 'Đã lưu phân quyền');
  res.redirect('/admin/config#permissions');
});

router.post('/config/permissions/reset', async (req, res) => {
  for (const [role, modules] of Object.entries(DEFAULT_PERMISSIONS)) {
    for (const [module, perm] of Object.entries(modules)) {
      await query(
        `INSERT INTO role_permissions (role, module, perm_level) VALUES ($1,$2,$3)
         ON CONFLICT (role, module) DO UPDATE SET perm_level=$3, updated_at=NOW()`,
        [role, module, perm]
      );
    }
  }
  req.flash('success', 'Đã khôi phục phân quyền mặc định');
  res.redirect('/admin/config#permissions');
});

module.exports = router;
