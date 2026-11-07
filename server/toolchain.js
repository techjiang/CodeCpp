'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');
const toolchainDirs = require('./toolchain-dir');

const WIN = process.platform === 'win32';
let dirsCache = null;
let detectCache = null, detectCacheAt = 0;
const CACHE_MS = 15000;

function exec(bin, args, timeout) {
  try {
    const r = spawnSync(bin, args || [], {
      encoding: 'utf8', timeout: timeout || 3000, windowsHide: true,
      maxBuffer: 1024 * 1024, env: process.env
    });
    if (r.error || (r.status !== 0 && !r.stdout && !r.stderr)) return null;
    return ((r.stdout || '') + (r.stderr || '')).trim();
  } catch (_) {
    return null;
  }
}

function firstVersion(text) {
  if (!text) return '';
  const line = String(text).split(/\r?\n/).find((l) => l.trim()) || '';
  return line.trim().slice(0, 120);
}

function which(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir.replace(/^"|"$/g, ''), name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

function exists(file) {
  try { return fs.statSync(file).isFile() ? file : null; } catch (_) { return null; }
}

function knownDirs() {
  if (dirsCache) return dirsCache;
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  const parents = [
    toolchainDirs.bin(),
    'C:/msys64/mingw64/bin', 'C:/msys64/ucrt64/bin', 'C:/msys64/clang64/bin',
    'C:/msys64/usr/bin', 'C:/mingw64/bin', 'C:/MinGW/bin', 'C:/TDM-GCC-64/bin',
    'C:/Program Files/LLVM/bin', 'C:/Program Files (x86)/LLVM/bin',
    'C:/Program Files/Git/usr/bin', 'C:/ProgramData/chocolatey/bin',
    'C:/tools/mingw64/bin', 'D:/mingw64/bin', 'D:/msys64/mingw64/bin',
    'C:/Program Files (x86)/Dev-Cpp/MinGW64/bin',
    process.env.MINGW_HOME ? path.join(process.env.MINGW_HOME, 'bin') : '',
    process.env.MSYS2_HOME ? path.join(process.env.MSYS2_HOME, 'mingw64', 'bin') : ''
  ];
  parents.forEach(add);
  const scanParents = [
    'C:/Program Files/mingw-w64', 'C:/Program Files (x86)/mingw-w64',
    'C:/Qt/Tools', 'C:/Program Files', 'C:/', 'D:/', 'D:/XM/tools'
  ];
  for (const parent of scanParents) {
    try {
      for (const item of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!item.isDirectory() || !/mingw|msys|llvm|clang|tdm|gcc/i.test(item.name)) continue;
        add(path.join(parent, item.name, 'bin'));
        if (/msys/i.test(item.name)) {
          add(path.join(parent, item.name, 'mingw64', 'bin'));
          add(path.join(parent, item.name, 'ucrt64', 'bin'));
          add(path.join(parent, item.name, 'usr', 'bin'));
        }
      }
    } catch (_) {}
  }
  dirsCache = dirs;
  return dirs;
}

function probe(file, args) {
  if (!file) return null;
  const version = exec(file, args || ['--version']);
  if (version === null) return null;
  return { path: file, version: firstVersion(version) };
}

