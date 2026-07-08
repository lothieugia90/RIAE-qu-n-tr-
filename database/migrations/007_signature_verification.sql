-- Chữ ký xác thực cho bước phê duyệt: HMAC-SHA256 server-side trên các trường
-- quyết định (id, request, người duyệt, trạng thái, thời điểm ký, ý kiến).
-- Sửa bất kỳ trường nào trong DB (kể cả truy cập trực tiếp) sẽ làm hash lệch
-- và hệ thống báo "không xác thực được".
ALTER TABLE request_approvals ADD COLUMN IF NOT EXISTS signature_hash VARCHAR(128);
