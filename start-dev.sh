#!/bin/bash

set -euo pipefail

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

RESET_DEV_DB=false
for arg in "$@"; do
  case "$arg" in
    --reset-db)
      RESET_DEV_DB=true
      ;;
    --help|-h)
      echo "Usage: ./start-dev.sh [--reset-db]"
      echo "  --reset-db  在启动前执行 pnpm --filter yidhras-server run reset:dev-db"
      exit 0
      ;;
    *)
      echo -e "${YELLOW}Unknown argument: $arg${NC}"
      echo "Usage: ./start-dev.sh [--reset-db]"
      exit 1
      ;;
  esac
done

echo -e "${YELLOW}Starting Yidhras Development Services...${NC}"

if [ "$RESET_DEV_DB" = true ]; then
  echo -e "${YELLOW}Resetting development database before startup...${NC}"
  pnpm --filter yidhras-server run reset:dev-db
fi

# 启动前：统一准备后端运行前置条件（数据库迁移 + world pack 模板）
pnpm --filter yidhras-server prepare:runtime

# 启动后端服务
pnpm --filter yidhras-server dev &
SERVER_PID=$!
echo -e "${GREEN}Server started with PID: $SERVER_PID${NC}"

# 启动前端服务
pnpm --filter web dev &
WEB_PID=$!
echo -e "${GREEN}Web started with PID: $WEB_PID${NC}"

echo -e "${GREEN}Both services are running!${NC}"
echo -e "${GREEN}Server: http://localhost:3001${NC}"
echo -e "${GREEN}Web: http://localhost:3000${NC}"
echo ""
echo "Press Ctrl+C to stop all services"

cleanup() {
  kill "$SERVER_PID" "$WEB_PID" 2>/dev/null || true
}

trap cleanup INT TERM

# 等待用户中断
wait
