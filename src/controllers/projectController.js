const { query } = require('../config/database');
const audit = require('../utils/audit');
const { anyUpload } = require('../config/upload');

const index = async (req, res) => {
  try {
    const { status, search, priority } = req.query;
    let sql = `
      SELECT p.*, u.full_name as manager_name,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id) as task_count,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id AND t.status='done') as done_count,
        (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id=p.id) as member_count,
        (SELECT COALESCE(SUM(t.actual_hours),0) FROM tasks t WHERE t.project_id=p.id) as actual_hours,
        (SELECT COALESCE(SUM(t.estimated_hours),0) FROM tasks t WHERE t.project_id=p.id) as estimated_hours
      FROM projects p LEFT JOIN users u ON u.id=p.manager_id WHERE 1=1`;
    const params = [];
    if (req.session.userRole === 'engineer') {
      params.push(req.session.userId);
      sql += ` AND (p.manager_id=$${params.length} OR p.id IN (SELECT project_id FROM project_members WHERE user_id=$${params.length}))`;
    }
    if (status) { params.push(status); sql += ` AND p.status=$${params.length}`; }
    if (priority) { params.push(priority); sql += ` AND p.priority=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (p.name ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.client_name ILIKE $${params.length})`; }
    sql += ' ORDER BY p.updated_at DESC';

    const [projects, stats, byStatus] = await Promise.all([
      query(sql, params),
      query(`SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='active')::int as active,
        COUNT(*) FILTER (WHERE status='planning')::int as planning,
        COUNT(*) FILTER (WHERE status='completed')::int as completed,
        COUNT(*) FILTER (WHERE status='on_hold')::int as on_hold,
        COUNT(*) FILTER (WHERE status='cancelled')::int as cancelled
        FROM projects`)
      ,query(`SELECT status, COUNT(*)::int as count FROM projects GROUP BY status`)
    ]);

    res.render('projects/index', {
      title: 'Quản lý Dự án',
      projects: projects.rows,
      projectsByStatus: byStatus.rows,
      stats: stats.rows[0],
      filters: req.query
    });
  } catch (err) { console.error(err); res.redirect('/dashboard'); }
};

const getCreate = async (req, res) => {
  const users = await query(
    "SELECT id, full_name, role FROM users WHERE is_active=true AND role IN ('pm','admin','director') ORDER BY full_name"
  );
  res.render('projects/form', { title: 'Tạo Dự án mới', project: null, users: users.rows });
};

