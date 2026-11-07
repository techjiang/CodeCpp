/* CodeCpp · 编辑器扩展能力：查找替换、补全、诊断覆盖层、缩略图 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;

  const SNIPPETS = [
    { label: 'main', detail: 'int main(void)', kind: '片段', insert: 'int main(void) {\n\t${1}\n\treturn 0;\n}' },
    { label: 'printf', detail: '格式化输出', kind: '片段', insert: 'printf("${1:%d\\n}", ${2});' },
    { label: 'scanf', detail: '格式化输入', kind: '片段', insert: 'scanf("${1:%d}", &${2});' },
    { label: 'for', detail: 'for 循环', kind: '片段', insert: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}' },
    { label: 'while', detail: 'while 循环', kind: '片段', insert: 'while (${1:condition}) {\n\t${2}\n}' },
    { label: 'if', detail: '条件分支', kind: '片段', insert: 'if (${1:condition}) {\n\t${2}\n}' },
    { label: 'ifelse', detail: 'if / else', kind: '片段', insert: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}' },
    { label: 'switch', detail: 'switch 分支', kind: '片段', insert: 'switch (${1:value}) {\ncase ${2}:\n\t${3}\n\tbreak;\ndefault:\n\tbreak;\n}' },
    { label: 'struct', detail: '结构体定义', kind: '片段', insert: 'typedef struct ${1:Name} {\n\t${2}\n} ${1:Name};' },
    { label: 'function', detail: '函数定义', kind: '片段', insert: 'int ${1:name}(${2:void}) {\n\t${3}\n\treturn 0;\n}' },
    { label: 'malloc', detail: '动态内存', kind: '片段', insert: '${1:int} *${2:p} = malloc(sizeof(${1:int}) * ${3:n});\nif (!${2:p}) return 1;' },
    { label: 'include', detail: '头文件', kind: '片段', insert: '#include <${1:stdio.h}>' }
  ];
  const HINTS = {
    printf: 'int printf(const char *format, ...);', fprintf: 'int fprintf(FILE *stream, const char *format, ...);',
    snprintf: 'int snprintf(char *str, size_t size, const char *format, ...);',
    scanf: 'int scanf(const char *format, ...);', malloc: 'void *malloc(size_t size);',
    calloc: 'void *calloc(size_t count, size_t size);', strcpy: 'char *strcpy(char *dest, const char *src);',
    strncpy: 'char *strncpy(char *dest, const char *src, size_t n);', memset: 'void *memset(void *s, int c, size_t n);',
    memcpy: 'void *memcpy(void *dest, const void *src, size_t n);', fopen: 'FILE *fopen(const char *path, const char *mode);'
  };

  function escapeRegex(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  const Features = {
    setupFind() {
      const el = this.el;
      el.findInput.addEventListener('input', () => this.updateFind());
      el.findInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); this.gotoFindMatch(this.currentMatch + (event.shiftKey ? -1 : 1)); }
        if (event.key === 'Escape') { event.preventDefault(); this.closeFind(); }
      });
      el.replaceInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); this.replaceOne(); }
        if (event.key === 'Escape') { event.preventDefault(); this.closeFind(); }
      });
      el.findCase.addEventListener('change', () => this.updateFind());
      el.findRegex.addEventListener('change', () => this.updateFind());
      el.findPrev.addEventListener('click', () => this.gotoFindMatch(this.currentMatch - 1));
      el.findNext.addEventListener('click', () => this.gotoFindMatch(this.currentMatch + 1));
      el.findClose.addEventListener('click', () => this.closeFind());
      el.replaceOne.addEventListener('click', () => this.replaceOne());
      el.replaceAll.addEventListener('click', () => this.replaceAll());
      el.completion.addEventListener('mousedown', (event) => {
        const item = event.target.closest('.completion-item');
        if (item) { event.preventDefault(); this.acceptCompletion(Number(item.dataset.index)); }
      });
    },

    openFind(withReplace) {
      const el = this.el;
      el.findWidget.classList.remove('hidden');
      el.findWidget.querySelector('.replace-row').classList.toggle('hidden', !withReplace);
      const selection = el.input.value.slice(el.input.selectionStart, el.input.selectionEnd);
      if (selection && !selection.includes('\n')) el.findInput.value = selection;
      el.findInput.focus(); el.findInput.select();
      this.updateFind();
    },
    closeFind() {
      this.el.findWidget.classList.add('hidden');
      this.matches = []; this.currentMatch = -1;
      this.renderOverlay(); this.el.input.focus();
    },

    updateFind() {
      const query = this.el.findInput.value;
      this.el.findCount.textContent = '';
      this.matches = [];
      this.currentMatch = -1;
      if (!query || !this.active()) { this.renderOverlay(); return; }
      const src = this.active().content;
      const flags = 'g' + (this.el.findCase.checked ? '' : 'i');
      let re;
      try { re = new RegExp(this.el.findRegex.checked ? query : escapeRegex(query), flags); }
      catch (_) { this.el.findCount.textContent = '正则无效'; this.renderOverlay(); return; }
      const lines = src.split('\n');
      let offset = 0;
      lines.forEach((line, index) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          this.matches.push({
            start: offset + m.index, end: offset + m.index + m[0].length,
            line: index + 1, col: this.visualColumnAt(offset + m.index), length: Math.max(1, m[0].length)
          });
          if (m[0].length === 0) re.lastIndex++;
          if (this.matches.length > 4000) break;
        }
        offset += line.length + 1;
      });
      this.el.findCount.textContent = this.matches.length ? '0 / ' + this.matches.length : '无结果';
      if (this.matches.length) {
        const caret = this.el.input.selectionStart;
        const nearest = this.matches.findIndex((m) => m.start >= caret);
        this.currentMatch = nearest < 0 ? 0 : nearest;
      }
      this.renderOverlay();
    },

    gotoFindMatch(index) {
      if (!this.matches.length) return;
      const n = ((index % this.matches.length) + this.matches.length) % this.matches.length;
      this.currentMatch = n;
      const m = this.matches[n];
      this.el.input.focus();
      this.el.input.setSelectionRange(m.start, m.end);
      this.el.input.scrollTop = Math.max(0, (m.line - 1) * this.lineHeight - this.el.input.clientHeight / 2 + this.lineHeight);
      this.el.findCount.textContent = (n + 1) + ' / ' + this.matches.length;
      this.syncScroll(); this.renderOverlay();
    },

    replaceOne() {
      if (!this.matches.length) { this.gotoFindMatch(0); return; }
      const m = this.matches[this.currentMatch < 0 ? 0 : this.currentMatch];
      const tab = this.active();
      const original = tab.content.slice(m.start, m.end);
      const pattern = this.el.findRegex.checked ? this.el.findInput.value : escapeRegex(this.el.findInput.value);
      const flags = this.el.findCase.checked ? '' : 'i';
      let replacement = this.el.replaceInput.value;
      if (this.el.findRegex.checked) {
        try { replacement = original.replace(new RegExp(pattern, flags), replacement); } catch (_) {}
      }
      this.setContent(tab.content.slice(0, m.start) + replacement + tab.content.slice(m.end));
      this.el.input.setSelectionRange(m.start + replacement.length, m.start + replacement.length);
      this.updateFind();
      this.gotoFindMatch(this.currentMatch);
    },

    replaceAll() {
      this.updateFind();
      if (!this.matches.length) return;
      const tab = this.active();
      let text = tab.content;
      const replacement = this.el.replaceInput.value;
      for (let i = this.matches.length - 1; i >= 0; i--) {
        const m = this.matches[i];
        let sub = replacement;
        if (this.el.findRegex.checked) {
          const pattern = this.el.findInput.value;
          const flags = this.el.findCase.checked ? '' : 'i';
          try { sub = tab.content.slice(m.start, m.end).replace(new RegExp(pattern, flags), replacement); } catch (_) {}
        }
        text = text.slice(0, m.start) + sub + text.slice(m.end);
      }
      const count = this.matches.length;
      this.setContent(text);
      this.updateFind();
      CC.app && CC.app.toast('已替换 ' + count + ' 处', 'info');
    },

    completionCandidates(prefix) {
      const tab = this.active();
      const found = new Map();
      const add = (item) => { if (!found.has(item.label)) found.set(item.label, item); };
      SNIPPETS.forEach((s) => add(s));
      CC.highlight.KEYWORDS.forEach((k) => add({ label: k, kind: '关键字', detail: '' }));
      CC.highlight.TYPES.forEach((k) => add({ label: k, kind: '类型', detail: '' }));
      CC.highlight.LIBS.forEach((k) => add({ label: k, kind: '函数', detail: HINTS[k] || '标准库' }));
      (tab.outline || []).forEach((s) => add({ label: s.name, kind: '符号', detail: s.kind }));
      (CC.highlight.words(tab.content) || []).forEach((w) => {
        if (w.length > 1) add({ label: w, kind: '文本', detail: '' });
      });
      const p = prefix.toLowerCase();
      return Array.from(found.values())
        .filter((item) => !p || item.label.toLowerCase().startsWith(p) || CC.util.fuzzyScore(item.label, p) > 0)
        .sort((a, b) => {
          const rank = (x) => (p && x.label.toLowerCase().startsWith(p) ? 0 : 1) +
            (x.kind === '片段' ? 0 : x.kind === '符号' ? 1 : x.kind === '函数' ? 2 : 4);
          return rank(a) - rank(b) || a.label.localeCompare(b.label);
        })
        .slice(0, 50);
    },

    openCompletion() {
      const el = this.el;
      const start = el.input.selectionStart;
      const before = el.input.value.slice(0, start);
      const m = /[A-Za-z_]\w*$/.exec(before);
      this.completionStart = m ? start - m[0].length : start;
      this.completionItems = this.completionCandidates(m ? m[0] : '');
      this.completionIndex = 0;
      if (!this.completionItems.length) { this.closeCompletion(); return; }
      el.completion.classList.remove('hidden');
      this.renderCompletion();
      const col = this.columnAt(start);
      const line = this.lineAt(start);
      const left = this.padLeft + (col - 1) * this.charWidth - el.input.scrollLeft;
      const top = this.padTop + line * this.lineHeight - el.input.scrollTop;
      el.completion.style.left = Math.max(70, Math.min(left, el.input.clientWidth - 345)) + 'px';
      const below = el.input.clientHeight - top;
      el.completion.style.top = (below < 180 ? Math.max(6, top - 240) : top + 4) + 'px';
    },

    renderCompletion() {
      this.el.completion.innerHTML = this.completionItems.map((item, index) =>
        '<div class="completion-item ' + (index === this.completionIndex ? 'active' : '') + '" data-index="' + index + '">' +
        '<span class="ci-kind">' + esc(item.kind.slice(0, 1)) + '</span>' +
        '<span class="ci-label">' + esc(item.label) + '</span>' +
        '<span class="ci-detail">' + esc(item.detail || '') + '</span></div>'
      ).join('');
      const active = this.el.completion.querySelector('.completion-item.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    },

    moveCompletion(delta) {
      if (this.el.completion.classList.contains('hidden') || !this.completionItems.length) return false;
      this.completionIndex = (this.completionIndex + delta + this.completionItems.length) % this.completionItems.length;
      this.renderCompletion();
      return true;
    },

    acceptCompletion(index) {
      const item = this.completionItems[index === undefined ? this.completionIndex : index];
      if (!item) { this.closeCompletion(); return; }
      const el = this.el;
      let text = item.insert || item.label;
      const placeholders = [];
      text = text.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_, n, def) => {
        placeholders.push({ key: n, def: def || '' });
        return def || '';
      });
      const start = this.completionStart;
      const end = el.input.selectionStart;
      const src = el.input.value;
      const next = src.slice(0, start) + text + src.slice(end);
      this.setContent(next);
      const first = text.indexOf(placeholders.length ? placeholders[0].def : '');
      let caret = start + text.length;
      if (placeholders.length) {
        const pos = next.indexOf(placeholders[0].def, start);
        if (pos >= 0) {
          el.input.setSelectionRange(pos, pos + placeholders[0].def.length);
          caret = pos;
        }
      } else if (first < 0) caret = start + text.length;
      if (!placeholders.length) el.input.setSelectionRange(caret, caret);
      this.closeCompletion();
      this.refresh();
      el.input.focus();
    },

    closeCompletion() { this.el.completion.classList.add('hidden'); this.completionItems = []; },

    updateHint() {
      const el = this.el;
      const start = el.input.selectionStart;
      const before = el.input.value.slice(0, start);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const m = /([A-Za-z_]\w*)\([^()]*$/.exec(line);
      if (!m || !HINTS[m[1]]) { el.hint.classList.add('hidden'); return; }
      el.hint.textContent = HINTS[m[1]];
      const col = this.columnAt(start);
      el.hint.style.left = Math.max(70, Math.min(this.padLeft + col * this.charWidth - el.input.scrollLeft, el.input.clientWidth - 430)) + 'px';
      el.hint.style.top = Math.max(4, this.padTop + (this.lineAt(start) - 1) * this.lineHeight - el.input.scrollTop - 34) + 'px';
      el.hint.classList.remove('hidden');
    },

    renderOverlay() {
      const el = this.el;
      if (!this.active()) { el.overlay.innerHTML = ''; return; }
      const top0 = this.padTop - el.input.scrollTop;
      const left0 = this.padLeft - el.input.scrollLeft;
      const parts = [];
      const box = (line, col, length, cls, extra) => {
        const top = top0 + (line - 1) * this.lineHeight;
        const left = left0 + (col - 1) * this.charWidth;
        if (top < -this.lineHeight || top > el.input.clientHeight + this.lineHeight) return;
        parts.push('<div class="' + cls + '" style="top:' + top.toFixed(1) + 'px;left:' + left.toFixed(1) +
          'px;width:' + Math.max(this.charWidth, length * this.charWidth).toFixed(1) + 'px;height:' + this.lineHeight + 'px;' + (extra || '') + '"></div>');
      };
      this.matches.forEach((m, index) => {
        if (index > 300) return;
        box(m.line, m.col, m.length, 'find-mark' + (index === this.currentMatch ? ' current' : ''));
      });
      this.diagnosticsFor(this.active().path).forEach((d) => {
        if (!d.line || d.line > this.lines.length) return;
        const width = Math.max(1, Math.min(120, (d.endColumn || d.column + 1) - d.column));
        const visualCol = this.visualWidth(this.lines[d.line - 1] || '', d.column - 1) + 1;
        box(d.line, visualCol, width, 'diag-wave ' + (d.severity === 'error' ? '' : 'warn'), 'height:3px;top:' + (top0 + d.line * this.lineHeight - 4).toFixed(1) + 'px');
      });
      if (this.bracketPair) {
        box(this.bracketPair[0].line, this.bracketPair[0].col, 1, 'bracket-match');
        box(this.bracketPair[1].line, this.bracketPair[1].col, 1, 'bracket-match');
      }
      el.overlay.innerHTML = parts.join('');
    },

    drawMinimap() {
      const canvas = this.el.minimap;
      if (!canvas || !this.active()) return;
      if (!CC.state.settings.minimap) { canvas.style.display = 'none'; return; }
      canvas.style.display = '';
      const dpr = window.devicePixelRatio || 1;
      const width = 92, height = canvas.parentElement.clientHeight;
      canvas.width = width * dpr; canvas.height = height * dpr;
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const style = getComputedStyle(document.documentElement);
      const color = (name, fallback) => (style.getPropertyValue(name) || fallback).trim();
      const colors = {
        kw: color('--syn-kw', '#a8a8a8'), str: color('--syn-str', '#a8a8a8'),
        pre: color('--syn-pre', '#a8a8a8'), comment: color('--syn-comment', '#707070'),
        normal: color('--text-2', '#808080')
      };
      const scale = Math.min(3.2, height / Math.max(1, this.lines.length));
      const scrollLines = this.el.input.scrollTop / this.lineHeight;
      ctx.globalAlpha = .72;
      this.lines.forEach((text, i) => {
        const y = i * scale;
        if (y > height || !text.trim()) return;
        const indent = /^\s*/.exec(text)[0].length;
        let fill = colors.normal;
        if (/^\s*(\/\/|\/\*|\*)/.test(text)) fill = colors.comment;
        else if (/^\s*#/.test(text)) fill = colors.pre;
        else if (/["']/.test(text)) fill = colors.str;
        else if (/\b(if|for|while|return|struct|int|void|typedef)\b/.test(text)) fill = colors.kw;
        ctx.fillStyle = fill;
        ctx.fillRect(4 + Math.min(20, indent * 1.4), y, Math.min(width - 10, text.trim().length * 1.5), Math.max(.8, scale * .55));
      });
      ctx.globalAlpha = 1;
      const viewTop = scrollLines * scale;
      const viewHeight = Math.max(12, (this.el.input.clientHeight / this.lineHeight) * scale);
      ctx.fillStyle = color('--accent', '#48dcb4');
      ctx.globalAlpha = .28;
      ctx.fillRect(0, viewTop, width, 1);
      ctx.fillRect(0, Math.min(height - 1, viewTop + viewHeight - 1), width, 1);
      ctx.globalAlpha = 1;
    },

    updateBracketPair() {
      const el = this.el;
      const pos = el.input.selectionStart;
      const src = el.input.value;
      const around = [src[pos - 1], src[pos]];
      const pairs = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };
      let index = -1;
      if (pairs[around[0]] && '([{'.includes(around[0])) index = pos - 1;
      else if (pairs[around[1]] && '([{'.includes(around[1])) index = pos;
      else if (pairs[around[0]] && ')]}'.includes(around[0])) index = pos - 1;
      else if (pairs[around[1]] && ')]}'.includes(around[1])) index = pos;
      if (index < 0) { this.bracketPair = null; return; }
      const startChar = src[index];
      const forward = '([{'.includes(startChar);
      const opener = forward ? startChar : pairs[startChar];
      const closer = forward ? pairs[startChar] : startChar;
      let depth = 0, found = -1;
      if (forward) {
        for (let i = index; i < src.length; i++) {
          if (src[i] === opener) depth++;
          else if (src[i] === closer) { depth--; if (depth === 0) { found = i; break; } }
        }
      } else {
        for (let i = index; i >= 0; i--) {
          if (src[i] === closer) depth++;
          else if (src[i] === opener) { depth--; if (depth === 0) { found = i; break; } }
        }
      }
      if (found < 0) { this.bracketPair = null; return; }
      this.bracketPair = [
        { index: Math.min(index, found), line: 0, col: 0 },
        { index: Math.max(index, found), line: 0, col: 0 }
      ].map((p) => Object.assign(p, { line: this.lineAt(p.index), col: this.columnAt(p.index) }));
    }
  };

  CC.EditorFeatures = Features;
  CC.EditorSnippets = SNIPPETS;
})();
