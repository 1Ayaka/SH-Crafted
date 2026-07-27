#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/sh-crafted}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-sh-crafted}"

cd "$APP_DIR"

echo "[1/5] Fetching origin/$BRANCH"
git fetch origin "$BRANCH"

echo "[2/5] Applying fast-forward update"
git merge --ff-only "origin/$BRANCH"

echo "[3/5] Restoring locked dependencies"
npm ci --omit=dev --ignore-scripts

echo "[4/5] Checking release"
npm run check

echo "[5/5] Restarting $SERVICE"
sudo systemctl restart "$SERVICE"
sudo systemctl is-active --quiet "$SERVICE"

echo "Deployment complete: $(git rev-parse --short HEAD)"
