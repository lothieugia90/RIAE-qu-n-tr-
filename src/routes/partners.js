const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { query } = require('../config/database');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { uploadDir } = require('../config/uploads');

router.use(requireAuth);

const TYPE_LABELS = { supplier: 'Nhà cung cấp', contractor: 'Nhà thầu phụ', client: 'Khách hàng' };

// Upload file báo giá Excel của đối tác
const xlsUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir('partners'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.xlsm', '.csv'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Chỉ chấp nhận file Excel (.xlsx/.xls/.csv)'), ok);
  }
});

router.get('/', requirePermission('partners', 'view'), async (req, res) => {
  try {
    const { type, search } = req.query;
    let sql = 'SELECT * FROM partners WHERE is_active=true';
    const params = [];
    if (type) { params.push(type); sql += ` AND type=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (name ILIKE $${params.length} OR contact_person ILIKE $${params.length} OR phone ILIKE $${params.length})`; }
    sql += ' ORDER BY name';
    const partners = await query(sql, params);
    res.render('partners/index', {
      title: 'Đối tác',
      partners: partners.rows,
      typeLabels: TYPE_LABELS,
      filters: req.query
    });
  } catch (err) {
    console.error('partners:', err);
    res.redirect('/dashboard');
  }
});

router.post('/', requirePermission('partners', 'edit'), xlsUpload.single('quote_file'), async (req, res) => {
  const { id, type, name, phone, email, address, tax_code, contact_person, notes } = req.body;
  if (!name?.trim() || !Object.keys(TYPE_LABELS).includes(type)) {
    req.flash('error', 'Tên đội và loại là bắt buộc');
    return res.redirect('/partners');
  }
  const fileUrl = req.file ? '/uploads/partners/' + req.file.filename : undefined;
  const fileName = req.file ? req.file.originalname : undefined;
  try {
    if (id) {
      await query(
        `UPDATE partners SET type=$1,name=$2,phone=$3,email=$4,address=$5,tax_code=$6,contact_person=$7,notes=$8,updated_at=NOW()
         ${fileUrl ? ', quote_file_url=$10, quote_file_name=$11' : ''} WHERE id=$9`,
        fileUrl
          ? [type, name.trim(), phone || null, email || null, address || null, tax_code || null, contact_person || null, notes || null, id, fileUrl, fileName]
          : [type, name.trim(), phone || null, email || null, address || null, tax_code || null, contact_person || null, notes || null, id]
      );
      req.flash('success', 'Đã cập nhật đối tác');
    } else {
      await query(
        `INSERT INTO partners (type,name,phone,email,address,tax_code,contact_person,notes,quote_file_url,quote_file_name,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [type, name.trim(), phone || null, email || null, address || null, tax_code || null, contact_person || null, notes || null, fileUrl || null, fileName || null, req.session.userId]
      );
      req.flash('success', `Đã thêm đối tác ${name.trim()}`);
    }
  } catch (err) { console.error('partners save:', err.message); req.flash('error', 'Lỗi lưu đối tác'); }
  res.redirect('/partners');
});

router.post('/:id/deactivate', requirePermission('partners', 'full'), async (req, res) => {
  try {
    await query('UPDATE partners SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
    req.flash('success', 'Đã ẩn đối tác');
  } catch (err) { req.flash('error', 'Lỗi'); }
  res.redirect('/partners');
});

module.exports = router;
