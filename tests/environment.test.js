'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const routes = require('../server/routes');
const store = require('../server/store');
const toolchain = require('../server/toolchain');

const q = (obj) => new URLSearchParams(obj || {});

test('默认配置包含编译器集与附加 PATH 字段', () => {
  const d = store.defaults();
  assert.ok(Array.isArray(d.toolchains));
  assert.equal(d.activeToolchain, '');
  assert.ok(Array.isArray(d.envPath));
});

test('编译器集列表返回结构与当前集 id', () => {
  const r = toolchain.profiles();
  assert.ok(Array.isArray(r.profiles));
  assert.equal(typeof r.activeId, 'string');
  r.profiles.forEach((p) => {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.name, 'string');
    assert.ok(Array.isArray(p.binDirs));
  });
});

test('附加目录返回去重后的数组', () => {
  const dirs = toolchain.pathDirs();
  assert.ok(Array.isArray(dirs));
  assert.equal(new Set(dirs.map((d) => d.toLowerCase())).size, dirs.length);
});

test('子进程环境注入 PATH 但不污染系统环境', () => {
  const before = process.env.PATH;
  const env = toolchain.childEnv({ LC_ALL: 'C' });
  assert.equal(env.LC_ALL, 'C');
  assert.equal(process.env.PATH, before);
  assert.equal(typeof env.PATH, 'string');
  assert.ok(env.PATH.length >= String(before || '').length);
});

test('bootstrap 返回环境（编译器集 + 附加 PATH）', async () => {
  const r = await routes.handle('GET', '/api/bootstrap', q(), {});
  assert.equal(r.status, 200);
  assert.ok(r.body.environment);
  assert.ok(Array.isArray(r.body.environment.profiles));
  assert.ok(Array.isArray(r.body.environment.pathDirs));
});

test('工具链接口返回环境并带上 profile 信息', async () => {
  const r = await routes.handle('GET', '/api/toolchain', q(), {});
  assert.equal(r.status, 200);
  assert.ok(r.body.environment);
  assert.ok(Array.isArray(r.body.environment.profiles));
  assert.ok(r.body.config);
  assert.ok(Array.isArray(r.body.config.pathDirs));
});
