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

module.exports = { dropdown, markRead, markAllRead, unreadCount };
