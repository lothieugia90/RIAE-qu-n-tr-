const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../config/database');
const { logActivity } = require('../utils/activityLog');

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

const getLogin = (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { layout: false, title: 'Đăng nhập', csrfToken: res.locals.csrfToken });
};

const postLogin = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', 'Vui lòng nhập đầy đủ thông tin');
    return res.redirect('/auth/login');
  }
  try {
    const result = await query(
      'SELECT * FROM users WHERE (username = $1 OR email = $1) AND is_active = true',
      [username.trim().toLowerCase()]
    );
    if (!result.rows.length) {
      req.flash('error', 'Tên đăng nhập hoặc mật khẩu không đúng');
      return res.redirect('/auth/login');
    }
    const user = result.rows[0];

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutes = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      req.flash('error', `Tài khoản tạm khóa do nhập sai nhiều lần. Thử lại sau ${minutes} phút.`);
      return res.redirect('/auth/login');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const failed = (user.failed_login_count || 0) + 1;
      const lock = failed >= MAX_FAILED_LOGINS
        ? `NOW() + INTERVAL '${LOCK_MINUTES} minutes'` : 'NULL';
      await query(
        `UPDATE users SET failed_login_count=$1, locked_until=${lock} WHERE id=$2`,
        [failed >= MAX_FAILED_LOGINS ? 0 : failed, user.id]
      );
      if (failed >= MAX_FAILED_LOGINS) {
        logActivity(user.id, 'LOGIN_LOCKED', `Khóa tài khoản ${LOCK_MINUTES} phút do nhập sai ${MAX_FAILED_LOGINS} lần`, { ip: req.ip });
        req.flash('error', `Nhập sai quá ${MAX_FAILED_LOGINS} lần, tài khoản tạm khóa ${LOCK_MINUTES} phút.`);
      } else {
        req.flash('error', 'Tên đăng nhập hoặc mật khẩu không đúng');
      }
      return res.redirect('/auth/login');
    }

    // Chống session fixation: cấp session mới sau khi xác thực thành công
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.full_name;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    // Ghi session xuống store TRƯỚC khi redirect — nếu không, GET /dashboard
    // của trình duyệt có thể đến trước khi session kịp lưu (race condition)
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    await query('UPDATE users SET last_login=NOW(), failed_login_count=0, locked_until=NULL WHERE id=$1', [user.id]);
    logActivity(user.id, 'LOGIN', 'Đăng nhập hệ thống', { ip: req.ip });
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error', 'Lỗi hệ thống, vui lòng thử lại');
    res.redirect('/auth/login');
  }
};

const logout = (req, res) => {
  const userId = req.session.userId;
  req.session.destroy(err => {
    if (err) console.error(err);
    if (userId) logActivity(userId, 'LOGOUT', 'Đăng xuất hệ thống');
    res.redirect('/auth/login');
  });
};

