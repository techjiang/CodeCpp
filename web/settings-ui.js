/* CodeCpp · 设置与工具链管理视图 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;
  const icon = CC.util.icon;

  const THEME_CARDS = [['dark', '黑色'], ['light', '白色'], ['contrast', '纯黑']];
  const STANDARDS = ['c89', 'c99', 'c11', 'c17', 'c2x', 'gnu11', 'gnu17'];

  const themePicker = (current) => '<div class="theme-row">' + THEME_CARDS.map(([id, name]) =>
    '<button type="button" class="theme-card' + (current === id ? ' active' : '') + '" data-theme-pick="' + id + '">' +
    '<span class="theme-swatch" data-swatch="' + id + '"></span><span>' + name + '</span></button>'
  ).join('') + '</div>';

  class SettingsUI {
    constructor() {
      this.el = document.getElementById('settings-form');
      this.bind();
    }

    bind() {
      this.el.addEventListener('change', (event) => {
        const target = event.target;
        const key = target.dataset.setting;
        if (!key) return;
        let value = target.type === 'checkbox' ? target.checked : target.value;
        if (target.dataset.number) value = Number(value) || Number(target.dataset.number);
        const patch = {};
        if (key === 'activeToolchain') { this.activate(value); return; }
        if (key === 'envPath') {
          patch.envPath = String(value).split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
        } else if (key.includes('.')) {
          const [group, field] = key.split('.');
          patch[group] = Object.assign({}, CC.state.settings[group] || {});
          patch[group][field] = value;
        } else patch[key] = value;
        CC.app.applySettings(patch);
      });
      this.el.addEventListener('click', (event) => {
        const themePick = event.target.closest('[data-theme-pick]');
        if (themePick) { CC.app.applySettings({ theme: themePick.dataset.themePick }); return; }
        const pick = event.target.closest('[data-pick]');
        if (pick) {
          const group = pick.dataset.pick;
          const patch = {};
          patch[group] = Object.assign({}, CC.state.settings[group] || {}, { path: pick.dataset.path });
          CC.app.applySettings(patch);
          CC.app.toast('已选用 ' + CC.util.basename(pick.dataset.path), 'success');
          setTimeout(() => CC.app.detectToolchain(), 250);
          return;
        }
        const action = event.target.closest('[data-settings-action]');
        if (!action) return;
        if (action.dataset.settingsAction === 'detect') this.detect();
        if (action.dataset.settingsAction === 'probe') this.probe();
        if (action.dataset.settingsAction === 'save-env') this.saveEnv();
        if (action.dataset.settingsAction === 'clear-env') this.activate('');
      });
    }

    async detect() {
      CC.app.setBusy(true, '正在检测 C 工具链…');
      try { await CC.app.detectToolchain(); this.render(); CC.app.toast('工具链检测完成', 'success'); }
      catch (error) { CC.app.toast(error.message, 'error'); }
      finally { CC.app.setBusy(false); }
    }

    async probe() {
      const input = this.el.querySelector('[data-setting="compiler.path"]');
      const path = input && input.value.trim();
      if (!path) { CC.app.toast('请先填写编译器路径', 'warn'); return; }
      try {
        const result = await CC.api.probe(path);
        CC.app.toast(result.found ? '编译器可用：' + result.info.version : '该路径不可执行：' + path, result.found ? 'success' : 'error');
        if (result.found) CC.app.detectToolchain();
      } catch (error) { CC.app.toast(error.message, 'error'); }
    }

    render() {
      const s = CC.state.settings;
      const t = CC.state.bootstrap.toolchain || {};
      const groups = [
        this.group('外观', [
          themePicker(s.theme),
          this.number('fontSize', '编辑器字号', s.fontSize, 10, 24),
          this.check('minimap', '显示代码缩略图', s.minimap)
        ]),
        this.group('环境（编译器集）', [
          this.select('activeToolchain', '当前环境', this.envOptions(), s.activeToolchain || ''),
          this.text('envPath', '附加 PATH', (s.envPath || []).join('; ')),
          '<div class="settings-row"><label>环境名称</label><input type="text" id="env-set-name" placeholder="例如：MinGW-w64 12.2" spellcheck="false"></div>',
          '<div class="settings-row" style="gap:8px;flex-wrap:wrap">' +
            '<button class="mini-btn" data-settings-action="save-env">保存当前为环境</button>' +
            '<button class="mini-btn" data-settings-action="clear-env">恢复自动检测</button></div>',
          '<div class="env-note">参照 Dev-C++ 的「编译器集」：一套环境包含 gcc / gdb / make 与附加目录，切换即整组生效；附加目录只作用于 CodeCpp 启动的编译、调试与终端进程，不修改系统 PATH。</div>'
        ]),
        this.group('编辑器', [
          this.select('tabSize', 'Tab 宽度', [['2', '2 空格'], ['4', '4 空格'], ['8', '8 空格']], String(s.tabSize)),
          this.check('insertSpaces', '使用空格代替制表符', s.insertSpaces !== false),
          this.check('autoSave', '自动保存', Boolean(s.autoSave))
        ]),
        this.group('构建与运行', [
          this.select('build.mode', '构建模式', [['auto', '自动（推荐）'], ['single', '单文件'], ['multi', '所有 .c 文件'], ['make', 'Makefile'], ['cmake', 'CMake']], s.build.mode),
          this.text('build.output', '输出文件', s.build.output),
          this.select('compiler.standard', 'C 标准', STANDARDS.map((x) => [x, x]), s.compiler.standard),
          this.text('compiler.flags', '编译参数', s.compiler.flags),
          this.text('compiler.linkerFlags', '链接参数', s.compiler.linkerFlags),
          this.text('build.args', '运行参数', s.build.args),
          this.text('build.stdin', '标准输入', s.build.stdin)
        ]),
        this.group('工具链路径', [
          this.text('compiler.path', 'C 编译器 (gcc/clang)', s.compiler.path || t.selected && t.selected.compiler || ''),
          this.text('debugger.path', '调试器 (gdb)', s.debugger.path || t.selected && t.selected.debugger || ''),
          this.text('make.path', 'make', s.make.path || t.tools && t.tools.make && t.tools.make.path || ''),
          this.text('cmake.path', 'cmake', s.cmake.path || t.tools && t.tools.cmake && t.tools.cmake.path || '')
        ])
      ].join('');
      const candidates = this.candidates('编译器', 'compiler', t.compilers || []) +
        this.candidates('调试器', 'debugger', t.debuggers || []);
      const buttons = '<div class="settings-row" style="gap:8px;flex-wrap:wrap">' +
        '<button class="mini-btn" data-settings-action="detect">' + icon('refresh') + ' 重新检测工具链</button>' +
        '<button class="mini-btn" data-settings-action="probe">验证编译器路径</button></div>';
      const summary = '<div class="toolchain-card ' + (t.ready ? 'ok' : '') + '">' +
        '<div class="row"><b>' + (t.ready ? '工具链已就绪' : '工具链未就绪') + '</b><span class="muted">' + esc(t.platform || '') + '</span></div>' +
        '<div class="row">编译器 <code>' + esc(t.selected && t.selected.compiler || '未检测到') + '</code></div>' +
        '<div class="row">调试器 <code>' + esc(t.selected && t.selected.debugger || '未检测到') + '</code></div>' +
        '<div class="row">构建工具 <code>' + esc([t.tools && t.tools.make && 'make', t.tools && t.tools.cmake && 'cmake'].filter(Boolean).join(' / ') || '未检测到') + '</code></div></div>';
      this.el.innerHTML = groups + this.environmentCard() + summary + buttons +
        '<div class="section-title">探测到的可执行文件</div>' + candidates +
        '<div class="section-title">安装指引</div><pre class="guide">' + esc(CC.state.bootstrap.guide || '') + '</pre>';
    }

    envOptions() {
      const env = CC.state.environment || {};
      const options = [['', '自动检测（系统 PATH）']];
      (env.profiles || []).forEach((p) => {
        const suffix = p.auto ? ' · 检测到' : '';
        const missing = p.compiler ? '' : ' · 缺 gcc';
        options.push([p.id, p.name + suffix + missing]);
      });
      return options;
    }

    environmentCard() {
      const t = CC.state.bootstrap.toolchain || {};
      const env = CC.state.environment || {};
      const active = (env.profiles || []).find((p) => p.id === env.activeId);
      const sel = t.selected || {};
      const dirs = (env.pathDirs || []).join('; ') || '继承系统 PATH';
      return '<div class="toolchain-card ' + (t.ready ? 'ok' : '') + '">' +
        '<div class="row"><b>' + esc(active ? active.name : '自动检测') + '</b>' +
        '<span class="muted">' + (t.ready ? '可用' : '未就绪') + '</span></div>' +
        '<div class="row">gcc <code>' + esc(sel.compiler || '未检测到') + '</code></div>' +
        '<div class="row">gdb <code>' + esc(sel.debugger || '未检测到') + '</code></div>' +
        '<div class="row">PATH <code>' + esc(dirs) + '</code></div></div>';
    }

    activate(id) {
      const env = CC.state.environment || {};
      const patch = {};
      if (id) {
        const chosen = (env.profiles || []).find((p) => p.id === id);
        if (!chosen) return;
        if (chosen.auto) {
          const saved = Object.assign({}, chosen, { id: 'set-' + Date.now() });
          delete saved.auto; delete saved.saved;
          patch.toolchains = (CC.state.settings.toolchains || []).concat([saved]);
          patch.activeToolchain = saved.id;
        } else patch.activeToolchain = id;
      } else patch.activeToolchain = '';
      CC.app.applySettings(patch);
      CC.app.toast(id ? '已切换编译器集' : '已恢复自动检测', 'success');
      setTimeout(() => CC.app.detectToolchain(), 200);
    }

    saveEnv() {
      const input = this.el.querySelector('#env-set-name');
      const name = (input && input.value.trim()) || '自定义环境';
      const sel = (CC.state.bootstrap.toolchain || {}).selected || {};
      const dirs = (CC.state.environment || {}).pathDirs || [];
      const set = {
        id: 'set-' + Date.now(), name,
        compiler: sel.compiler || '', debugger: sel.debugger || '',
        make: sel.make || '', cmake: sel.cmake || '',
        binDirs: dirs.slice(0, 4)
      };
      CC.app.applySettings({
        toolchains: (CC.state.settings.toolchains || []).concat([set]),
        activeToolchain: set.id
      });
      CC.app.toast('已保存环境：' + name, 'success');
      setTimeout(() => CC.app.detectToolchain(), 200);
    }

    group(title, rows) {
      return '<div class="settings-group"><div class="section-title">' + esc(title) + '</div>' + rows.join('') + '</div>';
    }
    row(label, control, tip) {
      return '<div class="settings-row"><label>' + esc(label) + '</label>' + control +
        (tip ? '<span class="tip">' + esc(tip) + '</span>' : '') + '</div>';
    }
    text(key, label, value) {
      return this.row(label, '<input type="text" data-setting="' + key + '" value="' + esc(value || '') + '" spellcheck="false">');
    }
    number(key, label, value, min, max) {
      return this.row(label, '<input type="number" data-setting="' + key + '" data-number="' + value + '" min="' + min + '" max="' + max + '" value="' + esc(value) + '">');
    }
    check(key, label, checked) {
      return this.row(label, '<input type="checkbox" data-setting="' + key + '"' + (checked ? ' checked' : '') + '>');
    }
    select(key, label, options, value) {
      return this.row(label, '<select data-setting="' + key + '">' + options.map(([v, text]) =>
        '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(text) + '</option>'
      ).join('') + '</select>');
    }
    candidates(title, group, list) {
      if (!list || !list.length) return '<div class="empty-state" style="padding:8px 12px">' + esc(title) + '：未探测到</div>';
      return '<div class="settings-row" style="display:block"><label style="width:auto;display:block;margin-bottom:5px">' + esc(title) + '</label>' +
        list.slice(0, 6).map((item) => '<div class="toolchain-card" style="margin:0 0 5px"><div class="row">' +
          '<code title="' + esc(item.path) + '">' + esc(item.path) + '</code>' +
          '<button class="mini-btn" data-pick="' + group + '" data-path="' + esc(item.path) + '">选用</button></div>' +
          '<div class="row"><span class="muted">' + esc(item.version || '') + '</span></div></div>').join('') + '</div>';
    }
  }

  CC.SettingsUI = SettingsUI;
})();
