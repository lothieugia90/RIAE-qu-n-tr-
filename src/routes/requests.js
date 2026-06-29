const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(requireAuth);

// ── File upload setup ────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
const requestStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/requests');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});
const requestUpload = multer({
  storage: requestStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Định dạng file không hỗ trợ: ' + ext));
  }
});

// ── Notification helper ──────────────────────────────────────────────────────
async function notify(userId, title, message, link) {
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, type, category, link, created_at)
       VALUES ($1,$2,$3,'request','work',$4,NOW())`,
      [userId, title, message, link]
    );
  } catch (e) { /* silent if notifications table differs */ }
}

// ── Category meta ────────────────────────────────────────────────────────────
const CATEGORY_META = {
  admin:   { label: 'Hành chính', icon: 'fa-user-clock',       bg: '#EFF6FF', color: '#2563EB' },
  finance: { label: 'Tài chính',  icon: 'fa-coins',            bg: '#F0FDF4', color: '#16A34A' },
  project: { label: 'Dự án',      icon: 'fa-project-diagram',  bg: '#FAF5FF', color: '#7C3AED' },
  other:   { label: 'Khác',       icon: 'fa-file-alt',         bg: '#F9FAFB', color: '#6B7280' }
};

// ── GET / ────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const isAdmin = ['admin', 'director', 'hr'].includes(req.session.userRole);
    const userId = req.session.userId;

    const [myReqResult, pendingResult, allReqResult, formsResult] = await Promise.all([
      query(
        `SELECT r.*, rf.name as form_name, rf.category, u.full_name as submitter_name
         FROM requests r
         JOIN request_forms rf ON rf.id = r.form_id
         JOIN users u ON u.id = r.submitted_by
         WHERE r.submitted_by = $1
         ORDER BY r.created_at DESC LIMIT 100`,
        [userId]
      ),
      query(
        `SELECT r.*, rf.name as form_name, rf.category, u.full_name as submitter_name,
                ra.id as approval_id, ra.step_order
         FROM requests r
         JOIN request_forms rf ON rf.id = r.form_id
         JOIN users u ON u.id = r.submitted_by
         JOIN request_approvals ra ON ra.request_id = r.id
         WHERE ra.approver_id = $1 AND ra.status = 'pending' AND r.status = 'pending'
         ORDER BY r.created_at`,
        [userId]
      ),
      isAdmin
        ? query(
            `SELECT r.*, rf.name as form_name, rf.category, u.full_name as submitter_name
             FROM requests r
             JOIN request_forms rf ON rf.id = r.form_id
             JOIN users u ON u.id = r.submitted_by
             ORDER BY r.created_at DESC LIMIT 200`
          )
        : { rows: [] },
      query('SELECT * FROM request_forms WHERE is_active=true ORDER BY category, name')
    ]);

    const myRequests      = myReqResult.rows;
    const pendingRequests = pendingResult.rows;
    const allRequests     = allReqResult.rows;
    const forms           = formsResult.rows;

    const statBase = isAdmin ? allRequests : myRequests;
    const stats = {
      total:    statBase.length,
      pending:  statBase.filter(r => r.status === 'pending').length,
      approved: statBase.filter(r => r.status === 'approved').length,
      rejected: statBase.filter(r => r.status === 'rejected').length
    };

    const formsByCategory = {};
    for (const f of forms) {
      const cat = f.category || 'other';
      if (!formsByCategory[cat]) formsByCategory[cat] = [];
      formsByCategory[cat].push(f);
    }

    res.render('requests/index', {
      title: 'Yêu cầu & Phê duyệt',
      myRequests,
      pendingRequests,
      allRequests,
      forms,
      formsByCategory,
      isAdmin,
      pendingCount: pendingRequests.length,
      stats,
      categoryMeta: CATEGORY_META
    });
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

// ── GET /pending ─────────────────────────────────────────────────────────────
router.get('/pending', (req, res) => res.redirect('/?tab=pending'));

// ── GET /forms ───────────────────────────────────────────────────────────────
router.get('/forms', requireRole('admin', 'director'), async (req, res) => {
  const [formsResult, usersResult] = await Promise.all([
    query(
      `SELECT rf.*, u.full_name as creator_name,
              (SELECT COUNT(*)::int FROM requests WHERE form_id=rf.id) as request_count
       FROM request_forms rf
       LEFT JOIN users u ON u.id = rf.created_by
       ORDER BY rf.created_at DESC`
    ),
    query('SELECT id, full_name, role FROM users WHERE is_active=true ORDER BY full_name')
  ]);
  res.render('requests/forms', {
    title: 'Quản lý Quy trình',
    forms: formsResult.rows,
    users: usersResult.rows,
    categoryMeta: CATEGORY_META
  });
});

// ── POST /forms ──────────────────────────────────────────────────────────────
router.post('/forms', requireRole('admin', 'director'), async (req, res) => {
  const { name, description, category } = req.body;
  const fields        = req.body['fields[]']        ? (Array.isArray(req.body['fields[]'])        ? req.body['fields[]']        : [req.body['fields[]']])        : [];
  const ftypes        = req.body['ftypes[]']        ? (Array.isArray(req.body['ftypes[]'])        ? req.body['ftypes[]']        : [req.body['ftypes[]']])        : [];
  const freqs         = req.body['freqs[]']         ? (Array.isArray(req.body['freqs[]'])         ? req.body['freqs[]']         : [req.body['freqs[]']])         : [];
  const foptionsRaw   = req.body['foptions[]'];
  const foptions      = foptionsRaw !== undefined ? (Array.isArray(foptionsRaw) ? foptionsRaw : [foptionsRaw]) : [];
  const stepApprovers = req.body['step_approver[]'] ? (Array.isArray(req.body['step_approver[]']) ? req.body['step_approver[]'] : [req.body['step_approver[]']]) : [];
  const stepNames     = req.body['step_name[]']     ? (Array.isArray(req.body['step_name[]'])     ? req.body['step_name[]']     : [req.body['step_name[]']])     : [];

  const fieldsJson = fields.map((f, i) => {
    const obj = { label: f, type: ftypes[i] || 'text', required: freqs[i] === 'true' };
    if (foptions[i] && foptions[i].trim()) {
      obj.options = foptions[i].split('\n').map(o => o.trim()).filter(Boolean);
    }
    return obj;
  });
  const stepsJson = stepApprovers
    .map((a, i) => ({ name: stepNames[i] || '', approver_id: a }))
    .filter(s => s.approver_id);

  try {
    await query(
      `INSERT INTO request_forms (name, description, category, fields, approval_steps, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
      [name, description || null, category || 'other', JSON.stringify(fieldsJson), JSON.stringify(stepsJson), req.session.userId]
    );
    req.flash('success', `Đã tạo quy trình "${name}"`);
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/requests/forms');
});

