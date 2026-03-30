const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0d1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // ローカルファイル読み込みのため
    },
    icon: path.join(__dirname, 'assets/images/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ウィンドウコントロール
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// macOSシステムボリューム取得
ipcMain.handle('get-system-volume', async () => {
  const { execSync } = require('child_process');
  try {
    const vol = execSync('osascript -e "output volume of (get volume settings)"').toString().trim();
    return { success: true, volume: parseInt(vol) };
  } catch(e) {
    return { success: false, volume: 80 };
  }
});

// ファイル読み込み (Drag & Drop パス解決)
ipcMain.handle('read-file-buffer', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return { success: true, data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// music-metadata でタグ読み込み
ipcMain.handle('read-metadata', async (event, filePath) => {
  try {
    const mm = require('music-metadata');
    const metadata = await mm.parseFile(filePath);
    const common = metadata.common;

    let coverDataUrl = null;
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      const base64 = Buffer.from(pic.data).toString('base64');
      coverDataUrl = `data:${pic.format};base64,${base64}`;
    }

    return {
      success: true,
      title: common.title || path.basename(filePath, path.extname(filePath)),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',
      year: common.year || '',
      genre: common.genre ? common.genre[0] : '',
      duration: metadata.format.duration || 0,
      cover: coverDataUrl
    };
  } catch (e) {
    return {
      success: false,
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      year: '',
      genre: '',
      duration: 0,
      cover: null
    };
  }
});
