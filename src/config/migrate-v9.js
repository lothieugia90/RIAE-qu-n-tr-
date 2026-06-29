const { pool } = require('./database');

module.exports = async function migrateV9() {
  const client = await pool.connect();
  try {
    // Add payment info columns to requests table
    await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_recipient VARCHAR(200)`);
    await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_account  VARCHAR(50)`);
    await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_bank     VARCHAR(150)`);
    await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_amount   DECIMAL(18,2)`);
    await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_note     TEXT`);

    // Add step_name to request_approvals for labeling (Trưởng BP / Giám đốc / Kế toán)
    await client.query(`ALTER TABLE request_approvals ADD COLUMN IF NOT EXISTS step_name VARCHAR(100)`);

    console.log('[migrate-v9] Done: payment fields + step_name on request_approvals');
  } catch (err) {
    console.error('[migrate-v9] Error:', err.message);
  } finally {
    client.release();
  }
};