// ── POST /forms/:id/edit ────────────────────────────────────────────────────
router.post('/forms/:id/edit', requireRole('admin', 'director'), async (req, res) => {
  const { name, description, category } = req.body;
  const fields        = req.body['fields[]']        ? (Array.isArray(req.body['fields[]'])        ? req.body['fields[]']        : [req.body['fields[]']])        : [];
  const ftypes        = req.body['ftypes[]']        ? (Array.isArray(req.body['ftypes[]'])        ? req.body['ftypes[]']        : [req.body['ftypes[]']])        : [];
  const freqs         = req.body['freqs[]']         ? (Array.isArray(req.body['freqs[]'])         ? req.body['freqs[]']         : [req.body['freqs[]']])         : [];
  const foptionsRaw   = req.body['foptions[]'];
  const foptions      = foptionsRaw !== undefined ? (Array.isArray(foptionsRaw) ? foptionsRaw : [foptionsRaw]) : [];
  const stepApprovers = req.body['step_approver[]'] ? (Array.isArray(req.body['step_approver[]']) ? req.body['step_approver[]'] : [req.body['step_approver[]']]) : [];
  const stepNames     = req.body['step_name[]']     ? (Array.isArray(req.body['step_name[]'])     ? req.body['step_name[]']     : [req.body['step_name[]']])     : [];

  const fieldsJson = fields.map((f, i) => {
    const obj = { label: f, type: ftypes[i] || 'text', required: freqs[i] === 'true' };
    if (foptions[i] && foptions[i].trim()) {
      obj.options = foptions[i].split('\n').map(o => o.trim()).filter(Boolean);
    }
    return obj;
  });
  const stepsJson = stepApprovers
    .map((a, i) => ({ name: stepNames[i] || '', approver_id: a }))
    .filter(s => s.approver_id);

  try {
    await query(
      `UPDATE request_forms SET name=$1, description=$2, category=$3, fields=$4::jsonb, approval_steps=$5::jsonb WHERE id=$6`,
      [name, description || null, category || 'other', JSON.stringify(fieldsJson), JSON.stringify(stepsJson), req.params.id]
    );
    req.flash('success', `Đã cập nhật quy trình "${name}"`);
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/requests/forms');
});

// ── POST /forms/:id/toggle ───────────────────────────────────────────────────
router.post('/forms/:id/toggle', requireRole('admin', 'director'), async (req, res) => {
  const r = await query('SELECT is_active FROM request_forms WHERE id=$1', [req.params.id]);
  if (!r.rows.length) return res.redirect('/requests/forms');
  const nowActive = !r.rows[0].is_active;
  await query('UPDATE request_forms SET is_active=$1 WHERE id=$2', [nowActive, req.params.id]);
  req.flash('success', nowActive ? 'Đã hiện quy trình' : 'Đã ẩn quy trình');
  res.redirect('/requests/forms');
});

// ── POST /forms/:id/delete ───────────────────────────────────────────────────
router.post('/forms/:id/delete', requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM request_forms WHERE id=$1', [req.params.id]);
    req.flash('success', 'Đã xóa quy trình');
  } catch (err) {
    req.flash('error', 'Không thể xóa: quy trình đang có yêu cầu liên kết');
  }
  res.redirect('/requests/forms');
});

