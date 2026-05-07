import { useFormik } from 'formik';
import { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Button,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  CircularProgress,
  Autocomplete,
} from '@mui/material';
import { Close, InfoOutlined } from '@mui/icons-material';
import { useAddCronJobMutation } from '../../../../entities/cron';
import { useGetAgentsQuery } from '../../../../entities/agent';
import { useI18n } from '../../../../shared/i18n';

type ScheduleKind = 'cron' | 'every' | 'at';

const SCHEDULE_KINDS: ScheduleKind[] = ['cron', 'every', 'at'];

const COMMON_TIMEZONES = Intl.supportedValuesOf
  ? Intl.supportedValuesOf('timeZone')
  : [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Berlin',
      'Europe/Paris',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Asia/Kolkata',
      'Australia/Sydney',
    ];

const inputSx = {
  mb: 1.5,
  '& .MuiOutlinedInput-root': { borderRadius: 1.5 },
  '& input': { fontSize: '0.85rem' },
  '& label': { fontSize: '0.85rem' },
  '& textarea': { fontSize: '0.85rem' },
};

interface CronFormValues {
  name: string;
  scheduleKind: ScheduleKind;
  scheduleValue: string;
  atDatetime: string;
  message: string;
  profile: string;
  tz: string;
}

const initialValues: CronFormValues = {
  name: '',
  scheduleKind: 'cron',
  scheduleValue: '',
  atDatetime: '',
  message: '',
  profile: '',
  tz: '',
};

function validCronPart(part: string, min: number, max: number): boolean {
  if (part === '*') return true;
  return part.split(',').every((segment) => {
    const [base, step] = segment.split('/');
    if (step && (!/^\d+$/.test(step) || Number(step) < 1)) return false;
    if (!base || base === '*') return true;
    const [from, to] = base.split('-');
    if (!/^\d+$/.test(from)) return false;
    const start = Number(from);
    if (start < min || start > max) return false;
    if (to === undefined) return true;
    if (!/^\d+$/.test(to)) return false;
    const end = Number(to);
    return end >= start && end >= min && end <= max;
  });
}

function hasScheduleError(values: CronFormValues): boolean {
  if (values.scheduleKind === 'every') return !/^\d+(m|h|d)$/.test(values.scheduleValue.trim());
  if (values.scheduleKind === 'at') return !values.atDatetime || Number.isNaN(new Date(values.atDatetime).getTime());

  const parts = values.scheduleValue.trim().split(/\s+/);
  if (parts.length !== 5) return true;
  const [minute, hour, day, month, weekday] = parts;
  const valid =
    validCronPart(minute, 0, 59) &&
    validCronPart(hour, 0, 23) &&
    validCronPart(day, 1, 31) &&
    validCronPart(month, 1, 12) &&
    validCronPart(weekday, 0, 7);
  if (!valid) return true;
  if (month === '2' && day !== '*' && Number(day) > 29) return true;
  if (/^(4|6|9|11)$/.test(month) && day !== '*' && Number(day) > 30) return true;
  return false;
}

interface AddCronFormProps {
  onDone: () => void;
  /**
   * Optional notifier for mutation in-flight state. Lets the parent panel
   * surface a loading indicator on its own UI (e.g. the gateway banner)
   * the moment the user submits, instead of only after the mutation
   * resolves and tag-invalidation kicks off the refetch.
   */
  onPendingChange?: (pending: boolean) => void;
}

