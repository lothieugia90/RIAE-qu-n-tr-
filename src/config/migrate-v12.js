const { pool } = require('./database');

module.exports = async function migrateV12() {
  const client = await pool.connect();
  try {
    // Return signature columns on warehouse_assignments
    await client.query(`ALTER TABLE warehouse_assignments ADD COLUMN IF NOT EXISTS return_signed_at TIMESTAMP`);
    await client.query(`ALTER TABLE warehouse_assignments ADD COLUMN IF NOT EXISTS return_signed_by UUID REFERENCES users(id)`);
    await client.query(`ALTER TABLE warehouse_assignments ADD COLUMN IF NOT EXISTS return_signature_hash VARCHAR(128)`);

    // Expand document_type check to include warehouse_return
    await client.query(`ALTER TABLE document_signatures DROP CONSTRAINT IF EXISTS document_signatures_document_type_check`);
    await client.query(`
      ALTER TABLE document_signatures
        ADD CONSTRAINT document_signatures_document_type_check
        CHECK (document_type IN ('payroll','warehouse_assignment','warehouse_return','request','warehouse_transaction'))
    `);

    console.log('[migrate-v12] Done: warehouse return signature columns');
  } catch (err) {
    console.error('[migrate-v12] Error:', err.message);
  } finally {
    client.release();
  }
};
