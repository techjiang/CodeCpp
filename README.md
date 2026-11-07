# CodeCpp

面向 C 语言的**桌面 APP**（Windows / Electron），不是网页工作台。双击 EXE 即打开独立原生窗口，本地服务内嵌在主进程中，无需浏览器地址栏；关闭窗口默认最小化到系统托盘。

> 同一个世界，同一个互联网！

## 作者

**科技酱**

| | |
| --- | --- |
| 站点 | https://www.asoe.cn |
| 技术文档 | https://docs.asoe.cn |
| GitHub | https://github.com/techjiang/ |
| 哔哩哔哩 | https://space.bilibili.com/1768832152 |
| 玲珑论坛 | https://forums.asoe.cn/ |
| 邮箱 | official@tech.asoe.cn |
| QQ群 | 291974598 · 474819022 · 631167288 |

© 科技酱 · MIT 许可

## 启动

| 场景 | 操作 |
| --- | --- |
| 日常使用（推荐） | 双击 `dist/CodeCpp-win32-x64/CodeCpp.exe` —— 便携版，无需 Node.js、npm 或浏览器 |
| 开发目录 | 双击 `CodeCpp.exe` 或 `start.bat`（等价于 `npm start`） |
| 开发模式 | `npm run app:dev` |
| 桌面自检 | `npm run app:selftest`，结果写入 `.codecpp/selftest.json` |
| 应急回退 | 未安装 Electron 时 `start.bat` 自动进入浏览器模式，或手动 `npm run browser` |

**桌面行为**：标题栏的关闭按钮是「隐藏到托盘」，托盘右键或 `CodeCpp → 退出 CodeCpp` 才完全退出；退出、切换工作区、关闭标签时若有未保存文件，会提供「保存 / 不保存 / 取消」三选保护。原生菜单默认隐藏，按 `Alt` 可唤出，命令与界面菜单一致。运行日志位于 `%APPDATA%\codecpp\codecpp.log`，也可从 `CodeCpp → 打开运行日志` 打开。

开发目录首次运行前需 `npm install`。重新生成图标、原生启动器和便携版：

```bat
npm run build:icon
npm run build:exe
npm run dist
```

`build:exe` 需要系统自带的 .NET Framework `csc.exe`；`dist` 需要已安装 Electron runtime。

## 功能

- 多标签编辑器：C 语法高亮、行号、括号匹配、查找替换、代码片段补全、参数提示、缩略图、格式化
- 静态分析：括号/字符串/注释诊断、危险函数、格式串参数、缺分号、全角标点
- 项目：文件树（新建/重命名/删除/在文件管理器中显示）、全项目搜索、符号大纲、TODO、C 项目模板
- 构建运行：gcc / clang / Makefile / CMake，编译器诊断解析并跳转到问题面板，输出、运行与终端面板
- 调试：gdb MI 断点、单步、调用栈、局部变量、监视表达式、调试控制台
- 桌面能力：无边框标题栏与窗口控制、单实例、托盘、原生文件夹选择、完整原生菜单（按 Alt 显示）、窗口状态记忆与多显示器位置校验
- 数据安全：退出/切换工作区/关闭标签时的三选保存保护、退出前一键保存全部、标题栏未保存标记

## 内置编译器（开箱即用）

参考 Dev-C++ 随包自带 MinGW/GCC 的做法，CodeCpp 提供**一键安装并内置编译器**：

- 欢迎页或「工具 → 安装 / 管理编译器」点击「一键安装编译器」，APP 自动查询 WinLibs 最新 MinGW-w64 发行包、下载 `.zip` / `.7z`、解压到 `%APPDATA%\codecpp\toolchain\mingw64`，并自动写入 `gcc.exe` / `gdb.exe` / `mingw32-make.exe` 路径，无需手动配置 PATH。
- 安装过程有进度、日志与取消按钮；已下载的压缩包会复用，不会重复下载。
- 网络不可用或下载源被墙时：用「导入本地压缩包」选择已下载的 `.zip` / `.7z`，或用「从链接安装」粘贴任意下载直链；也可以在「设置 → 工具链路径」手动填写已有的 gcc / gdb 路径。
- 首次安装需下载约 100–300 MB 第三方工具链（GCC/GDB 为 GPL 许可，不随 APP 安装包分发）；安装完成后编译器常驻用户数据目录，之后启动即可直接编译运行，便携版放在只读目录也能安装。

编译器就绪后：`Ctrl+B` 编译、`F5` 运行、`Alt+R` 编译并运行、`Ctrl+F5` 启动 gdb 调试。未安装时编辑器、静态分析、模板与搜索仍可离线使用。

便携版工作区默认在 `resources/app/workspace`，可通过「文件 → 打开文件夹」切换。

## 测试

```bat
npm test
```

覆盖词法/诊断/符号/编译器诊断/参数拆分/gdb MI 解析等核心单元测试，以及路径安全、文件读写、模板、搜索、终端、调试状态等 API 集成测试。

## 目录

```
desktop/    Electron 主进程、preload 桥接、图标/启动器/便携版构建脚本
server/     内嵌本地服务：文件、分析、构建、调试、工具链、REST API
web/        APP 窗口内的界面（渲染进程）
workspace/  默认 C 工程
tests/      自动化测试
dist/       免安装便携版 APP
```

配置和窗口状态保存在 `.codecpp/`。

## 发布版本

GitHub Releases 的 `v1.0.0` 提供两种 Windows 分发方式：

| 产物 | 说明 |
| --- | --- |
| `CodeCpp-Setup-1.0.0.exe` | 安装版：图形向导、可选安装目录、开始菜单与桌面快捷方式、可在「应用和功能」中卸载 |
| `CodeCpp-1.0.0-win64-portable.zip` | 便携版：解压即用，无需安装、无需管理员权限、可放在 U 盘 |
| `SHA256SUMS.txt` | 两个产物的 SHA-256 校验值 |

安装版默认安装到 `%LOCALAPPDATA%\Programs\CodeCpp`，不修改系统 PATH、不写入系统目录。首次使用在欢迎页点击「一键安装编译器」即可自动配置 MinGW-w64（gcc / gdb / make）。

本地重新生成全部发布产物（会先重建并替换旧的便携版）：

```bat
npm run build:release
```

产物输出到 `release/`。
