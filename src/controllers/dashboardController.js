const { query } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { PERM_LEVELS } = require('../config/roles');
const { TYPE_META: ANN_TYPE_META } = require('./announcementController');

// Nhóm vai trò → quyết định KPI và widget hiển thị.
// Quy trình RIAE: lãnh đạo nhìn toàn cảnh, PM nhìn dự án của mình,
// HR nhìn chấm công/đơn từ, kho nhìn tồn/phiếu, kế toán nhìn thanh toán/báo giá,
// kỹ thuật hiện trường nhìn việc hôm nay + công + đơn từ của mình.
const GROUP_BY_ROLE = {
  admin: 'leadership', director: 'leadership',
  pm: 'manager', head_tech: 'manager', head_sales: 'manager',
  hr: 'hr', head_hr: 'hr',
  warehouse: 'warehouse', warehouse_keeper: 'warehouse',
  accountant: 'finance',
};

const QUICK_ACTIONS = [
  { module: 'announcements', href: '/announcements',   icon: 'fa-bullhorn',            label: 'Bảng tin công ty' },
  { module: 'projects',    href: '/projects',          icon: 'fa-folder-open',         label: 'Dự án' },
  { module: 'tasks',       href: '/tasks/my-tasks',    icon: 'fa-list-check',          label: 'Việc của tôi' },
  { module: 'requests',    href: '/requests',          icon: 'fa-stamp',               label: 'Phê duyệt' },
  { module: 'attendance',  href: '/attendance',        icon: 'fa-calendar-check',      label: 'Chấm công' },
  { module: 'chat',        href: '/chat',              icon: 'fa-comments',            label: 'Chat' },
  { module: 'hr',          href: '/hr',                icon: 'fa-users',               label: 'Nhân sự' },
  { module: 'warehouse',   href: '/warehouse',         icon: 'fa-boxes',               label: 'Kho' },
  { module: 'partners',    href: '/partners',          icon: 'fa-handshake',           label: 'Đối tác' },
  { module: 'quotes',      href: '/quotes',            icon: 'fa-file-invoice-dollar', label: 'Báo giá' },
  { module: 'users',       href: '/admin/users',       icon: 'fa-users-cog',           label: 'Người dùng' },
  { module: 'permissions', href: '/admin/permissions', icon: 'fa-shield-alt',          label: 'Phân quyền' },
  { module: 'audit',       href: '/admin/audit',       icon: 'fa-history',             label: 'Nhật ký' },
];

const atLeast = (level, min) => PERM_LEVELS.indexOf(level) >= PERM_LEVELS.indexOf(min);

