# RIAE Management System

Hệ thống quản lý nội bộ cho **Công ty TNHH Kỹ thuật Công nghệ RIAE**.

## Tính năng

- **Dashboard** — Tổng quan dự án, task, nhân sự, kho
- **Quản lý Dự án** — Tạo/sửa dự án, phân công thành viên, Kanban Board, Gantt Chart
- **Quản lý Task** — Kéo thả Kanban, theo dõi tiến độ
- **Nhân sự** — Hồ sơ nhân viên, đơn nghỉ phép, phân quyền
- **Kho vật tư** — Danh mục vật tư, nhập/xuất kho, cảnh báo tồn kho
- **Thông báo & Quyết định** — Đăng thông báo, ghim, phân loại
- **Phân quyền** — 5 vai trò: admin, director, pm, engineer, warehouse

## Công nghệ

| Lớp | Công nghệ |
|-----|-----------|
| Runtime | Node.js 18+ |
| Web framework | Express.js |
| Template engine | EJS + express-ejs-layouts |
| Database | PostgreSQL 14+ |
| Session | express-session + connect-pg-simple |
| Auth | bcryptjs |
| Deploy | PM2 + Nginx |

## Cài đặt local

```bash
# 1. Clone repo
git clone <repo-url>
cd claude.code

# 2. Cài dependencies
npm install

# 3. Tạo file .env
cp .env.example .env
# Chỉnh sửa .env với thông tin DB của bạn

# 4. Tạo database PostgreSQL
createdb riae_management

# 5. Chạy migration
node database/migrate.js

# 6. Khởi động dev server
npm run dev
```

Mở trình duyệt: `http://localhost:3000`  
Tài khoản mặc định: `admin` / `Admin@2024`

## Deploy lên Hostinger VPS

### 1. Chuẩn bị VPS (Ubuntu 22.04)

```bash
# Cập nhật hệ thống
sudo apt update && sudo apt upgrade -y

# Cài Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Cài PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Cài PM2 và Nginx
sudo npm install -g pm2
sudo apt install -y nginx
```

### 2. Cấu hình PostgreSQL

```bash
sudo -u postgres psql
CREATE USER riae_user WITH PASSWORD 'your_strong_password';
CREATE DATABASE riae_management OWNER riae_user;
GRANT ALL PRIVILEGES ON DATABASE riae_management TO riae_user;
\q
```

### 3. Upload code lên VPS

```bash
# Trên máy local — push lên GitHub
git add .
git commit -m "Deploy RIAE Management System"
git push origin main

# Trên VPS
cd /var/www
git clone https://github.com/your-username/claude.code.git riae
cd riae
npm install --production
```

### 4. Cấu hình .env trên VPS

```bash
cp .env.example .env
nano .env
```

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=your_very_long_random_secret_here
DB_HOST=localhost
DB_PORT=5432
DB_NAME=riae_management
DB_USER=riae_user
DB_PASSWORD=your_strong_password
JWT_SECRET=another_long_random_secret
APP_URL=https://yourdomain.com
```

### 5. Chạy migration và khởi động

```bash
node database/migrate.js
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### 6. Cấu hình Nginx

```bash
sudo nano /etc/nginx/sites-available/riae
```

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    client_max_body_size 10M;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/riae /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7. HTTPS với Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## Cấu trúc thư mục

```
├── app.js                  # Entry point
├── ecosystem.config.js     # PM2 config
├── database/
│   ├── schema.sql          # Database schema
│   └── migrate.js          # Migration script
├── src/
│   ├── config/
│   │   └── database.js
│   ├── controllers/        # Business logic
│   ├── middleware/         # Auth middleware
│   ├── routes/             # Express routes
│   └── views/              # EJS templates
└── public/
    ├── css/style.css
    ├── js/main.js
    └── uploads/
```

## Phân quyền

| Tính năng | admin | director | pm | engineer | warehouse |
|-----------|-------|----------|----|----------|-----------|
| Quản lý dự án | ✅ | ✅ | ✅ | Xem | — |
| Quản lý nhân sự | ✅ | ✅ | — | — | — |
| Quản lý kho | ✅ | ✅ | — | — | ✅ |
| Đăng thông báo | ✅ | ✅ | — | — | — |
| Quản trị system | ✅ | — | — | — | — |

## Lệnh hữu ích

```bash
# Dev
npm run dev          # Nodemon hot-reload

# Production
pm2 status           # Xem trạng thái
pm2 logs riae-management  # Xem logs
pm2 restart riae-management  # Restart
pm2 reload riae-management   # Zero-downtime reload
```
