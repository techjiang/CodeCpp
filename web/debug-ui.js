/* CodeCpp · 调试侧栏与 gdb 会话控制 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;
  const icon = CC.util.icon;
  const byId = (id) => document.getElementById(id);

  const CONTROLS = [
    { action: 'start', title: '开始调试 (F5 调试)', icon: 'play', label: '启动' },
    { action: 'continue', title: '继续 (F5)', icon: 'debug' },
    { action: 'next', title: '单步跳过 (F10)', icon: 'step' },
    { action: 'step', title: '单步步入 (F11)', icon: 'step-in' },
    { action: 'finish', title: '步出 (Shift+F11)', icon: 'step-out' },
    { action: 'stop', title: '停止调试', icon: 'stop' }
  ];

  function relative(path) {
    if (!path) return '';
    const p = String(path).replace(/\\/g, '/');
    const root = String(CC.state.root || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (root && p.toLowerCase().startsWith(root.toLowerCase())) return p.slice(root.length).replace(/^\//, '');
    return CC.util.basename(p);
  }

  class DebugController {
    constructor() {
      this.el = {
        controls: byId('debug-controls'), status: byId('debug-status'), frame: byId('debug-frame'),
        bpList: byId('breakpoint-list'), bpCount: byId('bp-count'),
        stack: byId('call-stack'), vars: byId('variable-list'),
        watchInput: byId('watch-input'), watchAdd: byId('watch-add'), watchList: byId('watch-list'),
        badge: byId('debug-badge')
      };
      this.state = { active: false, frames: [], variables: [], breakpoints: [], console: [] };
      this.watches = new Map();
      this.busy = false;
      this.bind();
      CC.bus.on('breakpoints', (list) => this.renderBreakpoints(list));
      CC.bus.on('debug-state', (state) => this.applyState(state));
      CC.bus.on('problem-counts', () => {});
    }

    init() {
      this.renderControls();
      this.renderBreakpoints(CC.editor.getBreakpoints());
      this.renderState();
      CC.api.debug.available().then((result) => {
        this.available = result.available;
        if (!result.available) this.el.status.innerHTML = '<span class="muted">未检测到 gdb，安装编译器后即可调试。</span>';
      }).catch(() => {});
    }

    bind() {
      this.el.controls.addEventListener('click', (event) => {
        const button = event.target.closest('[data-dbg]');
        if (!button || button.disabled) return;
        const action = button.dataset.dbg;
        if (action === 'start') this.start();
        else if (action === 'stop') this.stop();
        else this.command(action);
      });
      this.el.bpList.addEventListener('click', (event) => {
        const remove = event.target.closest('[data-remove]');
        const row = event.target.closest('[data-file]');
        if (remove && row) {
          CC.editor.clearBreakpoint(row.dataset.file, Number(row.dataset.line));
          if (this.state.active) {
            const bp = (this.state.breakpoints || []).find((b) => relative(b.file) === row.dataset.file && b.line === Number(row.dataset.line));
            if (bp) this.command('removeBreak', { number: bp.number });
          }
          return;
        }
        if (row) CC.editor.goto(row.dataset.file, Number(row.dataset.line), 1);
      });
      this.el.stack.addEventListener('click', (event) => {
        const row = event.target.closest('[data-file]');
        if (row) CC.editor.goto(row.dataset.file, Number(row.dataset.line), 1);
      });
      this.el.watchAdd.addEventListener('click', () => this.addWatch());
      this.el.watchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') this.addWatch(); });
      this.el.vars.addEventListener('click', (event) => {
        const row = event.target.closest('[data-expr]');
        if (row) this.addWatch(row.dataset.expr);
      });
    }

    renderControls() {
      const active = Boolean(this.state.active);
      this.el.controls.innerHTML = CONTROLS.map((c) => {
        const disabled = c.action === 'start' ? active : (!active || (this.busy && c.action !== 'stop'));
        return '<button class="dbg-btn ' + (c.action === 'start' ? 'primary' : '') + '" data-dbg="' + c.action + '" title="' + esc(c.title) + '"' + (disabled ? ' disabled' : '') + '>' +
          icon(c.icon) + '</button>';
      }).join('');
      this.el.badge.hidden = !active;
    }

    renderBreakpoints(list) {
      const bps = Array.isArray(list) ? list : [];
      this.el.bpCount.textContent = bps.length;
      this.el.bpList.innerHTML = bps.length ? bps
        .slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
        .map((b) => '<div class="small-row" data-file="' + esc(b.file) + '" data-line="' + b.line + '" title="点击跳转">' +
          '<span class="bp-dot"></span><span class="k">' + esc(b.file) + ':' + b.line + '</span>' +
          '<span class="muted" data-remove title="删除断点">' + icon('close') + '</span></div>').join('')
        : '<div class="empty-state" style="padding:8px 4px">在编辑器行号左侧点击或按 F9 设置断点</div>';
    }

    applyState(state) {
      if (!state) return;
      this.state = state;
      this.renderState();
      CC.bus.emit('debug-console', state.console || []);
      const frame = (state.frames && state.frames[0]) || (state.stopped && state.stopped.frame);
      if (frame && (frame.fullname || frame.file) && frame.line) {
        const file = relative(frame.fullname || frame.file);
        CC.editor.setDebugFrame(file, Number(frame.line));
        CC.editor.goto(file, Number(frame.line), 1);
      } else CC.editor.setDebugFrame(null, null);
    }

    renderState() {
      const s = this.state;
      this.renderControls();
      if (!s.active) {
        this.el.status.innerHTML = this.available === false
          ? '<span class="muted">未检测到 gdb，调试功能暂不可用</span>'
          : '未启动调试会话 · 点击播放按钮或按 F5 启动';
        this.el.frame.innerHTML = '<div class="empty-state" style="padding:6px 0">—</div>';
        this.el.stack.innerHTML = '<div class="empty-state" style="padding:6px 0">—</div>';
        this.el.vars.innerHTML = '<div class="empty-state" style="padding:6px 0">—</div>';
        return;
      }
      const stopped = s.stopped;
      const frame = (s.frames && s.frames[0]) || (stopped && stopped.frame) || {};
      const reason = stopped ? ({ 'breakpoint-hit': '命中断点', 'end-stepping-range': '单步完成', 'function-finished': '函数返回', 'exited-normally': '程序结束', 'signal-received': '收到信号' }[stopped.reason] || stopped.reason) : '运行中';
      this.el.status.innerHTML = '<span style="color:var(--accent)">' + esc(reason || '已启动') + '</span>' +
        (stopped && stopped.signal ? ' · <span style="color:var(--danger)">' + esc(stopped.signal) + '</span>' : '');
      const loc = frame.func ? frame.func + '()' : '当前帧';
      const file = relative(frame.fullname || frame.file);
      this.el.frame.innerHTML = '<div class="small-row"><span class="k">' + esc(loc) + '</span><span class="v">' + esc(file) + ':' + (frame.line || 0) + '</span></div>';
      this.el.stack.innerHTML = (s.frames || []).length ? s.frames.map((f) =>
        '<div class="small-row" data-file="' + esc(relative(f.fullname || f.file)) + '" data-line="' + (f.line || 1) + '">' +
        '<span class="muted">#' + f.level + '</span><span class="k">' + esc(f.func || '??') + '</span>' +
        '<span class="v">' + esc(relative(f.fullname || f.file) || f.addr || '') + ':' + (f.line || 0) + '</span></div>'
      ).join('') : '<div class="empty-state" style="padding:6px 0">—</div>';
      this.el.vars.innerHTML = (s.variables || []).length ? s.variables.map((v) =>
        '<div class="small-row" data-expr="' + esc(v.name) + '" title="点击加入监视"><span class="k">' + esc(v.name) + '</span>' +
        '<span class="muted">' + esc(v.type || '') + '</span><span class="v">' + esc(String(v.value)) + '</span></div>'
      ).join('') : '<div class="empty-state" style="padding:6px 0">当前帧无局部变量</div>';
      if (s.breakpoints && s.breakpoints.length) {
        this.el.bpCount.textContent = s.breakpoints.length;
      }
      this.renderWatches();
    }

    async start() {
      const cfg = CC.state.bootstrap.capabilities;
      if (!cfg.compiler) {
        CC.app.toast('请先点击工具栏「安装编译器」一键安装 MinGW-w64', 'warn');
        CC.app.switchView('settings');
        return;
      }
      const gdb = await CC.api.debug.available();
      if (!gdb.available) {
        CC.app.toast('未检测到 gdb，可点击「安装编译器」一键安装', 'warn');
        CC.app.execute('installCompiler');
        return;
      }
      await CC.editor.saveAll();
      if (!CC.state.lastProgram || CC.editor.active() && CC.editor.active().modified) {
        const built = await CC.panels.build();
        if (!built || !built.ok) return;
      } else if (!CC.state.lastBuild || !CC.state.lastBuild.ok) {
        const built = await CC.panels.build();
        if (!built || !built.ok) return;
      }
      const program = CC.state.lastProgram || CC.state.settings.build.output;
      CC.app.setBusy(true, '正在启动 gdb…');
      try {
        const result = await CC.api.debug.start({
          program, breakpoints: CC.editor.getBreakpoints(),
          args: CC.panels.el.runArgs.value
        });
        this.applyState(result.state);
        CC.app.switchView('debug');
        CC.panels.activate('debugConsole');
        CC.app.status('调试会话已启动', '');
        CC.app.toast('gdb 已启动', 'success');
      } catch (error) {
        CC.app.toast(error.message, 'error');
        CC.panels.activate('output');
        CC.panels.setOutput({ ok: false, output: error.message + '\n\n' + (CC.state.bootstrap.guide || '') });
      } finally { CC.app.setBusy(false); }
    }

    async command(action, argument) {
      if (!this.state.active && action !== 'removeBreak') {
        CC.app.toast('请先启动调试会话', 'warn');
        return;
      }
      this.busy = true; this.renderControls();
      try {
        const result = await CC.api.debug.command(action, argument);
        this.applyState(result.state);
        if (result.state && result.state.message) CC.app.toast(result.state.message, 'info');
      } catch (error) { CC.app.toast(error.message, 'error'); }
      finally { this.busy = false; this.renderControls(); }
    }

    async stop() {
      try { await CC.api.debug.stop(); } catch (_) {}
      this.state = { active: false, frames: [], variables: [], breakpoints: [], console: [] };
      this.applyState(this.state);
      CC.editor.setDebugFrame(null, null);
      CC.app.status('调试会话已停止');
    }

    async restart() { await this.stop(); return this.start(); }

    async addWatch(expression) {
      const expr = String(expression === undefined ? this.el.watchInput.value : expression).trim();
      if (!expr) return;
      if (expression === undefined) this.el.watchInput.value = '';
      this.watches.set(expr, '…');
      this.renderWatches();
      if (!this.state.active) { this.watches.set(expr, '需先启动调试'); this.renderWatches(); return; }
      try {
        const result = await CC.api.debug.command('evaluate', expr);
        this.watches.set(expr, result.state.evaluation || '(无值)');
        this.applyState(result.state);
      } catch (error) { this.watches.set(expr, error.message); }
      this.renderWatches();
    }

    renderWatches() {
      this.el.watchList.innerHTML = this.watches.size ? Array.from(this.watches.entries()).map(([expr, value]) =>
        '<div class="small-row"><span class="k">' + esc(expr) + '</span><span class="v">' + esc(String(value)) + '</span></div>'
      ).join('') : '<div class="empty-state" style="padding:6px 0">输入表达式后按 Enter</div>';
    }
  }

  CC.DebugController = DebugController;
})();
