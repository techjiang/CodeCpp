'use strict';

/* CodeCpp 桌面应用主进程：内嵌本地服务 + 独立原生窗口 */
const { app, BrowserWindow, ipcMain, Menu, Tray, shell, dialog, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../server/index.js');
const store = require('../server/store');
const paths = require('../server/paths');

const ROOT = path.resolve(__dirname, '..');
const ICON = path.join(__dirname, 'icon.ico');
const TRAY_ICON = path.join(__dirname, 'icon-tray.png');
const STATE_FILE = path.join(store.DATA_DIR, 'window-state.json');
const LOG_FILE = path.join(app.getPath('userData'), 'codecpp.log');
const SELF_TEST = process.argv.includes('--self-test');
const DEV = process.argv.includes('--dev');

let win = null;
let tray = null;
let runtime = null;
let shutdownStarted = false;
let consoleErrors = [];
let balloonShown = false;
let unsavedCount = 0;
let quitConfirmed = false;
let quitPromptOpen = false;
let saveAllSeq = 0;
const saveAllPending = new Map();

app.setAppUserModelId('cn.techjiang.codecpp');

function log(level, message) {
  const line = '[' + new Date().toISOString() + '] [' + level + '] ' + String(message) + '\n';
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const stat = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
    if (stat && stat.size > 512 * 1024) fs.writeFileSync(LOG_FILE, line, 'utf8');
    else fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (_) {}
}

process.on('uncaughtException', (error) => {
  log('error', 'uncaughtException: ' + String(error && error.stack || error));
  try { dialog.showErrorBox('CodeCpp 运行错误', String(error && error.message || error)); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
  log('error', 'unhandledRejection: ' + String(reason && reason.stack || reason));
});

function sendCommand(id) {
  if (win && !win.isDestroyed()) win.webContents.send('codecpp:command', id);
}

function windowState() {
  return {
    maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()),
    fullscreen: Boolean(win && !win.isDestroyed() && win.isFullScreen())
  };
}

function savedBoundsOnScreen(state) {
  if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return state.x >= area.x - 80 && state.x <= area.x + area.width - 100 &&
      state.y >= area.y - 40 && state.y <= area.y + area.height - 100;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(bootstrap).catch((error) => {
    dialog.showErrorBox('CodeCpp 启动失败', String(error && error.stack || error));
    app.exit(1);
  });
}

function readWindowState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (_) { return {}; }
}

function saveWindowState() {
  if (!win || win.isDestroyed() || SELF_TEST) return;
  try {
    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    const bounds = win.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify(Object.assign({}, bounds, {
      maximized: win.isMaximized()
    })), 'utf8');
  } catch (_) {}
}

function commandItem(label, id) {
  return { label, click: () => sendCommand(id) };
}

