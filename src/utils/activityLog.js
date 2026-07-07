const { query } = require('../config/database');

// Ghi nhật ký fire-and-forget: lỗi log không được làm hỏng request chính.
function logActivity(userId, action, description, opts = {}) {
  query(
    `INSERT INTO activity_logs (user_id, action, description, entity_type, entity_id, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId || null, action, description, opts.entityType || null, opts.entityId || null, opts.ip || null]
  ).catch(err => console.error('logActivity error:', err.message));
}

module.exports = { logActivity };
