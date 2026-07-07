-- ============================================================
-- Migration 006: Bảng tin công ty (Thông báo chung, Quyết định,
-- Quy chế, Bổ nhiệm) — tách biệt với notifications cá nhân.
-- ============================================================

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(300) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'general'
    CHECK (type IN ('general','decision','policy','appointment','urgent')),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published, published_at DESC);

CREATE TABLE IF NOT EXISTS announcement_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_size BIGINT,
  file_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcement_files_ann ON announcement_files(announcement_id);

-- Theo dõi ai đã đọc — cũng dùng để tính số chưa đọc cho badge loa
CREATE TABLE IF NOT EXISTS announcement_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id);

-- Seed quyền: mọi vai trò đều xem được bảng tin; chỉ cấp quản trị được đăng/sửa/xóa
INSERT INTO role_permissions (role, module, perm_level)
SELECT role, 'announcements', 'view' FROM (VALUES
  ('admin'),('director'),('pm'),('head_tech'),('head_hr'),('head_sales'),
  ('engineer'),('field_supervisor'),('tech_deploy'),('hr'),
  ('warehouse'),('warehouse_keeper'),('accountant')
) AS r(role)
ON CONFLICT (role, module) DO NOTHING;

UPDATE role_permissions SET perm_level = 'full'
WHERE module = 'announcements' AND role IN ('admin','director','hr','head_hr');
