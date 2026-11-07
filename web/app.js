/* CodeCpp · 应用外壳：命令、快捷键、菜单、面板与生命周期 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;
  const icon = CC.util.icon;
  const byId = (id) => document.getElementById(id);

  CC.state = {
    root: '', rootName: '', settings: {}, bootstrap: {},
    lastProgram: '', lastBuild: null, fileCache: [],
    desktop: null, desktopInfo: null
  };

  const MENU_NAMES = {
    file: '文件', edit: '编辑', search: '搜索', view: '视图', project: '项目',
    run: '运行', debug: '调试', tools: '工具', help: '帮助'
  };
  const MENU_LAYOUT = {
    file: ['newFile', 'newFolder', 'openFolder', 'quickOpen', '-', 'save', 'saveAll', '-', 'closeTab'],
    edit: ['format', 'analyze', '-', 'gotoLine', '-', 'toggleTheme'],
    search: ['find', 'replace', 'quickOpen', '-', 'showSearch', 'nextProblem'],
    view: ['showExplorer', 'showOutline', 'showTemplates', 'showDebug', '-', 'showProblems', 'toggleSidebar', 'togglePanel', '-', 'welcome'],
    project: ['openFolder', 'showTemplates', '-', 'build', 'buildAndRun', '-', 'showSettings'],
    run: ['build', 'run', 'buildAndRun', '-', 'terminal', 'showOutput', 'cleanOutput', '-', 'stopDebug'],
    debug: ['startDebug', 'debugContinue', 'debugStepOver', 'debugStepInto', 'debugStepOut', '-', 'toggleBreakpoint', 'stopDebug', 'restartDebug', '-', 'showDebug'],
    tools: ['installCompiler', 'showSettings', 'detectToolchain', '-', 'analyze', 'format', '-', 'toggleTheme'],
    help: ['showHelp', 'about']
  };
  const ALWAYS_ON_KEYS = new Set(['save', 'commandPalette', 'showHelp']);

  function groupOf(command) {
    for (const key of Object.keys(MENU_LAYOUT)) {
      if (MENU_LAYOUT[key].includes(command.id)) return MENU_NAMES[key];
    }
    return command.group;
  }

  function setupDesktop(app) {
    const bridge = window.CCDesktop;
    if (!bridge || !bridge.isDesktop) return;
    CC.state.desktop = bridge;
    document.body.classList.add('is-desktop');
    byId('window-controls').addEventListener('click', (event) => {
      const button = event.target.closest('[data-win]');
      if (button) bridge.window(button.dataset.win);
    });
    const applyWindowState = (state) => {
      if (!state) return;
      const button = byId('win-maximize');
      button.classList.toggle('is-max', Boolean(state.maximized || state.fullscreen));
      button.title = state.fullscreen ? '退出全屏' : (state.maximized ? '向下还原' : '最大化');
      document.body.classList.toggle('is-fullscreen', Boolean(state.fullscreen));
    };
    bridge.onWindowState(applyWindowState);
    if (bridge.getWindowState) bridge.getWindowState().then(applyWindowState).catch(() => {});
    bridge.onCommand((id) => app.execute(id));
    bridge.info().then((info) => { CC.state.desktopInfo = info; }).catch(() => {});
    const brand = document.querySelector('.brand-text');
    if (brand) brand.title = 'CodeCpp 桌面应用';

    const reportDirty = () => {
      if (bridge.reportDirty && CC.editor) bridge.reportDirty(CC.editor.dirtyCount());
    };
    ['editor-change', 'tab-changed', 'file-saved', 'dirty-count'].forEach((name) => CC.bus.on(name, reportDirty));
    window.setInterval(reportDirty, 1500);
    if (bridge.onSaveAll) {
      bridge.onSaveAll(async () => {
        await CC.editor.saveAll();
        reportDirty();
      });
    }
    window.addEventListener('beforeunload', (event) => {
      if (!CC.editor || !CC.editor.dirtyCount()) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  const THEME_NAMES = { dark: '黑色', light: '白色', contrast: '纯黑' };
  const VIEW_NAMES = {
    explorer: '资源管理器', search: '搜索', outline: '符号大纲', templates: '项目模板',
    debug: '运行和调试', settings: '设置', help: '帮助'
  };

  const app = CC.app = {
    commands: new Map(),
    paletteItems: [],
    paletteIndex: 0,
    paletteMode: 'command',
    activeView: 'explorer',
    busy: false,

    async init() {
      let bootstrap;
      try { bootstrap = await CC.api.bootstrap(); }
      catch (error) {
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#f47186">' +
          '<h2>CodeCpp 服务未就绪</h2><p>' + esc(error.message) + '</p>' +
          '<p>请在项目根目录执行 <code>node server/index.js</code> 后刷新页面。</p></div>';
        return;
      }
      CC.state.bootstrap = bootstrap;
      CC.state.settings = bootstrap.settings;
      CC.state.environment = bootstrap.environment || { profiles: [], activeId: '', pathDirs: [] };
      CC.state.root = bootstrap.root;
      CC.state.rootName = bootstrap.rootName;
      this.applyTheme();
      setupDesktop(this);
      this.registerCommands();
      this.registerBus();
      this.bindUI();

      CC.editor = new CC.Editor();
      CC.editor.loadBreakpoints(CC.state.settings.breakpoints || []);
      CC.explorer = new CC.Explorer();
      CC.panels = new CC.Panels();
      CC.debug = new CC.DebugController();
      CC.settingsUI = new CC.SettingsUI();

      CC.explorer.init(bootstrap);
      CC.panels.init();
      CC.debug.init();
      CC.settingsUI.render();
      CC.compilerUI = new CC.CompilerUI();
      CC.compilerUI.init();
      this.renderHelp();
      this.renderRecent();
      this.renderToolchain();
      this.renderStatus();

      CC.api.events((message) => {
        if (message.type === 'fs-change') this.onWorkspaceChange(message);
      });
      try {
        const result = await CC.api.files();
        CC.state.fileCache = result.files || [];
      } catch (_) {}
      const files = CC.state.fileCache;
      const initial = files.find((f) => f.path === 'main.c') || files.find((f) => /\.c$/.test(f.path));
      if (initial) await CC.editor.open(initial.path);
      else CC.editor.showWelcome();
      if (!bootstrap.capabilities.compiler) {
        this.toast('未检测到 C 编译器：点击「安装编译器」可一键安装 MinGW-w64', 'warn');
      }
      this.status('就绪');
    },

    registerCommands() {
      const defs = [
        { id: 'newFile', title: '新建 C 文件', key: 'Alt+N', group: '文件', icon: 'plus', run: () => CC.explorer.create('file') },
        { id: 'newFolder', title: '新建文件夹', group: '文件', icon: 'folder', run: () => CC.explorer.create('folder') },
        { id: 'openFolder', title: '打开文件夹…', key: 'Alt+O', group: '文件', icon: 'folder-open', run: () => CC.explorer.openFolder() },
        { id: 'quickOpen', title: '快速打开文件', key: 'Ctrl+P', group: '文件', icon: 'search', run: () => this.quickOpen() },
        { id: 'save', title: '保存', key: 'Ctrl+S', group: '文件', icon: 'save', run: () => CC.editor.save() },
        { id: 'saveAll', title: '全部保存', group: '文件', icon: 'save', run: () => CC.editor.saveAll() },
        { id: 'closeTab', title: '关闭当前编辑器', key: 'Alt+W', group: '文件', icon: 'close', run: () => CC.editor.active() && CC.editor.close(CC.editor.activeId) },
        { id: 'find', title: '查找', key: 'Ctrl+F', group: '编辑', icon: 'search', run: () => { CC.editor.openFind(false); if (!CC.editor.active()) this.toast('请先打开文件', 'warn'); } },
        { id: 'replace', title: '查找并替换', key: 'Ctrl+H', group: '编辑', icon: 'edit', run: () => CC.editor.openFind(true) },
        { id: 'gotoLine', title: '跳转到行…', key: 'Ctrl+G', group: '编辑', icon: 'list', run: () => this.gotoLine() },
        { id: 'format', title: '格式化文档（重排缩进）', key: 'Ctrl+Shift+I', group: '编辑', icon: 'braces', run: () => CC.editor.format() },
        { id: 'analyze', title: '重新进行静态分析', key: 'Alt+A', group: '编辑', icon: 'search', run: () => { CC.editor.analyze(); this.toast('静态分析已刷新', 'info'); } },
        { id: 'nextProblem', title: '跳转到下一个问题', key: 'F8', group: '编辑', icon: 'warning', run: () => CC.editor.nextDiagnostic() },
        { id: 'commandPalette', title: '命令面板', key: 'Ctrl+Shift+P', group: '视图', icon: 'more', run: () => this.openPalette('command') },
        { id: 'showExplorer', title: '显示资源管理器', key: 'Ctrl+Shift+E', group: '视图', icon: 'files', run: () => this.switchView('explorer') },
        { id: 'showSearch', title: '在全部文件中搜索', key: 'Ctrl+Shift+F', group: '视图', icon: 'search', run: () => { this.switchView('search'); byId('search-input').focus(); } },
        { id: 'showOutline', title: '显示符号大纲', key: 'Ctrl+Shift+O', group: '视图', icon: 'list', run: () => this.switchView('outline') },
        { id: 'showTemplates', title: '显示项目模板', group: '视图', icon: 'template', run: () => this.switchView('templates') },
        { id: 'showDebug', title: '显示运行和调试', group: '视图', icon: 'debug', run: () => this.switchView('debug') },
        { id: 'showProblems', title: '显示问题面板', key: 'Ctrl+Shift+M', group: '视图', icon: 'error', run: () => CC.panels.activate('problems') },
        { id: 'toggleSidebar', title: '显示/隐藏侧边栏', key: 'Ctrl+Shift+B', group: '视图', icon: 'panel', run: () => this.toggleSidebar() },
        { id: 'togglePanel', title: '显示/隐藏底部面板', key: 'Ctrl+J', group: '视图', icon: 'panel', run: () => CC.panels.toggleCollapse() },
        { id: 'toggleTheme', title: '切换主题', key: 'Alt+T', group: '视图', icon: 'theme', run: () => this.toggleTheme() },
        { id: 'showSettings', title: '打开设置', key: 'Ctrl+,', group: '视图', icon: 'settings', run: () => this.switchView('settings') },
        { id: 'welcome', title: '显示欢迎页', group: '视图', icon: 'help', run: () => CC.editor.showWelcome() },
        { id: 'build', title: '构建工程', key: 'Ctrl+B', group: '构建', icon: 'build', run: () => CC.panels.build() },
        { id: 'run', title: '运行程序', key: 'F5', group: '构建', icon: 'play', run: () => CC.debug.state.active ? CC.debug.command('continue') : CC.panels.run() },
        { id: 'buildAndRun', title: '构建并运行', key: 'Alt+R', group: '构建', icon: 'play', run: () => CC.panels.buildAndRun() },
        { id: 'cleanOutput', title: '清空输出与编译器诊断', group: '构建', icon: 'trash', run: () => { CC.panels.clearCurrent(); CC.editor.setCompilerDiagnostics([]); } },
        { id: 'showOutput', title: '查看构建输出', group: '构建', icon: 'terminal', run: () => CC.panels.activate('output') },
        { id: 'terminal', title: '打开集成终端', key: 'Ctrl+`', group: '构建', icon: 'terminal', run: () => { CC.panels.activate('terminal'); } },
        { id: 'detectToolchain', title: '重新检测 C 工具链', key: 'Alt+D', group: '构建', icon: 'cpu', run: () => this.detectToolchain() },
        { id: 'startDebug', title: '启动 gdb 调试', key: 'Ctrl+F5', group: '调试', icon: 'debug', run: () => CC.debug.start() },
        { id: 'debugContinue', title: '继续', group: '调试', icon: 'play', run: () => CC.debug.command('continue') },
        { id: 'debugStepOver', title: '单步跳过', key: 'F10', group: '调试', icon: 'step', run: () => CC.debug.command('next') },
        { id: 'debugStepInto', title: '单步步入', key: 'F11', group: '调试', icon: 'step-in', run: () => CC.debug.command('step') },
        { id: 'debugStepOut', title: '步出', key: 'Shift+F11', group: '调试', icon: 'step-out', run: () => CC.debug.command('finish') },
        { id: 'toggleBreakpoint', title: '切换断点', key: 'F9', group: '调试', icon: 'error', run: () => CC.editor.breakpointAtCursor() },
        { id: 'stopDebug', title: '停止调试', key: 'Shift+F5', group: '调试', icon: 'stop', run: () => CC.debug.stop() },
        { id: 'restartDebug', title: '重启调试', group: '调试', icon: 'refresh', run: () => CC.debug.restart() },
        { id: 'showHelp', title: '帮助与快捷键', key: 'F1', group: '帮助', icon: 'help', run: () => this.switchView('help') },
        { id: 'installCompiler', title: '安装 / 管理编译器', group: '工具', icon: 'cpu', run: () => {
          this.switchView('settings');
          byId('sidebar').classList.remove('collapsed');
          byId('sidebar-splitter').style.display = '';
          const host = byId('compiler-install-settings');
          if (host) host.scrollIntoView({ block: 'start' });
        } },
        { id: 'about', title: '关于 CodeCpp', group: '帮助', icon: 'info', run: () => this.about() }
      ];
      defs.forEach((c) => this.commands.set(c.id, c));
      this.commandDefs = defs;
    },

    execute(id) {
      const command = this.commands.get(id);
      if (!command) { this.toast('未知命令：' + id, 'warn'); return; }
      try {
        const result = command.run();
        if (result && typeof result.catch === 'function') result.catch((error) => this.toast(error.message, 'error'));
      } catch (error) { this.toast(error.message, 'error'); }
    },

    registerBus() {
      const title = (tab) => {
        byId('window-title').textContent = tab
          ? (tab.modified ? '● ' : '') + tab.name + ' · CodeCpp · ' + CC.state.rootName
          : 'CodeCpp · ' + CC.state.rootName;
      };
      CC.bus.on('cursor', ({ line, col }) => {
        byId('status-position').textContent = '行 ' + line + ', 列 ' + col;
        const tab = CC.editor && CC.editor.active();
        byId('status-language').textContent = tab ? ((tab.language || 'plaintext') === 'c' ? 'C' : (tab.language || 'plaintext').toUpperCase()) : '纯文本';
      });
      CC.bus.on('problem-counts', ({ errors, warnings }) => {
        byId('status-errors').textContent = errors;
        byId('status-warnings').textContent = warnings;
      });
      CC.bus.on('tab-changed', ({ tab }) => {
        title(tab);
        byId('status-language').textContent = tab ? ((tab.language || 'plaintext') === 'c' ? 'C' : (tab.language || 'plaintext').toUpperCase()) : '纯文本';
      });
      CC.bus.on('recent', (path) => {
        const recent = (CC.state.settings.recentFiles || []).filter((p) => p !== path);
        recent.unshift(path);
        CC.state.settings.recentFiles = recent.slice(0, 8);
        CC.api.settings({ recentFiles: CC.state.settings.recentFiles }).catch(() => {});
        this.renderRecent();
      });
      CC.bus.on('root-changed', (result) => {
        CC.state.root = result.root;
        CC.state.rootName = result.name;
        CC.state.lastProgram = '';
        this.renderStatus();
        CC.explorer.renderHint(CC.state.bootstrap);
      });
      CC.bus.on('editor-change', () => title(CC.editor && CC.editor.active()));
    },

    bindUI() {
      const runCommandFrom = (event) => {
        const button = event.target.closest('[data-command]');
        if (button) { this.execute(button.dataset.command); return true; }
        return false;
      };
      document.querySelectorAll('.toolbar, .welcome-actions, .statusbar').forEach((el) =>
        el.addEventListener('click', runCommandFrom));
      byId('activitybar').addEventListener('click', (event) => {
        const button = event.target.closest('[data-view]');
        if (button) this.switchView(button.dataset.view);
      });
      const menuBar = byId('menu-bar');
      const closeMenus = () => {
        menuBar.querySelectorAll('button').forEach((b) => b.classList.remove('open'));
        byId('context-menu').classList.add('hidden');
      };
      const openMenu = (button) => {
        const items = (MENU_LAYOUT[button.dataset.menu] || []).map((id) => {
          if (id === '-') return { sep: true };
          const command = this.commands.get(id);
          if (!command) return null;
          return {
            label: command.title, icon: command.icon, key: command.key,
            run: () => { closeMenus(); this.execute(id); }
          };
        }).filter(Boolean);
        menuBar.querySelectorAll('button').forEach((b) => b.classList.toggle('open', b === button));
        const rect = button.getBoundingClientRect();
        this.contextMenu(items, rect.left, rect.bottom + 2);
      };
      menuBar.addEventListener('click', (event) => {
        const button = event.target.closest('[data-menu]');
        if (!button) return;
        if (button.classList.contains('open')) closeMenus();
        else openMenu(button);
      });
      menuBar.addEventListener('mouseover', (event) => {
        const button = event.target.closest('[data-menu]');
        if (button && !button.classList.contains('open') && menuBar.querySelector('button.open')) openMenu(button);
      });
      document.addEventListener('mousedown', (event) => {
        if (!menuBar.contains(event.target) && !byId('context-menu').contains(event.target)) closeMenus();
      });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(); });
      byId('status-toolchain').addEventListener('click', () => this.execute('installCompiler'));
      byId('status-indent').addEventListener('click', () => this.switchView('settings'));
      byId('status-lang').addEventListener('click', () => this.switchView('settings'));
      byId('welcome-toolchain').addEventListener('click', (event) => {
        if (event.target.closest('[data-command="installCompiler"]')) this.execute('installCompiler');
      });

      byId('palette-input').addEventListener('input', (event) => { this.paletteIndex = 0; this.renderPalette(event.target.value); });
      byId('palette-input').addEventListener('keydown', (event) => this.paletteKey(event));
      byId('palette-list').addEventListener('click', (event) => {
        const item = event.target.closest('[data-index]');
        if (item) this.acceptPalette(Number(item.dataset.index));
      });
      byId('palette-backdrop').addEventListener('mousedown', (event) => {
        if (event.target === byId('palette-backdrop')) this.closePalette();
      });
      byId('modal-close').addEventListener('click', () => this.closeModal());
      byId('modal-backdrop').addEventListener('mousedown', (event) => {
        if (event.target === byId('modal-backdrop')) this.closeModal();
      });

      document.addEventListener('keydown', (event) => {
        if (this.modalOpen() && event.key === 'Escape') { this.closeModal(); return; }
        const target = event.target;
        const formInput = target && target.closest &&
          target.closest('input, textarea, select, [contenteditable="true"]') &&
          !target.closest('#code-input');
        for (const command of this.commands.values()) {
          if (!command.key || !this.matchKey(event, command.key)) continue;
          if (formInput && !ALWAYS_ON_KEYS.has(command.id)) continue;
          event.preventDefault();
          event.stopPropagation();
          this.execute(command.id);
          return;
        }
      }, true);

      this.setupSplitter(byId('sidebar-splitter'), 'x', (start, current) => {
        const width = Math.max(200, Math.min(520, start + current));
        byId('sidebar').style.width = width + 'px';
      });
      this.setupSplitter(byId('panel-splitter'), 'y', (start, current) => {
        const height = Math.max(90, Math.min(window.innerHeight * 0.72, start - current));
        byId('bottom-panel').style.height = height + 'px';
        CC.editor && CC.editor.drawMinimap();
      });
    },

    matchKey(event, combo) {
      const parts = combo.split('+');
      const base = parts[parts.length - 1].toLowerCase();
      const wantCtrl = parts.includes('Ctrl'), wantShift = parts.includes('Shift'), wantAlt = parts.includes('Alt');
      const ctrl = Boolean(event.ctrlKey || event.metaKey);
      if (ctrl !== wantCtrl || !!event.shiftKey !== wantShift || !!event.altKey !== wantAlt) return false;
      return String(event.key || '').toLowerCase() === base;
    },

    setupSplitter(el, axis, apply) {
      el.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const initial = axis === 'x'
          ? byId('sidebar').getBoundingClientRect().width
          : byId('bottom-panel').getBoundingClientRect().height;
        const origin = axis === 'x' ? event.clientX : event.clientY;
        el.classList.add('dragging');
        const move = (ev) => apply(initial, (axis === 'x' ? ev.clientX : ev.clientY) - origin);
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          el.classList.remove('dragging');
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    },

    switchView(name) {
      if (!VIEW_NAMES[name]) return;
      if (this.activeView === name && !byId('sidebar').classList.contains('collapsed')) {
        this.toggleSidebar(false);
        return;
      }
      byId('sidebar').classList.remove('collapsed');
      byId('sidebar-splitter').style.display = '';
      this.activeView = name;
      document.querySelectorAll('.activity-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
      document.querySelectorAll('[data-view-panel]').forEach((v) => v.classList.toggle('active', v.dataset.viewPanel === name));
      byId('sidebar-title').textContent = VIEW_NAMES[name];
      if (name === 'settings' && CC.settingsUI) CC.settingsUI.render();
      if (name === 'search') byId('search-input').focus();
      if (name === 'help') this.renderHelp();
    },

    toggleSidebar(force) {
      const bar = byId('sidebar');
      const show = force === undefined ? bar.classList.contains('collapsed') : force;
      bar.classList.toggle('collapsed', !show);
      byId('sidebar-splitter').style.display = show ? '' : 'none';
      setTimeout(() => CC.editor && CC.editor.drawMinimap(), 50);
    },

    toggleTheme() {
      const order = ['dark', 'light', 'contrast'];
      const next = order[(order.indexOf(CC.state.settings.theme) + 1) % order.length];
      this.applySettings({ theme: next });
      this.toast('主题已切换为' + THEME_NAMES[next], 'info');
    },

    applyTheme() {
      document.documentElement.setAttribute('data-theme', CC.state.settings.theme || 'dark');
      byId('status-theme').textContent = THEME_NAMES[CC.state.settings.theme] || '深色';
    },

    applySettings(patch) {
      const local = CC.state.settings;
      Object.keys(patch).forEach((key) => {
        const value = patch[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) local[key] = Object.assign({}, local[key] || {}, value);
        else local[key] = value;
      });
      CC.api.settings(patch).catch((error) => this.toast(error.message, 'error'));
      if ('theme' in patch) {
        this.applyTheme();
        setTimeout(() => CC.editor && CC.editor.drawMinimap(), 60);
      }
      if ('fontSize' in patch || 'tabSize' in patch || 'insertSpaces' in patch || 'minimap' in patch) {
        CC.editor && CC.editor.applyAppearance();
      }
      this.renderStatus();
      if (CC.settingsUI && this.activeView === 'settings') CC.settingsUI.render();
      CC.bus.emit('settings-changed', patch);
    },

    renderStatus() {
      const s = CC.state.settings;
      byId('status-root').textContent = CC.state.rootName || '工作区';
      byId('status-indent-label').textContent = (s.insertSpaces === false ? '制表符' : '空格') + ': ' + (s.tabSize || 4);
      const cfg = CC.state.bootstrap.toolchain || {};
      const compiler = cfg.selected && cfg.selected.compiler;
      const label = byId('status-compiler');
      label.textContent = compiler ? CC.util.basename(compiler) : '工具链未就绪';
      label.parentElement.classList.toggle('bad', !compiler);
      label.parentElement.classList.toggle('ready', Boolean(compiler));
    },

    async detectToolchain() {
      this.setBusy(true, '正在检测工具链…');
      try {
        const result = await CC.api.toolchain();
        CC.state.bootstrap.toolchain = result.toolchain;
        if (result.environment) CC.state.environment = result.environment;
        CC.state.bootstrap.capabilities.compiler = result.config.ready;
        CC.state.bootstrap.capabilities.debugger = Boolean(result.config.debugger);
        CC.state.bootstrap.capabilities.make = Boolean(result.config.make);
        CC.state.bootstrap.capabilities.cmake = Boolean(result.config.cmake);
        this.renderToolchain();
        this.renderStatus();
        if (CC.settingsUI) CC.settingsUI.render();
        this.toast(result.toolchain.ready ? '工具链已就绪：' + CC.util.basename(result.toolchain.selected.compiler) : '未检测到编译器，可点击「安装编译器」一键安装', result.toolchain.ready ? 'success' : 'warn');
      } catch (error) { this.toast(error.message, 'error'); }
      finally { this.setBusy(false); }
    },

    renderToolchain() {
      const cap = CC.state.bootstrap.capabilities || {};
      const t = CC.state.bootstrap.toolchain || {};
      const rows = [
        ['C 编译器', cap.compiler, t.selected && t.selected.compiler],
        ['调试器 gdb', cap.debugger, t.selected && t.selected.debugger],
        ['make', cap.make, t.tools && t.tools.make && t.tools.make.path],
        ['cmake', cap.cmake, t.tools && t.tools.cmake && t.tools.cmake.path]
      ];
      const body = byId('welcome-toolchain-body');
      if (body) body.innerHTML = rows.map(([name, ok, path]) =>
        '<div class="kv">' + icon(ok ? 'check' : 'close') + '<span style="color:' + (ok ? 'var(--accent)' : 'var(--text-3)') + '">' + esc(name) + (path ? ' · ' + esc(CC.util.basename(path)) : '') + '</span></div>'
      ).join('') + '<button class="mini-btn" data-command="installCompiler" style="margin-top:10px">' + icon('cpu') + ' 安装 / 管理编译器</button>';
      const label = byId('toolchain-label');
      label.textContent = cap.compiler ? '工具链已就绪' : '安装编译器';
      const detect = document.querySelector('.toolbar [data-command="installCompiler"]');
      if (detect) detect.classList.toggle('warn', !cap.compiler);
    },

    renderHelp() {
      const list = this.commandDefs.filter((c) => c.key);
      byId('shortcut-list').innerHTML = list.map((c) =>
        '<div class="shortcut-row"><span>' + esc(c.title) + '</span><span>' + c.key.split('+').map((p) => '<kbd>' + esc(p) + '</kbd>').join('+') + '</span></div>'
      ).join('');
      byId('install-guide').textContent = CC.state.bootstrap.guide || '';
    },

    renderRecent() {
      const list = CC.state.settings.recentFiles || [];
      const el = byId('recent-list');
      if (!el) return;
      el.innerHTML = list.length ? list.map((p) =>
        '<div class="recent-item" data-path="' + esc(p) + '">' + icon('file') + esc(p) + '</div>'
      ).join('') : '<div class="empty-state" style="padding:6px 0">暂无最近文件</div>';
      el.onclick = (event) => {
        const item = event.target.closest('[data-path]');
        if (item) CC.editor.open(item.dataset.path);
      };
    },

    async gotoLine() {
      const value = await this.prompt('跳转到行', '输入行号', '1');
      const line = Number(value);
      if (line > 0) CC.editor.setCursor(line, 1);
    },

    onWorkspaceChange(message) {
      if (this.changeTimer) clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => {
        CC.bus.emit('fs-change', message);
      }, 300);
    },

    openPalette(mode) {
      this.paletteMode = mode;
      this.paletteIndex = 0;
      byId('palette-backdrop').classList.remove('hidden');
      const input = byId('palette-input');
      input.value = '';
      input.placeholder = mode === 'files' ? '输入文件名快速打开…' : '输入命令名称或关键字…';
      this.renderPalette('');
      input.focus();
    },

    paletteItemsFor(mode) {
      if (mode === 'files') {
        return (CC.state.fileCache || []).map((f) => ({
          label: f.path, group: '文件', icon: 'file', detail: '',
          run: () => CC.editor.open(f.path)
        }));
      }
      return this.commandDefs.map((c) => ({
        label: c.title, group: groupOf(c), icon: c.icon, key: c.key,
        run: () => this.execute(c.id)
      }));
    },

    renderPalette(query) {
      const all = this.paletteItemsFor(this.paletteMode);
      const scored = all.map((item) => ({ item, score: CC.util.fuzzyScore(item.label + ' ' + item.group, query) }))
        .filter((x) => x.score > 0 || !query)
        .sort((a, b) => b.score - a.score)
        .slice(0, 60);
      this.paletteItems = scored.map((x) => x.item);
      if (this.paletteIndex >= this.paletteItems.length) this.paletteIndex = 0;
      byId('palette-list').innerHTML = this.paletteItems.length ? this.paletteItems.map((item, index) =>
        '<div class="palette-item ' + (index === this.paletteIndex ? 'active' : '') + '" data-index="' + index + '">' +
        icon(item.icon || 'file') + '<span class="label">' + esc(item.label) + '</span>' +
        (item.key ? '<span class="key">' + esc(item.key) + '</span>' : '') +
        '<span class="group">' + esc(item.group || '') + '</span></div>'
      ).join('') : '<div class="empty-state">没有匹配项</div>';
    },

    paletteKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); this.closePalette(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); this.paletteIndex++; this.renderPalette(byId('palette-input').value); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); this.paletteIndex--; if (this.paletteIndex < 0) this.paletteIndex = this.paletteItems.length - 1; this.renderPalette(byId('palette-input').value); return; }
      if (event.key === 'Enter') { event.preventDefault(); this.acceptPalette(this.paletteIndex); }
    },

    acceptPalette(index) {
      const item = this.paletteItems[index];
      this.closePalette();
      if (item) {
        try {
          const result = item.run();
          if (result && typeof result.catch === 'function') result.catch((error) => this.toast(error.message, 'error'));
        } catch (error) { this.toast(error.message, 'error'); }
      }
    },

    closePalette() { byId('palette-backdrop').classList.add('hidden'); },

    async quickOpen() {
      try {
        const result = await CC.api.files();
        CC.state.fileCache = result.files || [];
      } catch (_) {}
      this.openPalette('files');
    },

    modalOpen() { return !byId('modal-backdrop').classList.contains('hidden'); },

    showModal({ title, body, buttons, onClose }) {
      byId('modal-title').textContent = title || '提示';
      byId('modal-body').innerHTML = body || '';
      byId('modal-foot').innerHTML = (buttons || []).map((b, i) =>
        '<button class="' + (b.primary ? 'primary-btn' : 'ghost-btn') + '" data-modal-button="' + i + '">' + esc(b.label) + '</button>'
      ).join('');
      byId('modal-foot').onclick = (event) => {
        const button = event.target.closest('[data-modal-button]');
        if (!button) return;
        const index = Number(button.dataset.modalButton);
        const action = (buttons || [])[index];
        this.closeModal(true);
        if (action && action.onClick) action.onClick();
      };
      this.modalDismiss = onClose || null;
      byId('modal-backdrop').classList.remove('hidden');
    },

    closeModal(silent) {
      byId('modal-backdrop').classList.add('hidden');
      const dismiss = this.modalDismiss;
      this.modalDismiss = null;
      if (!silent && dismiss) dismiss();
    },

    prompt(title, label, defaultValue) {
      return new Promise((resolve) => {
        this.showModal({
          title,
          body: '<label style="display:block;margin-bottom:8px;color:var(--text-2)">' + esc(label) + '</label>' +
            '<input id="modal-field" type="text" value="' + esc(defaultValue || '') + '" spellcheck="false">',
          buttons: [
            { label: '取消', onClick: () => resolve(null) },
            { label: '确定', primary: true, onClick: () => resolve(byId('modal-field') ? byId('modal-field').value.trim() || null : null) }
          ],
          onClose: () => resolve(null)
        });
        const field = byId('modal-field');
        if (field) {
          field.focus(); field.select();
          field.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const value = field.value.trim();
            this.closeModal(true);
            resolve(value || null);
          });
        }
      });
    },

    confirm(title, message) {
      return new Promise((resolve) => {
        this.showModal({
          title, body: '<div>' + esc(message) + '</div>',
          buttons: [
            { label: '取消', onClick: () => resolve(false) },
            { label: '确定', primary: true, onClick: () => resolve(true) }
          ],
          onClose: () => resolve(false)
        });
      });
    },

    confirmSave(title, message) {
      return new Promise((resolve) => {
        this.showModal({
          title, body: '<div>' + esc(message) + '</div>',
          buttons: [
            { label: '取消', onClick: () => resolve('cancel') },
            { label: '不保存', onClick: () => resolve('discard') },
            { label: '保存', primary: true, onClick: () => resolve('save') }
          ],
          onClose: () => resolve('cancel')
        });
      });
    },

    about() {
      const b = CC.state.bootstrap;
      this.showModal({
        title: '关于 CodeCpp',
        body: '<div style="display:flex;gap:14px;align-items:center;margin-bottom:14px"><div class="about-logo">&lt;C/&gt;</div>' +
          '<div><b style="color:var(--text)">CodeCpp ' + esc(b.version) + '</b><div class="muted">面向 C 语言的高级集成开发环境</div></div></div>' +
          '<p>CodeCpp 桌面应用：多标签 C 编辑器、语法高亮、静态诊断、符号大纲、项目模板、gcc/clang 构建、程序运行、集成终端与 gdb 调试。</p>' +
          '<p>工作区：<code>' + esc(CC.state.root) + '</code></p>' +
          '<p>编译器：<code>' + esc((b.toolchain && b.toolchain.selected && b.toolchain.selected.compiler) || '未配置') + '</code></p>' +
          '<p>运行模式：<code>' + (CC.state.desktopInfo
            ? '桌面应用 · Electron ' + esc(CC.state.desktopInfo.electron) + ' / Chromium ' + esc(CC.state.desktopInfo.chrome)
            : '本地浏览器工作台') + '</code></p>' +
          '<div class="about-card" style="margin:0"><div class="about-logo">酱</div><div>' +
          '<b style="color:var(--text)">科技酱</b><div class="muted">同一个世界，同一个互联网！</div>' +
          '<div class="muted">https://www.asoe.cn · https://docs.asoe.cn</div>' +
          '<div class="muted">https://github.com/techjiang/ · official@tech.asoe.cn</div>' +
          '<div class="muted">QQ群：291974598 / 474819022 / 631167288</div></div></div>',
        buttons: [{ label: '关闭', primary: true }]
      });
    },

    toast(message, type) {
      const stack = byId('toast-stack');
      const kind = type === 'error' ? 'error' : type === 'warn' ? 'warn' : type === 'success' ? 'success' : 'info';
      const ic = kind === 'error' ? 'error' : kind === 'warn' ? 'warning' : kind === 'success' ? 'check' : 'info';
      const div = document.createElement('div');
      div.className = 'toast ' + (kind === 'error' || kind === 'warn' ? kind : '');
      div.innerHTML = icon(ic) + '<span>' + esc(message) + '</span>';
      stack.appendChild(div);
      setTimeout(() => { div.style.opacity = '0'; div.style.transform = 'translateX(16px)'; setTimeout(() => div.remove(), 220); }, 3600);
    },

    contextMenu(items, x, y) {
      const menu = byId('context-menu');
      if (this.closeContextMenu) document.removeEventListener('mousedown', this.closeContextMenu);
      menu.innerHTML = items.map((item, index) => item.sep
        ? '<div class="ctx-sep"></div>'
        : '<button class="ctx-item ' + (item.danger ? 'danger' : '') + '" data-index="' + index + '">' +
          icon(item.icon || 'file') + '<span>' + esc(item.label) + '</span>' +
          (item.key ? '<span class="ctx-key">' + esc(item.key) + '</span>' : '') + '</button>'
      ).join('');
      menu.classList.remove('hidden');
      const rect = menu.getBoundingClientRect();
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
      const close = (event) => {
        if (menu.contains(event.target)) return;
        menu.classList.add('hidden');
        document.removeEventListener('mousedown', close);
        this.closeContextMenu = null;
        document.querySelectorAll('.menu-bar > button').forEach((b) => b.classList.remove('open'));
      };
      this.closeContextMenu = close;
      menu.onclick = (event) => {
        const button = event.target.closest('[data-index]');
        if (!button) return;
        const item = items[Number(button.dataset.index)];
        menu.classList.add('hidden');
        document.removeEventListener('mousedown', close);
        this.closeContextMenu = null;
        document.querySelectorAll('.menu-bar > button').forEach((b) => b.classList.remove('open'));
        if (item && item.run) item.run();
      };
      setTimeout(() => {
        if (this.closeContextMenu === close) document.addEventListener('mousedown', close);
      }, 0);
    },

    status(text, kind) {
      const el = byId('status-message');
      el.textContent = text || '就绪';
      el.style.color = kind === 'bad' ? 'var(--danger)' : kind === 'good' ? 'var(--accent)' : '';
    },

    setBusy(value, message) {
      this.busy = Boolean(value);
      byId('window-title').textContent = value
        ? 'CodeCpp · ' + (message || '处理中…')
        : (CC.editor && CC.editor.active() ? CC.editor.active().name + ' · CodeCpp' : 'CodeCpp');
      if (message) this.status(message);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.init());
  else app.init();
})();
