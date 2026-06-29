const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const path    = require('path');
const { requireAuth } = require('../middleware/auth');
const { query }       = require('../config/database');
const { buildHash, generateSignedPDF } = require('../utils/signatureService');

const SIG_DIR     = path.join(__dirname, '../../public/uploads/signatures');
const SIG_URL_BASE = '/uploads/signatures';

router.use(requireAuth);

/* ════════════════════════════════════════════════════
   INDEX — signature log overview
════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const [stats, recentSigs] = await Promise.all([
      query(`SELECT
        COUNT(*) FILTER (WHERE document_type='payroll')::int as payroll_signed,
        COUNT(*) FILTER (WHERE document_type='warehouse_assignment')::int as warehouse_signed,
        COUNT(*) FILTER (WHERE document_type='request')::int as request_signed
        FROM document_signatures WHERE is_valid=true`),
      query(`SELECT ds.*, u.full_name FROM document_signatures ds
             JOIN users u ON u.id=ds.user_id
             ORDER BY ds.signed_at DESC LIMIT 30`)
    ]);
    res.render('signatures/index', {
      title: 'Chữ ký điện tử',
      stats: stats.rows[0] || {},
      recentSigs: recentSigs.rows
    });
  } catch(err) { console.error(err); res.redirect('/dashboard'); }
});

/* ════════════════════════════════════════════════════
   HELPER: verify password + sign a document
════════════════════════════════════════════════════ */
async function doSign({ req, res, documentType, documentId, redirectOnFail, redirectOnSuccess, buildFields, updateFn }) {
  const { pin, signature_data } = req.body;

  // 1. Verify password
  const userRes = await query('SELECT password_hash, full_name FROM users WHERE id=$1', [req.session.userId]);
  const user = userRes.rows[0];
  const valid = await bcrypt.compare(pin, user.password_hash);
  if (!valid) {
    req.flash('error', 'Mật khẩu không đúng. Vui lòng thử lại.');
    return res.redirect(redirectOnFail);
  }

  if (!signature_data || !signature_data.startsWith('data:image')) {
    req.flash('error', 'Vui lòng ký tên trước khi xác nhận.');
    return res.redirect(redirectOnFail);
  }

  const signedAt = new Date();
  const ip       = req.ip || req.headers['x-forwarded-for'] || '—';
  const hash     = buildHash(req.session.userId, documentType, documentId, signedAt);

  // 2. Save to document_signatures
  await query(
    `INSERT INTO document_signatures (user_id, document_type, document_id, signature_data, signature_hash, ip_address, user_agent, signed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (document_type, document_id, user_id) DO UPDATE SET
       signature_data=$4, signature_hash=$5, ip_address=$6, user_agent=$7, signed_at=$8, is_valid=true`,
    [req.session.userId, documentType, documentId, signature_data, hash, ip, req.headers['user-agent'], signedAt]
  );

  // 3. Generate PDF
  let pdfUrl = null;
  try {
    const fields  = await buildFields();
    const outPath = await generateSignedPDF({
      title: fields._title || documentType,
      fields: fields.rows || [],
      signerName: user.full_name,
      signedAt,
      ipAddress: ip,
      signatureHash: hash,
      signatureImg: signature_data,
      outputDir: SIG_DIR,
      filename: `${documentType}-${documentId.substring(0,8)}-${req.session.userId.substring(0,8)}-${Date.now()}`
    });
    pdfUrl = SIG_URL_BASE + '/' + path.basename(outPath);
    await query('UPDATE document_signatures SET pdf_url=$1 WHERE signature_hash=$2', [pdfUrl, hash]);
  } catch (pdfErr) {
    console.error('[signature PDF]', pdfErr.message);
  }

  // 4. Update document record
  await updateFn(hash, signedAt);

  req.flash('success', 'Đã ký xác nhận thành công!');
  return res.redirect(redirectOnSuccess + (pdfUrl ? '?pdf=' + encodeURIComponent(pdfUrl) : ''));
}

