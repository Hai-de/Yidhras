@echo off
setlocal enabledelayedexpansion

echo Starting Yidhras Development Services...

set "RESET_DEV_DB=0"

:parse_args
if "%~1"=="" goto after_args
if /I "%~1"=="--reset-db" (
  set "RESET_DEV_DB=1"
  shift
  goto parse_args
)
if /I "%~1"=="--help" goto show_help
if /I "%~1"=="-h" goto show_help

echo Unknown argument: %~1
call :show_usage
exit /b 1

:show_help
call :show_usage
exit /b 0

:show_usage
echo Usage: start-dev.bat [--reset-db]
echo   --reset-db  在启动前执行 pnpm --filter yidhras-server run reset:dev-db
goto :eof

:after_args
if "%RESET_DEV_DB%"=="1" (
  echo Resetting development database before startup...
  pnpm --filter yidhras-server run reset:dev-db
  if errorlevel 1 exit /b 1
)

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
