#!/bin/bash

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Yidhras Development Services...${NC}"

# 启动前：统一准备后端运行前置条件（数据库迁移 + world pack 模板）
npm run prepare:runtime --prefix apps/server

# 启动后端服务
cd apps/server
npm run dev &
SERVER_PID=$!
echo -e "${GREEN}Server started with PID: $SERVER_PID${NC}"

# 返回根目录
cd ../..

# 启动前端服务
cd apps/web
npm run dev &
WEB_PID=$!
echo -e "${GREEN}Web started with PID: $WEB_PID${NC}"

# 返回根目录
cd ../..

echo -e "${GREEN}Both services are running!${NC}"
echo -e "${GREEN}Server: http://localhost:3001${NC}"
echo -e "${GREEN}Web: http://localhost:3000${NC}"
echo ""
echo "Press Ctrl+C to stop all services"

# 等待用户中断
wait
