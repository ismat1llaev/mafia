@echo off
chcp 65001 >nul
title Обновление игры Мафия
color 0F

echo.
echo ================================================
echo           ОБНОВЛЕНИЕ ИГРЫ "МАФИЯ"
echo ================================================
echo.

if not exist "%~dp0package.json" (
  echo  [ОШИБКА] Файл запущен не из той папки.
  echo.
  echo  Рядом с ним должен лежать package.json.
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo  [ОШИБКА] Git не найден.
  echo  Запустите сначала УСТАНОВКА.bat
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0.git" (
  echo  [ОШИБКА] Эта папка ещё не связана с GitHub.
  echo  Запустите сначала УСТАНОВКА.bat
  echo.
  pause
  exit /b 1
)

rem --- Проверяем, что рядом лежат НОВЫЕ файлы, а не старые ---
rem Без этой проверки легко залить старую версию из другой папки
rem и потом гадать, почему в игре ничего не изменилось.
findstr /m /c:"table-felt" "%~dp0client\src\styles.css" >nul 2>nul
if errorlevel 1 (
  echo  [ОШИБКА] В этой папке лежит СТАРАЯ версия игры.
  echo.
  echo  Похоже, новый архив распаковался куда-то ещё,
  echo  а эта папка осталась прежней.
  echo.
  echo  Папка, из которой вы запустили обновление:
  echo  %~dp0
  echo.
  echo  Распакуйте архив именно сюда, с заменой файлов,
  echo  и запустите этот файл заново.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "require('./package.json').version" 2^>nul') do set VER=%%v
echo  Версия в этой папке: %VER%
echo  Папка: %~dp0
echo.
echo  Файлы новые, всё сходится. Отправляю на GitHub.
echo.

call git add -A
call git commit -m "Обновление до версии %VER%"
if errorlevel 1 (
  echo.
  echo  Изменений нет - отправлять нечего.
  echo  Похоже, эта версия уже загружена.
  echo.
  pause
  exit /b 0
)

call git push
if errorlevel 1 (
  echo.
  echo  [ОШИБКА] Не удалось отправить на GitHub.
  echo  Скопируйте текст выше и покажите его Клоду.
  echo.
  pause
  exit /b 1
)

echo.
echo ================================================
echo  ГОТОВО. Код отправлен на GitHub.
echo ================================================
echo.
echo  Render увидит изменения сам и пересоберёт игру.
echo  Это займёт 2-4 минуты.
echo.
echo  Следить за сборкой: dashboard.render.com
echo  вкладка Logs у сервиса mafia.
echo.
pause
