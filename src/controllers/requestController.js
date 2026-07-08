const { query } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const { logActivity } = require('../utils/activityLog');
const { signApproval, verifyApproval } = require('../utils/signature');

const CATEGORY_META = {
  admin:   { label: 'Hành chính', icon: 'fa-user-clock',      bg: '#EFF6FF', color: '#2563EB' },
  finance: { label: 'Tài chính',  icon: 'fa-coins',           bg: '#F0FDF4', color: '#16A34A' },
  project: { label: 'Dự án',      icon: 'fa-project-diagram', bg: '#FAF5FF', color: '#7C3AED' },
  other:   { label: 'Khác',       icon: 'fa-file-alt',        bg: '#F9FAFB', color: '#6B7280' }
};

async function isManager(req) {
  return (await getPermLevel(req.session.userRole, 'requests')) === 'full';
}

// Xác định các bước duyệt cho 1 yêu cầu.
// - finance: tự động 3 bước Trưởng BP → Giám đốc → Kế toán (bỏ bước trùng người gửi/không có người)
// - khác: theo approval_steps của form; nếu rỗng → fallback Ban lãnh đạo
//   (fix lỗi v1: yêu cầu kẹt pending vĩnh viễn vì không có ai duyệt)
async function resolveApprovalSteps(form, submitterId) {
  let steps = [];
  if (form.category === 'finance') {
    const submitter = await query('SELECT department FROM users WHERE id=$1', [submitterId]);
    const dept = submitter.rows[0]?.department;
    const [headRes, dirRes, accRes] = await Promise.all([
      dept ? query(`SELECT id FROM users WHERE role IN ('head_tech','head_hr','head_sales')
                    AND department=$1 AND is_active=true LIMIT 1`, [dept])
           : Promise.resolve({ rows: [] }),
      query(`SELECT id FROM users WHERE role='director' AND is_active=true LIMIT 1`),
      query(`SELECT id FROM users WHERE role='accountant' AND is_active=true LIMIT 1`)
    ]);
    if (headRes.rows[0] && headRes.rows[0].id !== submitterId)
      steps.push({ approver_id: headRes.rows[0].id, name: 'Trưởng bộ phận' });
    if (dirRes.rows[0] && dirRes.rows[0].id !== submitterId)
      steps.push({ approver_id: dirRes.rows[0].id, name: 'Giám đốc' });
    if (accRes.rows[0] && accRes.rows[0].id !== submitterId)
      steps.push({ approver_id: accRes.rows[0].id, name: 'Kế toán' });
  } else {
    const raw = Array.isArray(form.approval_steps) ? form.approval_steps
              : JSON.parse(form.approval_steps || '[]');
    steps = raw.filter(s => s.approver_id && s.approver_id !== submitterId);
  }
  // Fallback: không có bước nào → Ban lãnh đạo, rồi admin
  if (steps.length === 0) {
    const fb = await query(
      `SELECT id, role FROM users WHERE role IN ('director','admin') AND is_active=true AND id != $1
       ORDER BY CASE role WHEN 'director' THEN 0 ELSE 1 END LIMIT 1`, [submitterId]);
    if (fb.rows[0]) steps.push({ approver_id: fb.rows[0].id, name: fb.rows[0].role === 'director' ? 'Ban lãnh đạo' : 'Quản trị viên' });
  }
  return steps;
}

// Cập nhật trạng thái tổng của yêu cầu theo các bước duyệt
async function updateRequestStatus(requestId) {
  const all = await query('SELECT status FROM request_approvals WHERE request_id=$1', [requestId]);
  if (!all.rows.length) return;
  const hasRejected = all.rows.some(a => a.status === 'rejected');
  const allApproved = all.rows.every(a => a.status === 'approved');
  const newStatus = hasRejected ? 'rejected' : allApproved ? 'approved' : 'pending';
  await query('UPDATE requests SET status=$1, updated_at=NOW() WHERE id=$2', [newStatus, requestId]);
  return newStatus;
}

