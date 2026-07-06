const { query, pool } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const STATUS_LABELS = { draft: 'Nháp', sent: 'Đã gửi', approved: 'Chốt', rejected: 'Từ chối' };

const index = async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `SELECT q.*, u.full_name as creator_name, p.name as project_name,
               (SELECT COUNT(*)::int FROM quote_items WHERE quote_id=q.id) as item_count
               FROM quotes q
               LEFT JOIN users u ON u.id=q.created_by
               LEFT JOIN projects p ON p.id=q.project_id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND q.status=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (q.title ILIKE $${params.length} OR q.code ILIKE $${params.length} OR q.client_name ILIKE $${params.length})`; }
    sql += ' ORDER BY q.created_at DESC';
    const [quotes, stats] = await Promise.all([
      query(sql, params),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='approved')::int as approved,
             COALESCE(SUM(total_amount) FILTER (WHERE status='approved'),0) as approved_value
             FROM quotes`)
    ]);
    const permLevel = await getPermLevel(req.session.userRole, 'quotes');
    res.render('quotes/index', {
      title: 'Báo giá',
      quotes: quotes.rows,
      stats: stats.rows[0],
      statusLabels: STATUS_LABELS,
      filters: req.query,
      permLevel
    });
  } catch (err) { console.error('quotes:', err); res.redirect('/dashboard'); }
};

const getForm = async (req, res) => {
  try {
    const [projects, quote, items] = await Promise.all([
      query(`SELECT id, code, name FROM projects WHERE status NOT IN ('completed','cancelled') ORDER BY name`),
      req.params.id ? query('SELECT * FROM quotes WHERE id=$1', [req.params.id]) : Promise.resolve({ rows: [null] }),
      req.params.id ? query('SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY item_order', [req.params.id]) : Promise.resolve({ rows: [] })
    ]);
    if (req.params.id && !quote.rows[0]) return res.redirect('/quotes');
    res.render('quotes/form', {
      title: quote.rows[0] ? 'Sửa báo giá ' + quote.rows[0].code : 'Tạo báo giá mới',
      quote: quote.rows[0],
      items: items.rows,
      projects: projects.rows
    });
  } catch (err) { console.error(err); res.redirect('/quotes'); }
};

// Lưu báo giá + toàn bộ dòng hàng trong 1 transaction
const save = async (req, res) => {
  const { id, code, title, project_id, client_name, client_contact, valid_until, notes, status } = req.body;
  const arr = v => v === undefined ? [] : (Array.isArray(v) ? v : [v]);
  const descs = arr(req.body.item_desc), units = arr(req.body.item_unit),
        qtys = arr(req.body.item_qty), prices = arr(req.body.item_price), discs = arr(req.body.item_disc);
  if (!code?.trim() || !title?.trim()) {
    req.flash('error', 'Mã và tiêu đề báo giá là bắt buộc');
    return res.redirect(id ? `/quotes/${id}/edit` : '/quotes/create');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let quoteId = id;
    const vals = [code.trim().toUpperCase(), title.trim(), project_id || null, client_name || null,
                  client_contact || null, valid_until || null, notes || null,
                  ['draft', 'sent', 'approved', 'rejected'].includes(status) ? status : 'draft'];
    if (id) {
      await client.query(
        `UPDATE quotes SET code=$1,title=$2,project_id=$3,client_name=$4,client_contact=$5,
         valid_until=$6,notes=$7,status=$8,updated_at=NOW() WHERE id=$9`, [...vals, id]);
      await client.query('DELETE FROM quote_items WHERE quote_id=$1', [id]);
    } else {
      const r = await client.query(
        `INSERT INTO quotes (code,title,project_id,client_name,client_contact,valid_until,notes,status,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [...vals, req.session.userId]);
      quoteId = r.rows[0].id;
    }
    for (let i = 0; i < descs.length; i++) {
      if (!descs[i]?.trim()) continue;
      await client.query(
        `INSERT INTO quote_items (quote_id, item_order, description, unit, quantity, unit_price, discount_percent)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [quoteId, i, descs[i].trim(), units[i] || null,
         parseFloat(qtys[i]) || 1, parseFloat(prices[i]) || 0,
         Math.min(Math.max(parseFloat(discs[i]) || 0, 0), 100)]
      );
    }
    await client.query(
      `UPDATE quotes SET total_amount = COALESCE((SELECT SUM(amount) FROM quote_items WHERE quote_id=$1),0) WHERE id=$1`,
      [quoteId]);
    await client.query('COMMIT');
    logActivity(req.session.userId, id ? 'QUOTE_UPDATE' : 'QUOTE_CREATE',
      `${id ? 'Cập nhật' : 'Tạo'} báo giá ${code.trim().toUpperCase()}: ${title.trim()}`,
      { entityType: 'quote', entityId: quoteId, ip: req.ip });
    req.flash('success', `Đã lưu báo giá ${code.trim().toUpperCase()}`);
    res.redirect('/quotes/' + quoteId);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.code === '23505' ? 'Mã báo giá đã tồn tại' : 'Lỗi lưu báo giá');
    res.redirect(id ? `/quotes/${id}/edit` : '/quotes/create');
  } finally { client.release(); }
};

const detail = async (req, res) => {
  try {
    const [quote, items] = await Promise.all([
      query(`SELECT q.*, u.full_name as creator_name, p.name as project_name, p.code as project_code
             FROM quotes q LEFT JOIN users u ON u.id=q.created_by
             LEFT JOIN projects p ON p.id=q.project_id WHERE q.id=$1`, [req.params.id]),
      query('SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY item_order', [req.params.id])
    ]);
    if (!quote.rows.length) return res.redirect('/quotes');
    const permLevel = await getPermLevel(req.session.userRole, 'quotes');
    res.render('quotes/detail', {
      title: quote.rows[0].code + ' — ' + quote.rows[0].title,
      quote: quote.rows[0],
      items: items.rows,
      statusLabels: STATUS_LABELS,
      permLevel
    });
  } catch (err) { console.error(err); res.redirect('/quotes'); }
};

const setStatus = async (req, res) => {
  const { status } = req.body;
  if (!['draft', 'sent', 'approved', 'rejected'].includes(status)) return res.redirect('/quotes/' + req.params.id);
  try {
    await query('UPDATE quotes SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.id]);
    req.flash('success', 'Đã chuyển trạng thái: ' + STATUS_LABELS[status]);
  } catch (err) { req.flash('error', 'Lỗi cập nhật trạng thái'); }
  res.redirect('/quotes/' + req.params.id);
};

module.exports = { index, getForm, save, detail, setStatus };
