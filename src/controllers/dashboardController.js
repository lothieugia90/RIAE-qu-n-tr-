const { query } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');

// Quick action chỉ hiện khi user có đủ quyền với module tương ứng
const QUICK_ACTIONS = [
  { module: 'projects',    min: 'view', href: '/projects',          icon: 'fa-folder-open',    label: 'Dự án',              desc: 'Danh sách & Kanban' },
  { module: 'tasks',       min: 'view', href: '/tasks/my-tasks',    icon: 'fa-list-check',     label: 'Việc của tôi',       desc: 'Task được giao cho bạn' },
  { module: 'requests',    min: 'view', href: '/requests',          icon: 'fa-stamp',          label: 'Phê duyệt',          desc: 'Gửi & duyệt yêu cầu' },
  { module: 'attendance',  min: 'view', href: '/attendance',        icon: 'fa-calendar-check', label: 'Chấm công',          desc: 'Bảng công theo tháng' },
  { module: 'hr',          min: 'view', href: '/hr',                icon: 'fa-users',          label: 'Nhân sự',            desc: 'Hồ sơ nhân viên' },
  { module: 'chat',        min: 'view', href: '/chat',              icon: 'fa-comments',       label: 'Chat nội bộ',        desc: 'Trao đổi realtime' },
  { module: 'warehouse',   min: 'view', href: '/warehouse',         icon: 'fa-boxes',          label: 'Kho vật tư',         desc: 'Tồn kho & nhập xuất' },
  { module: 'partners',    min: 'view', href: '/partners',          icon: 'fa-handshake',      label: 'Đối tác',            desc: 'NCC, nhà thầu, khách hàng' },
  { module: 'quotes',      min: 'view', href: '/quotes',            icon: 'fa-file-invoice-dollar', label: 'Báo giá',       desc: 'Lập & theo dõi báo giá' },
  { module: 'users',       min: 'view', href: '/admin/users',       icon: 'fa-users-cog',      label: 'Quản lý người dùng', desc: 'Tài khoản & vai trò' },
  { module: 'permissions', min: 'view', href: '/admin/permissions', icon: 'fa-shield-alt',     label: 'Phân quyền',         desc: 'Ma trận quyền theo vai trò' },
  { module: 'audit',       min: 'view', href: '/admin/audit',       icon: 'fa-history',        label: 'Nhật ký hệ thống',   desc: 'Lịch sử thao tác' },
];

const index = async (req, res) => {
  try {
    const role = req.session.userRole;
    const userId = req.session.userId;

    const [userStats, projectStats, myTaskStats, recentActivity] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE is_active)::int AS active,
                    COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '10 minutes')::int AS online
             FROM users`),
      query(`SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,
                    COUNT(*) FILTER (WHERE status='planning')::int AS planning,
                    COUNT(*)::int AS total
             FROM projects`),
      query(`SELECT COUNT(*) FILTER (WHERE status != 'done')::int AS pending,
                    COUNT(*) FILTER (WHERE status != 'done' AND due_date < CURRENT_DATE)::int AS overdue
             FROM tasks WHERE assignee_id=$1`, [userId]),
      (await getPermLevel(role, 'audit')) !== 'none'
        ? query(`SELECT al.action, al.description, al.created_at, u.full_name
                 FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
                 ORDER BY al.created_at DESC LIMIT 10`)
        : Promise.resolve({ rows: [] })
    ]);

    const actions = [];
    for (const a of QUICK_ACTIONS) {
      const level = await getPermLevel(role, a.module);
      if (level !== 'none') actions.push(a);
    }

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats: userStats.rows[0],
      projectStats: projectStats.rows[0],
      myTaskStats: myTaskStats.rows[0],
      recentActivity: recentActivity.rows,
      quickActions: actions
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('errors/500', { title: 'Lỗi hệ thống', error: process.env.NODE_ENV !== 'production' ? err : {} });
  }
};

module.exports = { index };
