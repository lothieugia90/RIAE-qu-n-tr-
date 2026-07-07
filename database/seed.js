// Seed tài khoản admin đầu tiên. Chỉ tạo nếu chưa có user nào.
// Dùng: npm run seed
// Mật khẩu lấy từ ADMIN_PASSWORD trong .env, bắt buộc đổi sau lần đăng nhập đầu.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/database');

async function seed() {
  try {
    const existing = await pool.query('SELECT COUNT(*)::int AS c FROM users');
    if (existing.rows[0].c > 0) {
      console.log('Users already exist, skipping seed.');
      return;
    }
    const password = process.env.ADMIN_PASSWORD || 'Admin@2026';
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, department, position)
       VALUES ('admin', 'admin@riae.vn', $1, 'Quản trị hệ thống', 'admin', 'Ban Giám đốc', 'Administrator')`,
      [hash]
    );
    console.log('Admin account created: admin /', password);
    console.log('>>> Hãy đổi mật khẩu ngay sau lần đăng nhập đầu tiên.');
  } finally {
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
