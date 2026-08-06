# opencode-browser-cdp

[English](README.md) | [Русский](README.ru.md) | [中文](README.zh-CN.md)

[GitHub 仓库](https://github.com/Nor1m/opencode-browser-cdp)

[![CI](https://github.com/Nor1m/opencode-browser-cdp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nor1m/opencode-browser-cdp/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/Nor1m/opencode-browser-cdp)](LICENSE)

通过持久化 Puppeteer CDP 连接为 OpenCode 提供快速浏览器自动化。插件控制真实的
Chromium 窗口，并添加一个 **`browser`** 工具。

## 快速开始

将 GitHub 插件添加到 `~/.config/opencode/opencode.json` 或
`~/.config/opencode/opencode.jsonc`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:Nor1m/opencode-browser-cdp#main"]
}
```

重启 OpenCode，然后让代理打开网页，或直接调用工具：

```text
browser action=status
browser action=open url=https://example.com
browser action=text
```

OpenCode 会直接从 GitHub 安装该 Git 修订版及其依赖，无需全局安装、包装脚本、MCP
服务器或独立驱动。首次安装后 OpenCode 会缓存 Git spec；升级时请改用新的 commit SHA
或 Git 标签。

## 主要功能

- 控制可见的 Chrome、Chromium、Edge、Brave 或 Opera 窗口。
- 每个端口复用一个持久 CDP 连接，避免每次操作重新连接。
- 按端口串行执行操作，防止键盘和表单竞争。
- 记住最近一次显式指定的 CDP 端口。
- 快速原生 `fill`，并为复杂控件提供安全的键盘回退。
- 自动滚动到目标，显示 DOM 光标和焦点高亮。
- 右上角 HUD 显示任务、进度和速度设置。
- 在 OpenCode 调用之间保留会话、Cookie、登录状态、标签页和配置文件。
- 支持 Windows、macOS 和 Linux，并自动搜索安装路径及 `PATH`。

## 操作

| 操作 | 用途 | 主要参数 |
|---|---|---|
| `start` | 启动或连接 Chromium CDP | `headed`, `port` |
| `status` | 查看 CDP 与浏览器状态 | `port` |
| `tabs` | 列出标签页 | `port` |
| `open` | 打开 URL | `url`, `newTab` |
| `back`, `reload` | 浏览器导航 | `timeoutMs` |
| `text`, `html` | 读取页面内容 | `selector`, `maxChars` |
| `eval` | 在页面中执行 JavaScript | `expression` |
| `click` | 按 CSS 选择器或可见文本点击 | `selector`, `text` |
| `fill` | 替换可编辑值 | `selector`, `value`, `delay` |
| `type` | 向元素输入文本 | `selector`, `value`, `delay` |
| `select`, `check` | 设置表单控件 | `selector`, `value` |
| `press` | 发送按键 | `selector`, `key` |
| `wait` | 等待选择器、文本或时间 | `selector`, `text`, `timeoutMs` |
| `screenshot` | 保存 PNG 截图 | `name`, `fullPage` |
| `cookies` | 关闭常见 Cookie 横幅 | 无 |
| `close_tab` | 关闭当前标签页 | 无 |

`fill` 默认即时完成并触发 `input` 和 `change` 事件。需要键盘事件或输入掩码时，
请设置正数 `delay`。

## 浏览器与端口

设置 `OPENCODE_CHROME_PATH` 可指定浏览器程序。否则插件会在标准位置和 `PATH`
中查找 Chrome、Chromium、Edge、Brave 和 Opera。

CDP 端口优先级：

1. 当前工具调用的 `port` 参数。
2. `OPENCODE_CDP_PORT`。
3. 插件状态中最近一次显式端口。
4. `9223`。

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `OPENCODE_CDP_PORT` | `9223` | 远程调试端口 |
| `OPENCODE_CHROME_PATH` | 自动检测 | Chromium 可执行文件 |
| `OPENCODE_CHROME_PROFILE` | 系统临时目录 | 浏览器配置文件目录 |
| `OPENCODE_BROWSER_SHOT_DIR` | 系统临时目录 | 截图目录 |
| `OPENCODE_BROWSER_VISUALS` | `1` | 设为 `0` 关闭光标、焦点框和 HUD |
| `OPENCODE_BROWSER_VISUAL_DELAY` | `80` | 光标动画延迟（毫秒） |
| `OPENCODE_BROWSER_ACTION_DELAY` | `350` | 操作间基础延迟（毫秒） |

## 可视化引导

执行操作前，插件会把目标滚动到视口中央，移动自己的 DOM 光标，并高亮目标元素。
它不会移动或占用用户的系统光标。只有 **Pace** 滑块接收用户输入，其余覆盖层不会
阻挡网页。

HUD 显示正在运行和排队的操作。可使用可选 `task` 参数提供更易读的任务名称。
执行 `screenshot` 时会隐藏全部可视化元素，完成后自动恢复。

每个受控标签页只通过 CDP 注册一次可视化运行时，并在页面脚本之前执行，因此导航和
严格 CSP 都不需要重复注入完整界面。同源导航时，HUD 状态会通过 `sessionStorage`
自动恢复；跨源导航后，下一次浏览器操作会同步最新状态。

默认操作间隔为 `350 ms`，并带有 ±20% 的随机变化。可通过 HUD 中的 **Pace**
滑块或 `OPENCODE_BROWSER_ACTION_DELAY` 修改；设置为 `0` 可获得最高速度。

## 开发

```bash
git clone https://github.com/Nor1m/opencode-browser-cdp.git
cd opencode-browser-cdp
npm install
npm run check
```

本地测试时先构建项目，再通过绝对 file URL 加载 `dist/index.js`：

```bash
npm run build
```

```json
{
  "plugin": ["file:///absolute/path/opencode-browser-cdp/dist/index.js"]
}
```

修改插件或配置后请重启 OpenCode。测试和发布流程见
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
