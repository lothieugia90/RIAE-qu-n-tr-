const bcrypt = require('bcryptjs');
const { query } = require('../config/database');

const getLogin = (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { layout: false, title: 'Đăng nhập - RIAE' });
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
      [username.trim()]
    );
    if (!result.rows.length) {
      req.flash('error', 'Tên đăng nhập hoặc mật khẩu không đúng');
      return res.redirect('/auth/login');
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      req.flash('error', 'Tên đăng nhập hoặc mật khẩu không đúng');
      return res.redirect('/auth/login');
    }
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.full_name;
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    await query(
      'INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES ($1,$2,$3,$4)',
      [user.id, 'LOGIN', 'Đăng nhập hệ thống', req.ip]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error', 'Lỗi hệ thống, vui lòng thử lại');
    res.redirect('/auth/login');
  }
};

const logout = (req, res) => {
  const userId = req.session.userId;
  req.session.destroy(async (err) => {
    if (err) console.error(err);
    if (userId) {
      try {
        await query(
          'INSERT INTO activity_logs (user_id, action, description) VALUES ($1,$2,$3)',
          [userId, 'LOGOUT', 'Đăng xuất hệ thống']
        );
      } catch (e) {}
    }
    res.redirect('/auth/login');
  });
};

const getProfile = async (req, res) => {
  try {
    const result = await query(
      `SELECT u.*, e.employee_code, e.date_of_birth, e.hire_date,
              e.contract_type, e.address, e.bank_account, e.bank_name
       FROM users u LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.id = $1`,
      [req.session.userId]
    );
    res.render('auth/profile', { title: 'Hồ sơ cá nhân', employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
};

const updateProfile = async (req, res) => {
  const { full_name, phone, department, position } = req.body;
  try {
    let sql = 'UPDATE users SET full_name=$1, phone=$2, department=$3, position=$4, updated_at=NOW()';
    const params = [full_name, phone, department, position];
    if (req.file) {
      params.push('/uploads/avatars/' + req.file.filename);
      sql += `, avatar_url=$${params.length}`;
    }
    params.push(req.session.userId);
    sql += ` WHERE id=$${params.length}`;
    await query(sql, params);
    req.session.userName = full_name;
    req.flash('success', 'Cập nhật hồ sơ thành công');
  } catch (err) {
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
  if (new_password.length < 6) {
    req.flash('error', 'Mật khẩu mới phải có ít nhất 6 ký tự');
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
    req.flash('success', 'Đổi mật khẩu thành công');
  } catch (err) {
    req.flash('error', 'Lỗi đổi mật khẩu');
  }
  res.redirect('/auth/profile');
};

module.exports = { getLogin, postLogin, logout, getProfile, updateProfile, changePassword };
