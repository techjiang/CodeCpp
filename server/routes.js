'use strict';

const path = require('path');
const paths = require('./paths');
const store = require('./store');
const templates = require('./templates');
const toolchain = require('./toolchain');
const compiler = require('./compiler');
const filesystem = require('./filesystem');
const analyze = require('./analyze');
const symbols = require('./symbols');
const build = require('./build');
const debug = require('./debug');

const VERSION = '1.0.0';

function environment() {
  const p = toolchain.profiles();
  return { profiles: p.profiles, activeId: p.activeId, pathDirs: toolchain.pathDirs() };
}

function ok(data) { return { status: 200, body: Object.assign({ ok: true }, data) }; }
function failure(err) {
  const status = err && (err.code === 'ENOENT' ? 404 : err.code === 'EPERM' ? 403 : err.code === 'EINVAL' || err.code === 'EEXIST' ? 400 : 500);
  return { status, body: { ok: false, error: (err && err.message) || String(err), code: (err && err.code) || 'EIO' } };
}

async function handle(method, pathname, query, body) {
  const data = body || {};
  const q = query || {};
  try {
    if (pathname === '/api/bootstrap' && method === 'GET') {
      const detected = toolchain.detect();
      return ok({
        name: 'CodeCpp', version: VERSION, platform: process.platform,
        root: paths.root(), rootName: path.basename(paths.root()),
        settings: store.read(), toolchain: detected, templates: templates.list(),
        guide: toolchain.GUIDE, environment: environment(),
        capabilities: {
          staticAnalysis: true, outline: true, format: true, search: true,
          compiler: detected.ready, debugger: Boolean(detected.selected.debugger),
          make: Boolean(detected.tools.make), cmake: Boolean(detected.tools.cmake),
          build: detected.ready, run: true, terminal: true
        }
      });
    }

    if (pathname === '/api/toolchain' && method === 'GET') return ok({
      toolchain: toolchain.detect(true), config: toolchain.config(),
      guide: toolchain.GUIDE, environment: environment()
    });
    if (pathname === '/api/toolchain/config' && method === 'POST') {
      const patch = {};
      if (data.compiler) patch.compiler = Object.assign({}, store.read().compiler, data.compiler);
      if (data.debugger) patch.debugger = Object.assign({}, store.read().debugger, data.debugger);
      if (data.make) patch.make = { path: data.make.path || '' };
      if (data.cmake) patch.cmake = { path: data.cmake.path || '' };
      store.update(patch);
      return ok({ toolchain: toolchain.detect(true), config: toolchain.config() });
    }
    if (pathname === '/api/toolchain/probe' && method === 'POST') {
      const info = toolchain.probe(data.path, ['--version']);
      return ok({ found: Boolean(info), info });
    }

    if (pathname === '/api/tree' && method === 'GET') return ok(paths.listDir(q.get('path') || '.'));
    if (pathname === '/api/files' && method === 'GET') {
      const files = [];
      paths.walk(paths.root(), files, {
        exclude: /^(\.git|node_modules|build|dist|\.codecpp)$/, maxDepth: 8, maxFiles: 2000
      });
      return ok({ files: files.map((f) => ({ path: paths.relative(f), name: path.basename(f) })) });
    }
    if (pathname === '/api/file' && method === 'GET') return ok({ file: filesystem.readFile(q.get('path') || '.') });
    if (pathname === '/api/file' && method === 'POST') return ok({ file: filesystem.writeFile(data.path, data.content) });

    if (pathname === '/api/fs' && method === 'POST') {
      const actions = {
        'new-file': () => filesystem.newFile(data.path, data.content),
        'new-folder': () => filesystem.newFolder(data.path),
        rename: () => filesystem.rename(data.path, data.name),
        move: () => filesystem.move(data.path, data.target),
        delete: () => filesystem.remove(data.path),
        stat: () => filesystem.stat(data.path)
      };
      if (!actions[data.action]) throw new Error('未知的文件操作：' + data.action);
      return ok({ result: actions[data.action]() });
    }

    if (pathname === '/api/search' && method === 'GET') {
      return ok(filesystem.search(q.get('query') || '', {
        regex: q.get('regex') === '1', caseSensitive: q.get('caseSensitive') === '1',
        include: q.get('include') || ''
      }));
    }

    if (pathname === '/api/analyze' && method === 'POST') {
      const content = typeof data.content === 'string' ? data.content : filesystem.readFile(data.path).content;
      const result = analyze.analyze(content, data.path || '');
      return ok({ diagnostics: result.diagnostics, outline: symbols.outline(content), file: data.path || '' });
    }
    if (pathname === '/api/outline' && method === 'POST') {
      const content = typeof data.content === 'string' ? data.content : filesystem.readFile(data.path).content;
      return ok(symbols.outline(content));
    }
    if (pathname === '/api/format' && method === 'POST') {
      const content = typeof data.content === 'string' ? data.content : filesystem.readFile(data.path).content;
      const formatted = require('./c-lexer').format(content, data);
      return ok({ content: formatted, changed: formatted !== content });
    }

    if (pathname === '/api/build' && method === 'POST') return ok({ result: await build.build(data) });
    if (pathname === '/api/run' && method === 'POST') return ok({ result: await build.run(data) });
    if (pathname === '/api/terminal' && method === 'POST') return ok({ result: await build.terminal(data.command, data.cwd) });

    if (pathname === '/api/compiler/status' && method === 'GET') return ok(compiler.status());
    if (pathname === '/api/compiler/install' && method === 'POST') return ok(compiler.install(data));
    if (pathname === '/api/compiler/cancel' && method === 'POST') return ok(compiler.cancel());

    if (pathname === '/api/settings' && method === 'GET') return ok({ settings: store.read() });
    if (pathname === '/api/settings' && method === 'POST') return ok({ settings: store.update(data) });

    if (pathname === '/api/folder' && method === 'GET') return ok({ root: paths.root(), name: path.basename(paths.root()) });
    if (pathname === '/api/folder' && method === 'POST') {
      const root = paths.setRoot(data.path);
      return ok({ root, name: path.basename(root), tree: paths.listDir('.') });
    }

    if (pathname === '/api/templates' && method === 'GET') return ok({ templates: templates.list() });
    if (pathname === '/api/templates' && method === 'POST') return ok({ result: templates.create(data.id, data.dir || '.') });

    if (pathname === '/api/debug/available' && method === 'GET') return ok(debug.available());
    if (pathname === '/api/debug/state' && method === 'GET') return ok({ state: await debug.state() });
    if (pathname === '/api/debug/start' && method === 'POST') return ok({ state: await debug.start(data) });
    if (pathname === '/api/debug/command' && method === 'POST') return ok({ state: await debug.command(data.action, data.argument) });
    if (pathname === '/api/debug/stop' && method === 'POST') return ok({ state: debug.stop() });

    if (pathname === '/api/reveal' && method === 'POST') {
      const target = paths.resolveSafe(data.path || '.');
      const { spawn } = require('child_process');
      const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(cmd, [target], { detached: true, stdio: 'ignore' }).unref();
      return ok({ revealed: paths.relative(target) });
    }

    return { status: 404, body: { ok: false, error: '接口不存在：' + method + ' ' + pathname, code: 'ENOENT' } };
  } catch (error) {
    return failure(error);
  }
}

module.exports = { handle, VERSION, ok, failure };
