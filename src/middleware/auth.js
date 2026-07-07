const { query } = require('../config/database');
const { ROLE_INHERIT, PERM_LEVELS } = require('../config/roles');

// Cache ma trận quyền trong RAM, tự làm mới sau TTL — tránh query mỗi request.
let permCache = null;
let permCacheAt = 0;
const PERM_CACHE_TTL = 60 * 1000;

async function getPermissionMatrix() {
  if (permCache && Date.now() - permCacheAt < PERM_CACHE_TTL) return permCache;
  const result = await query('SELECT role, module, perm_level FROM role_permissions');
  const matrix = {};
  for (const row of result.rows) {
    if (!matrix[row.role]) matrix[row.role] = {};
    matrix[row.role][row.module] = row.perm_level;
  }
  permCache = matrix;
  permCacheAt = Date.now();
  return matrix;
}

function invalidatePermCache() {
  permCache = null;
}

// Mức quyền hiệu lực của 1 user với 1 module (đã tính kế thừa vai trò).
async function getPermLevel(role, module) {
  if (role === 'admin') return 'full';
  const matrix = await getPermissionMatrix();
  const own = (matrix[role] && matrix[role][module]) || 'none';
  let best = PERM_LEVELS.indexOf(own);
  for (const base of ROLE_INHERIT[role] || []) {
    const inherited = (matrix[base] && matrix[base][module]) || 'none';
    best = Math.max(best, PERM_LEVELS.indexOf(inherited));
  }
  return PERM_LEVELS[Math.max(best, 0)];
}

const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  req.flash('error', 'Vui lòng đăng nhập để tiếp tục');
  return res.redirect('/auth/login');
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/auth/login');
    const userRole = req.session.userRole;
    if (roles.includes(userRole)) return next();
    const inherited = ROLE_INHERIT[userRole] || [];
    if (inherited.some(r => roles.includes(r))) return next();
    req.flash('error', 'Bạn không có quyền truy cập trang này');
    return res.redirect('/dashboard');
  };
};

// Chặn theo ma trận role_permissions: requirePermission('users', 'edit')
const requirePermission = (module, minLevel = 'view') => {
  return async (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/auth/login');
    try {
      const level = await getPermLevel(req.session.userRole, module);
      if (PERM_LEVELS.indexOf(level) >= PERM_LEVELS.indexOf(minLevel)) return next();
      req.flash('error', 'Bạn không có quyền thực hiện thao tác này');
      return res.redirect('/dashboard');
    } catch (err) {
      console.error('requirePermission error:', err.message);
      return res.status(500).render('errors/500', { title: 'Lỗi hệ thống', error: {} });
    }
  };
};

const loadUser = async (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.userRole = null;
  if (req.session && req.session.userId) {
    try {
      const result = await query(
        `SELECT id, username, email, full_name, role, avatar_url, department, position, is_active
         FROM users WHERE id = $1 AND is_active = true`,
        [req.session.userId]
      );
      if (result.rows.length > 0) {
        req.user = result.rows[0];
        res.locals.currentUser = result.rows[0];
        res.locals.userRole = result.rows[0].role;
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

module.exports = { requireAuth, requireRole, requirePermission, loadUser, getPermLevel, invalidatePermCache };
