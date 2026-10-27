import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { DEFAULT_THEME } from '../shared/palette';
import { useLibrary } from './stores/useLibrary';
import { useSettings } from './stores/useSettings';
import { applyPaletteVars } from './theme/applyTheme';

async function bootstrap(): Promise<void> {
  // Палитра по умолчанию сразу, чтобы ни один кадр не был без цветов.
  applyPaletteVars(DEFAULT_THEME);
  // Настройки (тема) — до первой отрисовки, библиотека — параллельно.
  await Promise.all([useSettings.getState().load(), useLibrary.getState().load()]);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
