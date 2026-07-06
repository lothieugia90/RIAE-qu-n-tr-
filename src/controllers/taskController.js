const { query } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { notify } = require('../utils/notify');
const { PERM_LEVELS } = require('../config/roles');

const VALID_STATUSES = ['todo', 'in_progress', 'review', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

// Quyền sửa task: quyền tasks=full, hoặc là assignee/người tạo/quản lý dự án
async function canEditTask(req, taskId) {
  const level = await getPermLevel(req.session.userRole, 'tasks');
  if (level === 'full') return { ok: true };
  const r = await query(
    `SELECT t.assignee_id, t.created_by, p.manager_id
     FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1`,
    [taskId]
  );
  if (!r.rows.length) return { ok: false, notFound: true };
  const t = r.rows[0];
  const uid = req.session.userId;
  if (t.assignee_id === uid || t.created_by === uid || t.manager_id === uid) return { ok: true };
  return { ok: false };
}

function wantsJson(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

// Cập nhật tiến độ dự án theo tỷ lệ task done (fire-and-forget)
function refreshProjectProgress(projectId) {
  query(
    `UPDATE projects SET progress_percent = COALESCE(
       (SELECT ROUND(COUNT(*) FILTER (WHERE status='done') * 100.0 / NULLIF(COUNT(*),0))
        FROM tasks WHERE project_id=$1), 0),
     updated_at=NOW() WHERE id=$1`,
    [projectId]
  ).catch(() => {});
}

const createTask = async (req, res) => {
  const { project_id, title, description, assignee_id, priority, due_date, estimated_hours, status, redirect_to } = req.body;
  // Chỉ cho redirect về trang nội bộ của projects/tasks (chống open-redirect)
  const backTo = /^\/(projects|tasks)(\/[\w\-\/]*)?$/.test(redirect_to || '')
    ? redirect_to : (project_id ? `/projects/${project_id}/kanban` : '/projects');
  if (!title?.trim() || !project_id) {
    req.flash('error', 'Tiêu đề task là bắt buộc');
    return res.redirect(backTo);
  }
  try {
    const taskStatus = VALID_STATUSES.includes(status) ? status : 'todo';
    const taskPriority = VALID_PRIORITIES.includes(priority) ? priority : 'medium';
    const result = await query(
      `INSERT INTO tasks (project_id,title,description,assignee_id,priority,status,due_date,estimated_hours,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [project_id, title.trim(), description || null, assignee_id || null,
       taskPriority, taskStatus, due_date || null, estimated_hours || null, req.session.userId]
    );
    logActivity(req.session.userId, 'TASK_CREATE', `Tạo task: ${title.trim()}`,
      { entityType: 'task', entityId: result.rows[0].id, ip: req.ip });
    if (assignee_id) {
      // Người được giao tự động thành thành viên dự án
      await query(
        `INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
        [project_id, assignee_id]
      );
      if (assignee_id !== req.session.userId) {
        notify(assignee_id, 'task_assigned', `Bạn được giao task: ${title.trim()}`,
          `Mức ưu tiên: ${taskPriority}`, `/tasks/${result.rows[0].id}`);
      }
    }
    refreshProjectProgress(project_id);
    req.flash('success', 'Đã tạo task mới');
    res.redirect(backTo);
  } catch (err) {
    console.error('createTask:', err.message);
    req.flash('error', 'Lỗi tạo task');
    res.redirect(backTo);
  }
};

const detail = async (req, res) => {
  try {
    const [task, members, comments, timeLogs, checklists] = await Promise.all([
      query(`SELECT t.*, p.name as project_name, p.manager_id,
             u.full_name as assignee_name, c.full_name as creator_name
             FROM tasks t
             JOIN projects p ON p.id=t.project_id
             LEFT JOIN users u ON u.id=t.assignee_id
             LEFT JOIN users c ON c.id=t.created_by
             WHERE t.id=$1`, [req.params.id]),
      query('SELECT id, full_name, role, department FROM users WHERE is_active=true ORDER BY full_name'),
      query(`SELECT tc.*, u.full_name, u.avatar_url FROM task_comments tc
             JOIN users u ON u.id=tc.user_id WHERE tc.task_id=$1 ORDER BY tc.created_at ASC`, [req.params.id]),
      query(`SELECT tl.*, u.full_name FROM time_logs tl
             JOIN users u ON u.id=tl.user_id WHERE tl.task_id=$1 ORDER BY tl.log_date DESC, tl.created_at DESC`, [req.params.id]),
      query(`SELECT tc.*, u.full_name as done_by_name FROM task_checklists tc
             LEFT JOIN users u ON u.id=tc.done_by WHERE tc.task_id=$1 ORDER BY tc.sort_order, tc.created_at`, [req.params.id])
    ]);
    if (!task.rows.length) {
      req.flash('error', 'Không tìm thấy task');
      return res.redirect('/tasks/my-tasks');
    }
    const t = task.rows[0];
    const edit = await canEditTask(req, req.params.id);
    const totalHours = timeLogs.rows.reduce((s, r) => s + parseFloat(r.hours_spent || 0), 0);
    res.render('tasks/detail', {
      title: t.title,
      task: t,
      members: members.rows,
      comments: comments.rows,
      timeLogs: timeLogs.rows,
      totalHours,
      checklists: checklists.rows,
      canEdit: edit.ok
    });
  } catch (err) {
    console.error('task detail:', err);
    res.redirect('/tasks/my-tasks');
  }
};

const updateTask = async (req, res) => {
  const { title, description, status, priority, assignee_id, due_date, estimated_hours, notes } = req.body;
  const edit = await canEditTask(req, req.params.id);
  if (!edit.ok) {
    req.flash('error', edit.notFound ? 'Không tìm thấy task' : 'Bạn không có quyền sửa task này');
    return res.redirect('/tasks/my-tasks');
  }
  if (!VALID_STATUSES.includes(status) || !VALID_PRIORITIES.includes(priority)) {
    req.flash('error', 'Trạng thái hoặc ưu tiên không hợp lệ');
    return res.redirect(`/tasks/${req.params.id}`);
  }
  try {
    const old = await query('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
    const prev = old.rows[0];
    await query(
      `UPDATE tasks SET title=$1,description=$2,status=$3::varchar,priority=$4,assignee_id=$5,
       due_date=$6,estimated_hours=$7,notes=$8,
       completed_at = CASE WHEN $3::varchar='done' AND completed_at IS NULL THEN NOW()
                           WHEN $3::varchar!='done' THEN NULL ELSE completed_at END,
       updated_at=NOW() WHERE id=$9`,
      [title.trim(), description || null, status, priority, assignee_id || null,
       due_date || null, estimated_hours || null, notes || null, req.params.id]
    );
    if (prev.status !== status) {
      logActivity(req.session.userId, 'TASK_STATUS', `"${title.trim()}": ${prev.status} → ${status}`,
        { entityType: 'task', entityId: req.params.id, ip: req.ip });
      if (['review', 'done'].includes(status)) notifyManager(prev.project_id, title.trim(), status, req.params.id, req.session.userId);
    }
    if (assignee_id && assignee_id !== prev.assignee_id) {
      await query(
        `INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
        [prev.project_id, assignee_id]
      );
      if (assignee_id !== req.session.userId) {
        notify(assignee_id, 'task_assigned', `Bạn được giao task: ${title.trim()}`, null, `/tasks/${req.params.id}`);
      }
    }
    refreshProjectProgress(prev.project_id);
    req.flash('success', 'Đã cập nhật task');
    res.redirect(`/tasks/${req.params.id}`);
  } catch (err) {
    console.error('updateTask:', err.message);
    req.flash('error', 'Lỗi cập nhật task');
    res.redirect(`/tasks/${req.params.id}`);
  }
};

// AJAX: đổi trạng thái (kéo-thả Kanban)
const updateStatus = async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
  const edit = await canEditTask(req, req.params.id);
  if (!edit.ok) return res.status(edit.notFound ? 404 : 403).json({ error: edit.notFound ? 'Không tìm thấy task' : 'Không có quyền' });
  try {
    const old = await query('SELECT title, status, project_id FROM tasks WHERE id=$1', [req.params.id]);
    const prev = old.rows[0];
    await query(
      `UPDATE tasks SET status=$1::varchar,
       completed_at = CASE WHEN $1::varchar='done' THEN NOW() ELSE NULL END,
       updated_at=NOW() WHERE id=$2`,
      [status, req.params.id]
    );
    if (prev.status !== status) {
      logActivity(req.session.userId, 'TASK_STATUS', `"${prev.title}": ${prev.status} → ${status}`,
        { entityType: 'task', entityId: req.params.id, ip: req.ip });
      if (['review', 'done'].includes(status)) notifyManager(prev.project_id, prev.title, status, req.params.id, req.session.userId);
    }
    refreshProjectProgress(prev.project_id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

async function notifyManager(projectId, taskTitle, status, taskId, actorId) {
  try {
    const proj = await query('SELECT manager_id FROM projects WHERE id=$1', [projectId]);
    const managerId = proj.rows[0]?.manager_id;
    if (managerId && managerId !== actorId) {
      notify(managerId, status === 'review' ? 'task_review' : 'task_done',
        status === 'review' ? `Task "${taskTitle}" đang chờ kiểm tra` : `Task "${taskTitle}" đã hoàn thành`,
        null, `/tasks/${taskId}`);
    }
  } catch (e) { /* silent */ }
}

const deleteTask = async (req, res) => {
  try {
    const level = await getPermLevel(req.session.userRole, 'tasks');
    const taskRes = await query('SELECT title, created_by, project_id FROM tasks WHERE id=$1', [req.params.id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: 'Không tìm thấy task' });
    const t = taskRes.rows[0];
    if (level !== 'full' && t.created_by !== req.session.userId) {
      return res.status(403).json({ error: 'Bạn không có quyền xóa task này' });
    }
    await query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    logActivity(req.session.userId, 'TASK_DELETE', `Xóa task: ${t.title}`,
      { entityType: 'task', entityId: req.params.id, ip: req.ip });
    refreshProjectProgress(t.project_id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const addComment = async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) {
    req.flash('error', 'Nội dung bình luận không được trống');
    return res.redirect(`/tasks/${req.params.id}`);
  }
  try {
    await query('INSERT INTO task_comments (task_id, user_id, content) VALUES ($1,$2,$3)',
      [req.params.id, req.session.userId, content.trim()]);
    req.flash('success', 'Đã thêm bình luận');
  } catch (err) { req.flash('error', 'Lỗi thêm bình luận'); }
  res.redirect(`/tasks/${req.params.id}`);
};

const logTime = async (req, res) => {
  const { hours_spent, log_date, notes } = req.body;
  try {
    const hours = parseFloat(hours_spent);
    if (!hours || hours <= 0 || hours > 24) throw new Error('Số giờ không hợp lệ (0–24)');
    await query(
      'INSERT INTO time_logs (task_id, user_id, hours_spent, log_date, notes) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.session.userId, hours, log_date || new Date().toISOString().split('T')[0], notes || null]
    );
    await query(
      `UPDATE tasks SET actual_hours=COALESCE((SELECT SUM(hours_spent) FROM time_logs WHERE task_id=$1),0),
       updated_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    req.flash('success', `Đã ghi nhận ${hours}h làm việc`);
  } catch (err) { req.flash('error', err.message); }
  res.redirect(`/tasks/${req.params.id}`);
};

// Checklist (AJAX)
const addChecklist = async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, error: 'Tiêu đề không được trống' });
  try {
    const r = await query(
      `INSERT INTO task_checklists (task_id, title, created_by, sort_order)
       VALUES ($1,$2,$3, COALESCE((SELECT MAX(sort_order)+1 FROM task_checklists WHERE task_id=$1), 0))
       RETURNING *`,
      [req.params.id, title.trim(), req.session.userId]
    );
    res.json({ success: true, item: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

const toggleChecklist = async (req, res) => {
  try {
    const cur = await query('SELECT is_done FROM task_checklists WHERE id=$1 AND task_id=$2',
      [req.params.cid, req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ success: false });
    const isDone = !cur.rows[0].is_done;
    await query(
      'UPDATE task_checklists SET is_done=$1, done_by=$2, done_at=$3 WHERE id=$4',
      [isDone, isDone ? req.session.userId : null, isDone ? new Date() : null, req.params.cid]
    );
    res.json({ success: true, is_done: isDone });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

const deleteChecklist = async (req, res) => {
  try {
    await query('DELETE FROM task_checklists WHERE id=$1 AND task_id=$2', [req.params.cid, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

const myTasks = async (req, res) => {
  try {
    const userId = req.session.userId;
    const [overdueTasks, todayTasks, upcomingTasks, doneTasks, stats] = await Promise.all([
      query(`SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status != 'done' AND t.due_date < CURRENT_DATE
             ORDER BY t.due_date ASC`, [userId]),
      query(`SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status != 'done' AND t.due_date = CURRENT_DATE
             ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END`, [userId]),
      query(`SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status != 'done'
               AND (t.due_date > CURRENT_DATE OR t.due_date IS NULL)
             ORDER BY t.due_date ASC NULLS LAST,
               CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END
             LIMIT 30`, [userId]),
      query(`SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON p.id=t.project_id
             WHERE t.assignee_id=$1 AND t.status='done'
             ORDER BY t.completed_at DESC NULLS LAST LIMIT 10`, [userId]),
      query(`SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status='done')::int as done,
             COUNT(*) FILTER (WHERE status != 'done' AND due_date < CURRENT_DATE)::int as overdue,
             COUNT(*) FILTER (WHERE status != 'done' AND due_date = CURRENT_DATE)::int as today,
             COUNT(*) FILTER (WHERE status != 'done')::int as pending
             FROM tasks WHERE assignee_id=$1`, [userId])
    ]);
    res.render('tasks/my-tasks', {
      title: 'Việc của tôi',
      overdueTasks: overdueTasks.rows,
      todayTasks: todayTasks.rows,
      upcomingTasks: upcomingTasks.rows,
      doneTasks: doneTasks.rows,
      stats: stats.rows[0]
    });
  } catch (err) {
    console.error('myTasks:', err);
    res.redirect('/dashboard');
  }
};

module.exports = {
  createTask, detail, updateTask, updateStatus, deleteTask, addComment,
  logTime, addChecklist, toggleChecklist, deleteChecklist, myTasks
};
