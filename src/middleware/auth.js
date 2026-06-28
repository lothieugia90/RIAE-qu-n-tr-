const { query } = require('../config/database');

const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  req.flash('error', 'Vui lòng đăng nhập để tiếp tục');
  return res.redirect('/auth/login');
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/auth/login');
    if (!roles.includes(req.session.userRole)) {
      req.flash('error', 'Bạn không có quyền truy cập trang này');
      return res.redirect('/dashboard');
    }
    next();
  };
};

// Task-level permission: only assignee, creator, PM, admin, director can edit
const requireTaskAccess = async (req, res, next) => {
  try {
    const role = req.session.userRole;
    if (['admin', 'director', 'pm'].includes(role)) return next();
    const task = await query(
      'SELECT assignee_id, created_by FROM tasks WHERE id=$1',
      [req.params.id]
    );
    if (!task.rows.length) return res.status(404).json({ error: 'Task không tồn tại' });
    const t = task.rows[0];
    const uid = req.session.userId;
    if (t.assignee_id === uid || t.created_by === uid) return next();
    return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa task này' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const loadUser = async (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.userRole = null;
  if (req.session && req.session.userId) {
    try {
      const result = await query(
        'SELECT id, username, email, full_name, role, avatar_url, department, position, is_active FROM users WHERE id = $1 AND is_active = true',
        [req.session.userId]
      );
      if (result.rows.length > 0) {
        req.user = result.rows[0];
        res.locals.currentUser = result.rows[0];
        res.locals.userRole = result.rows[0].role;
        // Update last_seen_at (fire-and-forget, non-blocking)
        query('UPDATE users SET last_seen_at=NOW() WHERE id=$1', [req.session.userId]).catch(() => {});
      } else {
        req.session.destroy(() => {});
        return res.redirect('/auth/login');
      }
    } catch (err) {
      console.error('loadUser error:', err.message);
    }
  }
  next();
};

module.exports = { requireAuth, requireRole, requireTaskAccess, loadUser };
