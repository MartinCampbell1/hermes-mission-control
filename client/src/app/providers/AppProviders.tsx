import { useEffect, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter } from 'react-router';
import { store } from '../store/store';
import { themes } from '../theme';
import { useAppSelector } from '../store/hooks';
import { I18nProvider } from '../../shared/i18n';

function ThemeBridge({ children }: { children: ReactNode }) {
  const theme = useAppSelector((s) => s.theme);
  const themeId = theme.themeId;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.donorMode;
    root.style.setProperty('--accent', theme.accent);
    const hex = theme.accent.replace('#', '');
    const expanded = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
    const n = Number.parseInt(expanded, 16);
    if (Number.isFinite(n)) {
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.14)`);
      root.style.setProperty('--accent-hover', `rgb(${Math.max(0, r - 20)},${Math.max(0, g - 20)},${Math.max(0, b - 20)})`);
    }
    root.style.setProperty('--chat-max', `${theme.chatWidth}px`);
    root.style.fontSize = `${(theme.fontScale / 100) * 14}px`;
    root.style.setProperty(
      '--side-w',
      theme.density === 'compact' ? '240px' : theme.density === 'comfy' ? '300px' : '268px'
    );
  }, [theme.accent, theme.chatWidth, theme.density, theme.donorMode, theme.fontScale]);

  return (
    <ThemeProvider theme={themes[themeId]}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <I18nProvider>
        <ThemeBridge>
          <BrowserRouter>{children}</BrowserRouter>
        </ThemeBridge>
      </I18nProvider>
    </Provider>
  );
}
