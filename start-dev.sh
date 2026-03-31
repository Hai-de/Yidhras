#!/bin/bash

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Yidhras Development Services...${NC}"

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
  kill "$SERVER_PID" "$WEB_PID" 2>/dev/null
}

trap cleanup INT TERM

# 等待用户中断
wait
