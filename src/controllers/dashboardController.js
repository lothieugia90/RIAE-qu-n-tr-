const { query } = require('../config/database');

const index = async (req, res) => {
  try {
    const role = req.session.userRole;
    const userId = req.session.userId;

    const [projectStats, taskStats, userStats, warehouseStats,
           recentProjects, myTasks, recentAnnouncements, projectsByStatus,
           activeProjects, onlineUsers, urgentTasks] = await Promise.all([
      query(`SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='active')::int as active,
        COUNT(*) FILTER (WHERE status='completed')::int as completed,
        COUNT(*) FILTER (WHERE status='planning')::int as planning,
        COUNT(*) FILTER (WHERE status='on_hold')::int as on_hold,
        COUNT(*) FILTER (WHERE end_date < NOW() AND status NOT IN ('completed','cancelled'))::int as overdue
        FROM projects`),

      query(`SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='todo')::int as todo,
        COUNT(*) FILTER (WHERE status='in_progress')::int as in_progress,
        COUNT(*) FILTER (WHERE status='review')::int as review,
        COUNT(*) FILTER (WHERE status='done')::int as done,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status != 'done')::int as overdue
        FROM tasks WHERE ($1='admin' OR $1='director' OR assignee_id=$2::uuid)`,
        [role, userId]),

      query(`SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE is_active=true)::int as active,
        COUNT(*) FILTER (WHERE role='engineer')::int as engineers,
        COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '7 days')::int as recent_active
        FROM users`),

      query(`SELECT
        COUNT(*)::int as total_items,
        COUNT(*) FILTER (WHERE quantity <= min_quantity AND quantity > 0)::int as low_stock,
        COUNT(*) FILTER (WHERE quantity = 0)::int as out_of_stock,
        COALESCE(SUM(quantity * unit_price), 0) as total_value
        FROM warehouse_items WHERE is_active=true`),

      query(`SELECT p.*, u.full_name as manager_name
        FROM projects p LEFT JOIN users u ON u.id=p.manager_id
        ORDER BY p.updated_at DESC LIMIT 6`),

      query(`SELECT t.*, p.name as project_name, p.id as project_id
        FROM tasks t JOIN projects p ON p.id=t.project_id
        WHERE t.assignee_id=$1 AND t.status != 'done'
        ORDER BY
          CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          t.due_date ASC NULLS LAST
        LIMIT 10`, [userId]),

      query(`SELECT a.*, u.full_name as author_name
        FROM announcements a LEFT JOIN users u ON u.id=a.created_by
        WHERE a.is_published=true AND (a.expires_at IS NULL OR a.expires_at > NOW())
        ORDER BY a.is_pinned DESC, a.published_at DESC LIMIT 5`),

      query(`SELECT status, COUNT(*)::int as count FROM projects GROUP BY status ORDER BY count DESC`),

      query(`SELECT id, name, code FROM projects WHERE status='active' ORDER BY name`),

      query(`SELECT id, full_name, role, avatar_url, department, last_seen_at
             FROM users WHERE is_active=true AND last_seen_at > NOW() - INTERVAL '15 minutes'
             ORDER BY last_seen_at DESC LIMIT 20`),

      query(`SELECT t.*, p.name as project_name
        FROM tasks t JOIN projects p ON p.id=t.project_id
        WHERE t.assignee_id=$1 AND t.status != 'done'
          AND (t.due_date < NOW() + INTERVAL '3 days' OR t.priority IN ('urgent','high'))
        ORDER BY t.due_date ASC NULLS LAST, CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END
        LIMIT 8`, [userId])
    ]);

    res.render('dashboard/index', {
      title: 'Tổng quan',
      projectStats: projectStats.rows[0],
      taskStats: taskStats.rows[0],
      userStats: userStats.rows[0],
      warehouseStats: warehouseStats.rows[0],
      recentProjects: recentProjects.rows,
      myTasks: myTasks.rows,
      recentAnnouncements: recentAnnouncements.rows,
      projectsByStatus: projectsByStatus.rows,
      activeProjects: activeProjects.rows,
      onlineUsers: onlineUsers.rows,
      urgentTasks: urgentTasks.rows
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('dashboard/index', {
      title: 'Tổng quan',
      projectStats: {}, taskStats: {}, userStats: {},
      warehouseStats: {}, recentProjects: [], myTasks: [],
      recentAnnouncements: [], projectsByStatus: [],
      activeProjects: [], onlineUsers: [], urgentTasks: [],
      error: err.message
    });
  }
};

module.exports = { index };
