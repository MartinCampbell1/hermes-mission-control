import type { ReactNode } from 'react';
import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText, useTheme } from '@mui/material';
import { AccountTree, People, Extension, Psychology, Schedule } from '@mui/icons-material';
import { Link, useLocation } from 'react-router';
import { useI18n, type TranslationKey } from '../../../shared/i18n';

interface MenuItem {
  textKey: TranslationKey;
  icon: ReactNode;
  path: string;
}

const MENU_ITEMS: MenuItem[] = [
  { textKey: 'sidebar.users', icon: <People sx={{ fontSize: 18 }} />, path: '/users' },
  { textKey: 'sidebar.plugins', icon: <Extension sx={{ fontSize: 18 }} />, path: '/plugins' },
  { textKey: 'sidebar.skills', icon: <Psychology sx={{ fontSize: 18 }} />, path: '/skills' },
  { textKey: 'sidebar.cron', icon: <Schedule sx={{ fontSize: 18 }} />, path: '/cron' },
  { textKey: 'sidebar.workspace', icon: <AccountTree sx={{ fontSize: 18 }} />, path: '/workspace' },
];

interface SidebarMenuProps {
  onNavigate?: () => void;
}

export default function SidebarMenu({ onNavigate }: SidebarMenuProps) {
  const location = useLocation();
  const { sidebar } = useTheme().palette;
  const { t } = useI18n();

  return (
    <List sx={{ px: 1, py: 0, flexShrink: 0 }}>
      {MENU_ITEMS.map((item) => {
        const isSelected =
          location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        return (
          <ListItem key={item.textKey} disablePadding sx={{ mb: 0.2 }}>
            <ListItemButton
              component={Link}
              to={item.path}
              onClick={onNavigate}
              selected={isSelected}
              sx={{
                borderRadius: 0.75,
                py: 0.6,
                px: 1,
                textDecoration: 'none',
                position: 'relative',
                '&:hover': {
                  bgcolor: sidebar.hover,
                  '& .MuiListItemText-primary': { color: sidebar.selectedText },
                  '& .MuiListItemIcon-root': { color: sidebar.selectedText },
                },
                '&.Mui-selected': {
                  bgcolor: sidebar.selectedBg,
                  boxShadow: 'none',
                  '&:hover': { bgcolor: sidebar.selectedBg },
                  '& .MuiListItemText-primary': { color: sidebar.selectedText },
                  '& .MuiListItemIcon-root': { color: sidebar.selectedBorder },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: sidebar.text }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={t(item.textKey)}
                sx={{
                  '& .MuiListItemText-primary': {
                    color: sidebar.text,
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    letterSpacing: 0,
                  },
                }}
              />
              {isSelected && (
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: sidebar.selectedBorder,
                    ml: 1,
                  }}
                />
              )}
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
}
