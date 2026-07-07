-- ============================================================
-- Migration 003: Nhân sự, Chấm công, Yêu cầu & Phê duyệt (GĐ C)
-- Ghi chú thiết kế:
--  - Nghỉ phép đi qua module Phê duyệt (form "Xin nghỉ phép"),
--    KHÔNG có bảng leave_requests riêng như v1 (tránh 2 luồng trùng).
--  - Lương (payroll) để migration sau (C.2) khi chấm công đã chạy.
-- ============================================================

-- HỒ SƠ NHÂN VIÊN (mở rộng users)
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_code VARCHAR(20) UNIQUE,
  date_of_birth DATE,
  hire_date DATE,
  contract_type VARCHAR(50),
  salary DECIMAL(15,2),
  address TEXT,
  bank_account VARCHAR(50),
  bank_name VARCHAR(150),
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) DEFAULT 'other',
  name VARCHAR(200) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_name VARCHAR(200),
  issued_date DATE,
  expiry_date DATE,
  notes TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_user ON employee_documents(user_id);

-- CHẤM CÔNG
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','late','absent','annual_leave','sick_leave','unpaid_leave','remote')),
  check_in TIME,
  check_out TIME,
  overtime_hours DECIMAL(4,1) DEFAULT 0,
  notes TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(work_date);

-- YÊU CẦU & PHÊ DUYỆT (form động)
CREATE TABLE IF NOT EXISTS request_forms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(30) NOT NULL DEFAULT 'other'
    CHECK (category IN ('admin','finance','project','other')),
  fields JSONB NOT NULL DEFAULT '[]',          -- [{label,type,required,options?}]
  approval_steps JSONB NOT NULL DEFAULT '[]',  -- [{name, approver_id}]
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id UUID NOT NULL REFERENCES request_forms(id),
  title VARCHAR(300) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  priority VARCHAR(10) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  attachment_urls JSONB NOT NULL DEFAULT '[]',
  rejection_reason TEXT,
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_requests_submitted_by ON requests(submitted_by);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

CREATE TABLE IF NOT EXISTS request_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_name VARCHAR(100),
  approver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  comment TEXT,
  rejection_reason TEXT,
  signed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_request_approvals_approver ON request_approvals(approver_id, status);

-- Form mẫu (approval_steps rỗng → hệ thống fallback người duyệt là Ban lãnh đạo)
INSERT INTO request_forms (name, description, category, fields) VALUES
  ('Xin nghỉ phép', 'Đơn xin nghỉ phép năm, nghỉ bệnh hoặc nghỉ không lương', 'admin',
   '[{"label":"Loại nghỉ","type":"select","options":["Nghỉ phép năm","Nghỉ bệnh","Nghỉ không lương"],"required":true},
     {"label":"Từ ngày","type":"date","required":true},
     {"label":"Đến ngày","type":"date","required":true},
     {"label":"Số ngày nghỉ","type":"number","required":true},
     {"label":"Lý do","type":"textarea","required":true}]'),
  ('Đi trễ / Về sớm', 'Đơn xin phép đi trễ hoặc về sớm', 'admin',
   '[{"label":"Ngày","type":"date","required":true},
     {"label":"Loại","type":"select","options":["Đi trễ","Về sớm"],"required":true},
     {"label":"Thời gian","type":"text","required":true},
     {"label":"Lý do","type":"textarea","required":true}]'),
  ('Đề nghị thanh toán', 'Đề nghị thanh toán chi phí, tạm ứng công tác', 'finance',
   '[{"label":"Nội dung chi","type":"textarea","required":true},
     {"label":"Số tiền (VNĐ)","type":"number","required":true},
     {"label":"Người thụ hưởng","type":"text","required":true},
     {"label":"Số tài khoản","type":"text","required":false},
     {"label":"Ngân hàng","type":"text","required":false}]'),
  ('Đề xuất mua sắm / vật tư', 'Đề xuất mua thiết bị, vật tư phục vụ công việc', 'other',
   '[{"label":"Danh mục cần mua","type":"textarea","required":true},
     {"label":"Ước tính chi phí (VNĐ)","type":"number","required":true},
     {"label":"Mục đích sử dụng","type":"textarea","required":true},
     {"label":"Thời gian cần","type":"date","required":false}]')
ON CONFLICT DO NOTHING;

-- Seed quyền cho module mới
-- hr:         view = xem danh sách/hồ sơ; edit = tạo/sửa hồ sơ; full = khóa TK, reset MK
-- attendance: view = xem công của mình; edit = chấm công mọi người
-- requests:   edit = gửi + duyệt bước được giao; full = quản lý quy trình, mở lại yêu cầu
INSERT INTO role_permissions (role, module, perm_level) VALUES
  ('admin','hr','full'), ('admin','attendance','full'), ('admin','requests','full'),
  ('director','hr','view'), ('director','attendance','edit'), ('director','requests','full'),
  ('pm','hr','none'), ('pm','attendance','view'), ('pm','requests','edit'),
  ('head_tech','attendance','view'), ('head_tech','requests','edit'),
  ('head_hr','hr','full'), ('head_hr','attendance','edit'), ('head_hr','requests','edit'),
  ('head_sales','attendance','view'), ('head_sales','requests','edit'),
  ('engineer','attendance','view'), ('engineer','requests','edit'),
  ('field_supervisor','attendance','view'), ('field_supervisor','requests','edit'),
  ('tech_deploy','attendance','view'), ('tech_deploy','requests','edit'),
  ('hr','hr','edit'), ('hr','attendance','edit'), ('hr','requests','edit'),
  ('warehouse','attendance','view'), ('warehouse','requests','edit'),
  ('warehouse_keeper','attendance','view'), ('warehouse_keeper','requests','edit'),
  ('accountant','attendance','view'), ('accountant','requests','edit')
ON CONFLICT (role, module) DO NOTHING;
