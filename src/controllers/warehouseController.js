const { query, pool } = require('../config/database');

const index = async (req, res) => {
  try {
    const [stats, lowStock, recentTx, categories, allItems, projects, activeAssignmentsRes, overdueRes] = await Promise.all([
      query(`SELECT
        COUNT(*)::int as total_items,
        COUNT(*) FILTER (WHERE quantity > 0 AND quantity <= min_quantity)::int as low_stock,
        COUNT(*) FILTER (WHERE quantity = 0)::int as out_of_stock,
        COALESCE(SUM(quantity * unit_price), 0) as total_value,
        COUNT(DISTINCT category_id)::int as category_count
        FROM warehouse_items WHERE is_active=true`),
      query(`SELECT wi.*, wc.name as category_name
             FROM warehouse_items wi LEFT JOIN warehouse_categories wc ON wc.id=wi.category_id
             WHERE wi.quantity <= wi.min_quantity AND wi.is_active=true
             ORDER BY wi.quantity ASC LIMIT 10`),
      query(`SELECT wt.*, wi.name as item_name, wi.unit, wi.code as item_code,
                    u.full_name as performer_name, p.name as project_name
             FROM warehouse_transactions wt
             JOIN warehouse_items wi ON wi.id=wt.item_id
             LEFT JOIN users u ON u.id=wt.performed_by
             LEFT JOIN projects p ON p.id=wt.project_id
             ORDER BY wt.transaction_date DESC LIMIT 15`),
      query('SELECT * FROM warehouse_categories ORDER BY name'),
      query('SELECT wi.*, wc.name as category_name FROM warehouse_items wi LEFT JOIN warehouse_categories wc ON wc.id=wi.category_id WHERE wi.is_active=true ORDER BY wi.name'),
      query("SELECT id, name FROM projects WHERE status='active' ORDER BY name"),
      query(`SELECT COUNT(*)::int as count FROM warehouse_assignments WHERE status='active'`),
      query(`SELECT wa.*, wi.name as item_name, u.full_name as assignee_name
             FROM warehouse_assignments wa
             JOIN warehouse_items wi ON wi.id=wa.item_id
             LEFT JOIN users u ON u.id=wa.assigned_to_user
             WHERE wa.status='active' AND wa.assigned_at < NOW() - INTERVAL '30 days'
             ORDER BY wa.assigned_at ASC`)
    ]);
    res.render('warehouse/index', {
      title: 'Quản lý Kho',
      stats: stats.rows[0],
      lowStockItems: lowStock.rows,
      recentTransactions: recentTx.rows,
      categories: categories.rows,
      items: allItems.rows,
      projects: projects.rows,
      activeAssignments: activeAssignmentsRes.rows[0].count,
      overdueAssignments: overdueRes.rows
    });
  } catch (err) { console.error(err); res.redirect('/dashboard'); }
};

const items = async (req, res) => {
  try {
    const { category, search, stock_status, item_type } = req.query;
    let sql = `SELECT wi.*, wc.name as category_name,
               u.full_name as holder_name, u.avatar_url as holder_avatar,
               p.name as assigned_project_name
               FROM warehouse_items wi
               LEFT JOIN warehouse_categories wc ON wc.id=wi.category_id
               LEFT JOIN users u ON u.id=wi.assigned_to
               LEFT JOIN projects p ON p.id=wi.assigned_project_id
               WHERE wi.is_active=true`;
    const params = [];
    if (category) { params.push(category); sql += ` AND wi.category_id=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (wi.name ILIKE $${params.length} OR wi.code ILIKE $${params.length})`; }
    if (stock_status === 'low') sql += ` AND wi.quantity <= wi.min_quantity AND wi.quantity > 0`;
    if (stock_status === 'out') sql += ` AND wi.quantity = 0`;
    if (item_type) { params.push(item_type); sql += ` AND wi.item_type=$${params.length}`; }
    sql += ' ORDER BY wi.name';
    const [itemsRes, categoriesRes, usersRes, projectsRes] = await Promise.all([
      query(sql, params),
      query('SELECT * FROM warehouse_categories ORDER BY name'),
      query('SELECT id, full_name, avatar_url FROM users WHERE is_active=true ORDER BY full_name'),
      query("SELECT id, name FROM projects WHERE status='active' ORDER BY name")
    ]);
    res.render('warehouse/items', {
      title: 'Danh sách Vật tư',
      items: itemsRes.rows,
      categories: categoriesRes.rows,
      users: usersRes.rows,
      projects: projectsRes.rows,
      filters: req.query
    });
  } catch (err) { console.error(err); res.redirect('/warehouse'); }
};

