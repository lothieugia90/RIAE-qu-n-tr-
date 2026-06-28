require('dotenv').config();
const { pool } = require('../src/config/database');
const bcrypt = require('bcryptjs');

async function resetAdmin() {
  const hash = await bcrypt.hash('Admin@2024', 12);

  // Xóa user admin cũ nếu có
  await pool.query("DELETE FROM users WHERE username = 'admin'");

  // Tạo lại admin
  await pool.query(
    `INSERT INTO users (username, email, password_hash, full_name, role, department, position, is_active)
     VALUES ('admin', 'admin@riae.vn', $1, 'Quản Trị Hệ Thống', 'admin', 'IT', 'System Administrator', true)`,
    [hash]
  );

  console.log('✅ Admin reset thành công!');
  console.log('   Username: admin');
  console.log('   Password: Admin@2024');
  await pool.end();
}

resetAdmin().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
