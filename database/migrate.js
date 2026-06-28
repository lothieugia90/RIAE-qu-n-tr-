require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('=== RIAE Database Migration ===');
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    console.log('Migration completed successfully!');
    console.log('');
    console.log('Default admin account:');
    console.log('  Username: admin');
    console.log('  Password: Admin@2024');
    console.log('');
    console.log('Next: npm run dev');
  } catch (err) {
    console.error('Migration error:', err.message);
    if (!err.message.includes('already exists')) process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
