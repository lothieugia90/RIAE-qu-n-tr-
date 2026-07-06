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

// Session (PostgreSQL store)
app.use(session({
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
}));

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
            WHERE assignee_id=$1 AND status!='done' AND due_date <= CURRENT_DATE) AS due_tasks`,
        [req.session.userId]
      );
      res.locals.unreadNotifications = r.rows[0].notif || 0;
      res.locals.myWorkCount = r.rows[0].due_tasks || 0;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RIAE Management System v2 running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`URL: http://localhost:${PORT}`);
});

module.exports = app;
