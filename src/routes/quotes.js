const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(requireAuth);

// ── Helpers ──────────────────────────────────────────────────────────────────

function recalcTotal(quoteId) {
  return query(
    `UPDATE quotes SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM quote_items WHERE quote_id=$1), updated_at=NOW() WHERE id=$1`,
    [quoteId]
  );
}

function groupBySection(items) {
  const sections = {};
  for (const item of items) {
    const sec = item.section || 'Chung';
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(item);
  }
  return sections;
}

// ── Catalog ──────────────────────────────────────────────────────────────────

router.get('/catalog', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const { search, category } = req.query;
  let sql = `SELECT qc.*, u.full_name as creator_name FROM quote_catalog qc
             LEFT JOIN users u ON u.id=qc.created_by WHERE qc.is_active=true`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (qc.name ILIKE $${params.length} OR qc.code ILIKE $${params.length})`;
  }
  if (category) { params.push(category); sql += ` AND qc.category=$${params.length}`; }
  sql += ' ORDER BY qc.category, qc.name';
  const items = await query(sql, params);
  res.render('quotes/catalog', { title: 'Danh mục Vật tư / Dịch vụ', items: items.rows, filters: req.query });
});

router.post('/catalog', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const { code, name, unit, unit_price, category, description } = req.body;
  try {
    await query(
      `INSERT INTO quote_catalog (code, name, unit, unit_price, category, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [code || null, name, unit || 'cái', parseFloat(unit_price) || 0, category || 'general', description || null, req.session.userId]
    );
    req.flash('success', `Đã thêm "${name}" vào danh mục`);
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Mã hàng đã tồn tại' : 'Lỗi: ' + err.message);
  }
  res.redirect('/quotes/catalog');
});

router.post('/catalog/:id/edit', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const { code, name, unit, unit_price, category, description } = req.body;
  await query(
    `UPDATE quote_catalog SET code=$1, name=$2, unit=$3, unit_price=$4, category=$5, description=$6, updated_at=NOW() WHERE id=$7`,
    [code || null, name, unit || 'cái', parseFloat(unit_price) || 0, category || 'general', description || null, req.params.id]
  );
  req.flash('success', 'Đã cập nhật vật tư');
  res.redirect('/quotes/catalog');
});

router.post('/catalog/:id/delete', requireRole('admin', 'director'), async (req, res) => {
  await query(`UPDATE quote_catalog SET is_active=false WHERE id=$1`, [req.params.id]);
  req.flash('success', 'Đã ẩn vật tư khỏi danh mục');
  res.redirect('/quotes/catalog');
});

// JSON search — used by quotation builder
router.get('/catalog/search', async (req, res) => {
  const q = req.query.q || '';
  const items = await query(
    `SELECT id, code, name, unit, unit_price, category FROM quote_catalog
     WHERE is_active=true AND (name ILIKE $1 OR code ILIKE $1)
     ORDER BY name LIMIT 20`,
    [`%${q}%`]
  );
  res.json(items.rows);
});

// ── Quotes list ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { status, search } = req.query;
  let sql = `SELECT q.*, u.full_name as creator_name, p.name as project_name
             FROM quotes q
             LEFT JOIN users u ON u.id=q.created_by
             LEFT JOIN projects p ON p.id=q.project_id
             WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); sql += ` AND q.status=$${params.length}`; }
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (q.title ILIKE $${params.length} OR q.code ILIKE $${params.length} OR q.client_name ILIKE $${params.length})`;
  }
  sql += ' ORDER BY q.created_at DESC';
  const quotes = await query(sql, params);
  res.render('quotes/index', { title: 'Bộ Báo giá', quotes: quotes.rows, filters: req.query });
});

// ── Create quote ─────────────────────────────────────────────────────────────

router.get('/create', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const projects = await query("SELECT id, name FROM projects ORDER BY name");
  res.render('quotes/form', { title: 'Tạo Báo giá mới', quote: null, projects: projects.rows });
});

