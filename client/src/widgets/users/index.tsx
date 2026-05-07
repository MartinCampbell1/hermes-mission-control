import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Close, Search } from '@mui/icons-material';
import {
  UserRow,
  useDeleteUserMutation,
  useGetUsersQuery,
} from '../../entities/user';
import { UserForm } from '../../features/user/edit';
import { useI18n } from '../../shared/i18n';

type FormMode = 'closed' | 'add' | string;

export default function UsersPanel() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useGetUsersQuery();
  const [deleteUser] = useDeleteUserMutation();
  const [search, setSearch] = useState('');
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [pendingOp, setPendingOp] = useState(false);

  const busy = isLoading || pendingOp;
  const users = useMemo(() => data?.items ?? [], [data?.items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.lastName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone && u.phone.toLowerCase().includes(q))
    );
  }, [users, search]);

  const handleDelete = async (id: string) => {
    setPendingOp(true);
    try {
      await deleteUser(id).unwrap();
    } catch {
      /* handled by RTK */
    } finally {
      setPendingOp(false);
    }
  };

  const showForm = formMode !== 'closed';
  const editUserId = formMode !== 'closed' && formMode !== 'add' ? formMode : null;

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto', width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          {t('users.title')}
        </Typography>
        {!busy && (
          <Typography variant="body2" color="text.secondary">
            {t('users.count', { count: users.length, suffix: users.length !== 1 ? 's' : '' })}
          </Typography>
        )}
        <IconButton
          size="small"
          aria-label={t('users.newUser')}
          title={t('users.newUser')}
          onClick={() => {
            setSearch('');
            setFormMode((prev) => (prev === 'add' ? 'closed' : 'add'));
          }}
          sx={{
            bgcolor: formMode === 'add' ? 'primary.main' : 'action.hover',
            color: formMode === 'add' ? 'primary.contrastText' : 'text.primary',
            '&:hover': {
              bgcolor: formMode === 'add' ? 'primary.dark' : 'action.selected',
            },
          }}
        >
          <Add sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      <Collapse in={showForm} unmountOnExit>
        <UserForm userId={editUserId} onDone={() => setFormMode('closed')} />
      </Collapse>

      <TextField
        fullWidth
        size="small"
        placeholder={t('users.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 18, color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label={t('users.clearSearch')}
                  title={t('users.clearSearch')}
                  onClick={() => setSearch('')}
                  edge="end"
                >
                  <Close sx={{ fontSize: 16 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
          },
        }}
        sx={{
          mb: 2,
          '& .MuiOutlinedInput-root': {
            borderRadius: 1.5,
            '& input': { fontSize: '0.85rem', py: 1 },
          },
        }}
      />

      {busy ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      ) : isError ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="error" sx={{ mb: 1 }}>
            {t('users.loadError')}
          </Typography>
          <Button size="small" onClick={() => refetch()}>
            {t('common.retry')}
          </Button>
        </Box>
      ) : (
        <Box>
          {filtered.map((user) => (
            <UserRow
              key={user._id}
              user={user}
              onEdit={(id) => setFormMode(id)}
              onDelete={handleDelete}
            />
          ))}
          {filtered.length === 0 && (
            <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {search ? t('users.noMatch') : t('users.none')}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
