const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(requireAuth);

// Tasks API
router.get('/tasks/:id', async (req, res) => {
  try {
    const result = await query(
      'SELECT t.*, u.full_name as assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=$1',
      [req.params.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tasks/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await query(
      `UPDATE tasks SET status=$1,
       completed_at = CASE WHEN $1::task_status='done' THEN NOW() ELSE NULL END,
       updated_at=NOW() WHERE id=$2`,
      [status, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/projects/:id/tasks', async (req, res) => {
  try {
    const result = await query(
      'SELECT t.*, u.full_name as assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=$1 ORDER BY t.created_at',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/dashboard/stats', async (req, res) => {
  try {
    const projects = await query('SELECT status, COUNT(*)::int as count FROM projects GROUP BY status');
    const tasks = await query('SELECT status, COUNT(*)::int as count FROM tasks GROUP BY status');
    res.json({ projects: projects.rows, tasks: tasks.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/warehouse/items', async (req, res) => {
  try {
    const result = await query('SELECT id, code, name, unit, quantity, unit_price FROM warehouse_items WHERE is_active=true ORDER BY name');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
