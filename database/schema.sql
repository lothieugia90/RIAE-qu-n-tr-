-- ============================================================
-- RIAE Management System - PostgreSQL Schema
-- Công ty TNHH Kỹ Thuật Công Nghệ RIAE
-- ============================================================
-- Run: psql -U riae_user -d riae_management -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ENUMS
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin','director','pm','engineer','warehouse');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM ('planning','active','on_hold','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('todo','in_progress','review','done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('low','medium','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('import','export','adjust');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE announcement_type AS ENUM ('general','urgent','decision','policy');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE leave_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role user_role NOT NULL DEFAULT 'engineer',
  phone VARCHAR(20),
  avatar_url VARCHAR(255),
  department VARCHAR(100),
  position VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  client_name VARCHAR(200),
  client_contact VARCHAR(200),
  status project_status DEFAULT 'planning',
  priority task_priority DEFAULT 'medium',
  start_date DATE,
  end_date DATE,
  actual_end_date DATE,
  budget DECIMAL(15,2),
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  location TEXT,
  manager_id UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- PROJECT MEMBERS
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- TASKS
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status task_status DEFAULT 'todo',
  priority task_priority DEFAULT 'medium',
  assignee_id UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  start_date DATE,
  due_date DATE,
  completed_at TIMESTAMP,
  position_order INTEGER DEFAULT 0,
  parent_task_id UUID REFERENCES tasks(id),
  estimated_hours DECIMAL(8,2),
  actual_hours DECIMAL(8,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- TASK COMMENTS
CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- WAREHOUSE CATEGORIES
CREATE TABLE IF NOT EXISTS warehouse_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES warehouse_categories(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- WAREHOUSE ITEMS
CREATE TABLE IF NOT EXISTS warehouse_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category_id UUID REFERENCES warehouse_categories(id),
  unit VARCHAR(50) NOT NULL,
  quantity DECIMAL(15,3) DEFAULT 0,
  min_quantity DECIMAL(15,3) DEFAULT 0,
  unit_price DECIMAL(15,2),
  location VARCHAR(100),
  supplier VARCHAR(200),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- WAREHOUSE TRANSACTIONS
CREATE TABLE IF NOT EXISTS warehouse_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID REFERENCES warehouse_items(id),
  transaction_type transaction_type NOT NULL,
  quantity DECIMAL(15,3) NOT NULL,
  unit_price DECIMAL(15,2),
  project_id UUID REFERENCES projects(id),
  reference_code VARCHAR(100),
  performed_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  notes TEXT,
  transaction_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- EMPLOYEES (extended profile)
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_code VARCHAR(20) UNIQUE NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(10),
  id_card_number VARCHAR(20),
  address TEXT,
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(20),
  hire_date DATE NOT NULL,
  salary DECIMAL(15,2),
  bank_account VARCHAR(50),
  bank_name VARCHAR(100),
  tax_code VARCHAR(50),
  social_insurance_code VARCHAR(50),
  contract_type VARCHAR(50),
  contract_start DATE,
  contract_end DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- LEAVE REQUESTS
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id),
  leave_type VARCHAR(50),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count DECIMAL(4,1),
  reason TEXT,
  status leave_status DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(300) NOT NULL,
  content TEXT NOT NULL,
  type announcement_type DEFAULT 'general',
  is_pinned BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  published_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ANNOUNCEMENT READS
CREATE TABLE IF NOT EXISTS announcement_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  read_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);

-- ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  description TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);

-- SESSIONS (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
ALTER TABLE session DROP CONSTRAINT IF EXISTS session_pkey;
ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(manager_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_wh_tx_item ON warehouse_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_wh_tx_project ON warehouse_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_announcements_pub ON announcements(is_published, published_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, created_at);

-- AUTO-UPDATE TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_wh_items_updated_at ON warehouse_items;
CREATE TRIGGER trg_wh_items_updated_at BEFORE UPDATE ON warehouse_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default Admin (password: Admin@2024)
INSERT INTO users (username, email, password_hash, full_name, role, department, position)
VALUES (
  'admin',
  'admin@riae.vn',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewEbLFevJZpWq.qC',
  'Quản Trị Hệ Thống',
  'admin',
  'IT',
  'System Administrator'
) ON CONFLICT (username) DO NOTHING;

-- Warehouse categories
INSERT INTO warehouse_categories (name, description) VALUES
  ('Dây & Cáp điện', 'Dây điện, cáp điện các loại'),
  ('Thiết bị đóng cắt', 'Cầu dao, aptomat, contactor, relay'),
  ('Đèn & Chiếu sáng', 'Đèn LED, bóng đèn, đèn công nghiệp'),
  ('Ổ cắm & Công tắc', 'Ổ điện, công tắc, ổ cắm âm tường'),
  ('Tủ điện & Phụ kiện', 'Tủ điện, thanh cái, ray DIN, máng cáp'),
  ('Dụng cụ thi công', 'Máy khoan, kìm, tuốc nơ vít, đồng hồ đo điện'),
  ('Vật tư phụ', 'Băng dính điện, ống gen, cút nối, kẹp dây, bulong')
ON CONFLICT DO NOTHING;

-- ============================================================
-- PARTNERS MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(20) NOT NULL DEFAULT 'supplier', -- 'supplier' | 'contractor'
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(100),
  address TEXT,
  tax_code VARCHAR(50),
  contact_person VARCHAR(100),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  unit VARCHAR(50),
  unit_price DECIMAL(15,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS construction_team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  id_card VARCHAR(20),
  role VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INTERNAL CHAT
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100),
  type VARCHAR(20) DEFAULT 'group', -- 'direct' | 'group'
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_room_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text', -- 'text' | 'file'
  file_url VARCHAR(255),
  file_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at DESC);

-- ============================================================
-- QUOTES (BÁO GIÁ)
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(300) NOT NULL,
  project_id UUID REFERENCES projects(id),
  client_name VARCHAR(200),
  client_contact VARCHAR(200),
  status VARCHAR(30) DEFAULT 'draft', -- 'draft' | 'sent' | 'approved' | 'rejected'
  valid_until DATE,
  notes TEXT,
  ai_analysis TEXT,
  total_amount DECIMAL(15,2) DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  item_order INTEGER DEFAULT 0,
  description VARCHAR(300) NOT NULL,
  unit VARCHAR(50),
  quantity DECIMAL(15,3) DEFAULT 1,
  unit_price DECIMAL(15,2) DEFAULT 0,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  amount DECIMAL(15,2) GENERATED ALWAYS AS (quantity * unit_price * (1 - discount_percent/100)) STORED,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- EMPLOYEE DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL, -- 'certificate' | 'contract' | 'id_card' | 'other'
  name VARCHAR(200) NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  file_name VARCHAR(255),
  issued_date DATE,
  expiry_date DATE,
  notes TEXT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- SEED: Default chat room "Chung"
-- ============================================================
INSERT INTO chat_rooms (name, type)
VALUES ('Chung', 'group')
ON CONFLICT DO NOTHING;
