import { useAppDispatch, useAppSelector } from '../../app/store';
import {
  setAccent,
  setChatWidth,
  setDensity,
  setDonorMode,
  setFontScale,
} from '../../features/theme';
import { useI18n } from '../../shared/i18n';

const accentOptions = ['#7c5cff', '#10a37f', '#d97757', '#ff5a1f', '#3b82f6'];

export default function SettingsPage() {
  const { t } = useI18n();
  const dispatch = useAppDispatch();
  const appearance = useAppSelector((state) => state.theme);

  return (
    <div className="main">
      <div className="topbar">
        <div className="title-block">
          <h1>{t('settings.title')}</h1>
        </div>
      </div>
      <div className="page">
        <div className="page-inner">
          <div className="card">
            <div className="card-hd">
              <div>
                <h3>{t('settings.appearance')}</h3>
                <p>{t('settings.appearanceDetail')}</p>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>{t('settings.mode')}</label>
                <select value={appearance.donorMode} onChange={(event) => dispatch(setDonorMode(event.target.value as 'dark' | 'light'))}>
                  <option value="dark">{t('settings.dark')}</option>
                  <option value="light">{t('settings.light')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('settings.density')}</label>
                <select value={appearance.density} onChange={(event) => dispatch(setDensity(event.target.value as 'compact' | 'regular' | 'comfy'))}>
                  <option value="compact">{t('settings.compact')}</option>
                  <option value="regular">{t('settings.regular')}</option>
                  <option value="comfy">{t('settings.comfy')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('settings.chatWidth')}</label>
                <input
                  type="number"
                  min={680}
                  max={1100}
                  step={20}
                  value={appearance.chatWidth}
                  onChange={(event) => dispatch(setChatWidth(Number(event.target.value)))}
                />
              </div>
              <div className="field">
                <label>{t('settings.fontScale')}</label>
                <input
                  type="number"
                  min={85}
                  max={120}
                  step={5}
                  value={appearance.fontScale}
                  onChange={(event) => dispatch(setFontScale(Number(event.target.value)))}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>{t('settings.accent')}</label>
              <div className="accent-row">
                {accentOptions.map((color) => (
                  <button
                    key={color}
                    className="accent-swatch"
                    data-active={appearance.accent === color}
                    style={{ background: color }}
                    title={t('settings.pickAccent', { color })}
                    aria-label={t('settings.pickAccent', { color })}
                    onClick={() => dispatch(setAccent(color))}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
