const { pool } = require('./database');

module.exports = async function migrateV6() {
  const client = await pool.connect();
  try {
    const statements = [
      `ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) DEFAULT 'consumable' CHECK (item_type IN ('consumable','tool','asset'))`,
      `ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS item_status VARCHAR(20) DEFAULT 'available' CHECK (item_status IN ('available','in_use','maintenance','lost'))`,
      `ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS assigned_project_id UUID REFERENCES projects(id) ON DELETE SET NULL`,
      `ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP`,
      `CREATE TABLE IF NOT EXISTS warehouse_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id UUID NOT NULL REFERENCES warehouse_items(id),
        assignment_type VARCHAR(10) NOT NULL CHECK (assignment_type IN ('personal','project')),
        assigned_to_user UUID REFERENCES users(id),
        assigned_to_project UUID REFERENCES projects(id),
        quantity NUMERIC NOT NULL DEFAULT 1,
        notes TEXT,
        signature_data TEXT,
        signed_at TIMESTAMP,
        signed_ip VARCHAR(50),
        assigned_by UUID REFERENCES users(id),
        assigned_at TIMESTAMP DEFAULT NOW(),
        returned_at TIMESTAMP,
        returned_by UUID REFERENCES users(id),
        status VARCHAR(10) DEFAULT 'active' CHECK (status IN ('active','returned')),
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_wa_item ON warehouse_assignments(item_id)`,
      `CREATE INDEX IF NOT EXISTS idx_wa_user ON warehouse_assignments(assigned_to_user)`,
      `CREATE INDEX IF NOT EXISTS idx_wa_status ON warehouse_assignments(status)`,
      `ALTER TABLE warehouse_transactions ADD COLUMN IF NOT EXISTS signature_data TEXT`,
      `ALTER TABLE warehouse_transactions ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP`,
      `ALTER TABLE warehouse_transactions ADD COLUMN IF NOT EXISTS signed_ip VARCHAR(50)`,
      `ALTER TABLE warehouse_transactions ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES warehouse_assignments(id)`,
      `INSERT INTO warehouse_categories (name, description)
       SELECT 'Vật tư phụ', 'Vật tư tiêu hao, quản lý theo số lượng'
       WHERE NOT EXISTS (SELECT 1 FROM warehouse_categories LIMIT 1)`,
      `INSERT INTO warehouse_categories (name, description)
       SELECT 'Dụng cụ thi công', 'Công cụ, dụng cụ quản lý theo trạng thái'
       WHERE (SELECT COUNT(*) FROM warehouse_categories) < 2`,
      `INSERT INTO warehouse_categories (name, description)
       SELECT 'Hàng hóa dự án', 'Tài sản gắn với dự án cụ thể'
       WHERE (SELECT COUNT(*) FROM warehouse_categories) < 3`
    ];

    for (const sql of statements) {
      try {
        await client.query(sql);
      } catch (err) {
        console.error('[migrate-v6] Statement error:', err.message);
      }
    }
    console.log('[migrate-v6] Migration complete');
  } catch (err) {
    console.error('[migrate-v6] Fatal error:', err.message);
  } finally {
    client.release();
  }
};
