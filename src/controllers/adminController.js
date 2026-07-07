const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { ROLES, ROLE_VALUES, ROLE_LABELS, MODULES, PERM_LEVELS } = require('../config/roles');
const { invalidatePermCache } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

// ===== Người dùng =====

const listUsers = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, email, full_name, role, department, position, is_active, last_login, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.render('admin/users', {
      title: 'Quản lý người dùng',
      users: result.rows,
      roles: ROLES,
      roleLabels: ROLE_LABELS
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi tải danh sách người dùng');
    res.redirect('/dashboard');
  }
};

const createUser = async (req, res) => {
  const { username, email, full_name, role, password, department, position } = req.body;
  if (!username || !email || !full_name || !password) {
    req.flash('error', 'Vui lòng nhập đầy đủ thông tin bắt buộc');
    return res.redirect('/admin/users');
  }
  if (!ROLE_VALUES.includes(role)) {
    req.flash('error', 'Vai trò không hợp lệ');
    return res.redirect('/admin/users');
  }
  if (password.length < 8) {
    req.flash('error', 'Mật khẩu phải có ít nhất 8 ký tự');
    return res.redirect('/admin/users');
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role, department, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [username.trim().toLowerCase(), email.trim().toLowerCase(), hash, full_name.trim(), role, department || null, position || null]
    );
    logActivity(req.session.userId, 'USER_CREATE', `Tạo tài khoản ${username} (${ROLE_LABELS[role]})`,
      { entityType: 'user', entityId: result.rows[0].id, ip: req.ip });
    req.flash('success', `Đã tạo tài khoản ${username}`);
  } catch (err) {
    if (err.code === '23505') {
      req.flash('error', 'Tên đăng nhập hoặc email đã tồn tại');
    } else {
      console.error('createUser error:', err.message);
      req.flash('error', 'Lỗi tạo tài khoản');
    }
  }
  res.redirect('/admin/users');
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const { full_name, email, role, department, position, is_active } = req.body;
  if (!ROLE_VALUES.includes(role)) {
    req.flash('error', 'Vai trò không hợp lệ');
    return res.redirect('/admin/users');
  }
  // Không cho tự hạ quyền/khóa chính mình để tránh mất quyền quản trị
  if (id === req.session.userId && (role !== 'admin' || is_active !== 'true')) {
    req.flash('error', 'Không thể tự thay đổi vai trò hoặc khóa tài khoản của chính mình');
    return res.redirect('/admin/users');
  }
  try {
    await query(
      `UPDATE users SET full_name=$1, email=$2, role=$3, department=$4, position=$5, is_active=$6, updated_at=NOW()
       WHERE id=$7`,
      [full_name.trim(), email.trim().toLowerCase(), role, department || null, position || null, is_active === 'true', id]
    );
    logActivity(req.session.userId, 'USER_UPDATE', `Cập nhật tài khoản ${full_name} (vai trò: ${ROLE_LABELS[role]}, ${is_active === 'true' ? 'hoạt động' : 'khóa'})`,
      { entityType: 'user', entityId: id, ip: req.ip });
    req.flash('success', 'Đã cập nhật người dùng');
  } catch (err) {
    if (err.code === '23505') {
      req.flash('error', 'Email đã được sử dụng');
    } else {
      console.error('updateUser error:', err.message);
      req.flash('error', 'Lỗi cập nhật người dùng');
    }
  }
  res.redirect('/admin/users');
};

const resetPassword = async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    req.flash('error', 'Mật khẩu phải có ít nhất 8 ký tự');
    return res.redirect('/admin/users');
  }
  try {
    const hash = await bcrypt.hash(new_password, 12);
    const r = await query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 RETURNING username', [hash, id]);
    logActivity(req.session.userId, 'USER_RESET_PASSWORD', `Reset mật khẩu cho ${r.rows[0]?.username || id}`,
      { entityType: 'user', entityId: id, ip: req.ip });
    req.flash('success', 'Đã đặt lại mật khẩu');
  } catch (err) {
    console.error('resetPassword error:', err.message);
    req.flash('error', 'Lỗi đặt lại mật khẩu');
  }
  res.redirect('/admin/users');
};

// ===== Ma trận phân quyền =====

const getPermissions = async (req, res) => {
  try {
    const result = await query('SELECT role, module, perm_level FROM role_permissions');
    const matrix = {};
    for (const row of result.rows) {
      if (!matrix[row.role]) matrix[row.role] = {};
      matrix[row.role][row.module] = row.perm_level;
    }
    res.render('admin/permissions', {
      title: 'Phân quyền hệ thống',
      roles: ROLES.filter(r => r.value !== 'admin'), // admin luôn full, không cho sửa
      modules: MODULES,
      permLevels: PERM_LEVELS,
      matrix
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi tải ma trận phân quyền');
    res.redirect('/dashboard');
  }
};

const savePermissions = async (req, res) => {
  try {
    // Body dạng perm[role][module] = level
    const perms = req.body.perm || {};
    let changed = 0;
    for (const role of Object.keys(perms)) {
      if (!ROLE_VALUES.includes(role) || role === 'admin') continue;
      for (const mod of Object.keys(perms[role])) {
        if (!MODULES.some(m => m.key === mod)) continue;
        const level = perms[role][mod];
        if (!PERM_LEVELS.includes(level)) continue;
        await query(
          `INSERT INTO role_permissions (role, module, perm_level) VALUES ($1,$2,$3)
           ON CONFLICT (role, module) DO UPDATE SET perm_level=EXCLUDED.perm_level, updated_at=NOW()`,
          [role, mod, level]
        );
        changed++;
      }
    }
    invalidatePermCache();
    logActivity(req.session.userId, 'PERMISSIONS_UPDATE', `Cập nhật ma trận phân quyền (${changed} mục)`, { ip: req.ip });
    req.flash('success', 'Đã lưu phân quyền');
  } catch (err) {
    console.error('savePermissions error:', err.message);
    req.flash('error', 'Lỗi lưu phân quyền');
  }
  res.redirect('/admin/permissions');
};

// ===== Nhật ký hệ thống =====

const getAuditLog = async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const perPage = 50;
  try {
    const [logs, total] = await Promise.all([
      query(
        `SELECT al.*, u.full_name, u.username
         FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
        [perPage, (page - 1) * perPage]
      ),
      query('SELECT COUNT(*)::int AS c FROM activity_logs')
    ]);
    res.render('admin/audit', {
      title: 'Nhật ký hệ thống',
      logs: logs.rows,
      page,
      totalPages: Math.max(Math.ceil(total.rows[0].c / perPage), 1)
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi tải nhật ký');
    res.redirect('/dashboard');
  }
};

module.exports = { listUsers, createUser, updateUser, resetPassword, getPermissions, savePermissions, getAuditLog };
