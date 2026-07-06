const { query } = require('../config/database');

// Tạo thông báo cá nhân — fire-and-forget, lỗi không làm hỏng request chính.
function notify(userId, type, title, content = null, link = null) {
  if (!userId) return;
  query(
    `INSERT INTO notifications (user_id, type, title, content, link) VALUES ($1,$2,$3,$4,$5)`,
    [userId, type, title, content, link]
  ).catch(err => console.error('notify error:', err.message));
}

module.exports = { notify };
