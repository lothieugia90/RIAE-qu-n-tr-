const { query } = require('../config/database');

const dropdown = async (req, res) => {
  try {
    const { tab = 'all' } = req.query;
    let sql = `SELECT * FROM notifications WHERE user_id=$1`;
    const params = [req.session.userId];
    if (tab === 'work')     sql += ` AND category='work'`;
    if (tab === 'personal') sql += ` AND category='personal'`;
    sql += ` ORDER BY created_at DESC LIMIT 30`;

    const [notifs, counts] = await Promise.all([
      query(sql, params),
      query(`SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE category='work')::int as work,
        COUNT(*) FILTER (WHERE category='personal')::int as personal
        FROM notifications WHERE user_id=$1 AND is_read=false`,
        [req.session.userId])
    ]);

    res.json({ notifications: notifs.rows, counts: counts.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const markRead = async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read=true, read_at=NOW() WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.session.userId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const markAllRead = async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read=true, read_at=NOW() WHERE user_id=$1 AND is_read=false`,
      [req.session.userId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const unreadCount = async (req, res) => {
  try {
    const r = await query(
      `SELECT COUNT(*)::int as count FROM notifications WHERE user_id=$1 AND is_read=false`,
      [req.session.userId]
    );
    res.json({ count: r.rows[0].count });
  } catch (err) { res.json({ count: 0 }); }
};

const actionItems = async (req, res) => {
  try {
    const userId = req.session.userId;
    const role = req.session.userRole;
    const isWarehouse = ['admin','director','warehouse','warehouse_keeper'].includes(role);

    const [approvals, signatures, returns, approved] = await Promise.all([
      query(`SELECT r.id, r.title, r.created_at, u.full_name as requester_name
        FROM requests r
        JOIN request_approvals ra ON ra.request_id = r.id
        JOIN users u ON u.id = r.submitted_by
        WHERE ra.approver_id = $1 AND ra.status = 'pending' AND r.status = 'pending'
        ORDER BY r.created_at ASC LIMIT 5`, [userId]),

      query(`SELECT wa.id, wi.name as item_name, wa.quantity, wi.unit, wa.assigned_at
        FROM warehouse_assignments wa
        JOIN warehouse_items wi ON wi.id = wa.item_id
        WHERE wa.assigned_to_user = $1 AND wa.status = 'active' AND wa.signed_at IS NULL
        ORDER BY wa.assigned_at DESC LIMIT 5`, [userId]),

      isWarehouse ? query(`SELECT wa.id, wi.name as item_name, wa.quantity, wi.unit,
               u.full_name as assignee_name, wa.return_requested_at
        FROM warehouse_assignments wa
        JOIN warehouse_items wi ON wi.id = wa.item_id
        LEFT JOIN users u ON u.id = wa.assigned_to_user
        WHERE wa.status = 'pending_return'
        ORDER BY wa.return_requested_at ASC LIMIT 5`) : { rows: [] },

      query(`SELECT r.id, r.title, r.updated_at
        FROM requests r
        WHERE r.submitted_by = $1 AND r.status = 'approved' AND r.updated_at > NOW() - INTERVAL '7 days'
        ORDER BY r.updated_at DESC LIMIT 5`, [userId])
    ]);

    const items = [
      ...approvals.rows.map(r => ({ type: 'approval', id: r.id, title: r.title, meta: r.requester_name, link: '/requests/' + r.id, created_at: r.created_at })),
      ...signatures.rows.map(wa => ({ type: 'signature', id: wa.id, title: wa.item_name, meta: wa.quantity + ' ' + wa.unit, link: '/warehouse/assignments/' + wa.id, created_at: wa.assigned_at })),
      ...returns.rows.map(wa => ({ type: 'return', id: wa.id, title: wa.item_name, meta: wa.assignee_name, link: '/signatures/warehouse-return/' + wa.id, created_at: wa.return_requested_at })),
      ...approved.rows.map(r => ({ type: 'approved', id: r.id, title: r.title, meta: new Date(r.updated_at).toLocaleDateString('vi-VN'), link: '/requests/' + r.id, created_at: r.updated_at }))
    ];

    res.json({ items, count: items.length });
  } catch (err) { res.status(500).json({ error: err.message, items: [], count: 0 }); }
};

module.exports = { dropdown, markRead, markAllRead, unreadCount, actionItems };