const index = async (req, res) => {
  try {
    const userId = req.session.userId;
    const admin = await isManager(req);

    const [myReq, pendingReq, allReq, forms] = await Promise.all([
      query(
        `SELECT r.*, rf.name as form_name, rf.category
         FROM requests r JOIN request_forms rf ON rf.id = r.form_id
         WHERE r.submitted_by = $1 ORDER BY r.created_at DESC LIMIT 100`, [userId]),
      query(
        `SELECT r.*, rf.name as form_name, rf.category, u.full_name as submitter_name, ra.step_name
         FROM requests r
         JOIN request_forms rf ON rf.id = r.form_id
         JOIN users u ON u.id = r.submitted_by
         JOIN request_approvals ra ON ra.request_id = r.id
         WHERE ra.approver_id = $1 AND ra.status = 'pending' AND r.status = 'pending'
         ORDER BY r.created_at`, [userId]),
      admin
        ? query(`SELECT r.*, rf.name as form_name, rf.category, u.full_name as submitter_name
                 FROM requests r
                 JOIN request_forms rf ON rf.id = r.form_id
                 JOIN users u ON u.id = r.submitted_by
                 ORDER BY r.created_at DESC LIMIT 200`)
        : Promise.resolve({ rows: [] }),
      query('SELECT * FROM request_forms WHERE is_active=true ORDER BY category, name')
    ]);

    const statBase = admin ? allReq.rows : myReq.rows;
    res.render('requests/index', {
      title: 'Yêu cầu & Phê duyệt',
      myRequests: myReq.rows,
      pendingRequests: pendingReq.rows,
      allRequests: allReq.rows,
      forms: forms.rows,
      isAdmin: admin,
      activeTab: req.query.tab || 'my',
      stats: {
        total: statBase.length,
        pending: statBase.filter(r => r.status === 'pending').length,
        approved: statBase.filter(r => r.status === 'approved').length,
        rejected: statBase.filter(r => r.status === 'rejected').length
      },
      categoryMeta: CATEGORY_META
    });
  } catch (err) {
    console.error('requests index:', err);
    res.redirect('/dashboard');
  }
};

const getNew = async (req, res) => {
  try {
    const form = await query('SELECT * FROM request_forms WHERE id=$1 AND is_active=true', [req.params.formId]);
    if (!form.rows.length) return res.redirect('/requests');
    const steps = await resolveApprovalSteps(form.rows[0], req.session.userId);
    const approverIds = steps.map(s => s.approver_id);
    let approvers = [];
    if (approverIds.length) {
      const r = await query('SELECT id, full_name FROM users WHERE id = ANY($1)', [approverIds]);
      approvers = steps.map(s => ({
        name: s.name,
        full_name: r.rows.find(u => u.id === s.approver_id)?.full_name || '?'
      }));
    }
    res.render('requests/new', {
      title: 'Tạo yêu cầu: ' + form.rows[0].name,
      form: form.rows[0],
      approvers,
      categoryMeta: CATEGORY_META
    });
  } catch (err) {
    console.error('requests new:', err);
    res.redirect('/requests');
  }
};

const submit = async (req, res) => {
  const { form_id, title, priority } = req.body;
  if (!form_id || !title?.trim()) {
    req.flash('error', 'Vui lòng nhập tiêu đề yêu cầu');
    return res.redirect('/requests');
  }
  try {
    const formResult = await query('SELECT * FROM request_forms WHERE id=$1 AND is_active=true', [form_id]);
    if (!formResult.rows.length) throw new Error('Không tìm thấy quy trình');
    const form = formResult.rows[0];

    // Gom dữ liệu các field động (field_0, field_1, ...)
    const data = {};
    const fields = Array.isArray(form.fields) ? form.fields : JSON.parse(form.fields || '[]');
    fields.forEach((f, i) => { data[f.label] = req.body['field_' + i] || ''; });

    const attachmentUrls = (req.files || []).map(f => '/uploads/requests/' + f.filename);

    const steps = await resolveApprovalSteps(form, req.session.userId);
    if (!steps.length) throw new Error('Không xác định được người duyệt — liên hệ quản trị viên');

    const r = await query(
      `INSERT INTO requests (form_id, title, data, submitted_by, priority, attachment_urls)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb) RETURNING id`,
      [form_id, title.trim(), JSON.stringify(data), req.session.userId,
       ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
       JSON.stringify(attachmentUrls)]
    );
    const reqId = r.rows[0].id;

    for (let i = 0; i < steps.length; i++) {
      await query(
        `INSERT INTO request_approvals (request_id, step_order, approver_id, step_name)
         VALUES ($1,$2,$3,$4)`,
        [reqId, i, steps[i].approver_id, steps[i].name || null]
      );
      notify(steps[i].approver_id, 'request_pending', 'Có yêu cầu mới cần duyệt',
        `Yêu cầu "${title.trim()}" đang chờ phê duyệt của bạn`, '/requests/' + reqId);
    }

    logActivity(req.session.userId, 'REQUEST_SUBMIT', `Gửi yêu cầu: ${title.trim()}`,
      { entityType: 'request', entityId: reqId, ip: req.ip });
    req.flash('success', 'Đã gửi yêu cầu thành công');
    res.redirect('/requests/' + reqId);
  } catch (err) {
    console.error('requests submit:', err.message);
    req.flash('error', 'Lỗi gửi yêu cầu: ' + err.message);
    res.redirect('/requests');
  }
};

