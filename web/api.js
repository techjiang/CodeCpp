/* CodeCpp · 全局工具与 API 客户端 */
(function () {
  const CC = window.CC = window.CC || {};

  const listeners = new Map();
  CC.bus = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return () => CC.bus.off(event, fn);
    },
    off(event, fn) {
      const arr = listeners.get(event) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    emit(event, payload) {
      (listeners.get(event) || []).slice().forEach((fn) => {
        try { fn(payload); } catch (error) { console.error('[bus]', event, error); }
      });
    }
  };

  CC.util = {
    escapeHtml(text) {
      return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    debounce(fn, wait) {
      let timer = null;
      return function () {
        const args = arguments, self = this;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(self, args), wait);
      };
    },
    icon(name, cls) {
      return '<svg class="icon ' + (cls || '') + '"><use href="#i-' + name + '"></use></svg>';
    },
    bytes(n) {
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    },
    basename(p) { return String(p || '').split(/[\\/]/).pop(); },
    dirname(p) { const s = String(p || ''); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); },
    ext(p) { const m = /\.([^.\\/]+)$/.exec(String(p || '')); return m ? m[1].toLowerCase() : ''; },
    now() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); },
    fuzzyScore(text, query) {
      const a = text.toLowerCase(), b = query.toLowerCase().trim();
      if (!b) return 1;
      if (a.includes(b)) return 100 - a.indexOf(b);
      let qi = 0, score = 0;
      for (let i = 0; i < a.length && qi < b.length; i++) {
        if (a[i] === b[qi]) { score += 2 + (i === 0 ? 3 : 0); qi++; }
      }
      return qi === b.length ? score : 0;
    }
  };

  async function request(method, url, body) {
    const options = { method, headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json; charset=utf-8';
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error('无法连接 CodeCpp 本地服务：' + error.message);
    }
    let payload;
    try { payload = await response.json(); } catch (_) { throw new Error('服务返回了无效响应'); }
    if (!response.ok || payload.ok === false) throw new Error(payload.error || ('请求失败 (' + response.status + ')'));
    return payload;
  }

  CC.api = {
    request,
    get(url, params) {
      const query = new URLSearchParams(params || {}).toString();
      return request('GET', url + (query ? '?' + query : ''));
    },
    post(url, body) { return request('POST', url, body === undefined ? {} : body); },
    bootstrap() { return this.get('/api/bootstrap'); },
    tree(dir) { return this.get('/api/tree', { path: dir || '.' }); },
    files() { return this.get('/api/files'); },
    read(path) { return this.get('/api/file', { path }); },
    save(path, content) { return this.post('/api/file', { path, content }); },
    fs(action, payload) { return this.post('/api/fs', Object.assign({ action }, payload)); },
    search(query, opts) {
      return this.get('/api/search', Object.assign({ query }, opts));
    },
    analyze(content, path) { return this.post('/api/analyze', { content, path }); },
    outline(content) { return this.post('/api/outline', { content }); },
    format(content, options) { return this.post('/api/format', Object.assign({ content }, options)); },
    build(options) { return this.post('/api/build', options || {}); },
    run(options) { return this.post('/api/run', options || {}); },
    terminal(command, cwd) { return this.post('/api/terminal', { command, cwd }); },
    settings(patch) { return patch ? this.post('/api/settings', patch) : this.get('/api/settings'); },
    folder(path) { return this.post('/api/folder', { path }); },
    templates(id, dir) { return this.post('/api/templates', { id, dir }); },
    toolchain(patch) { return patch ? this.post('/api/toolchain/config', patch) : this.get('/api/toolchain'); },
    probe(p) { return this.post('/api/toolchain/probe', { path: p }); },
    compilerStatus() { return this.get('/api/compiler/status'); },
    compilerInstall(payload) { return this.post('/api/compiler/install', payload || {}); },
    compilerCancel() { return this.post('/api/compiler/cancel', {}); },
    reveal(path) { return this.post('/api/reveal', { path }); },
    debug: {
      available() { return request('GET', '/api/debug/available'); },
      state() { return request('GET', '/api/debug/state'); },
      start(options) { return request('POST', '/api/debug/start', options); },
      command(action, argument) { return request('POST', '/api/debug/command', { action, argument }); },
      stop() { return request('POST', '/api/debug/stop', {}); }
    },
    events(onMessage) {
      const source = new EventSource('/api/events');
      source.onmessage = (event) => {
        try { onMessage(JSON.parse(event.data)); } catch (_) {}
      };
      return source;
    }
  };
})();
