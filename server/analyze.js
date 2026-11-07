'use strict';

const { tokenize, FULLWIDTH } = require('./c-lexer');

const CONTROL = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'do', 'else',
  '_Generic', '_Static_assert', 'alignof', 'typeof']);
const PAIR = { ')': '(', ']': '[', '}': '{' };
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);
const NON_ENDING = new Set([';', ',', ':', '{', '(', '[', '=', '+', '-', '*', '/', '%', '&',
  '|', '^', '?', '!', '~', '<', '>', '->', '::', '++', '--', '.', '&&', '||', '+=',
  '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '==', '!=', '<=', '>=']);
const NON_STARTING = new Set(['{', '}', ')', ']', ',', ';', '.', '->', '++', '--', '+', '-',
  '*', '/', '%', '=', '&', '|', '^', '?', ':', '<', '>', '!', '~', '==', '!=', '<=', '>=',
  '&&', '||', '+=', '-=', '*=', '/=', '<<', '>>']);
const RISKY = {
  gets: { severity: 'error', message: 'gets() 无法限制输入长度且已在 C11 中移除，请改用 fgets()', code: 'C030' },
  strcpy: { severity: 'warning', message: 'strcpy() 不检查目标缓冲区边界，建议使用 snprintf() 或 strncpy()', code: 'C031' },
  strcat: { severity: 'warning', message: 'strcat() 不检查目标缓冲区边界，建议使用 strncat()', code: 'C032' },
  sprintf: { severity: 'warning', message: 'sprintf() 存在溢出风险，建议使用 snprintf()', code: 'C033' }
};
const FORMAT_FUNCS = { printf: 1, fprintf: 2, sprintf: 2, snprintf: 3, scanf: 1, fscanf: 2, sscanf: 2 };

function diag(list, severity, token, message, code) {
  list.push({
    severity, line: token.line, column: token.col,
    endColumn: token.col + Math.max(1, token.text.length),
    message, code, source: '静态分析'
  });
}

function countConversions(literal) {
  const body = literal.slice(1, -1);
  let count = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '%') continue;
    if (body[i + 1] === '%') { i++; continue; }
    let j = i + 1;
    while (j < body.length && /[-+ #0']/.test(body[j])) j++;
    if (body[j] === '*') { j++; while (/[0-9]/.test(body[j])) j++; }
    else while (/[0-9]/.test(body[j])) j++;
    if (body[j] === '.') {
      j++;
      if (body[j] === '*') j++;
      else while (/[0-9]/.test(body[j])) j++;
    }
    while (j < body.length && /[hlLjztqI]/.test(body[j])) j++;
    const conv = body[j];
    if (!conv || !/[diouxXeEfgGaAcspn%]/.test(conv)) continue;
    if (conv !== 'm') count++;
    i = j;
  }
  return count;
}

function splitArgs(tokens, openIndex, closeIndex) {
  const args = [];
  let start = openIndex + 1, depth = 0;
  for (let i = openIndex + 1; i <= closeIndex; i++) {
    if (i === closeIndex) { if (start < i) args.push(tokens.slice(start, i)); break; }
    const text = tokens[i].text;
    if (OPENERS.has(text)) depth++;
    else if (CLOSERS.has(text)) depth--;
    else if (text === ',' && depth === 0) { args.push(tokens.slice(start, i)); start = i + 1; }
  }
  return args;
}

function matchClose(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i].text === '(') depth++;
    else if (tokens[i].text === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function checkBrackets(tokens, out) {
  const stack = [];
  for (const t of tokens) {
    if (t.type !== 'punct' && t.type !== 'op') continue;
    if (OPENERS.has(t.text)) stack.push(t);
    else if (CLOSERS.has(t.text)) {
      const top = stack.pop();
      if (!top || top.text !== PAIR[t.text]) {
        diag(out, 'error', t, `不匹配的 '${t.text}'，期望与 '${PAIR[t.text]}' 配对`, 'C010');
        if (top) stack.push(top);
      }
    }
  }
  for (const t of stack.slice(0, 5)) {
    diag(out, 'warning', t, `'${t.text}' 缺少配对的 '${t.text === '(' ? ')' : t.text === '[' ? ']' : '}'}'`, 'C011');
  }
}

function checkFullwidth(tokens, out) {
  for (const t of tokens) {
    if (t.type === 'comment' || t.type === 'string' || t.type === 'char') continue;
    if (FULLWIDTH.test(t.text)) {
      diag(out, 'error', t, `检测到全角标点 "${t.text.trim()}"，C 源码中需使用半角符号`, 'C020');
    }
  }
}

function checkRisky(tokens, out) {
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || tokens[i + 1].text !== '(') continue;
    const rule = RISKY[t.text];
    if (rule) diag(out, rule.severity, t, rule.message, rule.code);
    if (t.text === 'scanf' || t.text === 'wscanf') {
      diag(out, 'warning', t, 'scanf() 读取字符串时应指定宽度（如 %31s）或改用 fgets()', 'C034');
    }
  }
}

