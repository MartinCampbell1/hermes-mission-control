import { describe, expect, it } from 'vitest';
import { localeLabels, translate } from './index';

describe('i18n', () => {
  it('defaults known UI keys to Russian and keeps English available', () => {
    expect(translate('ru', 'chat.placeholder')).toBe('Напишите сообщение...');
    expect(translate('en', 'chat.placeholder')).toBe('Type a message...');
  });

  it('interpolates values and leaves missing placeholders visible', () => {
    expect(translate('ru', 'workspace.updated', { id: 'm1', time: '10:00' })).toBe(
      'm1 · обновлено 10:00'
    );
    expect(translate('en', 'workspace.updated', { id: 'm1' })).toBe('m1 · updated {time}');
  });

  it('exposes readable locale labels', () => {
    expect(localeLabels.ru).toBe('Русский');
    expect(localeLabels.en).toBe('English');
  });
});
