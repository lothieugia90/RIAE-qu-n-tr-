const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { requireAuth } = require('../middleware/auth');
const { query }       = require('../config/database');
const multer  = require('multer');

router.use(requireAuth);

// ─── file upload for chat ────────────────────────────────────────────────────
const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/chat');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|zip|mp3|ogg|wav|mp4|webm)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────────
async function getRoomsForUser(userId) {
  return query(
    `SELECT cr.*,
       crm.last_read_at,
       (SELECT cm.content  FROM chat_messages cm WHERE cm.room_id=cr.id AND cm.is_deleted=false ORDER BY created_at DESC LIMIT 1) as last_message,
       (SELECT cm.message_type FROM chat_messages cm WHERE cm.room_id=cr.id ORDER BY created_at DESC LIMIT 1) as last_type,
       (SELECT cm.created_at FROM chat_messages cm WHERE cm.room_id=cr.id ORDER BY created_at DESC LIMIT 1) as last_at,
       (SELECT u2.full_name FROM chat_room_members crm2 JOIN users u2 ON u2.id=crm2.user_id
        WHERE crm2.room_id=cr.id AND crm2.user_id != $1 LIMIT 1) as other_name,
       (SELECT u2.avatar_url FROM chat_room_members crm2 JOIN users u2 ON u2.id=crm2.user_id
        WHERE crm2.room_id=cr.id AND crm2.user_id != $1 LIMIT 1) as other_avatar,
       (SELECT u2.last_seen_at FROM chat_room_members crm2 JOIN users u2 ON u2.id=crm2.user_id
        WHERE crm2.room_id=cr.id AND crm2.user_id != $1 LIMIT 1) as other_seen_at,
       (SELECT COUNT(*)::int FROM chat_messages cm
        WHERE cm.room_id=cr.id AND cm.is_deleted=false
          AND cm.created_at > COALESCE(crm.last_read_at,'1970-01-01')
          AND cm.user_id != $1) as unread_count
     FROM chat_rooms cr
     JOIN chat_room_members crm ON crm.room_id=cr.id AND crm.user_id=$1
     ORDER BY last_at DESC NULLS LAST, cr.created_at DESC`,
    [userId]
  );
}

// ─── / (index — redirect to first room or show empty state) ─────────────────
router.get('/', async (req, res) => {
  const [roomsRes, usersRes] = await Promise.all([
    getRoomsForUser(req.session.userId),
    query(
      `SELECT u.id, u.full_name, u.role, u.department, u.avatar_url, u.last_seen_at
       FROM users u WHERE u.is_active=true AND u.id != $1 ORDER BY u.full_name`,
      [req.session.userId]
    )
  ]);
  res.render('chat/index', {
    title: 'Chat Nội bộ',
    rooms: roomsRes.rows,
    users: usersRes.rows,
    activeRoom: null,
    messages: [],
    members: [],
    currentUserId: req.session.userId,
    currentUserName: res.locals.currentUser ? res.locals.currentUser.full_name : ''
  });
});

// ─── create room ──────────────────────────────────────────────────────────────
router.post('/rooms', async (req, res) => {
  const { name, type, user_id, description } = req.body;
  try {
    // For DM: check if room already exists
    if (type === 'direct' && user_id) {
      const existing = await query(
        `SELECT cr.id FROM chat_rooms cr
         WHERE cr.type='direct'
           AND EXISTS (SELECT 1 FROM chat_room_members WHERE room_id=cr.id AND user_id=$1)
           AND EXISTS (SELECT 1 FROM chat_room_members WHERE room_id=cr.id AND user_id=$2)`,
        [req.session.userId, user_id]
      );
      if (existing.rows.length) return res.redirect('/chat/' + existing.rows[0].id);
    }
    const r = await query(
      'INSERT INTO chat_rooms (name, type, description, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
      [name || 'Nhóm mới', type || 'group', description || null, req.session.userId]
    );
    const roomId = r.rows[0].id;
    await query('INSERT INTO chat_room_members (room_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [roomId, req.session.userId, 'admin']);
    if (user_id) {
      const ids = Array.isArray(user_id) ? user_id : [user_id];
      for (const uid of ids) {
        await query('INSERT INTO chat_room_members (room_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roomId, uid]);
      }
    }
    res.redirect('/chat/' + roomId);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi tạo phòng chat');
    res.redirect('/chat');
  }
});

// ─── room view ────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const [roomRes, messagesRes, roomsRes, membersRes, usersRes] = await Promise.all([
    query('SELECT * FROM chat_rooms WHERE id=$1', [req.params.id]),
    query(
      `SELECT cm.*, u.full_name, u.avatar_url,
              r.content as reply_content, ru.full_name as reply_author
       FROM chat_messages cm
       JOIN users u ON u.id=cm.user_id
       LEFT JOIN chat_messages r  ON r.id=cm.reply_to
       LEFT JOIN users ru ON ru.id=r.user_id
       WHERE cm.room_id=$1 AND cm.is_deleted=false
       ORDER BY cm.created_at DESC LIMIT 60`,
      [req.params.id]
    ),
    getRoomsForUser(req.session.userId),
    query(
      `SELECT u.id, u.full_name, u.role, u.department, u.avatar_url, u.last_seen_at, crm.role as room_role
       FROM chat_room_members crm JOIN users u ON u.id=crm.user_id
       WHERE crm.room_id=$1 ORDER BY u.full_name`,
      [req.params.id]
    ),
    query(
      `SELECT u.id, u.full_name FROM users u WHERE u.is_active=true AND u.id != $1
       AND u.id NOT IN (SELECT user_id FROM chat_room_members WHERE room_id=$2)
       ORDER BY u.full_name`,
      [req.session.userId, req.params.id]
    )
  ]);
  if (!roomRes.rows.length) return res.redirect('/chat');
  // Mark as read
  await query(
    'INSERT INTO chat_room_members (room_id,user_id,last_read_at) VALUES ($1,$2,NOW()) ON CONFLICT (room_id,user_id) DO UPDATE SET last_read_at=NOW()',
    [req.params.id, req.session.userId]
  );
  res.render('chat/index', {
    title: roomRes.rows[0].name,
    rooms: roomsRes.rows,
    users: usersRes.rows,
    activeRoom: roomRes.rows[0],
    messages: messagesRes.rows.reverse(),
    members: membersRes.rows,
    currentUserId: req.session.userId,
    currentUserName: res.locals.currentUser ? res.locals.currentUser.full_name : ''
  });
});