// ── GET /new/:formId ─────────────────────────────────────────────────────────
router.get('/new/:formId', async (req, res) => {
  const form = await query('SELECT * FROM request_forms WHERE id=$1 AND is_active=true', [req.params.formId]);
  if (!form.rows.length) return res.redirect('/requests');
  let financeApprovers = null;
  if (form.rows[0].category === 'finance') {
    // Auto-determine 3-step approvers for finance requests
    const submitter = await query('SELECT department FROM users WHERE id=$1', [req.session.userId]);
    const dept = submitter.rows[0]?.department;
    const [headRes, dirRes, accRes] = await Promise.all([
      dept ? query(`SELECT id, full_name, role, department FROM users
                    WHERE role IN ('head_tech','head_hr','head_sales') AND department=$1 AND is_active=true LIMIT 1`, [dept])
           : { rows: [] },
      query(`SELECT id, full_name FROM users WHERE role='director' AND is_active=true LIMIT 1`),
      query(`SELECT id, full_name FROM users WHERE role='accountant' AND is_active=true LIMIT 1`),
    ]);
    financeApprovers = {
      head:      headRes.rows[0] || null,
      director:  dirRes.rows[0]  || null,
      accountant: accRes.rows[0] || null,
    };
  }
  res.render('requests/new', {
    title: 'Tạo yêu cầu mới',
    form: form.rows[0],
    categoryMeta: CATEGORY_META,
    financeApprovers,
  });
});