function applicationMenu() {
  const template = [
    {
      label: 'CodeCpp',
      submenu: [
        commandItem('关于 CodeCpp', 'about'),
        { type: 'separator' },
        { label: '重新加载界面', click: () => win && win.reload() },
        { label: '打开运行日志', click: () => shell.openPath(LOG_FILE) },
        { type: 'separator' },
        { label: '退出 CodeCpp', click: () => requestQuit() }
      ]
    },
    {
      label: '文件',
      submenu: [
        commandItem('新建 C 文件', 'newFile'),
        commandItem('新建文件夹', 'newFolder'),
        commandItem('打开文件夹…', 'openFolder'),
        commandItem('快速打开文件', 'quickOpen'),
        { type: 'separator' },
        commandItem('保存', 'save'),
        commandItem('全部保存', 'saveAll'),
        commandItem('关闭当前编辑器', 'closeTab')
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        commandItem('查找', 'find'),
        commandItem('查找并替换', 'replace'),
        commandItem('跳转到行…', 'gotoLine'),
        commandItem('格式化文档', 'format'),
        commandItem('重新进行静态分析', 'analyze'),
        commandItem('跳转到下一个问题', 'nextProblem')
      ]
    },
    {
      label: '搜索',
      submenu: [
        commandItem('查找', 'find'),
        commandItem('查找并替换', 'replace'),
        commandItem('跳转到行…', 'gotoLine'),
        commandItem('在全部文件中搜索', 'showSearch'),
        commandItem('跳转到下一个问题', 'nextProblem')
      ]
    },
    {
      label: '视图',
      submenu: [
        commandItem('资源管理器', 'showExplorer'),
        commandItem('在全部文件中搜索', 'showSearch'),
        commandItem('符号大纲', 'showOutline'),
        commandItem('项目模板', 'showTemplates'),
        commandItem('问题面板', 'showProblems'),
        commandItem('显示/隐藏侧边栏', 'toggleSidebar'),
        commandItem('显示/隐藏底部面板', 'togglePanel'),
        { type: 'separator' },
        commandItem('切换主题', 'toggleTheme'),
        commandItem('打开设置', 'showSettings'),
        commandItem('欢迎页', 'welcome'),
        { type: 'separator' },
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '项目',
      submenu: [
        commandItem('打开文件夹…', 'openFolder'),
        commandItem('项目模板', 'showTemplates'),
        { type: 'separator' },
        commandItem('构建工程', 'build'),
        commandItem('构建并运行', 'buildAndRun'),
        { type: 'separator' },
        commandItem('打开设置', 'showSettings')
      ]
    },
    {
      label: '运行',
      submenu: [
        commandItem('构建工程', 'build'),
        commandItem('运行程序', 'run'),
        commandItem('构建并运行', 'buildAndRun'),
        { type: 'separator' },
        commandItem('打开集成终端', 'terminal'),
        commandItem('查看构建输出', 'showOutput'),
        commandItem('清空输出与编译器诊断', 'cleanOutput'),
        { type: 'separator' },
        commandItem('重新检测 C 工具链', 'detectToolchain')
      ]
    },
    {
      label: '调试',
      submenu: [
        commandItem('启动 gdb 调试', 'startDebug'),
        commandItem('继续', 'debugContinue'),
        commandItem('单步跳过', 'debugStepOver'),
        commandItem('单步步入', 'debugStepInto'),
        commandItem('步出', 'debugStepOut'),
        { type: 'separator' },
        commandItem('切换断点', 'toggleBreakpoint'),
        commandItem('停止调试', 'stopDebug'),
        commandItem('重启调试', 'restartDebug'),
        commandItem('显示运行和调试', 'showDebug')
      ]
    },
    {
      label: '工具',
      submenu: [
        commandItem('安装 / 管理编译器', 'installCompiler'),
        commandItem('打开设置', 'showSettings'),
        commandItem('重新检测 C 工具链', 'detectToolchain'),
        { type: 'separator' },
        commandItem('重新进行静态分析', 'analyze'),
        commandItem('格式化文档', 'format'),
        { type: 'separator' },
        commandItem('切换主题', 'toggleTheme')
      ]
    },
    {
      label: '帮助',
      submenu: [commandItem('帮助与快捷键', 'showHelp'), commandItem('关于 CodeCpp', 'about')]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        { type: 'separator' },
        { label: '隐藏到托盘', click: () => win && win.close() },
        { role: 'close' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  applicationMenu();
  try {
    runtime = await startServer({ embedded: true, port: 0 });
  } catch (error) {
    dialog.showErrorBox('CodeCpp 服务启动失败', String(error && error.message || error));
    app.exit(1);
    return;
  }
  createWindow();
  createTray();
  registerIpc();
  registerShutdown();
  if (DEV && win) win.webContents.openDevTools({ mode: 'detach' });
  if (SELF_TEST) runSelfTest();
}

function createWindow() {
  const state = readWindowState();
  win = new BrowserWindow({
    title: 'CodeCpp · C 语言高级开发环境',
    width: Number(state.width) || 1440,
    height: Number(state.height) || 900,
    x: savedBoundsOnScreen(state) ? state.x : undefined,
    y: savedBoundsOnScreen(state) ? state.y : undefined,
    minWidth: 1000,
    minHeight: 620,
    backgroundColor: '#0c1119',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  win.loadURL(runtime.url).catch((error) => log('error', 'loadURL: ' + String(error && error.message || error)));
  win.webContents.once('did-finish-load', sendWindowState);
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    log('error', '页面加载失败 ' + code + ' ' + description + ' ' + url);
    dialog.showMessageBox(win, {
      type: 'error', title: 'CodeCpp', message: '界面加载失败',
      detail: String(description || ''), buttons: ['重新加载', '退出 CodeCpp']
    }).then(({ response }) => {
      if (response === 0) win.reload();
      else requestQuit(true);
    }).catch(() => {});
  });
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
    win.focus();
    sendWindowState();
  });
  win.webContents.on('console-message', (...args) => {
    const first = args[0] && typeof args[0] === 'object' ? args[0] : null;
    const detail = args[1] && typeof args[1] === 'object' ? args[1] : first;
    const level = detail && typeof detail === 'object' ? detail.level : args[1];
    const message = detail && typeof detail === 'object' ? detail.message : args[2];
    if (level === 3 || level === 'error' || level === '3' || level === 'fatal') {
      consoleErrors.push(String(message || ''));
      log('error', 'console: ' + String(message || ''));
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    const text = 'render-process-gone: ' + details.reason;
    consoleErrors.push(text);
    log('error', text);
    dialog.showMessageBox(win, {
      type: 'error', title: 'CodeCpp', message: '界面进程意外结束',
      detail: String(details.reason || ''), buttons: ['重新加载', '退出 CodeCpp']
    }).then(({ response }) => {
      if (response === 0) win.reload();
      else requestQuit(true);
    }).catch(() => {});
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('maximize', sendWindowState);
  win.on('unmaximize', sendWindowState);
  win.on('enter-full-screen', sendWindowState);
  win.on('leave-full-screen', sendWindowState);
  win.on('close', (event) => {
    saveWindowState();
    if (shutdownStarted || SELF_TEST) return;
    event.preventDefault();
    if (!tray) {
      log('warn', '托盘不可用，关闭窗口改为退出应用');
      requestQuit();
      return;
    }
    win.hide();
    if (tray && !balloonShown) {
      balloonShown = true;
      try {
        tray.displayBalloon({
          title: 'CodeCpp',
          content: '已最小化到系统托盘。右键托盘图标可完全退出 CodeCpp。'
        });
      } catch (_) {}
    }
  });
}

function sendWindowState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('codecpp:window-state', windowState());
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendWindowState();
}

function createTray() {
  try {
    const image = fs.existsSync(TRAY_ICON) ? nativeImage.createFromPath(TRAY_ICON) : nativeImage.createFromPath(ICON);
    tray = new Tray(image.resize({ width: 16, height: 16 }));
    tray.setToolTip('CodeCpp · C 语言高级开发环境');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 CodeCpp', click: showWindow },
      { label: '打开工作区文件夹', click: () => shell.openPath(paths.root()) },
      { type: 'separator' },
      { label: '重新加载界面', click: () => win && win.reload() },
      { label: '打开运行日志', click: () => shell.openPath(LOG_FILE) },
      { type: 'separator' },
      { label: '退出 CodeCpp', click: () => requestQuit() }
    ]));
    tray.on('double-click', showWindow);
  } catch (error) {
    log('error', '托盘初始化失败：' + String(error && error.message || error));
  }
}

function registerIpc() {
  ipcMain.on('codecpp:window', (event, action) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!['minimize', 'maximize', 'close', 'quit', 'devtools'].includes(action)) return;
    switch (action) {
      case 'minimize': win.minimize(); break;
      case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
      case 'close': win.close(); break;
      case 'quit': requestQuit(); break;
      case 'devtools': win.webContents.toggleDevTools(); break;
      default: break;
    }
    sendWindowState();
  });
  ipcMain.handle('codecpp:window-state:get', () => windowState());
  ipcMain.on('codecpp:dirty', (event, count) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    unsavedCount = Math.max(0, Number(count) || 0);
  });
  ipcMain.on('codecpp:save-all-reply', (event, id, ok, error) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    const resolve = saveAllPending.get(id);
    if (!resolve) return;
    saveAllPending.delete(id);
    resolve({ ok: Boolean(ok), error: error || '' });
  });
  ipcMain.handle('codecpp:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    packaged: app.isPackaged,
    root: runtime ? runtime.root : ROOT,
    url: runtime ? runtime.url : '',
    isDesktop: true
  }));
  ipcMain.handle('codecpp:pick-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '选择 CodeCpp 工作区文件夹',
      defaultPath: runtime ? runtime.root : ROOT,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('codecpp:pick-archive', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '选择 MinGW-w64 编译器压缩包（.zip / .7z）',
      filters: [{ name: '编译器压缩包', extensions: ['zip', '7z'] }],
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('codecpp:reveal', (_event, relativePath) => {
    const root = runtime ? runtime.root : ROOT;
    const target = path.resolve(root, String(relativePath || '.'));
    if (!paths.inside(target, root)) {
      log('warn', '拒绝定位工作区外路径：' + target);
      return null;
    }
    shell.showItemInFolder(target);
    return target;
  });
  ipcMain.on('codecpp:open-external', (_event, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(String(url));
  });
  ipcMain.on('codecpp:reload', () => win && win.reload());
}

function saveAllFromRenderer(timeout) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve({ ok: false, error: '窗口不可用' }); return; }
    const id = ++saveAllSeq;
    const timer = setTimeout(() => {
      saveAllPending.delete(id);
      resolve({ ok: false, error: '保存超时' });
    }, timeout || 6000);
    saveAllPending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    win.webContents.send('codecpp:save-all', id);
  });
}

