const { pool } = require('./database');
const { DEFAULT_PERMISSIONS } = require('../utils/roles');

module.exports = async function migrateV8() {
  const client = await pool.connect();
  try {
    // Add new role ENUM values (safe: checks existence first)
    const newRoles = ['head_tech', 'head_hr', 'head_sales', 'field_supervisor', 'tech_deploy', 'warehouse_keeper', 'accountant'];
    for (const val of newRoles) {
      const exists = await client.query(
        `SELECT 1 FROM pg_enum WHERE enumtypid = 'user_role'::regtype AND enumlabel = $1`, [val]
      );
      if (!exists.rows.length) {
        await client.query(`ALTER TYPE user_role ADD VALUE '${val}'`);
        console.log(`[migrate-v8] Added role: ${val}`);
      }
    }

    // Departments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20),
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Positions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(name, department_id)
      )
    `);

    // Role permissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        role VARCHAR(50) NOT NULL,
        module VARCHAR(50) NOT NULL,
        perm_level VARCHAR(20) NOT NULL DEFAULT 'none',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(role, module)
      )
    `);

    // Seed default departments
    const depts = [
      ['Ban lãnh đạo', 'BLD', 1],
      ['Phòng Kinh doanh', 'PKD', 2],
      ['Phòng Kỹ thuật', 'PKT', 3],
      ['Phòng Nhân sự', 'PNS', 4],
      ['Kho', 'KHO', 5],
      ['Kế toán', 'KT', 6],
      ['Admin', 'ADM', 7],
    ];
    for (const [name, code, sort] of depts) {
      await client.query(
        `INSERT INTO departments (name, code, sort_order) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING`,
        [name, code, sort]
      );
    }

    // Seed default role permissions
    for (const [role, modules] of Object.entries(DEFAULT_PERMISSIONS)) {
      for (const [module, perm] of Object.entries(modules)) {
        await client.query(
          `INSERT INTO role_permissions (role, module, perm_level) VALUES ($1,$2,$3) ON CONFLICT (role, module) DO NOTHING`,
          [role, module, perm]
        );
      }
    }

    console.log('[migrate-v8] Done: roles, departments, positions, role_permissions');
  } catch (err) {
    console.error('[migrate-v8] Error:', err.message);
  } finally {
    client.release();
  }
};
