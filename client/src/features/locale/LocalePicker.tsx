import { ButtonBase, MenuItem, Select, Stack, Typography, useTheme } from '@mui/material';
import { TranslateOutlined } from '@mui/icons-material';
import { localeLabels, useI18n, type Locale } from '../../shared/i18n';

const locales: Locale[] = ['ru', 'en'];

export default function LocalePicker() {
  const { locale, setLocale, t } = useI18n();
  const { sidebar } = useTheme().palette;

  return (
    <ButtonBase
      component="div"
      className="locale-picker"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        width: '100%',
        minWidth: 0,
        px: 1,
        py: 0.7,
        borderRadius: 1,
        justifyContent: 'flex-start',
        '&:hover': { bgcolor: sidebar.hover },
      }}
    >
      <TranslateOutlined sx={{ fontSize: 16, color: sidebar.text }} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.72rem', color: sidebar.text, fontWeight: 500 }}>
          {t('locale.title')}
        </Typography>
        <Select
          size="small"
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
          sx={{
            ml: 'auto',
            minWidth: 84,
            height: 26,
            color: sidebar.selectedText,
            fontSize: '0.72rem',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: sidebar.border },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: sidebar.text },
          }}
        >
          {locales.map((item) => (
            <MenuItem key={item} value={item}>
              {localeLabels[item]}
            </MenuItem>
          ))}
        </Select>
      </Stack>
    </ButtonBase>
  );
}
