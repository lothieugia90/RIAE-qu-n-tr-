const { query } = require('../config/database');

const index = async (req, res) => {
  try {
    const role = req.session.userRole;
    const userId = req.session.userId;

    // Core dashboard data — must all succeed
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

    // Action items — fetched separately so a failure doesn't crash the whole dashboard
    let pendingApprovals = [], needsSignature = [], pendingReturns = [], approvedRequests = [];
    try {
      const [aRes, sRes, rRes, apRes] = await Promise.all([
        query(`SELECT r.id, r.title, r.created_at, u.full_name as requester_name
          FROM requests r
          JOIN request_approvals ra ON ra.request_id = r.id
          JOIN users u ON u.id = r.submitted_by
          WHERE ra.approver_id = $1 AND ra.status = 'pending' AND r.status = 'pending'
          ORDER BY r.created_at ASC LIMIT 5`, [userId]),

        query(`SELECT wa.id, wi.name as item_name, wa.quantity, wi.unit, wa.assigned_at
          FROM warehouse_assignments wa
          JOIN warehouse_items wi ON wi.id = wa.item_id
          WHERE wa.assigned_to_user = $1 AND wa.status = 'active' AND wa.recipient_signed_at IS NULL
          ORDER BY wa.assigned_at DESC LIMIT 5`, [userId]),

        query(`SELECT wa.id, wi.name as item_name, wa.quantity, wi.unit,
                 u.full_name as assignee_name, wa.return_requested_at
          FROM warehouse_assignments wa
          JOIN warehouse_items wi ON wi.id = wa.item_id
          LEFT JOIN users u ON u.id = wa.assigned_to_user
          WHERE wa.status = 'pending_return'
          ORDER BY wa.return_requested_at ASC LIMIT 5`),

        query(`SELECT r.id, r.title, r.updated_at
          FROM requests r
          WHERE r.submitted_by = $1 AND r.status = 'approved' AND r.updated_at > NOW() - INTERVAL '7 days'
          ORDER BY r.updated_at DESC LIMIT 5`, [userId])
      ]);
      pendingApprovals = aRes.rows;
      needsSignature   = sRes.rows;
      pendingReturns   = rRes.rows;
      approvedRequests = apRes.rows;
    } catch (actionErr) {
      console.error('Dashboard action items error:', actionErr.message);
    }

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
      urgentTasks: urgentTasks.rows,
      pendingApprovals,
      needsSignature,
      pendingReturns,
      approvedRequests
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('dashboard/index', {
      title: 'Tổng quan',
      projectStats: {}, taskStats: {}, userStats: {},
      warehouseStats: {}, recentProjects: [], myTasks: [],
      recentAnnouncements: [], projectsByStatus: [],
      activeProjects: [], onlineUsers: [], urgentTasks: [],
      pendingApprovals: [], needsSignature: [], pendingReturns: [], approvedRequests: [],
      error: err.message
    });
  }
};

module.exports = { index };
