const { query } = require('../config/database');

async function create(userId, type, category, title, body, link) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, category, title, body, link)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, type, category, title, body || null, link || null]
    );
  } catch (e) { /* silent */ }
}

module.exports = { create };
