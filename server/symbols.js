'use strict';

const { tokenize, KEYWORDS } = require('./c-lexer');

const CONTROL = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'do', 'else',
  '_Generic', '_Static_assert', 'alignof', 'typeof']);

function symbols(src) {
  const { tokens } = tokenize(src);
  const code = tokens.filter((t) => t.type !== 'comment' && t.type !== 'preproc');
  const list = [];

  for (const t of tokens) {
    if (t.type !== 'preproc') continue;
    const define = /^\s*#\s*define\s+([A-Za-z_]\w*)/.exec(t.text);
    const include = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(t.text);
    if (define) list.push({ name: define[1], kind: 'macro', line: t.line, column: t.col, signature: t.text.trim().slice(0, 80) });
    else if (include) list.push({ name: include[1], kind: 'include', line: t.line, column: t.col, signature: '#include' });
  }

  let braceDepth = 0;
  let segmentStart = 0;
  for (let i = 0; i < code.length; i++) {
    const t = code[i];
    if (t.text === '{') braceDepth++;
    if (t.text === '}') braceDepth = Math.max(0, braceDepth - 1);

    if (['struct', 'union', 'enum'].includes(t.text) && code[i + 1] && code[i + 1].type === 'ident') {
      const after = code[i + 2];
      if (after && (after.text === '{' || after.text === ';')) {
        list.push({
          name: code[i + 1].text, kind: t.text === 'enum' ? 'enum' : 'struct',
          line: t.line, column: t.col,
          signature: `${t.text} ${code[i + 1].text}`
        });
      }
    }

    if (t.text === '(' && i > 0 && braceDepth === 0) {
      const nameTok = code[i - 1];
      if (nameTok.type === 'ident' && !CONTROL.has(nameTok.text) && !KEYWORDS.has(nameTok.text)) {
        let depth = 0, j = i;
        for (; j < code.length; j++) {
          if (code[j].text === '(') depth++;
          else if (code[j].text === ')') { depth--; if (depth === 0) { j++; break; } }
        }
        const after = code[j];
        if (after && (after.text === '{' || after.text === ';') && j > i + 1) {
          let k = i - 1;
          while (k >= 0 && ![';', '{', '}'].includes(code[k].text)) k--;
          const startTok = code[k + 1] || nameTok;
          const signature = src.slice(startTok.start, code[j - 1].end).replace(/\s+/g, ' ').trim();
          list.push({
            name: nameTok.text, kind: after.text === '{' ? 'function' : 'prototype',
            line: nameTok.line, column: nameTok.col,
            signature: signature.slice(0, 140)
          });
        }
      }
    }

    if (t.text === ';' && braceDepth === 0) {
      const segment = code.slice(segmentStart, i + 1);
      if (segment.length >= 2 && segment[0].text !== 'typedef' &&
          !segment.some((x) => x.text === '(') && !CONTROL.has(segment[0].text)) {
        let nameTok = null;
        for (let z = segment.length - 2; z >= 0; z--) {
          if (segment[z].type === 'ident' && !KEYWORDS.has(segment[z].text)) { nameTok = segment[z]; break; }
        }
        if (nameTok) list.push({
          name: nameTok.text, kind: 'variable', line: nameTok.line, column: nameTok.col,
          signature: segment.map((x) => x.text).join(' ').slice(0, 120)
        });
      }
      segmentStart = i + 1;
    }
  }
  return list.sort((a, b) => a.line - b.line || a.column - b.column);
}

function metrics(src) {
  const lines = src.split(/\r?\n/);
  let blank = 0, comment = 0, code = 0;
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlock) {
      comment++;
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (!trimmed) blank++;
    else if (trimmed.startsWith('//')) comment++;
    else if (trimmed.startsWith('/*')) {
      comment++;
      if (!trimmed.includes('*/')) inBlock = true;
    } else code++;
  }
  const todos = [];
  lines.forEach((line, index) => {
    const m = /\b(TODO|FIXME|HACK|NOTE)\b[:：]?\s*(.{0,80})/i.exec(line);
    if (m) todos.push({ line: index + 1, text: m[2].trim(), tag: m[1].toUpperCase() });
  });
  return {
    lines: lines.length, codeLines: code, commentLines: comment, blankLines: blank,
    bytes: Buffer.byteLength(src, 'utf8'), todos
  };
}

function outline(src) {
  const list = symbols(src);
  return {
    symbols: list,
    metrics: Object.assign(metrics(src), {
      functions: list.filter((s) => s.kind === 'function').length,
      structs: list.filter((s) => s.kind === 'struct' || s.kind === 'enum').length,
      macros: list.filter((s) => s.kind === 'macro').length
    })
  };
}

module.exports = { symbols, metrics, outline };
