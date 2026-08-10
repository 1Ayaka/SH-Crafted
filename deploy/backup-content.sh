#!/usr/bin/env bash
set -euo pipefail

db_file="${CONTENT_DB_PATH:-/var/lib/sh-crafted/content.db}"
source_file="${CONTENT_STORE_PATH:-/var/lib/sh-crafted/content.json}"
community_file="${COMMUNITY_STORE_PATH:-/var/lib/sh-crafted/community.json}"
upload_dir="${CONTENT_UPLOAD_DIR:-/var/lib/sh-crafted/uploads}"
backup_dir="/var/backups/sh-crafted"

if [[ ! -f "${db_file}" ]]; then
  echo "内容数据库不存在：${db_file}" >&2
  exit 1
fi

sudo install -d -m 0750 "${backup_dir}"
CONTENT_DB_PATH="${db_file}" CONTENT_BACKUP_DIR="${backup_dir}" CONTENT_STORE_PATH="${source_file}" COMMUNITY_STORE_PATH="${community_file}" CONTENT_UPLOAD_DIR="${upload_dir}" \
  node /var/www/sh-crafted/scripts/backup-content-store.mjs