function detect(force) {
  if (!force && detectCache && Date.now() - detectCacheAt < CACHE_MS) return detectCache;
  const compilers = [];
  const debuggers = [];
  const tools = {};
  const seen = new Set();
  const push = (arr, item, kind) => {
    if (!item || seen.has(kind + ':' + item.path.toLowerCase())) return;
    seen.add(kind + ':' + item.path.toLowerCase());
    arr.push(Object.assign({ kind }, item));
  };
  const names = WIN ? ['gcc.exe', 'clang.exe', 'cc.exe'] : ['gcc', 'clang', 'cc'];
  const dbgNames = WIN ? ['gdb.exe'] : ['gdb', 'lldb-mi'];
  const toolNames = { make: WIN ? 'make.exe' : 'make', cmake: WIN ? 'cmake.exe' : 'cmake' };

  for (const name of names) {
    const found = which(name);
    if (found) push(compilers, probe(found), name.includes('clang') ? 'clang' : 'gcc');
  }
  for (const name of dbgNames) {
    const found = which(name);
    if (found) push(debuggers, probe(found), name.includes('gdb') ? 'gdb' : 'lldb-mi');
  }
  for (const [key, name] of Object.entries(toolNames)) {
    const found = which(name);
    if (found) tools[key] = probe(found) || null;
  }
  for (const dir of knownDirs()) {
    for (const name of names) {
      const file = exists(path.join(dir, name));
      if (file) push(compilers, probe(file), name.includes('clang') ? 'clang' : 'gcc');
    }
    for (const name of dbgNames) {
      const file = exists(path.join(dir, name));
      if (file) push(debuggers, probe(file), name.includes('gdb') ? 'gdb' : 'lldb-mi');
    }
    for (const [key, name] of Object.entries(toolNames)) {
      if (tools[key]) continue;
      const file = exists(path.join(dir, name));
      if (file) tools[key] = probe(file) || null;
    }
  }

  const settings = store.read();
  const profile = resolveProfile();
  const chosenCompiler = (profile && profile.compiler) || settings.compiler.path || (compilers[0] ? compilers[0].path : '');
  const gdb = debuggers.find((d) => d.kind === 'gdb');
  const result = {
    platform: process.platform,
    checkedAt: new Date().toISOString(),
    compilers, debuggers, tools,
    profile: profile ? { id: profile.id, name: profile.name } : null,
    selected: {
      compiler: chosenCompiler,
      debugger: (profile && profile.debugger) || settings.debugger.path || (gdb ? gdb.path : ''),
      make: (profile && profile.make) || settings.make.path || (tools.make ? tools.make.path : ''),
      cmake: (profile && profile.cmake) || settings.cmake.path || (tools.cmake ? tools.cmake.path : '')
    },
    ready: Boolean(chosenCompiler),
    hint: chosenCompiler ? '' : '未检测到 C 编译器。推荐在「设置 → 编译器」点击「一键安装」，自动下载并配置 MinGW-w64（gcc + gdb + make）。'
  };
  detectCache = result;
  detectCacheAt = Date.now();
  return result;
}

function invalidate() {
  dirsCache = null;
  detectCache = null;
  detectCacheAt = 0;
}

function config() {
  const s = store.read();
  const d = detect();
  const compiler = d.selected.compiler;
  return {
    compiler,
    compilerKind: /clang/i.test(path.basename(compiler || '')) ? 'clang' : 'gcc',
    debugger: d.selected.debugger,
    make: d.selected.make,
    cmake: d.selected.cmake,
    flags: s.compiler.flags,
    standard: s.compiler.standard,
    linkerFlags: s.compiler.linkerFlags,
    ready: Boolean(compiler),
    profile: d.profile,
    pathDirs: pathDirs(),
    detected: d
  };
}

/* 编译器集：Dev-C++ 式的「一套环境 = gcc + gdb + make + 附加目录」 */
function resolveProfile() {
  const s = store.read();
  if (!s.activeToolchain) return null;
  const list = Array.isArray(s.toolchains) ? s.toolchains : [];
  return list.find((p) => p && p.id === s.activeToolchain) || null;
}

function labelFor(dir) {
  const low = String(dir || '').replace(/\\/g, '/').toLowerCase();
  if (low.includes('codecpp')) return 'CodeCpp 内置 MinGW-w64';
  if (low.includes('dev-cpp')) return 'Dev-C++ MinGW64';
  if (low.includes('ucrt64')) return 'MSYS2 UCRT64';
  if (low.includes('clang64')) return 'MSYS2 CLANG64';
  if (low.includes('mingw64') && low.includes('msys')) return 'MSYS2 MINGW64';
  if (low.includes('tdm')) return 'TDM-GCC';
  if (low.includes('llvm')) return 'LLVM / Clang';
  if (low.includes('mingw')) return 'MinGW-w64';
  const parts = low.split('/').filter(Boolean);
  return parts[parts.length - 2] || '检测到的工具链';
}

