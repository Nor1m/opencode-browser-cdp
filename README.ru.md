# opencode-browser-cdp

[English](README.md) | [Русский](README.ru.md) | [中文](README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/opencode-browser-cdp)](https://www.npmjs.com/package/opencode-browser-cdp)
[![CI](https://github.com/Nor1m/opencode-browser-cdp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nor1m/opencode-browser-cdp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/opencode-browser-cdp)](LICENSE)

Быстрая автоматизация браузера для OpenCode через постоянное соединение Puppeteer
CDP. Плагин управляет настоящим окном Chromium и добавляет инструмент **`browser`**.

## Быстрый старт

Добавьте npm-плагин в `~/.config/opencode/opencode.json` или
`~/.config/opencode/opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-browser-cdp@latest"]
}
```

Перезапустите OpenCode и попросите агента открыть страницу либо вызовите инструмент:

```text
browser action=status
browser action=open url=https://example.com
browser action=text
```

OpenCode устанавливает npm-плагины автоматически. Глобальный `npm install`, wrapper,
MCP-сервер и отдельный браузерный драйвер не нужны.

## Возможности

- Управление видимыми окнами Chrome, Chromium, Edge, Brave и Opera.
- Одно постоянное CDP-соединение на порт вместо переподключения при каждом действии.
- Очередь действий на порт без гонок клавиатуры и форм.
- Запоминание последнего явно указанного CDP-порта.
- Мгновенный `fill` с событиями `input`/`change` и безопасным keyboard fallback.
- Автоскролл к цели, DOM-курсор и подсветка активного элемента.
- HUD справа сверху со списком задач, прогрессом и настройкой скорости.
- Сохранение сессий, cookies, авторизаций, вкладок и профиля между вызовами.
- Windows, macOS и Linux; поиск браузера в стандартных каталогах и `PATH`.

## Действия

| Действие | Назначение | Основные аргументы |
|---|---|---|
| `start` | Запустить Chromium CDP или подключиться | `headed`, `port` |
| `status` | Показать состояние CDP и браузера | `port` |
| `tabs` | Список открытых вкладок | `port` |
| `open` | Открыть URL | `url`, `newTab` |
| `back`, `reload` | Навигация | `timeoutMs` |
| `text`, `html` | Прочитать страницу | `selector`, `maxChars` |
| `eval` | Выполнить JavaScript в странице | `expression` |
| `click` | Кликнуть по CSS-селектору или тексту | `selector`, `text` |
| `fill` | Полностью заменить значение поля | `selector`, `value`, `delay` |
| `type` | Допечатать текст | `selector`, `value`, `delay` |
| `select`, `check` | Изменить элементы формы | `selector`, `value` |
| `press` | Нажать клавишу | `selector`, `key` |
| `wait` | Ждать селектор, текст или время | `selector`, `text`, `timeoutMs` |
| `screenshot` | Сохранить PNG | `name`, `fullPage` |
| `cookies` | Закрыть типовые cookie-баннеры | нет |
| `close_tab` | Закрыть активную вкладку | нет |

`fill` по умолчанию мгновенный. Для сайтов с масками или обязательными keyboard
events задайте положительный `delay`.

## Браузер и порт

`OPENCODE_CHROME_PATH` принудительно задаёт исполняемый файл браузера. Без него
плагин ищет Chrome, Chromium, Edge, Brave и Opera в стандартных путях и `PATH`.

Приоритет выбора CDP-порта:

1. Аргумент `port` текущего вызова.
2. `OPENCODE_CDP_PORT`.
3. Последний явно использованный порт из состояния плагина.
4. `9223`.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `OPENCODE_CDP_PORT` | `9223` | Порт remote debugging |
| `OPENCODE_CHROME_PATH` | авто | Исполняемый файл Chromium |
| `OPENCODE_CHROME_PROFILE` | временный каталог ОС | Каталог профиля |
| `OPENCODE_BROWSER_SHOT_DIR` | временный каталог ОС | Каталог скриншотов |
| `OPENCODE_BROWSER_VISUALS` | `1` | `0` отключает курсор, рамку и HUD |
| `OPENCODE_BROWSER_VISUAL_DELAY` | `80` | Задержка анимации курсора, мс |
| `OPENCODE_BROWSER_ACTION_DELAY` | `350` | Базовая задержка между действиями, мс |

## Визуальное управление

Перед действием плагин прокручивает страницу к цели, перемещает собственный DOM-курсор
и подсвечивает элемент. Системный курсор пользователя не перемещается и не
перехватывается. Только ползунок **Pace** принимает пользовательский ввод; остальной
overlay не мешает странице.

HUD показывает выполняемые и ожидающие действия. Аргумент `task` позволяет задать
понятное пользователю название операции. При `screenshot` весь overlay скрывается и
после снимка восстанавливается.

По умолчанию между действиями используется human-like задержка `350 ms` со случайным
отклонением ±20%. Её можно изменить ползунком **Pace** или переменной
`OPENCODE_BROWSER_ACTION_DELAY`. Значение `0` включает максимальную скорость.

## Разработка

```bash
git clone https://github.com/Nor1m/opencode-browser-cdp.git
cd opencode-browser-cdp
npm install
npm run check
```

Для локальной проверки соберите проект и подключите `dist/index.js` абсолютным file URL:

```bash
npm run build
```

```json
{
  "plugin": ["file:///absolute/path/opencode-browser-cdp/dist/index.js"]
}
```

После изменения плагина или конфигурации перезапустите OpenCode. Процесс разработки и
релиза описан в [CONTRIBUTING.md](CONTRIBUTING.md).

## Лицензия

[MIT](LICENSE)