// ─── load more messages (pagination) ─────────────────────────────────────────
router.get('/:id/messages', async (req, res) => {
  const before = req.query.before || new Date().toISOString();
  const limit  = parseInt(req.query.limit) || 30;
  const msgs = await query(
    `SELECT cm.*, u.full_name, u.avatar_url,
            r.content as reply_content, ru.full_name as reply_author
     FROM chat_messages cm JOIN users u ON u.id=cm.user_id
     LEFT JOIN chat_messages r ON r.id=cm.reply_to LEFT JOIN users ru ON ru.id=r.user_id
     WHERE cm.room_id=$1 AND cm.is_deleted=false AND cm.created_at < $2
     ORDER BY cm.created_at DESC LIMIT $3`,
    [req.params.id, before, limit]
  );
  res.json({ messages: msgs.rows.reverse() });
});

// ─── send text message (REST fallback, Socket.io is primary) ─────────────────
router.post('/:id/messages', async (req, res) => {
  const { content, reply_to } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Empty' });
  const r = await query(
    `INSERT INTO chat_messages (room_id,user_id,content,reply_to) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, req.session.userId, content.trim(), reply_to || null]
  );
  const msg = r.rows[0];

  // Also broadcast via socket so other users get it in real-time
  const userR = await query('SELECT full_name, avatar_url FROM users WHERE id=$1', [req.session.userId]);
  const sender = userR.rows[0] || {};
  const payload = { ...msg, full_name: sender.full_name, avatar_url: sender.avatar_url, reply_content: null, reply_author: null };
  if (reply_to) {
    const orig = await query('SELECT cm.content, u.full_name FROM chat_messages cm JOIN users u ON u.id=cm.user_id WHERE cm.id=$1', [reply_to]);
    if (orig.rows[0]) { payload.reply_content = orig.rows[0].content; payload.reply_author = orig.rows[0].full_name; }
  }
  req.app.get('io')?.to('room:' + req.params.id).emit('message:new', payload);

  res.json({ message: payload });
});

// ─── upload file/image ────────────────────────────────────────────────────────
router.post('/:id/upload', chatUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.originalname);
  const isAudio = /\.(mp3|ogg|wav|webm)$/i.test(req.file.originalname);
  const type = isImage ? 'image' : isAudio ? 'audio' : 'file';
  const url  = '/uploads/chat/' + req.file.filename;
  const r = await query(
    `INSERT INTO chat_messages (room_id,user_id,content,message_type,file_url,file_name,file_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, req.session.userId, req.file.originalname, type, url,
     req.file.originalname, req.file.size]
  );
  const userR = await query('SELECT full_name, avatar_url FROM users WHERE id=$1', [req.session.userId]);
  const sender = userR.rows[0] || {};
  const payload = { ...r.rows[0], full_name: sender.full_name, avatar_url: sender.avatar_url };
  req.app.get('io')?.to('room:' + req.params.id).emit('message:new', payload);
  res.json({ message: payload, url });
});

// ─── delete message ───────────────────────────────────────────────────────────
router.delete('/:roomId/messages/:msgId', async (req, res) => {
  await query(
    `UPDATE chat_messages SET is_deleted=true WHERE id=$1 AND (user_id=$2 OR $3 IN ('admin','director'))`,
    [req.params.msgId, req.session.userId, req.session.userRole]
  );
  res.json({ success: true });
});

// ─── add member ───────────────────────────────────────────────────────────────
router.post('/:id/members', async (req, res) => {
  const { user_id } = req.body;
  const ids = Array.isArray(user_id) ? user_id : [user_id];
  for (const uid of ids) {
    await query('INSERT INTO chat_room_members (room_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, uid]);
  }
  res.redirect('/chat/' + req.params.id);
});

module.exports = router;
