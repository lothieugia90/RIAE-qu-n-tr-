const { pool } = require('./database');

module.exports = async function migrateV10() {
  const client = await pool.connect();
  try {
    // Workflows table
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT false,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Workflow stages
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_stages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(20) DEFAULT '#6b7280',
        stage_order INTEGER DEFAULT 0,
        is_approval_gate BOOLEAN DEFAULT false,
        maps_to_status VARCHAR(20) DEFAULT 'in_progress',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Checklist items per task
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_checklists (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        is_done BOOLEAN DEFAULT false,
        sort_order INTEGER DEFAULT 0,
        done_by UUID REFERENCES users(id),
        done_at TIMESTAMP,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add columns to tasks
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_stage_id UUID REFERENCES workflow_stages(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMP`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS co_assignee_id UUID REFERENCES users(id) ON DELETE SET NULL`);

    // Add workflow to projects
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL`);

    // Seed default workflow: "Quy trình dự án xây dựng"
    const existing = await client.query(`SELECT id FROM workflows WHERE name='Quy trình dự án xây dựng'`);
    if (!existing.rows.length) {
      const wf = await client.query(
        `INSERT INTO workflows (name, description, is_default) VALUES ($1,$2,true) RETURNING id`,
        ['Quy trình dự án xây dựng', 'Quy trình chuẩn cho các dự án xây dựng và lắp đặt']
      );
      const wfId = wf.rows[0].id;
      const stages = [
        ['Tiếp nhận',       '#64748b', 0, false, 'todo'],
        ['Khảo sát / Thiết kế', '#3b82f6', 1, false, 'in_progress'],
        ['Chờ phê duyệt',   '#f59e0b', 2, true,  'review'],
        ['Đang thi công',   '#8b5cf6', 3, false, 'in_progress'],
        ['Nghiệm thu',      '#f97316', 4, true,  'review'],
        ['Hoàn thành',      '#22c55e', 5, false, 'done'],
      ];
      for (const [name, color, order, gate, status] of stages) {
        await client.query(
          `INSERT INTO workflow_stages (workflow_id, name, color, stage_order, is_approval_gate, maps_to_status)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [wfId, name, color, order, gate, status]
        );
      }
    }

    // Seed default workflow: "Quy trình hành chính"
    const existing2 = await client.query(`SELECT id FROM workflows WHERE name='Quy trình hành chính'`);
    if (!existing2.rows.length) {
      const wf2 = await client.query(
        `INSERT INTO workflows (name, description) VALUES ($1,$2) RETURNING id`,
        ['Quy trình hành chính', 'Quy trình xử lý công việc hành chính nội bộ']
      );
      const wf2Id = wf2.rows[0].id;
      const stages2 = [
        ['Tiếp nhận',  '#64748b', 0, false, 'todo'],
        ['Đang xử lý', '#3b82f6', 1, false, 'in_progress'],
        ['Kiểm duyệt', '#f59e0b', 2, true,  'review'],
        ['Hoàn thành', '#22c55e', 3, false, 'done'],
      ];
      for (const [name, color, order, gate, status] of stages2) {
        await client.query(
          `INSERT INTO workflow_stages (workflow_id, name, color, stage_order, is_approval_gate, maps_to_status)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [wf2Id, name, color, order, gate, status]
        );
      }
    }

    console.log('[migrate-v10] Done: workflows, workflow_stages, task_checklists');
  } catch (err) {
    console.error('[migrate-v10] Error:', err.message);
  } finally {
    client.release();
  }
};
