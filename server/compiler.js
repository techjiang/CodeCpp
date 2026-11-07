'use strict';

/* CodeCpp 内置编译器：自动下载 / 导入本地包，解压并自动配置 MinGW-w64 (gcc + gdb + make) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const dirs = require('./toolchain-dir');
const store = require('./store');
const toolchain = require('./toolchain');

const RELEASE_API = 'https://api.github.com/repos/brechtsanders/winlibs_mingw/releases/latest';
const DOWNLOAD_PAGES = [
  { name: 'WinLibs 官网', url: 'https://winlibs.com/' },
  { name: 'GitHub Releases', url: 'https://github.com/brechtsanders/winlibs_mingw/releases' }
];
const UA = 'CodeCpp/1.0 (compiler installer)';

let task = idle();
let activeRequest = null;
let activeProcess = null;
let versionCache = { file: '', value: '' };

function idle() {
  return {
    phase: 'idle', progress: 0, message: '', source: '', error: '',
    log: [], startedAt: 0, finishedAt: 0, cancelRequested: false
  };
}

function note(message, progress, record) {
  task.message = message;
  if (typeof progress === 'number') task.progress = Math.max(0, Math.min(100, Math.round(progress)));
  if (record !== false) {
    task.log.push(message);
    if (task.log.length > 60) task.log.shift();
  }
}

function fileExists(file) {
  try { return fs.statSync(file).isFile() ? file : null; }
  catch (_) { return null; }
}

function executables(bin) {
  const isWin = process.platform === 'win32';
  const find = (names) => {
    for (const name of names) {
      const hit = fileExists(path.join(bin, name));
      if (hit) return hit;
    }
    return '';
  };
  return {
    compiler: find(isWin ? ['gcc.exe', 'clang.exe'] : ['gcc', 'clang']),
    debugger: find(isWin ? ['gdb.exe'] : ['gdb']),
    make: find(isWin ? ['mingw32-make.exe', 'make.exe'] : ['make'])
  };
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function versionOf(compiler) {
  if (!compiler) return '';
  if (versionCache.file === compiler) return versionCache.value;
  let value = '';
  try {
    const r = require('child_process').spawnSync(compiler, ['--version'], {
      encoding: 'utf8', timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024
    });
    value = String(r.stdout || r.stderr || '').split(/\r?\n/)[0].trim().slice(0, 120);
  } catch (_) {}
  versionCache = { file: compiler, value };
  return value;
}

function status() {
  const found = executables(dirs.bin());
  return {
    installed: Boolean(found.compiler),
    dir: dirs.root(),
    bin: dirs.bin(),
    compiler: found.compiler,
    debugger: found.debugger,
    make: found.make,
    version: versionOf(found.compiler),
    pages: DOWNLOAD_PAGES,
    task: Object.assign({}, task, { log: task.log.slice(-8) })
  };
}

function fetchText(url, timeout, redirects) {
  return new Promise((resolve, reject) => {
    if ((redirects || 0) > 5) return reject(new Error('重定向过多'));
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), timeout, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.setTimeout(timeout || 10000, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

async function latestAsset() {
  const text = await fetchText(RELEASE_API, 10000);
  let release;
  try { release = JSON.parse(text); }
  catch (_) { throw new Error('编译器下载地址解析失败'); }
  const assets = (release.assets || []).filter((a) => /\.(zip|7z)$/i.test(a.name) && /x86_64|amd64/i.test(a.name));
  const preferred = assets.find((a) => /\.zip$/i.test(a.name) && !/llvm/i.test(a.name)) ||
    assets.find((a) => !/llvm/i.test(a.name)) ||
    assets.find((a) => /\.zip$/i.test(a.name)) || assets[0];
  if (!preferred || !preferred.browser_download_url) {
    throw new Error('未找到适用于 64 位 Windows 的编译器压缩包，请手动下载后导入');
  }
  return {
    url: preferred.browser_download_url,
    name: preferred.name,
    size: Number(preferred.size) || 0
  };
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const run = (current, redirects) => {
      if (redirects > 6) return reject(new Error('下载重定向过多'));
      const lib = current.startsWith('https:') ? https : http;
      const req = lib.get(current, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return run(new URL(res.headers.location, current).toString(), redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('下载失败：HTTP ' + res.statusCode));
        }
        const total = Number(res.headers['content-length']) || 0;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const file = fs.createWriteStream(dest);
        let received = 0;
        activeRequest = req;
        res.on('data', (chunk) => {
          received += chunk.length;
          onProgress(total ? (received / total) * 100 : 0, received, total);
          if (task.cancelRequested) req.destroy(new Error('已取消'));
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => { activeRequest = null; resolve(received); }));
        file.on('error', (error) => { activeRequest = null; reject(error); });
      });
      req.setTimeout(25000, () => req.destroy(new Error('下载超时，可改用「导入本地压缩包」')));
      req.on('error', (error) => { activeRequest = null; reject(error); });
    };
    run(url, 0);
  });
}

function runProcess(bin, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    activeProcess = child;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('解压超时'));
    }, timeout || 10 * 60 * 1000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => { clearTimeout(timer); activeProcess = null; reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      activeProcess = null;
      if (code === 0) return resolve(out);
      reject(new Error(String(err || out || ('解压程序退出码 ' + code)).slice(0, 300)));
    });
  });
}

function psQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

async function extract(archive, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
  let firstError;
  try {
    await runProcess(tar, ['-xf', archive, '-C', dest]);
    return;
  } catch (error) { firstError = error; }
  if (process.platform === 'win32' && /\.zip$/i.test(archive)) {
    try {
      await runProcess('powershell.exe', ['-NoProfile', '-Command',
        'Expand-Archive -LiteralPath ' + psQuote(archive) + ' -DestinationPath ' + psQuote(dest) + ' -Force']);
      return;
    } catch (_) {}
  }
  const sevenZip = ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe']
    .map(fileExists).find(Boolean);
  if (sevenZip) {
    await runProcess(sevenZip, ['x', '-y', '-o' + dest, archive]);
    return;
  }
  throw new Error('解压失败：' + String(firstError && firstError.message || '未知错误') +
    '；建议安装 7-Zip 或改用 .zip 包');
}

function locate(staging) {
  const direct = path.join(staging, 'mingw64', 'bin');
  if (executables(direct).compiler) return direct;
  const queue = [{ dir: staging, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > 4) continue;
    if (executables(dir).compiler) return dir;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!/mingw|bin|tool|gcc|llvm|x86_64|ucrt/i.test(entry.name)) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return '';
}

function applyInstall(binDir) {
  const targetRoot = path.dirname(dirs.bin());
  const sourceRoot = path.dirname(binDir);
  fs.mkdirSync(dirs.root(), { recursive: true });
  if (path.resolve(sourceRoot) !== path.resolve(targetRoot)) {
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.renameSync(sourceRoot, targetRoot);
  }
  const found = executables(dirs.bin());
  const patch = { compiler: { path: found.compiler }, debugger: { path: found.debugger } };
  if (found.make) patch.make = { path: found.make };
  store.update(patch);
  versionCache = { file: '', value: '' };
  toolchain.invalidate();
  toolchain.detect(true);
  return found;
}

function fail(error) {
  const cancelled = task.cancelRequested;
  task.phase = cancelled ? 'cancelled' : 'error';
  task.error = cancelled ? '已取消' : String(error && error.message || error);
  task.finishedAt = Date.now();
  activeRequest = null;
  note(cancelled ? '安装已取消' : '安装失败：' + task.error, undefined, true);
}

async function run(options) {
  const opts = options || {};
  let archive = opts.archivePath ? path.resolve(String(opts.archivePath)) : '';
  if (archive) {
    if (!fileExists(archive)) throw new Error('找不到压缩包：' + archive);
    if (!/\.(zip|7z)$/i.test(archive)) throw new Error('仅支持 .zip 或 .7z 格式的编译器压缩包');
    task.source = archive;
    note('使用本地压缩包：' + path.basename(archive), 8);
  } else {
    let source;
    if (opts.url) {
      let parsed;
      try { parsed = new URL(String(opts.url)); }
      catch (_) { throw new Error('下载地址不是合法的 URL'); }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('下载地址必须使用 http/https');
      source = { url: parsed.toString(), name: path.basename(parsed.pathname) || 'compiler.zip' };
    } else {
      task.phase = 'preparing';
      note('正在查询最新 MinGW-w64 发行版…', 2);
      source = await latestAsset();
    }
    task.source = source.url;
    const name = path.basename(String(source.name)).replace(/[^a-zA-Z0-9._-]/g, '_');
    archive = path.join(dirs.downloads(), name);
    const cached = fileExists(archive);
    if (cached && fs.statSync(archive).size > 1024 * 1024) {
      note('复用已下载的压缩包：' + name, 8);
    } else {
      task.phase = 'downloading';
      note('正在下载 ' + name + '（约 100–300 MB，请保持网络畅通）…', 3);
      let lastLogged = -20;
      const bytes = await download(source.url, archive, (percent, received, total) => {
        const value = 5 + percent * 0.65;
        const message = '已下载 ' + formatBytes(received) + (total ? ' / ' + formatBytes(total) : '');
        if (percent - lastLogged >= 10) { note(message, value, true); lastLogged = percent; }
        else note(message, value, false);
      });
      note('下载完成（' + formatBytes(bytes) + '）', 70);
    }
  }
  if (task.cancelRequested) throw new Error('已取消');
  task.phase = 'extracting';
  note('正在解压编译器，约需 1–3 分钟…', 72);
  await extract(archive, dirs.staging());
  note('解压完成，正在定位 gcc / gdb…', 86);
  const binDir = locate(dirs.staging());
  if (!binDir) throw new Error('压缩包中未找到 gcc.exe，请确认是 MinGW-w64 / WinLibs 完整包');
  if (task.cancelRequested) throw new Error('已取消');
  task.phase = 'configuring';
  note('正在配置工具链…', 94);
  const installed = applyInstall(binDir);
  try { fs.rmSync(dirs.staging(), { recursive: true, force: true }); } catch (_) {}
  note('安装完成：' + installed.compiler, 100);
  task.phase = 'done';
  task.finishedAt = Date.now();
  return installed;
}

function install(options) {
  if (['preparing', 'downloading', 'extracting', 'configuring'].includes(task.phase)) return status();
  task = idle();
  task.startedAt = Date.now();
  note('准备安装内置编译器…', 1);
  run(options).catch(fail);
  return status();
}

function cancel() {
  if (!['preparing', 'downloading', 'extracting', 'configuring'].includes(task.phase)) return status();
  task.cancelRequested = true;
  note('正在取消安装…', undefined, true);
  if (activeRequest) { try { activeRequest.destroy(new Error('已取消')); } catch (_) {} }
  if (activeProcess) { try { activeProcess.kill(); } catch (_) {} }
  return status();
}

module.exports = { status, install, cancel, locate, executables, DOWNLOAD_PAGES };
