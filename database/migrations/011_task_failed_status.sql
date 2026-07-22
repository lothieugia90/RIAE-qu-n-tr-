-- Task: thêm trạng thái 'failed' (Thất bại) để nhân viên được giao có thể
-- đánh dấu task hoàn thành hoặc thất bại. 'failed' là trạng thái kết thúc
-- (giống 'done' về mặt "đã xử lý xong", nhưng không tính là hoàn thành).
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo','in_progress','review','done','failed'));
