const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Nhóm loại thông báo theo tab (không có cột category riêng như v1 —
// suy ra nhóm từ tiền tố `type` đã dùng khi tạo thông báo trong notify()).
const TAB_TYPES = {
  work:     ['task_assigned', 'task_review', 'task_done'],
  approval: ['request_pending', 'request_approved', 'request_rejected'],
};

// ── Dropdown (AJAX) ──────────────────────────────────────────────────────────
router.get('/dropdown', async (req, res) => {
  try {
    const { tab = 'all' } = req.query;
    let sql = 'SELECT * FROM notifications WHERE user_id=$1';
    const params = [req.session.userId];
    if (TAB_TYPES[tab]) {
      params.push(TAB_TYPES[tab]);
      sql += ` AND type = ANY($${params.length})`;
    }
    sql += ' ORDER BY created_at DESC LIMIT 30';

    const [notifs, counts] = await Promise.all([
      query(sql, params),
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE type = ANY($2))::int AS work,
                COUNT(*) FILTER (WHERE type = ANY($3))::int AS approval
         FROM notifications WHERE user_id=$1 AND is_read=false`,
        [req.session.userId, TAB_TYPES.work, TAB_TYPES.approval]
      )
    ]);
    res.json({ notifications: notifs.rows, counts: counts.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Việc cần làm: tổng hợp phê duyệt đang chờ + task quá hạn của tôi ────────
router.get('/action-items', async (req, res) => {
  try {
    const userId = req.session.userId;
    const [approvals, overdue] = await Promise.all([
      query(
        `SELECT r.id, r.title, r.created_at, u.full_name AS requester_name
         FROM requests r
         JOIN request_approvals ra ON ra.request_id = r.id
         JOIN users u ON u.id = r.submitted_by
         WHERE ra.approver_id = $1 AND ra.status = 'pending' AND r.status = 'pending'
         ORDER BY r.created_at ASC LIMIT 5`, [userId]),
      query(
        `SELECT t.id, t.title, t.due_date, p.name AS project_name
         FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.assignee_id = $1 AND t.status != 'done' AND t.due_date < CURRENT_DATE
         ORDER BY t.due_date ASC LIMIT 5`, [userId])
    ]);
    const items = [
      ...approvals.rows.map(r => ({
        type: 'approval', id: r.id, title: r.title, meta: 'Gửi bởi ' + r.requester_name,
        link: '/requests/' + r.id, created_at: r.created_at
      })),
      ...overdue.rows.map(t => ({
        type: 'overdue', id: t.id, title: t.title, meta: t.project_name,
        link: '/tasks/' + t.id, created_at: t.due_date
      }))
    ];
    res.json({ items, count: items.length });
  } catch (err) { res.status(500).json({ error: err.message, items: [], count: 0 }); }
});

router.get('/unread-count', async (req, res) => {
  try {
    const r = await query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read=false',
      [req.session.userId]);
    res.json({ count: r.rows[0].count });
  } catch (err) { res.json({ count: 0 }); }
});

router.post('/:id/read', async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/read-all', async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false', [req.session.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Trang đầy đủ (xem lại lịch sử) ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const r = await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.session.userId]);
    res.render('notifications/index', { title: 'Thông báo', notifications: r.rows });
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

router.post('/mark-all-read', async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false', [req.session.userId]);
    req.flash('success', 'Đã đánh dấu tất cả là đã đọc');
  } catch (err) { req.flash('error', 'Lỗi cập nhật thông báo'); }
  res.redirect('/notifications');
});

router.get('/:id/open', async (req, res) => {
  try {
    const r = await query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING link',
      [req.params.id, req.session.userId]);
    res.redirect(r.rows[0]?.link || '/notifications');
  } catch (err) { res.redirect('/notifications'); }
});

module.exports = router;
