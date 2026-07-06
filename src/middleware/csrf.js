// CSRF bảo vệ theo mẫu synchronizer token gắn với session.
// - Token sinh 1 lần cho mỗi session, lưu trong req.session.csrfToken.
// - Mọi request thay đổi dữ liệu (POST/PUT/PATCH/DELETE) phải gửi kèm token
//   qua body `_csrf` hoặc header `x-csrf-token`.
// - View nhúng token qua res.locals.csrfToken:
//     <input type="hidden" name="_csrf" value="<%= csrfToken %>">
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtection(req, res, next) {
  if (!req.session) return next(new Error('CSRF middleware requires session'));

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  if (typeof sent === 'string' && sent.length === req.session.csrfToken.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrfToken))) {
    if (req.body) delete req.body._csrf;
    return next();
  }

  console.warn(`CSRF rejected: ${req.method} ${req.originalUrl} from ${req.ip}`);
  if (req.xhr || (req.headers.accept || '').includes('application/json')) {
    return res.status(403).json({ error: 'Phiên làm việc không hợp lệ, vui lòng tải lại trang' });
  }
  req.flash('error', 'Phiên làm việc đã hết hạn hoặc không hợp lệ, vui lòng thử lại');
  return res.redirect(req.get('referer') || '/');
}

module.exports = { csrfProtection };
