const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { query } = require('../config/database');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { uploadDir } = require('../config/uploads');

router.use(requireAuth);
router.use(requirePermission('chat', 'view'));

const chatDir = uploadDir('chat');
const upload = multer({
  storage: multer.diskStorage({
    destination: chatDir,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar']
      .includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Định dạng file không hỗ trợ'), ok);
  }
});

// Trang chat: danh sách phòng + khung tin nhắn của phòng đang chọn
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const rooms = await query(
      `SELECT r.*,
        (SELECT COUNT(*)::int FROM chat_messages cm
         WHERE cm.room_id=r.id AND cm.user_id != $1
           AND cm.created_at > COALESCE(m.last_read_at, '1970-01-01')) as unread,
        (SELECT COALESCE(content, '📎 ' || file_name) FROM chat_messages WHERE room_id=r.id ORDER BY created_at DESC LIMIT 1) as last_message
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
      `SELECT id, full_name, avatar_url, department, position
       FROM users WHERE is_active=true AND id != $1 ORDER BY full_name`, [userId]);

    // Danh sách user đang online (theo kết nối socket thực tế)
    const onlineIds = Array.from((req.app.get('onlineUsers') || new Map()).keys());

    res.render('chat/index', {
      title: 'Chat nội bộ',
      rooms: rooms.rows,
      activeRoom, messages, members,
      allUsers: allUsers.rows,
      onlineIds
    });
  } catch (err) {
    console.error('chat:', err);
    res.redirect('/dashboard');
  }
});

// ===== API JSON cho popup chat (widget góc phải, chạy trên mọi trang) =====

// Danh sách nhân viên + trạng thái online (dùng cho popup chat)
router.get('/api/users', async (req, res) => {
  try {
    const userId = req.session.userId;
    const users = await query(
      `SELECT id, full_name, avatar_url, department, position
       FROM users WHERE is_active=true AND id != $1 ORDER BY full_name`, [userId]);
    const onlineIds = Array.from((req.app.get('onlineUsers') || new Map()).keys());
    res.json({ users: users.rows, onlineIds });
  } catch (err) {
    console.error('chat api users:', err.message);
    res.status(500).json({ error: 'Lỗi tải danh sách nhân viên' });
  }
});

// Bắt đầu (hoặc mở lại) chat riêng 1-1 — trả về JSON roomId cho popup
router.post('/api/direct', requirePermission('chat', 'edit'), async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Thiếu user_id' });
  try {
    const existing = await query(
      `SELECT r.id FROM chat_rooms r
       JOIN chat_room_members a ON a.room_id=r.id AND a.user_id=$1
       JOIN chat_room_members b ON b.room_id=r.id AND b.user_id=$2
       WHERE r.type='direct' LIMIT 1`,
      [req.session.userId, user_id]);
    if (existing.rows.length) return res.json({ roomId: existing.rows[0].id });

    const other = await query('SELECT full_name FROM users WHERE id=$1', [user_id]);
    if (!other.rows.length) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const r = await query(
      `INSERT INTO chat_rooms (name, type, created_by) VALUES ($1,'direct',$2) RETURNING id`,
      [other.rows[0].full_name, req.session.userId]);
    await query('INSERT INTO chat_room_members (room_id, user_id) VALUES ($1,$2),($1,$3)',
      [r.rows[0].id, req.session.userId, user_id]);
    res.json({ roomId: r.rows[0].id });
  } catch (err) {
    console.error('chat api direct:', err.message);
    res.status(500).json({ error: 'Lỗi tạo chat riêng' });
  }
});

// Gửi file đính kèm vào 1 phòng (ảnh/tài liệu) — phát realtime qua Socket.IO
router.post('/rooms/:id/upload', requirePermission('chat', 'edit'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn file' });
  try {
    const userId = req.session.userId;
    const member = await query(
      'SELECT 1 FROM chat_room_members WHERE room_id=$1 AND user_id=$2', [req.params.id, userId]);
    if (!member.rows.length) return res.status(403).json({ error: 'Không phải thành viên phòng này' });

    const r = await query(
      `INSERT INTO chat_messages (room_id, user_id, content, file_url, file_name, file_size)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, userId, (req.body.caption || '').trim().slice(0, 4000) || null,
       '/uploads/chat/' + req.file.filename, req.file.originalname, req.file.size]
    );
    const u = await query('SELECT full_name, avatar_url FROM users WHERE id=$1', [userId]);
    const message = { ...r.rows[0], full_name: u.rows[0]?.full_name, avatar_url: u.rows[0]?.avatar_url };
    req.app.get('io').to('room:' + req.params.id).emit('message:new', message);
    query('UPDATE chat_room_members SET last_read_at=NOW() WHERE room_id=$1 AND user_id=$2',
      [req.params.id, userId]).catch(() => {});
    res.json({ message });
  } catch (err) {
    console.error('chat upload:', err.message);
    res.status(500).json({ error: 'Lỗi tải file lên' });
  }
});

// Danh sách phòng + số tin chưa đọc
router.get('/api/rooms', async (req, res) => {
  try {
    const userId = req.session.userId;
    const rooms = await query(
      `SELECT r.id, r.name, r.type,
        (SELECT COUNT(*)::int FROM chat_messages cm
         WHERE cm.room_id=r.id AND cm.user_id != $1
           AND cm.created_at > COALESCE(m.last_read_at, '1970-01-01')) as unread,
        (SELECT COALESCE(content, '📎 ' || file_name) FROM chat_messages WHERE room_id=r.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM chat_rooms r
       JOIN chat_room_members m ON m.room_id=r.id AND m.user_id=$1
       ORDER BY r.created_at`, [userId]);
    res.json({ rooms: rooms.rows });
  } catch (err) {
    console.error('chat api rooms:', err.message);
    res.status(500).json({ error: 'Lỗi tải danh sách phòng' });
  }
});

// Tin nhắn của 1 phòng (kiểm tra thành viên) + đánh dấu đã đọc
router.get('/api/rooms/:id/messages', async (req, res) => {
  try {
    const userId = req.session.userId;
    const member = await query(
      'SELECT 1 FROM chat_room_members WHERE room_id=$1 AND user_id=$2', [req.params.id, userId]);
    if (!member.rows.length) return res.status(403).json({ error: 'Không phải thành viên phòng này' });
    const msgs = await query(
      `SELECT cm.id, cm.room_id, cm.user_id, cm.content, cm.file_url, cm.file_name, cm.file_size, cm.created_at, u.full_name, u.avatar_url
       FROM chat_messages cm JOIN users u ON u.id=cm.user_id
       WHERE cm.room_id=$1 ORDER BY cm.created_at DESC LIMIT 50`, [req.params.id]);
    await query('UPDATE chat_room_members SET last_read_at=NOW() WHERE room_id=$1 AND user_id=$2',
      [req.params.id, userId]);
    res.json({ messages: msgs.rows.reverse() });
  } catch (err) {
    console.error('chat api messages:', err.message);
    res.status(500).json({ error: 'Lỗi tải tin nhắn' });
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
