'use strict';

/* 内置编译器安装目录：放在用户数据区，便携版放在只读目录时也能安装 */
const os = require('os');
const path = require('path');

function root() {
  if (process.env.CODECPP_TOOLCHAIN_DIR) return path.resolve(process.env.CODECPP_TOOLCHAIN_DIR);
  const base = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'codecpp', 'toolchain');
}

function bin() { return path.join(root(), 'mingw64', 'bin'); }
function downloads() { return path.join(root(), 'downloads'); }
function staging() { return path.join(root(), 'staging'); }

module.exports = { root, bin, downloads, staging };