const getCreateItem = async (req, res) => {
  const categories = await query('SELECT * FROM warehouse_categories ORDER BY name');
  res.render('warehouse/item-form', { title: 'Thêm Vật tư mới', item: null, categories: categories.rows });
};

const postCreateItem = async (req, res) => {
  const { code, name, description, category_id, unit, quantity, min_quantity, unit_price, location, supplier, notes, item_type } = req.body;
  try {
    const result = await query(
      `INSERT INTO warehouse_items (code,name,description,category_id,unit,quantity,min_quantity,unit_price,location,supplier,notes,item_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [code, name, description, category_id || null, unit, parseFloat(quantity) || 0,
       parseFloat(min_quantity) || 0, unit_price || null, location, supplier, notes, item_type || 'consumable']
    );
    req.flash('success', `Đã thêm vật tư "${name}"`);
    res.redirect('/warehouse/items/' + result.rows[0].id);
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Mã vật tư đã tồn tại' : 'Lỗi: ' + err.message);
    res.redirect('/warehouse/items/create');
  }
};

const itemDetail = async (req, res) => {
  try {
    const [item, txHistory, projects, categories, assignmentsRes, usersRes] = await Promise.all([
      query(`SELECT wi.*, wc.name as category_name,
             u.full_name as holder_name, u.avatar_url as holder_avatar,
             p.name as assigned_project_name
             FROM warehouse_items wi
             LEFT JOIN warehouse_categories wc ON wc.id=wi.category_id
             LEFT JOIN users u ON u.id=wi.assigned_to
             LEFT JOIN projects p ON p.id=wi.assigned_project_id
             WHERE wi.id=$1`, [req.params.id]),
      query(`SELECT wt.*, u.full_name as performer_name, p.name as project_name
             FROM warehouse_transactions wt
             LEFT JOIN users u ON u.id=wt.performed_by
             LEFT JOIN projects p ON p.id=wt.project_id
             WHERE wt.item_id=$1 ORDER BY wt.transaction_date DESC LIMIT 50`, [req.params.id]),
      query("SELECT id, name FROM projects WHERE status='active' ORDER BY name"),
      query('SELECT * FROM warehouse_categories ORDER BY name'),
      query(`SELECT wa.*, u.full_name as assignee_name, u.avatar_url as assignee_avatar,
             p.name as project_name, ab.full_name as assigner_name, rb.full_name as returner_name
             FROM warehouse_assignments wa
             LEFT JOIN users u ON u.id=wa.assigned_to_user
             LEFT JOIN projects p ON p.id=wa.assigned_to_project
             LEFT JOIN users ab ON ab.id=wa.assigned_by
             LEFT JOIN users rb ON rb.id=wa.returned_by
             WHERE wa.item_id=$1 ORDER BY wa.created_at DESC`, [req.params.id]),
      query('SELECT id, full_name, avatar_url FROM users WHERE is_active=true ORDER BY full_name')
    ]);
    if (!item.rows.length) return res.redirect('/warehouse/items');
    const activeAssignment = assignmentsRes.rows.find(a => a.status === 'active') || null;
    res.render('warehouse/item-detail', {
      title: item.rows[0].name,
      item: item.rows[0],
      transactions: txHistory.rows,
      projects: projects.rows,
      categories: categories.rows,
      assignments: assignmentsRes.rows,
      users: usersRes.rows,
      activeAssignment
    });
  } catch (err) { console.error(err); res.redirect('/warehouse/items'); }
};

const editItem = async (req, res) => {
  const { name, description, category_id, unit, min_quantity, unit_price, location, supplier, notes, item_type } = req.body;
  try {
    await query(
      `UPDATE warehouse_items SET name=$1,description=$2,category_id=$3,unit=$4,
       min_quantity=$5,unit_price=$6,location=$7,supplier=$8,notes=$9,item_type=$10,updated_at=NOW() WHERE id=$11`,
      [name, description, category_id || null, unit, parseFloat(min_quantity) || 0,
       unit_price || null, location, supplier, notes, item_type || 'consumable', req.params.id]
    );
    req.flash('success', 'Đã cập nhật thông tin vật tư');
    res.redirect('/warehouse/items/' + req.params.id);
  } catch (err) {
    req.flash('error', 'Lỗi cập nhật: ' + err.message);
    res.redirect('/warehouse/items/' + req.params.id);
  }
};

const createTransaction = async (req, res) => {
  const { item_id, transaction_type, quantity, unit_price, project_id, reference_code, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) throw new Error('Số lượng không hợp lệ');

    await client.query(
      `INSERT INTO warehouse_transactions (item_id,transaction_type,quantity,unit_price,project_id,reference_code,performed_by,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [item_id, transaction_type, qty, unit_price || null, project_id || null,
       reference_code, req.session.userId, notes]
    );

    if (transaction_type === 'import') {
      await client.query('UPDATE warehouse_items SET quantity=quantity+$1, updated_at=NOW() WHERE id=$2', [qty, item_id]);
    } else if (transaction_type === 'export') {
      const current = await client.query('SELECT quantity FROM warehouse_items WHERE id=$1', [item_id]);
      if (current.rows[0].quantity < qty) throw new Error('Số lượng xuất vượt quá tồn kho');
      await client.query('UPDATE warehouse_items SET quantity=quantity-$1, updated_at=NOW() WHERE id=$2', [qty, item_id]);
    } else if (transaction_type === 'adjust') {
      await client.query('UPDATE warehouse_items SET quantity=$1, updated_at=NOW() WHERE id=$2', [qty, item_id]);
    }

    await client.query('COMMIT');
    req.flash('success', `Đã ghi nhận ${transaction_type === 'import' ? 'nhập' : transaction_type === 'export' ? 'xuất' : 'điều chỉnh'} kho`);
    res.redirect('/warehouse/items/' + item_id);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', 'Lỗi giao dịch: ' + err.message);
    res.redirect('back');
  } finally { client.release(); }
};

const createAssignment = async (req, res) => {
  const { item_id, assignment_type, assigned_to_project, quantity, notes } = req.body;
  const assigned_to_user = assignment_type === 'project'
    ? (req.body.project_user_id || null)
    : (Array.isArray(req.body.assigned_to_user) ? req.body.assigned_to_user.find(v => v) : req.body.assigned_to_user) || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qty = parseFloat(quantity) || 1;

    const itemRes = await client.query('SELECT * FROM warehouse_items WHERE id=$1', [item_id]);
    if (!itemRes.rows.length) throw new Error('Vật tư không tồn tại');
    const item = itemRes.rows[0];

    if (item.item_type === 'tool' || item.item_type === 'asset') {
      if (item.item_status !== 'available') throw new Error('Vật tư này hiện không sẵn sàng để giao');
    } else {
      if (item.quantity < qty) throw new Error('Số lượng không đủ trong kho');
    }

    const assignRes = await client.query(
      `INSERT INTO warehouse_assignments
       (item_id, assignment_type, assigned_to_user, assigned_to_project, quantity, notes, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [item_id, assignment_type, assigned_to_user || null, assigned_to_project || null,
       qty, notes || null, req.session.userId]
    );
    const newAssignmentId = assignRes.rows[0].id;

    if (item.item_type === 'tool' || item.item_type === 'asset') {
      await client.query(
        `UPDATE warehouse_items SET item_status='in_use', assigned_to=$1, assigned_project_id=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$3`,
        [assigned_to_user || null, assigned_to_project || null, item_id]
      );
    } else {
      await client.query(
        'UPDATE warehouse_items SET quantity=quantity-$1, updated_at=NOW() WHERE id=$2',
        [qty, item_id]
      );
    }

    await client.query(
      `INSERT INTO warehouse_transactions (item_id, transaction_type, quantity, project_id, performed_by, notes, assignment_id)
       VALUES ($1,'export',$2,$3,$4,$5,$6)`,
      [item_id, qty, assigned_to_project || null, req.session.userId, notes || null, newAssignmentId]
    );

    await client.query('COMMIT');

    try {
      if (assigned_to_user) {
        await query(
          `INSERT INTO notifications (user_id, title, message, type, link)
           VALUES ($1,$2,$3,'warehouse',$4)`,
          [assigned_to_user, 'Bạn được giao vật tư', `Bạn được giao ${item.name}`, `/warehouse/assignments/${newAssignmentId}`]
        );
      }
    } catch (notifErr) { console.error('Notification error:', notifErr.message); }

    res.redirect('/warehouse/assignments/' + newAssignmentId);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', 'Lỗi giao vật tư: ' + err.message);
    res.redirect('back');
  } finally { client.release(); }
};

const returnAssignment = async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const assignRes = await client.query(
      `SELECT wa.*, wi.item_type, wi.name as item_name
       FROM warehouse_assignments wa
       JOIN warehouse_items wi ON wi.id=wa.item_id
       WHERE wa.id=$1`, [id]
    );
    if (!assignRes.rows.length) throw new Error('Phiếu giao không tồn tại');
    const assignment = assignRes.rows[0];

    await client.query(
      `UPDATE warehouse_assignments SET status='returned', returned_at=NOW(), returned_by=$1 WHERE id=$2`,
      [req.session.userId, id]
    );

    if (assignment.item_type === 'tool' || assignment.item_type === 'asset') {
      await client.query(
        `UPDATE warehouse_items SET item_status='available', assigned_to=NULL, assigned_project_id=NULL, assigned_at=NULL, updated_at=NOW() WHERE id=$1`,
        [assignment.item_id]
      );
    }

    await client.query(
      `INSERT INTO warehouse_transactions (item_id, transaction_type, quantity, performed_by, notes, assignment_id)
       VALUES ($1,'adjust',$2,$3,$4,$5)`,
      [assignment.item_id, assignment.quantity, req.session.userId, notes || 'Thu hồi vật tư', id]
    );

    await client.query('COMMIT');

    try {
      if (assignment.assigned_by) {
        await query(
          `INSERT INTO notifications (user_id, title, message, type, link)
           VALUES ($1,$2,$3,'warehouse',$4)`,
          [assignment.assigned_by, 'Vật tư đã được trả', `${assignment.item_name} đã được thu hồi`, `/warehouse/assignments/${id}`]
        );
      }
    } catch (notifErr) { console.error('Notification error:', notifErr.message); }

    res.redirect('/warehouse/assignments/' + id);
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', 'Lỗi thu hồi: ' + err.message);
    res.redirect('back');
  } finally { client.release(); }
};

const signAssignment = async (req, res) => {
  const { id } = req.params;
  const { signature_data } = req.body;
  try {
    await query(
      `UPDATE warehouse_assignments SET signature_data=$1, signed_at=NOW(), signed_ip=$2 WHERE id=$3`,
      [signature_data, req.ip, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
};

const assignments = async (req, res) => {
  try {
    const { status = 'active', search } = req.query;
    let sql = `SELECT wa.*, wi.name as item_name, wi.code as item_code, wi.item_type,
               u.full_name as assignee_name, u.avatar_url as assignee_avatar,
               p.name as project_name, ab.full_name as assigner_name
               FROM warehouse_assignments wa
               JOIN warehouse_items wi ON wi.id=wa.item_id
               LEFT JOIN users u ON u.id=wa.assigned_to_user
               LEFT JOIN projects p ON p.id=wa.assigned_to_project
               LEFT JOIN users ab ON ab.id=wa.assigned_by
               WHERE 1=1`;
    const params = [];
    if (status && status !== 'all') { params.push(status); sql += ` AND wa.status=$${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (wi.name ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`;
    }
    sql += ' ORDER BY wa.assigned_at DESC LIMIT 200';

    const [assignmentsRes, activeRes, overdueRes, returnedMonthRes] = await Promise.all([
      query(sql, params),
      query(`SELECT COUNT(*)::int as count FROM warehouse_assignments WHERE status='active'`),
      query(`SELECT COUNT(*)::int as count FROM warehouse_assignments WHERE status='active' AND assigned_at < NOW() - INTERVAL '30 days'`),
      query(`SELECT COUNT(*)::int as count FROM warehouse_assignments WHERE status='returned' AND returned_at >= date_trunc('month', NOW())`)
    ]);

    res.render('warehouse/assignments', {
      title: 'Phiếu Giao Vật tư',
      assignments: assignmentsRes.rows,
      activeCount: activeRes.rows[0].count,
      overdueCount: overdueRes.rows[0].count,
      returnedThisMonthCount: returnedMonthRes.rows[0].count,
      filters: req.query
    });
  } catch (err) { console.error(err); res.redirect('/warehouse'); }
};

const assignmentDetail = async (req, res) => {
  try {
    const result = await query(
      `SELECT wa.*, wi.name as item_name, wi.code as item_code, wi.unit, wi.item_type, wi.item_status,
       u.full_name as assignee_name, u.avatar_url as assignee_avatar,
       p.name as project_name, ab.full_name as assigner_name, rb.full_name as returner_name
       FROM warehouse_assignments wa
       JOIN warehouse_items wi ON wi.id=wa.item_id
       LEFT JOIN users u ON u.id=wa.assigned_to_user
       LEFT JOIN projects p ON p.id=wa.assigned_to_project
       LEFT JOIN users ab ON ab.id=wa.assigned_by
       LEFT JOIN users rb ON rb.id=wa.returned_by
       WHERE wa.id=$1`, [req.params.id]
    );
    if (!result.rows.length) return res.redirect('/warehouse/assignments');
    res.render('warehouse/assignment-detail', {
      title: 'Chi tiết Phiếu giao',
      assignment: result.rows[0]
    });
  } catch (err) { console.error(err); res.redirect('/warehouse/assignments'); }
};

const transactions = async (req, res) => {
  try {
    const { type, from_date, to_date } = req.query;
    let sql = `SELECT wt.*, wi.name as item_name, wi.unit, wi.code as item_code,
               u.full_name as performer_name, p.name as project_name
               FROM warehouse_transactions wt
               JOIN warehouse_items wi ON wi.id=wt.item_id
               LEFT JOIN users u ON u.id=wt.performed_by
               LEFT JOIN projects p ON p.id=wt.project_id
               WHERE 1=1`;
    const params = [];
    if (type) { params.push(type); sql += ` AND wt.transaction_type=$${params.length}`; }
    if (from_date) { params.push(from_date); sql += ` AND wt.transaction_date::date>=$${params.length}`; }
    if (to_date) { params.push(to_date); sql += ` AND wt.transaction_date::date<=$${params.length}`; }
    sql += ' ORDER BY wt.transaction_date DESC LIMIT 200';
    const result = await query(sql, params);
    res.render('warehouse/transactions', {
      title: 'Lịch sử Xuất/Nhập kho',
      transactions: result.rows,
      filters: req.query
    });
  } catch (err) { console.error(err); res.redirect('/warehouse'); }
};

module.exports = {
  index, items, getCreateItem, postCreateItem, itemDetail, editItem,
  createTransaction, transactions,
  createAssignment, returnAssignment, signAssignment, assignments, assignmentDetail
};
