const crypto = require('crypto');

// Khóa ký riêng (SIGNATURE_SECRET) — fallback SESSION_SECRET để không cần thêm
// biến môi trường trên môi trường đã chạy. Đổi khóa sẽ làm mọi chữ ký cũ
// "không xác thực được" (đúng thiết kế — khóa là gốc của niềm tin).
const SECRET = process.env.SIGNATURE_SECRET || process.env.SESSION_SECRET || 'dev-only-signature-key';

// Chuỗi chuẩn hóa cho 1 bước duyệt. Bao gồm mọi trường mang ý nghĩa pháp lý:
// đổi người duyệt, trạng thái, thời điểm, ý kiến hay lý do từ chối đều phá hash.
function canonical(a) {
  return [
    a.id,
    a.request_id,
    a.approver_id,
    a.status,
    a.signed_at ? new Date(a.signed_at).toISOString() : '',
    a.comment || '',
    a.rejection_reason || ''
  ].join('|');
}

function signApproval(a) {
  return crypto.createHmac('sha256', SECRET).update(canonical(a)).digest('hex');
}

function verifyApproval(a) {
  if (!a.signature_hash || !a.signed_at) return false;
  const expected = signApproval(a);
  const given = String(a.signature_hash);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

module.exports = { signApproval, verifyApproval };
