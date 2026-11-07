'use strict';

const fs = require('fs');
const path = require('path');

const IDE_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(IDE_ROOT, '.codecpp');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  version: 1,
  theme: 'dark',
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: false,
  minimap: true,
  lineNumbers: true,
  autoSave: false,
  autoSaveDelay: 1200,
  compiler: {
    path: '',
    flags: '-Wall -Wextra -Wpedantic -g -O0',
    standard: 'c11',
    linkerFlags: ''
  },
  debugger: { path: '', args: '' },
  make: { path: '' },
  cmake: { path: '' },
  toolchains: [],
  activeToolchain: '',
  envPath: [],
  build: {
    mode: 'auto',
    output: 'build/app',
    args: '',
    stdin: ''
  },
  lastRoot: '',
  recentFiles: [],
  breakpoints: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = Object.assign({}, base);
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

let cache = null;

function read() {
  if (cache) return cache;
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (_) {
    parsed = {};
  }
  cache = deepMerge(clone(DEFAULTS), parsed);
  return cache;
}

function write(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  cache = deepMerge(read(), next || {});
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}

function update(patch) {
  return write(patch);
}

function defaults() {
  return clone(DEFAULTS);
}

function dataDir() {
  return DATA_DIR;
}

module.exports = { IDE_ROOT, DATA_DIR, read, write, update, defaults, deepMerge, clone };
