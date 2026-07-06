const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);
router.use(requirePermission('chat', 'view'));

// Trang chat: danh sách phòng + khung tin nhắn của phòng đang chọn
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const rooms = await query(
      `SELECT r.*,
        (SELECT COUNT(*)::int FROM chat_messages cm
         WHERE cm.room_id=r.id AND cm.user_id != $1
           AND cm.created_at > COALESCE(m.last_read_at, '1970-01-01')) as unread,
        (SELECT content FROM chat_messages WHERE room_id=r.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM chat_rooms r
       JOIN chat_room_members m ON m.room_id=r.id AND m.user_id=$1
       ORDER BY r.created_at`,
      [userId]
    );

    let activeRoom = null, messages = [], members = [];
    const roomId = req.query.room || rooms.rows[0]?.id;
    if (roomId && rooms.rows.some(r => r.id === roomId)) {
      activeRoom = rooms.rows.find(r => r.id === roomId);
      const [msgs, mems] = await Promise.all([
        query(
          `SELECT cm.*, u.full_name, u.avatar_url FROM chat_messages cm
           JOIN users u ON u.id=cm.user_id
           WHERE cm.room_id=$1 ORDER BY cm.created_at DESC LIMIT 100`,
          [roomId]
        ),
        query(
          `SELECT u.id, u.full_name FROM chat_room_members m JOIN users u ON u.id=m.user_id
           WHERE m.room_id=$1 ORDER BY u.full_name`, [roomId]
        )
      ]);
      messages = msgs.rows.reverse();
      members = mems.rows;
      await query('UPDATE chat_room_members SET last_read_at=NOW() WHERE room_id=$1 AND user_id=$2', [roomId, userId]);
    }

    const allUsers = await query(
      'SELECT id, full_name FROM users WHERE is_active=true AND id != $1 ORDER BY full_name', [userId]);

    res.render('chat/index', {
      title: 'Chat nội bộ',
      rooms: rooms.rows,
      activeRoom, messages, members,
      allUsers: allUsers.rows
    });
  } catch (err) {
    console.error('chat:', err);
    res.redirect('/dashboard');
  }
});

// Tạo phòng chat nhóm
router.post('/rooms', requirePermission('chat', 'edit'), async (req, res) => {
  const { name } = req.body;
  let memberIds = req.body.member_ids || [];
  if (!Array.isArray(memberIds)) memberIds = [memberIds];
  if (!name?.trim()) {
    req.flash('error', 'Tên phòng là bắt buộc');
    return res.redirect('/chat');
  }
  try {
    const r = await query(
      `INSERT INTO chat_rooms (name, type, created_by) VALUES ($1,'group',$2) RETURNING id`,
      [name.trim(), req.session.userId]);
    const roomId = r.rows[0].id;
    const ids = [...new Set([req.session.userId, ...memberIds])];
    for (const uid of ids) {
      await query('INSERT INTO chat_room_members (room_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roomId, uid]);
    }
    res.redirect('/chat?room=' + roomId);
  } catch (err) {
    req.flash('error', 'Lỗi tạo phòng chat');
    res.redirect('/chat');
  }
});

// Chat riêng 1-1 (tìm phòng direct sẵn có hoặc tạo mới)
router.post('/direct', requirePermission('chat', 'edit'), async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.redirect('/chat');
  try {
    const existing = await query(
      `SELECT r.id FROM chat_rooms r
       JOIN chat_room_members a ON a.room_id=r.id AND a.user_id=$1
       JOIN chat_room_members b ON b.room_id=r.id AND b.user_id=$2
       WHERE r.type='direct' LIMIT 1`,
      [req.session.userId, user_id]);
    if (existing.rows.length) return res.redirect('/chat?room=' + existing.rows[0].id);

    const other = await query('SELECT full_name FROM users WHERE id=$1', [user_id]);
    const r = await query(
      `INSERT INTO chat_rooms (name, type, created_by) VALUES ($1,'direct',$2) RETURNING id`,
      [other.rows[0]?.full_name || 'Chat riêng', req.session.userId]);
    await query('INSERT INTO chat_room_members (room_id, user_id) VALUES ($1,$2),($1,$3)',
      [r.rows[0].id, req.session.userId, user_id]);
    res.redirect('/chat?room=' + r.rows[0].id);
  } catch (err) {
    req.flash('error', 'Lỗi tạo chat riêng');
    res.redirect('/chat');
  }
});

module.exports = router;
