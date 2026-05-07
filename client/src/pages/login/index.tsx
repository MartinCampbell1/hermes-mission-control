import { useEffect } from 'react';
import { Button, TextField, Card, Typography, Box, CircularProgress, Alert } from '@mui/material';
import { useFormik, FormikProvider, Form } from 'formik';
import { useNavigate } from 'react-router';
import { useLoginMutation } from '../../features/auth';
import { API_BASE_URL } from '../../shared/api/baseApi';
import { useI18n } from '../../shared/i18n';

/**
 * Translate an RTK Query error into a message that actually helps the
 * user. Previously we collapsed every error to "Login failed. Please
 * check your credentials." which made network/CORS failures look like
 * bad passwords — sent us on a goose chase the first time the app was
 * accessed over Tailscale.
 */
function describeLoginError(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (!error || typeof error !== 'object') return t('login.failed');
  const e = error as { status?: number | string; data?: unknown; error?: string };
  if (e.status === 401) return t('login.badCredentials');
  if (e.status === 'FETCH_ERROR') {
    return t('login.apiUnreachable', { url: API_BASE_URL });
  }
  if (e.status === 'PARSING_ERROR') {
    return t('login.badJson');
  }
  if (typeof e.status === 'number' && e.status >= 500) {
    return t('login.serverError', { status: e.status });
  }
  if (e.data && typeof e.data === 'object' && 'message' in e.data && typeof (e.data as { message: unknown }).message === 'string') {
    return (e.data as { message: string }).message;
  }
  if (typeof e.error === 'string') return e.error;
  return t('login.failed');
}

export default function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [login, { isLoading, error }] = useLoginMutation();
  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  useEffect(() => {
    if (localStorage.getItem('token')) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const formik = useFormik({
    initialValues: { email: '', password: '' },
    onSubmit: async (values) => {
      try {
        await login(values).unwrap();
        navigate('/');
      } catch {
        // Error is handled by RTK Query
      }
    },
  });

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
      }}
    >
      <Card
        sx={{
          width: 400,
          p: 4,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Box pb={2}>
          <Typography variant="h6">{t('login.title')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
          <FormikProvider value={formik}>
            <Form autoComplete="off">
              {error && (
                <Alert severity="error" sx={{ marginBottom: 2 }}>
                  {describeLoginError(error, t)}
                </Alert>
              )}
              <TextField
                name="email"
                label={t('login.email')}
                size="small"
                variant="outlined"
                fullWidth
                sx={{ marginBottom: 2 }}
                onChange={formik.handleChange}
                value={formik.values.email}
                autoComplete="off"
              />
              <TextField
                name="password"
                label={t('login.password')}
                type="password"
                size="small"
                variant="outlined"
                fullWidth
                sx={{ marginBottom: 2 }}
                onChange={formik.handleChange}
                value={formik.values.password}
                autoComplete="new-password"
              />
              <Button
                variant="contained"
                color="primary"
                fullWidth
                type="submit"
                disabled={isLoading}
              >
                {isLoading ? <CircularProgress size={25} /> : t('login.submit')}
              </Button>
              {isLocalHost ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {t('login.localHint')}
                </Typography>
              ) : null}
            </Form>
          </FormikProvider>
        </Box>
      </Card>
    </Box>
  );
}
