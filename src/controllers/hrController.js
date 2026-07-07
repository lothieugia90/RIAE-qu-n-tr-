const bcrypt = require('bcryptjs');
const { query, pool } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { ROLES, ROLE_VALUES, ROLE_LABELS } = require('../config/roles');
const { logActivity } = require('../utils/activityLog');

const index = async (req, res) => {
  try {
    const { role, department, search } = req.query;
    let sql = `SELECT u.*, e.employee_code, e.hire_date, e.contract_type
               FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE 1=1`;
    const params = [];
    if (role) { params.push(role); sql += ` AND u.role=$${params.length}`; }
    if (department) { params.push(department); sql += ` AND u.department=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR e.employee_code ILIKE $${params.length})`; }
    sql += ' ORDER BY u.full_name';

    const [users, depts, roleStats] = await Promise.all([
      query(sql, params),
      query('SELECT DISTINCT department FROM users WHERE department IS NOT NULL ORDER BY department'),
      query(`SELECT role, COUNT(*)::int as count FROM users WHERE is_active=true GROUP BY role ORDER BY count DESC`)
    ]);

    const permLevel = await getPermLevel(req.session.userRole, 'hr');
    res.render('hr/index', {
      title: 'Quản lý Nhân sự',
      users: users.rows,
      departments: depts.rows.map(r => r.department),
      roleStats: roleStats.rows,
      roleLabels: ROLE_LABELS,
      roles: ROLES,
      filters: req.query,
      permLevel
    });
  } catch (err) {
    console.error('hr index:', err);
    req.flash('error', 'Lỗi tải danh sách nhân sự');
    res.redirect('/dashboard');
  }
};

const getCreate = async (req, res) => {
  res.render('hr/form', { title: 'Thêm Nhân viên mới', employee: null, roles: ROLES });
};

const postCreate = async (req, res) => {
  const { username, email, password, full_name, role, phone, department, position,
          employee_code, date_of_birth, hire_date, contract_type, salary,
          address, bank_account, bank_name, emergency_contact_name, emergency_contact_phone } = req.body;
  if (!username || !email || !full_name || !ROLE_VALUES.includes(role)) {
    req.flash('error', 'Vui lòng nhập đủ thông tin bắt buộc và vai trò hợp lệ');
    return res.redirect('/hr/create');
  }
  const pwd = password && password.length >= 8 ? password : null;
  if (password && !pwd) {
    req.flash('error', 'Mật khẩu phải có ít nhất 8 ký tự');
    return res.redirect('/hr/create');
  }
  const finalPwd = pwd || ('Riae@' + Math.random().toString(36).slice(2, 8));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(finalPwd, 12);
    const userResult = await client.query(
      `INSERT INTO users (username,email,password_hash,full_name,role,phone,department,position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [username.trim().toLowerCase(), email.trim().toLowerCase(), hash, full_name.trim(),
       role, phone || null, department || null, position || null]
    );
    const uid = userResult.rows[0].id;
    await client.query(
      `INSERT INTO employees (user_id,employee_code,date_of_birth,hire_date,contract_type,salary,
        address,bank_account,bank_name,emergency_contact_name,emergency_contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [uid, employee_code || null, date_of_birth || null, hire_date || new Date(),
       contract_type || null, salary || null, address || null, bank_account || null,
       bank_name || null, emergency_contact_name || null, emergency_contact_phone || null]
    );
    await client.query('COMMIT');
    logActivity(req.session.userId, 'HR_CREATE', `Thêm nhân viên ${full_name} (${ROLE_LABELS[role]})`,
      { entityType: 'user', entityId: uid, ip: req.ip });
    req.flash('success', `Đã thêm nhân viên ${full_name}. Mật khẩu tạm: ${finalPwd} — yêu cầu đổi sau lần đăng nhập đầu.`);
    res.redirect('/hr/' + uid);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.code === '23505' ? 'Username, email hoặc mã NV đã tồn tại' : 'Lỗi thêm nhân viên');
    res.redirect('/hr/create');
  } finally { client.release(); }
};

