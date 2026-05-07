import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import { Search } from '@mui/icons-material';
import { SkillRow, useListSkillsQuery, type SkillInfo } from '../../entities/skill';
import { useI18n } from '../../shared/i18n';

const ALL = '__all__';

function groupByCategory(skills: SkillInfo[]): Record<string, SkillInfo[]> {
  return skills.reduce<Record<string, SkillInfo[]>>((acc, s) => {
    const key = s.category || 'uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});
}

export default function SkillsPanel() {
  const { t } = useI18n();
  const { data: skills, isLoading, isError, refetch } = useListSkillsQuery();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  const all = useMemo(() => skills ?? [], [skills]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    all.forEach((s) => set.add(s.category || 'uncategorized'));
    return Array.from(set).sort();
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((s) => {
      if (category !== ALL && (s.category || 'uncategorized') !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q) ||
        (s.source || '').toLowerCase().includes(q)
      );
    });
  }, [all, search, category]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);
  const groupKeys = Object.keys(grouped).sort();

  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return undefined;
    }
    const id = window.setTimeout(() => setLoadingTimedOut(true), 3000);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  return (
    <Box sx={{ p: 3, maxWidth: 880, mx: 'auto', width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          {t('skills.title')}
        </Typography>
        {!isLoading && (
          <Typography variant="body2" color="text.secondary">
            {t('skills.count', { filtered: filtered.length, total: all.length })}
          </Typography>
        )}
      </Box>

      <TextField
        fullWidth
        size="small"
        placeholder={t('skills.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 18, color: 'text.secondary' }} />
              </InputAdornment>
            ),
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

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
        <Chip
          label={t('skills.all')}
          size="small"
          variant={category === ALL ? 'filled' : 'outlined'}
          color={category === ALL ? 'primary' : 'default'}
          onClick={() => setCategory(ALL)}
          sx={{ height: 24, fontSize: '0.7rem' }}
        />
        {categories.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            size="small"
            variant={category === cat ? 'filled' : 'outlined'}
            color={category === cat ? 'primary' : 'default'}
            onClick={() => setCategory(cat)}
            sx={{ height: 24, fontSize: '0.7rem' }}
          />
        ))}
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6, gap: 1 }}>
          <CircularProgress size={24} />
          {loadingTimedOut ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {t('skills.loadError')}
              </Typography>
              <Button size="small" onClick={() => refetch()}>
                {t('common.retry')}
              </Button>
            </>
          ) : null}
        </Box>
      ) : isError ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="error" sx={{ mb: 1 }}>
            {t('skills.loadError')}
          </Typography>
          <Button size="small" onClick={() => refetch()}>
            {t('common.retry')}
          </Button>
        </Box>
      ) : filtered.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {search ? t('skills.noMatch') : t('skills.none')}
        </Typography>
      ) : (
        <Box>
          {groupKeys.map((cat) => (
            <Box key={cat} sx={{ mb: 2 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  pb: 0.5,
                }}
              >
                <Typography
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                  }}
                >
                  {cat}
                </Typography>
                <Typography
                  sx={{ fontSize: '0.65rem', color: 'text.disabled' }}
                >
                  · {grouped[cat].length}
                </Typography>
                <Divider sx={{ flex: 1, ml: 1 }} />
              </Box>
              {grouped[cat].map((s) => (
                <SkillRow key={s.name} skill={s} />
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
