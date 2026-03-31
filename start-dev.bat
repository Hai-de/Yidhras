@echo off
echo Starting Yidhras Development Services...

REM 启动前：统一准备后端运行前置条件（数据库迁移 + world pack 模板）
pnpm --filter yidhras-server prepare:runtime
if errorlevel 1 exit /b 1

REM 启动后端
start /B pnpm --filter yidhras-server dev
echo Server started

REM 启动前端
start /B pnpm --filter web dev
echo Web started

echo.
echo Both services are running!
echo Server: http://localhost:3001
echo Web: http://localhost:3000
echo.
echo Press any key to stop all services...
pause
taskkill /F /IM node.exe
