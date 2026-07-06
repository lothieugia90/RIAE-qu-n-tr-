const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

const TYPE_LABELS = { supplier: 'Nhà cung cấp', contractor: 'Nhà thầu phụ', client: 'Khách hàng' };

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

router.post('/', requirePermission('partners', 'edit'), async (req, res) => {
  const { id, type, name, phone, email, address, tax_code, contact_person, notes } = req.body;
  if (!name?.trim() || !Object.keys(TYPE_LABELS).includes(type)) {
    req.flash('error', 'Tên và loại đối tác là bắt buộc');
    return res.redirect('/partners');
  }
  try {
    if (id) {
      await query(
        `UPDATE partners SET type=$1,name=$2,phone=$3,email=$4,address=$5,tax_code=$6,contact_person=$7,notes=$8,updated_at=NOW() WHERE id=$9`,
        [type, name.trim(), phone || null, email || null, address || null, tax_code || null, contact_person || null, notes || null, id]
      );
      req.flash('success', 'Đã cập nhật đối tác');
    } else {
      await query(
        `INSERT INTO partners (type,name,phone,email,address,tax_code,contact_person,notes,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [type, name.trim(), phone || null, email || null, address || null, tax_code || null, contact_person || null, notes || null, req.session.userId]
      );
      req.flash('success', `Đã thêm đối tác ${name.trim()}`);
    }
  } catch (err) { req.flash('error', 'Lỗi lưu đối tác'); }
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