export default function AddCronForm({ onDone, onPendingChange }: AddCronFormProps) {
  const { t } = useI18n();
  const [addCron, { isLoading }] = useAddCronJobMutation();
  const { data: agentsData } = useGetAgentsQuery();
  const [error, setError] = useState('');

  const formik = useFormik<CronFormValues>({
    initialValues,
    onSubmit: async (values, helpers) => {
      setError('');
      const opts: Record<string, string> = {};
      if (values.name) opts.name = values.name;
      if (values.message) opts.message = values.message;
      if (values.profile) opts.profile = values.profile;
      if (values.tz) opts.tz = values.tz;

      if (values.scheduleKind === 'at') {
        if (!values.atDatetime) return;
        opts.at = new Date(values.atDatetime).toISOString();
      } else {
        if (!values.scheduleValue.trim()) return;
        opts[values.scheduleKind] = values.scheduleValue;
      }

      onPendingChange?.(true);
      try {
        await addCron(opts).unwrap();
        // Reset back to a clean slate so re-opening the form doesn't show
        // stale fields from the previous job. Done before onDone() so the
        // brief moment between close and re-open shows empty inputs even
        // if the parent keeps the form mounted.
        helpers.resetForm();
        onDone();
      } catch (err: unknown) {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        setError(msg || t('cron.addFailed'));
      } finally {
        onPendingChange?.(false);
      }
    },
  });

  const agents = agentsData?.items ?? [];

  const hasSchedule =
    formik.values.scheduleKind === 'at'
      ? !!formik.values.atDatetime
      : !!formik.values.scheduleValue.trim();
  const scheduleInvalid = hasSchedule && hasScheduleError(formik.values);
  const canSubmit = hasSchedule && !scheduleInvalid && (formik.values.name.trim() || formik.values.message.trim());
  const scheduleKindLabel = (kind: ScheduleKind) => {
    if (kind === 'cron') return t('cron.scheduleCron');
    if (kind === 'every') return t('cron.scheduleEvery');
    return t('cron.scheduleAt');
  };

  return (
    <Box sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, flex: 1 }}>{t('cron.addTitle')}</Typography>
        <IconButton size="small" onClick={onDone} aria-label="Close">
          <Close sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      <form onSubmit={formik.handleSubmit}>
        <TextField
          fullWidth
          size="small"
          label={t('cron.jobName')}
          {...formik.getFieldProps('name')}
          sx={inputSx}
        />

        <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
          <InputLabel sx={{ fontSize: '0.85rem' }}>{t('cron.scheduleType')}</InputLabel>
          <Select
            value={formik.values.scheduleKind}
            label={t('cron.scheduleType')}
            onChange={(e) => {
              const kind = e.target.value as ScheduleKind;
              formik.setFieldValue('scheduleKind', kind);
              if (kind === 'every') formik.setFieldValue('tz', '');
            }}
            sx={{ fontSize: '0.85rem' }}
          >
            {SCHEDULE_KINDS.map((s) => (
              <MenuItem key={s} value={s} sx={{ fontSize: '0.85rem' }}>
                {scheduleKindLabel(s)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {formik.values.scheduleKind === 'at' ? (
          <TextField
            fullWidth
            size="small"
            type="datetime-local"
            label={t('cron.runAt')}
            {...formik.getFieldProps('atDatetime')}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={inputSx}
          />
        ) : (
          <TextField
            fullWidth
            size="small"
            label={
              formik.values.scheduleKind === 'cron'
                ? t('cron.cronExpression')
                : t('cron.interval')
            }
            {...formik.getFieldProps('scheduleValue')}
            error={scheduleInvalid}
            helperText={scheduleInvalid ? t('cron.invalidSchedule') : undefined}
            sx={inputSx}
          />
        )}

        <TextField
          fullWidth
          size="small"
          label={t('cron.prompt')}
          multiline
          minRows={2}
          maxRows={4}
          {...formik.getFieldProps('message')}
          sx={inputSx}
        />

        <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ fontSize: '0.85rem' }}>{t('cron.profile')}</InputLabel>
            <Select
              value={formik.values.profile}
              label={t('cron.profile')}
              onChange={(e) => formik.setFieldValue('profile', e.target.value)}
              sx={{ fontSize: '0.85rem', borderRadius: 1.5 }}
            >
              <MenuItem value="" sx={{ fontSize: '0.85rem' }}>
                <em>{t('common.default')}</em>
              </MenuItem>
              {agents.map((a) => (
                <MenuItem key={a._id} value={a.hermesProfile} sx={{ fontSize: '0.85rem' }}>
                  {a.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {formik.values.scheduleKind !== 'every' && (
            <Autocomplete
              fullWidth
              size="small"
              freeSolo
              options={COMMON_TIMEZONES}
              value={formik.values.tz || null}
              onChange={(_e, val) => formik.setFieldValue('tz', val || '')}
              onInputChange={(_e, val) => formik.setFieldValue('tz', val || '')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('cron.timezone')}
                  sx={{
                    '& .MuiOutlinedInput-root': { borderRadius: 1.5 },
                    '& input': { fontSize: '0.85rem' },
                    '& label': { fontSize: '0.85rem' },
                  }}
                />
              )}
            />
          )}
        </Box>

        {/*
          Hermes runs every cron tick in its own isolated session — there's
          no CLI option to deliver into an existing chat. The runs panel on
          each cron row is where you'll see the agent's responses.
        */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            mb: 1.5,
            p: 1,
            borderRadius: 1.5,
            bgcolor: 'background.default',
            border: '1px dashed',
            borderColor: 'divider',
          }}
        >
          <InfoOutlined sx={{ fontSize: 16, color: 'text.secondary', mt: '2px' }} />
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.45 }}>
            {t('cron.formHint')}
          </Typography>
        </Box>

        {error && (
          <Typography sx={{ fontSize: '0.75rem', color: 'error.main', mb: 1 }}>{error}</Typography>
        )}

        <Button
          type="submit"
          variant="contained"
          size="small"
          disabled={!canSubmit || isLoading}
          sx={{ textTransform: 'none', fontSize: '0.8rem' }}
        >
          {isLoading ? <CircularProgress size={16} /> : t('cron.addJob')}
        </Button>
      </form>
    </Box>
  );
}