const detail = async (req, res) => {
  try {
    const [reqResult, approvalsResult] = await Promise.all([
      query(
        `SELECT r.*, rf.name as form_name, rf.fields, rf.category,
                u.full_name as submitter_name, u.department as submitter_dept
         FROM requests r
         JOIN request_forms rf ON rf.id = r.form_id
         JOIN users u ON u.id = r.submitted_by
         WHERE r.id = $1`, [req.params.id]),
      query(
        `SELECT ra.*, u.full_name as approver_name, u.department as approver_dept, u.signature_url
         FROM request_approvals ra JOIN users u ON u.id = ra.approver_id
         WHERE ra.request_id = $1 ORDER BY ra.step_order`, [req.params.id])
    ]);
    if (!reqResult.rows.length) return res.redirect('/requests');
    const request = reqResult.rows[0];
    const approvals = approvalsResult.rows;
    // Kiểm tra tính xác thực chữ ký từng bước đã ký:
    // true = hợp lệ, false = dữ liệu đã bị sửa/không xác thực được, null = chưa ký
    approvals.forEach(a => {
      a.sig_valid = (a.status !== 'pending' && a.signed_at) ? verifyApproval(a) : null;
    });
    const admin = await isManager(req);
    const canApprove = request.status === 'pending' && (
      approvals.some(a => String(a.approver_id) === String(req.session.userId) && a.status === 'pending') || admin
    );
    res.render('requests/detail', {
      title: request.title,
      request, approvals, canApprove,
      isAdmin: admin,
      categoryMeta: CATEGORY_META
    });
  } catch (err) {
    console.error('requests detail:', err);
    res.redirect('/requests');
  }
};

const approve = async (req, res) => {
  const { action, comment, rejection_reason } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.redirect('/requests/' + req.params.id);
  if (action === 'reject' && !rejection_reason?.trim()) {
    req.flash('error', 'Vui lòng nhập lý do từ chối');
    return res.redirect('/requests/' + req.params.id);
  }
  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    const admin = await isManager(req);
    const params = [status, comment || null, rejection_reason || null, req.params.id];
    let sql = `UPDATE request_approvals SET status=$1, comment=$2, rejection_reason=$3, signed_at=NOW()
               WHERE request_id=$4 AND status='pending'`;
    if (!admin) {
      params.push(req.session.userId);
      sql += ` AND approver_id=$${params.length}`;
    }
    const updated = await query(sql + ' RETURNING *', params);
    if (!updated.rows.length) {
      req.flash('error', 'Bạn không có bước duyệt nào đang chờ ở yêu cầu này');
      return res.redirect('/requests/' + req.params.id);
    }

    // Ký HMAC server-side cho từng bước vừa duyệt — bằng chứng chống giả mạo,
    // không thể tạo lại nếu không có khóa ký trên server
    for (const row of updated.rows) {
      await query('UPDATE request_approvals SET signature_hash=$1 WHERE id=$2',
        [signApproval(row), row.id]);
    }

    if (action === 'reject') {
      await query(`UPDATE requests SET status='rejected', rejection_reason=$1, updated_at=NOW() WHERE id=$2`,
        [rejection_reason.trim(), req.params.id]);
    } else {
      await updateRequestStatus(req.params.id);
    }

    const reqData = await query('SELECT submitted_by, title, status FROM requests WHERE id=$1', [req.params.id]);
    if (reqData.rows.length) {
      const r = reqData.rows[0];
      if (r.submitted_by !== req.session.userId) {
        notify(r.submitted_by, 'request_' + status,
          status === 'approved' ? 'Yêu cầu đã được duyệt' : 'Yêu cầu bị từ chối',
          `Yêu cầu "${r.title}" ${r.status === 'approved' ? 'đã được phê duyệt đầy đủ' : status === 'rejected' ? 'bị từ chối' + (rejection_reason ? ': ' + rejection_reason : '') : 'đã qua một bước duyệt'}`,
          '/requests/' + req.params.id);
      }
      logActivity(req.session.userId, action === 'approve' ? 'REQUEST_APPROVE' : 'REQUEST_REJECT',
        `${action === 'approve' ? 'Duyệt' : 'Từ chối'} yêu cầu: ${r.title}`,
        { entityType: 'request', entityId: req.params.id, ip: req.ip });
    }
    req.flash('success', action === 'approve' ? 'Đã phê duyệt' : 'Đã từ chối yêu cầu');
  } catch (err) {
    console.error('requests approve:', err.message);
    req.flash('error', 'Có lỗi xảy ra khi duyệt');
  }
  res.redirect('/requests/' + req.params.id);
};