function checkConditionAssign(tokens, out) {
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || (t.text !== 'if' && t.text !== 'while')) continue;
    if (tokens[i + 1].text !== '(') continue;
    const end = matchClose(tokens, i + 1);
    if (end < 0) continue;
    for (let j = i + 2; j < end; j++) {
      if (tokens[j].type === 'op' && tokens[j].text === '=') {
        diag(out, 'warning', tokens[j], '条件表达式中使用赋值 "="，是否应为比较 "==" ?', 'C040');
        break;
      }
    }
    i = end;
  }
}

function checkFormat(tokens, out) {
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !(t.text in FORMAT_FUNCS) || tokens[i + 1].text !== '(') continue;
    const end = matchClose(tokens, i + 1);
    if (end < 0) continue;
    const args = splitArgs(tokens, i + 1, end);
    const at = FORMAT_FUNCS[t.text];
    const fmt = args[at - 1];
    if (!fmt || fmt.length !== 1 || fmt[0].type !== 'string') continue;
    const expected = countConversions(fmt[0].text);
    const actual = Math.max(0, args.length - at);
    if (actual !== expected) {
      diag(out, 'warning', fmt[0],
        `格式串包含 ${expected} 个转换说明符，但提供了 ${actual} 个参数`, 'C050');
    }
    i = end;
  }
}

function checkSemicolon(tokens, out) {
  const lastByLine = new Map();
  const firstByLine = new Map();
  for (const t of tokens) {
    if (!lastByLine.has(t.line)) firstByLine.set(t.line, t);
    lastByLine.set(t.line, t);
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (next.line <= t.line || lastByLine.get(t.line) !== t) continue;
    const suspicious = (t.type === 'ident' || t.type === 'number' ||
      t.type === 'string' || t.type === 'char' || t.text === ')' ||
      t.text === ']' || t.text === '}' || t.text === '++' || t.text === '--');
    if (!suspicious || NON_ENDING.has(t.text) || NON_STARTING.has(next.text)) continue;
    if (CONTROL.has(t.text) || CONTROL.has(next.text)) continue;
    const first = firstByLine.get(t.line);
    const lineIsControl = first && (first.text === 'if' || first.text === 'for' ||
      first.text === 'while' || first.text === 'switch' || first.text === 'else') && t.text === ')';
    if (lineIsControl) continue;
    if (next.text === '{' || next.text === '}') continue;
    if (t.text === '}' && first && first.text === '}') continue;
    if (first && ['typedef', 'struct', 'union', 'enum', 'case', 'default', 'do', 'goto', 'break', 'continue'].includes(first.text)) continue;
    if (t.text === '}' && next.text === 'while') continue;
    diag(out, 'warning', t, '此行末尾可能缺少分号 ";"', 'C060');
  }
}

function checkMain(tokens, out) {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].text === 'void' && tokens[i + 1].text === 'main') {
      diag(out, 'warning', tokens[i], 'C 标准规定 main 应返回 int（"int main(void)"）', 'C070');
    }
  }
}

function sortDiagnostics(list) {
  const weight = { error: 0, warning: 1, info: 2, hint: 3 };
  const seen = new Set();
  return list
    .filter((d) => {
      const key = [d.line, d.column, d.code, d.message].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line || a.column - b.column ||
      (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9));
}

function analyze(src, filename) {
  const source = typeof src === 'string' ? src : '';
  const lexed = tokenize(source);
  const code = lexed.tokens.filter((t) => t.type !== 'comment' && t.type !== 'preproc');
  const out = lexed.diagnostics.map((d) => Object.assign({
    endColumn: d.column + 1, source: '静态分析', file: filename || ''
  }, d));
  checkBrackets(code, out);
  checkFullwidth(lexed.tokens, out);
  checkRisky(code, out);
  checkConditionAssign(code, out);
  checkFormat(code, out);
  checkSemicolon(code, out);
  checkMain(code, out);
  return { diagnostics: sortDiagnostics(out), tokens: lexed.tokens.length };
}

module.exports = { analyze, countConversions, checkBrackets, sortDiagnostics };
