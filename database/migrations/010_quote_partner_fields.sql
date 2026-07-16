-- Báo giá: thêm địa điểm, hạng mục và file Excel báo giá đính kèm
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS scope TEXT;             -- hạng mục công việc
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_file_url VARCHAR(255);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_file_name VARCHAR(255);

-- Đối tác: thêm file Excel báo giá đính kèm (tên đội = name, SĐT = phone đã có)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS quote_file_url VARCHAR(255);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS quote_file_name VARCHAR(255);
