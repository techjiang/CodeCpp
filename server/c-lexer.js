'use strict';

const KEYWORDS = new Set([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
  'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long',
  'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct',
  'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', '_Bool',
  '_Alignas', '_Alignof', '_Atomic', '_Generic', '_Noreturn', '_Static_assert',
  '_Thread_local', 'bool', 'true', 'false', 'NULL', 'alignas', 'alignof', 'typeof'
]);

const TYPES = new Set([
  'int', 'char', 'short', 'long', 'float', 'double', 'void', 'signed', 'unsigned',
  'size_t', 'ssize_t', 'FILE', 'time_t', 'uint8_t', 'uint16_t', 'uint32_t',
  'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'bool', '_Bool',
  'struct', 'union', 'enum', 'const', 'static', 'extern', 'volatile', 'register',
  'inline', 'restrict', 'typedef', 'wchar_t', 'ptrdiff_t', 'va_list'
]);

const FULLWIDTH = /[，；：（）【】“”‘’。！？、]/;
const MULTI_OPS = [
  '>>=', '<<=', '...', '->*', '++', '--', '->', '<<', '>>', '<=', '>=', '==', '!=',
  '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##'
];

function tokenize(src) {
  const tokens = [];
  const diagnostics = [];
  const mask = new Uint8Array(src.length);
  let i = 0, line = 1, col = 1;
  const n = src.length;
  const newline = () => { line++; col = 1; };
  const add = (type, start, end, l, c) => {
    tokens.push({ type, text: src.slice(start, end), start, end, line: l, col: c });
    if (type !== 'comment') for (let k = start; k < end; k++) mask[k] = 1;
  };

  while (i < n) {
    const ch = src[i];
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { i++; newline(); continue; }
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') { i++; col++; continue; }

    const start = i, startLine = line, startCol = col;
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      add('comment', start, i, startLine, startCol);
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2; col += 2;
      let closed = false;
      while (i < n) {
        if (src[i] === '*' && src[i + 1] === '/') { i += 2; col += 2; closed = true; break; }
        if (src[i] === '\n') { i++; newline(); } else { i++; col++; }
      }
      if (!closed) diagnostics.push({ severity: 'error', line: startLine, column: startCol, message: '块注释未闭合（缺少 */）', code: 'C001' });
      add('comment', start, i, startLine, startCol);
      continue;
    }
    if (ch === '#') {
      i++; col++;
      while (i < n) {
        if (src[i] === '\\' && (src[i + 1] === '\n' || src[i + 1] === '\r')) {
          i += 2; newline(); continue;
        }
        if (src[i] === '\n') break;
        i++; col++;
      }
      add('preproc', start, i, startLine, startCol);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++; col++;
      let closed = false;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2; col += 2; continue;
        }
        if (src[i] === quote) { i++; col++; closed = true; break; }
        if (src[i] === '\n') break;
        i++; col++;
      }
      if (!closed) diagnostics.push({
        severity: 'error', line: startLine, column: startCol,
        message: quote === '"' ? '字符串字面量未闭合（缺少 "）' : '字符常量未闭合（缺少 \'）', code: 'C002'
      });
      add(quote === '"' ? 'string' : 'char', start, i, startLine, startCol);
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      i++;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
      col += i - start;
      add('ident', start, i, startLine, startCol);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      i++;
      while (i < n && /[0-9a-fA-FxXbBoOuUlL._+-]/.test(src[i])) {
        if ((src[i] === '+' || src[i] === '-') && !/[eEpP]/.test(src[i - 1])) break;
        i++;
      }
      col += i - start;
      add('number', start, i, startLine, startCol);
      continue;
    }
    const op = MULTI_OPS.find((o) => src.startsWith(o, i));
    if (op) { i += op.length; col += op.length; add('op', start, i, startLine, startCol); continue; }
    i++; col++;
    add(/[()[\]{};,.:?]/.test(ch) ? 'punct' : 'op', start, i, startLine, startCol);
  }
  return { tokens, diagnostics, mask };
}

function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

function stripCode(line) {
  let out = '', quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') break;
    out += ch;
  }
  return out;
}

function format(src, options) {
  const opts = options || {};
  const tabSize = Math.max(1, Math.min(8, Number(opts.tabSize) || 4));
  const unit = opts.insertSpaces === false ? '\t' : ' '.repeat(tabSize);
  const lines = src.split(/\r?\n/);
  const result = [];
  let depth = 0;
  let inBlockComment = false;
  let continuation = false;

  for (let raw of lines) {
    const trimmed = raw.trim();
    if (continuation) {
      result.push(raw.replace(/^\s*/, unit.repeat(Math.max(0, depth))));
      continuation = /\\\s*$/.test(raw);
      continue;
    }
    if (inBlockComment) {
      result.push(raw.replace(/^\s*/, unit.repeat(Math.max(0, depth + 1))));
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed === '') { result.push(''); continue; }
    if (trimmed.startsWith('#')) {
      result.push(trimmed);
      continuation = /\\\s*$/.test(trimmed);
      continue;
    }
    const code = stripCode(trimmed);
    const opens = (code.match(/[{([]/g) || []).length;
    const closes = (code.match(/[}\])]/g) || []).length;
    const leadingClose = /^[}\])]/.test(trimmed) ? 1 : 0;
    const isCase = /^(case\b|default\s*:)/.test(trimmed);
    let indent = Math.max(0, depth - leadingClose - (isCase ? 1 : 0));
    result.push(unit.repeat(indent) + trimmed);
    depth = Math.max(0, depth + opens - closes);
    if ((trimmed.match(/\/\*/g) || []).length > (trimmed.match(/\*\//g) || []).length) inBlockComment = true;
  }
  return result.join('\n');
}

module.exports = { tokenize, format, lineOf, stripCode, KEYWORDS, TYPES, FULLWIDTH };
