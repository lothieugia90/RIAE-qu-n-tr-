const { pool } = require('./database');

module.exports = async function migrateV11() {
  const client = await pool.connect();
  try {
    // Central signature log for all document types
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_signatures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        document_type VARCHAR(30) NOT NULL CHECK (document_type IN ('payroll','warehouse_assignment','request','warehouse_transaction')),
        document_id UUID NOT NULL,
        signature_data TEXT NOT NULL,
        signature_hash VARCHAR(128) NOT NULL,
        ip_address VARCHAR(60),
        user_agent TEXT,
        pdf_url TEXT,
        signed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        is_valid BOOLEAN DEFAULT true,
        UNIQUE(document_type, document_id, user_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_docsig_doc ON document_signatures(document_type, document_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_docsig_user ON document_signatures(user_id)`);

    // Add signed_by / signed_at to payroll_records if missing
    await client.query(`ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP`);
    await client.query(`ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id)`);
    await client.query(`ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS signature_hash VARCHAR(128)`);

    // Add recipient_signed fields to warehouse_assignments
    await client.query(`ALTER TABLE warehouse_assignments ADD COLUMN IF NOT EXISTS recipient_signed_at TIMESTAMP`);
    await client.query(`ALTER TABLE warehouse_assignments ADD COLUMN IF NOT EXISTS recipient_signature_hash VARCHAR(128)`);

    // Add approval_signature to requests
    await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS approval_signature_hash VARCHAR(128)`);
    await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS approval_signed_at TIMESTAMP`);

    console.log('[migrate-v11] Done: document_signatures');
  } catch (err) {
    console.error('[migrate-v11] Error:', err.message);
  } finally {
    client.release();
  }
};
