/* CodeCpp · C 语法高亮与文档词法信息 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;

  const KEYWORDS = new Set(['auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else',
    'enum', 'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict', 'return', 'sizeof',
    'static', 'struct', 'switch', 'typedef', 'union', 'volatile', 'while', '_Alignas', '_Alignof',
    '_Atomic', '_Generic', '_Noreturn', '_Static_assert', '_Thread_local', 'alignas', 'alignof', 'typeof']);
  const TYPES = new Set(['int', 'char', 'short', 'long', 'float', 'double', 'void', 'signed',
    'unsigned', 'bool', '_Bool', 'size_t', 'ssize_t', 'FILE', 'time_t', 'wchar_t', 'ptrdiff_t',
    'va_list', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t',
    'int64_t', 'intptr_t', 'uintptr_t']);
  const CONSTS = new Set(['NULL', 'true', 'false', 'EOF', 'EXIT_SUCCESS', 'EXIT_FAILURE', 'stdin',
    'stdout', 'stderr', 'BUFSIZ', 'RAND_MAX', 'M_PI']);
  const LIBS = new Set(['printf', 'fprintf', 'sprintf', 'snprintf', 'scanf', 'fscanf', 'sscanf',
    'puts', 'fputs', 'putchar', 'getchar', 'fgets', 'fgetc', 'fread', 'fwrite', 'fopen', 'fclose',
    'malloc', 'calloc', 'realloc', 'free', 'memcpy', 'memset', 'memmove', 'memcmp', 'strlen',
    'strcpy', 'strncpy', 'strcmp', 'strncmp', 'strcat', 'strchr', 'strstr', 'atoi', 'atof',
    'strtol', 'strtod', 'qsort', 'bsearch', 'abs', 'labs', 'rand', 'srand', 'time', 'clock',
    'exit', 'abort', 'assert', 'ceil', 'floor', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'fabs',
    'isalpha', 'isdigit', 'isspace', 'toupper', 'tolower', 'perror', 'strerror', 'setvbuf']);
  const MACRO_HINT = /^[A-Z][A-Z0-9_]{2,}$/;

  const span = (cls, text) => '<span class="' + cls + '">' + esc(text) + '</span>';

  function highlightLine(line, inBlock) {
    let html = '', i = 0, block = false;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return { html: span('tok-comment', line), block: true };
      html += span('tok-comment', line.slice(0, end + 2));
      i = end + 2;
    }
    if (/^\s*#/.test(line) && i === 0) {
      const text = esc(line);
      const withString = text.replace(/(&lt;[^&]+&gt;|&quot;[^&]+&quot;)/g, '<span class="tok-str">$1</span>');
      return { html: '<span class="tok-pre">' + withString + '</span>', block: false };
    }
    while (i < line.length) {
      const rest = line.slice(i);
      const ch = rest[0];
      if (ch === '/' && rest[1] === '/') { html += span('tok-comment', rest); break; }
      if (ch === '/' && rest[1] === '*') {
        const end = rest.indexOf('*/', 2);
        if (end < 0) { html += span('tok-comment', rest); block = true; break; }
        html += span('tok-comment', rest.slice(0, end + 2)); i += end + 2; continue;
      }
      if (ch === '"' || ch === "'") {
        const re = ch === '"' ? /^"(?:\\.|[^"\\])*"?/ : /^'(?:\\.|[^'\\])*'?/;
        const m = re.exec(rest);
        if (m) { html += span('tok-str', m[0]); i += m[0].length; continue; }
      }
      const num = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eEpP][+-]?\d+)?)[uUlLfF]*/.exec(rest);
      if (num && /[0-9]/.test(ch)) { html += span('tok-num', num[0]); i += num[0].length; continue; }
      const id = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (id) {
        const word = id[0];
        const after = rest.slice(word.length).replace(/^\s+/, '')[0];
        let cls = 'tok-var';
        if (KEYWORDS.has(word)) cls = 'tok-kw';
        else if (TYPES.has(word)) cls = 'tok-type';
        else if (CONSTS.has(word)) cls = 'tok-const';
        else if (LIBS.has(word) || after === '(') cls = 'tok-func';
        else if (MACRO_HINT.test(word)) cls = 'tok-macro';
        html += span(cls, word); i += word.length; continue;
      }
      if (/^[;,.()[\]{}:?]/.test(ch)) { html += span('tok-punct', ch); i++; continue; }
      let op = '';
      for (const m of ['>>=', '<<=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=']) {
        if (rest.startsWith(m)) { op = m; break; }
      }
      html += span('tok-op', op || ch);
      i += (op || ch).length;
    }
    return { html, block };
  }

  function render(source) {
    const lines = String(source).replace(/\r\n/g, '\n').split('\n');
    let inBlock = false;
    const htmlLines = lines.map((line) => {
      const result = highlightLine(line, inBlock);
      inBlock = result.block;
      return result.html;
    });
    return { lines: htmlLines, lineCount: lines.length };
  }

  function words(source) {
    const found = new Map();
    const re = /\b[A-Za-z_]\w*\b/g;
    let m;
    while ((m = re.exec(source))) found.set(m[0], (found.get(m[0]) || 0) + 1);
    return Array.from(found.keys());
  }

  CC.highlight = { render, highlightLine, words, KEYWORDS, TYPES, LIBS };
})();
