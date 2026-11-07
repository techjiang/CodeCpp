/* CodeCpp · 资源管理器、搜索、大纲与项目模板 */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;
  const icon = CC.util.icon;
  const byId = (id) => document.getElementById(id);

  class Explorer {
    constructor() {
      this.el = {
        tree: byId('file-tree'), workspaceName: byId('workspace-name'), hint: byId('explorer-hint'),
        searchInput: byId('search-input'), searchResults: byId('search-results'),
        searchSummary: byId('search-summary'), searchCase: byId('search-case'),
        searchRegex: byId('search-regex'), searchC: byId('search-c'),
        outlineList: byId('outline-list'), outlineFile: byId('outline-file'),
        outlineMetrics: byId('outline-metrics'), todoList: byId('todo-list'),
        templateList: byId('template-list')
      };
      this.expanded = new Set();
      this.selected = null;
      this.currentTab = null;
      this.bind();
      CC.bus.on('outline', (payload) => this.renderOutline(payload));
      CC.bus.on('tab-changed', (payload) => {
        this.currentTab = payload.tab;
        if (!payload.tab) this.renderOutline({ tab: null, outline: { symbols: [], metrics: null } });
      });
      CC.bus.on('fs-change', () => this.refresh());
    }

    bind() {
      const el = this.el;
      el.tree.addEventListener('click', (event) => {
        const row = event.target.closest('.tree-row');
        if (!row) return;
        const path = row.dataset.path;
        this.selected = path;
        this.el.tree.querySelectorAll('.tree-row.selected').forEach((r) => r.classList.remove('selected'));
        row.classList.add('selected');
        if (row.dataset.kind === 'dir') {
          if (this.expanded.has(path)) this.expanded.delete(path); else this.expanded.add(path);
          this.refresh();
        } else CC.editor.open(path);
      });
      el.tree.addEventListener('contextmenu', (event) => {
        const row = event.target.closest('.tree-row');
        if (!row) return;
        event.preventDefault();
        this.selected = row.dataset.path;
        this.showTreeMenu(event, row.dataset.path, row.dataset.kind);
      });
      document.getElementById('sidebar-actions').addEventListener('click', (event) => {
        const button = event.target.closest('[data-action]');
        if (button) this.action(button.dataset.action);
      });
      document.querySelector('[data-view-panel="explorer"] .head-actions').addEventListener('click', (event) => {
        const button = event.target.closest('[data-action]');
        if (button) this.action(button.dataset.action);
      });
      byId('search-run').addEventListener('click', () => this.runSearch());
      el.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') this.runSearch(); });
      el.hint.addEventListener('click', (event) => {
        const link = event.target.closest('[data-hint-action]');
        if (link) { event.preventDefault(); CC.app.execute('installCompiler'); }
      });
      el.templateList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-template]');
        if (button) this.createTemplate(button.dataset.template);
      });
      el.outlineList.addEventListener('click', (event) => {
        const row = event.target.closest('[data-line]');
        if (row) CC.editor.setCursor(Number(row.dataset.line), Number(row.dataset.col || 1));
      });
      el.todoList.addEventListener('click', (event) => {
        const row = event.target.closest('[data-line]');
        if (row) CC.editor.setCursor(Number(row.dataset.line), 1);
      });
      el.searchResults.addEventListener('click', (event) => {
        const row = event.target.closest('[data-file][data-line]');
        if (row) CC.editor.goto(row.dataset.file, Number(row.dataset.line), Number(row.dataset.col || 1));
      });
    }

    init(bootstrap) {
      this.el.workspaceName.textContent = bootstrap.rootName || '工作区';
      this.renderTemplates(bootstrap.templates || []);
      this.renderHint(bootstrap);
      this.refresh();
    }

    renderHint(bootstrap) {
      const cap = bootstrap.capabilities;
      this.el.hint.innerHTML = cap.compiler
        ? '<span class="hint-dot ok"></span><span>编译器就绪 · <kbd>Ctrl</kbd>+<kbd>B</kbd> 构建</span>'
        : '<span class="hint-dot warn"></span><span>未检测到编译器 · <a class="hint-link" href="#" data-hint-action="install">安装</a></span>';
    }

    targetDir() {
      if (!this.selected) return '.';
      const rows = this.el.tree.querySelectorAll('.tree-row');
      const row = Array.from(rows).find((r) => r.dataset.path === this.selected);
      if (row && row.dataset.kind === 'dir') return this.selected;
      return CC.util.dirname(this.selected) || '.';
    }

    async action(action) {
      switch (action) {
        case 'new-file': return this.create('file');
        case 'new-folder': return this.create('folder');
        case 'refresh-tree': return this.refresh();
        case 'collapse-tree': this.expanded.clear(); return this.refresh();
      }
    }

    async create(kind) {
      const dir = this.targetDir();
      const name = await CC.app.prompt(kind === 'file' ? '新建文件' : '新建文件夹',
        '将在 ' + (dir === '.' ? '工作区根目录' : dir) + ' 中创建', kind === 'file' ? 'untitled.c' : '新建文件夹');
      if (!name) return;
      const path = dir === '.' ? name : dir + '/' + name;
      try {
        await CC.api.fs(kind === 'file' ? 'new-file' : 'new-folder', { path, content: '' });
        if (CC.util.dirname(path)) this.expanded.add(CC.util.dirname(path));
        await this.refresh();
        if (kind === 'file') await CC.editor.open(path);
        CC.app.toast('已创建 ' + name, 'success');
      } catch (error) { CC.app.toast(error.message, 'error'); }
    }

    showTreeMenu(event, path, kind) {
      const items = [
        { label: '新建文件', icon: 'plus', run: () => this.create('file') },
        { label: '新建文件夹', icon: 'folder', run: () => this.create('folder') }
      ];
      if (kind !== 'dir') items.push({ label: '在编辑器中打开', icon: 'file', run: () => CC.editor.open(path) });
      items.push({ sep: true });
      items.push({ label: '重命名', icon: 'edit', run: async () => {
        const next = await CC.app.prompt('重命名', '输入新名称', CC.util.basename(path));
        if (!next || next === CC.util.basename(path)) return;
        try {
          await CC.api.fs('rename', { path, name: next });
          const newPath = (CC.util.dirname(path) ? CC.util.dirname(path) + '/' : '') + next;
          const tab = Array.from(CC.editor.tabs.values()).find((t) => t.path === path);
          if (tab) { tab.path = newPath; tab.name = next; CC.editor.updateTabs(); }
          await this.refresh();
        } catch (error) { CC.app.toast(error.message, 'error'); }
      } });
      items.push({ label: '复制相对路径', icon: 'files', run: () => {
        navigator.clipboard && navigator.clipboard.writeText(path);
        CC.app.toast('已复制：' + path, 'info');
      } });
      items.push({ label: '在文件管理器中显示', icon: 'external', run: () => {
        if (CC.state.desktop) CC.state.desktop.reveal(path).catch(() => {});
        else CC.api.reveal(path).catch((e) => CC.app.toast(e.message, 'error'));
      } });
      items.push({ sep: true });
      items.push({ label: '删除', icon: 'trash', danger: true, run: async () => {
        const ok = await CC.app.confirm('删除确认', '确定删除「' + CC.util.basename(path) + '」吗？此操作不可撤销。');
        if (!ok) return;
        try {
          await CC.api.fs('delete', { path });
          const tab = Array.from(CC.editor.tabs.values()).find((t) => t.path === path || t.path.startsWith(path + '/'));
          if (tab) await CC.editor.close(tab.id, true);
          this.selected = null;
          await this.refresh();
          CC.app.toast('已删除 ' + CC.util.basename(path), 'info');
        } catch (error) { CC.app.toast(error.message, 'error'); }
      } });
      CC.app.contextMenu(items, event.clientX, event.clientY);
    }

    async refresh() {
      try {
        const html = await this.rowsFor('.', 0);
        this.el.tree.innerHTML = html || '<div class="empty-state">工作区为空。点击顶部 + 新建文件，或使用项目模板。</div>';
      } catch (error) {
        this.el.tree.innerHTML = '<div class="empty-state">' + esc(error.message) + '</div>';
      }
    }

    async rowsFor(dir, depth) {
      if (depth > 12) return '';
      let data;
      try { data = await CC.api.tree(dir); }
      catch (_) { return ''; }
      let html = '';
      for (const item of data.entries) {
        if (item.hidden) continue;
        const isDir = item.isDir;
        const ext = CC.util.ext(item.name);
        const kind = isDir ? 'dir' : (ext === 'c' || ext === 'cpp' ? 'c' : ext === 'h' || ext === 'hpp' ? 'h' : 'other');
        const open = this.expanded.has(item.path);
        const chev = isDir ? (open ? 'chevron-down' : 'chevron-right') : '';
        const fileIcon = isDir ? (open ? 'folder-open' : 'folder') : (kind === 'c' ? 'braces' : 'file');
        html += '<div class="tree-row ' + (this.selected === item.path ? 'selected' : '') + '" data-path="' + esc(item.path) + '" data-kind="' + kind + '" style="padding-left:' + (4 + depth * 14) + 'px" title="' + esc(item.path) + '">' +
          '<span class="tree-chev">' + (chev ? icon(chev) : '') + '</span>' +
          '<span class="tree-icon">' + icon(fileIcon) + '</span>' +
          '<span class="tree-name">' + esc(item.name) + '</span>' +
          (isDir ? '' : '<span class="tree-size">' + CC.util.bytes(item.size) + '</span>') + '</div>';
        if (isDir && open) html += await this.rowsFor(item.path, depth + 1);
      }
      return html;
    }

    async runSearch() {
      const el = this.el;
      const query = el.searchInput.value.trim();
      if (!query) { el.searchSummary.textContent = '输入内容后按 Enter 搜索'; el.searchResults.innerHTML = ''; return; }
      el.searchSummary.textContent = '搜索中…';
      try {
        const result = await CC.api.search(query, {
          regex: el.searchRegex.checked ? '1' : '',
          caseSensitive: el.searchCase.checked ? '1' : '',
          include: el.searchC.checked ? '\\.(c|h|cpp|hpp)$' : ''
        });
        el.searchSummary.textContent = '找到 ' + result.matches.length + ' 处匹配 · 扫描 ' + result.filesScanned + ' 个文件' + (result.truncated ? '（结果已截断）' : '');
        let lastFile = '', html = '';
        for (const m of result.matches) {
          if (m.file !== lastFile) {
            lastFile = m.file;
            html += '<div class="result-file">' + icon('file') + esc(m.file) + '</div>';
          }
          const safe = esc(m.preview || '');
          html += '<div class="result-row" data-file="' + esc(m.file) + '" data-line="' + m.line + '" data-col="' + m.column + '" title="' + esc(m.file) + ':' + m.line + '">' +
            '<span class="ln">' + m.line + ':' + m.column + '</span>' + safe + '</div>';
        }
        el.searchResults.innerHTML = html || '<div class="empty-state">没有找到匹配内容</div>';
      } catch (error) {
        el.searchSummary.textContent = error.message;
        el.searchResults.innerHTML = '';
      }
    }

    renderOutline({ tab, outline }) {
      const el = this.el;
      el.outlineFile.textContent = tab ? tab.name : '';
      const symbols = outline && outline.symbols || [];
      el.outlineList.innerHTML = symbols.length ? symbols.map((s) =>
        '<div class="outline-row" data-line="' + s.line + '" data-col="' + (s.column || 1) + '" title="' + esc(s.signature || '') + '">' +
        '<span class="outline-kind kind-' + esc(s.kind) + '">' + ({ function: 'f', prototype: 'p', struct: 'S', enum: 'E', macro: 'M', include: '#', variable: 'v' }[s.kind] || '?') + '</span>' +
        '<span class="outline-name">' + esc(s.name) + '</span>' +
        '<span class="outline-sig">' + esc((s.signature || '').slice(0, 40)) + '</span></div>'
      ).join('') : '<div class="empty-state">打开一个 C 文件查看函数、结构体、宏与变量</div>';
      const m = outline && outline.metrics;
      el.outlineMetrics.innerHTML = m ? [
        ['总行数', m.lines], ['代码行', m.codeLines], ['注释行', m.commentLines],
        ['函数', m.functions], ['结构体/枚举', m.structs], ['文件体积', CC.util.bytes(m.bytes)]
      ].map(([k, v]) => '<div class="metric"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>').join('') : '';
      el.todoList.innerHTML = m && m.todos && m.todos.length
        ? m.todos.map((t) => '<div class="outline-row" data-line="' + t.line + '"><span class="outline-kind kind-macro">' + esc(t.tag[0]) + '</span><span class="outline-name">' + esc(t.line + ' · ' + t.text) + '</span></div>').join('')
        : '<div class="empty-state">暂无 TODO 标记</div>';
    }

    renderTemplates(list) {
      this.el.templateList.innerHTML = list.map((t) =>
        '<div class="template-card"><h4>' + icon(t.icon || 'template') + esc(t.name) + '</h4>' +
        '<p>' + esc(t.description) + '</p><div class="meta"><span>' + t.fileCount + ' 个文件</span>' +
        '<button class="mini-btn" data-template="' + esc(t.id) + '">生成到工作区</button></div></div>'
      ).join('');
    }

    async createTemplate(id) {
      try {
        const result = await CC.api.templates(id, '.');
        await this.refresh();
        CC.app.toast(result.result.created.length ? '已生成 ' + result.result.name + '（' + result.result.created.length + ' 个文件）' : '模板文件已存在，未覆盖', 'success');
        const first = result.result.created.find((f) => /\.c$/.test(f));
        if (first) await CC.editor.open(first);
      } catch (error) { CC.app.toast(error.message, 'error'); }
    }

    async openFolder(explicitPath) {
      let path = explicitPath;
      if (!path && CC.state.desktop) {
        try { path = await CC.state.desktop.pickFolder(); } catch (_) {}
        if (!path) return;
      }
      if (!path) path = await CC.app.prompt('打开文件夹', '输入本机文件夹的绝对路径', CC.state.root);
      if (!path || path === CC.state.root) return;
      if (!await CC.editor.guardUnsaved('切换工作区')) return;
      try {
        const result = await CC.api.folder(path);
        CC.state.root = result.root;
        CC.state.rootName = result.name;
        this.el.workspaceName.textContent = result.name;
        this.selected = null; this.expanded.clear();
        await this.refresh();
        CC.editor.tabs.clear(); CC.editor.order = []; CC.editor.activeId = null;
        CC.editor.showWelcome();
        CC.bus.emit('dirty-count', 0);
        CC.bus.emit('root-changed', result);
        CC.app.toast('已打开文件夹：' + result.root, 'success');
      } catch (error) { CC.app.toast(error.message, 'error'); }
    }
  }

  CC.Explorer = Explorer;
})();