async function requestQuit(force) {
  if (shutdownStarted) return;
  if (!force && unsavedCount > 0) {
    if (quitPromptOpen) return;
    quitPromptOpen = true;
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['取消', '保存并退出', '直接退出'],
        defaultId: 1, cancelId: 0, title: 'CodeCpp',
        message: '有 ' + unsavedCount + ' 个文件尚未保存',
        detail: '选择「保存并退出」将先保存所有已修改的文件。'
      });
      if (response === 0) return;
      if (response === 1) {
        const result = await saveAllFromRenderer();
        log('info', '退出前保存：' + JSON.stringify(result));
      }
    } catch (error) {
      log('error', '退出确认失败：' + String(error && error.message || error));
      return;
    } finally { quitPromptOpen = false; }
  }
  quitConfirmed = true;
  app.quit();
}

function registerShutdown() {
  app.on('before-quit', (event) => {
    if (!quitConfirmed && unsavedCount > 0) {
      event.preventDefault();
      requestQuit();
      return;
    }
    if (shutdownStarted) return;
    shutdownStarted = true;
    event.preventDefault();
    log('info', 'CodeCpp 正在退出');
    saveWindowState();
    if (tray) { try { tray.destroy(); } catch (_) {} }
    const closing = runtime ? runtime.close() : Promise.resolve();
    Promise.race([
      Promise.resolve(closing).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]).finally(() => app.exit(0));
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
}

function runSelfTest() {
  const resultFile = path.join(store.DATA_DIR, 'selftest.json');
  const finish = (payload) => {
    try {
      fs.mkdirSync(store.DATA_DIR, { recursive: true });
      fs.writeFileSync(resultFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_) {}
    console.log('CODECPP_SELFTEST=' + JSON.stringify(payload));
    app.exit(payload.ok ? 0 : 1);
  };
  const timer = setTimeout(() => finish({ ok: false, error: '自检超时：页面未在 30 秒内加载完成' }), 30000);
  const check = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 2600));
      const state = await win.webContents.executeJavaScript(`(async () => {
        const info = window.CCDesktop ? await window.CCDesktop.info() : null;
        return {
          desktop: Boolean(window.CCDesktop && window.CCDesktop.isDesktop),
          info: info,
          title: document.title,
          tabs: document.querySelectorAll('.editor-tab').length,
          lines: document.querySelectorAll('.code-line').length,
          tree: document.querySelectorAll('.tree-row').length,
          winControls: document.querySelectorAll('.win-control').length,
          windowApi: Boolean(window.CCDesktop && typeof window.CCDesktop.window === 'function'),
          stateApi: Boolean(window.CCDesktop && typeof window.CCDesktop.getWindowState === 'function'),
          dirtyApi: Boolean(window.CCDesktop && typeof window.CCDesktop.reportDirty === 'function'),
          saveAllApi: Boolean(window.CCDesktop && typeof window.CCDesktop.onSaveAll === 'function'),
          desktopClass: document.body.classList.contains('is-desktop'),
          theme: document.documentElement.getAttribute('data-theme'),
          root: window.CC && CC.state && CC.state.root,
          pageErrors: window.__codecppErrors || []
        };
      })()`);
      await win.webContents.executeJavaScript(`document.querySelector('[data-win="maximize"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 600));
      state.windowControl = {
        maximized: win.isMaximized(),
        buttonSynced: await win.webContents.executeJavaScript(
          `document.getElementById('win-maximize').classList.contains('is-max')`)
      };
      state.windowState = await win.webContents.executeJavaScript(
        `window.CCDesktop ? window.CCDesktop.getWindowState() : null`);
      const menuProbe = await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-menu="file"]');
        if (!button) return { items: 0, hasPalette: false };
        button.click();
        const menu = document.getElementById('context-menu');
        const items = menu.querySelectorAll('.ctx-item').length;
        const hasPalette = menu.textContent.includes('命令面板');
        menu.classList.add('hidden');
        document.querySelectorAll('.menu-bar > button').forEach((b) => b.classList.remove('open'));
        return { items, hasPalette };
      })()`);
      state.menuItems = menuProbe.items;
      state.menuHasPalette = menuProbe.hasPalette;
      const menu = Menu.getApplicationMenu();
      state.nativeMenu = menu ? menu.items.map((item) => item.label) : [];
      if (win.isMaximized()) win.unmaximize();
      const errors = consoleErrors.concat(state.pageErrors || []);
      clearTimeout(timer);
      finish({
        ok: state.desktop && state.desktopClass && state.tabs > 0 && state.lines > 0 &&
            state.winControls === 3 && state.windowApi && state.windowControl.maximized &&
            state.windowControl.buttonSynced && state.stateApi && state.dirtyApi && state.saveAllApi &&
            state.menuItems >= 7 && !state.menuHasPalette && state.windowState &&
            typeof state.windowState.maximized === 'boolean' &&
            ['文件', '编辑', '搜索', '视图', '项目', '运行', '调试', '工具', '帮助']
              .every((group) => state.nativeMenu.includes(group)) &&
            errors.length === 0,
        state: state,
        consoleErrors: errors
      });
    } catch (error) {
      clearTimeout(timer);
      finish({ ok: false, error: String(error && error.message || error), consoleErrors });
    }
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', check);
  else check();
}
