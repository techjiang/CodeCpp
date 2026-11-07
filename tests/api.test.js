'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../server/paths');
const routes = require('../server/routes');
const templates = require('../server/templates');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codecpp-test-'));
paths.initRoot(temp);
const q = (obj) => new URLSearchParams(obj || {});

test.before(() => {
  fs.writeFileSync(path.join(temp, 'main.c'), '#include <stdio.h>\nint main(void){ printf("hi\\n"); return 0; }\n', 'utf8');
  fs.mkdirSync(path.join(temp, 'include'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'include', 'util.h'), 'int util(void);\n', 'utf8');
});

test('路径安全：拒绝越出工作区的访问', () => {
  assert.equal(paths.relative(paths.resolveSafe('main.c')), 'main.c');
  assert.throws(() => paths.resolveSafe('../outside.c'), /越出工作区/);
  assert.throws(() => paths.resolveSafe(path.join(temp, '..', 'outside.c')), /越出工作区/);
});

test('GET /api/bootstrap 返回能力与模板', async () => {
  const r = await routes.handle('GET', '/api/bootstrap', q(), {});
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'CodeCpp');
  assert.equal(r.body.capabilities.staticAnalysis, true);
  assert.ok(r.body.templates.length >= 4);
  assert.ok(r.body.guide.includes('MSYS2'));
});

test('文件树、读取、写入、新建与删除', async () => {
  const tree = await routes.handle('GET', '/api/tree', q({ path: '.' }), {});
  assert.ok(tree.body.entries.some((e) => e.name === 'main.c'));
  assert.ok(tree.body.entries.some((e) => e.name === 'include' && e.isDir));

  const file = await routes.handle('GET', '/api/file', q({ path: 'main.c' }), {});
  assert.equal(file.body.file.language, 'c');
  assert.ok(file.body.file.content.includes('printf'));

  const written = await routes.handle('POST', '/api/file', q(), { path: 'main.c', content: 'int x;\n' });
  assert.equal(written.status, 200);
  const again = await routes.handle('GET', '/api/file', q({ path: 'main.c' }), {});
  assert.equal(again.body.file.content, 'int x;\n');

  const created = await routes.handle('POST', '/api/fs', q(), { action: 'new-file', path: 'demo.c', content: '// demo\n' });
  assert.equal(created.body.result.path, 'demo.c');
  const renamed = await routes.handle('POST', '/api/fs', q(), { action: 'rename', path: 'demo.c', name: 'demo2.c' });
  assert.equal(renamed.body.result.path, 'demo2.c');
  const removed = await routes.handle('POST', '/api/fs', q(), { action: 'delete', path: 'demo2.c' });
  assert.equal(removed.body.result.removed, 'demo2.c');
});

test('静态分析 / 大纲 / 格式化 / 搜索接口', async () => {
  const bad = 'int main(void){ printf("%d\\n", 1, 2); return 0; }';
  const result = await routes.handle('POST', '/api/analyze', q(), { content: bad, path: 'main.c' });
  assert.ok(result.body.diagnostics.some((d) => d.code === 'C050'));
  assert.ok(result.body.outline.symbols.some((s) => s.name === 'main'));

  const formatted = await routes.handle('POST', '/api/format', q(), { content: 'int main(){\nreturn 0;\n}\n', tabSize: 4, insertSpaces: true });
  assert.ok(formatted.body.content.includes('\n    return 0;'));

  const search = await routes.handle('GET', '/api/search', q({ query: 'printf' }), {});
  assert.ok(search.body.matches.some((m) => m.file === 'main.c') === false, '写入后的内容不含 printf');
  fs.writeFileSync(path.join(temp, 'main.c'), '#include <stdio.h>\nint main(void){ printf("hi\\n"); return 0; }\n', 'utf8');
  const search2 = await routes.handle('GET', '/api/search', q({ query: 'printf' }), {});
  assert.ok(search2.body.matches.some((m) => m.file === 'main.c'));
});

test('项目模板写入工作区且不覆盖已有文件', async () => {
  const r = await routes.handle('POST', '/api/templates', q(), { id: 'multi', dir: '.' });
  assert.equal(r.status, 200);
  assert.ok(r.body.result.created.includes('src/main.c'));
  assert.ok(fs.existsSync(path.join(temp, 'Makefile')));
  const second = await routes.handle('POST', '/api/templates', q(), { id: 'multi', dir: '.' });
  assert.equal(second.body.result.created.length, 0);
  assert.equal(second.body.result.skipped, Object.keys(templates.TEMPLATES.find((t) => t.id === 'multi').files).length);
});

test('构建接口在无编译器时给出安装指引，终端接口可执行命令', async () => {
  const build = await routes.handle('POST', '/api/build', q(), {});
  assert.equal(build.status, 200);
  assert.equal(typeof build.body.result.ok, 'boolean');
  assert.ok(build.body.result.command !== undefined);

  const term = await routes.handle('POST', '/api/terminal', q(), { command: 'echo CodeCppOK' });
  assert.equal(term.status, 200);
  assert.ok(term.body.result.output.includes('CodeCppOK'));
});

test('调试状态接口在会话未启动时返回非活动状态', async () => {
  const state = await routes.handle('GET', '/api/debug/state', q(), {});
  assert.equal(state.status, 200);
  assert.equal(state.body.state.active, false);
});

test.after(() => {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
});
