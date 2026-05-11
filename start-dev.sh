#!/bin/bash

set -euo pipefail

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

RESET_DEV_DB=false
WORKERS=0
for arg in "$@"; do
  case "$arg" in
    --reset-db)
      RESET_DEV_DB=true
      ;;
    --workers=*)
      WORKERS="${arg#*=}"
      if ! [[ "$WORKERS" =~ ^[0-9]+$ ]] || [ "$WORKERS" -lt 1 ]; then
        echo -e "${YELLOW}Invalid --workers value: $WORKERS (must be positive integer)${NC}"
        exit 1
      fi
      ;;
    --help|-h)
      echo "Usage: ./start-dev.sh [--reset-db] [--workers=N]"
      echo "  --reset-db   在启动前执行 pnpm --filter yidhras-server run reset:dev-db"
      echo "  --workers=N  启动 N 个 server worker 进程（多 worker 横向扩展模式）"
      echo "               每个 worker 监听不同端口（3001, 3002, ...）"
      echo "               不设置时默认单 worker 模式"
      exit 0
      ;;
    *)
      echo -e "${YELLOW}Unknown argument: $arg${NC}"
      echo "Usage: ./start-dev.sh [--reset-db] [--workers=N]"
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

SERVER_PIDS=()

if [ "$WORKERS" -gt 0 ]; then
  # 多 worker 模式：启动 N 个 server 进程，每个监听不同端口
  echo -e "${YELLOW}Starting $WORKERS server workers...${NC}"
  for ((i=0; i<WORKERS; i++)); do
    SCHEDULER_WORKER_INDEX="$i" SCHEDULER_WORKER_TOTAL="$WORKERS" \
      npx tsx apps/server/src/index.ts &
    SERVER_PIDS+=($!)
    echo -e "${GREEN}Worker $i started with PID: ${SERVER_PIDS[$i]} (port $((3001 + i)))${NC}"
    sleep 0.5
  done
else
  # 单 worker 模式（默认）
  pnpm --filter yidhras-server dev &
  SERVER_PIDS+=($!)
  echo -e "${GREEN}Server started with PID: ${SERVER_PIDS[0]}${NC}"
fi

# 启动前端服务
pnpm --filter web dev &
WEB_PID=$!
echo -e "${GREEN}Web started with PID: $WEB_PID${NC}"

echo -e "${GREEN}All services are running!${NC}"
if [ "$WORKERS" -gt 0 ]; then
  for ((i=0; i<WORKERS; i++)); do
    echo -e "${GREEN}Worker $i: http://localhost:$((3001 + i))${NC}"
  done
else
  echo -e "${GREEN}Server: http://localhost:3001${NC}"
fi
echo -e "${GREEN}Web: http://localhost:3000${NC}"
echo ""
echo "Press Ctrl+C to stop all services"

cleanup() {
  for pid in "${SERVER_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  kill "$WEB_PID" 2>/dev/null || true
}

trap cleanup INT TERM

# 等待用户中断
wait
