'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dirs = require('../server/toolchain-dir');
const compiler = require('../server/compiler');

test('内置编译器目录位于用户数据区，便携版只读安装目录也可安装', () => {
  assert.ok(!path.resolve(dirs.root()).startsWith(path.resolve(__dirname, '..')));
  assert.match(dirs.bin(), /mingw64[\\/]bin$/);
});

test('编译器状态包含安装结果与任务进度', () => {
  const status = compiler.status();
  assert.equal(typeof status.installed, 'boolean');
  assert.equal(typeof status.compiler, 'string');
  assert.ok(Array.isArray(status.pages) && status.pages.length > 0);
  assert.ok(status.task && typeof status.task.phase === 'string');
  assert.ok(Array.isArray(status.task.log));
});

test('locate 能在解压目录中定位 mingw64/bin', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codecpp-compiler-'));
  try {
    const bin = path.join(temp, 'mingw64', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'gcc.exe' : 'gcc'), '');
    assert.equal(compiler.locate(temp), bin);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('导入不存在的压缩包时给出明确错误而不是崩溃', async () => {
  compiler.install({ archivePath: path.join(os.tmpdir(), 'codecpp-not-exist.zip') });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const task = compiler.status().task;
  assert.equal(task.phase, 'error');
  assert.match(task.error, /找不到压缩包/);
});
