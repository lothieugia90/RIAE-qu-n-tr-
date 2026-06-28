const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { status, search } = req.query;
  let sql = 'SELECT q.*, u.full_name as creator_name, p.name as project_name FROM quotes q LEFT JOIN users u ON u.id=q.created_by LEFT JOIN projects p ON p.id=q.project_id WHERE 1=1';
  const params = [];
  if (status) { params.push(status); sql += ` AND q.status=$${params.length}`; }
  if (search) { params.push(`%${search}%`); sql += ` AND (q.title ILIKE $${params.length} OR q.code ILIKE $${params.length} OR q.client_name ILIKE $${params.length})`; }
  sql += ' ORDER BY q.created_at DESC';
  const [quotes, projects] = await Promise.all([
    query(sql, params),
    query("SELECT id, name FROM projects WHERE status='active' ORDER BY name")
  ]);
  res.render('quotes/index', { title: 'Bộ Báo giá', quotes: quotes.rows, projects: projects.rows, filters: req.query });
});

router.get('/create', requireRole('admin','director','pm'), async (req, res) => {
  const projects = await query("SELECT id, name FROM projects ORDER BY name");
  res.render('quotes/form', { title: 'Tạo Báo giá mới', quote: null, items: [], projects: projects.rows });
});

router.post('/', requireRole('admin','director','pm'), async (req, res) => {
  const { code, title, project_id, client_name, client_contact, valid_until, notes } = req.body;
  try {
    const r = await query(
      'INSERT INTO quotes (code,title,project_id,client_name,client_contact,valid_until,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [code, title, project_id||null, client_name, client_contact, valid_until||null, notes, req.session.userId]
    );
    req.flash('success', 'Đã tạo báo giá');
    res.redirect('/quotes/' + r.rows[0].id);
  } catch(err) {
    req.flash('error', err.code==='23505' ? 'Mã báo giá đã tồn tại' : 'Lỗi: ' + err.message);
    res.redirect('/quotes/create');
  }
});

router.get('/:id', async (req, res) => {
  const [quote, items, projects] = await Promise.all([
    query('SELECT q.*, u.full_name as creator_name, p.name as project_name FROM quotes q LEFT JOIN users u ON u.id=q.created_by LEFT JOIN projects p ON p.id=q.project_id WHERE q.id=$1', [req.params.id]),
    query('SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY item_order, created_at', [req.params.id]),
    query("SELECT id, name FROM projects ORDER BY name")
  ]);
  if (!quote.rows.length) return res.redirect('/quotes');
  res.render('quotes/detail', { title: quote.rows[0].title, quote: quote.rows[0], items: items.rows, projects: projects.rows });
});

router.get('/:id/edit', requireRole('admin','director','pm'), async (req, res) => {
  const [quote, items, projects] = await Promise.all([
    query('SELECT * FROM quotes WHERE id=$1', [req.params.id]),
    query('SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY item_order', [req.params.id]),
    query("SELECT id, name FROM projects ORDER BY name")
  ]);
  if (!quote.rows.length) return res.redirect('/quotes');
  res.render('quotes/form', { title: 'Chỉnh sửa Báo giá', quote: quote.rows[0], items: items.rows, projects: projects.rows });
});

router.put('/:id', requireRole('admin','director','pm'), async (req, res) => {
  const { title, project_id, client_name, client_contact, status, valid_until, notes } = req.body;
  await query(
    'UPDATE quotes SET title=$1,project_id=$2,client_name=$3,client_contact=$4,status=$5,valid_until=$6,notes=$7,updated_at=NOW() WHERE id=$8',
    [title, project_id||null, client_name, client_contact, status, valid_until||null, notes, req.params.id]
  );
  req.flash('success', 'Đã cập nhật báo giá');
  res.redirect('/quotes/' + req.params.id);
});

router.post('/:id/items', requireRole('admin','director','pm'), async (req, res) => {
  const { description, unit, quantity, unit_price, discount_percent, notes } = req.body;
  await query(
    'INSERT INTO quote_items (quote_id,description,unit,quantity,unit_price,discount_percent,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.params.id, description, unit, parseFloat(quantity)||1, parseFloat(unit_price)||0, parseFloat(discount_percent)||0, notes]
  );
  // Update total
  await query('UPDATE quotes SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM quote_items WHERE quote_id=$1),updated_at=NOW() WHERE id=$1', [req.params.id]);
  res.redirect('/quotes/' + req.params.id);
});

router.post('/:id/items/:itemId/delete', requireRole('admin','director','pm'), async (req, res) => {
  await query('DELETE FROM quote_items WHERE id=$1', [req.params.itemId]);
  await query('UPDATE quotes SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM quote_items WHERE quote_id=$1),updated_at=NOW() WHERE id=$1', [req.params.id]);
  res.redirect('/quotes/' + req.params.id);
});

router.delete('/:id', requireRole('admin','director'), async (req, res) => {
  await query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
  req.flash('success', 'Đã xóa báo giá');
  res.redirect('/quotes');
});

module.exports = router;
