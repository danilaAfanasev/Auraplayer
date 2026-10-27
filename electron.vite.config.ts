import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Политика безопасности страницы в `index.html` — рабочая, без послаблений. Горячей перезагрузке dev-сервера
 * нужны WebSocket и localhost: их добавляем только при `electron-vite dev` (command === 'serve'),
 * в собранный `out/renderer/index.html` они не попадают.
 */
function devCspPlugin(command: 'build' | 'serve'): Plugin {
  return {
    name: 'aura-dev-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => (command === 'serve' ? html.replace("connect-src 'self'", "connect-src 'self' ws: http://localhost:*") : html),
    },
  };
}

export default defineConfig(({ command }) => ({
  main: {
    build: {
      // ESM-only пакеты собираем внутрь бандла main, остальные зависимости остаются внешними.
      externalizeDeps: { exclude: ['nanoid', 'music-metadata'] },
    },
  },
  preload: {},
  renderer: {
    plugins: [react(), devCspPlugin(command)],
  },
}));
