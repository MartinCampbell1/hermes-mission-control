import { useState } from 'react';
import {
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  IconButton,
  Tooltip,
  useTheme,
} from '@mui/material';
import { ChatBubbleOutline, DeleteOutline, Edit, Check } from '@mui/icons-material';
import { Link, useLocation, useNavigate } from 'react-router';
import { DeleteButton } from '../../../shared/ui';
import { useI18n } from '../../../shared/i18n';
import { useUpdateConversationMutation, useDeleteConversationMutation } from '../api';

interface ConversationItemProps {
  agentId: string;
  conversation: {
    _id: string;
    title: string | null;
    createdAt: string;
    lastActive?: string | null;
    sessionKey?: string | null;
    threadKey?: string | null;
    messageSource?: 'state_db' | 'json_fallback' | null;
  };
  onNavigate?: () => void;
}

export default function ConversationItem({
  agentId,
  conversation,
  onNavigate,
}: ConversationItemProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const { sidebar } = theme.palette;
  const { t } = useI18n();
  const isActive = location.pathname === `/agent/${agentId}/chat/${conversation._id}`;
  const title =
    conversation.title?.trim() ||
    conversation.threadKey ||
    conversation.sessionKey ||
    t('chat.untitled');
  const activeAt = conversation.lastActive || conversation.createdAt;
  const compactDate = activeAt
    ? new Date(activeAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null;
  const secondary = conversation.messageSource
    ? [conversation.messageSource, compactDate].filter(Boolean).join(' · ')
    : null;
  const tooltip = `${title}${conversation.messageSource ? ` · ${conversation.messageSource}` : ''}`;
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [updateConversation] = useUpdateConversationMutation();
  const [deleteConversation] = useDeleteConversationMutation();

  const handleDelete = async () => {
    await deleteConversation({ id: conversation._id, agentId });
    if (isActive) navigate('/');
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditValue(title);
    setEditing(true);
  };

  const handleSaveEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      updateConversation({ id: conversation._id, agentId, title: trimmed });
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <ListItem disablePadding sx={{ mb: 0.2, px: 1.5, pl: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 0.3 }}>
          <TextField
            variant="standard"
            size="small"
            autoFocus
            fullWidth
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={handleSaveEdit}
            slotProps={{
              input: {
                disableUnderline: false,
                sx: { fontSize: '0.75rem', color: sidebar.selectedText, py: 0.3 },
              },
            }}
            sx={{ '& .MuiInput-underline:after': { borderColor: sidebar.selectedBorder } }}
          />
          <IconButton size="small" onClick={handleSaveEdit} sx={{ p: 0.2, color: 'success.main' }}>
            <Check sx={{ fontSize: 12 }} />
          </IconButton>
        </Box>
      </ListItem>
    );
  }

  return (
    <ListItem
      disablePadding
      sx={{ mb: 0.2 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ListItemButton
        component={Link}
        to={`/agent/${agentId}/chat/${conversation._id}`}
        selected={isActive}
        onClick={onNavigate}
        sx={{
          borderRadius: 0.75,
          py: 0.6,
          px: 1,
          pl: 4,
          textDecoration: 'none',
          '&:hover': { bgcolor: sidebar.hover },
          '&.Mui-selected': {
            bgcolor: sidebar.selectedBg,
            '&:hover': { bgcolor: sidebar.selectedBg },
          },
        }}
      >
        <ListItemIcon
          sx={{ minWidth: 20, color: isActive ? sidebar.selectedBorder : sidebar.text }}
        >
          <ChatBubbleOutline sx={{ fontSize: 13 }} />
        </ListItemIcon>
        <Tooltip title={tooltip} placement="right" arrow>
          <ListItemText
            primary={title}
            secondary={secondary}
            sx={{
              '& .MuiListItemText-primary': {
                color: isActive ? sidebar.selectedText : sidebar.text,
                fontSize: '0.79rem',
                fontWeight: isActive ? 600 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
              '& .MuiListItemText-secondary': {
                color: sidebar.text,
                fontSize: '0.62rem',
                lineHeight: 1.2,
                opacity: 0.55,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }}
          />
        </Tooltip>
        {(hovered || isActive) && (
          <>
            <IconButton
              size="small"
              onClick={handleStartEdit}
              sx={{ p: 0.2, color: sidebar.text, opacity: 0.6, '&:hover': { opacity: 1 } }}
            >
              <Edit sx={{ fontSize: 12 }} />
            </IconButton>
            <DeleteButton
              onConfirm={handleDelete}
              message={t('chat.deleteConversation')}
              renderTrigger={(onClick) => (
                <IconButton
                  size="small"
                  onClick={onClick}
                  sx={{
                    p: 0.2,
                    color: sidebar.text,
                    opacity: 0.6,
                    '&:hover': { color: '#f44336', opacity: 1 },
                  }}
                >
                  <DeleteOutline sx={{ fontSize: 13 }} />
                </IconButton>
              )}
            />
          </>
        )}
      </ListItemButton>
    </ListItem>
  );
}
