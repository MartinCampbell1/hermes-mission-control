import { Box, Typography, useTheme } from '@mui/material';

export default function SidebarHeader() {
  const { sidebar } = useTheme().palette;
  return (
    <Box
      sx={{
        px: 1.5,
        pt: 1.5,
        pb: 1,
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: 1,
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1.25,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'monospace',
          fontWeight: 800,
          fontSize: 13,
          lineHeight: 1,
          flex: '0 0 auto',
        }}
      >
        H
      </Box>
      <Typography
        variant="body2"
        component="span"
        sx={{ fontWeight: 700, color: sidebar.selectedText, lineHeight: 1.1 }}
      >
        Hermes
      </Typography>
      <Typography
        variant="body2"
        component="span"
        sx={{ fontWeight: 600, color: sidebar.text, lineHeight: 1.1 }}
      >
        Client
      </Typography>
    </Box>
  );
}
