// Иконка Aura: resources/icon.svg → resources/icon.png (512) и resources/icon.ico (16…256).
// Без сторонних утилит: SVG растеризует сам Chromium внутри Electron. Запуск: `npm run icon`.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'resources', 'icon.svg');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 512;

/** ICO из PNG-кадров (формат Vista+: каждый кадр — PNG целиком). */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const { size, png } of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

app.whenReady().then(async () => {
  try {
    const svg = readFileSync(svgPath, 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html,<!doctype html><meta charset="utf-8"><body></body>');
    const sizes = [...ICO_SIZES, PNG_SIZE];
    const pngs = await win.webContents.executeJavaScript(`(async () => {
      const svg = ${JSON.stringify(svg)};
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const out = {};
      for (const size of ${JSON.stringify(sizes)}) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, size, size);
        out[size] = c.toDataURL('image/png').split(',')[1];
      }
      return out;
    })()`);
    const frame = (size) => Buffer.from(pngs[size], 'base64');
    writeFileSync(join(root, 'resources', 'icon.png'), frame(PNG_SIZE));
    writeFileSync(join(root, 'resources', 'icon.ico'), buildIco(ICO_SIZES.map((size) => ({ size, png: frame(size) }))));
    console.log(`icon.png ${PNG_SIZE}px, icon.ico ${ICO_SIZES.join('/')}px — готово`);
    app.exit(0);
  } catch (err) {
    console.error('Не удалось сделать иконку:', err);
    app.exit(1);
  }
});
