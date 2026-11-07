/* CodeCpp · 代码编辑器核心 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;
  const icon = CC.util.icon;

  const byId = (id) => document.getElementById(id);

  class Editor {
    constructor() {
      this.el = {
        host: byId('editor-host'), welcome: byId('welcome'),
        tabbar: byId('tabbar'), breadcrumbs: byId('breadcrumbs'),
        scroll: byId('editor-scroll'), input: byId('code-input'),
        highlight: byId('highlight-layer'), gutter: byId('gutter'),
        gutterInner: byId('gutter-inner'), overlay: byId('overlay-layer'),
        minimap: byId('minimap'),
        findWidget: byId('find-widget'), findInput: byId('find-input'),
        replaceInput: byId('replace-input'), findCount: byId('find-count'),
        findCase: byId('find-case'), findRegex: byId('find-regex'),
        findPrev: byId('find-prev'), findNext: byId('find-next'),
        findClose: byId('find-close'), replaceOne: byId('replace-one'),
        replaceAll: byId('replace-all'),
        completion: byId('completion-popup'), hint: byId('hint-popup')
      };
      this.tabs = new Map();
      this.order = [];
      this.activeId = null;
      this.seq = 1;
      this.lines = [''];
      this.lineStarts = [0];
      this.fontSize = 14; this.lineHeight = 22; this.tabSize = 4;
      this.charWidth = 8; this.padLeft = 78; this.padTop = 10;
      this.matches = []; this.currentMatch = -1;
      this.completionItems = []; this.completionIndex = 0; this.completionStart = 0;
      this.bracketPair = null;
      this.staticDiag = new Map(); this.compilerDiag = [];
      this.breakpoints = new Map(); this.debugLine = null;
      this.lastCursorLine = 0;
      this.scrollQueued = false;
      this.scheduleAnalyze = CC.util.debounce(() => this.analyze(), 420);
      this.scheduleAutoSave = CC.util.debounce(() => {
        const tab = this.active();
        if (tab && tab.modified && CC.state.settings.autoSave) this.save(true);
      }, 1200);
      this.schedulePersistBP = CC.util.debounce(() => {
        CC.api.settings({ breakpoints: this.getBreakpoints() }).catch(() => {});
      }, 500);
      this.applyAppearance();
      this.bind();
    }

    active() { return this.tabs.get(this.activeId) || null; }
    unit() { return CC.state.settings.insertSpaces === false ? '\t' : ' '.repeat(this.tabSize); }

    applyAppearance() {
      const s = CC.state.settings;
      this.fontSize = Number(s.fontSize) || 14;
      this.lineHeight = Math.round(this.fontSize * 1.55);
      this.tabSize = Math.max(1, Number(s.tabSize) || 4);
      const host = this.el.host;
      host.style.setProperty('--font-size', this.fontSize + 'px');
      host.style.setProperty('--line-height', this.lineHeight + 'px');
      host.style.setProperty('--tab-size', this.tabSize);
      this.padLeft = 78; this.padTop = 10;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:Consolas,"Cascadia Mono",monospace;font-size:' + this.fontSize + 'px';
      probe.textContent = 'M'.repeat(100);
      host.appendChild(probe);
      this.charWidth = probe.getBoundingClientRect().width / 100 || this.fontSize * 0.6;
      host.removeChild(probe);
      this.refresh();
    }

    bind() {
      const el = this.el;
      el.input.addEventListener('input', () => this.onInput());
      el.input.addEventListener('scroll', () => this.queueScroll());
      el.input.addEventListener('keydown', (event) => this.onKeyDown(event));
      el.input.addEventListener('click', () => this.onCursorChange());
      el.input.addEventListener('keyup', () => this.onCursorChange());
      el.input.addEventListener('select', () => this.onCursorChange());
      el.input.addEventListener('blur', () => { el.hint.classList.add('hidden'); });
      el.gutterInner.addEventListener('click', (event) => {
        const slot = event.target.closest('.bp-slot');
        const row = event.target.closest('.gutter-row');
        if (!row) return;
        const line = Number(row.dataset.line);
        if (slot) this.toggleBreakpoint(line);
        else this.goto(this.active().path, line, 1);
      });
      el.tabbar.addEventListener('click', (event) => {
        const close = event.target.closest('.tab-close');
        const tabEl = event.target.closest('.editor-tab');
        if (close && tabEl) { event.stopPropagation(); this.close(Number(tabEl.dataset.id)); return; }
        if (tabEl) this.activate(Number(tabEl.dataset.id));
      });
      el.tabbar.addEventListener('auxclick', (event) => {
        if (event.button !== 1) return;
        const tabEl = event.target.closest('.editor-tab');
        if (tabEl) this.close(Number(tabEl.dataset.id));
      });
      window.addEventListener('resize', () => { this.renderOverlay(); this.drawMinimap(); });
      if (this.setupFind) this.setupFind();
    }

    buildLineStarts() {
      const starts = [0];
      const text = this.active() ? this.active().content : '';
      for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
      this.lineStarts = starts;
    }

    lineIndexAt(offset) {
      const arr = this.lineStarts;
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= offset) lo = mid; else hi = mid - 1; }
      return lo;
    }
    lineAt(offset) { return this.lineIndexAt(offset) + 1; }
    logicalColumnAt(offset) { return offset - this.lineStarts[this.lineIndexAt(offset)] + 1; }
    visualWidth(text, upto) {
      const s = String(text).slice(0, upto);
      const tabs = (s.match(/\t/g) || []).length;
      return s.length + tabs * (this.tabSize - 1);
    }
    visualColumnAt(offset) {
      const idx = this.lineIndexAt(offset);
      return this.visualWidth(this.lines[idx] || '', offset - this.lineStarts[idx]) + 1;
    }
    columnAt(offset) { return this.visualColumnAt(offset); }
    offsetOf(line, col) {
      const idx = Math.max(0, Math.min(this.lineStarts.length - 1, line - 1));
      return this.lineStarts[idx] + Math.max(0, (Number(col) || 1) - 1);
    }

    diagnosticsFor(path) {
      const own = (this.staticDiag.get(path) || []).map((d) => Object.assign({ file: path }, d));
      const normalize = (f) => String(f || '').replace(/\\/g, '/').replace(/^\.\//, '');
      const extra = this.compilerDiag.filter((d) => !d.file || normalize(d.file) === normalize(path) || normalize(d.file).endsWith('/' + normalize(path)));
      return own.concat(extra);
    }

    allDiagnostics() {
      const list = [];
      this.tabs.forEach((tab, id) => {
        if (id === this.activeId) return;
        (this.staticDiag.get(tab.path) || []).forEach((d) => list.push(Object.assign({ file: tab.path }, d)));
      });
      const active = this.active();
      if (active) list.push(...this.diagnosticsFor(active.path));
      list.push(...this.compilerDiag);
      const seen = new Set();
      return list.filter((d) => {
        const key = [d.file, d.line, d.column, d.code, d.message].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    render() {
      const tab = this.active();
      if (!tab) { this.showWelcome(); return; }
      this.el.welcome.classList.add('hidden');
      this.el.host.classList.remove('hidden');
      const src = tab.content;
      this.lines = src.replace(/\r\n/g, '\n').split('\n');
      this.buildLineStarts();
      const highlighted = CC.highlight.render(src);
      const cursorLine = this.lineAt(this.el.input.selectionStart);
      const byLine = new Map();
      const diagnostics = this.diagnosticsFor(tab.path);
      diagnostics.forEach((d) => {
        if (!d.line) return;
        const cur = byLine.get(d.line);
        if (!cur || (d.severity === 'error' && cur !== 'error')) byLine.set(d.line, d.severity);
      });
      const bps = this.breakpoints.get(tab.path) || new Set();
      const lineHtml = [];
      const gutterHtml = [];
      for (let i = 0; i < highlighted.lines.length; i++) {
        const line = i + 1;
        const classes = ['code-line'];
        if (line === cursorLine) classes.push('current');
        const sev = byLine.get(line);
        if (sev === 'error') classes.push('diag-error');
        else if (sev === 'warning') classes.push('diag-warning');
        if (this.debugLine && this.debugLine.file === tab.path && this.debugLine.line === line) classes.push('debug-line');
        lineHtml.push('<div class="' + classes.join(' ') + '" data-line="' + line + '">' + highlighted.lines[i] + '</div>');
        const diag = diagnostics.find((d) => d.line === line && d.severity === 'error') ||
          diagnostics.find((d) => d.line === line && d.severity === 'warning');
        gutterHtml.push('<div class="gutter-row ' + (line === cursorLine ? 'current' : '') + '" data-line="' + line + '">' +
          '<span class="bp-slot ' + (bps.has(line) ? 'on' : '') + '" data-line="' + line + '" title="切换断点 (F9)"></span>' +
          (diag ? '<span class="diag-icon ' + (diag.severity === 'warning' ? 'warn' : '') + '">' + icon(diag.severity === 'warning' ? 'warning' : 'error') + '</span>' : '') +
          '<span class="line-no">' + line + '</span></div>');
      }
      this.el.highlight.innerHTML = lineHtml.join('');
      this.el.gutterInner.innerHTML = gutterHtml.join('');
      this.renderOverlay();
      this.drawMinimap();
    }

    refresh() {
      if (!this.active()) return;
      this.render();
      this.updateTabs();
      this.onCursorChange();
      this.queueScroll();
      this.scheduleAnalyze();
      this.scheduleAutoSave();
    }

    queueScroll() {
      if (this.scrollQueued) return;
      this.scrollQueued = true;
      requestAnimationFrame(() => {
        this.scrollQueued = false;
        this.syncScroll();
      });
    }

    syncScroll() {
      const el = this.el;
      const top = el.input.scrollTop, left = el.input.scrollLeft;
      el.highlight.style.transform = 'translate(' + (-left) + 'px,' + (-top) + 'px)';
      el.gutterInner.style.transform = 'translateY(' + (-top) + 'px)';
      this.renderOverlay();
      this.drawMinimap();
    }

    updateCurrentLine() {
      const el = this.el;
      const prev = el.highlight.querySelector('.code-line.current');
      if (prev) prev.classList.remove('current');
      const prevG = el.gutterInner.querySelector('.gutter-row.current');
      if (prevG) prevG.classList.remove('current');
      const line = this.lastCursorLine;
      const code = el.highlight.children[line - 1];
      const gutter = el.gutterInner.children[line - 1];
      if (code) code.classList.add('current');
      if (gutter) gutter.classList.add('current');
    }

    onCursorChange() {
      const tab = this.active();
      if (!tab) return;
      const pos = this.el.input.selectionStart;
      const line = this.lineAt(pos), col = this.logicalColumnAt(pos);
      tab.caret = pos;
      if (line !== this.lastCursorLine) { this.lastCursorLine = line; this.updateCurrentLine(); }
      this.updateBracketPair();
      this.renderOverlay();
      this.updateHint();
      this.renderBreadcrumbs();
      CC.bus.emit('cursor', { line, col, path: tab.path, length: this.lines.length });
    }

    renderBreadcrumbs() {
      const tab = this.active();
      if (!tab) { this.el.breadcrumbs.innerHTML = ''; return; }
      const parts = tab.path.split('/');
      let symbol = '';
      const line = this.lineAt(this.el.input.selectionStart);
      const candidates = (tab.outline || []).filter((s) => s.kind === 'function' && s.line <= line);
      if (candidates.length) symbol = candidates[candidates.length - 1].name + '()';
      this.el.breadcrumbs.innerHTML = parts.map((p, i) =>
        '<span class="crumb">' + esc(p) + '</span>' + (i < parts.length - 1 ? '<span class="sep">/</span>' : '')
      ).join('') + (symbol ? '<span class="sep">›</span><span class="sym">' + esc(symbol) + '</span>' : '');
    }

    onInput() {
      const tab = this.active();
      if (!tab) return;
      tab.content = this.el.input.value;
      tab.modified = tab.content !== tab.savedContent;
      this.refresh();
      CC.bus.emit('editor-change', { path: tab.path });
    }

    setContent(text) {
      const tab = this.active();
      if (!tab) return;
      this.el.input.value = text;
      tab.content = text;
      tab.modified = text !== tab.savedContent;
      this.refresh();
      CC.bus.emit('editor-change', { path: tab.path });
    }

    insertText(text) {
      const input = this.el.input;
      input.focus();
      const start = input.selectionStart, end = input.selectionEnd;
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, text); } catch (_) {}
      if (!inserted) {
        input.setRangeText(text, start, end, 'end');
        this.onInput();
      }
      return inserted;
    }

    replaceRange(start, end, text, selStart, selEnd) {
      const input = this.el.input;
      input.focus();
      input.setSelectionRange(start, end);
      this.insertText(text);
      input.setSelectionRange(selStart === undefined ? start + text.length : selStart,
        selEnd === undefined ? start + text.length : selEnd);
      this.onCursorChange();
    }

    onKeyDown(event) {
      if (!this.active()) return;
      const el = this.el, input = el.input;
      const key = event.key;
      if (!el.completion.classList.contains('hidden')) {
        if (key === 'ArrowDown') { event.preventDefault(); this.moveCompletion(1); return; }
        if (key === 'ArrowUp') { event.preventDefault(); this.moveCompletion(-1); return; }
        if (key === 'Enter' || key === 'Tab') { event.preventDefault(); this.acceptCompletion(); return; }
        if (key === 'Escape') { event.preventDefault(); this.closeCompletion(); return; }
      }
      if (key === 'Escape') {
        if (!el.findWidget.classList.contains('hidden')) { event.preventDefault(); this.closeFind(); }
        el.hint.classList.add('hidden');
        return;
      }
      const ctrl = event.ctrlKey || event.metaKey;
      const s = input.selectionStart, e = input.selectionEnd;
      const value = input.value;
      if (ctrl && key === '/') { event.preventDefault(); this.toggleComment(); return; }
      if (ctrl && key === ' '){ event.preventDefault(); this.openCompletion(); return; }
      if (ctrl && event.shiftKey && (key === 'K' || key === 'k')) { event.preventDefault(); this.deleteLines(); return; }
      if (ctrl && event.shiftKey && (key === 'D' || key === 'd')) { event.preventDefault(); this.duplicateLines(); return; }
      if (ctrl && key === ']') { event.preventDefault(); this.indentSelection(1); return; }
      if (ctrl && key === '[') { event.preventDefault(); this.indentSelection(-1); return; }
      if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        event.preventDefault(); this.moveLines(key === 'ArrowUp' ? -1 : 1); return;
      }
      if (key === 'Tab') { event.preventDefault(); this.indentSelection(event.shiftKey ? -1 : 1); return; }
      if (key === 'Enter') { event.preventDefault(); this.autoIndentEnter(); return; }
      if (key === 'Backspace' && s === e) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        const before = value.slice(lineStart, s);
        if (/^[ \t]+$/.test(before)) {
          event.preventDefault();
          const remove = Math.min(this.unit().length, before.length);
          this.replaceRange(s - remove, s, '');
          return;
        }
        const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
        if (pairs[value[s - 1]] && value[s] === pairs[value[s - 1]]) {
          event.preventDefault(); this.replaceRange(s - 1, s + 1, ''); return;
        }
      }
      const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
      if (pairs[key] && !ctrl && !event.altKey) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        const beforeLine = value.slice(lineStart, s);
        const quotes = (beforeLine.match(/"/g) || []).length;
        const inString = key === '"' && quotes % 2 === 1;
        if (!inString) {
          event.preventDefault();
          if (s !== e) {
            this.replaceRange(s, e, key + value.slice(s, e) + pairs[key], s + 1, e + 1);
          } else {
            const next = value[e] || '';
            if (!/[A-Za-z0-9_]/.test(next)) {
              this.replaceRange(s, e, key + pairs[key], s + 1, s + 1);
            } else this.insertText(key);
          }
          return;
        }
      }
      if ([')', ']', '}', '"', "'"].includes(key) && s === e && value[s] === key) {
        event.preventDefault(); input.setSelectionRange(s + 1, s + 1); this.onCursorChange(); return;
      }
    }

    lineRange() {
      const input = this.el.input;
      const s = input.selectionStart, e = input.selectionEnd;
      const first = this.lineIndexAt(s);
      const last = this.lineIndexAt(e === s ? s : e - 1);
      return { first, last, start: this.lineStarts[first], end: last + 1 < this.lineStarts.length ? this.lineStarts[last + 1] - 1 : input.value.length };
    }

    indentSelection(direction) {
      const input = this.el.input;
      const { first, last, start, end } = this.lineRange();
      const multi = first !== last;
      if (!multi && direction > 0 && input.selectionStart === input.selectionEnd) {
        this.insertText(this.unit()); return;
      }
      const unit = this.unit();
      const lines = input.value.slice(start, end).split('\n');
      const changed = lines.map((line) => {
        if (direction > 0) return unit + line;
        const m = /^(\t| {1,4})/.exec(line);
        return m ? line.slice(m[0].length) : line;
      }).join('\n');
      this.replaceRange(start, end, changed,
        multi ? start : Math.max(start, input.selectionStart - unit.length),
        multi ? start + changed.length : Math.max(start, input.selectionEnd - unit.length));
    }

    autoIndentEnter() {
      const input = this.el.input;
      const s = input.selectionStart;
      const value = input.value;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const lineText = value.slice(lineStart, s);
      const indent = /^[ \t]*/.exec(lineText)[0];
      const trimmed = lineText.trimEnd();
      const next = value[s] || '';
      const unit = this.unit();
      if (/[{(]\s*$/.test(trimmed) && ['}', ')', ']'].includes(next)) {
        this.insertText('\n' + indent + unit + '\n' + indent);
        const caret = input.selectionStart;
        input.setSelectionRange(caret - indent.length - 1, caret - indent.length - 1);
      } else {
        const extra = /[{([]\s*$/.test(trimmed) ? unit : '';
        this.insertText('\n' + indent + extra);
      }
      this.onCursorChange();
    }

    toggleComment() {
      const input = this.el.input;
      const { start, end } = this.lineRange();
      const chunk = input.value.slice(start, end);
      const lines = chunk.split('\n');
      const allCommented = lines.every((l) => /^\s*\/\//.test(l));
      const changed = lines.map((line) => {
        if (allCommented) return line.replace(/^(\s*)\/\/\s?/, '$1');
        const m = /^(\s*)/.exec(line);
        return m[0] + '// ' + line.slice(m[0].length);
      }).join('\n');
      this.replaceRange(start, end, changed, start, start + changed.length);
    }

    deleteLines() {
      const input = this.el.input;
      let { start, end } = this.lineRange();
      if (end < input.value.length) end++;
      this.replaceRange(start, end, '');
    }

    duplicateLines() {
      const input = this.el.input;
      const { start, end } = this.lineRange();
      const chunk = input.value.slice(start, end);
      this.replaceRange(end, end, '\n' + chunk, end + 1, end + 1 + chunk.length);
    }

    moveLines(delta) {
      const input = this.el.input;
      let { first, last, start, end } = this.lineRange();
      const value = input.value;
      if (delta < 0 && first === 0) return;
      if (delta > 0 && last >= this.lines.length - 1) return;
      if (delta < 0) start = this.lineStarts[first - 1];
      else end = last + 2 < this.lineStarts.length ? this.lineStarts[last + 2] - 1 : value.length;
      const chunk = value.slice(start, end).replace(/\n$/, '');
      const parts = chunk.split('\n');
      const reordered = delta < 0
        ? [parts.pop(), ...parts].join('\n')
        : [...parts.slice(1), parts[0]].join('\n');
      this.replaceRange(start, end, reordered + (end < value.length ? '\n' : ''));
    }

    async analyze() {
      const tab = this.active();
      if (!tab || tab.language !== 'c') {
        CC.bus.emit('outline', { tab: tab, outline: { symbols: [], metrics: null } });
        return;
      }
      try {
        const result = await CC.api.analyze(tab.content, tab.path);
        tab.outline = result.outline.symbols;
        tab.metrics = result.outline.metrics;
        this.staticDiag.set(tab.path, result.diagnostics);
        this.render();
        CC.bus.emit('problems', this.allDiagnostics());
        CC.bus.emit('outline', { tab, outline: result.outline });
      } catch (error) {
        CC.app && CC.app.status(error.message, 'bad');
      }
    }

    setCompilerDiagnostics(list) {
      this.compilerDiag = Array.isArray(list) ? list : [];
      this.render();
      CC.bus.emit('problems', this.allDiagnostics());
    }

    updateTabs() {
      const el = this.el;
      if (!this.order.length) {
        el.tabbar.innerHTML = '<div class="tabbar-empty">未打开的文件 · Ctrl+P 快速打开</div>';
        return;
      }
      el.tabbar.innerHTML = this.order.map((id) => {
        const tab = this.tabs.get(id);
        return '<div class="editor-tab ' + (id === this.activeId ? 'active' : '') + '" data-id="' + id + '" title="' + esc(tab.path) + '">' +
          icon('file') + '<span class="tab-name">' + esc(tab.name) + '</span>' +
          (tab.modified ? '<span class="tab-dirty" title="未保存"></span>' : '') +
          '<span class="tab-close" title="关闭">' + icon('close') + '</span></div>';
      }).join('');
    }

    showWelcome() {
      this.el.host.classList.add('hidden');
      this.el.welcome.classList.remove('hidden');
      this.el.tabbar.innerHTML = '<div class="tabbar-empty">未打开的文件 · Ctrl+P 快速打开</div>';
      this.el.breadcrumbs.innerHTML = '';
      CC.bus.emit('tab-changed', { tab: null });
    }

    activate(id) {
      const current = this.active();
      if (current) {
        current.caret = this.el.input.selectionStart;
        current.scrollTop = this.el.input.scrollTop;
        current.scrollLeft = this.el.input.scrollLeft;
      }
      const tab = this.tabs.get(id);
      if (!tab) return;
      this.activeId = id;
      this.el.input.value = tab.content;
      this.el.input.scrollTop = tab.scrollTop || 0;
      this.el.input.scrollLeft = tab.scrollLeft || 0;
      this.el.input.setSelectionRange(tab.caret || 0, tab.caret || 0);
      this.lastCursorLine = 0;
      this.render();
      this.updateTabs();
      this.syncScroll();
      this.onCursorChange();
      this.closeCompletion();
      CC.bus.emit('tab-changed', { tab });
      if (tab.language === 'c') this.analyze();
      else CC.bus.emit('outline', { tab, outline: { symbols: [], metrics: null } });
      this.el.input.focus();
    }

    async open(path, line, col) {
      const existing = Array.from(this.tabs.values()).find((t) => t.path === path);
      if (!existing) {
        let file;
        try {
          const response = await CC.api.read(path);
          file = response.file || response;
        } catch (error) { CC.app && CC.app.toast(error.message, 'error'); return null; }
        const id = this.seq++;
        const tab = {
          id, path, name: CC.util.basename(path), content: file.content,
          savedContent: file.content, language: file.language,
          modified: false, caret: 0, scrollTop: 0, scrollLeft: 0, outline: [], metrics: null
        };
        this.tabs.set(id, tab);
        this.order.push(id);
        this.activate(id);
        CC.bus.emit('recent', path);
      } else if (existing.id !== this.activeId) this.activate(existing.id);
      if (line) this.setCursor(line, col || 1);
      return this.active();
    }

    setCursor(line, col) {
      const offset = this.offsetOf(line, col);
      const input = this.el.input;
      input.focus();
      input.setSelectionRange(offset, offset);
      input.scrollTop = Math.max(0, (line - 1) * this.lineHeight - input.clientHeight / 2 + this.lineHeight);
      input.scrollLeft = 0;
      this.onCursorChange();
      this.syncScroll();
    }

    goto(path, line, col) { return this.open(path, line, col); }

    dirtyCount() {
      let count = 0;
      this.tabs.forEach((tab) => { if (tab.modified) count++; });
      return count;
    }

    async guardUnsaved(actionLabel) {
      const count = this.dirtyCount();
      if (!count || !CC.app) return true;
      let choice = 'discard';
      if (CC.app.confirmSave) {
        choice = await CC.app.confirmSave('有未保存的更改',
          '有 ' + count + ' 个文件尚未保存，' + actionLabel + '前是否保存？');
      } else {
        const ok = await CC.app.confirm('有未保存的更改', '有 ' + count + ' 个文件尚未保存，确定继续吗？');
        if (!ok) return false;
      }
      if (choice === 'cancel') return false;
      if (choice === 'save') await this.saveAll();
      else { this.tabs.clear(); this.order = []; this.activeId = null; }
      CC.bus.emit('dirty-count', this.dirtyCount());
      return true;
    }

    async save(silent, target) {
      const tab = target || this.active();
      if (!tab) return false;
      try {
        await CC.api.save(tab.path, tab.content);
        tab.savedContent = tab.content;
        tab.modified = false;
        this.updateTabs();
        CC.bus.emit('file-saved', { path: tab.path });
        if (!silent) CC.app && CC.app.toast('已保存 ' + tab.name, 'success');
        return true;
      } catch (error) { CC.app && CC.app.toast(error.message, 'error'); return false; }
    }

    async saveAll() {
      let count = 0;
      for (const tab of this.tabs.values()) {
        if (!tab.modified) continue;
        try {
          await CC.api.save(tab.path, tab.content);
          tab.savedContent = tab.content; tab.modified = false; count++;
        } catch (_) {}
      }
      this.updateTabs();
      if (count) CC.app && CC.app.toast('已保存 ' + count + ' 个文件', 'success');
      return count;
    }

    async close(id, force) {
      const tab = this.tabs.get(id);
      if (!tab) return;
      if (tab.modified && !force) {
        if (CC.app && CC.app.confirmSave) {
          const choice = await CC.app.confirmSave('文件未保存', '「' + tab.name + '」有未保存的更改，是否保存？');
          if (choice === 'cancel') return;
          if (choice === 'save' && !await this.save(false, tab)) return;
        } else {
          const ok = await CC.app.confirm('文件未保存', '「' + tab.name + '」有未保存的更改，确定关闭吗？');
          if (!ok) return;
        }
      }
      this.tabs.delete(id);
      this.order = this.order.filter((x) => x !== id);
      if (this.activeId === id) {
        this.activeId = null;
        if (this.order.length) this.activate(this.order[this.order.length - 1]);
        else this.showWelcome();
      } else this.updateTabs();
      CC.bus.emit('dirty-count', this.dirtyCount());
    }

    async format() {
      const tab = this.active();
      if (!tab) return;
      try {
        const result = await CC.api.format(tab.content, {
          tabSize: this.tabSize, insertSpaces: CC.state.settings.insertSpaces !== false
        });
        if (result.changed) {
          const caret = this.el.input.selectionStart;
          this.setContent(result.content);
          this.el.input.setSelectionRange(Math.min(caret, result.content.length), Math.min(caret, result.content.length));
          CC.app.toast('文档已按大括号层级格式化', 'success');
        } else CC.app.toast('缩进已经是最优状态', 'info');
      } catch (error) { CC.app.toast(error.message, 'error'); }
    }

    loadBreakpoints(list) {
      (list || []).forEach((bp) => {
        if (!bp || !bp.file || !bp.line) return;
        if (!this.breakpoints.has(bp.file)) this.breakpoints.set(bp.file, new Set());
        this.breakpoints.get(bp.file).add(Number(bp.line));
      });
      this.render();
    }

    getBreakpoints() {
      const out = [];
      this.breakpoints.forEach((lines, file) => lines.forEach((line) => out.push({ file, line })));
      return out;
    }

    toggleBreakpoint(line) {
      const tab = this.active();
      if (!tab) return;
      if (!this.breakpoints.has(tab.path)) this.breakpoints.set(tab.path, new Set());
      const set = this.breakpoints.get(tab.path);
      if (set.has(line)) set.delete(line); else set.add(line);
      this.render();
      this.schedulePersistBP();
      CC.bus.emit('breakpoints', this.getBreakpoints());
      CC.app && CC.app.status((set.has(line) ? '已在第 ' + line + ' 行设置断点' : '已移除第 ' + line + ' 行断点'));
    }

    breakpointAtCursor() {
      const tab = this.active();
      if (tab) this.toggleBreakpoint(this.lineAt(this.el.input.selectionStart));
    }

    clearBreakpoint(file, line) {
      const set = this.breakpoints.get(file);
      if (set) set.delete(line);
      this.schedulePersistBP();
      this.render();
      CC.bus.emit('breakpoints', this.getBreakpoints());
    }

    setDebugFrame(file, line) {
      this.debugLine = file && line ? { file, line } : null;
      this.render();
    }

    nextDiagnostic() {
      const list = this.allDiagnostics().filter((d) => d.line > 0 && (d.severity === 'error' || d.severity === 'warning'))
        .sort((a, b) => a.line - b.line);
      if (!list.length) { CC.app.toast('当前没有问题', 'info'); return; }
      const tab = this.active();
      const cursorLine = tab ? this.lineAt(this.el.input.selectionStart) : 0;
      const next = list.find((d) => d.line > cursorLine || (d.file && tab && d.file !== tab.path)) || list[0];
      if (next.file) this.goto(next.file, next.line, next.column || 1);
      CC.app.toast((next.code ? '[' + next.code + '] ' : '') + next.message, next.severity === 'error' ? 'error' : 'warn');
    }
  }

  Object.assign(Editor.prototype, CC.EditorFeatures || {});
  CC.Editor = Editor;
})();
