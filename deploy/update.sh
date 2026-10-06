#!/usr/bin/env bash
# 在主機上更新到 GitHub main 最新版本並重啟 bot
# 用法：sudo bash /opt/werewolf/app/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/werewolf/app
sudo -u werewolf git -C "$APP_DIR" pull --ff-only
cd "$APP_DIR"
sudo -u werewolf npm ci
sudo systemctl restart werewolf
echo "更新完成。看 log：sudo journalctl -u werewolf -f"