const detail = async (req, res) => {
  try {
    const [user, projects, taskStats, documents, recentRequests, attendanceSummary] = await Promise.all([
      query(`SELECT u.*, e.employee_code, e.date_of_birth, e.hire_date, e.contract_type,
                    e.salary, e.address, e.bank_account, e.bank_name,
                    e.emergency_contact_name, e.emergency_contact_phone
             FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.id=$1`, [req.params.id]),
      query(`SELECT p.id, p.name, p.code, p.status, pm.role as project_role
             FROM project_members pm JOIN projects p ON p.id=pm.project_id
             WHERE pm.user_id=$1 ORDER BY p.created_at DESC LIMIT 10`, [req.params.id]),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='done')::int as done,
             COUNT(*) FILTER (WHERE status='in_progress')::int as in_progress
             FROM tasks WHERE assignee_id=$1`, [req.params.id]),
      query('SELECT * FROM employee_documents WHERE user_id=$1 ORDER BY created_at DESC', [req.params.id]),
      query(`SELECT r.id, r.title, r.status, r.created_at, rf.name as form_name
             FROM requests r JOIN request_forms rf ON rf.id=r.form_id
             WHERE r.submitted_by=$1 ORDER BY r.created_at DESC LIMIT 10`, [req.params.id]),
      query(`SELECT COUNT(*) FILTER (WHERE status='present')::int as present,
             COUNT(*) FILTER (WHERE status IN ('annual_leave','sick_leave','unpaid_leave'))::int as leave,
             COUNT(*) FILTER (WHERE status='late')::int as late
             FROM attendance_records
             WHERE user_id=$1 AND EXTRACT(MONTH FROM work_date)=EXTRACT(MONTH FROM CURRENT_DATE)
               AND EXTRACT(YEAR FROM work_date)=EXTRACT(YEAR FROM CURRENT_DATE)`, [req.params.id])
    ]);
    if (!user.rows.length) {
      req.flash('error', 'Không tìm thấy nhân viên');
      return res.redirect('/hr');
    }
    const permLevel = await getPermLevel(req.session.userRole, 'hr');
    res.render('hr/detail', {
      title: user.rows[0].full_name,
      employee: user.rows[0],
      projects: projects.rows,
      taskStats: taskStats.rows[0],
      documents: documents.rows,
      recentRequests: recentRequests.rows,
      attendanceSummary: attendanceSummary.rows[0],
      roleLabels: ROLE_LABELS,
      permLevel
    });
  } catch (err) {
    console.error('hr detail:', err);
    res.redirect('/hr');
  }
};

const getEdit = async (req, res) => {
  try {
    const r = await query(
      `SELECT u.*, e.employee_code, e.date_of_birth, e.hire_date, e.contract_type, e.salary,
              e.address, e.bank_account, e.bank_name, e.emergency_contact_name, e.emergency_contact_phone
       FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.id=$1`, [req.params.id]);
    if (!r.rows.length) return res.redirect('/hr');
    res.render('hr/form', { title: 'Chỉnh sửa Nhân viên', employee: r.rows[0], roles: ROLES });
  } catch (err) { console.error(err); res.redirect('/hr'); }
};

const postEdit = async (req, res) => {
  const { full_name, role, phone, department, position, employee_code,
          date_of_birth, hire_date, contract_type, salary, address,
          bank_account, bank_name, emergency_contact_name, emergency_contact_phone } = req.body;
  if (!ROLE_VALUES.includes(role)) {
    req.flash('error', 'Vai trò không hợp lệ');
    return res.redirect('/hr/' + req.params.id + '/edit');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET full_name=$1,role=$2,phone=$3,department=$4,position=$5,updated_at=NOW() WHERE id=$6`,
      [full_name.trim(), role, phone || null, department || null, position || null, req.params.id]
    );
    await client.query(
      `INSERT INTO employees (user_id,employee_code,date_of_birth,hire_date,contract_type,salary,
        address,bank_account,bank_name,emergency_contact_name,emergency_contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id) DO UPDATE SET
         employee_code=EXCLUDED.employee_code, date_of_birth=EXCLUDED.date_of_birth,
         hire_date=EXCLUDED.hire_date, contract_type=EXCLUDED.contract_type, salary=EXCLUDED.salary,
         address=EXCLUDED.address, bank_account=EXCLUDED.bank_account, bank_name=EXCLUDED.bank_name,
         emergency_contact_name=EXCLUDED.emergency_contact_name,
         emergency_contact_phone=EXCLUDED.emergency_contact_phone, updated_at=NOW()`,
      [req.params.id, employee_code || null, date_of_birth || null, hire_date || null,
       contract_type || null, salary || null, address || null, bank_account || null,
       bank_name || null, emergency_contact_name || null, emergency_contact_phone || null]
    );
    await client.query('COMMIT');
    logActivity(req.session.userId, 'HR_UPDATE', `Cập nhật hồ sơ ${full_name}`,
      { entityType: 'user', entityId: req.params.id, ip: req.ip });
    req.flash('success', 'Cập nhật hồ sơ nhân viên thành công');
    res.redirect('/hr/' + req.params.id);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.code === '23505' ? 'Mã nhân viên đã tồn tại' : 'Lỗi cập nhật hồ sơ');
    res.redirect('/hr/' + req.params.id + '/edit');
  } finally { client.release(); }
};

