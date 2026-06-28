const { query } = require('./database');

async function migrate() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS announcement_files (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT,
        file_size BIGINT,
        file_path TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS announcement_reactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reaction VARCHAR(20) DEFAULT 'seen',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(announcement_id, user_id, reaction)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        category VARCHAR(20) DEFAULT 'work',
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        read_at TIMESTAMPTZ
      )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC)`);

    // Add 'event' to announcement_type enum if not already present
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='event' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='announcement_type')) THEN
          ALTER TYPE announcement_type ADD VALUE 'event';
        END IF;
      END $$
    `);

    console.log('[migrate-v2] OK');
  } catch (e) {
    console.error('[migrate-v2] Error:', e.message);
  }
}

module.exports = migrate;
