const { query } = require('../config/database');
const audit = require('../utils/audit');
const notify = require('../utils/notify');

const createTask = async (req, res) => {
  const { project_id, title, description, assignee_id, priority, due_date, estimated_hours, status } = req.body;
  try {
    const validStatuses = ['todo', 'in_progress', 'review', 'done'];
    const taskStatus = validStatuses.includes(status) ? status : 'todo';
    const result = await query(
      `INSERT INTO tasks (project_id,title,description,assignee_id,priority,status,due_date,estimated_hours,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [project_id, title, description || null, assignee_id || null,
       priority || 'medium', taskStatus, due_date || null, estimated_hours || null, req.session.userId]
    );
    const newId = result.rows[0].id;
    audit.log(req.session.userId, 'CREATE', 'task', newId,
      `Tạo task: ${title}`, null, { title, project_id, priority }, req.ip);
    // Notify assignee if different from creator
    if (assignee_id && assignee_id !== req.session.userId) {
      notify.create(assignee_id, 'task_assigned', 'work',
        `Bạn được giao task: ${title}`,
        `Mức ưu tiên: ${priority || 'medium'}`,
        `/projects/${project_id}/kanban`);
    }
    req.flash('success', 'Đã tạo task mới');
    res.redirect('/projects/' + project_id + '/kanban');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi tạo task');
    res.redirect('back');
  }
};

const updateTask = async (req, res) => {
  const { title, description, status, priority, assignee_id, due_date, actual_hours, notes } = req.body;
  try {
    const old = await query('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
    await query(
      `UPDATE tasks SET title=$1,description=$2,status=$3,priority=$4,assignee_id=$5,
       due_date=$6,actual_hours=$7,notes=$8,
       completed_at = CASE WHEN $3::task_status='done' AND completed_at IS NULL THEN NOW()
                          WHEN $3::task_status!='done' THEN NULL
                          ELSE completed_at END,
       updated_at=NOW() WHERE id=$9`,
      [title, description, status, priority, assignee_id || null,
       due_date || null, actual_hours || null, notes, req.params.id]
    );
    if (old.rows.length) {
      const prev = old.rows[0];
      const changes = {};
      if (prev.status !== status) changes.status = { from: prev.status, to: status };
      if (prev.priority !== priority) changes.priority = { from: prev.priority, to: priority };
      if (String(prev.due_date || '') !== String(due_date || '')) changes.due_date = { from: prev.due_date, to: due_date };
      if (Object.keys(changes).length) {
        audit.log(req.session.userId, 'UPDATE', 'task', req.params.id,
          `Cập nhật task: ${title}`, prev, changes, req.ip);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const updateStatus = async (req, res) => {
  const { status } = req.body;
  try {
    const old = await query('SELECT title, status, project_id FROM tasks WHERE id=$1', [req.params.id]);
    await query(
      `UPDATE tasks SET status=$1,
       completed_at = CASE WHEN $1::task_status='done' THEN NOW() ELSE NULL END,
       updated_at=NOW() WHERE id=$2`,
      [status, req.params.id]
    );
    if (old.rows.length) {
      if (old.rows[0].status !== status) {
        audit.log(req.session.userId, 'STATUS', 'task', req.params.id,
          `Đổi trạng thái task "${old.rows[0].title}": ${old.rows[0].status} → ${status}`,
          { status: old.rows[0].status }, { status }, req.ip);
      }
      // Auto-recalculate project progress
      const projectId = old.rows[0].project_id;
      const stats = await query(
        `SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status='done')::int as done FROM tasks WHERE project_id=$1`,
        [projectId]
      );
      if (stats.rows[0].total > 0) {
        const auto = Math.round((stats.rows[0].done / stats.rows[0].total) * 100);
        query('UPDATE projects SET progress_percent=$1, updated_at=NOW() WHERE id=$2', [auto, projectId]).catch(() => {});
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const deleteTask = async (req, res) => {
  try {
    const role = req.session.userRole;
    // Only admin, director, PM, or task creator can delete
    if (!['admin', 'director', 'pm'].includes(role)) {
      const task = await query('SELECT created_by, title FROM tasks WHERE id=$1', [req.params.id]);
      if (!task.rows.length) return res.status(404).json({ error: 'Không tìm thấy task' });
      if (task.rows[0].created_by !== req.session.userId) {
        return res.status(403).json({ error: 'Bạn không có quyền xóa task này' });
      }
    }
    const taskInfo = await query('SELECT title FROM tasks WHERE id=$1', [req.params.id]);
    await query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    audit.log(req.session.userId, 'DELETE', 'task', req.params.id,
      `Xóa task: ${taskInfo.rows[0]?.title || req.params.id}`, null, null, req.ip);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const addComment = async (req, res) => {
  const { content, project_id } = req.body;
  try {
    await query(
      'INSERT INTO task_comments (task_id, user_id, content) VALUES ($1,$2,$3)',
      [req.params.id, req.session.userId, content]
    );
    req.flash('success', 'Đã thêm bình luận');
  } catch (err) { req.flash('error', 'Lỗi thêm bình luận'); }
  res.redirect('back');
};

const getEdit = async (req, res) => {
  try {
    const role = req.session.userRole;
    const [task, members] = await Promise.all([
      query('SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1', [req.params.id]),
      query('SELECT u.id, u.full_name, u.role FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=(SELECT project_id FROM tasks WHERE id=$1)', [req.params.id])
    ]);
    if (!task.rows.length) return res.redirect('/projects');
    const t = task.rows[0];
    // Permission check: guest cannot edit
    if (role === 'guest') {
      req.flash('error', 'Bạn không có quyền chỉnh sửa task');
      return res.redirect('back');
    }
    // Member can only edit their own assigned tasks
    if (!['admin', 'director', 'pm'].includes(role)) {
      if (t.assignee_id !== req.session.userId && t.created_by !== req.session.userId) {
        req.flash('error', 'Bạn chỉ có thể chỉnh sửa task được giao cho mình');
        return res.redirect('back');
      }
    }
    res.render('tasks/edit', { title: 'Chỉnh sửa Task', task: t, members: members.rows });
  } catch(err) { console.error(err); res.redirect('/projects'); }
};

module.exports = { createTask, updateTask, deleteTask, addComment, updateStatus, getEdit };
