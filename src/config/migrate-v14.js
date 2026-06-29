const { pool } = require('./database');

module.exports = async function migrateV14() {
  const client = await pool.connect();
  try {
    // Ensure payroll_records table exists with all required columns
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_records (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES users(id),
        month         INTEGER NOT NULL,
        year          INTEGER NOT NULL,
        base_salary   NUMERIC(15,2) DEFAULT 0,
        working_days  INTEGER DEFAULT 26,
        actual_days   INTEGER DEFAULT 0,
        overtime_hours NUMERIC(8,2) DEFAULT 0,
        overtime_pay  NUMERIC(15,2) DEFAULT 0,
        bonus         NUMERIC(15,2) DEFAULT 0,
        deductions    NUMERIC(15,2) DEFAULT 0,
        insurance     NUMERIC(15,2) DEFAULT 0,
        tax           NUMERIC(15,2) DEFAULT 0,
        net_salary    NUMERIC(15,2) DEFAULT 0,
        notes         TEXT,
        status        VARCHAR(20) DEFAULT 'draft',
        created_by    UUID REFERENCES users(id),
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, month, year)
      )
    `);

    // Add any missing columns to existing tables
    const cols = [
      `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft'`,
      `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id)`,
      `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP`,
      `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id)`,
      `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS signature_hash VARCHAR(128)`,
      `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    ];
    for (const sql of cols) {
      try { await client.query(sql); } catch (_) {}
    }

    // Ensure unique constraint on (user_id,month,year) exists
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='payroll_records'::regclass AND contype='u'
        ) THEN
          BEGIN
            ALTER TABLE payroll_records ADD CONSTRAINT payroll_records_user_id_month_year_key UNIQUE (user_id, month, year);
          EXCEPTION WHEN others THEN NULL;
          END;
        END IF;
      END $$
    `);

    console.log('[migrate-v14] payroll_records schema ensured');
  } catch (err) {
    console.error('[migrate-v14] Error:', err.message);
  } finally {
    client.release();
  }
};
