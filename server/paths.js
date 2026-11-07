'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');

const DEFAULT_WORKSPACE = path.join(store.IDE_ROOT, 'workspace');
let ROOT = path.resolve(DEFAULT_WORKSPACE);

function root() {
  return ROOT;
}

function setRoot(next) {
  if (!next || typeof next !== 'string') throw new Error('目录路径无效');
  const abs = path.resolve(next);
  fs.mkdirSync(abs, { recursive: true });
  if (!fs.statSync(abs).isDirectory()) throw new Error('目标不是文件夹');
  ROOT = abs;
  store.update({ lastRoot: ROOT });
  return ROOT;
}

function initRoot(cliRoot) {
  const saved = store.read().lastRoot;
  const target = cliRoot || process.env.CODECPP_ROOT || saved || DEFAULT_WORKSPACE;
  try {
    ROOT = path.resolve(target);
    fs.mkdirSync(ROOT, { recursive: true });
  } catch (_) {
    ROOT = DEFAULT_WORKSPACE;
    fs.mkdirSync(ROOT, { recursive: true });
  }
  return ROOT;
}

function inside(candidate, base) {
  const rel = path.relative(base, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function resolveSafe(input) {
  const value = typeof input === 'string' && input.trim() ? input : '.';
  const abs = path.resolve(path.isAbsolute(value) ? value : path.join(ROOT, value));
  if (!inside(abs, ROOT)) {
    const err = new Error('路径越出工作区范围：' + value);
    err.code = 'EPERM';
    throw err;
  }
  return abs;
}

function relative(abs) {
  const rel = path.relative(ROOT, abs);
  return rel.split(path.sep).join('/') || '.';
}

function toWeb(abs) {
  return relative(abs);
}

const BINARY_EXT = new Set([
  '.exe', '.dll', '.so', '.dylib', '.o', '.obj', '.a', '.lib', '.pdb',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.7z', '.rar', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.class', '.pyc'
]);

function languageOf(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
    '.hpp': 'cpp', '.hh': 'cpp', '.m': 'c', '.s': 'asm', '.asm': 'asm',
    '.md': 'markdown', '.txt': 'plaintext', '.json': 'json', '.js': 'javascript',
    '.css': 'css', '.html': 'html', '.xml': 'xml', '.yml': 'yaml', '.yaml': 'yaml',
    '.cmake': 'cmake', '.sh': 'shell', '.bat': 'batch', '.ps1': 'powershell',
    '.py': 'python', '.lua': 'lua', '.mk': 'makefile'
  };
  if (ext === '' && /(^|\/|\\)(Makefile|makefile|CMakeLists\.txt)$/.test(file)) return 'makefile';
  return map[ext] || 'plaintext';
}

function isTextFile(abs) {
  if (BINARY_EXT.has(path.extname(abs).toLowerCase())) return false;
  try {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function listDir(rel) {
  const abs = resolveSafe(rel);
  if (!fs.existsSync(abs)) {
    const err = new Error('目录不存在');
    err.code = 'ENOENT';
    throw err;
  }
  if (!fs.statSync(abs).isDirectory()) throw new Error('目标不是文件夹');
  const entries = fs.readdirSync(abs, { withFileTypes: true }).map((entry) => {
    const full = path.join(abs, entry.name);
    const isDir = entry.isDirectory();
    let size = 0;
    try { if (!isDir) size = fs.statSync(full).size; } catch (_) {}
    return {
      name: entry.name,
      path: relative(full),
      isDir,
      size,
      hidden: entry.name.startsWith('.'),
      language: isDir ? '' : languageOf(entry.name)
    };
  });
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.isDir ? -1 : 1));
  return { path: relative(abs), entries };
}

function walk(abs, out, options, depth) {
  if (depth > (options.maxDepth || 8) || out.length >= (options.maxFiles || 2000)) return;
  let items;
  try { items = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { return; }
  for (const item of items) {
    if (out.length >= (options.maxFiles || 2000)) return;
    const full = path.join(abs, item.name);
    if (options.exclude && options.exclude.test(item.name)) continue;
    if (item.isDirectory()) walk(full, out, options, depth + 1);
    else if (item.isFile()) out.push(full);
  }
}

module.exports = {
  DEFAULT_WORKSPACE, root, setRoot, initRoot, resolveSafe, relative, toWeb,
  inside, listDir, languageOf, isTextFile, walk, BINARY_EXT
};