const getProfile = async (req, res) => {
  try {
    const userId = req.session.userId;
    const [user, taskStats, projectCount, attendanceSummary, recentActivity] = await Promise.all([
      query(
        `SELECT u.*, e.employee_code, e.date_of_birth, e.hire_date, e.contract_type,
                e.address, e.bank_account, e.bank_name, e.emergency_contact_name, e.emergency_contact_phone
         FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = $1`, [userId]),
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status='done')::int AS done,
                    COUNT(*) FILTER (WHERE status='in_progress')::int AS in_progress,
                    COUNT(*) FILTER (WHERE status != 'done' AND due_date < CURRENT_DATE)::int AS overdue
             FROM tasks WHERE assignee_id=$1`, [userId]),
      query('SELECT COUNT(*)::int AS c FROM project_members WHERE user_id=$1', [userId]),
      query(`SELECT COUNT(*) FILTER (WHERE status IN ('present','late','remote'))::int AS work_days,
                    COUNT(*) FILTER (WHERE status='late')::int AS late_days,
                    COALESCE(SUM(overtime_hours),0)::float AS ot_hours
             FROM attendance_records
             WHERE user_id=$1 AND date_trunc('month', work_date) = date_trunc('month', CURRENT_DATE)`, [userId]),
      query(`SELECT action, description, created_at FROM activity_logs
             WHERE user_id=$1 ORDER BY created_at DESC LIMIT 6`, [userId])
    ]);
    if (!user.rows.length) return res.redirect('/dashboard');
    res.render('auth/profile', {
      title: 'Hồ sơ cá nhân',
      profile: user.rows[0],
      taskStats: taskStats.rows[0],
      projectCount: projectCount.rows[0].c,
      attendanceSummary: attendanceSummary.rows[0],
      recentActivity: recentActivity.rows
    });
  } catch (err) {
    console.error('getProfile error:', err.message);
    res.redirect('/dashboard');
  }
};

const updateProfile = async (req, res) => {
  const { full_name, phone } = req.body;
  if (!full_name || !full_name.trim()) {
    req.flash('error', 'Họ tên không được để trống');
    return res.redirect('/auth/profile');
  }
  try {
    const params = [full_name.trim(), phone || null];
    let sql = 'UPDATE users SET full_name=$1, phone=$2, updated_at=NOW()';
    if (req.file) {
      params.push('/uploads/avatars/' + req.file.filename);
      sql += `, avatar_url=$${params.length}`;
    }
    params.push(req.session.userId);
    sql += ` WHERE id=$${params.length}`;
    await query(sql, params);
    req.session.userName = full_name.trim();
    req.flash('success', 'Cập nhật hồ sơ thành công');
  } catch (err) {
    console.error('updateProfile error:', err.message);
    req.flash('error', 'Lỗi cập nhật hồ sơ');
  }
  res.redirect('/auth/profile');
};

const changePassword = async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) {
    req.flash('error', 'Mật khẩu xác nhận không khớp');
    return res.redirect('/auth/profile');
  }
  if (!new_password || new_password.length < 8) {
    req.flash('error', 'Mật khẩu mới phải có ít nhất 8 ký tự');
    return res.redirect('/auth/profile');
  }
  try {
    const result = await query('SELECT password_hash FROM users WHERE id=$1', [req.session.userId]);
    const match = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!match) {
      req.flash('error', 'Mật khẩu hiện tại không đúng');
      return res.redirect('/auth/profile');
    }
    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.session.userId]);
    logActivity(req.session.userId, 'PASSWORD_CHANGE', 'Đổi mật khẩu', { ip: req.ip });
    req.flash('success', 'Đổi mật khẩu thành công');
  } catch (err) {
    console.error('changePassword error:', err.message);
    req.flash('error', 'Lỗi đổi mật khẩu');
  }
  res.redirect('/auth/profile');
};

// Lưu chữ ký vẽ tay (canvas dataURL → file PNG)
const saveSignature = async (req, res) => {
  const { signature_data } = req.body;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(signature_data || '');
  if (!m) {
    req.flash('error', 'Chữ ký không hợp lệ');
    return res.redirect('/auth/profile');
  }
  try {
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 500 * 1024) throw new Error('Chữ ký quá lớn');
    const fs = require('fs');
    const path = require('path');
    const { uploadDir } = require('../config/uploads');
    const dir = uploadDir('signatures');
    const filename = req.session.userId + '-' + Date.now() + '.png';
    fs.writeFileSync(path.join(dir, filename), buf);
    await query('UPDATE users SET signature_url=$1, updated_at=NOW() WHERE id=$2',
      ['/uploads/signatures/' + filename, req.session.userId]);
    logActivity(req.session.userId, 'SIGNATURE_UPDATE', 'Cập nhật chữ ký nội bộ', { ip: req.ip });
    req.flash('success', 'Đã lưu chữ ký — chữ ký sẽ hiện trên các bước phê duyệt của bạn');
  } catch (err) {
    console.error('saveSignature:', err.message);
    req.flash('error', 'Lỗi lưu chữ ký');
  }
  res.redirect('/auth/profile');
};

module.exports = { getLogin, postLogin, logout, getProfile, updateProfile, changePassword, saveSignature };
