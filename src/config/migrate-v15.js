const { pool } = require('./database');

module.exports = async function migrateV15() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS quote_catalog (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code         VARCHAR(50) UNIQUE,
        name         TEXT NOT NULL,
        unit         VARCHAR(30) DEFAULT 'cái',
        unit_price   NUMERIC(15,2) DEFAULT 0,
        category     VARCHAR(50) DEFAULT 'general',
        description  TEXT,
        is_active    BOOLEAN DEFAULT true,
        created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    const cols = [
      `ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS section VARCHAR(100) DEFAULT 'Chung'`,
      `ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS catalog_id UUID REFERENCES quote_catalog(id) ON DELETE SET NULL`,
      `ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`,
      `ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rejected_reason TEXT`,
    ];
    for (const sql of cols) {
      try { await client.query(sql); } catch (_) {}
    }

    console.log('[migrate-v15] quote_catalog + section columns done');
  } catch (err) {
    console.error('[migrate-v15] Error:', err.message);
  } finally {
    client.release();
  }
};
