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
      if (prev.status !== status && ['review', 'done'].includes(status)) {
        _notifyPM(prev.project_id, title, status, req.params.id, req.session.userId);
      }
    }
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true });
    }
    req.flash('success', 'Đã cập nhật task');
    res.redirect('/projects/' + (old.rows[0]?.project_id || '') + '/kanban');
  } catch (err) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    req.flash('error', 'Lỗi cập nhật task');
    res.redirect('back');
  }
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
      const prev = old.rows[0];
      if (prev.status !== status) {
        audit.log(req.session.userId, 'STATUS', 'task', req.params.id,
          `Đổi trạng thái task "${prev.title}": ${prev.status} → ${status}`,
          { status: prev.status }, { status }, req.ip);
        if (['review', 'done'].includes(status)) {
          _notifyPM(prev.project_id, prev.title, status, req.params.id, req.session.userId);
        }
      }
      const stats = await query(
        `SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status='done')::int as done FROM tasks WHERE project_id=$1`,
        [prev.project_id]
      );
      if (stats.rows[0].total > 0) {
        const auto = Math.round((stats.rows[0].done / stats.rows[0].total) * 100);
        query('UPDATE projects SET progress_percent=$1, updated_at=NOW() WHERE id=$2', [auto, prev.project_id]).catch(() => {});
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

async function _notifyPM(projectId, taskTitle, status, taskId, actorId) {
  try {
    const proj = await query('SELECT manager_id FROM projects WHERE id=$1', [projectId]);
    const managerId = proj.rows[0]?.manager_id;
    if (managerId && managerId !== actorId) {
      const title = status === 'review'
        ? `Task "${taskTitle}" đang chờ kiểm tra`
        : `Task "${taskTitle}" đã hoàn thành`;
      notify.create(managerId, status === 'review' ? 'task_review' : 'task_done', 'work',
        title, null, `/tasks/${taskId}/edit`);
    }
  } catch (e) { /* silent */ }
}

const deleteTask = async (req, res) => {
  try {
    const role = req.session.userRole;
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
  const { content } = req.body;
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
    const [task, members, comments, timeLogs, attachments] = await Promise.all([
      query('SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1', [req.params.id]),
      query('SELECT u.id, u.full_name, u.role FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=(SELECT project_id FROM tasks WHERE id=$1)', [req.params.id]),
      query('SELECT tc.*, u.full_name, u.avatar_url FROM task_comments tc JOIN users u ON u.id=tc.user_id WHERE tc.task_id=$1 ORDER BY tc.created_at ASC', [req.params.id]),
      query('SELECT tl.*, u.full_name FROM time_logs tl JOIN users u ON u.id=tl.user_id WHERE tl.task_id=$1 ORDER BY tl.log_date DESC', [req.params.id]),
      query('SELECT ta.*, u.full_name as uploader_name FROM task_attachments ta JOIN users u ON u.id=ta.uploaded_by WHERE ta.task_id=$1 ORDER BY ta.created_at DESC', [req.params.id])
    ]);
    if (!task.rows.length) return res.redirect('/projects');
    const t = task.rows[0];
    if (role === 'guest') {
      req.flash('error', 'Bạn không có quyền');
      return res.redirect('back');
    }
    if (!['admin', 'director', 'pm'].includes(role)) {
      if (t.assignee_id !== req.session.userId && t.created_by !== req.session.userId) {
        req.flash('error', 'Bạn chỉ có thể chỉnh sửa task được giao cho mình');
        return res.redirect('back');
      }
    }
    const totalHours = timeLogs.rows.reduce((s, r) => s + parseFloat(r.hours_spent || 0), 0);
    res.render('tasks/edit', {
      title: 'Chi tiết Task: ' + t.title,
      task: t,
      members: members.rows,
      comments: comments.rows,
      timeLogs: timeLogs.rows,
      totalHours,
      attachments: attachments.rows
    });
  } catch (err) { console.error(err); res.redirect('/projects'); }
};

const logTime = async (req, res) => {
  const { hours_spent, log_date, notes } = req.body;
  try {
    const hours = parseFloat(hours_spent);
    if (!hours || hours <= 0) throw new Error('Số giờ không hợp lệ');
    await query(
      'INSERT INTO time_logs (task_id, user_id, hours_spent, log_date, notes) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.session.userId, hours, log_date || new Date().toISOString().split('T')[0], notes || null]
    );
    await query(
      'UPDATE tasks SET actual_hours=COALESCE((SELECT SUM(hours_spent) FROM time_logs WHERE task_id=$1),0), updated_at=NOW() WHERE id=$1',
      [req.params.id]
    );
    req.flash('success', `Đã ghi nhận ${hours}h làm việc`);
  } catch (err) { req.flash('error', err.message); }
  res.redirect(`/tasks/${req.params.id}/edit`);
};

const uploadAttachment = async (req, res) => {
  if (!req.file) { req.flash('error', 'Vui lòng chọn file'); return res.redirect('back'); }
  try {
    await query(
      `INSERT INTO task_attachments (task_id, uploaded_by, file_url, file_name, original_name, file_size)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.params.id, req.session.userId,
       '/uploads/tasks/' + req.file.filename,
       req.file.filename, req.file.originalname, req.file.size]
    );
    req.flash('success', 'Đã đính kèm: ' + req.file.originalname);
  } catch (err) { req.flash('error', 'Lỗi tải file: ' + err.message); }
  res.redirect(`/tasks/${req.params.id}/edit`);
};

const deleteAttachment = async (req, res) => {
  try {
    await query('DELETE FROM task_attachments WHERE id=$1 AND task_id=$2', [req.params.attachId, req.params.id]);
    req.flash('success', 'Đã xóa file đính kèm');
  } catch (err) { req.flash('error', 'Lỗi xóa file'); }
  res.redirect(`/tasks/${req.params.id}/edit`);
};

const myTasks = async (req, res) => {
  try {
    const userId = req.session.userId;
    const [overdueTasks, todayTasks, upcomingTasks, doneTasks, stats] = await Promise.all([
      query(`SELECT t.*, p.name as project_name, p.id as project_id
             FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status != 'done' AND t.due_date < CURRENT_DATE
             ORDER BY t.due_date ASC, CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END`, [userId]),
      query(`SELECT t.*, p.name as project_name, p.id as project_id
             FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status != 'done' AND t.due_date = CURRENT_DATE
             ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END`, [userId]),
      query(`SELECT t.*, p.name as project_name, p.id as project_id
             FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status != 'done'
               AND (t.due_date > CURRENT_DATE OR t.due_date IS NULL)
             ORDER BY t.due_date ASC NULLS LAST,
               CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END
             LIMIT 30`, [userId]),
      query(`SELECT t.*, p.name as project_name
             FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status='done'
             ORDER BY t.completed_at DESC LIMIT 10`, [userId]),
      query(`SELECT
             COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='done')::int as done,
             COUNT(*) FILTER (WHERE status != 'done' AND due_date < CURRENT_DATE)::int as overdue,
             COUNT(*) FILTER (WHERE status != 'done' AND due_date = CURRENT_DATE)::int as today,
             COALESCE(SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END),0)::int as pending
             FROM tasks WHERE assignee_id=$1`, [userId])
    ]);
    res.render('tasks/my-tasks', {
      title: 'Công việc của tôi',
      overdueTasks: overdueTasks.rows,
      todayTasks: todayTasks.rows,
      upcomingTasks: upcomingTasks.rows,
      doneTasks: doneTasks.rows,
      stats: stats.rows[0]
    });
  } catch (err) { console.error(err); res.redirect('/dashboard'); }
};

module.exports = {
  createTask, updateTask, deleteTask, addComment, updateStatus, getEdit,
  logTime, uploadAttachment, deleteAttachment, myTasks
};
