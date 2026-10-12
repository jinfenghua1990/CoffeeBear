#!/bin/sh
set -e

# CoffeeBear 极空间 Q4 更新脚本
# 用法：在 Q4 项目目录执行 ./deploy/update-q4.sh

cd "$(dirname "$0")/.."

git pull origin main
docker compose up -d --build

echo "CoffeeBear update completed"
