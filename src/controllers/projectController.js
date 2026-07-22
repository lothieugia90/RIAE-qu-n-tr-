const { query } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { PERM_LEVELS } = require('../config/roles');

// Cột Kanban chuẩn (workflow tùy biến nhiều bước sẽ bổ sung ở migration sau)
const KANBAN_COLS = [
  { id: 'todo',        name: 'Cần làm',    color: '#64748B' },
  { id: 'in_progress', name: 'Đang làm',   color: '#1565C0' },
  { id: 'review',      name: 'Kiểm tra',   color: '#D97706' },
  { id: 'done',        name: 'Hoàn thành', color: '#16A34A' },
];

// view = chỉ thấy dự án mình tham gia; edit trở lên = thấy tất cả
async function canSeeAll(role) {
  const level = await getPermLevel(role, 'projects');
  return PERM_LEVELS.indexOf(level) >= PERM_LEVELS.indexOf('edit');
}

// Kiểm tra user có được xem dự án cụ thể không (thành viên / quản lý / quyền edit+)
async function canAccessProject(req, projectId) {
  if (await canSeeAll(req.session.userRole)) return true;
  const r = await query(
    `SELECT 1 FROM projects p
     WHERE p.id=$1 AND (p.manager_id=$2
       OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2))`,
    [projectId, req.session.userId]
  );
  return r.rows.length > 0;
}

