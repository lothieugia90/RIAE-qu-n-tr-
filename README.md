# RIAE Management System v2

Hệ thống quản lý nội bộ cho **Công ty TNHH Kỹ thuật Công nghệ RIAE** — bản xây mới (v2), kế thừa và cải tiến từ hệ thống v1.

## Khác biệt so với v1

| Hạng mục | v1 | v2 |
|---|---|---|
| Migration | schema.sql + 14 file migrate chạy lúc khởi động app | Thư mục `database/migrations/` đánh số, chạy 1 lần qua `npm run migrate`, có bảng `schema_migrations` |
| CSRF | Không có | Synchronizer token cho mọi POST/PUT/DELETE |
| Brute-force | Không có | Rate-limit 10 lần/15 phút/IP + khóa tài khoản 15 phút sau 5 lần sai |
| Session fixation | Không xử lý | `session.regenerate()` sau đăng nhập |
| Vai trò | ENUM cứng trong DB | VARCHAR + `src/config/roles.js` (13 vai trò, kế thừa quyền) |
| Phân quyền | Hardcode theo role trong route | Ma trận `role_permissions` (role × module × mức) chỉnh được trong UI |
| Backup | Không có | `scripts/backup-db.sh` + hướng dẫn cron |
| Dependencies | Có `moment`, `jsonwebtoken` không dùng | Đã loại bỏ |
| Contrast | `--text-3: #94A3B8` (2.9:1) | `#64748B` (4.76:1, đạt WCAG AA) |

## Trạng thái module (lộ trình)

- ✅ **GĐ A — Nền tảng**: Đăng nhập, RBAC (ma trận phân quyền), Quản lý người dùng, Nhật ký hệ thống, Dashboard
- ✅ **GĐ B — Vận hành**: Dự án (Kanban kéo-thả), Task (comment, checklist, chấm giờ), Việc của tôi, Thông báo
- ✅ **GĐ C — Admin & HR**: Nhân sự (hồ sơ + tài liệu), Chấm công (lưới tháng), Phê duyệt (form động + duyệt nhiều bước)
- ✅ **GĐ D — Chuyên biệt**: Kho vật tư (nhập/xuất, cảnh báo tồn), Đối tác, Báo giá (dòng hàng + tổng tự tính), Chat realtime (Socket.IO, xác thực session), Chữ ký nội bộ (vẽ tay, hiện trên phê duyệt)
- ⏳ **Đợt sau**: Lương (C.2), workflow tùy biến nhiều bước, Gantt, file đính kèm task, xuất PDF báo giá

## Công nghệ

Node.js 18+ · Express · EJS · PostgreSQL 14+ · express-session (PG store) · bcryptjs · helmet · express-rate-limit · PM2 + Nginx

## Cài đặt local

```bash
npm install
cp .env.example .env        # điền DB_PASSWORD, SESSION_SECRET
createdb riae_site          # hoặc: CREATE DATABASE riae_site; trong psql
npm run migrate             # tạo bảng
npm run seed                # tạo tài khoản admin đầu tiên
npm run dev                 # http://localhost:3000
```

Đăng nhập: `admin` / giá trị `ADMIN_PASSWORD` trong `.env` (mặc định `Admin@2026`). **Đổi mật khẩu ngay sau lần đăng nhập đầu.**

## Thêm migration mới

Tạo file `database/migrations/00X_ten_migration.sql` (số thứ tự tăng dần), rồi chạy `npm run migrate`. File đã chạy sẽ không chạy lại.

## Backup

```bash
# Trên VPS, thêm cron chạy 2h sáng hằng đêm:
crontab -e
0 2 * * * /var/www/riae-site/scripts/backup-db.sh >> /var/www/riae-site/logs/backup.log 2>&1

# Khôi phục:
pg_restore -d riae_site --clean backups/riae_site_YYYYMMDD_HHMMSS.dump
```

## Deploy (PM2 + Nginx)

```bash
npm ci --omit=dev
npm run migrate && npm run seed
pm2 start ecosystem.config.js
pm2 save
```

Nginx reverse proxy về `localhost:3000` (app đã bật `trust proxy`).

## Ghi chú bảo mật

- `SESSION_SECRET` bắt buộc ở production — app từ chối khởi động nếu thiếu.
- CSP của helmet đang tắt vì views dùng CDN (Font Awesome, Google Fonts) + inline script; khi chuyển asset về self-host thì bật lại.
- Mọi form phải có `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`; request AJAX gửi header `x-csrf-token`.
