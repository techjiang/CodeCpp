'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const paths = require('./paths');
const toolchain = require('./toolchain');
const { splitArgs } = require('./build');

function parseValue(text, state) {
  const s = text;
  let i = state.i;
  const ch = s[i];
  if (ch === '"') {
    i++;
    let out = '';
    while (i < s.length) {
      const c = s[i++];
      if (c === '"') break;
      if (c === '\\') {
        const n = s[i++];
        const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '0': '\0' };
        out += map[n] !== undefined ? map[n] : n;
      } else out += c;
    }
    state.i = i;
    return out;
  }
  if (ch === '{' || ch === '[') {
    const close = ch === '{' ? '}' : ']';
    const isObj = ch === '{';
    const result = isObj ? {} : [];
    i++;
    while (i < s.length) {
      while (s[i] === ' ') i++;
      if (s[i] === close) { i++; break; }
      if (s[i] === ',') { i++; continue; }
      let key = null;
      if (isObj || /^[A-Za-z_]/.test(s[i] || '') && s.slice(i).startsWith(s.slice(i).split(/[=,]/)[0] + '=')) {
        const eq = s.indexOf('=', i);
        const comma = s.indexOf(',', i);
        if (eq > -1 && (comma === -1 || eq < comma)) {
          key = s.slice(i, eq).trim();
          i = eq + 1;
        }
      }
      state.i = i;
      let value;
      if (s[i] === '"' || s[i] === '{' || s[i] === '[') value = parseValue(s, state);
      else {
        const start = i;
        while (i < s.length && s[i] !== ',' && s[i] !== close) i++;
        value = s.slice(start, i).trim();
        state.i = i;
      }
      i = state.i;
      if (isObj) {
        if (key) result[key] = value;
      } else if (key && /^(frame|bkpt|variable|child|arg)$/.test(key)) {
        result.push(value && typeof value === 'object' ? value : { name: key, value });
      } else if (key) result.push(Object.assign({ name: key }, typeof value === 'object' ? value : { value }));
      else result.push(value);
      while (s[i] === ' ') i++;
      if (s[i] === ',') i++;
      state.i = i;
    }
    state.i = i;
    return result;
  }
  const start = i;
  while (i < s.length && s[i] !== ',' && s[i] !== '}' && s[i] !== ']') i++;
  state.i = i;
  return s.slice(start, i).trim();
}

function parseRecord(rest) {
  const comma = rest.indexOf(',');
  const name = comma < 0 ? rest.trim() : rest.slice(0, comma).trim();
  const payload = comma < 0 ? '' : rest.slice(comma + 1);
  const result = {};
  if (payload) {
    let i = 0;
    while (i < payload.length) {
      while (payload[i] === ' ') i++;
      const eq = payload.indexOf('=', i);
      if (eq < 0) break;
      const key = payload.slice(i, eq).trim();
      i = eq + 1;
      const state = { i };
      result[key] = parseValue(payload, state);
      i = state.i;
      while (payload[i] === ' ' || payload[i] === ',') i++;
    }
  }
  return { name, result };
}

