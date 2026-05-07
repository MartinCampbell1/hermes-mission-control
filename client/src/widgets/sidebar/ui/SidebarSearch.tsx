import { Box, TextField, useTheme } from '@mui/material';
import { Search } from '@mui/icons-material';
import { useI18n } from '../../../shared/i18n';

interface SidebarSearchProps {
  value: string;
  onChange: (v: string) => void;
}

export default function SidebarSearch({ value, onChange }: SidebarSearchProps) {
  const { sidebar } = useTheme().palette;
  const { t } = useI18n();
  return (
    <Box sx={{ px: 1.5, mb: 1, flexShrink: 0 }}>
      <TextField
        fullWidth
        size="small"
        placeholder={t('sidebar.searchChats')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        slotProps={{
          input: {
            startAdornment: <Search sx={{ fontSize: 16, color: sidebar.text, mr: 0.5 }} />,
          },
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            bgcolor: 'background.default',
            borderRadius: 0.75,
            height: 32,
            '& fieldset': { borderColor: sidebar.border },
            '&:hover fieldset': { borderColor: sidebar.text },
            '&.Mui-focused fieldset': { borderColor: sidebar.selectedBorder },
            '& input': { color: sidebar.selectedText, fontSize: '0.82rem', py: 0.6, px: 0.5 },
          },
        }}
      />
    </Box>
  );
}
