'use strict';

/* 一键发布构建：重建便携版 -> 便携版 zip -> 单文件安装器 exe -> 校验和 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'CodeCpp-win32-x64');
const RELEASE = path.join(ROOT, 'release');
const BUILD = path.join(ROOT, 'build');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const PORTABLE = path.join(RELEASE, 'CodeCpp-' + VERSION + '-win64-portable.zip');
const SETUP = path.join(RELEASE, 'CodeCpp-Setup-' + VERSION + '.exe');
const UNINSTALLER = path.join(BUILD, 'CodeCpp.Uninstall.exe');
const ICON = path.join(__dirname, 'icon.ico');
const USERDATA = path.join(DIST, 'resources', 'app', '.codecpp');
const BACKUP = path.join(BUILD, 'userdata-backup');

const rm = (p) => {
  if (!fs.existsSync(p)) return;
  try { execFileSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', p], { stdio: 'ignore' }); }
  catch (_) { /* 目录被占用时保留，后续覆盖写入 */ }
};
const log = (msg) => console.log('[CodeCpp] ' + msg);

rm(BUILD);
fs.mkdirSync(BUILD, { recursive: true });
let hasBackup = false;
if (fs.existsSync(USERDATA)) {
  fs.cpSync(USERDATA, BACKUP, { recursive: true });
  hasBackup = true;
  log('已备份本地用户配置（发布包将保持干净）');
}

log('重新构建便携版（替换旧产物）…');
if (!fs.existsSync(ICON)) require('./gen-icon.js');
execFileSync(process.execPath, [path.join(__dirname, 'build-portable.js')], { stdio: 'inherit', cwd: ROOT });
if (!fs.existsSync(path.join(DIST, 'CodeCpp.exe'))) throw new Error('便携版构建失败');

rm(RELEASE);
fs.mkdirSync(RELEASE, { recursive: true });

log('压缩便携版 zip…');
const ps = [
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  "$src = '" + DIST.replace(/'/g, "''") + "'",
  "$dst = '" + PORTABLE.replace(/'/g, "''") + "'",
  '[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $false)'
].join('\n');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit', cwd: ROOT });

if (hasBackup) {
  fs.cpSync(BACKUP, USERDATA, { recursive: true, force: true });
  log('已恢复本地用户配置');
}

const csc = [
  path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework/v4.0.30319/csc.exe')
].find((p) => fs.existsSync(p));
if (!csc) throw new Error('未找到 .NET Framework 编译器 csc.exe');

log('编译卸载器…');
execFileSync(csc, [
  '/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
  '/win32icon:' + ICON, '/out:' + UNINSTALLER,
  path.join(__dirname, 'uninstaller.cs')
], { stdio: 'inherit', cwd: ROOT });

log('编译单文件安装器（内嵌便携版，体积较大请稍候）…');
execFileSync(csc, [
  '/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
  '/win32icon:' + ICON,
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
  '/r:System.IO.Compression.FileSystem.dll',
  '/resource:' + PORTABLE + ',CodeCpp.Payload.zip',
  '/resource:' + UNINSTALLER + ',CodeCpp.Uninstaller.exe',
  '/out:' + SETUP, path.join(__dirname, 'installer.cs')
], { stdio: 'inherit', cwd: ROOT });

const sums = [SETUP, PORTABLE].map((file) => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return hash + '  ' + path.basename(file);
}).join('\n') + '\n';
fs.writeFileSync(path.join(RELEASE, 'SHA256SUMS.txt'), sums, 'utf8');

log('发布产物：');
for (const file of [SETUP, PORTABLE, path.join(RELEASE, 'SHA256SUMS.txt')]) {
  log('  ' + path.basename(file) + '  ' + (fs.statSync(file).size / 1048576).toFixed(1) + ' MB');
}
