#!/usr/bin/env bash
# Sao lưu PostgreSQL hằng đêm — giữ 14 bản gần nhất.
# Cài trên VPS:  crontab -e  rồi thêm dòng:
#   0 2 * * * /var/www/riae-site/scripts/backup-db.sh >> /var/www/riae-site/logs/backup.log 2>&1
set -euo pipefail

DB_NAME="${DB_NAME:-riae_site}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP=14

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.dump"

pg_dump -Fc "$DB_NAME" > "$FILE"
echo "$(date '+%F %T') backed up to $FILE ($(du -h "$FILE" | cut -f1))"

# Xóa bản cũ, giữ lại $KEEP bản mới nhất
ls -1t "$BACKUP_DIR"/${DB_NAME}_*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
