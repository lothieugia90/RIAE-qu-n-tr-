require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const flash = require('express-flash');
const methodOverride = require('method-override');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const { pool } = require('./src/config/database');
const { loadUser } = require('./src/middleware/auth');
require('./src/config/migrate-v2')();
require('./src/config/migrate-v3')();
require('./src/config/migrate-v4')();
require('./src/config/migrate-v5')();
require('./src/config/migrate-v6')();

const app = express();

// Security & Performance
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// Logging
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));                          // query string: ?_method=PUT
app.use(methodOverride((req) => {                            // body field: <input name="_method">
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session with PostgreSQL store
app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'riae-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
}));

app.use(flash());

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Load authenticated user on every request
app.use(loadUser);

// Global template locals
app.use((req, res, next) => {
  res.locals.moment = require('moment');
  res.locals.path = req.path;
  res.locals.unreadAnnouncements = 0;
  next();
});

// Load unread announcement count for authenticated users
app.use(async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      const { query } = require('./src/config/database');
      const result = await query(
        `SELECT COUNT(*) FROM announcements a
         WHERE a.is_published = true
         AND (a.expires_at IS NULL OR a.expires_at > NOW())
         AND NOT EXISTS (
           SELECT 1 FROM announcement_reads ar
           WHERE ar.announcement_id = a.id AND ar.user_id = $1
         )`,
        [req.session.userId]
      );
      res.locals.unreadAnnouncements = parseInt(result.rows[0].count) || 0;
    } catch (e) { /* silent */ }
  }
  next();
});

// Load unread personal notification count
app.use(async (req, res, next) => {
  res.locals.unreadNotifications = 0;
  if (req.session && req.session.userId) {
    try {
      const { query } = require('./src/config/database');
      const r = await query(
        `SELECT COUNT(*)::int as count FROM notifications WHERE user_id=$1 AND is_read=false`,
        [req.session.userId]
      );
      res.locals.unreadNotifications = r.rows[0].count || 0;
    } catch (e) { /* silent */ }
  }
  next();
});

// Also count unread chat messages
app.use(async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      const { query } = require('./src/config/database');
      const result = await query(
        `SELECT COUNT(*) FROM chat_messages cm
         JOIN chat_room_members crm ON crm.room_id=cm.room_id AND crm.user_id=$1
         WHERE cm.user_id != $1 AND cm.created_at > COALESCE(crm.last_read_at, '1970-01-01')`,
        [req.session.userId]
      );
      res.locals.unreadChats = parseInt(result.rows[0].count) || 0;
    } catch(e) { res.locals.unreadChats = 0; }
  } else { res.locals.unreadChats = 0; }
  next();
});

// Routes
app.use('/auth', require('./src/routes/auth'));
app.use('/dashboard', require('./src/routes/dashboard'));
app.use('/projects', require('./src/routes/projects'));
app.use('/tasks', require('./src/routes/tasks'));
app.use('/hr', require('./src/routes/hr'));
app.use('/warehouse', require('./src/routes/warehouse'));
app.use('/announcements', require('./src/routes/announcements'));
app.use('/notifications', require('./src/routes/notifications'));
app.use('/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/api'));
app.use('/partners', require('./src/routes/partners'));
app.use('/chat', require('./src/routes/chat'));
app.use('/quotes', require('./src/routes/quotes'));
app.use('/attendance', require('./src/routes/attendance'));
app.use('/requests', require('./src/routes/requests'));
app.use('/signatures', require('./src/routes/signatures'));
app.use('/payroll-settings', require('./src/routes/payrollSettings'));

// Root redirect
app.get('/', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

// 404
app.use((req, res) => {
  res.status(404).render('errors/404', {
    layout: 'layouts/main',
    title: 'Không tìm thấy trang'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('errors/500', {
    layout: 'layouts/main',
    title: 'Lỗi hệ thống',
    error: process.env.NODE_ENV !== 'production' ? err : {}
  });
});

const http = require('http');
const { Server: SocketIO } = require('socket.io');
const { query: dbQuery } = require('./src/config/database');

const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: '*' } });
app.set('io', io); // make io accessible in routes via req.app.get('io')

// Socket.io auth middleware
io.use((socket, next) => {
  const sess = socket.handshake.auth.session || socket.handshake.headers.cookie;
  // Accept all connections from authenticated users (session check done in handler)
  next();
});

// Track online users: userId -> { socketId, lastSeen }
const onlineMap = new Map();

io.on('connection', (socket) => {
  const userId = socket.handshake.auth.userId;
  const userName = socket.handshake.auth.userName;
  if (!userId) return socket.disconnect();

  onlineMap.set(userId, { socketId: socket.id, lastSeen: new Date() });
  io.emit('user:online', { userId, online: true });

  // Update last_seen_at in DB
  dbQuery('UPDATE users SET last_seen_at=NOW() WHERE id=$1', [userId]).catch(() => {});

  // Join all user's rooms
  socket.on('rooms:join', async (roomIds) => {
    if (Array.isArray(roomIds)) roomIds.forEach(id => socket.join('room:' + id));
  });

  // Send message
  socket.on('message:send', async ({ roomId, content, replyTo }) => {
    if (!content?.trim() || !roomId) return;
    try {
      const r = await dbQuery(
        `INSERT INTO chat_messages (room_id,user_id,content,reply_to) VALUES ($1,$2,$3,$4) RETURNING *`,
        [roomId, userId, content.trim(), replyTo || null]
      );
      const msg = r.rows[0];

      // Fetch sender info
      const userR = await dbQuery('SELECT full_name, avatar_url FROM users WHERE id=$1', [userId]);
      const sender = userR.rows[0] || {};

      const payload = {
        ...msg,
        full_name: sender.full_name || userName,
        avatar_url: sender.avatar_url || null,
        reply_content: null,
        reply_author: null
      };

      // If reply, get original
      if (replyTo) {
        const orig = await dbQuery('SELECT cm.content, u.full_name FROM chat_messages cm JOIN users u ON u.id=cm.user_id WHERE cm.id=$1', [replyTo]);
        if (orig.rows[0]) {
          payload.reply_content = orig.rows[0].content;
          payload.reply_author  = orig.rows[0].full_name;
        }
      }

      io.to('room:' + roomId).emit('message:new', payload);
    } catch (e) { console.error('Socket message:send error', e.message); }
  });

  // Typing indicator
  socket.on('typing:start', ({ roomId }) => {
    socket.to('room:' + roomId).emit('typing:update', { userId, userName, typing: true });
  });
  socket.on('typing:stop', ({ roomId }) => {
    socket.to('room:' + roomId).emit('typing:update', { userId, userName, typing: false });
  });

  // Reaction
  socket.on('message:react', async ({ messageId, roomId, emoji }) => {
    io.to('room:' + roomId).emit('message:reaction', { messageId, userId, userName, emoji });
  });

  socket.on('disconnect', () => {
    onlineMap.delete(userId);
    dbQuery('UPDATE users SET last_seen_at=NOW() WHERE id=$1', [userId]).catch(() => {});
    io.emit('user:online', { userId, online: false });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`RIAE Management System running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`URL: http://localhost:${PORT}`);
});

module.exports = app;