const index = async (req, res) => {
  try {
    const { status, search, priority } = req.query;
    const seeAll = await canSeeAll(req.session.userRole);
    let sql = `
      SELECT p.*, u.full_name as manager_name,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id) as task_count,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id AND t.status='done') as done_count,
        (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id=p.id) as member_count
      FROM projects p LEFT JOIN users u ON u.id=p.manager_id WHERE p.is_personal=false`;
    const params = [];
    if (!seeAll) {
      params.push(req.session.userId);
      sql += ` AND (p.manager_id=$${params.length} OR p.id IN (SELECT project_id FROM project_members WHERE user_id=$${params.length}))`;
    }
    if (status)   { params.push(status);   sql += ` AND p.status=$${params.length}`; }
    if (priority) { params.push(priority); sql += ` AND p.priority=$${params.length}`; }
    if (search)   { params.push(`%${search}%`); sql += ` AND (p.name ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.client_name ILIKE $${params.length})`; }
    sql += ' ORDER BY p.updated_at DESC';

    const [projects, stats, users] = await Promise.all([
      query(sql, params),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='active')::int as active,
             COUNT(*) FILTER (WHERE status='planning')::int as planning,
             COUNT(*) FILTER (WHERE status='completed')::int as completed,
             COUNT(*) FILTER (WHERE status='on_hold')::int as on_hold
             FROM projects WHERE is_personal=false`),
      query('SELECT id, full_name FROM users WHERE is_active=true ORDER BY full_name')
    ]);

    const permLevel = await getPermLevel(req.session.userRole, 'projects');
    res.render('projects/index', {
      title: 'Quản lý Dự án',
      projects: projects.rows,
      stats: stats.rows[0],
      users: users.rows,
      filters: req.query,
      permLevel
    });
  } catch (err) {
    console.error('projects index:', err);
    req.flash('error', 'Lỗi tải danh sách dự án');
    res.redirect('/dashboard');
  }
};

const getCreate = async (req, res) => {
  try {
    const users = await query(
      "SELECT id, full_name, role FROM users WHERE is_active=true ORDER BY full_name"
    );
    res.render('projects/form', { title: 'Tạo Dự án mới', project: null, users: users.rows });
  } catch (err) { console.error(err); res.redirect('/projects'); }
};

const postCreate = async (req, res) => {
  const { code, name, description, client_name, client_contact, status, priority,
          start_date, end_date, budget, location, manager_id } = req.body;
  if (!code?.trim() || !name?.trim()) {
    req.flash('error', 'Mã và tên dự án là bắt buộc');
    return res.redirect('/projects/create');
  }
  try {
    const result = await query(
      `INSERT INTO projects (code,name,description,client_name,client_contact,status,priority,
        start_date,end_date,budget,location,manager_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [code.trim().toUpperCase(), name.trim(), description || null, client_name || null, client_contact || null,
       status || 'planning', priority || 'medium',
       start_date || null, end_date || null, budget || null, location || null,
       manager_id || null, req.session.userId]
    );
    const id = result.rows[0].id;
    // Quản lý dự án tự động là thành viên
    if (manager_id) {
      await query(
        `INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'manager') ON CONFLICT DO NOTHING`,
        [id, manager_id]
      );
    }
    logActivity(req.session.userId, 'PROJECT_CREATE', `Tạo dự án ${code}: ${name}`,
      { entityType: 'project', entityId: id, ip: req.ip });
    req.flash('success', `Dự án "${name}" đã được tạo`);
    res.redirect('/projects/' + id);
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Mã dự án đã tồn tại' : 'Lỗi tạo dự án');
    res.redirect('/projects/create');
  }
};

const detail = async (req, res) => {
  try {
    if (!(await canAccessProject(req, req.params.id))) {
      req.flash('error', 'Bạn không có quyền xem dự án này');
      return res.redirect('/projects');
    }
    const [project, tasks, members, allUsers, taskStats] = await Promise.all([
      query(`SELECT p.*, u.full_name as manager_name FROM projects p
             LEFT JOIN users u ON u.id=p.manager_id WHERE p.id=$1`, [req.params.id]),
      query(`SELECT t.*, u.full_name as assignee_name, u.avatar_url as assignee_avatar
             FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
             WHERE t.project_id=$1 ORDER BY
               CASE t.status WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'review' THEN 3 ELSE 4 END,
               t.due_date ASC NULLS LAST`, [req.params.id]),
      query(`SELECT u.id, u.full_name, u.role, u.position, u.avatar_url, pm.role as project_role
             FROM project_members pm JOIN users u ON u.id=pm.user_id
             WHERE pm.project_id=$1 ORDER BY u.full_name`, [req.params.id]),
      query('SELECT id, full_name, role FROM users WHERE is_active=true ORDER BY full_name'),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='done')::int as done,
             COUNT(*) FILTER (WHERE status='in_progress')::int as in_progress,
             COUNT(*) FILTER (WHERE status='todo')::int as todo,
             COUNT(*) FILTER (WHERE status='review')::int as review,
             COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('done','failed'))::int as overdue
             FROM tasks WHERE project_id=$1`, [req.params.id])
    ]);
    if (!project.rows.length) {
      req.flash('error', 'Không tìm thấy dự án');
      return res.redirect('/projects');
    }
    const p = project.rows[0];
    const ts = taskStats.rows[0];
    // Tiến độ tự tính theo tỷ lệ task hoàn thành
    if (ts.total > 0) {
      const auto = Math.round((ts.done / ts.total) * 100);
      if (auto !== p.progress_percent) {
        query('UPDATE projects SET progress_percent=$1, updated_at=NOW() WHERE id=$2', [auto, p.id]).catch(() => {});
        p.progress_percent = auto;
      }
    }
    const permLevel = await getPermLevel(req.session.userRole, 'projects');
    res.render('projects/detail', {
      title: p.name,
      project: p,
      tasks: tasks.rows,
      members: members.rows,
      allUsers: allUsers.rows,
      taskStats: ts,
      permLevel,
      isManager: p.manager_id === req.session.userId
    });
  } catch (err) {
    console.error('project detail:', err);
    res.redirect('/projects');
  }
};

const kanban = async (req, res) => {
  try {
    if (!(await canAccessProject(req, req.params.id))) {
      req.flash('error', 'Bạn không có quyền xem dự án này');
      return res.redirect('/projects');
    }
    const [projectRes, tasks, allUsers] = await Promise.all([
      query('SELECT * FROM projects WHERE id=$1', [req.params.id]),
      query(`SELECT t.*, u.full_name as assignee_name, u.avatar_url as assignee_avatar,
             (SELECT COUNT(*)::int FROM task_checklists WHERE task_id=t.id) as checklist_total,
             (SELECT COUNT(*)::int FROM task_checklists WHERE task_id=t.id AND is_done=true) as checklist_done,
             (SELECT COUNT(*)::int FROM task_comments WHERE task_id=t.id) as comment_count
             FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
             WHERE t.project_id=$1
             ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               t.due_date ASC NULLS LAST`, [req.params.id]),
      query('SELECT id, full_name FROM users WHERE is_active=true ORDER BY full_name')
    ]);
    if (!projectRes.rows.length) return res.redirect('/projects');

    const columns = KANBAN_COLS.map(col => ({
      ...col,
      tasks: tasks.rows.filter(t => t.status === col.id)
    }));

    res.render('projects/kanban', {
      title: 'Kanban — ' + projectRes.rows[0].name,
      project: projectRes.rows[0],
      columns,
      members: allUsers.rows
    });
  } catch (err) {
    console.error('kanban:', err);
    res.redirect('/projects');
  }
};

const getEdit = async (req, res) => {
  try {
    const [project, users] = await Promise.all([
      query('SELECT * FROM projects WHERE id=$1', [req.params.id]),
      query('SELECT id, full_name, role FROM users WHERE is_active=true ORDER BY full_name')
    ]);
    if (!project.rows.length) return res.redirect('/projects');
    res.render('projects/form', { title: 'Chỉnh sửa Dự án', project: project.rows[0], users: users.rows });
  } catch (err) { console.error(err); res.redirect('/projects'); }
};

const postEdit = async (req, res) => {
  const { code, name, description, client_name, client_contact, status, priority,
          start_date, end_date, budget, location, manager_id } = req.body;
  try {
    await query(
      `UPDATE projects SET code=$1,name=$2,description=$3,client_name=$4,client_contact=$5,
       status=$6,priority=$7,start_date=$8,end_date=$9,budget=$10,location=$11,manager_id=$12,
       updated_at=NOW() WHERE id=$13`,
      [code.trim().toUpperCase(), name.trim(), description || null, client_name || null, client_contact || null,
       status, priority, start_date || null, end_date || null, budget || null, location || null,
       manager_id || null, req.params.id]
    );
    if (manager_id) {
      await query(
        `INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'manager') ON CONFLICT DO NOTHING`,
        [req.params.id, manager_id]
      );
    }
    logActivity(req.session.userId, 'PROJECT_UPDATE', `Cập nhật dự án ${code}: ${name}`,
      { entityType: 'project', entityId: req.params.id, ip: req.ip });
    req.flash('success', 'Cập nhật dự án thành công');
    res.redirect('/projects/' + req.params.id);
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Mã dự án đã tồn tại' : 'Lỗi cập nhật dự án');
    res.redirect('/projects/' + req.params.id + '/edit');
  }
};

const cancelProject = async (req, res) => {
  try {
    const r = await query(
      `UPDATE projects SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING code, name`,
      [req.params.id]
    );
    if (r.rows.length) {
      logActivity(req.session.userId, 'PROJECT_CANCEL', `Hủy dự án ${r.rows[0].code}: ${r.rows[0].name}`,
        { entityType: 'project', entityId: req.params.id, ip: req.ip });
    }
    req.flash('success', 'Đã hủy dự án');
  } catch (err) { req.flash('error', 'Lỗi hủy dự án'); }
  res.redirect('/projects');
};

const addMember = async (req, res) => {
  const { user_id, role } = req.body;
  try {
    await query(
      'INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, user_id, role || 'member']
    );
    req.flash('success', 'Đã thêm thành viên vào dự án');
  } catch (err) { req.flash('error', 'Lỗi thêm thành viên'); }
  res.redirect('/projects/' + req.params.id);
};

const removeMember = async (req, res) => {
  try {
    await query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
      [req.params.id, req.body.user_id]);
    req.flash('success', 'Đã xóa thành viên khỏi dự án');
  } catch (err) { req.flash('error', 'Lỗi xóa thành viên'); }
  res.redirect('/projects/' + req.params.id);
};

module.exports = { index, getCreate, postCreate, detail, kanban, getEdit, postEdit, cancelProject, addMember, removeMember, canAccessProject };
