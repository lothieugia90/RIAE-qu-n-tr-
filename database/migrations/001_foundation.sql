-- ============================================================
-- RIAE Management System v2 — Migration 001: Foundation
-- Users, RBAC (role_permissions), Sessions, Activity logs,
-- Notifications, Departments/Positions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USERS
-- role là VARCHAR (không dùng ENUM) để thêm vai trò mới không cần ALTER TYPE.
-- Danh sách vai trò hợp lệ quản lý tại src/config/roles.js + bảng role_permissions.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'engineer',
  phone VARCHAR(20),
  avatar_url VARCHAR(255),
  department VARCHAR(100),
  position VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  last_seen_at TIMESTAMP,
  failed_login_count INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- DEPARTMENTS & POSITIONS
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(name, department_id)
);

-- RBAC: quyền theo (role, module) với 4 mức none/view/edit/full
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role VARCHAR(30) NOT NULL,
  module VARCHAR(50) NOT NULL,
  perm_level VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (perm_level IN ('none','view','edit','full')),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(role, module)
);

-- SESSION (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

-- ACTIVITY LOGS (nhật ký hệ thống)
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  description TEXT,
  entity_type VARCHAR(50),
  entity_id UUID,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);

-- NOTIFICATIONS (thông báo cá nhân, dùng chung cho mọi module sau này)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL DEFAULT 'general',
  title VARCHAR(200) NOT NULL,
  content TEXT,
  link VARCHAR(255),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- Seed quyền mặc định cho ma trận role × module.
-- admin luôn full mọi module (được đảm bảo thêm ở tầng ứng dụng).
INSERT INTO role_permissions (role, module, perm_level) VALUES
  ('admin','dashboard','full'), ('admin','users','full'), ('admin','permissions','full'), ('admin','audit','full'),
  ('director','dashboard','full'), ('director','users','view'), ('director','audit','view'),
  ('pm','dashboard','view'),
  ('head_tech','dashboard','view'),
  ('head_hr','dashboard','view'), ('head_hr','users','view'),
  ('head_sales','dashboard','view'),
  ('engineer','dashboard','view'),
  ('field_supervisor','dashboard','view'),
  ('tech_deploy','dashboard','view'),
  ('hr','dashboard','view'), ('hr','users','view'),
  ('warehouse','dashboard','view'),
  ('warehouse_keeper','dashboard','view'),
  ('accountant','dashboard','view')
ON CONFLICT (role, module) DO NOTHING;
