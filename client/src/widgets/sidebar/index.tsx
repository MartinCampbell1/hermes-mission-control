import { useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { InstallAppBanner } from '../../features/pwa/install';
import { LocalePicker } from '../../features/locale';
import { ThemePicker } from '../../features/theme';
import SidebarHeader from './ui/SidebarHeader';
import SidebarSearch from './ui/SidebarSearch';
import SidebarMenu from './ui/SidebarMenu';
import AgentsPanel from './ui/AgentsPanel';

export const SIDEBAR_WIDTH = 268;

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const { sidebar } = useTheme().palette;
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <Box
      sx={{
        width: SIDEBAR_WIDTH,
        height: '100vh',
        bgcolor: sidebar.background,
        borderRight: `1px solid ${sidebar.border}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
      }}
    >
      <SidebarHeader />
      <SidebarSearch value={searchQuery} onChange={setSearchQuery} />
      <SidebarMenu onNavigate={onNavigate} />
      <AgentsPanel searchQuery={searchQuery} onNavigate={onNavigate} />
      <InstallAppBanner />
      <LocalePicker />
      <ThemePicker />
    </Box>
  );
}
