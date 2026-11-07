'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const toolchain = require('./toolchain');
const store = require('./store');

function splitArgs(text) {
  const out = [];
  const source = String(text || '');
  let current = '', quote = null, started = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) { out.push(current); current = ''; started = false; }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}

function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    try { return new TextDecoder('gbk').decode(buf); } catch (_) { return buf.toString('utf8'); }
  }
}

function exec(bin, args, options) {
  const opts = options || {};
  return new Promise((resolve) => {
    const started = Date.now();
    let out = Buffer.alloc(0), err = Buffer.alloc(0), settled = false;
    let child;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd || paths.root(), windowsHide: true, env: toolchain.childEnv(),
        shell: Boolean(opts.shell)
      });
    } catch (error) {
      return resolve({ code: -1, stdout: '', stderr: String(error.message || error), duration: 0, killed: false });
    }
    const finish = (code, killed) => {
      if (settled) return;
      settled = true;
      resolve({
        code, stdout: decode(out), stderr: decode(err),
        duration: Date.now() - started, killed: Boolean(killed)
      });
    };
    const limit = opts.maxBuffer || 4 * 1024 * 1024;
    child.stdout && child.stdout.on('data', (chunk) => {
      if (out.length < limit) out = Buffer.concat([out, chunk]);
    });
    child.stderr && child.stderr.on('data', (chunk) => {
      if (err.length < limit) err = Buffer.concat([err, chunk]);
    });
    child.on('error', (error) => { err = Buffer.concat([err, Buffer.from(String(error.message || error))]); finish(-1, false); });
    child.on('close', (code) => finish(code === null ? -1 : code, child.killed));
    const timer = setTimeout(() => {
      if (!settled) { try { child.kill(); } catch (_) {} finish(-1, true); }
    }, opts.timeout || 60000);
    timer.unref && timer.unref();
    if (opts.stdin) {
      try { child.stdin.write(opts.stdin); } catch (_) {}
    }
    if (child.stdin) { try { child.stdin.end(); } catch (_) {} }
  });
}

