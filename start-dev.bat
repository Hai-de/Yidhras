@echo off
echo Starting Yidhras Development Services...

REM 启动后端
cd apps\server
start /B npm run dev
echo Server started

REM 返回根目录
cd ..\..

REM 启动前端
cd apps\web
start /B npm run dev
echo Web started

cd ..\..
echo.
echo Both services are running!
echo Server: http://localhost:3001
echo Web: http://localhost:3000
echo.
echo Press any key to stop all services...
pause
taskkill /F /IM node.exe