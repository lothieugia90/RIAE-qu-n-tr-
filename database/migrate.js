// Migration runner: chạy tuần tự các file .sql trong database/migrations/
// theo thứ tự tên file, ghi nhận vào bảng schema_migrations để không chạy lại.
// Dùng: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT version FROM schema_migrations')).rows.map(r => r.version)
    );

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`==> Applying ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
        console.log(`    OK`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`    FAILED: ${err.message}`);
        throw err;
      }
    }

    console.log(ran === 0 ? 'Database is up to date.' : `Applied ${ran} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
