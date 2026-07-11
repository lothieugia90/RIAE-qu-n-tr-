-- Việc cá nhân: mỗi user có 1 "dự án cá nhân" ẩn để chứa các công việc tự tạo.
-- Cột is_personal đánh dấu dự án ẩn này để lọc khỏi danh sách dự án thường,
-- báo cáo tiến độ, thống kê... (chỉ hiện trong "Việc của tôi").
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_projects_personal ON projects(is_personal) WHERE is_personal = true;
