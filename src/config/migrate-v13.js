const { pool } = require('./database');

module.exports = async function migrateV13() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    await client.query(`ALTER TABLE payroll_records    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    console.log('[migrate-v13] Done: updated_at on attendance_records + payroll_records');
  } catch (err) {
    console.error('[migrate-v13] Error:', err.message);
  } finally {
    client.release();
  }
};
