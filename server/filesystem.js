'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const MAX_TEXT = 4 * 1024 * 1024;

function fail(message, code) {
  const err = new Error(message);
  err.code = code || 'EIO';
  throw err;
}

function stat(rel) {
  const abs = paths.resolveSafe(rel);
  if (!fs.existsSync(abs)) fail('文件不存在：' + rel, 'ENOENT');
  const info = fs.statSync(abs);
  return {
    path: paths.relative(abs), name: path.basename(abs), isDir: info.isDirectory(),
    size: info.size, mtime: info.mtimeMs, language: info.isDirectory() ? '' : paths.languageOf(abs)
  };
}

function readFile(rel) {
  const abs = paths.resolveSafe(rel);
  if (!fs.existsSync(abs)) fail('文件不存在：' + rel, 'ENOENT');
  if (fs.statSync(abs).isDirectory()) fail('不能打开文件夹作为文本', 'EISDIR');
  if (!paths.isTextFile(abs)) fail('二进制文件无法在编辑器中打开', 'EBINARY');
  const buf = fs.readFileSync(abs);
  if (buf.length > MAX_TEXT) fail('文件过大（超过 4 MB）', 'EFBIG');
  let content = buf.toString('utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  return {
    path: paths.relative(abs), content, language: paths.languageOf(abs),
    size: buf.length, mtime: fs.statSync(abs).mtimeMs,
    eol: content.includes('\r\n') ? 'CRLF' : 'LF'
  };
}

function writeFile(rel, content) {
  const abs = paths.resolveSafe(rel);
  if (typeof content !== 'string') fail('写入内容必须是文本');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return stat(rel);
}

function newFile(rel, content) {
  const abs = paths.resolveSafe(rel);
  if (fs.existsSync(abs)) fail('同名文件已存在：' + rel, 'EEXIST');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : '', 'utf8');
  return stat(rel);
}

function newFolder(rel) {
  const abs = paths.resolveSafe(rel);
  if (fs.existsSync(abs)) fail('同名文件夹已存在：' + rel, 'EEXIST');
  fs.mkdirSync(abs, { recursive: true });
  return stat(rel);
}

function rename(rel, newName) {
  const abs = paths.resolveSafe(rel);
  if (!fs.existsSync(abs)) fail('源文件不存在', 'ENOENT');
  if (!newName || /[\\/:*?"<>|]/.test(newName)) fail('名称包含非法字符', 'EINVAL');
  const dest = paths.resolveSafe(path.join(path.dirname(abs), newName));
  if (fs.existsSync(dest)) fail('目标名称已存在', 'EEXIST');
  fs.renameSync(abs, dest);
  return stat(paths.relative(dest));
}

function move(rel, targetDir) {
  const abs = paths.resolveSafe(rel);
  const dest = paths.resolveSafe(path.join(targetDir || '.', path.basename(abs)));
  if (fs.existsSync(dest)) fail('目标位置已存在同名文件', 'EEXIST');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
  return stat(paths.relative(dest));
}

function remove(rel) {
  const abs = paths.resolveSafe(rel);
  if (abs === paths.root()) fail('不能删除工作区根目录', 'EPERM');
  if (!fs.existsSync(abs)) fail('文件不存在', 'ENOENT');
  const info = fs.statSync(abs);
  if (info.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
  else fs.unlinkSync(abs);
  return { removed: paths.relative(abs) };
}

function search(query, options) {
  const opts = options || {};
  if (!query) return { matches: [], truncated: false };
  const flags = opts.caseSensitive ? '' : 'i';
  let re;
  try {
    re = opts.regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch (err) {
    fail('正则表达式无效：' + err.message, 'EINVAL');
  }
  const include = opts.include ? new RegExp(opts.include) : null;
  const files = [];
  paths.walk(paths.root(), files, {
    exclude: /^(\.git|node_modules|build|dist|\.codecpp|\.vscode)$/,
    maxDepth: 8, maxFiles: 1500
  });
  const matches = [];
  let truncated = false;
  const max = Math.min(500, Number(opts.maxResults) || 300);
  for (const abs of files) {
    if (!paths.isTextFile(abs)) continue;
    if (include && !include.test(paths.relative(abs))) continue;
    let lines;
    try { lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/); } catch (_) { continue; }
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      matches.push({
        file: paths.relative(abs), line: i + 1, column: m.index + 1,
        text: lines[i].trim().slice(0, 220), preview: lines[i].slice(0, 220)
      });
      if (matches.length >= max) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { matches, truncated, filesScanned: files.length, query };
}

module.exports = { stat, readFile, writeFile, newFile, newFolder, rename, move, remove, search, MAX_TEXT };