/* ════════════════════════════════════════════════════
   PAYROLL
════════════════════════════════════════════════════ */
router.get('/payroll/:id', async (req, res) => {
  try {
    const [payroll, sig] = await Promise.all([
      query(`SELECT pr.*, u.full_name, u.position, u.department
             FROM payroll_records pr JOIN users u ON u.id=pr.user_id WHERE pr.id=$1`, [req.params.id]),
      query(`SELECT * FROM document_signatures WHERE document_type='payroll' AND document_id=$1`, [req.params.id])
    ]);
    if (!payroll.rows.length) return res.redirect('/attendance/payroll');
    // Only the employee themselves or admin/director can view
    const record = payroll.rows[0];
    if (record.user_id !== req.session.userId && !['admin','director','hr','head_hr'].includes(req.session.userRole)) {
      req.flash('error', 'Bạn không có quyền xem phiếu này');
      return res.redirect('/attendance/payroll');
    }
    res.render('signatures/payroll', {
      title: 'Ký xác nhận lương',
      record,
      existingSig: sig.rows[0] || null
    });
  } catch(err) { console.error(err); res.redirect('/attendance/payroll'); }
});

router.post('/payroll/:id/sign', async (req, res) => {
  const id = req.params.id;
  try {
    await doSign({
      req, res,
      documentType: 'payroll',
      documentId: id,
      redirectOnFail: '/signatures/payroll/' + id,
      redirectOnSuccess: '/attendance/payroll',
      buildFields: async () => {
        const r = await query(`SELECT pr.*, u.full_name, u.position, u.department
                               FROM payroll_records pr JOIN users u ON u.id=pr.user_id WHERE pr.id=$1`, [id]);
        const p = r.rows[0];
        return {
          _title: `Phiếu lương tháng ${p.month}/${p.year}`,
          rows: [
            { label: 'Họ tên',        value: p.full_name },
            { label: 'Chức vụ',       value: p.position || '—' },
            { label: 'Bộ phận',       value: p.department || '—' },
            { label: 'Tháng/Năm',     value: `${p.month}/${p.year}` },
            { label: 'Ngày công',     value: `${p.actual_days}/${p.working_days}` },
            { label: 'Lương cơ bản',  value: Number(p.base_salary||0).toLocaleString('vi-VN') + ' đ' },
            { label: 'Thưởng',        value: '+' + Number(p.bonus||0).toLocaleString('vi-VN') + ' đ' },
            { label: 'Khấu trừ',      value: '-' + Number((p.insurance||0)+(p.tax||0)).toLocaleString('vi-VN') + ' đ' },
            { label: 'THỰC NHẬN',     value: Number(p.net_salary||0).toLocaleString('vi-VN') + ' đ' },
          ]
        };
      },
      updateFn: async (hash, signedAt) => {
        await query(
          "UPDATE payroll_records SET status='paid', signed_at=$1, signed_by=$2, signature_hash=$3 WHERE id=$4",
          [signedAt, req.session.userId, hash, id]
        );
      }
    });
  } catch(err) {
    console.error(err);
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/signatures/payroll/' + id);
  }
});

/* ════════════════════════════════════════════════════
   WAREHOUSE ASSIGNMENT
════════════════════════════════════════════════════ */
router.get('/warehouse/:id', async (req, res) => {
  try {
    const [asgn, sig] = await Promise.all([
      query(`SELECT wa.*, wi.name as item_name, wi.unit,
             u.full_name as assignee_name, u.department as assignee_dept,
             ab.full_name as assigned_by_name
             FROM warehouse_assignments wa
             JOIN warehouse_items wi ON wi.id=wa.item_id
             LEFT JOIN users u  ON u.id=wa.assigned_to_user
             LEFT JOIN users ab ON ab.id=wa.assigned_by
             WHERE wa.id=$1`, [req.params.id]),
      query(`SELECT * FROM document_signatures WHERE document_type='warehouse_assignment' AND document_id=$1`, [req.params.id])
    ]);
    if (!asgn.rows.length) return res.redirect('/warehouse/assignments');
    res.render('signatures/warehouse', {
      title: 'Ký nhận vật tư',
      assignment: asgn.rows[0],
      existingSig: sig.rows[0] || null
    });
  } catch(err) { console.error(err); res.redirect('/warehouse/assignments'); }
});