const toggleActive = async (req, res) => {
  try {
    if (req.params.id === req.session.userId) {
      req.flash('error', 'Không thể tự khóa tài khoản của chính mình');
      return res.redirect('/hr/' + req.params.id);
    }
    const r = await query(
      `UPDATE users SET is_active = NOT is_active, updated_at=NOW() WHERE id=$1
       RETURNING full_name, is_active`, [req.params.id]);
    if (r.rows.length) {
      const u = r.rows[0];
      logActivity(req.session.userId, u.is_active ? 'HR_ACTIVATE' : 'HR_DEACTIVATE',
        `${u.is_active ? 'Mở khóa' : 'Khóa'} tài khoản: ${u.full_name}`,
        { entityType: 'user', entityId: req.params.id, ip: req.ip });
      req.flash('success', `Đã ${u.is_active ? 'mở khóa' : 'khóa'} tài khoản ${u.full_name}`);
    }
  } catch (err) { req.flash('error', 'Lỗi cập nhật trạng thái'); }
  res.redirect('/hr/' + req.params.id);
};

const resetPassword = async (req, res) => {
  const { new_password } = req.body;
  if (new_password && new_password.length < 8) {
    req.flash('error', 'Mật khẩu phải có ít nhất 8 ký tự');
    return res.redirect('/hr/' + req.params.id);
  }
  const pwd = new_password || ('Riae@' + Math.random().toString(36).slice(2, 8));
  try {
    const hash = await bcrypt.hash(pwd, 12);
    const r = await query(
      `UPDATE users SET password_hash=$1, failed_login_count=0, locked_until=NULL, updated_at=NOW()
       WHERE id=$2 RETURNING full_name`,
      [hash, req.params.id]
    );
    if (!r.rows.length) {
      req.flash('error', 'Không tìm thấy nhân viên');
      return res.redirect('/hr');
    }
    logActivity(req.session.userId, 'HR_RESET_PASSWORD', `Đặt lại mật khẩu cho ${r.rows[0].full_name}`,
      { entityType: 'user', entityId: req.params.id, ip: req.ip });
    req.flash('success', `Đã đặt lại mật khẩu cho ${r.rows[0].full_name}. Mật khẩu mới: ${pwd}`);
  } catch (err) {
    console.error('hr reset-password:', err);
    req.flash('error', 'Lỗi đặt lại mật khẩu');
  }
  res.redirect('/hr/' + req.params.id);
};

const deleteEmployee = async (req, res) => {
  if (req.params.id === req.session.userId) {
    req.flash('error', 'Không thể tự xóa tài khoản của chính mình');
    return res.redirect('/hr/' + req.params.id);
  }
  try {
    const r = await query('DELETE FROM users WHERE id=$1 RETURNING full_name', [req.params.id]);
    if (!r.rows.length) {
      req.flash('error', 'Không tìm thấy nhân viên');
      return res.redirect('/hr');
    }
    logActivity(req.session.userId, 'HR_DELETE', `Xóa nhân viên ${r.rows[0].full_name}`, { ip: req.ip });
    req.flash('success', `Đã xóa nhân viên ${r.rows[0].full_name}`);
  } catch (err) {
    console.error('hr delete:', err);
    req.flash('error', 'Lỗi xóa nhân viên (có thể còn dữ liệu liên kết)');
  }
  res.redirect('/hr');
};

const uploadDocument = async (req, res) => {
  const { doc_type, name, issued_date, expiry_date, notes } = req.body;
  if (!req.file) {
    req.flash('error', 'Vui lòng chọn file');
    return res.redirect('/hr/' + req.params.id);
  }
  try {
    await query(
      `INSERT INTO employee_documents (user_id, doc_type, name, file_url, file_name, issued_date, expiry_date, notes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, doc_type || 'other', name || req.file.originalname,
       '/uploads/documents/' + req.file.filename, req.file.originalname,
       issued_date || null, expiry_date || null, notes || null, req.session.userId]
    );
    req.flash('success', 'Đã tải lên tài liệu');
  } catch (err) { req.flash('error', 'Lỗi tải tài liệu'); }
  res.redirect('/hr/' + req.params.id);
};

const deleteDocument = async (req, res) => {
  try {
    await query('DELETE FROM employee_documents WHERE id=$1 AND user_id=$2', [req.params.docId, req.params.id]);
    req.flash('success', 'Đã xóa tài liệu');
  } catch (err) { req.flash('error', 'Lỗi xóa tài liệu'); }
  res.redirect('/hr/' + req.params.id);
};

module.exports = { index, getCreate, postCreate, detail, getEdit, postEdit, toggleActive, resetPassword, deleteEmployee, uploadDocument, deleteDocument };
