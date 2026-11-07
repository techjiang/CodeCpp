/* CodeCpp · 内置编译器安装卡片（欢迎页 + 设置页共用） */
(function () {
  const CC = window.CC = window.CC || {};
  const esc = CC.util.escapeHtml;
  const ACTIVE = ['preparing', 'downloading', 'extracting', 'configuring'];

  class CompilerUI {
    constructor() {
      this.hosts = ['compiler-install', 'compiler-install-settings']
        .map((id) => document.getElementById(id)).filter(Boolean);
      this.status = null;
      this.url = '';
      this.lastPhase = '';
      this.timer = null;
    }

    init() {
      if (!this.hosts.length) return;
      this.hosts.forEach((host) => { host.innerHTML = this.shell(); });
      document.addEventListener('click', (event) => this.onClick(event));
      document.addEventListener('input', (event) => {
        if (event.target && event.target.classList.contains('compiler-url')) this.url = event.target.value;
      });
      this.refresh();
      this.timer = window.setInterval(() => {
        const phase = this.status && this.status.task && this.status.task.phase;
        if (ACTIVE.includes(phase)) this.refresh();
      }, 800);
    }

    shell() {
      return '<div class="compiler-panel">' +
        '<div class="compiler-head"><span class="compiler-state warn">检测中…</span>' +
        '<span class="compiler-version"></span>' +
        '<button class="mini-btn" data-compiler="detect">重新检测</button></div>' +
        '<div class="compiler-actions">' +
        '<button class="primary-btn" data-compiler="install">一键安装</button>' +
        '<button class="ghost-btn" data-compiler="pick">导入压缩包</button>' +
        '<button class="mini-btn danger-btn hidden" data-compiler="cancel">取消</button>' +
        '</div>' +
        '<div class="compiler-url-row"><input class="compiler-url" type="text" spellcheck="false" placeholder="粘贴 .zip / .7z 链接">' +
        '<button class="mini-btn" data-compiler="install-url">安装</button></div>' +
        '<div class="compiler-progress hidden"><div class="compiler-bar"></div></div>' +
        '<div class="compiler-message hidden"></div>' +
        '<div class="compiler-error hidden"></div>' +
        '<pre class="compiler-log hidden"></pre>' +
        '<div class="compiler-links"></div>' +
        '</div>';
    }

    async refresh() {
      try { this.status = await CC.api.compilerStatus(); }
      catch (_) { return; }
      this.render();
      const task = this.status.task || {};
      const phase = task.phase;
      if (phase === 'done' && ACTIVE.includes(this.lastPhase)) {
        if (CC.app && CC.app.detectToolchain) CC.app.detectToolchain();
        if (CC.app && CC.app.toast) CC.app.toast('编译器安装完成，已自动配置 gcc / gdb / make', 'success');
      }
      if (phase === 'error' && this.lastPhase !== 'error' && CC.app && CC.app.toast) {
        CC.app.toast('编译器安装失败：' + (task.error || ''), 'error');
      }
      this.lastPhase = phase;
    }

    render() {
      const s = this.status;
      if (!s) return;
      const task = s.task || {};
      const active = ACTIVE.includes(task.phase);
      const links = (s.pages || []).map((p) =>
        '<a href="' + esc(p.url) + '" target="_blank" rel="noreferrer">' + esc(p.name) + '</a>').join(' · ');
      this.hosts.forEach((host) => {
        const stateEl = host.querySelector('.compiler-state');
        stateEl.textContent = s.installed ? '已就绪' : (active ? '安装中…' : '未安装');
        stateEl.className = 'compiler-state ' + (s.installed ? 'ok' : active ? 'busy' : 'warn');
        host.querySelector('.compiler-version').textContent = s.version || s.compiler || '';
        const msg = task.message || (s.installed ? 'gcc / gdb / make 已自动配置' : '');
        const msgEl = host.querySelector('.compiler-message');
        msgEl.textContent = msg;
        msgEl.classList.toggle('hidden', !msg);
        host.querySelector('.compiler-bar').style.width = (task.progress || 0) + '%';
        host.querySelector('.compiler-progress').classList.toggle('hidden',
          !active && task.phase !== 'done' && task.phase !== 'error');
        const log = host.querySelector('.compiler-log');
        log.textContent = (task.log || []).slice(-4).join('\n');
        log.classList.toggle('hidden', !(task.log || []).length);
        const error = host.querySelector('.compiler-error');
        error.textContent = task.phase === 'error' ? task.error : '';
        error.classList.toggle('hidden', task.phase !== 'error');
        host.querySelector('[data-compiler="install"]').disabled = active;
        host.querySelector('[data-compiler="pick"]').disabled = active;
        host.querySelector('[data-compiler="install-url"]').disabled = active;
        host.querySelector('[data-compiler="cancel"]').classList.toggle('hidden', !active);
        host.querySelector('.compiler-links').innerHTML = links;
      });
    }

    async onClick(event) {
      const button = event.target.closest('[data-compiler]');
      if (!button) return;
      const action = button.dataset.compiler;
      if (action === 'detect') {
        if (CC.app && CC.app.detectToolchain) CC.app.detectToolchain();
        return;
      }
      try {
        if (action === 'cancel') await CC.api.compilerCancel();
        else if (action === 'install') await CC.api.compilerInstall({});
        else if (action === 'install-url') {
          if (!this.url.trim()) {
            if (CC.app && CC.app.toast) CC.app.toast('请先填写编译器压缩包的下载直链', 'warn');
            return;
          }
          await CC.api.compilerInstall({ url: this.url.trim() });
        } else if (action === 'pick') {
          let archive = '';
          if (CC.state.desktop && CC.state.desktop.pickArchive) {
            archive = await CC.state.desktop.pickArchive();
          } else if (CC.app && CC.app.prompt) {
            archive = await CC.app.prompt('导入编译器压缩包', '输入本机 .zip / .7z 文件的完整路径', '');
          }
          if (!archive) return;
          await CC.api.compilerInstall({ archivePath: archive });
        } else return;
        await this.refresh();
      } catch (error) {
        if (CC.app && CC.app.toast) CC.app.toast(error.message, 'error');
      }
    }
  }

  CC.CompilerUI = CompilerUI;
})();