const reopen = async (req, res) => {
  try {
    await query(`UPDATE requests SET status='pending', rejection_reason=NULL, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await query(`UPDATE request_approvals SET status='pending', signed_at=NULL, comment=NULL, rejection_reason=NULL, signature_hash=NULL WHERE request_id=$1`, [req.params.id]);
    logActivity(req.session.userId, 'REQUEST_REOPEN', 'Mở lại yêu cầu',
      { entityType: 'request', entityId: req.params.id, ip: req.ip });
    req.flash('success', 'Đã mở lại yêu cầu để duyệt lại từ đầu');
  } catch (err) { req.flash('error', 'Lỗi mở lại yêu cầu'); }
  res.redirect('/requests/' + req.params.id);
};

// ===== Quản lý quy trình (form) =====

function parseFormBody(body) {
  const arr = v => v === undefined ? [] : (Array.isArray(v) ? v : [v]);
  const fields = arr(body.fields).map((label, i) => {
    const obj = {
      label,
      type: ['text', 'textarea', 'number', 'date', 'select'].includes(arr(body.ftypes)[i]) ? arr(body.ftypes)[i] : 'text',
      required: arr(body.freqs)[i] === 'true'
    };
    const opts = arr(body.foptions)[i];
    if (obj.type === 'select' && opts?.trim()) {
      obj.options = opts.split('\n').map(o => o.trim()).filter(Boolean);
    }
    return obj;
  }).filter(f => f.label?.trim());
  const steps = arr(body.step_approver)
    .map((a, i) => ({ name: arr(body.step_name)[i] || '', approver_id: a }))
    .filter(s => s.approver_id);
  return { fields, steps };
}

const listForms = async (req, res) => {
  try {
    const [forms, users] = await Promise.all([
      query(`SELECT rf.*, u.full_name as creator_name,
             (SELECT COUNT(*)::int FROM requests WHERE form_id=rf.id) as request_count
             FROM request_forms rf LEFT JOIN users u ON u.id = rf.created_by
             ORDER BY rf.created_at DESC`),
      query('SELECT id, full_name, role FROM users WHERE is_active=true ORDER BY full_name')
    ]);
    res.render('requests/forms', {
      title: 'Quản lý Quy trình duyệt',
      forms: forms.rows,
      users: users.rows,
      categoryMeta: CATEGORY_META
    });
  } catch (err) { console.error(err); res.redirect('/requests'); }
};

const createForm = async (req, res) => {
  const { name, description, category } = req.body;
  if (!name?.trim()) {
    req.flash('error', 'Tên quy trình là bắt buộc');
    return res.redirect('/requests/forms');
  }
  const { fields, steps } = parseFormBody(req.body);
  try {
    await query(
      `INSERT INTO request_forms (name, description, category, fields, approval_steps, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
      [name.trim(), description || null,
       ['admin', 'finance', 'project', 'other'].includes(category) ? category : 'other',
       JSON.stringify(fields), JSON.stringify(steps), req.session.userId]
    );
    req.flash('success', `Đã tạo quy trình "${name.trim()}"`);
  } catch (err) {
    console.error('createForm:', err.message);
    req.flash('error', 'Lỗi tạo quy trình');
  }
  res.redirect('/requests/forms');
};

const editForm = async (req, res) => {
  const { name, description, category } = req.body;
  const { fields, steps } = parseFormBody(req.body);
  try {
    await query(
      `UPDATE request_forms SET name=$1, description=$2, category=$3, fields=$4::jsonb, approval_steps=$5::jsonb
       WHERE id=$6`,
      [name.trim(), description || null,
       ['admin', 'finance', 'project', 'other'].includes(category) ? category : 'other',
       JSON.stringify(fields), JSON.stringify(steps), req.params.id]
    );
    req.flash('success', `Đã cập nhật quy trình "${name.trim()}"`);
  } catch (err) { req.flash('error', 'Lỗi cập nhật quy trình'); }
  res.redirect('/requests/forms');
};

const toggleForm = async (req, res) => {
  try {
    const r = await query(
      'UPDATE request_forms SET is_active = NOT is_active WHERE id=$1 RETURNING is_active, name', [req.params.id]);
    if (r.rows.length) req.flash('success', `${r.rows[0].is_active ? 'Đã hiện' : 'Đã ẩn'} quy trình "${r.rows[0].name}"`);
  } catch (err) { req.flash('error', 'Lỗi cập nhật'); }
  res.redirect('/requests/forms');
};

module.exports = { index, getNew, submit, detail, approve, reopen, listForms, createForm, editForm, toggleForm };
