@echo off
chcp 65001 >nul
title Установка игры Мафия
color 0F

echo.
echo ================================================
echo            УСТАНОВКА ИГРЫ "МАФИЯ"
echo ================================================
echo.
echo  Этот файл выложит игру на GitHub. Оттуда её
echo  заберёт Render и запустит.
echo.
echo  От вас нужно: один раз войти в GitHub в браузере.
echo.
echo ------------------------------------------------
echo.

rem --- Проверяем, что файл лежит в правильной папке ---
if not exist "%~dp0package.json" (
  echo  [ОШИБКА] Файл запущен не из той папки.
  echo.
  echo  Рядом с этим файлом должен лежать package.json.
  echo  Скорее всего, архив распакован не полностью
  echo  или вы запустили файл прямо из архива.
  echo.
  echo  Распакуйте архив целиком ^(правый клик по нему
  echo  и "Извлечь все"^) и запустите файл уже из
  echo  распакованной папки.
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0"

rem --- Шаг 1: Node.js ---
echo  [1/4] Проверяю Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js не установлен. Без него не получится.
  echo.
  echo  Сейчас откроется сайт nodejs.org.
  echo  Скачайте зелёную кнопку с надписью LTS,
  echo  установите ^(везде жмите "Next"^), а потом
  echo  запустите этот файл заново.
  echo.
  pause
  start https://nodejs.org/en/download
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo        Node.js найден: %%v
echo.

rem --- Шаг 2: Git и GitHub CLI ---
echo  [2/4] Проверяю Git...
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Git не установлен. Без него код не попадёт на GitHub.
  echo.
  echo  Сейчас откроется сайт git-scm.com.
  echo  Скачайте и установите ^(везде жмите "Next"^),
  echo  потом запустите этот файл заново.
  echo.
  pause
  start https://git-scm.com/download/win
  exit /b 1
)
echo        Git найден.

where gh >nul 2>nul
if errorlevel 1 (
  echo        Ставлю GitHub CLI ^(полминуты^)...
  call winget install --id GitHub.cli --silent --accept-package-agreements --accept-source-agreements >nul 2>nul
  where gh >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось поставить GitHub CLI.
    echo.
    echo  Скачайте его вручную: cli.github.com
    echo  Установите, перезапустите этот файл.
    echo.
    pause
    start https://cli.github.com
    exit /b 1
  )
)
echo        GitHub CLI найден.
echo.

rem --- Шаг 3: вход в GitHub ---
echo  [3/4] Вход в GitHub.
echo.
call gh auth status >nul 2>nul
if errorlevel 1 (
  echo        Сейчас откроется браузер - подтвердите вход,
  echo        потом вернитесь сюда.
  echo.
  echo        В вопросах выбирайте: GitHub.com, HTTPS,
  echo        "Login with a web browser".
  echo.
  pause
  call gh auth login
  if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Войти не получилось. Запустите файл заново.
    echo.
    pause
    exit /b 1
  )
)
echo        Вход выполнен.
echo.

rem --- Шаг 4: репозиторий ---
echo  [4/4] Выкладываю код на GitHub.
echo.

if not exist "%~dp0.git" (
  call git init -b main >nul
)
call git add -A
call git commit -m "Мафия" >nul 2>nul

call git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo        Создаю приватный репозиторий mafia...
  call gh repo create mafia --private --source=. --remote=origin --push
  if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось создать репозиторий.
    echo  Скопируйте текст выше и покажите его Клоду.
    echo.
    pause
    exit /b 1
  )
) else (
  call git push -u origin main
  if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось отправить код.
    echo  Скопируйте текст выше и покажите его Клоду.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo ================================================
echo               КОД ВЫЛОЖЕН
echo ================================================
echo.
echo  Осталось создать сервис на Render:
echo.
echo   1. Откроется dashboard.render.com
echo   2. New - Blueprint
echo   3. Подключите GitHub и выберите репозиторий mafia
echo   4. Render прочитает render.yaml сам
echo   5. Впишите BOT_TOKEN и BOT_USERNAME
echo   6. Нажмите Apply
echo.
echo  Если что-то непонятно - напишите Клоду "выложилось",
echo  он подскажет по шагам.
echo.
pause
start https://dashboard.render.com/blueprints
