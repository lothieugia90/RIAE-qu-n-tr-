const { query } = require('../config/database');

const log = async (userId, action, entityType, entityId, description, oldData = null, newData = null, ip = null) => {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description, old_data, new_data, ip_addr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId || null, action, entityType, entityId ? String(entityId) : null,
       description, oldData ? JSON.stringify(oldData) : null,
       newData ? JSON.stringify(newData) : null, ip || null]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
};

module.exports = { log };
