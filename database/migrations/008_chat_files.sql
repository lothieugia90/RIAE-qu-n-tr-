-- Cho phép tin nhắn chat đính kèm file (ảnh/tài liệu). content có thể rỗng
-- nếu tin nhắn chỉ có file — ràng buộc CHECK đảm bảo luôn có ít nhất 1 trong 2.
ALTER TABLE chat_messages ALTER COLUMN content DROP NOT NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_url VARCHAR(255);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_content_or_file;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_content_or_file
  CHECK (content IS NOT NULL OR file_url IS NOT NULL);
