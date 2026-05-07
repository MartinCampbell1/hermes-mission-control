import { Box, Typography, Select, MenuItem, Tooltip, type SelectChangeEvent } from '@mui/material';
import { alpha } from '@mui/material/styles';

interface SettingChipProps {
  label: string;
  value: string;
  options: readonly (string | { value: string; label: string })[];
  onChange: (v: string) => void;
  disabled?: boolean;
  tooltip?: string;
}

export default function SettingChip({ label, value, options, onChange, disabled, tooltip }: SettingChipProps) {
  const isActive = value !== 'inherit';
  const chip = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '6px',
        border: '1px solid',
        borderColor: isActive ? 'primary.main' : 'divider',
        bgcolor: (t) => (isActive ? alpha(t.palette.primary.main, 0.06) : 'transparent'),
        overflow: 'hidden',
        opacity: disabled ? 0.6 : 1,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <Typography
        sx={{
          fontSize: '0.68rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          color: isActive ? 'primary.main' : 'text.disabled',
          pl: 1,
          pr: 0.3,
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {label}
      </Typography>
      <Select
        size="small"
        value={value}
        onChange={(e: SelectChangeEvent) => onChange(e.target.value)}
        disabled={disabled}
        variant="standard"
        disableUnderline
        sx={{
          fontSize: '0.72rem',
          fontWeight: 500,
          color: isActive ? 'text.primary' : 'text.secondary',
          minWidth: 40,
          '& .MuiSelect-select': {
            py: '2px',
            pl: '2px',
            pr: '18px !important',
          },
          '& .MuiSvgIcon-root': { fontSize: 14, right: 2, color: 'text.disabled' },
        }}
      >
        {options.map((opt) => {
          const val = typeof opt === 'string' ? opt : opt.value;
          const lbl = typeof opt === 'string' ? opt : opt.label;
          return (
            <MenuItem key={val} value={val} sx={{ fontSize: '0.75rem', minHeight: 28 }}>
              {lbl}
            </MenuItem>
          );
        })}
      </Select>
    </Box>
  );
  return tooltip ? <Tooltip title={tooltip}>{chip}</Tooltip> : chip;
}