function parseDiagnostics(text, root) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  const patterns = [
    /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning|note|remark):\s*(.*)$/,
    /^(.+?):(\d+):\s*(fatal error|error|warning|note|remark):\s*(.*)$/,
    /^\s*(.+?)\((\d+)\):\s*(fatal error|error|warning)\s+([A-Z]+\d+):\s*(.*)$/
  ];
  for (const line of lines) {
    let m = patterns[0].exec(line);
    if (m) {
      out.push(make(m[1], Number(m[2]), Number(m[3]), m[4], m[5], root));
      continue;
    }
    m = patterns[1].exec(line);
    if (m) { out.push(make(m[1], Number(m[2]), 1, m[3], m[4], root)); continue; }
    m = patterns[2].exec(line);
    if (m) { out.push(make(m[1], Number(m[2]), 1, m[3], m[5] + ' (' + m[4] + ')', root)); continue; }
    const linker = /^(?:.*collect2:.*|.*ld:.*(?:error|undefined reference).*|.*undefined reference to.*)$/i.exec(line);
    if (linker && line.trim()) {
      out.push({ severity: 'error', line: 0, column: 1, endColumn: 1, file: '', message: line.trim(), code: 'LNK', source: '链接器' });
    }
  }
  const seen = new Set();
  return out.filter((d) => {
    const key = [d.file, d.line, d.column, d.severity, d.message].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function make(file, line, column, severity, message, root) {
  let rel = file.replace(/\\/g, '/');
  if (path.isAbsolute(file)) rel = path.relative(root || paths.root(), file).replace(/\\/g, '/');
  rel = rel.replace(/^\.\//, '');
  const level = severity.includes('fatal') ? 'error' : severity === 'note' || severity === 'remark' ? 'info' : severity;
  const code = /\[-W([^\]]+)\]/.exec(message);
  return {
    severity: level, line, column, endColumn: column + 1, file: rel,
    message: message.replace(/\s*\[-W[^\]]+\]\s*$/, '').trim(),
    code: code ? 'W:' + code[1] : '', source: '编译器'
  };
}

function collectSources() {
  const files = [];
  paths.walk(paths.root(), files, {
    exclude: /^(\.git|node_modules|build|dist|\.codecpp)$/, maxDepth: 6, maxFiles: 600
  });
  return files.filter((f) => /\.c$/i.test(f)).map((f) => paths.relative(f));
}

function outputInfo(output) {
  const rel = output || store.read().build.output || 'build/app';
  const abs = path.resolve(paths.root(), rel);
  const exe = process.platform === 'win32' && !/\.(exe|com)$/i.test(rel) ? abs + '.exe' : abs;
  return { rel, abs, exe, dir: path.dirname(abs) };
}

function chooseMode(requested, sources) {
  if (requested && requested !== 'auto') return requested;
  const root = paths.root();
  if (fs.existsSync(path.join(root, 'Makefile')) || fs.existsSync(path.join(root, 'makefile'))) return 'make';
  if (fs.existsSync(path.join(root, 'CMakeLists.txt'))) return 'cmake';
  if (sources.length === 1) return 'single';
  return 'multi';
}

function findProgram(out) {
  const candidates = [out.exe, out.abs, path.join(out.dir, 'app.exe'), path.join(out.dir, 'app')];
  for (const c of candidates) { try { if (fs.statSync(c).isFile()) return paths.relative(c); } catch (_) {} }
  const found = [];
  paths.walk(paths.root(), found, { exclude: /^(\.git|node_modules|\.codecpp)$/, maxDepth: 5, maxFiles: 400 });
  const exes = found.filter((f) => /\.exe$/i.test(f) || (!path.extname(f) && process.platform !== 'win32'));
  return exes.length ? paths.relative(exes[0]) : '';
}

async function build(options) {
  const opts = options || {};
  const cfg = toolchain.config();
  if (!cfg.ready) {
    return {
      ok: false, missingToolchain: true, command: '', output: toolchain.GUIDE,
      diagnostics: [], duration: 0, program: ''
    };
  }
  const settings = store.read();
  const sources = (opts.files && opts.files.length ? opts.files : collectSources()).filter((f) => /\.c$/i.test(f));
  const out = outputInfo(opts.output || settings.build.output);
  fs.mkdirSync(out.dir, { recursive: true });
  const mode = chooseMode(opts.mode || settings.build.mode, sources);
  let bin = cfg.compiler, args = [], display = '';
  const flags = splitArgs(opts.flags !== undefined ? opts.flags : cfg.flags);
  const linkerFlags = splitArgs(cfg.linkerFlags);

  if (mode === 'make' || mode === 'cmake') {
    const isCmake = mode === 'cmake';
    const tool = isCmake ? cfg.cmake : cfg.make;
    if (!tool) {
      return {
        ok: false, command: '', output: `未找到 ${isCmake ? 'cmake' : 'make'}，请在「设置 → 工具链」中配置，或切换为单文件编译模式。`,
        diagnostics: [], duration: 0, program: ''
      };
    }
    bin = tool;
    if (isCmake) {
      const first = await exec(bin, ['-S', '.', '-B', 'build'], { timeout: 120000 });
      const second = first.code === 0
        ? await exec(bin, ['--build', 'build'], { timeout: 120000 })
        : { code: first.code, stdout: '', stderr: '', duration: 0 };
      const text = [first.stdout, first.stderr, second.stdout, second.stderr].filter(Boolean).join('\n');
      return {
        ok: second.code === 0 && first.code === 0, mode, command: `${bin} -S . -B build && ${bin} --build build`,
        output: text, diagnostics: parseDiagnostics(text, paths.root()),
        duration: first.duration + second.duration, program: findProgram(out)
      };
    }
    display = `${bin} (Makefile)`;
  } else {
    if (!sources.length) {
      return { ok: false, command: '', output: '工作区中没有找到 .c 源文件。', diagnostics: [], duration: 0, program: '' };
    }
    args = [
      '-std=' + (opts.standard || cfg.standard),
      ...flags,
      ...sources,
      '-o', out.rel,
      ...linkerFlags
    ];
    if (mode === 'multi') args.push('-I.', '-Iinclude', '-Isrc');
    display = bin + ' ' + args.join(' ');
  }

  const result = await exec(bin, args, { cwd: paths.root(), timeout: 120000 });
  const text = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const diagnostics = parseDiagnostics(text, paths.root());
  return {
    ok: result.code === 0, mode, command: display || '', output: text || '(编译器没有输出)',
    diagnostics, duration: result.duration, program: result.code === 0 ? findProgram(out) : '',
    killed: result.killed
  };
}

async function run(options) {
  const opts = options || {};
  const settings = store.read();
  const rel = opts.program || settings.build.output;
  const out = outputInfo(rel);
  let program = out.exe;
  if (!fs.existsSync(program) && fs.existsSync(out.abs)) program = out.abs;
  if (!fs.existsSync(program)) {
    return { ok: false, code: -1, stdout: '', stderr: '可执行文件不存在，请先构建（Ctrl+B）。\n期望路径：' + out.exe, duration: 0 };
  }
  const result = await exec(program, splitArgs(opts.args !== undefined ? opts.args : settings.build.args), {
    cwd: opts.cwd ? paths.resolveSafe(opts.cwd) : paths.root(),
    stdin: opts.stdin !== undefined ? opts.stdin : settings.build.stdin,
    timeout: Number(opts.timeout) || 30000
  });
  return Object.assign({ ok: result.code === 0, program: paths.relative(program) }, result,
    { timedOut: result.killed, exitText: result.killed ? '运行超时，进程已终止' : `进程退出，代码 ${result.code}` });
}

async function terminal(command, cwd) {
  if (!command || typeof command !== 'string') throw new Error('命令不能为空');
  const workDir = cwd ? paths.resolveSafe(cwd) : paths.root();
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
  const result = await exec(shell, shellArgs, { cwd: workDir, timeout: 20000, shell: false });
  const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return {
    code: result.code, output: text.trim() || (result.killed ? '命令执行超时' : '(无输出)'),
    duration: result.duration, timedOut: result.killed, cwd: paths.relative(workDir)
  };
}

module.exports = { build, run, terminal, parseDiagnostics, collectSources, outputInfo, findProgram, splitArgs, exec, decode };
