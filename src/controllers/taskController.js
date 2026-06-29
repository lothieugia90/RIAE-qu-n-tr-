const { query } = require('../config/database');
const audit = require('../utils/audit');
const notify = require('../utils/notify');

const createTask = async (req, res) => {
  const { project_id, title, description, assignee_id, priority, due_date, estimated_hours, status, workflow_stage_id } = req.body;
  try {
    const validStatuses = ['todo', 'in_progress', 'review', 'done'];
    const taskStatus = validStatuses.includes(status) ? status : 'todo';
    const result = await query(
      `INSERT INTO tasks (project_id,title,description,assignee_id,priority,status,due_date,estimated_hours,workflow_stage_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [project_id, title, description || null, assignee_id || null,
       priority || 'medium', taskStatus, due_date || null, estimated_hours || null,
       workflow_stage_id || null, req.session.userId]
    );
    const newId = result.rows[0].id;
    audit.log(req.session.userId, 'CREATE', 'task', newId,
      `Tạo task: ${title}`, null, { title, project_id, priority }, req.ip);
    if (assignee_id) {
      // Auto-add assignee to project members if not already a member
      await query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [project_id, assignee_id, 'member']
      );
      if (assignee_id !== req.session.userId) {
        notify.create(assignee_id, 'task_assigned', 'work',
          `Bạn được giao task: ${title}`,
          `Mức ưu tiên: ${priority || 'medium'}`,
          `/projects/${project_id}/kanban`);
      }
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
      // Auto-add new assignee to project members
      if (assignee_id && assignee_id !== prev.assignee_id) {
        query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [prev.project_id, assignee_id, 'member']).catch(() => {});
        if (assignee_id !== req.session.userId) {
          notify.create(assignee_id, 'task_assigned', 'work',
            `Bạn được giao task: ${title}`, null, `/tasks/${req.params.id}/edit`);
        }
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
    const [task, members, comments, timeLogs, attachments, checklists] = await Promise.all([
      query(`SELECT t.*, p.name as project_name, p.workflow_id,
             ws.name as stage_name, ws.color as stage_color, ws.is_approval_gate, ws.stage_order,
             cu.full_name as co_assignee_name
             FROM tasks t
             JOIN projects p ON p.id=t.project_id
             LEFT JOIN workflow_stages ws ON ws.id=t.workflow_stage_id
             LEFT JOIN users cu ON cu.id=t.co_assignee_id
             WHERE t.id=$1`, [req.params.id]),
      query('SELECT id, full_name, role, department FROM users WHERE is_active=true ORDER BY full_name'),
      query('SELECT tc.*, u.full_name, u.avatar_url FROM task_comments tc JOIN users u ON u.id=tc.user_id WHERE tc.task_id=$1 ORDER BY tc.created_at ASC', [req.params.id]),
      query('SELECT tl.*, u.full_name FROM time_logs tl JOIN users u ON u.id=tl.user_id WHERE tl.task_id=$1 ORDER BY tl.log_date DESC', [req.params.id]),
      query('SELECT ta.*, u.full_name as uploader_name FROM task_attachments ta JOIN users u ON u.id=ta.uploaded_by WHERE ta.task_id=$1 ORDER BY ta.created_at DESC', [req.params.id]),
      query('SELECT tc.*, u.full_name as done_by_name FROM task_checklists tc LEFT JOIN users u ON u.id=tc.done_by WHERE tc.task_id=$1 ORDER BY tc.sort_order', [req.params.id]),
    ]);
    if (!task.rows.length) return res.redirect('/projects');
    const t = task.rows[0];
    if (role === 'guest') {
      req.flash('error', 'Bạn không có quyền');
      return res.redirect('back');
    }
    if (!['admin', 'director', 'pm', 'head_tech', 'head_hr', 'head_sales'].includes(role)) {
      if (t.assignee_id !== req.session.userId && t.created_by !== req.session.userId && t.co_assignee_id !== req.session.userId) {
        req.flash('error', 'Bạn chỉ có thể chỉnh sửa task được giao cho mình');
        return res.redirect('back');
      }
    }
    // Load workflow stages if project has workflow
    let workflowStages = [];
    if (t.workflow_id) {
      const stRes = await query('SELECT * FROM workflow_stages WHERE workflow_id=$1 ORDER BY stage_order', [t.workflow_id]);
      workflowStages = stRes.rows;
    }
    const canApproveGate = ['admin','director','pm','head_tech','head_hr','head_sales','field_supervisor'].includes(role);
    const totalHours = timeLogs.rows.reduce((s, r) => s + parseFloat(r.hours_spent || 0), 0);
    res.render('tasks/edit', {
      title: 'Chi tiết Task: ' + t.title,
      task: t,
      members: members.rows,
      comments: comments.rows,
      timeLogs: timeLogs.rows,
      totalHours,
      attachments: attachments.rows,
      checklists: checklists.rows,
      workflowStages,
      canApproveGate,
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
    const role = req.session.userRole;
    const isWarehouse = ['admin','director','warehouse','warehouse_keeper'].includes(role);

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

    // Action items — separate try/catch so task data always renders
    let pendingApprovals = [], needsSignature = [], pendingReturns = [];
    try {
      const [aRes, sRes, rRes] = await Promise.all([
        query(`SELECT r.id, r.title, r.created_at, u.full_name as requester_name, ra.step_name
          FROM requests r
          JOIN request_approvals ra ON ra.request_id = r.id
          JOIN users u ON u.id = r.submitted_by
          WHERE ra.approver_id = $1 AND ra.status = 'pending' AND r.status = 'pending'
          ORDER BY r.created_at ASC`, [userId]),

        query(`SELECT wa.id, wi.name as item_name, wa.quantity, wi.unit, wa.assigned_at,
                 u2.full_name as assigner_name
          FROM warehouse_assignments wa
          JOIN warehouse_items wi ON wi.id = wa.item_id
          LEFT JOIN users u2 ON u2.id = wa.assigned_by
          WHERE wa.assigned_to_user = $1 AND wa.status = 'active' AND wa.signed_at IS NULL
          ORDER BY wa.assigned_at DESC`, [userId]),

        isWarehouse ? query(`SELECT wa.id, wi.name as item_name, wa.quantity, wi.unit,
                 u.full_name as assignee_name, wa.return_requested_at
          FROM warehouse_assignments wa
          JOIN warehouse_items wi ON wi.id = wa.item_id
          LEFT JOIN users u ON u.id = wa.assigned_to_user
          WHERE wa.status = 'pending_return'
          ORDER BY wa.return_requested_at ASC`) : { rows: [] }
      ]);
      pendingApprovals = aRes.rows;
      needsSignature   = sRes.rows;
      pendingReturns   = rRes.rows;
    } catch (e) { console.error('myTasks action items:', e.message); }

    res.render('tasks/my-tasks', {
      title: 'Công việc của tôi',
      overdueTasks: overdueTasks.rows,
      todayTasks: todayTasks.rows,
      upcomingTasks: upcomingTasks.rows,
      doneTasks: doneTasks.rows,
      stats: stats.rows[0],
      pendingApprovals,
      needsSignature,
      pendingReturns
    });
  } catch (err) { console.error(err); res.redirect('/dashboard'); }
};

// ── Move workflow stage ───────────────────────────────────────────────────────
const moveStage = async (req, res) => {
  const { stage_id, comment } = req.body;
  try {
    const taskRes = await query(
      `SELECT t.*, ws.is_approval_gate as cur_gate, ws.name as cur_stage_name,
              p.manager_id
       FROM tasks t
       LEFT JOIN workflow_stages ws ON ws.id=t.workflow_stage_id
       LEFT JOIN projects p ON p.id=t.project_id
       WHERE t.id=$1`, [req.params.id]
    );
    if (!taskRes.rows.length) throw new Error('Task không tồn tại');
    const task = taskRes.rows[0];

    // Leaving an approval gate requires PM/manager role
    if (task.cur_gate) {
      const role = req.session.userRole;
      const canPass = ['admin','director','pm','head_tech','head_hr','head_sales','field_supervisor'].includes(role)
                   || req.session.userId === task.manager_id;
      if (!canPass) {
        if (req.xhr || req.headers.accept?.includes('json')) {
          return res.status(403).json({ success: false, error: 'Bạn không có quyền phê duyệt bước này' });
        }
        req.flash('error', 'Chỉ PM hoặc quản lý mới có thể phê duyệt bước này');
        return res.redirect('/tasks/' + req.params.id + '/edit');
      }
    }

    // Get target stage info
    let newStatus = 'in_progress', stageName = 'Không có stage';
    let targetStage = null;
    if (stage_id) {
      const stRes = await query('SELECT * FROM workflow_stages WHERE id=$1', [stage_id]);
      targetStage = stRes.rows[0];
      if (targetStage) {
        newStatus = targetStage.maps_to_status || 'in_progress';
        stageName = targetStage.name;
      }
    }
    if (!stage_id) newStatus = 'done';

    const completedAt = newStatus === 'done' ? new Date() : null;
    await query(
      `UPDATE tasks SET workflow_stage_id=$1, status=$2, stage_changed_at=NOW(),
       completed_at=$3, updated_at=NOW() WHERE id=$4`,
      [stage_id || null, newStatus, completedAt, req.params.id]
    );

    // Log to activity
    audit.log(req.session.userId, 'STAGE_MOVE', 'task', req.params.id,
      `Chuyển bước → ${stageName}${comment ? ': ' + comment : ''}`,
      { stage: task.cur_stage_name }, { stage: stageName }, req.ip);

    // Notify PM if approval gate or done
    if (targetStage?.is_approval_gate || newStatus === 'done') {
      if (task.manager_id && task.manager_id !== req.session.userId) {
        await notify.create(task.manager_id, 'info', 'project',
          `Task cần phê duyệt: ${task.title}`,
          `Task "${task.title}" đã chuyển sang bước "${stageName}" — cần phê duyệt`,
          '/tasks/' + req.params.id + '/edit'
        );
      }
    }

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, message: `Đã chuyển sang: ${stageName}`, stageName, status: newStatus });
    }
    req.flash('success', `Đã chuyển sang: ${stageName}`);
    res.redirect('/tasks/' + req.params.id + '/edit');
  } catch (err) {
    console.error(err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, error: err.message });
    }
    req.flash('error', err.message);
    res.redirect('/tasks/' + req.params.id + '/edit');
  }
};

// ── Checklist CRUD ────────────────────────────────────────────────────────────
const addChecklist = async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.json({ success: false, error: 'Tiêu đề không được trống' });
  try {
    const r = await query(
      `INSERT INTO task_checklists (task_id, title, created_by, sort_order)
       VALUES ($1,$2,$3,
         COALESCE((SELECT MAX(sort_order)+1 FROM task_checklists WHERE task_id=$1), 0))
       RETURNING *`,
      [req.params.id, title.trim(), req.session.userId]
    );
    res.json({ success: true, item: r.rows[0] });
  } catch (err) { res.json({ success: false, error: err.message }); }
};

const toggleChecklist = async (req, res) => {
  try {
    const cur = await query('SELECT * FROM task_checklists WHERE id=$1 AND task_id=$2', [req.params.cid, req.params.id]);
    if (!cur.rows.length) return res.json({ success: false });
    const isDone = !cur.rows[0].is_done;
    await query(
      `UPDATE task_checklists SET is_done=$1, done_by=$2, done_at=$3 WHERE id=$4`,
      [isDone, isDone ? req.session.userId : null, isDone ? new Date() : null, req.params.cid]
    );
    res.json({ success: true, item: { id: req.params.cid, is_done: isDone } });
  } catch (err) { res.json({ success: false, error: err.message }); }
};

const deleteChecklist = async (req, res) => {
  try {
    await query('DELETE FROM task_checklists WHERE id=$1 AND task_id=$2', [req.params.cid, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
};

module.exports = {
  createTask, updateTask, deleteTask, addComment, updateStatus, getEdit,
  logTime, uploadAttachment, deleteAttachment, myTasks,
  moveStage, addChecklist, toggleChecklist, deleteChecklist
};
