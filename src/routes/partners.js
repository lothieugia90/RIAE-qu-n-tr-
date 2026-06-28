const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(requireAuth);

// List
router.get('/', async (req, res) => {
  const { type, search } = req.query;
  let sql = 'SELECT * FROM partners WHERE is_active=true';
  const params = [];
  if (type) { params.push(type); sql += ` AND type=$${params.length}`; }
  if (search) { params.push(`%${search}%`); sql += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length})`; }
  sql += ' ORDER BY name';
  const [partners, counts] = await Promise.all([
    query(sql, params),
    query(`SELECT type, COUNT(*)::int as count FROM partners WHERE is_active=true GROUP BY type`)
  ]);
  res.render('partners/index', {
    title: 'Đối tác',
    partners: partners.rows,
    counts: Object.fromEntries(counts.rows.map(r => [r.type, r.count])),
    filters: req.query
  });
});

// Create form
router.get('/create', requireRole('admin','director'), (req, res) => {
  res.render('partners/form', { title: 'Thêm Đối tác', partner: null });
});

// Create submit (alias for Hostinger nginx compatibility)
router.post('/create', requireRole('admin','director'), async (req, res) => {
  const { type, name, phone, email, address, tax_code, contact_person, notes } = req.body;
  try {
    const r = await query(
      'INSERT INTO partners (type,name,phone,email,address,tax_code,contact_person,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [type||'supplier', name, phone, email, address, tax_code, contact_person, notes, req.session.userId]
    );
    req.flash('success', `Đã thêm đối tác "${name}"`);
    res.redirect('/partners/' + r.rows[0].id);
  } catch(err) {
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/partners/create');
  }
});

router.post('/', requireRole('admin','director'), async (req, res) => {
  const { type, name, phone, email, address, tax_code, contact_person, notes } = req.body;
  try {
    const r = await query(
      'INSERT INTO partners (type,name,phone,email,address,tax_code,contact_person,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [type||'supplier', name, phone, email, address, tax_code, contact_person, notes, req.session.userId]
    );
    req.flash('success', `Đã thêm đối tác "${name}"`);
    res.redirect('/partners/' + r.rows[0].id);
  } catch(err) {
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/partners/create');
  }
});

// Detail
router.get('/:id', async (req, res) => {
  const [partner, products, members] = await Promise.all([
    query('SELECT * FROM partners WHERE id=$1', [req.params.id]),
    query('SELECT * FROM partner_products WHERE partner_id=$1 ORDER BY name', [req.params.id]),
    query('SELECT * FROM construction_team_members WHERE partner_id=$1 ORDER BY full_name', [req.params.id])
  ]);
  if (!partner.rows.length) return res.redirect('/partners');
  res.render('partners/detail', {
    title: partner.rows[0].name,
    partner: partner.rows[0],
    products: products.rows,
    members: members.rows
  });
});

// Edit form
router.get('/:id/edit', requireRole('admin','director'), async (req, res) => {
  const r = await query('SELECT * FROM partners WHERE id=$1', [req.params.id]);
  if (!r.rows.length) return res.redirect('/partners');
  res.render('partners/form', { title: 'Chỉnh sửa Đối tác', partner: r.rows[0] });
});

// Edit submit
router.post('/:id/edit', requireRole('admin','director'), async (req, res) => {
  const { type, name, phone, email, address, tax_code, contact_person, notes } = req.body;
  await query(
    'UPDATE partners SET type=$1,name=$2,phone=$3,email=$4,address=$5,tax_code=$6,contact_person=$7,notes=$8,updated_at=NOW() WHERE id=$9',
    [type, name, phone, email, address, tax_code, contact_person, notes, req.params.id]
  );
  req.flash('success', 'Đã cập nhật đối tác');
  res.redirect('/partners/' + req.params.id);
});

router.put('/:id', requireRole('admin','director'), async (req, res) => {
  const { type, name, phone, email, address, tax_code, contact_person, notes } = req.body;
  await query(
    'UPDATE partners SET type=$1,name=$2,phone=$3,email=$4,address=$5,tax_code=$6,contact_person=$7,notes=$8,updated_at=NOW() WHERE id=$9',
    [type, name, phone, email, address, tax_code, contact_person, notes, req.params.id]
  );
  req.flash('success', 'Đã cập nhật đối tác');
  res.redirect('/partners/' + req.params.id);
});

// Add product/service
router.post('/:id/products', requireRole('admin','director','warehouse'), async (req, res) => {
  const { name, unit, unit_price, notes } = req.body;
  await query(
    'INSERT INTO partner_products (partner_id,name,unit,unit_price,notes) VALUES ($1,$2,$3,$4,$5)',
    [req.params.id, name, unit, unit_price||null, notes]
  );
  req.flash('success', 'Đã thêm mặt hàng');
  res.redirect('/partners/' + req.params.id);
});

// Delete product
router.post('/:id/products/:pid/delete', requireRole('admin','director'), async (req, res) => {
  await query('DELETE FROM partner_products WHERE id=$1', [req.params.pid]);
  req.flash('success', 'Đã xóa mặt hàng');
  res.redirect('/partners/' + req.params.id);
});

// Add team member
router.post('/:id/members', requireRole('admin','director'), async (req, res) => {
  const { full_name, phone, id_card, role } = req.body;
  await query(
    'INSERT INTO construction_team_members (partner_id,full_name,phone,id_card,role) VALUES ($1,$2,$3,$4,$5)',
    [req.params.id, full_name, phone, id_card, role]
  );
  req.flash('success', 'Đã thêm thành viên');
  res.redirect('/partners/' + req.params.id);
});

// Delete member
router.post('/:id/members/:mid/delete', requireRole('admin','director'), async (req, res) => {
  await query('DELETE FROM construction_team_members WHERE id=$1', [req.params.mid]);
  req.flash('success', 'Đã xóa thành viên');
  res.redirect('/partners/' + req.params.id);
});

// Deactivate
router.post('/:id/delete', requireRole('admin'), async (req, res) => {
  await query('UPDATE partners SET is_active=false WHERE id=$1', [req.params.id]);
  req.flash('success', 'Đã xóa đối tác');
  res.redirect('/partners');
});

module.exports = router;
