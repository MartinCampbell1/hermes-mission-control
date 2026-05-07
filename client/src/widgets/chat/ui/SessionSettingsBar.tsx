import { memo, useCallback, useEffect, useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { useGetSessionSettingsQuery, usePatchSessionSettingsMutation } from '../../../entities/agent';
import SettingChip from './SettingChip';
import { useI18n } from '../../../shared/i18n';

const THINKING_OPTIONS = ['inherit', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const FAST_OPTIONS = [
  { value: 'inherit', label: 'inherit' },
  { value: 'true', label: 'on' },
  { value: 'false', label: 'off' },
] as const;
const VERBOSE_OPTIONS = [
  { value: 'inherit', label: 'inherit' },
  { value: 'off', label: 'off (explicit)' },
  { value: 'on', label: 'on' },
  { value: 'full', label: 'full' },
] as const;
const REASONING_OPTIONS = ['inherit', 'off', 'on', 'stream'] as const;
const PROVIDER_OPTIONS = [
  'inherit',
  'auto',
  'openai-codex',
  'anthropic',
  'gemini',
  'openrouter',
  'copilot',
  'ollama-cloud',
] as const;

interface SessionSettingsBarProps {
  agentId: string;
  conversationId: string;
}

type SettingsField =
  | 'thinkingLevel'
  | 'fastMode'
  | 'verboseLevel'
  | 'reasoningLevel'
  | 'providerOverride';
type TextSettingsField = 'modelOverride' | 'skillsOverride' | 'toolsetsOverride';

type LocalSettings = Record<SettingsField, string>;
type LocalTextSettings = Record<TextSettingsField, string>;

const DEFAULT_SETTINGS: LocalSettings = {
  thinkingLevel: 'inherit',
  fastMode: 'inherit',
  verboseLevel: 'inherit',
  reasoningLevel: 'inherit',
  providerOverride: 'inherit',
};

const DEFAULT_TEXT_SETTINGS: LocalTextSettings = {
  modelOverride: '',
  skillsOverride: '',
  toolsetsOverride: '',
};

function toLocalFast(value: boolean | null | undefined): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'inherit';
}

function normalizeSettingValue(field: SettingsField, value: string): unknown {
  if (field === 'fastMode') return value === 'inherit' ? null : value === 'true';
  return value === 'inherit' ? null : value;
}

const SessionSettingsBar = memo(function SessionSettingsBar({
  agentId,
  conversationId,
}: SessionSettingsBarProps) {
  const { t } = useI18n();
  const { data } = useGetSessionSettingsQuery(
    { agentId, conversationId },
    { skip: !agentId || !conversationId }
  );
  const [patchSettings] = usePatchSessionSettingsMutation();
  const settings = data?.settings;
  const [localSettings, setLocalSettings] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [localTextSettings, setLocalTextSettings] =
    useState<LocalTextSettings>(DEFAULT_TEXT_SETTINGS);
  const [savingField, setSavingField] = useState<SettingsField | TextSettingsField | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const capabilities = data?.capabilities;

  const capabilityReason = useCallback(
    (field: SettingsField | TextSettingsField): string | undefined => {
      const capability = capabilities?.[field as keyof typeof capabilities];
      if (!capability?.reason) return undefined;
      return `${field}: ${capability.reason}`;
    },
    [capabilities]
  );

  const errorMessage = useCallback((field: string, err: unknown): string => {
    if (err && typeof err === 'object' && 'data' in err) {
      const data = (err as { data?: { error?: string; message?: string } }).data;
      if (data?.error) return `${field}: ${data.error}`;
      if (data?.message) return `${field}: ${data.message}`;
    }
    return t('session.saveError', { field });
  }, [t]);

  useEffect(() => {
    if (!settings) return;
    setLocalSettings({
      thinkingLevel: settings.thinkingLevel || 'inherit',
      fastMode: toLocalFast(settings.fastMode),
      verboseLevel: settings.verboseLevel || 'inherit',
      reasoningLevel: settings.reasoningLevel || 'inherit',
      providerOverride: settings.providerOverride || 'inherit',
    });
    setLocalTextSettings({
      modelOverride: settings.modelOverride || '',
      skillsOverride: settings.skillsOverride || '',
      toolsetsOverride: settings.toolsetsOverride || '',
    });
    setSaveError(null);
  }, [settings]);

  const handleChange = useCallback(
    async (field: SettingsField, value: string) => {
      const previous = localSettings;
      setLocalSettings((current) => ({ ...current, [field]: value }));
      setSavingField(field);
      setSaveError(null);
      try {
        await patchSettings({
          agentId,
          conversationId,
          settings: { [field]: normalizeSettingValue(field, value) },
        }).unwrap();
      } catch (err) {
        setLocalSettings(previous);
        setSaveError(errorMessage(field, err));
      } finally {
        setSavingField(null);
      }
    },
    [agentId, conversationId, localSettings, patchSettings]
  );

  const handleTextChange = useCallback((field: TextSettingsField, value: string) => {
    setLocalTextSettings((current) => ({ ...current, [field]: value }));
  }, []);

  const handleTextCommit = useCallback(
    async (field: TextSettingsField) => {
      const value = localTextSettings[field].trim();
      const previous = localTextSettings;
      setSavingField(field);
      setSaveError(null);
      try {
        await patchSettings({
          agentId,
          conversationId,
          settings: { [field]: value || null },
        }).unwrap();
      } catch (err) {
        setLocalTextSettings(previous);
        setSaveError(errorMessage(field, err));
      } finally {
        setSavingField(null);
      }
    },
    [agentId, conversationId, localTextSettings, patchSettings]
  );

  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 2 },
        py: 0.75,
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        flexWrap: 'wrap',
      }}
    >
      <SettingChip
        label={t('session.thinking')}
        value={localSettings.thinkingLevel}
        options={THINKING_OPTIONS}
        onChange={(v) => handleChange('thinkingLevel', v)}
        disabled={savingField === 'thinkingLevel'}
        tooltip={capabilityReason('thinkingLevel')}
      />
      <SettingChip
        label={t('session.fast')}
        value={localSettings.fastMode}
        options={FAST_OPTIONS}
        onChange={(v) => handleChange('fastMode', v)}
        disabled={savingField === 'fastMode'}
        tooltip={capabilityReason('fastMode')}
      />
      <SettingChip
        label={t('session.verbose')}
        value={localSettings.verboseLevel}
        options={VERBOSE_OPTIONS}
        onChange={(v) => handleChange('verboseLevel', v)}
        disabled={savingField === 'verboseLevel'}
        tooltip={capabilityReason('verboseLevel')}
      />
      <SettingChip
        label={t('session.reasoning')}
        value={localSettings.reasoningLevel}
        options={REASONING_OPTIONS}
        onChange={(v) => handleChange('reasoningLevel', v)}
        disabled={savingField === 'reasoningLevel'}
        tooltip={capabilityReason('reasoningLevel')}
      />
      <SettingChip
        label={t('session.provider')}
        value={localSettings.providerOverride}
        options={PROVIDER_OPTIONS}
        onChange={(v) => handleChange('providerOverride', v)}
        disabled={savingField === 'providerOverride'}
        tooltip={capabilityReason('providerOverride')}
      />
      {(['modelOverride', 'skillsOverride', 'toolsetsOverride'] as const).map((field) => (
        <TextField
          key={field}
          size="small"
          variant="standard"
          label={
            field === 'modelOverride'
              ? t('session.model')
              : field === 'skillsOverride'
                ? t('session.skills')
                : t('session.toolsets')
          }
          placeholder={t('session.inherit')}
          value={localTextSettings[field]}
          disabled={savingField === field}
          onChange={(event) => handleTextChange(field, event.target.value)}
          onBlur={() => handleTextCommit(field)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
          sx={{
            minWidth: field === 'modelOverride' ? 180 : 120,
            '& .MuiInputBase-input': { fontSize: '0.74rem', py: 0.25 },
            '& .MuiInputLabel-root': { fontSize: '0.68rem', textTransform: 'uppercase' },
          }}
        />
      ))}
      {saveError && (
        <Typography color="error" variant="caption" sx={{ ml: 0.5 }}>
          {saveError}
        </Typography>
      )}
    </Box>
  );
});

export default SessionSettingsBar;
