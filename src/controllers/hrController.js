const { query, pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const audit = require('../utils/audit');

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

    res.render('hr/index', {
      title: 'Quản lý Nhân sự',
      users: users.rows,
      departments: depts.rows,
      roleStats: roleStats.rows,
      filters: req.query
    });
  } catch (err) { console.error(err); res.redirect('/dashboard'); }
};

const getCreate = (req, res) => {
  res.render('hr/form', { title: 'Thêm Nhân viên mới', employee: null, user: null });
};

const postCreate = async (req, res) => {
  const { username, email, password, full_name, role, phone, department, position,
          employee_code, date_of_birth, hire_date, contract_type, salary } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password || 'Riae@2024', 12);
    const userResult = await client.query(
      'INSERT INTO users (username,email,password_hash,full_name,role,phone,department,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [username, email, hash, full_name, role || 'engineer', phone, department, position]
    );
    const uid = userResult.rows[0].id;
    if (req.file) {
      await client.query('UPDATE users SET avatar_url=$1 WHERE id=$2', ['/uploads/avatars/' + req.file.filename, uid]);
    }
    if (employee_code) {
      await client.query(
        'INSERT INTO employees (user_id,employee_code,date_of_birth,hire_date,contract_type,salary) VALUES ($1,$2,$3,$4,$5,$6)',
        [uid, employee_code, date_of_birth || null, hire_date || new Date(), contract_type || null, salary || null]
      );
    }
    await client.query('COMMIT');
    req.flash('success', `Đã thêm nhân viên ${full_name}. Mật khẩu: ${password || 'Riae@2024'}`);
    res.redirect('/hr/' + uid);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.code === '23505' ? 'Username hoặc email đã tồn tại' : 'Lỗi: ' + err.message);
    res.redirect('/hr/create');
  } finally { client.release(); }
};