async function doCreate(req, res) {
  const { code, title, project_id, client_name, client_contact, valid_until, notes } = req.body;
  try {
    const r = await query(
      `INSERT INTO quotes (code,title,project_id,client_name,client_contact,valid_until,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [code, title, project_id || null, client_name || null, client_contact || null, valid_until || null, notes || null, req.session.userId]
    );
    req.flash('success', 'Đã tạo báo giá');
    res.redirect('/quotes/' + r.rows[0].id);
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Mã báo giá đã tồn tại' : 'Lỗi: ' + err.message);
    res.redirect('/quotes/create');
  }
}
router.post('/create', requireRole('admin', 'director', 'pm'), doCreate);
router.post('/', requireRole('admin', 'director', 'pm'), doCreate);

// ── Quote detail ──────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const [quoteR, itemsR] = await Promise.all([
    query(
      `SELECT q.*, u.full_name as creator_name, p.name as project_name, ua.full_name as approver_name
       FROM quotes q
       LEFT JOIN users u ON u.id=q.created_by
       LEFT JOIN projects p ON p.id=q.project_id
       LEFT JOIN users ua ON ua.id=q.approved_by
       WHERE q.id=$1`,
      [req.params.id]
    ),
    query('SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY section, item_order, created_at', [req.params.id]),
  ]);
  if (!quoteR.rows.length) return res.redirect('/quotes');
  const sections = groupBySection(itemsR.rows);
  res.render('quotes/detail', {
    title: quoteR.rows[0].title,
    quote: quoteR.rows[0],
    items: itemsR.rows,
    sections,
  });
});

// ── Edit quote info ───────────────────────────────────────────────────────────

router.get('/:id/edit', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const [quoteR, projR] = await Promise.all([
    query('SELECT * FROM quotes WHERE id=$1', [req.params.id]),
    query('SELECT id, name FROM projects ORDER BY name'),
  ]);
  if (!quoteR.rows.length) return res.redirect('/quotes');
  res.render('quotes/form', { title: 'Chỉnh sửa Báo giá', quote: quoteR.rows[0], projects: projR.rows });
});

router.post('/:id/edit', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const { title, project_id, client_name, client_contact, valid_until, notes } = req.body;
  await query(
    `UPDATE quotes SET title=$1,project_id=$2,client_name=$3,client_contact=$4,valid_until=$5,notes=$6,updated_at=NOW() WHERE id=$7`,
    [title, project_id || null, client_name || null, client_contact || null, valid_until || null, notes || null, req.params.id]
  );
  req.flash('success', 'Đã cập nhật thông tin báo giá');
  res.redirect('/quotes/' + req.params.id);
});

// ── Status transitions ────────────────────────────────────────────────────────

router.post('/:id/status', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const { action, rejected_reason } = req.body;
  const r = await query('SELECT status FROM quotes WHERE id=$1', [req.params.id]);
  if (!r.rows.length) return res.redirect('/quotes');
  const cur = r.rows[0].status;
  const isAdminDir = ['admin', 'director'].includes(req.session.userRole);

  const transitions = {
    submit:  { from: 'draft',    to: 'pending'  },
    approve: { from: 'pending',  to: 'approved', adminOnly: true },
    reject:  { from: 'pending',  to: 'rejected', adminOnly: true },
    send:    { from: 'approved', to: 'sent',      adminOnly: true },
    win:     { from: 'sent',     to: 'won'      },
    lose:    { from: 'sent',     to: 'lost'     },
    revert:  { from: ['pending','rejected'], to: 'draft', adminOnly: true },
  };

  const t = transitions[action];
  if (!t) { req.flash('error', 'Thao tác không hợp lệ'); return res.redirect('/quotes/' + req.params.id); }
  if (t.adminOnly && !isAdminDir) { req.flash('error', 'Không đủ quyền'); return res.redirect('/quotes/' + req.params.id); }

  const validFrom = Array.isArray(t.from) ? t.from : [t.from];
  if (!validFrom.includes(cur)) { req.flash('error', 'Không thể chuyển từ trạng thái hiện tại'); return res.redirect('/quotes/' + req.params.id); }

  if (action === 'approve') {
    await query('UPDATE quotes SET status=$1,approved_by=$2,approved_at=NOW(),updated_at=NOW() WHERE id=$3', [t.to, req.session.userId, req.params.id]);
  } else if (action === 'reject') {
    await query('UPDATE quotes SET status=$1,rejected_reason=$2,updated_at=NOW() WHERE id=$3', [t.to, rejected_reason || null, req.params.id]);
  } else {
    await query('UPDATE quotes SET status=$1,updated_at=NOW() WHERE id=$2', [t.to, req.params.id]);
  }
  req.flash('success', 'Đã cập nhật trạng thái');
  res.redirect('/quotes/' + req.params.id);
});

// ── Items ─────────────────────────────────────────────────────────────────────

router.post('/:id/items', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const { description, unit, quantity, unit_price, discount_percent, notes, section, catalog_id, new_section } = req.body;
  const sec = (section === '__new__' ? (new_section || 'Chung') : section) || 'Chung';
  await query(
    `INSERT INTO quote_items (quote_id,description,unit,quantity,unit_price,discount_percent,notes,section,catalog_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [req.params.id, description, unit || null, parseFloat(quantity) || 1, parseFloat(unit_price) || 0,
      parseFloat(discount_percent) || 0, notes || null, sec, catalog_id || null]
  );
  await recalcTotal(req.params.id);
  res.redirect('/quotes/' + req.params.id);
});

router.post('/:id/items/:itemId/edit', requireRole('admin', 'director', 'pm'), async (req, res) => {
  const { description, unit, quantity, unit_price, discount_percent, notes, section, new_section } = req.body;
  const sec = (section === '__new__' ? (new_section || 'Chung') : section) || 'Chung';
  await query(
    `UPDATE quote_items SET description=$1,unit=$2,quantity=$3,unit_price=$4,discount_percent=$5,notes=$6,section=$7 WHERE id=$8`,
    [description, unit || null, parseFloat(quantity) || 1, parseFloat(unit_price) || 0,
      parseFloat(discount_percent) || 0, notes || null, sec, req.params.itemId]
  );
  await recalcTotal(req.params.id);
  res.redirect('/quotes/' + req.params.id);
});

router.post('/:id/items/:itemId/delete', requireRole('admin', 'director', 'pm'), async (req, res) => {
  await query('DELETE FROM quote_items WHERE id=$1 AND quote_id=$2', [req.params.itemId, req.params.id]);
  await recalcTotal(req.params.id);
  res.redirect('/quotes/' + req.params.id);
});

// ── Delete quote ──────────────────────────────────────────────────────────────

router.post('/:id/delete', requireRole('admin', 'director'), async (req, res) => {
  await query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
  req.flash('success', 'Đã xóa báo giá');
  res.redirect('/quotes');
});

// ── Export to Excel ───────────────────────────────────────────────────────────

router.get('/:id/export', async (req, res) => {
  const [quoteR, itemsR] = await Promise.all([
    query(
      `SELECT q.*, u.full_name as creator_name, p.name as project_name
       FROM quotes q LEFT JOIN users u ON u.id=q.created_by LEFT JOIN projects p ON p.id=q.project_id
       WHERE q.id=$1`,
      [req.params.id]
    ),
    query('SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY section, item_order, created_at', [req.params.id]),
  ]);
  if (!quoteR.rows.length) return res.redirect('/quotes');
  const q = quoteR.rows[0];
  const sections = groupBySection(itemsR.rows);

  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch (_) {
    req.flash('error', 'Chưa cài exceljs. Chạy: npm install exceljs trên server.');
    return res.redirect('/quotes/' + req.params.id);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'RIAE Management';
  wb.created = new Date();

  const BLUE   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  const LBLUE  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  const ALT    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  const TOTAL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
  const WHITE  = { bold: true, color: { argb: 'FFFFFFFF' } };
  const BOLD   = { bold: true };
  const BDR    = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const NUM    = '#,##0';
  const fmtNum = (n) => Number(n || 0);

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const ws0 = wb.addWorksheet('Tổng hợp');
  ws0.columns = [{ width: 6 }, { width: 35 }, { width: 22 }];

  ws0.mergeCells('A1:C1');
  Object.assign(ws0.getCell('A1'), {
    value: 'BÁO GIÁ: ' + q.title,
    font: { bold: true, size: 14, color: { argb: 'FF1E3A5F' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  ws0.getRow(1).height = 32;

  const info = [
    ['Mã báo giá', q.code],
    ['Khách hàng', q.client_name || ''],
    ['Liên hệ', q.client_contact || ''],
    ['Dự án', q.project_name || ''],
    ['Hiệu lực đến', q.valid_until ? new Date(q.valid_until).toLocaleDateString('vi-VN') : ''],
    ['Ngày lập', new Date(q.created_at).toLocaleDateString('vi-VN')],
    ['Người lập', q.creator_name || ''],
  ];
  info.forEach(([label, val], i) => {
    ws0.getRow(2 + i).getCell(1).value = label + ':';
    ws0.getRow(2 + i).getCell(1).font = BOLD;
    ws0.mergeCells(2 + i, 2, 2 + i, 3);
    ws0.getRow(2 + i).getCell(2).value = val;
  });

  ws0.addRow([]);
  const hRow = ws0.addRow(['STT', 'Danh mục', 'Thành tiền (đ)']);
  hRow.height = 22;
  hRow.eachCell(c => { c.fill = BLUE; c.font = WHITE; c.border = BDR; c.alignment = { horizontal: 'center', vertical: 'middle' }; });

  let grand = 0, stt = 1;
  for (const [secName, secItems] of Object.entries(sections)) {
    const sub = secItems.reduce((s, i) => s + fmtNum(i.amount), 0);
    grand += sub;
    const r = ws0.addRow([stt++, secName, sub]);
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(3).numFmt = NUM; r.getCell(3).alignment = { horizontal: 'right' };
    r.eachCell(c => { c.border = BDR; });
  }
  const tRow = ws0.addRow(['', 'TỔNG CỘNG', grand]);
  tRow.eachCell(c => { c.font = { bold: true, size: 12 }; c.fill = TOTAL; c.border = BDR; });
  tRow.getCell(2).alignment = { horizontal: 'right' };
  tRow.getCell(3).numFmt = NUM; tRow.getCell(3).alignment = { horizontal: 'right' };

  // ── Per-section sheets ─────────────────────────────────────────────────────
  for (const [secName, secItems] of Object.entries(sections)) {
    const ws = wb.addWorksheet(secName.substring(0, 31));
    ws.columns = [{ width: 5 }, { width: 42 }, { width: 8 }, { width: 8 }, { width: 18 }, { width: 7 }, { width: 20 }];

    ws.mergeCells('A1:G1');
    Object.assign(ws.getCell('A1'), {
      value: 'CHI TIẾT: ' + secName.toUpperCase(),
      font: { bold: true, size: 12, color: { argb: 'FF1E3A5F' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ws.getRow(1).height = 26;

    const h = ws.addRow(['STT', 'Mô tả / Hạng mục', 'ĐVT', 'SL', 'Đơn giá (đ)', 'CK%', 'Thành tiền (đ)']);
    h.height = 22;
    h.eachCell(c => { c.fill = BLUE; c.font = WHITE; c.border = BDR; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });

    let secTotal = 0;
    secItems.forEach((item, idx) => {
      const amt = fmtNum(item.amount);
      secTotal += amt;
      const r = ws.addRow([idx + 1, item.description, item.unit || '', fmtNum(item.quantity), fmtNum(item.unit_price), fmtNum(item.discount_percent), amt]);
      if (idx % 2 === 1) r.eachCell(c => { c.fill = ALT; });
      r.getCell(1).alignment = { horizontal: 'center' };
      r.getCell(4).numFmt = '#,##0.##';
      r.getCell(5).numFmt = NUM; r.getCell(5).alignment = { horizontal: 'right' };
      r.getCell(7).numFmt = NUM; r.getCell(7).alignment = { horizontal: 'right' };
      r.eachCell(c => { c.border = BDR; });
    });

    const tr = ws.addRow(['', '', '', '', '', 'Tổng:', secTotal]);
    tr.eachCell(c => { c.font = BOLD; c.fill = TOTAL; c.border = BDR; });
    tr.getCell(6).alignment = { horizontal: 'right' };
    tr.getCell(7).numFmt = NUM; tr.getCell(7).alignment = { horizontal: 'right' };
  }

  const filename = 'BaoGia_' + (q.code || q.id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