router.post('/warehouse/:id/sign', async (req, res) => {
  const id = req.params.id;
  try {
    await doSign({
      req, res,
      documentType: 'warehouse_assignment',
      documentId: id,
      redirectOnFail: '/signatures/warehouse/' + id,
      redirectOnSuccess: '/warehouse/assignments',
      buildFields: async () => {
        const r = await query(`SELECT wa.*, wi.name as item_name, wi.unit,
                               u.full_name as assignee_name
                               FROM warehouse_assignments wa
                               JOIN warehouse_items wi ON wi.id=wa.item_id
                               LEFT JOIN users u ON u.id=wa.assigned_to_user
                               WHERE wa.id=$1`, [id]);
        const a = r.rows[0];
        return {
          _title: 'Phiếu bàn giao vật tư',
          rows: [
            { label: 'Vật tư',         value: a.item_name },
            { label: 'Số lượng',       value: `${a.quantity} ${a.unit||''}` },
            { label: 'Người nhận',     value: a.assignee_name || '—' },
            { label: 'Ngày bàn giao',  value: new Date(a.assigned_at).toLocaleDateString('vi-VN') },
            { label: 'Ghi chú',        value: a.notes || '—' },
          ]
        };
      },
      updateFn: async (hash, signedAt) => {
        await query(
          'UPDATE warehouse_assignments SET signature_data=$1, signed_at=$2, signed_ip=$3, recipient_signed_at=$4, recipient_signature_hash=$5 WHERE id=$6',
          [req.body.signature_data, signedAt, req.ip, signedAt, hash, id]
        );
      }
    });
  } catch(err) {
    console.error(err);
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/signatures/warehouse/' + id);
  }
});

/* ════════════════════════════════════════════════════
   REQUEST (approval stamp — triggered by approver)
════════════════════════════════════════════════════ */
router.get('/request/:id', async (req, res) => {
  try {
    const [reqDoc, sig] = await Promise.all([
      query(`SELECT r.*, u.full_name as submitter_name, u.department,
             f.title as form_title
             FROM requests r
             JOIN users u ON u.id=r.user_id
             LEFT JOIN request_forms f ON f.id=r.form_id
             WHERE r.id=$1`, [req.params.id]),
      query(`SELECT * FROM document_signatures WHERE document_type='request' AND document_id=$1`, [req.params.id])
    ]);
    if (!reqDoc.rows.length) return res.redirect('/requests');
    res.render('signatures/request', {
      title: 'Ký phê duyệt yêu cầu',
      request: reqDoc.rows[0],
      existingSig: sig.rows[0] || null
    });
  } catch(err) { console.error(err); res.redirect('/requests'); }
});

router.post('/request/:id/sign', async (req, res) => {
  const id = req.params.id;
  try {
    await doSign({
      req, res,
      documentType: 'request',
      documentId: id,
      redirectOnFail: '/signatures/request/' + id,
      redirectOnSuccess: '/requests/' + id,
      buildFields: async () => {
        const r = await query(`SELECT r.*, u.full_name as submitter_name, f.title as form_title
                               FROM requests r JOIN users u ON u.id=r.user_id
                               LEFT JOIN request_forms f ON f.id=r.form_id
                               WHERE r.id=$1`, [id]);
        const d = r.rows[0];
        return {
          _title: `Phiếu ${d.form_title || 'yêu cầu'}`,
          rows: [
            { label: 'Loại yêu cầu',  value: d.form_title || '—' },
            { label: 'Người gửi',     value: d.submitter_name },
            { label: 'Ngày gửi',      value: new Date(d.created_at).toLocaleDateString('vi-VN') },
            { label: 'Nội dung',      value: (d.content||'').substring(0,120) },
            { label: 'Trạng thái',    value: d.status },
          ]
        };
      },
      updateFn: async (hash, signedAt) => {
        await query(
          'UPDATE requests SET approval_signature_hash=$1, approval_signed_at=$2 WHERE id=$3',
          [hash, signedAt, id]
        );
      }
    });
  } catch(err) {
    console.error(err);
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/signatures/request/' + id);
  }
});

/* ════════════════════════════════════════════════════
   VERIFY a signature by hash
════════════════════════════════════════════════════ */
router.get('/verify', async (req, res) => {
  const { hash } = req.query;
  let result = null;
  if (hash) {
    const r = await query(
      `SELECT ds.*, u.full_name FROM document_signatures ds JOIN users u ON u.id=ds.user_id WHERE ds.signature_hash=$1`,
      [hash]
    ).catch(() => ({ rows: [] }));
    result = r.rows[0] || null;
  }
  res.render('signatures/verify', { title: 'Kiểm tra chữ ký', hash: hash || '', result });
});

module.exports = router;