const detail = async (req, res) => {
  try {
    const [user, projects, taskStats, leaves, documents] = await Promise.all([
      query(`SELECT u.*, e.employee_code, e.date_of_birth, e.hire_date, e.contract_type,
                    e.salary, e.address, e.id as employee_id, e.bank_account, e.bank_name,
                    e.emergency_contact_name, e.emergency_contact_phone
             FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.id=$1`, [req.params.id]),
      query(`SELECT p.name, p.code, p.status, pm.role as project_role, p.id
             FROM project_members pm JOIN projects p ON p.id=pm.project_id
             WHERE pm.user_id=$1 ORDER BY p.created_at DESC`, [req.params.id]),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='done')::int as done,
             COUNT(*) FILTER (WHERE status='in_progress')::int as in_progress
             FROM tasks WHERE assignee_id=$1`, [req.params.id]),
      query(`SELECT lr.*, u.full_name as approver_name
             FROM leave_requests lr
             JOIN employees e ON e.id=lr.employee_id
             LEFT JOIN users u ON u.id=lr.approved_by
             WHERE e.user_id=$1 ORDER BY lr.created_at DESC LIMIT 20`, [req.params.id])
      ,query('SELECT * FROM employee_documents WHERE user_id=$1 ORDER BY created_at DESC', [req.params.id])
    ]);
    if (!user.rows.length) { req.flash('error', 'Không tìm thấy nhân viên'); return res.redirect('/hr'); }
    res.render('hr/detail', {
      title: user.rows[0].full_name,
      employee: user.rows[0],
      projects: projects.rows,
      taskStats: taskStats.rows[0],
      leaves: leaves.rows,
      documents: documents.rows
    });
  } catch (err) { console.error(err); res.redirect('/hr'); }
};

const getEdit = async (req, res) => {
  const user = await query(
    'SELECT u.*, e.* FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.id=$1',
    [req.params.id]
  );
  if (!user.rows.length) return res.redirect('/hr');
  res.render('hr/form', { title: 'Chỉnh sửa Nhân viên', employee: user.rows[0], user: user.rows[0] });
};

const postEdit = async (req, res) => {
  const { full_name, role, phone, department, position,
          date_of_birth, hire_date, contract_type, salary, address,
          emergency_contact_name, emergency_contact_phone } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET full_name=$1,role=$2,phone=$3,department=$4,position=$5,updated_at=NOW() WHERE id=$6',
      [full_name, role, phone, department, position, req.params.id]
    );
    const emp = await client.query('SELECT id FROM employees WHERE user_id=$1', [req.params.id]);
    if (emp.rows.length) {
      await client.query(
        `UPDATE employees SET date_of_birth=$1,hire_date=$2,contract_type=$3,salary=$4,
         address=$5,emergency_contact_name=$6,emergency_contact_phone=$7,updated_at=NOW()
         WHERE user_id=$8`,
        [date_of_birth || null, hire_date || null, contract_type, salary || null,
         address, emergency_contact_name, emergency_contact_phone, req.params.id]
      );
    }
    if (req.file) {
      await client.query('UPDATE users SET avatar_url=$1 WHERE id=$2', ['/uploads/avatars/' + req.file.filename, req.params.id]);
    }
    await client.query('COMMIT');
    req.flash('success', 'Cập nhật thông tin nhân viên thành công');
    res.redirect('/hr/' + req.params.id);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', 'Lỗi cập nhật: ' + err.message);
    res.redirect('/hr/' + req.params.id + '/edit');
  } finally { client.release(); }
};

const toggleActive = async (req, res) => {
  const current = await query('SELECT is_active, full_name FROM users WHERE id=$1', [req.params.id]);
  if (!current.rows.length) {
    if (req.xhr || req.headers.accept?.includes('json')) return res.json({ error: 'Not found' });
    return res.redirect('/hr');
  }
  const wasActive = current.rows[0].is_active;
  await query('UPDATE users SET is_active = NOT is_active, updated_at=NOW() WHERE id=$1', [req.params.id]);
  const action = wasActive ? 'Khóa tài khoản' : 'Mở khóa tài khoản';
  audit.log(req.session.userId, wasActive ? 'DEACTIVATE' : 'ACTIVATE', 'user', req.params.id,
    `${action}: ${current.rows[0].full_name}`, { is_active: wasActive }, { is_active: !wasActive }, req.ip);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true, is_active: !wasActive });
  }
  req.flash('success', `${action} thành công: ${current.rows[0].full_name}`);
  res.redirect('/hr/' + req.params.id);
};

const quickRole = async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'director', 'pm', 'engineer', 'warehouse', 'guest'];
  if (!validRoles.includes(role)) return res.json({ error: 'Vai trò không hợp lệ' });
  const old = await query('SELECT role, full_name FROM users WHERE id=$1', [req.params.id]);
  if (!old.rows.length) return res.json({ error: 'Không tìm thấy người dùng' });
  await query('UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2', [role, req.params.id]);
  audit.log(req.session.userId, 'ROLE_CHANGE', 'user', req.params.id,
    `Đổi vai trò ${old.rows[0].full_name}: ${old.rows[0].role} → ${role}`,
    { role: old.rows[0].role }, { role }, req.ip);
  res.json({ success: true, role });
};

const historyJson = async (req, res) => {
  try {
    const [user, projects, tasks, audit_rows] = await Promise.all([
      query('SELECT id, full_name, role, department, position, last_seen_at FROM users WHERE id=$1', [req.params.id]),
      query(`SELECT p.id, p.name, p.code, p.status, pm.role as project_role, p.start_date, p.end_date
             FROM project_members pm JOIN projects p ON p.id=pm.project_id
             WHERE pm.user_id=$1 ORDER BY p.updated_at DESC LIMIT 10`, [req.params.id]),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='done')::int as done,
             COUNT(*) FILTER (WHERE status='in_progress')::int as in_progress
             FROM tasks WHERE assignee_id=$1`, [req.params.id]),
      query(`SELECT action, description, created_at FROM audit_logs
             WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [req.params.id])
    ]);
    if (!user.rows.length) return res.json({ error: 'Not found' });
    res.json({
      user: user.rows[0],
      projects: projects.rows,
      taskStats: tasks.rows[0],
      recentActions: audit_rows.rows
    });
  } catch (err) {
    res.json({ error: err.message });
  }
};

const createLeaveRequest = async (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;
  try {
    const emp = await query('SELECT id FROM employees WHERE user_id=$1', [req.params.id]);
    if (!emp.rows.length) {
      req.flash('error', 'Không tìm thấy hồ sơ nhân viên');
      return res.redirect('back');
    }
    const days = Math.max(1, Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1);
    await query(
      'INSERT INTO leave_requests (employee_id,leave_type,start_date,end_date,days_count,reason) VALUES ($1,$2,$3,$4,$5,$6)',
      [emp.rows[0].id, leave_type, start_date, end_date, days, reason]
    );
    req.flash('success', `Đã gửi đơn xin nghỉ ${days} ngày`);
  } catch (err) { req.flash('error', 'Lỗi gửi đơn: ' + err.message); }
  res.redirect('/hr/' + req.params.id);
};

const approveLeave = async (req, res) => {
  const { status } = req.body;
  await query(
    'UPDATE leave_requests SET status=$1, approved_by=$2, approved_at=NOW() WHERE id=$3',
    [status, req.session.userId, req.params.leaveId]
  );
  req.flash('success', status === 'approved' ? 'Đã duyệt đơn nghỉ phép' : 'Đã từ chối đơn nghỉ phép');
  res.redirect('back');
};

const uploadDocument = async (req, res) => {
  const { doc_type, name, issued_date, expiry_date, notes } = req.body;
  try {
    if (!req.file) {
      req.flash('error', 'Vui lòng chọn file');
      return res.redirect('/hr/' + req.params.id);
    }
    const fileUrl = '/uploads/documents/' + req.file.filename;
    await query(
      'INSERT INTO employee_documents (user_id, doc_type, name, file_url, file_name, issued_date, expiry_date, notes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [req.params.id, doc_type || 'other', name, fileUrl, req.file.originalname, issued_date || null, expiry_date || null, notes, req.session.userId]
    );
    req.flash('success', 'Đã tải lên tài liệu');
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
  }
  res.redirect('/hr/' + req.params.id);
};

const deleteDocument = async (req, res) => {
  try {
    await query('DELETE FROM employee_documents WHERE id=$1 AND user_id=$2', [req.params.docId, req.params.id]);
    req.flash('success', 'Đã xóa tài liệu');
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
  }
  res.redirect('/hr/' + req.params.id);
};

module.exports = { index, getCreate, postCreate, detail, getEdit, postEdit, toggleActive, quickRole, historyJson, createLeaveRequest, approveLeave, uploadDocument, deleteDocument };