const postCreate = async (req, res) => {
  const { code, name, description, client_name, client_contact, status, priority,
          start_date, end_date, budget, location, manager_id } = req.body;
  try {
    const result = await query(
      `INSERT INTO projects (code,name,description,client_name,client_contact,status,priority,
        start_date,end_date,budget,location,manager_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [code, name, description, client_name, client_contact,
       status || 'planning', priority || 'medium',
       start_date || null, end_date || null,
       budget || null, location, manager_id || null, req.session.userId]
    );
    req.flash('success', `Dự án "${name}" đã được tạo thành công`);
    res.redirect('/projects/' + result.rows[0].id);
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Mã dự án đã tồn tại' : 'Lỗi tạo dự án: ' + err.message);
    res.redirect('/projects/create');
  }
};

const detail = async (req, res) => {
  try {
    const [project, tasks, members, allUsers, documents, taskStats] = await Promise.all([
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
      query(`SELECT pd.*, u.full_name as uploader_name FROM project_documents pd
             LEFT JOIN users u ON u.id=pd.uploaded_by
             WHERE pd.project_id=$1 ORDER BY pd.created_at DESC`, [req.params.id]),
      query(`SELECT
             COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='done')::int as done,
             COUNT(*) FILTER (WHERE status='in_progress')::int as in_progress,
             COUNT(*) FILTER (WHERE status='todo')::int as todo,
             COUNT(*) FILTER (WHERE status='review')::int as review,
             COUNT(*) FILTER (WHERE due_date < NOW() AND status != 'done')::int as overdue
             FROM tasks WHERE project_id=$1`, [req.params.id])
    ]);
    if (!project.rows.length) { req.flash('error', 'Không tìm thấy dự án'); return res.redirect('/projects'); }
    // Auto-calculate progress from tasks
    const p = project.rows[0];
    const ts = taskStats.rows[0];
    const autoProgress = ts.total > 0 ? Math.round((ts.done / ts.total) * 100) : (p.progress_percent || 0);
    if (ts.total > 0 && autoProgress !== p.progress_percent) {
      query('UPDATE projects SET progress_percent=$1, updated_at=NOW() WHERE id=$2', [autoProgress, p.id]).catch(() => {});
      p.progress_percent = autoProgress;
    }
    res.render('projects/detail', {
      title: p.name,
      project: p,
      tasks: tasks.rows,
      members: members.rows,
      allUsers: allUsers.rows,
      documents: documents.rows,
      taskStats: ts,
      activeTab: req.query.tab || 'overview'
    });
  } catch (err) { console.error(err); res.redirect('/projects'); }
};

const kanban = async (req, res) => {
  try {
    const [project, tasks, allUsers] = await Promise.all([
      query('SELECT * FROM projects WHERE id=$1', [req.params.id]),
      query(`SELECT t.*, u.full_name as assignee_name, u.avatar_url as assignee_avatar
             FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
             WHERE t.project_id=$1 ORDER BY
               CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               t.due_date ASC NULLS LAST`, [req.params.id]),
      query(`SELECT id, full_name, avatar_url, role, department
             FROM users WHERE is_active=true ORDER BY full_name`)
    ]);
    if (!project.rows.length) return res.redirect('/projects');
    res.render('projects/kanban', {
      title: 'Kanban - ' + project.rows[0].name,
      project: project.rows[0],
      tasks: tasks.rows,
      members: allUsers.rows
    });
  } catch (err) { console.error(err); res.redirect('/projects'); }
};

const gantt = async (req, res) => {
  try {
    const [project, tasks] = await Promise.all([
      query('SELECT * FROM projects WHERE id=$1', [req.params.id]),
      query(`SELECT t.*, u.full_name as assignee_name FROM tasks t
             LEFT JOIN users u ON u.id=t.assignee_id
             WHERE t.project_id=$1 ORDER BY t.start_date ASC NULLS LAST, t.created_at`, [req.params.id])
    ]);
    if (!project.rows.length) return res.redirect('/projects');
    res.render('projects/gantt', {
      title: 'Gantt - ' + project.rows[0].name,
      project: project.rows[0],
      tasks: tasks.rows
    });
  } catch (err) { console.error(err); res.redirect('/projects'); }
};

const getEdit = async (req, res) => {
  const [project, users] = await Promise.all([
    query('SELECT * FROM projects WHERE id=$1', [req.params.id]),
    query("SELECT id, full_name FROM users WHERE is_active=true AND role IN ('pm','admin','director') ORDER BY full_name")
  ]);
  if (!project.rows.length) return res.redirect('/projects');
  res.render('projects/form', { title: 'Chỉnh sửa Dự án', project: project.rows[0], users: users.rows });
};

const postEdit = async (req, res) => {
  const { code, name, description, client_name, client_contact, status, priority,
          start_date, end_date, budget, location, manager_id } = req.body;
  try {
    await query(
      `UPDATE projects SET code=$1,name=$2,description=$3,client_name=$4,client_contact=$5,
       status=$6,priority=$7,start_date=$8,end_date=$9,budget=$10,location=$11,manager_id=$12,
       updated_at=NOW() WHERE id=$13`,
      [code, name, description, client_name, client_contact, status, priority,
       start_date || null, end_date || null, budget || null, location, manager_id || null, req.params.id]
    );
    req.flash('success', 'Cập nhật dự án thành công');
    res.redirect('/projects/' + req.params.id);
  } catch (err) {
    req.flash('error', 'Lỗi cập nhật: ' + err.message);
    res.redirect('/projects/' + req.params.id + '/edit');
  }
};

const deleteProject = async (req, res) => {
  await query("UPDATE projects SET status='cancelled', updated_at=NOW() WHERE id=$1", [req.params.id]);
  req.flash('success', 'Đã hủy dự án');
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
  await query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2', [req.params.id, req.body.user_id]);
  req.flash('success', 'Đã xóa thành viên khỏi dự án');
  res.redirect('/projects/' + req.params.id);
};

const updateProgress = async (req, res) => {
  try {
    await query('UPDATE projects SET progress_percent=$1, updated_at=NOW() WHERE id=$2',
      [req.body.progress, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const membersJson = async (req, res) => {
  try {
    const members = await query(
      'SELECT u.id, u.full_name, u.role FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=$1 ORDER BY u.full_name',
      [req.params.id]
    );
    res.json({ members: members.rows });
  } catch (err) {
    res.json({ members: [] });
  }
};

const uploadDocument = async (req, res) => {
  if (!req.file) { req.flash('error', 'Vui lòng chọn file'); return res.redirect('/projects/' + req.params.id + '?tab=documents'); }
  const { name, doc_type, description } = req.body;
  try {
    await query(
      `INSERT INTO project_documents (project_id, name, file_url, file_name, file_size, doc_type, description, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id, name || req.file.originalname, '/uploads/files/' + req.file.filename,
       req.file.originalname, req.file.size, doc_type || 'other', description, req.session.userId]
    );
    audit.log(req.session.userId, 'UPLOAD', 'project_doc', req.params.id,
      `Upload tài liệu: ${name || req.file.originalname}`, null, null, req.ip);
    req.flash('success', 'Đã tải lên tài liệu');
  } catch (err) { req.flash('error', 'Lỗi: ' + err.message); }
  res.redirect('/projects/' + req.params.id + '?tab=documents');
};

const deleteDocument = async (req, res) => {
  await query('DELETE FROM project_documents WHERE id=$1 AND project_id=$2', [req.params.docId, req.params.id]);
  req.flash('success', 'Đã xóa tài liệu');
  res.redirect('/projects/' + req.params.id + '?tab=documents');
};

module.exports = { index, getCreate, postCreate, detail, kanban, gantt, getEdit, postEdit, deleteProject, addMember, removeMember, updateProgress, membersJson, uploadDocument, deleteDocument };
