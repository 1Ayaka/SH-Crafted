#!/usr/bin/env bash
set -euo pipefail

source_file="${CONTENT_STORE_PATH:-/var/lib/sh-crafted/content.json}"
backup_dir="/var/backups/sh-crafted"
timestamp="$(date '+%Y%m%d-%H%M%S')"
target="${backup_dir}/content-${timestamp}.json"

if [[ ! -f "${source_file}" ]]; then
  echo "内容文件不存在：${source_file}" >&2
  exit 1
fi

sudo install -d -m 0750 "${backup_dir}"
sudo cp --preserve=timestamps "${source_file}" "${target}"
sudo chmod 0640 "${target}"
echo "内容备份已生成：${target}"
