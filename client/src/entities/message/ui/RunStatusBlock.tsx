import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import { ErrorOutline } from '@mui/icons-material';

interface RunStatusBlockProps {
  status: string;
  severity?: 'info' | 'error';
}

export default function RunStatusBlock({ status, severity = 'info' }: RunStatusBlockProps) {
  const isError = severity === 'error';
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1.5, width: '100%' }}>
      <Paper
        elevation={0}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 1.4,
          py: 0.8,
          borderRadius: 2,
          bgcolor: isError ? 'rgba(239, 68, 68, 0.08)' : 'action.hover',
          color: isError ? 'error.main' : 'text.secondary',
          border: isError ? '1px solid' : 'none',
          borderColor: isError ? 'error.light' : 'transparent',
          maxWidth: { xs: '100%', sm: '90%' },
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        {isError ? <ErrorOutline sx={{ fontSize: 16 }} /> : <CircularProgress size={14} thickness={5} />}
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            minWidth: 0,
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            lineHeight: 1.35,
          }}
        >
          {status}
        </Typography>
      </Paper>
    </Box>
  );
}
