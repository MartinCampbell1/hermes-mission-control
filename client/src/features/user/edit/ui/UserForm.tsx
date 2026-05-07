import { useEffect, useState } from 'react';
import { useFormik } from 'formik';
import { Box, Typography, IconButton, TextField, Button, CircularProgress } from '@mui/material';
import { Close } from '@mui/icons-material';
import {
  useGetUserQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
} from '../../../../entities/user';
import { useI18n } from '../../../../shared/i18n';

type FieldErrors = Record<string, string[]>;

function parseFieldErrors(err: unknown): FieldErrors | null {
  const typed = err as { status?: number; data?: Record<string, unknown> } | undefined;
  if (typed?.status === 422 && typed.data && typeof typed.data === 'object') {
    return typed.data as FieldErrors;
  }
  return null;
}

function localizeServerError(field: keyof UserFormValues, message: string, t: ReturnType<typeof useI18n>['t']): string {
  const lower = message.toLowerCase();
  if (field === 'email' || lower.includes('email')) return t('users.emailInvalid');
  if (field === 'password' || lower.includes('password')) return t('users.passwordInvalid');
  if (field === 'phone' || lower.includes('phone')) return t('users.phoneInvalid');
  if (field === 'name') return t('users.firstNameInvalid');
  if (field === 'lastName') return t('users.lastNameInvalid');
  return message;
}

const inputSx = {
  mb: 1.5,
  '& .MuiOutlinedInput-root': { borderRadius: 1.5 },
  '& input': { fontSize: '0.85rem' },
  '& label': { fontSize: '0.85rem' },
  '& .MuiFormHelperText-root': { fontSize: '0.7rem', mx: 0.5 },
};

const emptyValues = { name: '', lastName: '', email: '', password: '', phone: '' };
type UserFormValues = typeof emptyValues;

interface UserFormProps {
  userId: string | null;
  onDone: () => void;
}

export default function UserForm({ userId, onDone }: UserFormProps) {
  const { t } = useI18n();
  const isEdit = Boolean(userId);
  const { data: existing, isLoading: loadingUser } = useGetUserQuery(userId!, { skip: !userId });
  const [createUser, { isLoading: isCreating }] = useCreateUserMutation();
  const [updateUser, { isLoading: isUpdating }] = useUpdateUserMutation();
  const [serverErrors, setServerErrors] = useState<FieldErrors | null>(null);
  const [generalError, setGeneralError] = useState('');

  const formik = useFormik({
    initialValues: emptyValues,
    validateOnMount: true,
    validate: (values: UserFormValues) => {
      const errors: Partial<Record<keyof UserFormValues, string>> = {};
      const name = values.name.trim();
      const lastName = values.lastName.trim();
      const email = values.email.trim();
      const password = values.password.trim();
      const phone = values.phone.trim();
      if (name.length < 2 || name.length > 50) errors.name = t('users.firstNameInvalid');
      if (lastName.length < 2 || lastName.length > 50) errors.lastName = t('users.lastNameInvalid');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = t('users.emailInvalid');
      if ((!isEdit || password) && password.length < 6) errors.password = t('users.passwordInvalid');
      if (phone && !/^[+()\-\s\d]{7,24}$/.test(phone)) errors.phone = t('users.phoneInvalid');
      return errors;
    },
    onSubmit: async (values) => {
      setServerErrors(null);
      setGeneralError('');
      try {
        if (isEdit && userId) {
          const data: Record<string, string> = {
            name: values.name,
            lastName: values.lastName,
            email: values.email,
            phone: values.phone,
          };
          if (values.password) data.password = values.password;
          await updateUser({ id: userId, data }).unwrap();
        } else {
          await createUser(values).unwrap();
        }
        onDone();
      } catch (err: unknown) {
        const fe = parseFieldErrors(err);
        if (fe) {
          setServerErrors(fe);
        } else {
          const msg = (err as { data?: { error?: string } })?.data?.error;
          setGeneralError(msg || (isEdit ? t('users.updateFailed') : t('users.createFailed')));
        }
      }
    },
  });

  useEffect(() => {
    if (isEdit && existing) {
      formik.resetForm({
        values: {
          name: existing.name || '',
          lastName: existing.lastName || '',
          email: existing.email || '',
          password: '',
          phone: existing.phone || '',
        },
      });
    } else if (!isEdit) {
      formik.resetForm({ values: emptyValues });
    }
    setServerErrors(null);
    setGeneralError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, isEdit, userId]);

  const saving = isCreating || isUpdating;
  const err = (field: keyof UserFormValues) => {
    if (formik.touched[field] && formik.errors[field]) return formik.errors[field] || '';
    const server = serverErrors?.[field];
    if (!server?.length) return '';
    return server.map((message) => localizeServerError(field, message, t)).join('. ');
  };

  return (
    <Box sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, flex: 1 }}>
          {isEdit ? t('users.edit') : t('users.add')}
        </Typography>
        <IconButton size="small" onClick={onDone} aria-label={t('common.close')} title={t('common.close')}>
          <Close sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {loadingUser ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      ) : (
        <form onSubmit={formik.handleSubmit}>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              fullWidth
              size="small"
              label={t('users.firstName')}
              {...formik.getFieldProps('name')}
              error={!!err('name')}
              helperText={err('name')}
              sx={inputSx}
            />
            <TextField
              fullWidth
              size="small"
              label={t('users.lastName')}
              {...formik.getFieldProps('lastName')}
              error={!!err('lastName')}
              helperText={err('lastName')}
              sx={inputSx}
            />
          </Box>

          <TextField
            fullWidth
            size="small"
            label={t('login.email')}
            type="email"
            {...formik.getFieldProps('email')}
            error={!!err('email')}
            helperText={err('email')}
            sx={inputSx}
          />

          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              fullWidth
              size="small"
              label={isEdit ? t('users.passwordKeep') : t('users.password')}
              type="password"
              {...formik.getFieldProps('password')}
              error={!!err('password')}
              helperText={err('password')}
              sx={inputSx}
            />
            <TextField
              fullWidth
              size="small"
              label={t('users.phone')}
              {...formik.getFieldProps('phone')}
              error={!!err('phone')}
              helperText={err('phone')}
              sx={inputSx}
            />
          </Box>

          {generalError && (
            <Typography sx={{ fontSize: '0.75rem', color: 'error.main', mb: 1 }}>
              {generalError}
            </Typography>
          )}

          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={saving || !formik.isValid}
            sx={{ textTransform: 'none', fontSize: '0.8rem' }}
          >
            {saving ? <CircularProgress size={16} /> : isEdit ? t('common.save') : t('users.create')}
          </Button>
        </form>
      )}
    </Box>
  );
}
