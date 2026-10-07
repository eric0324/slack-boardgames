#!/usr/bin/env bash
# 在全新的 Ubuntu 24.04 主機上安裝 werewolf bot（Google Cloud e2-micro 等小主機）
# 用法：curl -fsSL https://raw.githubusercontent.com/eric0324/slack-werewolve/main/deploy/setup.sh | bash
set -euo pipefail

REPO=https://github.com/eric0324/slack-werewolve.git
HOME_DIR=/opt/werewolf
APP_DIR=$HOME_DIR/app

echo "==> 安裝 Node.js 22 和 git"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

echo "==> 加 1GB swap（e2-micro 只有 1GB 記憶體，安裝套件時比較保險）"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> 建立 werewolf 系統帳號"
id werewolf >/dev/null 2>&1 || sudo useradd --system --create-home --home-dir "$HOME_DIR" --shell /usr/sbin/nologin werewolf

echo "==> 下載程式"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u werewolf git -C "$APP_DIR" pull --ff-only
else
  sudo -u werewolf git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
sudo -u werewolf npm ci

echo "==> 設定 systemd"
sudo cp deploy/werewolf.service /etc/systemd/system/werewolf.service
sudo systemctl daemon-reload
sudo systemctl enable werewolf

if [ ! -f "$APP_DIR/.env" ]; then
  sudo -u werewolf cp .env.example .env
  sudo chmod 600 "$APP_DIR/.env"
  echo
  echo "安裝完成。接下來："
  echo "  1. 填入 token：sudo -u werewolf nano $APP_DIR/.env"
  echo "  2. 啟動 bot：  sudo systemctl start werewolf"
  echo "  3. 看 log：    sudo journalctl -u werewolf -f"
else
  sudo systemctl restart werewolf
  echo "安裝完成，bot 已重新啟動。看 log：sudo journalctl -u werewolf -f"
fi
