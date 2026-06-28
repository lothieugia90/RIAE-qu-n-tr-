const { query } = require('./database');

async function migrate() {
  try {
    // Add avatar_url + last_seen_at already exist. Add message_type & file cols to chat_messages
    await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text'`);
    await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_url   TEXT`);
    await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_name  TEXT`);
    await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_size  BIGINT`);
    await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to   UUID REFERENCES chat_messages(id)`);

    // Add avatar + description to chat_rooms
    await query(`ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS description TEXT`);
    await query(`ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS avatar_url  TEXT`);

    // Add role to chat_room_members
    await query(`ALTER TABLE chat_room_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member'`);

    // Indexes
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_msg_room ON chat_messages(room_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_msg_user ON chat_messages(user_id)`);

    console.log('[migrate-v4] OK');
  } catch (e) {
    console.error('[migrate-v4] Error:', e.message);
  }
}
module.exports = migrate;
