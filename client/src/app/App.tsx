import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Routes, Route, useNavigate } from 'react-router';
import { CircularProgress, Box, Button, Typography } from '@mui/material';
import { useGetAgentsQuery } from '../entities/agent';
import { useCreateConversationMutation, useGetAllConversationsQuery } from '../entities/conversation';
import { useI18n } from '../shared/i18n';

const Login = lazy(() => import('../pages/login'));
const PrivateRoute = lazy(() => import('../features/auth/PrivateRoute'));
const Users = lazy(() => import('../pages/user'));
const AgentChat = lazy(() => import('../pages/agent'));
const AgentSettings = lazy(() => import('../pages/agentSettings'));
const Plugins = lazy(() => import('../pages/plugins'));
const Skills = lazy(() => import('../pages/skills'));
const Cron = lazy(() => import('../pages/cron'));
const Workspace = lazy(() => import('../pages/workspace'));
const Kanban = lazy(() => import('../pages/kanban'));
const Settings = lazy(() => import('../pages/settings'));

function Loading() {
  const { t } = useI18n();
  return (
    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100vh" gap={1}>
      <CircularProgress />
      <Typography color="text.secondary" variant="body2">
        {t('app.loadingRoute')}
      </Typography>
    </Box>
  );
}

function HomeRedirect() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [timedOut, setTimedOut] = useState(false);
  const {
    data: agentsData,
    isLoading: agentsLoading,
    isError: agentsError,
    refetch: refetchAgents,
  } = useGetAgentsQuery();
  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    isError: conversationsError,
    refetch: refetchConversations,
  } = useGetAllConversationsQuery(undefined, { refetchOnMountOrArgChange: true });
  const [createConversation, { isLoading: creatingConversation }] = useCreateConversationMutation();

  const agents = agentsData?.items ?? [];
  const conversations = conversationsData?.items ?? [];
  const isLoading = agentsLoading || conversationsLoading;

  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      return undefined;
    }
    const id = window.setTimeout(() => setTimedOut(true), 6500);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  if (isLoading && timedOut) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100%" gap={1}>
        <Typography fontWeight={700}>{t('app.workspaceSlow')}</Typography>
        <Typography color="text.secondary" variant="body2">
          {t('app.workspaceSlowDetail')}
        </Typography>
        <Button
          variant="outlined"
          onClick={() => {
            setTimedOut(false);
            refetchAgents();
            refetchConversations();
          }}
        >
          {t('common.retry')}
        </Button>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100%" gap={1}>
        <CircularProgress size={22} />
        <Typography color="text.secondary" variant="body2">
          {t('app.loadingWorkspace')}
        </Typography>
      </Box>
    );
  }

  if (agentsError || conversationsError) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100%" gap={1}>
        <Typography fontWeight={700}>{t('app.loadWorkspaceError')}</Typography>
        <Button
          variant="outlined"
          onClick={() => {
            refetchAgents();
            refetchConversations();
          }}
        >
          {t('common.retry')}
        </Button>
      </Box>
    );
  }

  const sortedConversations = [...conversations].sort((a, b) => {
    const bTime = new Date(b.lastActive || b.createdAt).getTime();
    const aTime = new Date(a.lastActive || a.createdAt).getTime();
    return bTime - aTime;
  });
  const latestConversation =
    sortedConversations.find((conversation) => (conversation.messageCount ?? 0) > 0) ||
    sortedConversations[0];
  if (latestConversation) {
    return <Navigate to={`/agent/${latestConversation.agentId}/chat/${latestConversation._id}`} replace />;
  }

  const firstAgent = agents[0];
  if (firstAgent) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100%" gap={1.25}>
        <Typography fontWeight={700}>{t('app.noChats')}</Typography>
        <Typography color="text.secondary" variant="body2">
          {t('app.noChatsDetail', { agent: firstAgent.name })}
        </Typography>
        <Button
          variant="contained"
          disabled={creatingConversation}
          onClick={async () => {
            const result = await createConversation({ agentId: firstAgent._id }).unwrap();
            navigate(`/agent/${firstAgent._id}/chat/${result._id}`);
          }}
        >
          {t('app.newChat')}
        </Button>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100%" gap={1}>
      <Typography fontWeight={700}>{t('app.noAgents')}</Typography>
      <Typography color="text.secondary" variant="body2">
        {t('app.noAgentsDetail')}
      </Typography>
    </Box>
  );
}

function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<Loading />}>
            <Login />
          </Suspense>
        }
      />
      <Route
        path="/"
        element={
          <Suspense fallback={<Loading />}>
            <PrivateRoute />
          </Suspense>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<Loading />}>
              <HomeRedirect />
            </Suspense>
          }
        />
        <Route
          path="users"
          element={
            <Suspense fallback={<Loading />}>
              <Users />
            </Suspense>
          }
        />
        <Route
          path="plugins"
          element={
            <Suspense fallback={<Loading />}>
              <Plugins />
            </Suspense>
          }
        />
        <Route
          path="skills"
          element={
            <Suspense fallback={<Loading />}>
              <Skills />
            </Suspense>
          }
        />
        <Route
          path="cron"
          element={
            <Suspense fallback={<Loading />}>
              <Cron />
            </Suspense>
          }
        />
        <Route
          path="kanban"
          element={
            <Suspense fallback={<Loading />}>
              <Kanban />
            </Suspense>
          }
        />
        <Route
          path="workspace"
          element={
            <Suspense fallback={<Loading />}>
              <Workspace />
            </Suspense>
          }
        />
        <Route
          path="agent/:agentId/chat/:conversationId"
          element={
            <Suspense fallback={<Loading />}>
              <AgentChat />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<Loading />}>
              <Settings />
            </Suspense>
          }
        />
        <Route
          path="agent/:agentId/settings/:tab?"
          element={
            <Suspense fallback={<Loading />}>
              <AgentSettings />
            </Suspense>
          }
        />
        <Route path="*" element="404" />
      </Route>
    </Routes>
  );
}

export default App;
