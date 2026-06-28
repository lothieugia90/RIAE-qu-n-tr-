const { query } = require('./database');

async function migrate() {
  try {
    // Add 'hr' to user_role enum if not present
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='hr'
          AND enumtypid=(SELECT oid FROM pg_type WHERE typname='user_role')) THEN
          ALTER TYPE user_role ADD VALUE 'hr';
        END IF;
      END $$
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS payroll_criteria (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        category     VARCHAR(30)  NOT NULL CHECK (category IN ('allowance','overtime','deduction')),
        name         VARCHAR(100) NOT NULL,
        key          VARCHAR(60)  NOT NULL UNIQUE,
        unit         VARCHAR(20)  NOT NULL DEFAULT 'VND',
        default_value NUMERIC(15,2) NOT NULL DEFAULT 0,
        applies_to   VARCHAR(30)  NOT NULL DEFAULT 'all',
        description  TEXT,
        is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
        effective_from DATE       NOT NULL DEFAULT DATE_TRUNC('month', NOW()),
        created_by   UUID REFERENCES users(id),
        updated_by   UUID REFERENCES users(id),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS payroll_audit_logs (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        criteria_id     UUID,
        criteria_key    VARCHAR(60),
        criteria_name   TEXT,
        category        VARCHAR(30),
        action          VARCHAR(20) NOT NULL,
        field_changed   VARCHAR(50),
        old_value       TEXT,
        new_value       TEXT,
        effective_from  DATE,
        changed_by      UUID REFERENCES users(id),
        changed_by_name TEXT,
        changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip_address      TEXT,
        note            TEXT
      )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_payroll_audit_date ON payroll_audit_logs(changed_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_payroll_audit_criteria ON payroll_audit_logs(criteria_id)`);

    // Seed default criteria if table is empty
    const existing = await query(`SELECT COUNT(*)::int as n FROM payroll_criteria`);
    if (existing.rows[0].n === 0) {
      const defaults = [
        // Allowances
        ['allowance', 'Phụ cấp ăn trưa',      'lunch_allowance',     'VND',     730000, 'all'],
        ['allowance', 'Phụ cấp xăng xe',       'transport_allowance', 'VND',     500000, 'all'],
        ['allowance', 'Phụ cấp điện thoại',    'phone_allowance',     'VND',     300000, 'all'],
        ['allowance', 'Phụ cấp độc hại',       'hazard_allowance',    'VND',    1000000, 'engineer'],
        ['allowance', 'Phụ cấp trách nhiệm',   'resp_allowance',      'VND',    2000000, 'pm'],
        // Overtime coefficients
        ['overtime',  'Tăng ca ngày thường',   'ot_weekday',          'percent',  150,   'all'],
        ['overtime',  'Tăng ca cuối tuần',     'ot_weekend',          'percent',  200,   'all'],
        ['overtime',  'Tăng ca ngày lễ',       'ot_holiday',          'percent',  300,   'all'],
        // Deductions
        ['deduction', 'Bảo hiểm xã hội (NLĐ)','si_employee',         'percent',  8,     'all'],
        ['deduction', 'Bảo hiểm y tế (NLĐ)',  'hi_employee',         'percent',  1.5,   'all'],
        ['deduction', 'Bảo hiểm thất nghiệp', 'ui_employee',         'percent',  1,     'all'],
        ['deduction', 'Quỹ công đoàn',         'union_fee',           'VND',      10000, 'all'],
        ['deduction', 'Phạt đi trễ (1 lần)',  'late_penalty',        'VND',      50000, 'all'],
      ];
      for (const [cat, name, key, unit, val, applies] of defaults) {
        await query(
          `INSERT INTO payroll_criteria (category,name,key,unit,default_value,applies_to)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING`,
          [cat, name, key, unit, val, applies]
        );
      }
    }

    console.log('[migrate-v3] OK');
  } catch (e) {
    console.error('[migrate-v3] Error:', e.message);
  }
}

module.exports = migrate;
