'use strict';

/* 生成可拷贝的便携版桌面 APP（无需安装、无需 node_modules） */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const OUT = path.join(ROOT, 'dist', 'CodeCpp-win32-x64');

if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  console.error('[CodeCpp] 未找到 Electron 运行时，请先执行 npm install');
  process.exit(1);
}
if (!fs.existsSync(path.join(__dirname, 'icon.ico'))) require('./gen-icon.js');

if (fs.existsSync(OUT)) {
  try { execFileSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', OUT], { stdio: 'ignore' }); }
  catch (_) { /* 目录被占用时退化为覆盖复制 */ }
}
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(ELECTRON_DIST, OUT, { recursive: true });

const appDir = path.join(OUT, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const dir of ['server', 'web', 'desktop']) {
  fs.cpSync(path.join(ROOT, dir), path.join(appDir, dir), { recursive: true });
}
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'codecpp', version: '1.0.0', private: true, main: 'desktop/main.js',
  description: 'CodeCpp - 面向 C 语言的桌面集成开发环境 · 同一个世界，同一个互联网！',
  author: '科技酱 <official@tech.asoe.cn> (https://www.asoe.cn)',
  homepage: 'https://www.asoe.cn', license: 'MIT'
}, null, 2), 'utf8');
fs.mkdirSync(path.join(appDir, 'workspace'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'workspace', 'main.c'), path.join(appDir, 'workspace', 'main.c'));
fs.copyFileSync(path.join(ROOT, 'workspace', 'README.md'), path.join(appDir, 'workspace', 'README.md'));

const exeSource = path.join(OUT, 'electron.exe');
const exeTarget = path.join(OUT, 'CodeCpp.exe');
if (fs.existsSync(exeSource)) fs.renameSync(exeSource, exeTarget);
fs.writeFileSync(path.join(OUT, '启动说明.txt'),
  'CodeCpp 便携版\n\n双击 CodeCpp.exe 即可启动，无需安装 Node.js 或浏览器。\n' +
  '工作区默认位于 resources/app/workspace，可在 APP 内通过「文件 → 打开文件夹」切换。\n' +
  '首次使用可在欢迎页或「工具 → 安装 / 管理编译器」一键安装 MinGW-w64（gcc/gdb/make），自动配置。\n' +
  '网络不可用时可导入本地 .zip / .7z 编译器包，或在「设置 → 工具链路径」手动填写 gcc 路径。\n' +
  '关闭按钮会最小化到系统托盘；托盘右键或「CodeCpp → 退出 CodeCpp」才完全退出。\n' +
  '存在未保存文件时退出会提示保存；运行日志可从「CodeCpp → 打开运行日志」查看。\n\n' +
  '作者：科技酱 · 同一个世界，同一个互联网！\n' +
  '站点 https://www.asoe.cn · 文档 https://docs.asoe.cn · GitHub https://github.com/techjiang/\n' +
  '邮箱 official@tech.asoe.cn · QQ群 291974598 / 474819022 / 631167288\n' +
  '© 科技酱 · MIT 许可\n', 'utf8');
console.log('[CodeCpp] 便携版已生成：' + OUT);
console.log('[CodeCpp] 入口：' + exeTarget);
