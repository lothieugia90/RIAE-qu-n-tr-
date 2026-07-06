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
const { pool, query } = require('./src/config/database');
const { loadUser } = require('./src/middleware/auth');
const { csrfProtection } = require('./src/middleware/csrf');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is required in production.');
  process.exit(1);
}

const app = express();

// Trust reverse proxy (Nginx)
app.set('trust proxy', 1);

// Security & Performance
// CSP tắt vì views dùng CDN (Font Awesome, Google Fonts) + inline script;
// sẽ siết lại khi chuyển asset về self-host.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session (PostgreSQL store) — dùng chung cho HTTP và Socket.IO
const sessionMiddleware = session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: 'auto',
    httpOnly: true,
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);

app.use(flash());
app.use(csrfProtection);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(loadUser);

// Helper định dạng dùng chung trong view
const STATUS_LABELS = { todo: 'Cần làm', in_progress: 'Đang làm', review: 'Kiểm tra', done: 'Hoàn thành' };
const PRIORITY_LABELS = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', urgent: 'Khẩn cấp' };
const PROJECT_STATUS_LABELS = { planning: 'Chuẩn bị', active: 'Đang chạy', on_hold: 'Tạm dừng', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
app.use((req, res, next) => {
  res.locals.fmtDate = d => d ? new Date(d).toLocaleDateString('vi-VN') : '—';
  res.locals.fmtDateTime = d => d ? new Date(d).toLocaleString('vi-VN') : '—';
  res.locals.STATUS_LABELS = STATUS_LABELS;
  res.locals.PRIORITY_LABELS = PRIORITY_LABELS;
  res.locals.PROJECT_STATUS_LABELS = PROJECT_STATUS_LABELS;
  next();
});

// Context chung cho template: path hiện tại + badge đếm (gom 1 middleware,
// 1 round-trip DB thay vì mỗi badge một query như bản cũ)
app.use(async (req, res, next) => {
  res.locals.path = req.path;
  res.locals.unreadNotifications = 0;
  res.locals.myWorkCount = 0;
  if (req.session && req.session.userId) {
    try {
      const r = await query(
        `SELECT
           (SELECT COUNT(*)::int FROM notifications WHERE user_id=$1 AND is_read=false) AS notif,
           (SELECT COUNT(*)::int FROM tasks
            WHERE assignee_id=$1 AND status!='done' AND due_date <= CURRENT_DATE) AS due_tasks,
           (SELECT COUNT(*)::int FROM request_approvals ra
            JOIN requests rq ON rq.id=ra.request_id
            WHERE ra.approver_id=$1 AND ra.status='pending' AND rq.status='pending') AS approvals,
           (SELECT COUNT(*)::int FROM chat_messages cm
            JOIN chat_room_members crm ON crm.room_id=cm.room_id AND crm.user_id=$1
            WHERE cm.user_id != $1 AND cm.created_at > COALESCE(crm.last_read_at, '1970-01-01')) AS chats`,
        [req.session.userId]
      );
      res.locals.unreadNotifications = r.rows[0].notif || 0;
      res.locals.myWorkCount = (r.rows[0].due_tasks || 0) + (r.rows[0].approvals || 0);
      res.locals.pendingApprovals = r.rows[0].approvals || 0;
      res.locals.unreadChats = r.rows[0].chats || 0;
    } catch (e) { /* badge không được làm hỏng trang */ }
  }
  next();
});

// Routes
app.use('/auth', require('./src/routes/auth'));
app.use('/dashboard', require('./src/routes/dashboard'));
app.use('/projects', require('./src/routes/projects'));
app.use('/tasks', require('./src/routes/tasks'));
app.use('/notifications', require('./src/routes/notifications'));
app.use('/hr', require('./src/routes/hr'));
app.use('/attendance', require('./src/routes/attendance'));
app.use('/requests', require('./src/routes/requests'));
app.use('/warehouse', require('./src/routes/warehouse'));
app.use('/partners', require('./src/routes/partners'));
app.use('/quotes', require('./src/routes/quotes'));
app.use('/chat', require('./src/routes/chat'));
app.use('/admin', require('./src/routes/admin'));

app.get('/', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

// 404
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Không tìm thấy trang' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('errors/500', {
    title: 'Lỗi hệ thống',
    error: process.env.NODE_ENV !== 'production' ? err : {}
  });
});

// ===== HTTP server + Socket.IO (chat realtime) =====
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const server = http.createServer(app);
const io = new SocketIO(server);
app.set('io', io);

// Socket xác thực bằng CHÍNH session Express (không tin client tự khai userId như v1)
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const sess = socket.request.session;
  if (sess && sess.userId) {
    socket.userId = sess.userId;
    socket.userName = sess.userName;
    return next();
  }
  next(new Error('unauthorized'));
});

io.on('connection', async (socket) => {
  // Chỉ join các phòng user là thành viên (kiểm tra server-side)
  try {
    const rooms = await query('SELECT room_id FROM chat_room_members WHERE user_id=$1', [socket.userId]);
    rooms.rows.forEach(r => socket.join('room:' + r.room_id));
  } catch (e) { /* silent */ }

  socket.on('message:send', async ({ roomId, content }) => {
    if (!content?.trim() || !roomId) return;
    try {
      const member = await query(
        'SELECT 1 FROM chat_room_members WHERE room_id=$1 AND user_id=$2', [roomId, socket.userId]);
      if (!member.rows.length) return;
      const r = await query(
        `INSERT INTO chat_messages (room_id, user_id, content) VALUES ($1,$2,$3) RETURNING *`,
        [roomId, socket.userId, content.trim().slice(0, 4000)]
      );
      const u = await query('SELECT full_name, avatar_url FROM users WHERE id=$1', [socket.userId]);
      io.to('room:' + roomId).emit('message:new', {
        ...r.rows[0],
        full_name: u.rows[0]?.full_name || socket.userName,
        avatar_url: u.rows[0]?.avatar_url || null
      });
      query('UPDATE chat_room_members SET last_read_at=NOW() WHERE room_id=$1 AND user_id=$2',
        [roomId, socket.userId]).catch(() => {});
    } catch (e) { console.error('chat send:', e.message); }
  });

  socket.on('room:read', ({ roomId }) => {
    query('UPDATE chat_room_members SET last_read_at=NOW() WHERE room_id=$1 AND user_id=$2',
      [roomId, socket.userId]).catch(() => {});
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`RIAE Management System v2 running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`URL: http://localhost:${PORT}`);
});

module.exports = app;