// ── POST /submit ─────────────────────────────────────────────────────────────
router.post('/submit', requestUpload.array('attachments', 5), async (req, res) => {
  const { form_id, title, priority,
          payment_recipient, payment_account, payment_bank, payment_amount, payment_note } = req.body;
  const data = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!['form_id','title','priority','payment_recipient','payment_account','payment_bank','payment_amount','payment_note'].includes(k))
      data[k] = v;
  }
  try {
    const formResult = await query('SELECT * FROM request_forms WHERE id=$1', [form_id]);
    if (!formResult.rows.length) throw new Error('Không tìm thấy quy trình');
    const form = formResult.rows[0];
    const isFinance = form.category === 'finance';

    const attachmentUrls = (req.files || []).map(f => '/uploads/requests/' + f.filename);

    const r = await query(
      `INSERT INTO requests (form_id, title, data, submitted_by, priority, attachment_urls,
         payment_recipient, payment_account, payment_bank, payment_amount, payment_note)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING id`,
      [form_id, title, JSON.stringify(data), req.session.userId, priority || 'normal',
       JSON.stringify(attachmentUrls),
       payment_recipient || null, payment_account || null, payment_bank || null,
       payment_amount ? parseFloat(payment_amount) : null, payment_note || null]
    );
    const reqId = r.rows[0].id;

    // Build approval steps
    let steps;
    if (isFinance) {
      // Auto 3-step for finance: Trưởng bộ phận → Giám đốc → Kế toán
      const submitter = await query('SELECT department FROM users WHERE id=$1', [req.session.userId]);
      const dept = submitter.rows[0]?.department;
      const [headRes, dirRes, accRes] = await Promise.all([
        dept ? query(`SELECT id FROM users WHERE role IN ('head_tech','head_hr','head_sales') AND department=$1 AND is_active=true LIMIT 1`, [dept])
             : { rows: [] },
        query(`SELECT id FROM users WHERE role='director' AND is_active=true LIMIT 1`),
        query(`SELECT id FROM users WHERE role='accountant' AND is_active=true LIMIT 1`),
      ]);
      steps = [];
      if (headRes.rows[0] && headRes.rows[0].id !== req.session.userId)
        steps.push({ approver_id: headRes.rows[0].id, name: 'Trưởng bộ phận' });
      if (dirRes.rows[0])
        steps.push({ approver_id: dirRes.rows[0].id, name: 'Giám đốc' });
      if (accRes.rows[0])
        steps.push({ approver_id: accRes.rows[0].id, name: 'Kế toán' });
    } else {
      steps = Array.isArray(form.approval_steps) ? form.approval_steps
            : JSON.parse(form.approval_steps || '[]');
    }

    for (let i = 0; i < steps.length; i++) {
      if (steps[i].approver_id) {
        await query(
          `INSERT INTO request_approvals (request_id, step_order, approver_id, step_name)
           VALUES ($1,$2,$3,$4)`,
          [reqId, i, steps[i].approver_id, steps[i].name || null]
        );
        await notify(
          steps[i].approver_id,
          'Có yêu cầu mới cần duyệt',
          `Yêu cầu "${title}" đang chờ phê duyệt của bạn`,
          '/requests/' + reqId
        );
      }
    }
    await notify(req.session.userId, 'Yêu cầu đã được gửi',
      `Yêu cầu "${title}" đã gửi thành công và đang chờ duyệt`, '/requests/' + reqId);

    req.flash('success', 'Đã gửi yêu cầu thành công');
    res.redirect('/requests/' + reqId);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/requests');
  }
});

// ── POST /bulk-approve ───────────────────────────────────────────────────────
router.post('/bulk-approve', async (req, res) => {
  let { ids, action, rejection_reason } = req.body;
  if (!ids) return res.redirect('/requests?tab=pending');
  if (!Array.isArray(ids)) ids = [ids];
  const isAdmin = ['admin', 'director', 'hr'].includes(req.session.userRole);
  const status = action === 'approve' ? 'approved' : 'rejected';

  for (const id of ids) {
    try {
      if (isAdmin) {
        await query(
          `UPDATE request_approvals SET status=$1, rejection_reason=$2, signed_at=NOW()
           WHERE request_id=$3 AND status='pending'`,
          [status, rejection_reason || null, id]
        );
      } else {
        await query(
          `UPDATE request_approvals SET status=$1, rejection_reason=$2, signed_at=NOW()
           WHERE request_id=$3 AND approver_id=$4 AND status='pending'`,
          [status, rejection_reason || null, id, req.session.userId]
        );
      }
      if (action === 'reject') {
        await query(
          'UPDATE requests SET status=$1, rejection_reason=$2, updated_at=NOW() WHERE id=$3',
          ['rejected', rejection_reason || null, id]
        );
      } else {
        await updateRequestStatus(id);
      }

      const reqData = await query('SELECT submitted_by, title FROM requests WHERE id=$1', [id]);
      if (reqData.rows.length) {
        const r = reqData.rows[0];
        await notify(
          r.submitted_by,
          status === 'approved' ? 'Yêu cầu đã được duyệt' : 'Yêu cầu bị từ chối',
          `Yêu cầu "${r.title}" đã ${status === 'approved' ? 'được phê duyệt' : 'bị từ chối'}`,
          '/requests/' + id
        );
      }
    } catch (e) {
      console.error('bulk-approve error for id', id, e.message);
    }
  }
  req.flash('success', `Đã ${status === 'approved' ? 'duyệt' : 'từ chối'} ${ids.length} yêu cầu`);
  res.redirect('/requests?tab=pending');
});

// ── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [reqResult, approvalsResult] = await Promise.all([
      query(
        `SELECT r.*, rf.name as form_name, rf.fields, rf.category,
                u.full_name as submitter_name, u.department as submitter_dept
         FROM requests r
         JOIN request_forms rf ON rf.id = r.form_id
         JOIN users u ON u.id = r.submitted_by
         WHERE r.id = $1`,
        [req.params.id]
      ),
      query(
        `SELECT ra.*, u.full_name as approver_name, u.role as approver_role, u.department as approver_dept
         FROM request_approvals ra
         JOIN users u ON u.id = ra.approver_id
         WHERE ra.request_id = $1
         ORDER BY ra.step_order`,
        [req.params.id]
      )
    ]);
    if (!reqResult.rows.length) return res.redirect('/requests');
    const request = reqResult.rows[0];
    const approvals = approvalsResult.rows;

    const isAdmin = ['admin', 'director', 'hr'].includes(req.session.userRole);
    const canApprove = approvals.some(
      a => String(a.approver_id) === String(req.session.userId) && a.status === 'pending' && request.status === 'pending'
    ) || (isAdmin && request.status === 'pending');

    res.render('requests/detail', {
      title: request.title,
      request,
      approvals,
      canApprove,
      isAdmin,
      categoryMeta: CATEGORY_META
    });
  } catch (err) {
    console.error(err);
    res.redirect('/requests');
  }
});

// ── POST /:id/approve ────────────────────────────────────────────────────────
router.post('/:id/approve', async (req, res) => {
  const { action, comment, rejection_reason } = req.body;
  if (action === 'reject' && !rejection_reason) {
    req.flash('error', 'Vui lòng nhập lý do từ chối');
    return res.redirect('/requests/' + req.params.id);
  }
  const status = action === 'approve' ? 'approved' : 'rejected';
  const isAdmin = ['admin', 'director', 'hr'].includes(req.session.userRole);

  try {
    if (isAdmin) {
      await query(
        `UPDATE request_approvals SET status=$1, comment=$2, rejection_reason=$3, signed_at=NOW()
         WHERE request_id=$4 AND status='pending'`,
        [status, comment || null, rejection_reason || null, req.params.id]
      );
    } else {
      await query(
        `UPDATE request_approvals SET status=$1, comment=$2, rejection_reason=$3, signed_at=NOW()
         WHERE request_id=$4 AND approver_id=$5 AND status='pending'`,
        [status, comment || null, rejection_reason || null, req.params.id, req.session.userId]
      );
    }

    if (action === 'reject') {
      await query(
        'UPDATE requests SET status=$1, rejection_reason=$2, updated_at=NOW() WHERE id=$3',
        ['rejected', rejection_reason, req.params.id]
      );
    } else {
      await updateRequestStatus(req.params.id);
    }

    const reqData = await query('SELECT submitted_by, title FROM requests WHERE id=$1', [req.params.id]);
    if (reqData.rows.length) {
      const r = reqData.rows[0];
      await notify(
        r.submitted_by,
        status === 'approved' ? 'Yêu cầu đã được duyệt' : 'Yêu cầu bị từ chối',
        `Yêu cầu "${r.title}" đã ${status === 'approved' ? 'được phê duyệt' : 'bị từ chối'}` + (rejection_reason ? `: ${rejection_reason}` : ''),
        '/requests/' + req.params.id
      );
    }

    req.flash('success', action === 'approve' ? 'Đã phê duyệt' : 'Đã từ chối yêu cầu');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Có lỗi xảy ra: ' + err.message);
  }
  res.redirect('/requests/' + req.params.id);
});

// ── POST /:id/reopen ─────────────────────────────────────────────────────────
router.post('/:id/reopen', requireRole('admin', 'director'), async (req, res) => {
  try {
    await query(`UPDATE requests SET status='pending', rejection_reason=NULL, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await query(`UPDATE request_approvals SET status='pending', signed_at=NULL, comment=NULL, rejection_reason=NULL WHERE request_id=$1`, [req.params.id]);
    req.flash('success', 'Đã mở lại yêu cầu');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/requests/' + req.params.id);
});

// ── Helper ───────────────────────────────────────────────────────────────────
async function updateRequestStatus(requestId) {
  const all = await query('SELECT * FROM request_approvals WHERE request_id=$1', [requestId]);
  const rows = all.rows;
  if (!rows.length) return;
  const hasRejected = rows.some(a => a.status === 'rejected');
  const allApproved = rows.every(a => a.status === 'approved');
  const newStatus = hasRejected ? 'rejected' : allApproved ? 'approved' : 'pending';
  await query('UPDATE requests SET status=$1, updated_at=NOW() WHERE id=$2', [newStatus, requestId]);
}

module.exports = router;
