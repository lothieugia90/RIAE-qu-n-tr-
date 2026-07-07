-- ============================================================
-- Migration 005: Cấu hình Lương & Phụ cấp (dành cho cấp quản trị)
-- payroll_criteria: các tiêu chí phụ cấp/tăng ca/khấu trừ áp dụng khi tính lương
-- payroll_audit_logs: nhật ký thay đổi chi tiết theo từng trường (bắt buộc
--   với dữ liệu lương — khác activity_logs chung vì cần lưu old/new value)
-- ============================================================

CREATE TABLE IF NOT EXISTS payroll_criteria (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category       VARCHAR(30)  NOT NULL CHECK (category IN ('allowance','overtime','deduction')),
  name           VARCHAR(100) NOT NULL,
  key            VARCHAR(60)  NOT NULL UNIQUE,
  unit           VARCHAR(20)  NOT NULL DEFAULT 'VND' CHECK (unit IN ('VND','percent')),
  default_value  NUMERIC(15,2) NOT NULL DEFAULT 0,
  applies_to     VARCHAR(30)  NOT NULL DEFAULT 'all',
  description    TEXT,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  effective_from DATE         NOT NULL DEFAULT DATE_TRUNC('month', NOW()),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  criteria_id     UUID,
  criteria_key    VARCHAR(60),
  criteria_name   TEXT,
  category        VARCHAR(30),
  action          VARCHAR(20) NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE')),
  field_changed   VARCHAR(50),
  old_value       TEXT,
  new_value       TEXT,
  effective_from  DATE,
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  changed_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address      TEXT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_date ON payroll_audit_logs(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_criteria ON payroll_audit_logs(criteria_id);

-- Seed tiêu chí mặc định (áp dụng vai trò theo src/config/roles.js của v2)
INSERT INTO payroll_criteria (category, name, key, unit, default_value, applies_to) VALUES
  ('allowance', 'Phụ cấp ăn trưa',        'lunch_allowance',      'VND',     730000, 'all'),
  ('allowance', 'Phụ cấp xăng xe',        'transport_allowance',  'VND',     500000, 'all'),
  ('allowance', 'Phụ cấp điện thoại',     'phone_allowance',      'VND',     300000, 'all'),
  ('allowance', 'Phụ cấp độc hại',        'hazard_allowance',     'VND',    1000000, 'engineer'),
  ('allowance', 'Phụ cấp trách nhiệm',    'resp_allowance',       'VND',    2000000, 'pm'),
  ('overtime',  'Tăng ca ngày thường',    'ot_weekday',           'percent',    150, 'all'),
  ('overtime',  'Tăng ca cuối tuần',      'ot_weekend',           'percent',    200, 'all'),
  ('overtime',  'Tăng ca ngày lễ',        'ot_holiday',           'percent',    300, 'all'),
  ('deduction', 'Bảo hiểm xã hội (NLĐ)',  'si_employee',          'percent',    8.0, 'all'),
  ('deduction', 'Bảo hiểm y tế (NLĐ)',    'hi_employee',          'percent',    1.5, 'all'),
  ('deduction', 'Bảo hiểm thất nghiệp',   'ui_employee',          'percent',    1.0, 'all'),
  ('deduction', 'Quỹ công đoàn',          'union_fee',            'VND',      10000, 'all'),
  ('deduction', 'Phạt đi trễ (1 lần)',    'late_penalty',         'VND',      50000, 'all')
ON CONFLICT (key) DO NOTHING;

-- Seed quyền: chỉ cấp quản trị (admin/director/hr/head_hr) được cấu hình lương
INSERT INTO role_permissions (role, module, perm_level) VALUES
  ('admin','payroll','full'),
  ('director','payroll','full'),
  ('hr','payroll','edit'),
  ('head_hr','payroll','full')
ON CONFLICT (role, module) DO NOTHING;
