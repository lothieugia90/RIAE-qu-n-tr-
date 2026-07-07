const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const dbHost = process.env.DB_HOST || 'localhost';
// SSL theo host thực tế, không theo NODE_ENV — Supabase/managed Postgres luôn
// yêu cầu SSL kể cả khi chạy NODE_ENV=development để test từ máy local.
const isLocalHost = ['localhost', '127.0.0.1'].includes(dbHost);

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      host: dbHost,
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'riae_site',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: isLocalHost ? false : { rejectUnauthorized: false }
    });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV === 'development') {
    const duration = Date.now() - start;
    if (duration > 100) console.log('Slow query', { duration, text: text.substring(0, 80) });
  }
  return res;
};

module.exports = { pool, query };
