import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ThemeId } from '../../app/theme';

interface ThemeState {
  themeId: ThemeId;
  donorMode: 'dark' | 'light';
  accent: string;
  density: 'compact' | 'regular' | 'comfy';
  chatWidth: number;
  fontScale: number;
}

const stored = localStorage.getItem('themeId');
const storedDonorMode = localStorage.getItem('hermes-donor-mode');
const storedAccent = localStorage.getItem('hermes-donor-accent');
const storedDensity = localStorage.getItem('hermes-donor-density');
const storedChatWidth = Number(localStorage.getItem('hermes-donor-chat-width'));
const storedFontScale = Number(localStorage.getItem('hermes-donor-font-scale'));
const validIds: ThemeId[] = [
  'hermes',
  'amber',
  'ocean',
  'midnight',
  'forest',
  'rose',
  'arctic',
  'sunset',
  'lavender',
  'mocha',
  'slate',
  'ember',
  'sand',
  'night',
  'studio',
];

const initialState: ThemeState = {
  themeId: validIds.includes(stored as ThemeId) ? (stored as ThemeId) : 'hermes',
  donorMode: storedDonorMode === 'light' ? 'light' : 'dark',
  accent: storedAccent || '#7c5cff',
  density: storedDensity === 'compact' || storedDensity === 'comfy' ? storedDensity : 'regular',
  chatWidth: Number.isFinite(storedChatWidth) && storedChatWidth >= 680 ? storedChatWidth : 860,
  fontScale: Number.isFinite(storedFontScale) && storedFontScale >= 85 ? storedFontScale : 100,
};

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<ThemeId>) {
      state.themeId = action.payload;
      localStorage.setItem('themeId', action.payload);
    },
    setDonorMode(state, action: PayloadAction<'dark' | 'light'>) {
      state.donorMode = action.payload;
      localStorage.setItem('hermes-donor-mode', action.payload);
    },
    setAccent(state, action: PayloadAction<string>) {
      state.accent = action.payload;
      localStorage.setItem('hermes-donor-accent', action.payload);
    },
    setDensity(state, action: PayloadAction<'compact' | 'regular' | 'comfy'>) {
      state.density = action.payload;
      localStorage.setItem('hermes-donor-density', action.payload);
    },
    setChatWidth(state, action: PayloadAction<number>) {
      state.chatWidth = action.payload;
      localStorage.setItem('hermes-donor-chat-width', String(action.payload));
    },
    setFontScale(state, action: PayloadAction<number>) {
      state.fontScale = action.payload;
      localStorage.setItem('hermes-donor-font-scale', String(action.payload));
    },
  },
});

export const { setTheme, setDonorMode, setAccent, setDensity, setChatWidth, setFontScale } = themeSlice.actions;
export default themeSlice.reducer;
