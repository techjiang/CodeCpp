'use strict';

/* 用 .NET Framework 自带 csc.exe 编译 CodeCpp.exe（带图标、无控制台窗口） */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(__dirname, 'launcher.cs');
const ICON = path.join(__dirname, 'icon.ico');
const OUT = path.join(ROOT, 'CodeCpp.exe');

if (!fs.existsSync(ICON)) require('./gen-icon.js');

const candidates = [
  path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework/v4.0.30319/csc.exe')
];
const csc = candidates.find((p) => fs.existsSync(p));
if (!csc) {
  console.error('[CodeCpp] 未找到 .NET Framework 编译器 csc.exe，无法生成 CodeCpp.exe');
  process.exit(1);
}

try {
  execFileSync(csc, [
    '/nologo', '/target:winexe', '/optimize+',
    '/win32icon:' + ICON,
    '/out:' + OUT,
    SOURCE
  ], { stdio: 'inherit' });
  console.log('[CodeCpp] 桌面启动器已生成：' + OUT);
} catch (error) {
  console.error('[CodeCpp] 启动器编译失败：', error.message);
  process.exit(1);
}
