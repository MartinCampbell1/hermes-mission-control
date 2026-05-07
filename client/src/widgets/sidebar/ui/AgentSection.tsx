import { useState, useEffect, useRef } from 'react';
import {
  Collapse,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  IconButton,
  Tooltip,
  useTheme,
} from '@mui/material';
import {
  Add,
  ExpandMore,
  ExpandLess,
  DeleteOutline,
  TerminalOutlined,
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router';
import { useDeleteAgentMutation } from '../../../entities/agent';
import { useCreateConversationMutation, ConversationItem } from '../../../entities/conversation';
import { AgentConfigDrawer } from '../../../features/agent/setup';
import { DeleteButton } from '../../../shared/ui';
import { useI18n } from '../../../shared/i18n';
import AgentSpendRing from './AgentSpendRing';

interface AgentSectionProps {
  agent: { _id: string; name: string; hermesProfile: string; model?: string | null };
  conversations: {
    _id: string;
    title: string | null;
    createdAt: string;
    lastActive?: string | null;
    sessionKey?: string | null;
    threadKey?: string | null;
    messageSource?: 'state_db' | 'json_fallback' | null;
  }[];
  searchQuery?: string;
  forceExpanded?: boolean;
  collapseKey?: number;
  onNavigate?: () => void;
  disabled?: boolean;
}

export default function AgentSection({
  agent,
  conversations,
  searchQuery,
  forceExpanded,
  collapseKey,
  onNavigate,
  disabled,
}: AgentSectionProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const { sidebar } = theme.palette;
  const { t } = useI18n();
  const isAgentActive = location.pathname.startsWith(`/agent/${agent._id}/`);
  const [expanded, setExpanded] = useState(isAgentActive);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (collapseKey && !isAgentActive) setExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);
  const [hovered, setHovered] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [createConversation] = useCreateConversationMutation();
  const [deleteAgent] = useDeleteAgentMutation();

  const isSearchActive = Boolean(searchQuery);
  const handleNewChat = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await createConversation({ agentId: agent._id });
    if ('data' in result && result.data) {
      setExpanded(true);
      navigate(`/agent/${agent._id}/chat/${result.data._id}`);
      onNavigate?.();
    }
  };

  const handleDeleteAgent = async () => {
    await deleteAgent(agent._id);
    if (location.pathname.startsWith(`/agent/${agent._id}`)) {
      navigate('/');
    }
  };

  return (
    <>
      <ListItem
        disablePadding
        sx={{
          mb: 0.2,
          opacity: disabled ? 0.4 : 1,
          pointerEvents: disabled ? 'none' : 'auto',
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <ListItemButton
          onClick={() => setExpanded(!expanded)}
          sx={{
            borderRadius: 0.75,
            py: 0.75,
            px: 1,
            gap: 1,
            bgcolor: isAgentActive ? sidebar.selectedBg : 'transparent',
            '&:hover': { bgcolor: sidebar.hover },
          }}
        >
          <AgentSpendRing
            agentId={agent._id}
            hermesProfile={agent.hermesProfile}
            model={agent.model}
            configured={Boolean(agent.model)}
            onClickWhenUnconfigured={() => setDrawerOpen(true)}
          />
          <ListItemText
            primary={agent.name}
            sx={{
              my: 0,
              '& .MuiListItemText-primary': {
                color: isAgentActive ? sidebar.selectedText : sidebar.text,
                fontSize: '0.84rem',
                fontWeight: isAgentActive ? 600 : 500,
                textTransform: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }}
          />
          {hovered && (
            <>
              <Tooltip title={t('sidebar.configureProfile')}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDrawerOpen(true);
                  }}
                  sx={{
                    p: 0.2,
                    mr: 0.2,
                    color: sidebar.text,
                    opacity: 0.6,
                    '&:hover': { color: 'primary.main', opacity: 1 },
                  }}
                >
                  <TerminalOutlined sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <DeleteButton
                onConfirm={handleDeleteAgent}
                message={t('sidebar.deleteAgent')}
                renderTrigger={(onClick) => (
                  <IconButton
                    size="small"
                    onClick={onClick}
                    sx={{
                      p: 0.2,
                      mr: 0.2,
                      color: sidebar.text,
                      opacity: 0.6,
                      '&:hover': { color: '#f44336', opacity: 1 },
                    }}
                  >
                    <DeleteOutline sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              />
            </>
          )}
          <IconButton
            size="small"
            aria-label={t('sidebar.newAgentChat', { agent: agent.name })}
            onClick={handleNewChat}
            sx={{ color: sidebar.text, p: 0.3, mr: 0.3, '&:hover': { color: 'success.main' } }}
          >
            <Add sx={{ fontSize: 14 }} />
          </IconButton>
          {expanded ? (
            <ExpandLess sx={{ fontSize: 16, color: sidebar.text }} />
          ) : (
            <ExpandMore sx={{ fontSize: 16, color: sidebar.text }} />
          )}
        </ListItemButton>
      </ListItem>
      <Collapse in={forceExpanded || (isSearchActive ? true : expanded)} timeout="auto" unmountOnExit>
        <List disablePadding>
          {conversations.length === 0 && !isSearchActive ? (
            <Typography
              sx={{
                pl: 5,
                py: 0.5,
                color: sidebar.text,
                fontSize: '0.7rem',
                fontStyle: 'italic',
                opacity: 0.7,
              }}
            >
              {t('sidebar.noAgentChats')}
            </Typography>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv._id}
                agentId={agent._id}
                conversation={conv}
                onNavigate={onNavigate}
              />
            ))
          )}
        </List>
      </Collapse>
      {drawerOpen && (
        <AgentConfigDrawer
          open={drawerOpen}
          profile={agent.hermesProfile}
          agentName={agent.name}
          initialCmd="model"
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}
