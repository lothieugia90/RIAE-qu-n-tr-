-- ============================================================
-- Migration 002: Dự án & Công việc (GĐ B)
-- projects, project_members, tasks, task_comments,
-- task_checklists, time_logs + seed quyền projects/tasks
-- Ghi chú: status/priority dùng VARCHAR + CHECK (không dùng ENUM)
-- để thêm giá trị mới không cần ALTER TYPE.
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  client_name VARCHAR(200),
  client_contact VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','active','on_hold','completed','cancelled')),
  priority VARCHAR(10) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','urgent')),
  start_date DATE,
  end_date DATE,
  actual_end_date DATE,
  budget DECIMAL(15,2),
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  location TEXT,
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(manager_id);

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','review','done')),
  priority VARCHAR(10) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  start_date DATE,
  due_date DATE,
  estimated_hours DECIMAL(6,1),
  actual_hours DECIMAL(6,1),
  notes TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE status != 'done';

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

CREATE TABLE IF NOT EXISTS task_checklists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  is_done BOOLEAN DEFAULT false,
  done_by UUID REFERENCES users(id) ON DELETE SET NULL,
  done_at TIMESTAMP,
  sort_order INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id);

CREATE TABLE IF NOT EXISTS time_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours_spent DECIMAL(5,1) NOT NULL CHECK (hours_spent > 0),
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_logs_task ON time_logs(task_id);

-- Seed quyền cho module mới.
-- projects: view = chỉ thấy dự án mình tham gia; edit = tạo/sửa + thấy tất cả; full = hủy dự án
-- tasks:    edit = tạo/sửa task của mình; full = xóa mọi task
INSERT INTO role_permissions (role, module, perm_level) VALUES
  ('admin','projects','full'),  ('admin','tasks','full'),
  ('director','projects','full'), ('director','tasks','full'),
  ('pm','projects','edit'), ('pm','tasks','edit'),
  ('head_tech','projects','edit'), ('head_tech','tasks','edit'),
  ('head_hr','projects','view'), ('head_hr','tasks','edit'),
  ('head_sales','projects','edit'), ('head_sales','tasks','edit'),
  ('engineer','projects','view'), ('engineer','tasks','edit'),
  ('field_supervisor','projects','view'), ('field_supervisor','tasks','edit'),
  ('tech_deploy','projects','view'), ('tech_deploy','tasks','edit'),
  ('hr','projects','view'), ('hr','tasks','edit'),
  ('warehouse','projects','view'), ('warehouse','tasks','edit'),
  ('warehouse_keeper','projects','view'), ('warehouse_keeper','tasks','edit'),
  ('accountant','projects','view'), ('accountant','tasks','edit')
ON CONFLICT (role, module) DO NOTHING;