function cString(text) {
  return '"' + String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

class GdbSession {
  constructor(program, options) {
    this.program = program;
    this.options = options || {};
    this.child = null;
    this.buffer = '';
    this.consoleLines = [];
    this.pending = null;
    this.stopWaiters = [];
    this.active = false;
    this.running = false;
    this.stopped = null;
    this.frames = [];
    this.variables = [];
    this.breakpoints = [];
    this.readyWaiters = [];
    this.seq = 0;
  }

  async start() {
    const cfg = toolchain.config();
    const gdb = this.options.gdb || cfg.debugger;
    if (!gdb) {
      const err = new Error('未配置调试器 gdb。' + toolchain.GUIDE.split('\n').slice(0, 4).join(' / '));
      err.code = 'NO_GDB';
      throw err;
    }
    const abs = path.resolve(paths.root(), this.program);
    if (!fs.existsSync(abs)) throw new Error('可执行文件不存在，请先构建：' + this.program);
    const args = ['-q', '--interpreter=mi2'];
    if (this.options.gdbArgs) args.push(...splitArgs(this.options.gdbArgs));
    args.push(abs);
    this.child = spawn(gdb, args, {
      cwd: paths.root(), windowsHide: true, env: toolchain.childEnv({ LC_ALL: 'C' })
    });
    this.active = true;
    this.child.stdout.on('data', (chunk) => this.onData(chunk.toString('utf8')));
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) this.consoleLines.push('[gdb] ' + text);
    });
    this.child.on('error', (error) => this.pushConsole('[gdb 错误] ' + error.message));
    this.child.on('close', () => {
      this.active = false;
      this.running = false;
      this.flushStop(null);
      if (this.pending) { this.pending.resolve({ error: 'gdb 已退出' }); this.pending = null; }
    });
    await this.waitReady(6000);
    await this.send('-gdb-set confirm off');
    await this.send('-gdb-set pagination off');
    if (this.options.args) await this.send('-exec-arguments ' + splitArgs(this.options.args).join(' '));
    const bps = this.options.breakpoints || [];
    for (const bp of bps) {
      const file = path.resolve(paths.root(), bp.file || '');
      await this.send('-break-insert --source ' + cString(file.replace(/\\/g, '/')) + ' --line ' + Number(bp.line || 1));
    }
    if (!bps.length) await this.send('-break-insert main');
    await this.send('-exec-run');
    await this.waitForStop(8000);
    return this.snapshot();
  }

  pushConsole(text) {
    if (this.consoleLines.length > 300) this.consoleLines.shift();
    this.consoleLines.push(text);
  }

  onData(chunk) {
    this.buffer += chunk;
    let lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const line of lines) this.handleLine(line);
    if (/^\(gdb\)\s*$/.test(this.buffer)) {
      this.handleLine(this.buffer);
      this.buffer = '';
    }
  }

  handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^\(gdb\)/.test(trimmed)) {
      this.readyWaiters.splice(0).forEach((fn) => fn());
      return;
    }
    const prefix = trimmed[0];
    const rest = trimmed.slice(1);
    if (prefix === '~' || prefix === '&' || prefix === '@') {
      let text = rest;
      try { text = parseValue(rest, { i: 0 }); } catch (_) {}
      if (String(text).trim()) this.pushConsole(String(text).replace(/\s+$/, ''));
      return;
    }
    if (prefix === '*') {
      const rec = parseRecord(rest);
      if (rec.name === 'stopped') {
        this.running = false;
        this.stopped = rec.result;
        this.flushStop(rec.result);
      } else if (rec.name === 'running') this.running = true;
      return;
    }
    if (prefix === '^') {
      const rec = parseRecord(rest);
      this.lastResult = rec;
      if (rec.name === 'exit') this.active = false;
      const pending = this.pending;
      if (pending) {
        this.pending = null;
        clearTimeout(pending.timer);
        setTimeout(() => pending.resolve(rec), 60);
      }
    }
  }

  waitReady(timeout) {
    if (this.lastResult || this.consoleLines.length) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), timeout);
      this.readyWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  send(command, timeout) {
    if (!this.active || !this.child || !this.child.stdin.writable) {
      return Promise.resolve({ name: 'error', result: { msg: '调试会话未运行' } });
    }
    this.pushConsole('> ' + command);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending) { this.pending = null; resolve({ name: 'error', result: { msg: 'gdb 响应超时' } }); }
      }, timeout || 6000);
      this.pending = { resolve, timer };
      try { this.child.stdin.write(command + '\n'); } catch (error) { resolve({ name: 'error', result: { msg: error.message } }); }
    });
  }

  flushStop(value) {
    const waiters = this.stopWaiters.splice(0);
    waiters.forEach((fn) => fn(value));
  }

  waitForStop(timeout) {
    if (this.stopped && !this.running) return Promise.resolve(this.stopped);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.stopWaiters = this.stopWaiters.filter((w) => w !== wrapper);
        resolve(this.stopped);
      }, timeout || 6000);
      const wrapper = (value) => { clearTimeout(timer); resolve(value); };
      this.stopWaiters.push(wrapper);
    });
  }

  async refresh() {
    const frames = await this.send('-stack-list-frames');
    const rawFrames = frames.result && frames.result.stack;
    this.frames = Array.isArray(rawFrames)
      ? rawFrames.map((f) => ({
          level: Number(f.level || 0), func: f.func || '??', file: f.file || '',
          fullname: f.fullname || '', line: Number(f.line || 0), addr: f.addr || ''
        }))
      : [];
    const vars = await this.send('-stack-list-variables --simple-values');
    const rawVars = vars.result && vars.result.variables;
    this.variables = Array.isArray(rawVars)
      ? rawVars.map((v) => ({ name: v.name || '?', value: v.value === undefined ? '(未初始化)' : v.value, type: v.type || '', scope: v.in_scope || 'true' }))
      : [];
    const bps = await this.send('-break-list');
    const table = bps.result && bps.result.BreakpointTable;
    const body = table && table.body;
    this.breakpoints = Array.isArray(body)
      ? body.map((b) => ({ number: b.number, line: Number(b.line || 0), file: b.fullname || b.file || '', enabled: b.enabled === 'y' }))
      : [];
  }

  snapshot() {
    return {
      active: this.active,
      program: this.program,
      running: this.running,
      stopped: this.stopped ? {
        reason: this.stopped.reason || '',
        frame: this.stopped.frame || null,
        signal: this.stopped['signal-name'] || ''
      } : null,
      frames: this.frames,
      variables: this.variables,
      breakpoints: this.breakpoints,
      console: this.consoleLines.slice(-120)
    };
  }

  async command(action, argument) {
    if (!this.active) throw new Error('调试会话未启动');
    const map = {
      continue: '-exec-continue', next: '-exec-next', step: '-exec-step',
      finish: '-exec-finish', until: '-exec-until', interrupt: '-exec-interrupt',
      reverse: '-exec-jump'
    };
    if (action === 'evaluate') {
      const result = await this.send('-data-evaluate-expression ' + cString(argument || ''));
      return Object.assign(this.snapshot(), { evaluation: (result.result && result.result.value) || (result.result && result.result.msg) || '' });
    }
    if (action === 'raw') {
      const result = await this.send(String(argument || '').replace(/^-/, '-'));
      await this.refresh();
      return this.snapshot();
    }
    if (action === 'break') {
      const file = path.resolve(paths.root(), argument.file || '');
      const result = await this.send('-break-insert --source ' + cString(file.replace(/\\/g, '/')) + ' --line ' + Number(argument.line || 1));
      await this.refresh();
      return Object.assign(this.snapshot(), { message: result.name === 'done' ? '断点已添加' : '断点添加失败：' + ((result.result && result.result.msg) || '') });
    }
    if (action === 'removeBreak') {
      await this.send('-break-delete ' + Number(argument.number || argument || 0));
      await this.refresh();
      return this.snapshot();
    }
    const cmd = map[action];
    if (!cmd) return Object.assign(this.snapshot(), { message: '未知调试命令：' + action });
    this.stopped = null;
    const result = await this.send(cmd);
    if (action !== 'interrupt') await this.waitForStop(8000);
    await this.refresh();
    return Object.assign(this.snapshot(), {
      message: result.name === 'error' ? ((result.result && result.result.msg) || '调试命令执行失败') : ''
    });
  }

  stop() {
    if (this.active && this.child) {
      try { this.send('-gdb-exit'); } catch (_) {}
      setTimeout(() => { try { this.child && this.child.kill(); } catch (_) {} }, 200);
    }
    this.active = false;
    this.flushStop(null);
  }
}

let current = null;

async function start(options) {
  if (current && current.active) current.stop();
  const opts = options || {};
  const session = new GdbSession(opts.program, opts);
  current = session;
  try {
    await session.start();
    await session.refresh();
    return session.snapshot();
  } catch (error) {
    session.stop();
    current = null;
    throw error;
  }
}

async function command(action, argument) {
  if (!current || !current.active) throw new Error('调试会话未启动');
  return current.command(action, argument);
}

async function state() {
  return current && current.active ? current.snapshot() : { active: false, frames: [], variables: [], breakpoints: [], console: [] };
}

function stop() {
  if (current) current.stop();
  current = null;
  return { active: false };
}

function available() {
  const cfg = toolchain.config();
  return { available: Boolean(cfg.debugger), debugger: cfg.debugger, guide: cfg.debugger ? '' : toolchain.GUIDE };
}

module.exports = { start, command, state, stop, available, GdbSession, parseValue, parseRecord };
