const { query } = require('./database');

module.exports = async function migrateV7() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS time_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        hours_spent DECIMAL(8,2) NOT NULL,
        log_date DATE DEFAULT CURRENT_DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        uploaded_by UUID REFERENCES users(id),
        file_url VARCHAR(500) NOT NULL,
        file_name VARCHAR(200) NOT NULL,
        original_name VARCHAR(200),
        file_size INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('migrate-v7: time_logs and task_attachments ready');
  } catch (err) {
    console.error('migrate-v7 error:', err.message);
  }
};
