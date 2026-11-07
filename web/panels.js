/* CodeCpp · 底部面板：问题、输出、运行、终端、调试控制台 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;
  const icon = CC.util.icon;
  const byId = (id) => document.getElementById(id);

  class Panels {
    constructor() {
      this.el = {
        panel: byId('bottom-panel'), tabs: byId('panel-tabs'), body: byId('panel-body'),
        problemList: byId('problem-list'), problemToolbar: byId('problem-toolbar'), badge: byId('problems-badge'),
        output: byId('output-view'), runView: byId('run-view'),
        runArgs: byId('run-args'), runStdin: byId('run-stdin'),
        termHistory: byId('terminal-history'), termInput: byId('terminal-input'),
        debugConsole: byId('debug-console'), debugInput: byId('debug-input')
      };
      this.current = 'problems';
      this.problems = [];
      this.filter = 'all';
      this.termCommands = [];
      this.termIndex = 0;
      this.debugCommands = [];
      this.debugIndex = 0;
      this.persist = CC.util.debounce(() => {
        CC.api.settings({ build: {
          args: this.el.runArgs.value, stdin: this.el.runStdin.value,
          output: CC.state.settings.build.output, mode: CC.state.settings.build.mode
        } }).catch(() => {});
      }, 600);
      this.bind();
      CC.bus.on('problems', (list) => this.setProblems(list));
      CC.bus.on('debug-console', (lines) => this.renderDebugConsole(lines));
      CC.bus.on('settings-changed', (patch) => {
        const build = patch && patch.build;
        if (!build) return;
        if ('args' in build && document.activeElement !== this.el.runArgs) this.el.runArgs.value = build.args || '';
        if ('stdin' in build && document.activeElement !== this.el.runStdin) this.el.runStdin.value = build.stdin || '';
      });
    }

    init() {
      const build = CC.state.settings.build || {};
      this.el.runArgs.value = build.args || '';
      this.el.runStdin.value = build.stdin || '';
      this.setProblems([]);
    }

    bind() {
      this.el.tabs.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-panel]');
        if (tab) { this.activate(tab.dataset.panel); return; }
        const action = event.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'clear-panel') this.clearCurrent();
        if (action.dataset.action === 'toggle-panel') this.toggleCollapse();
      });
      this.el.problemToolbar.addEventListener('click', (event) => {
        const filter = event.target.closest('[data-filter]');
        if (filter) { this.filter = filter.dataset.filter; this.renderProblems(); return; }
        const action = event.target.closest('[data-action]');
        if (action && action.dataset.action === 'analyze') CC.editor.analyze();
      });
      this.el.problemList.addEventListener('click', (event) => {
        const row = event.target.closest('[data-file]');
        if (!row) return;
        if (row.dataset.file) CC.editor.goto(row.dataset.file, Number(row.dataset.line) || 1, Number(row.dataset.col) || 1);
      });
      this.el.runArgs.addEventListener('input', () => this.persist());
      this.el.runStdin.addEventListener('input', () => this.persist());
      byId('panel-body').addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]');
        if (action && action.dataset.action === 'run-again') this.run();
      });
      this.el.termInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { const cmd = this.el.termInput.value; this.el.termInput.value = ''; this.terminalCommand(cmd); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); this.recall(this.termCommands, 'term'); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); this.recall(this.termCommands, 'term', 1); }
      });
      this.el.debugInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { const cmd = this.el.debugInput.value; this.el.debugInput.value = ''; this.debugCommand(cmd); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); this.recall(this.debugCommands, 'debug'); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); this.recall(this.debugCommands, 'debug', 1); }
      });
    }

    recall(list, which, down) {
      if (!list.length) return;
      const input = which === 'term' ? this.el.termInput : this.el.debugInput;
      const index = which === 'term' ? this.termIndex : this.debugIndex;
      const next = Math.max(0, Math.min(list.length, index + (down ? 1 : -1)));
      input.value = list[list.length - next] || '';
      if (which === 'term') this.termIndex = next; else this.debugIndex = next;
    }

    activate(name) {
      this.current = name;
      this.el.panel.classList.remove('collapsed');
      this.el.tabs.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
      this.el.body.querySelectorAll('[data-panel-view]').forEach((v) => v.classList.toggle('active', v.dataset.panelView === name));
      if (name === 'terminal') this.el.termInput.focus();
      if (name === 'debugConsole') this.el.debugInput.focus();
    }

    toggleCollapse() { this.el.panel.classList.toggle('collapsed'); }

    clearCurrent() {
      if (this.current === 'problems') { CC.editor.setCompilerDiagnostics([]); CC.app.toast('已清除编译器诊断', 'info'); }
      else if (this.current === 'output') this.el.output.innerHTML = '<span class="dim">输出已清空</span>';
      else if (this.current === 'run') this.el.runView.innerHTML = '';
      else if (this.current === 'terminal') this.el.termHistory.innerHTML = '';
      else if (this.current === 'debugConsole') this.el.debugConsole.innerHTML = '';
    }

    setProblems(list) {
      this.problems = Array.isArray(list) ? list : [];
      this.renderProblems();
    }

    renderProblems() {
      const errors = this.problems.filter((p) => p.severity === 'error').length;
      const warnings = this.problems.filter((p) => p.severity === 'warning').length;
      this.el.badge.textContent = errors + warnings;
      this.el.badge.style.display = (errors + warnings) ? '' : 'none';
      this.el.problemToolbar.innerHTML =
        '<button class="mini-btn ' + (this.filter === 'all' ? 'active' : '') + '" data-filter="all">全部 ' + this.problems.length + '</button>' +
        '<button class="mini-btn" data-filter="error">错误 ' + errors + '</button>' +
        '<button class="mini-btn" data-filter="warning">警告 ' + warnings + '</button>' +
        '<button class="mini-btn" data-action="analyze" style="margin-left:auto">重新分析</button>';
      const list = this.problems
        .filter((p) => this.filter === 'all' || p.severity === this.filter)
        .slice()
        .sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) ||
          String(a.file).localeCompare(String(b.file)) || (a.line || 0) - (b.line || 0));
      this.el.problemList.innerHTML = list.length ? list.map((d) => {
        const sev = d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info';
        const ic = sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : 'info';
        const loc = d.file ? d.file + (d.line ? ':' + d.line + ':' + (d.column || 1) : '') : '工程';
        return '<div class="problem-row ' + sev + '" data-file="' + esc(d.file || '') + '" data-line="' + (d.line || 0) + '" data-col="' + (d.column || 1) + '">' +
          icon(ic) + '<span class="problem-msg">' + esc(d.message) + '</span>' +
          '<span class="problem-code">' + esc(d.code || d.source || '') + '</span>' +
          '<span class="problem-loc">' + esc(loc) + '</span></div>';
      }).join('') : '<div class="empty-state">没有发现问题</div>';
      CC.bus.emit('problem-counts', { errors, warnings });
    }

    outputHtml(result) {
      const lines = [];
      lines.push('<span class="dim"># CodeCpp 构建输出 · ' + CC.util.now() + '</span>');
      if (result.command) lines.push('<span class="cmd">$ ' + esc(result.command) + '</span>');
      if (result.mode) lines.push('<span class="dim">模式: ' + esc(result.mode) + ' · 耗时 ' + (result.duration || 0) + ' ms</span>');
      if (result.output) {
        String(result.output).split(/\r?\n/).forEach((line) => {
          const cls = /\b(error|fatal error|undefined reference|错误)\b/i.test(line) ? 'err' :
            /^\s*(?:.*\^~*|.*\d+\s*\|)/.test(line) ? 'dim' : '';
          lines.push(cls ? '<span class="' + cls + '">' + esc(line) + '</span>' : esc(line));
        });
      }
      if (!result.pending) {
        lines.push(result.ok
          ? '<span class="ok-line">构建成功' + (result.program ? ' · 产物 ' + esc(result.program) : '') + '</span>'
          : '<span class="err">构建失败' + (result.diagnostics && result.diagnostics.length ? ' · ' + result.diagnostics.length + ' 条诊断' : '') + '</span>');
      }
      return lines.join('\n');
    }

    setOutput(result) { this.el.output.innerHTML = this.outputHtml(result || {}); this.el.output.scrollTop = this.el.output.scrollHeight; }

    async build(options) {
      await CC.editor.saveAll();
      this.activate('output');
      this.setOutput({ pending: true, command: '准备构建…', output: '' });
      CC.app.setBusy(true, '正在构建…');
      try {
        const response = await CC.api.build(options || {});
        const result = response.result;
        this.setOutput(result);
        CC.editor.setCompilerDiagnostics(result.diagnostics || []);
        if (result.program) CC.state.lastProgram = result.program;
        CC.state.lastBuild = result;
        if (result.missingToolchain) {
          CC.app.toast('未检测到 C 编译器，可在「工具 → 安装 / 管理编译器」一键安装', 'warn');
          this.activate('output');
          CC.app.status('工具链未就绪', 'bad');
        } else {
          CC.app.toast(result.ok ? '构建成功 · ' + (result.program || '') : '构建失败，请查看问题面板', result.ok ? 'success' : 'error');
          CC.app.status(result.ok ? '构建完成' : '构建失败', result.ok ? '' : 'bad');
        }
        return result;
      } catch (error) {
        this.setOutput({ ok: false, output: error.message });
        CC.app.toast(error.message, 'error');
        return { ok: false };
      } finally { CC.app.setBusy(false); }
    }

    async run() {
      const args = this.el.runArgs.value, stdin = this.el.runStdin.value;
      this.activate('run');
      this.el.runView.innerHTML = '<span class="dim">正在运行…</span>';
      CC.app.setBusy(true, '正在运行程序…');
      try {
        const response = await CC.api.run({
          args, stdin, program: CC.state.lastProgram || undefined
        });
        const r = response.result;
        const lines = ['<span class="cmd">$ ' + esc(r.program || 'app') + (args ? ' ' + esc(args) : '') + '</span>'];
        if (stdin) lines.push('<span class="dim">stdin << ' + esc(stdin) + '</span>');
        if (r.stdout) lines.push(esc(r.stdout));
        if (r.stderr) lines.push('<span class="err">' + esc(r.stderr) + '</span>');
        lines.push('<span class="' + (r.ok ? 'ok-line' : 'err') + '">' + esc(r.exitText || '') + ' · 耗时 ' + (r.duration || 0) + ' ms</span>');
        this.el.runView.innerHTML = lines.join('\n');
        CC.app.status(r.ok ? '运行结束 · 退出码 0' : '程序运行失败', r.ok ? '' : 'bad');
        return r;
      } catch (error) {
        this.el.runView.innerHTML = '<span class="err">' + esc(error.message) + '</span>';
        CC.app.toast(error.message, 'error');
        return null;
      } finally { CC.app.setBusy(false); }
    }

    async buildAndRun() {
      const result = await this.build();
      if (result && result.ok) return this.run();
      return null;
    }

    appendTerminal(html, container) {
      container.insertAdjacentHTML('beforeend', html);
      container.scrollTop = container.scrollHeight;
    }

    async terminalCommand(command) {
      const cmd = String(command || '').trim();
      if (!cmd) return;
      this.termCommands.push(cmd); this.termIndex = 0;
      this.appendTerminal('<div class="term-entry"><span class="term-cmd">' + esc(cmd) + '</span></div>', this.el.termHistory);
      if (cmd === 'help' || cmd === '?') {
        this.appendTerminal('<div class="term-entry"><span class="term-out">CodeCpp 集成终端 · 命令在本机工作区目录中执行。\n常用：dir / ls、gcc --version、make、cmake --build build、clang --version、echo ...\n提示：构建与运行请使用「输出 / 运行」面板或 Ctrl+B / F5。</span></div>', this.el.termHistory);
        return;
      }
      try {
        const response = await CC.api.terminal(cmd);
        const result = response.result || response;
        this.appendTerminal('<div class="term-entry"><span class="' + (result.code === 0 ? 'term-out' : 'term-err') + '">' + esc(result.output) + '</span>' +
          '<span class="term-meta"> · 退出码 ' + result.code + ' · ' + result.duration + ' ms</span></div>', this.el.termHistory);
      } catch (error) {
        this.appendTerminal('<div class="term-entry"><span class="term-err">' + esc(error.message) + '</span></div>', this.el.termHistory);
      }
    }

    async debugCommand(command) {
      const cmd = String(command || '').trim();
      if (!cmd) return;
      this.debugCommands.push(cmd); this.debugIndex = 0;
      this.appendTerminal('<div class="term-entry"><span class="term-cmd">' + esc(cmd) + '</span></div>', this.el.debugConsole);
      try {
        const result = await CC.api.debug.command('raw', cmd);
        CC.bus.emit('debug-state', result.state);
        CC.app.toast('gdb 命令已执行', 'info');
      } catch (error) {
        this.appendTerminal('<div class="term-entry"><span class="term-err">' + esc(error.message) + '</span></div>', this.el.debugConsole);
      }
    }

    renderDebugConsole(lines) {
      if (!Array.isArray(lines)) return;
      const keep = this.el.debugConsole.innerHTML;
      const commands = keep.match(/<span class="term-cmd">[^<]*<\/span>/g) || [];
      const tail = lines.slice(-60).map((line) => '<div class="term-entry"><span class="term-out">' + esc(line) + '</span></div>').join('');
      this.el.debugConsole.innerHTML = commands.map((c) => '<div class="term-entry">' + c + '</div>').join('') + tail;
      this.el.debugConsole.scrollTop = this.el.debugConsole.scrollHeight;
    }
  }

  CC.Panels = Panels;
})();