function profiles() {
  const s = store.read();
  const d = detect();
  const byDir = new Map();
  const groupFor = (file) => {
    const dir = path.dirname(file);
    const key = dir.toLowerCase();
    if (!byDir.has(key)) byDir.set(key, {
      id: 'auto:' + key, name: labelFor(dir), compiler: '', debugger: '',
      make: '', cmake: '', binDirs: [dir], auto: true
    });
    return byDir.get(key);
  };
  d.compilers.forEach((c) => { const g = groupFor(c.path); if (!g.compiler) g.compiler = c.path; });
  d.debuggers.forEach((g) => { const x = groupFor(g.path); if (!x.debugger) x.debugger = g.path; });
  if (d.tools.make) groupFor(d.tools.make.path).make = d.tools.make.path;
  if (d.tools.cmake) groupFor(d.tools.cmake.path).cmake = d.tools.cmake.path;
  const autos = Array.from(byDir.values()).filter((g) => g.compiler || g.debugger);
  const saved = (Array.isArray(s.toolchains) ? s.toolchains : []).map((p) =>
    Object.assign({ binDirs: [] }, p, { saved: true }));
  return { activeId: s.activeToolchain || '', profiles: saved.concat(autos) };
}

function pathDirs() {
  const s = store.read();
  const dirs = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (text && !dirs.some((x) => x.toLowerCase() === text.toLowerCase())) dirs.push(text);
  };
  const p = resolveProfile();
  if (p && Array.isArray(p.binDirs)) p.binDirs.forEach(add);
  if (Array.isArray(s.envPath)) s.envPath.forEach(add);
  const d = detect();
  ['compiler', 'debugger', 'make', 'cmake'].forEach((key) => {
    const file = d.selected[key];
    if (file) add(path.dirname(file));
  });
  return dirs;
}

function childEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  const dirs = pathDirs();
  if (dirs.length) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    env[key] = dirs.join(path.delimiter) + path.delimiter + String(env[key] || '');
  }
  return env;
}

const GUIDE = [
  '方式零 · 一键安装（推荐，开箱即用）',
  '  在欢迎页或「设置 → 编译器」点击「一键安装编译器」',
  '  CodeCpp 自动下载 MinGW-w64 压缩包、解压并配置 gcc / gdb / make，无需修改 PATH',
  '  网络不可用时，先手动下载 .zip / .7z，再用「导入本地压缩包」安装',
  '',
  '方式一 · MSYS2（含 gcc + gdb + make）',
  '  1. 安装 MSYS2：https://www.msys2.org/',
  '  2. 在「MSYS2 UCRT64」终端执行：pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-gdb mingw-w64-ucrt-x86_64-make',
  '  3. 把 C:\\msys64\\ucrt64\\bin 加入系统 PATH，或在 CodeCpp 设置中直接填写 gcc.exe / gdb.exe 的完整路径',
  '',
  '方式二 · WinLibs（免安装，解压即用）',
  '  1. 下载：https://winlibs.com/ （GCC + MinGW-w64 独立包）',
  '  2. 解压后在 CodeCpp「设置 → 工具链」中填写 <解压目录>\\bin\\gcc.exe',
  '',
  '方式三 · LLVM/Clang',
  '  1. 安装 LLVM 后在设置中填写 clang.exe 完整路径',
  '  2. 调试仍需 gdb（MinGW-w64 自带），lldb 需另行适配',
  '',
  '配置完成后点击「重新检测」，状态栏会显示当前编译器。'
].join('\n');

module.exports = { detect, config, probe, GUIDE, WIN, exec, invalidate, profiles, pathDirs, childEnv, resolveProfile };
