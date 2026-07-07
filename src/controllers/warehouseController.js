const { query, pool } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const index = async (req, res) => {
  try {
    const { category, search, low } = req.query;
    let sql = `SELECT wi.*, wc.name as category_name
               FROM warehouse_items wi
               LEFT JOIN warehouse_categories wc ON wc.id = wi.category_id
               WHERE wi.is_active = true`;
    const params = [];
    if (category) { params.push(category); sql += ` AND wi.category_id=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (wi.name ILIKE $${params.length} OR wi.code ILIKE $${params.length})`; }
    if (low === '1') sql += ` AND wi.quantity <= wi.min_quantity`;
    sql += ' ORDER BY wi.name';

    const [items, categories, stats] = await Promise.all([
      query(sql, params),
      query('SELECT * FROM warehouse_categories ORDER BY name'),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE quantity <= min_quantity)::int as low_stock,
             COALESCE(SUM(quantity * COALESCE(unit_price,0)),0) as total_value
             FROM warehouse_items WHERE is_active=true`)
    ]);
    const permLevel = await getPermLevel(req.session.userRole, 'warehouse');
    res.render('warehouse/index', {
      title: 'Kho vật tư',
      items: items.rows,
      categories: categories.rows,
      stats: stats.rows[0],
      filters: req.query,
      permLevel
    });
  } catch (err) {
    console.error('warehouse index:', err);
    req.flash('error', 'Lỗi tải kho vật tư');
    res.redirect('/dashboard');
  }
};

const saveItem = async (req, res) => {
  const { id, code, name, description, category_id, unit, min_quantity, unit_price, location, supplier, notes } = req.body;
  if (!code?.trim() || !name?.trim() || !unit?.trim()) {
    req.flash('error', 'Mã, tên và đơn vị tính là bắt buộc');
    return res.redirect('/warehouse');
  }
  try {
    if (id) {
      await query(
        `UPDATE warehouse_items SET code=$1,name=$2,description=$3,category_id=$4,unit=$5,
         min_quantity=$6,unit_price=$7,location=$8,supplier=$9,notes=$10,updated_at=NOW() WHERE id=$11`,
        [code.trim().toUpperCase(), name.trim(), description || null, category_id || null, unit.trim(),
         min_quantity || 0, unit_price || null, location || null, supplier || null, notes || null, id]
      );
      req.flash('success', `Đã cập nhật vật tư ${name.trim()}`);
    } else {
      await query(
        `INSERT INTO warehouse_items (code,name,description,category_id,unit,min_quantity,unit_price,location,supplier,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [code.trim().toUpperCase(), name.trim(), description || null, category_id || null, unit.trim(),
         min_quantity || 0, unit_price || null, location || null, supplier || null, notes || null]
      );
      logActivity(req.session.userId, 'WAREHOUSE_ITEM_CREATE', `Thêm vật tư: ${name.trim()}`, { ip: req.ip });
      req.flash('success', `Đã thêm vật tư ${name.trim()}`);
    }
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Mã vật tư đã tồn tại' : 'Lỗi lưu vật tư');
  }
  res.redirect('/warehouse');
};

// Nhập/xuất/điều chỉnh kho — cập nhật tồn trong 1 transaction, khóa dòng để chống race
const createTransaction = async (req, res) => {
  const { item_id, transaction_type, quantity, unit_price, project_id, reference_code, notes } = req.body;
  const qty = parseFloat(quantity);
  if (!item_id || !['import', 'export', 'adjust'].includes(transaction_type) || !qty || qty <= 0) {
    req.flash('error', 'Dữ liệu phiếu không hợp lệ');
    return res.redirect('/warehouse');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemRes = await client.query('SELECT * FROM warehouse_items WHERE id=$1 FOR UPDATE', [item_id]);
    if (!itemRes.rows.length) throw new Error('Không tìm thấy vật tư');
    const item = itemRes.rows[0];

    let newQty;
    if (transaction_type === 'import') newQty = parseFloat(item.quantity) + qty;
    else if (transaction_type === 'export') {
      newQty = parseFloat(item.quantity) - qty;
      if (newQty < 0) throw new Error(`Tồn kho không đủ (hiện còn ${item.quantity} ${item.unit})`);
    } else newQty = qty; // adjust = đặt lại số tồn

    await client.query('UPDATE warehouse_items SET quantity=$1, updated_at=NOW() WHERE id=$2', [newQty, item_id]);
    await client.query(
      `INSERT INTO warehouse_transactions (item_id, transaction_type, quantity, unit_price, project_id, reference_code, performed_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [item_id, transaction_type, qty, unit_price || null, project_id || null,
       reference_code || null, req.session.userId, notes || null]
    );
    await client.query('COMMIT');

    const typeLabel = { import: 'Nhập kho', export: 'Xuất kho', adjust: 'Điều chỉnh' }[transaction_type];
    logActivity(req.session.userId, 'WAREHOUSE_TX', `${typeLabel} ${qty} ${item.unit} — ${item.name} (tồn: ${newQty})`,
      { entityType: 'warehouse_item', entityId: item_id, ip: req.ip });
    req.flash('success', `${typeLabel} thành công — ${item.name}: ${newQty} ${item.unit}`);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message);
  } finally { client.release(); }
  res.redirect('/warehouse');
};

const transactions = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPage = 50;
    const [txs, total] = await Promise.all([
      query(
        `SELECT wt.*, wi.name as item_name, wi.code as item_code, wi.unit,
                u.full_name as performer_name, p.name as project_name
         FROM warehouse_transactions wt
         JOIN warehouse_items wi ON wi.id = wt.item_id
         LEFT JOIN users u ON u.id = wt.performed_by
         LEFT JOIN projects p ON p.id = wt.project_id
         ORDER BY wt.created_at DESC LIMIT $1 OFFSET $2`,
        [perPage, (page - 1) * perPage]
      ),
      query('SELECT COUNT(*)::int as c FROM warehouse_transactions')
    ]);
    res.render('warehouse/transactions', {
      title: 'Lịch sử Nhập/Xuất kho',
      transactions: txs.rows,
      page,
      totalPages: Math.max(Math.ceil(total.rows[0].c / perPage), 1)
    });
  } catch (err) { console.error(err); res.redirect('/warehouse'); }
};

const saveCategory = async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.redirect('/warehouse');
  try {
    await query('INSERT INTO warehouse_categories (name) VALUES ($1) ON CONFLICT DO NOTHING', [name.trim()]);
    req.flash('success', `Đã thêm danh mục "${name.trim()}"`);
  } catch (err) { req.flash('error', 'Lỗi thêm danh mục'); }
  res.redirect('/warehouse');
};

module.exports = { index, saveItem, createTransaction, transactions, saveCategory };