const index = async (req, res) => {
  try {
    const userId = req.session.userId;
    const role = req.session.userRole;
    const group = GROUP_BY_ROLE[role] || 'staff';

    // Mức quyền các module (1 vòng, dùng cache trong middleware)
    const perms = {};
    for (const m of ['projects', 'hr', 'attendance', 'warehouse', 'quotes', 'audit']) {
      perms[m] = await getPermLevel(role, m);
    }

    const showProjects   = group === 'leadership' || group === 'manager';
    const showAttendance = group === 'leadership' || group === 'hr';
    const showWarehouse  = group === 'leadership' || group === 'warehouse';
    const showQuotes     = (group === 'leadership' || group === 'finance' || role === 'head_sales' || role === 'pm')
                           && perms.quotes !== 'none';
    const showActivity   = atLeast(perms.audit, 'view');

    const [
      myTaskStats, myAgenda, myApprovals, myRequests, myAttendance, myNotifications,
      companyStats, projectList, attendanceToday, lowStock, quotesPipeline, recentActivity, companyAnnouncements,
      monthlyChart
    ] = await Promise.all([
      // --- Cá nhân (mọi vai trò) ---
      query(`SELECT COUNT(*) FILTER (WHERE status NOT IN ('done','failed'))::int AS pending,
                    COUNT(*) FILTER (WHERE status NOT IN ('done','failed') AND due_date < CURRENT_DATE)::int AS overdue,
                    COUNT(*) FILTER (WHERE status NOT IN ('done','failed') AND due_date = CURRENT_DATE)::int AS today
             FROM tasks WHERE assignee_id=$1`, [userId]),
      query(`SELECT t.id, t.title, t.due_date, t.priority, t.status, p.name AS project_name,
               CASE WHEN t.due_date < CURRENT_DATE THEN 'overdue'
                    WHEN t.due_date = CURRENT_DATE THEN 'today' ELSE 'upcoming' END AS bucket
             FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status NOT IN ('done','failed')
             ORDER BY CASE WHEN t.due_date < CURRENT_DATE THEN 0
                           WHEN t.due_date = CURRENT_DATE THEN 1 ELSE 2 END,
               t.due_date ASC NULLS LAST LIMIT 6`, [userId]),
      query(`SELECT r.id, r.title, r.priority, rf.name AS form_name, u.full_name AS submitter_name, r.created_at
             FROM requests r
             JOIN request_forms rf ON rf.id=r.form_id
             JOIN users u ON u.id=r.submitted_by
             JOIN request_approvals ra ON ra.request_id=r.id
             WHERE ra.approver_id=$1 AND ra.status='pending' AND r.status='pending'
             ORDER BY r.created_at LIMIT 5`, [userId]),
      query(`SELECT id, title, status, created_at FROM requests
             WHERE submitted_by=$1 ORDER BY created_at DESC LIMIT 3`, [userId]),
      query(`SELECT COUNT(*) FILTER (WHERE status IN ('present','late','remote'))::int AS work_days,
                    COALESCE(SUM(overtime_hours),0)::float AS ot_hours
             FROM attendance_records
             WHERE user_id=$1 AND date_trunc('month', work_date)=date_trunc('month', CURRENT_DATE)`, [userId]),
      query(`SELECT id, type, title, link, created_at, is_read FROM notifications
             WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [userId]),

      // --- Toàn công ty (lãnh đạo) ---
      group === 'leadership'
        ? query(`SELECT
            (SELECT COUNT(*)::int FROM projects WHERE status='active' AND is_personal=false) AS active_projects,
            (SELECT COUNT(*)::int FROM tasks WHERE status NOT IN ('done','failed') AND due_date < CURRENT_DATE) AS company_overdue,
            (SELECT COUNT(*)::int FROM users WHERE is_active=true) AS active_users,
            (SELECT COUNT(*)::int FROM users WHERE last_seen_at > NOW() - INTERVAL '10 minutes') AS online_users`)
        : Promise.resolve({ rows: [{}] }),

      // --- Dự án (lãnh đạo: tất cả; quản lý: của mình) ---
      showProjects
        ? query(`SELECT p.id, p.code, p.name, p.status, p.progress_percent, p.end_date,
                   u.full_name AS manager_name,
                   (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id AND t.status NOT IN ('done','failed') AND t.due_date < CURRENT_DATE) AS overdue_tasks,
                   (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id AND t.status='review') AS review_tasks
                 FROM projects p LEFT JOIN users u ON u.id=p.manager_id
                 WHERE p.status IN ('active','planning') AND p.is_personal=false
                 ${group === 'manager' ? `AND (p.manager_id=$1 OR p.id IN (SELECT project_id FROM project_members WHERE user_id=$1))` : ''}
                 ORDER BY p.updated_at DESC LIMIT 6`, group === 'manager' ? [userId] : [])
        : Promise.resolve({ rows: [] }),

      // --- Chấm công hôm nay (HR + lãnh đạo) ---
      showAttendance
        ? query(`SELECT
            (SELECT COUNT(*)::int FROM users WHERE is_active=true) AS total,
            (SELECT COUNT(DISTINCT user_id)::int FROM attendance_records WHERE work_date=CURRENT_DATE) AS checked,
            (SELECT COUNT(*)::int FROM attendance_records WHERE work_date=CURRENT_DATE AND status='late') AS late`)
        : Promise.resolve({ rows: [null] }),

      // --- Kho tồn thấp (kho + lãnh đạo) ---
      showWarehouse
        ? query(`SELECT code, name, quantity, min_quantity, unit FROM warehouse_items
                 WHERE is_active=true AND quantity <= min_quantity
                 ORDER BY (quantity / NULLIF(min_quantity, 0)) ASC NULLS FIRST LIMIT 5`)
        : Promise.resolve({ rows: [] }),

      // --- Báo giá pipeline ---
      showQuotes
        ? query(`SELECT COUNT(*) FILTER (WHERE status='draft')::int AS draft,
                        COUNT(*) FILTER (WHERE status='sent')::int AS sent,
                        COUNT(*) FILTER (WHERE status='approved')::int AS approved,
                        COALESCE(SUM(total_amount) FILTER (WHERE status='approved'),0) AS approved_value
                 FROM quotes`)
        : Promise.resolve({ rows: [null] }),

      // --- Nhật ký (theo quyền audit) ---
      showActivity
        ? query(`SELECT al.action, al.description, al.created_at, u.full_name
                 FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
                 ORDER BY al.created_at DESC LIMIT 8`)
        : Promise.resolve({ rows: [] }),

      // --- Bảng tin công ty: mọi vai trò đều thấy (thông báo chung/quyết định/quy chế/bổ nhiệm) ---
      query(
        `SELECT a.id, a.title, a.type, a.is_pinned, a.published_at,
                EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id=a.id AND ar.user_id=$1) AS is_read
         FROM announcements a
         WHERE a.is_published=true AND (a.expires_at IS NULL OR a.expires_at > NOW())
         ORDER BY a.is_pinned DESC, a.published_at DESC LIMIT 4`, [userId]),

      // --- Biểu đồ hoạt động 6 tháng: task mới, task hoàn thành, yêu cầu gửi ---
      query(
        `SELECT to_char(d.m, 'MM/YYYY') AS label,
                (SELECT COUNT(*)::int FROM tasks t WHERE date_trunc('month', t.created_at)=d.m) AS tasks_new,
                (SELECT COUNT(*)::int FROM tasks t WHERE t.status='done' AND date_trunc('month', t.updated_at)=d.m) AS tasks_done,
                (SELECT COUNT(*)::int FROM requests r WHERE date_trunc('month', r.created_at)=d.m) AS requests_new
         FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
                              date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS d(m)
         ORDER BY d.m`)
    ]);

    const t = myTaskStats.rows[0];
    const att = myAttendance.rows[0];
    const cs = companyStats.rows[0] || {};
    const approvalsCount = res.locals.pendingApprovals || myApprovals.rows.length;
    const myPendingRequests = myRequests.rows.filter(r => r.status === 'pending').length;

    // ===== KPI theo nhóm vai trò =====
    const KPI_LIB = {
      myTasks:     { icon: 'fa-list-check', tone: t.overdue > 0 ? 'danger' : 'primary', value: t.pending, label: 'Việc của tôi', sub: t.overdue > 0 ? t.overdue + ' quá hạn' : (t.today > 0 ? t.today + ' đến hạn hôm nay' : 'Không có việc trễ'), href: '/tasks/my-tasks' },
      approvals:   { icon: 'fa-stamp', tone: approvalsCount > 0 ? 'warning' : 'success', value: approvalsCount, label: 'Chờ tôi duyệt', sub: approvalsCount > 0 ? 'Cần xử lý sớm' : 'Đã xử lý hết', href: '/requests?tab=pending' },
      workDays:    { icon: 'fa-calendar-check', tone: 'info', value: att.work_days, label: 'Công tháng này', sub: att.ot_hours > 0 ? '+' + att.ot_hours + 'h tăng ca' : null, href: '/attendance' },
      myRequests:  { icon: 'fa-paper-plane', tone: 'purple', value: myPendingRequests, label: 'Đơn từ đang chờ', sub: 'Của bạn', href: '/requests' },
      projects:    { icon: 'fa-folder-open', tone: 'primary', value: cs.active_projects ?? projectList.rows.length, label: group === 'manager' ? 'Dự án của tôi' : 'Dự án đang chạy', href: '/projects' },
      companyOverdue: { icon: 'fa-triangle-exclamation', tone: (cs.company_overdue || 0) > 0 ? 'danger' : 'success', value: cs.company_overdue || 0, label: 'Task quá hạn toàn cty', href: '/projects' },
      online:      { icon: 'fa-circle-dot', tone: 'success', value: (cs.online_users || 0) + '/' + (cs.active_users || 0), label: 'Đang trực tuyến', href: '/hr' },
      attToday:    attendanceToday.rows[0] ? { icon: 'fa-user-clock', tone: 'info', value: attendanceToday.rows[0].checked + '/' + attendanceToday.rows[0].total, label: 'Chấm công hôm nay', sub: attendanceToday.rows[0].late > 0 ? attendanceToday.rows[0].late + ' đi trễ' : null, href: '/attendance' } : null,
      lowStock:    { icon: 'fa-boxes', tone: lowStock.rows.length > 0 ? 'warning' : 'success', value: lowStock.rows.length, label: 'Vật tư tồn thấp', href: '/warehouse?low=1' },
      quoteValue:  quotesPipeline.rows[0] ? { icon: 'fa-file-invoice-dollar', tone: 'success', value: (Number(quotesPipeline.rows[0].approved_value) / 1e6).toFixed(0) + 'tr', label: 'Báo giá đã chốt', sub: quotesPipeline.rows[0].sent + ' đang chờ khách', href: '/quotes' } : null,
    };
    const KPI_SETS = {
      leadership: ['projects', 'companyOverdue', 'approvals', 'online'],
      manager:    ['projects', 'myTasks', 'approvals', 'workDays'],
      hr:         ['attToday', 'approvals', 'myTasks', 'workDays'],
      warehouse:  ['lowStock', 'myTasks', 'workDays', 'myRequests'],
      finance:    ['approvals', 'quoteValue', 'myTasks', 'workDays'],
      staff:      ['myTasks', 'workDays', 'myRequests', 'approvals'],
    };
    const kpis = KPI_SETS[group].map(k => KPI_LIB[k]).filter(Boolean);

    // Lối tắt theo quyền
    const shortcuts = [];
    for (const a of QUICK_ACTIONS) {
      if ((await getPermLevel(role, a.module)) !== 'none') shortcuts.push(a);
    }

    res.render('dashboard/index', {
      title: 'Dashboard',
      group, kpis, shortcuts,
      agenda: myAgenda.rows,
      taskStats: t,
      approvals: myApprovals.rows,
      approvalsCount,
      myRequests: myRequests.rows,
      notifications: myNotifications.rows,
      projects: projectList.rows,
      attendanceToday: attendanceToday.rows[0],
      lowStock: lowStock.rows,
      quotes: quotesPipeline.rows[0],
      recentActivity: recentActivity.rows,
      companyAnnouncements: companyAnnouncements.rows,
      annTypeMeta: ANN_TYPE_META,
      monthlyChart: monthlyChart.rows
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('errors/500', { title: 'Lỗi hệ thống', error: process.env.NODE_ENV !== 'production' ? err : {} });
  }
};

module.exports = { index };
