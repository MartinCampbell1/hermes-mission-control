import { useMemo, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { Close, Search } from '@mui/icons-material';
import { PluginRow, useListPluginsQuery } from '../../entities/plugin';
import { useI18n } from '../../shared/i18n';

export default function PluginsPanel() {
  const { t } = useI18n();
  const { data: plugins, isLoading, isError, refetch } = useListPluginsQuery();
  const [search, setSearch] = useState('');

  const all = useMemo(() => plugins ?? [], [plugins]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }, [all, search]);

  const enabledCount = useMemo(() => all.filter((p) => p.enabled).length, [all]);

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto', width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          {t('plugins.title')}
        </Typography>
        {!isLoading && (
          <Typography variant="body2" color="text.secondary">
            {t('plugins.enabledCount', { enabled: enabledCount, total: all.length })}
          </Typography>
        )}
      </Box>

      <TextField
        fullWidth
        size="small"
        placeholder={t('plugins.search')}
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
                  aria-label={t('plugins.clearSearch')}
                  title={t('plugins.clearSearch')}
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

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      ) : isError ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="error" sx={{ mb: 1 }}>
            {t('plugins.loadError')}
          </Typography>
          <Button size="small" onClick={() => refetch()}>
            {t('common.retry')}
          </Button>
        </Box>
      ) : (
        <Box>
          {filtered.map((p) => (
            <PluginRow key={p.name} plugin={p} />
          ))}
          {filtered.length === 0 && (
            <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {search ? t('plugins.noMatch') : t('plugins.none')}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
