import { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, List, Typography, useTheme } from '@mui/material';
import { Add, KeyboardDoubleArrowUp, SwapVert } from '@mui/icons-material';
import { useGetAgentsQuery } from '../../../entities/agent';
import { useGetAllConversationsQuery } from '../../../entities/conversation';
import { CreateAgentForm } from '../../../features/agent/create';
import { AgentConfigDrawer } from '../../../features/agent/setup';
import AgentSection from './AgentSection';
import { useI18n } from '../../../shared/i18n';

interface AgentsPanelProps {
  searchQuery: string;
  onNavigate?: () => void;
}

export default function AgentsPanel({ searchQuery, onNavigate }: AgentsPanelProps) {
  const { sidebar } = useTheme().palette;
  const { t } = useI18n();

  const [showNewAgent, setShowNewAgent] = useState(false);
  const [configureTarget, setConfigureTarget] = useState<{
    profile: string;
    name: string;
  } | null>(null);
  const [collapseKey, setCollapseKey] = useState(0);
  const [sortAlpha, setSortAlpha] = useState(false);
  const [deletingAgentId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [agentsTimedOut, setAgentsTimedOut] = useState(false);

  const {
    data: agentsData,
    isLoading: agentsLoading,
    isError: agentsError,
    refetch: refetchAgents,
  } = useGetAgentsQuery();
  // Poll so sessions started in a standalone `hermes` REPL show up in
  // the sidebar without a manual refresh. The backend list endpoint
  // discovers new session JSON files on disk on each request.
  const {
    data: convData,
    isFetching: conversationsFetching,
    isError: conversationsError,
    refetch: refetchConversations,
  } = useGetAllConversationsQuery(undefined, {
    pollingInterval: 5000,
    refetchOnMountOrArgChange: true,
  });

  useEffect(() => {
    if (convData) setLastUpdated(new Date());
  }, [convData]);

  useEffect(() => {
    if (!agentsLoading) {
      setAgentsTimedOut(false);
      return undefined;
    }
    const id = window.setTimeout(() => setAgentsTimedOut(true), 5000);
    return () => window.clearTimeout(id);
  }, [agentsLoading]);

  const allConversations = convData?.items ?? [];
  const agents = sortAlpha
    ? [...(agentsData?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    : (agentsData?.items ?? []);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  return (
    <Box
      sx={{
        px: 1,
        mt: 1.5,
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 0.75,
          px: 1,
          flexShrink: 0,
        }}
      >
        <Typography
          sx={{
            color: sidebar.text,
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}
        >
          {t('sidebar.agents')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <IconButton
            size="small"
            onClick={() => setSortAlpha((v) => !v)}
            title={sortAlpha ? t('sidebar.unsort') : t('sidebar.sort')}
            sx={{
              color: sortAlpha ? 'primary.main' : sidebar.text,
              p: 0.3,
              '&:hover': { color: 'primary.main' },
            }}
          >
            <SwapVert sx={{ fontSize: 15 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setCollapseKey((k) => k + 1)}
            title={t('sidebar.collapseAll')}
            sx={{ color: sidebar.text, p: 0.3, '&:hover': { color: sidebar.selectedText } }}
          >
            <KeyboardDoubleArrowUp sx={{ fontSize: 15 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setShowNewAgent((prev) => !prev)}
            sx={{ color: sidebar.text, p: 0.3, '&:hover': { color: 'success.main' } }}
          >
            <Add sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>
      <Box sx={{ minHeight: 18, mb: 0.5 }}>
        {conversationsError ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ color: 'error.main', fontSize: '0.68rem' }}>
              {t('sidebar.syncFailed')}
            </Typography>
            <Button size="small" onClick={() => refetchConversations()} sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: '0.66rem' }}>
              {t('common.retry')}
            </Button>
          </Box>
        ) : conversationsFetching ? (
          <Typography sx={{ color: sidebar.text, fontSize: '0.68rem', opacity: 0.7 }}>
            {t('sidebar.syncing')}
          </Typography>
        ) : lastUpdated ? (
          <Typography sx={{ color: sidebar.text, fontSize: '0.68rem', opacity: 0.55 }}>
            {t('sidebar.updated', {
              time: lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })}
          </Typography>
        ) : null}
      </Box>

      {showNewAgent && (
        <CreateAgentForm
          onCreated={({ profile, name }) => {
            setShowNewAgent(false);
            setConfigureTarget({ profile, name });
          }}
          onCancel={() => setShowNewAgent(false)}
        />
      )}

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: sidebar.border,
            borderRadius: 1,
            '&:hover': { bgcolor: sidebar.text },
          },
        }}
      >
        {agentsError || agentsTimedOut ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75, py: 1 }}>
            <Typography sx={{ color: agentsError ? 'error.main' : sidebar.text, fontSize: '0.72rem' }}>
              {agentsError ? t('sidebar.agentsFailed') : t('sidebar.agentsSlow')}
            </Typography>
            <Button
              size="small"
              onClick={() => {
                setAgentsTimedOut(false);
                refetchAgents();
              }}
              sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: '0.68rem' }}
            >
              {t('common.retry')}
            </Button>
          </Box>
        ) : agentsLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 2 }}>
            <CircularProgress size={18} sx={{ color: sidebar.text }} />
            <Typography sx={{ color: sidebar.text, fontSize: '0.68rem', opacity: 0.7 }}>
              {t('sidebar.loadingAgents')}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {agents.map((agent) => {
              const conversationsForAgent = allConversations.filter((c) => c.agentId === agent._id);
              const visibleConversations = normalizedSearch
                ? conversationsForAgent.filter((c) =>
                    (c.title || '').toLowerCase().includes(normalizedSearch) ||
                    (c.sessionKey || '').toLowerCase().includes(normalizedSearch) ||
                    (c.threadKey || '').toLowerCase().includes(normalizedSearch)
                  )
                : conversationsForAgent;
              const agentMatches = normalizedSearch
                ? agent.name.toLowerCase().includes(normalizedSearch) ||
                  agent.hermesProfile.toLowerCase().includes(normalizedSearch)
                : true;
              if (normalizedSearch && !agentMatches && visibleConversations.length === 0) {
                return null;
              }

              return (
                <AgentSection
                  key={agent._id}
                  agent={{
                    _id: agent._id,
                    name: agent.name,
                    hermesProfile: agent.hermesProfile,
                    model: agent.model ?? null,
                  }}
                  conversations={visibleConversations}
                  searchQuery={searchQuery || undefined}
                  forceExpanded={Boolean(normalizedSearch)}
                  collapseKey={collapseKey}
                  onNavigate={onNavigate}
                  disabled={deletingAgentId === agent._id}
                />
              );
            })}
          </List>
        )}
      </Box>

      {configureTarget && (
        <AgentConfigDrawer
          open
          profile={configureTarget.profile}
          agentName={configureTarget.name}
          initialCmd="model"
          onClose={() => setConfigureTarget(null)}
        />
      )}
    </Box>
  );
}
