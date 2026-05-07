import { type ReactNode, useMemo, useState } from 'react';
import {
  Add,
  ChatBubbleOutline,
  DeleteOutline,
  Edit,
  Extension,
  GridView,
  MoreVert,
  People,
  Psychology,
  RocketLaunch,
  Schedule,
  Search,
  Settings,
} from '@mui/icons-material';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { LocalePicker } from '../../features/locale';
import { ThemePicker } from '../../features/theme';
import { useGetAgentsQuery } from '../../entities/agent';
import {
  useCreateConversationMutation,
  useGetAllConversationsQuery,
  type Conversation,
} from '../../entities/conversation';
import { useGetKanbanQuery } from '../../entities/kanban';
import { useGetWorkspaceSwarmQuery } from '../../entities/workspace';

export const SIDEBAR_WIDTH = 268;

interface LayoutProps {
  children?: ReactNode;
}

type ViewId = 'chat' | 'kanban' | 'workspace' | 'plugins' | 'skills' | 'cron' | 'users' | 'settings';

const navItems: Array<{ id: ViewId; label: string; to: string; icon: ReactNode; dot?: boolean }> = [
  { id: 'chat', label: 'Chat', to: '/', icon: <ChatBubbleOutline /> },
  { id: 'kanban', label: 'Kanban', to: '/kanban', icon: <GridView /> },
  { id: 'workspace', label: 'Missions', to: '/workspace', icon: <RocketLaunch />, dot: true },
  { id: 'plugins', label: 'Plugins', to: '/plugins', icon: <Extension /> },
  { id: 'skills', label: 'Skills', to: '/skills', icon: <Psychology /> },
  { id: 'cron', label: 'Cron', to: '/cron', icon: <Schedule /> },
  { id: 'users', label: 'Users', to: '/users', icon: <People /> },
];

function viewFromPath(pathname: string): ViewId {
  if (pathname.startsWith('/kanban')) return 'kanban';
  if (pathname.startsWith('/workspace')) return 'workspace';
  if (pathname.startsWith('/plugins')) return 'plugins';
  if (pathname.startsWith('/skills')) return 'skills';
  if (pathname.startsWith('/cron')) return 'cron';
  if (pathname.startsWith('/users')) return 'users';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'chat';
}

function conversationTime(conversation: Conversation): number {
  return new Date(conversation.lastActive || conversation.createdAt).getTime();
}

function bucketConversation(conversation: Conversation): 'Today' | 'Yesterday' | 'Earlier' {
  const now = new Date();
  const time = new Date(conversationTime(conversation));
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const value = time.getTime();
  if (value >= startToday) return 'Today';
  if (value >= startYesterday) return 'Yesterday';
  return 'Earlier';
}

function titleForConversation(conversation: Conversation): string {
  return conversation.title?.trim() || conversation.sessionKey || conversation.threadKey || 'Untitled chat';
}

function latestConversationForAgent(conversations: Conversation[], agentId: string): Conversation | undefined {
  return conversations
    .filter((conversation) => String(conversation.agentId) === String(agentId))
    .sort((left, right) => conversationTime(right) - conversationTime(left))[0];
}

function NavRail({ activeView }: { activeView: ViewId }) {
  return (
    <aside className="rail" aria-label="Primary navigation">
      <Link className="rail-logo" to="/" aria-label="Hermes home">
        H
      </Link>
      {navItems.map((item) => (
        <Link key={item.id} className="rail-btn" data-active={activeView === item.id} to={item.to} title={item.label}>
          {item.icon}
          {item.dot ? <i className="dot" /> : null}
          <span className="rail-tip">{item.label}</span>
        </Link>
      ))}
      <div className="rail-spacer" />
      <Link className="rail-btn" data-active={activeView === 'settings'} to="/settings" title="Settings">
        <Settings />
        <span className="rail-tip">Settings</span>
      </Link>
    </aside>
  );
}

function ChatSidePanel() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const [createConversation, { isLoading: creatingConversation }] = useCreateConversationMutation();
  const { data: agentsData } = useGetAgentsQuery();
  const { data: conversationsData } = useGetAllConversationsQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const agents = agentsData?.items ?? [];
  const allConversations = useMemo(
    () => [...(conversationsData?.items ?? [])].sort((left, right) => conversationTime(right) - conversationTime(left)),
    [conversationsData?.items]
  );
  const activeAgentId = pathname.match(/^\/agent\/([^/]+)/)?.[1];
  const selectedAgentId =
    (activeAgentId && agents.some((agent) => String(agent._id) === activeAgentId) ? activeAgentId : null) ||
    String(allConversations[0]?.agentId ?? '') ||
    String(agents[0]?._id ?? '') ||
    '';
  const selectedAgent = agents.find((agent) => String(agent._id) === selectedAgentId) ?? agents[0];
  const conversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allConversations
      .filter((conversation) => String(conversation.agentId) === selectedAgentId)
      .filter((conversation) => !q || titleForConversation(conversation).toLowerCase().includes(q))
      .sort((left, right) => conversationTime(right) - conversationTime(left));
  }, [allConversations, query, selectedAgentId]);
  const grouped = useMemo(() => {
    const buckets: Record<'Today' | 'Yesterday' | 'Earlier', Conversation[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };
    conversations.forEach((conversation) => buckets[bucketConversation(conversation)].push(conversation));
    return buckets;
  }, [conversations]);

  const createChat = async () => {
    const agent = selectedAgent;
    if (!agent || creatingConversation) return;
    const result = await createConversation({ agentId: String(agent._id) }).unwrap();
    navigate(`/agent/${agent._id}/chat/${result._id}`);
  };

  const openAgent = async (agentId: string) => {
    const existing = latestConversationForAgent(allConversations, agentId);
    if (existing) {
      navigate(`/agent/${agentId}/chat/${existing._id}`);
      return;
    }
    if (creatingConversation) return;
    const result = await createConversation({ agentId }).unwrap();
    navigate(`/agent/${agentId}/chat/${result._id}`);
  };

  return (
    <div className="chat-side-panel">
      <div className="side-hd">
        <h2>{selectedAgent ? `${selectedAgent.name} chats` : 'Chats'}</h2>
        <div className="side-hd-actions">
          <button className="icon-btn" title="New chat" onClick={createChat} disabled={creatingConversation || agents.length === 0}>
            <Edit />
          </button>
        </div>
      </div>
      <div className="search">
        <Search />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" />
      </div>
      <button className="new-chat" onClick={createChat} disabled={creatingConversation || agents.length === 0}>
        <Add />
        <span>New chat</span>
      </button>
      <div className="side-list chat-list">
        {(Object.keys(grouped) as Array<keyof typeof grouped>).map((bucket) =>
          grouped[bucket].length > 0 ? (
            <div key={bucket}>
              <div className="side-section">
                <span>{bucket}</span>
              </div>
              {grouped[bucket].map((conversation) => (
                <Link
                  key={conversation._id}
                  className="chat-row"
                  data-active={pathname === `/agent/${String(conversation.agentId)}/chat/${conversation._id}`}
                  to={`/agent/${String(conversation.agentId)}/chat/${conversation._id}`}
                >
                  <span className="title">{titleForConversation(conversation)}</span>
                  <div className="row-actions">
                    <button className="icon-btn" type="button" title="Rename">
                      <Edit />
                    </button>
                    <button className="icon-btn" type="button" title="Delete">
                      <DeleteOutline />
                    </button>
                  </div>
                </Link>
              ))}
            </div>
          ) : null
        )}
        {conversations.length === 0 ? (
          <div className="empty-note side-empty">
            <strong>No chats yet</strong>
            <span>Create the first chat for this agent.</span>
          </div>
        ) : null}
      </div>
      <div className="agent-dock">
        <div className="side-section">
          <span>Agents · {agents.length}</span>
        </div>
        {agents.map((agent) => (
          <button
            key={agent._id}
            className="agent-row"
            data-active={String(agent._id) === selectedAgentId}
            onClick={() => void openAgent(String(agent._id))}
            type="button"
          >
            <div className="agent-avatar accent">{agent.name.slice(0, 2).toUpperCase()}</div>
            <span className="title">{agent.name}</span>
            <span className="count">{agent.model || agent.hermesProfile}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KanbanSidePanel() {
  const { data } = useGetKanbanQuery();
  const boardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (data?.tasks ?? []).forEach((task) => counts.set(task.boardId, (counts.get(task.boardId) ?? 0) + 1));
    return counts;
  }, [data?.tasks]);
  return (
    <>
      <div className="side-hd">
        <h2>Kanban</h2>
      </div>
      <div className="side-list">
        <div className="side-section">
          <span>Boards</span>
          <div className="actions">
            <Link className="icon-btn" to="/kanban" title="New board">
              <Add />
            </Link>
          </div>
        </div>
        {(data?.boards ?? [{ id: 'default', name: 'Default', count: 0 }]).map((board, index) => (
          <Link key={board.id} className="chat-row" data-active={index === 0} to={`/kanban?board=${board.id}`}>
            <span className="title">{board.name}</span>
            <span className="meta">{boardCounts.get(board.id) ?? board.count}</span>
          </Link>
        ))}
        <div className="side-section" style={{ marginTop: 10 }}>
          <span>Filter by lane</span>
        </div>
        {(data?.lanes ?? []).map((lane) => (
          <Link key={lane.id} className="agent-row" to={`/kanban?lane=${lane.id}`}>
            <span className="lane-dot" style={{ background: `oklch(0.7 0.15 ${lane.hue})` }} />
            <span className="title">{lane.name}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

function WorkspaceSidePanel() {
  const { data } = useGetWorkspaceSwarmQuery();
  return (
    <>
      <div className="side-hd">
        <h2>Missions</h2>
      </div>
      <div className="side-list">
        <div className="side-section">
          <span>Missions</span>
          <div className="actions">
            <Link className="icon-btn" to="/workspace" title="Launch mission">
              <Add />
            </Link>
          </div>
        </div>
        {(data?.missions ?? []).map((mission) => (
          <Link key={mission.id} className="chat-row" data-active={mission.status === 'running'} to="/workspace">
            <span className="title">{mission.title}</span>
            <span className="meta">{mission.id}</span>
          </Link>
        ))}
        {(!data?.missions || data.missions.length === 0) && (
          <div className="chat-row">
            <span className="title">No missions yet</span>
          </div>
        )}
        <div className="side-section">
          <span>Role lanes</span>
        </div>
        {(data?.roleLanes ?? []).map((lane) => (
          <div key={lane.id} className="agent-row">
            <div className="agent-avatar accent">{lane.name.slice(0, 1)}</div>
            <span className="title">{lane.name}</span>
            <span className="count">{lane.role}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function GenericSidePanel({ view }: { view: ViewId }) {
  const labels: Record<ViewId, string> = {
    chat: 'Chats',
    kanban: 'Kanban',
    workspace: 'Missions',
    plugins: 'Plugins',
    skills: 'Skills',
    cron: 'Cron',
    users: 'Users',
    settings: 'Settings',
  };
  return (
    <>
      <div className="side-hd">
        <h2>{labels[view]}</h2>
      </div>
      <div className="side-list">
        <div className="side-section">
          <span>Categories</span>
        </div>
        {['All', 'Enabled', 'Recently added'].map((item, index) => (
          <Link key={item} className="chat-row" data-active={index === 0} to={`/${view === 'settings' ? 'settings' : view}`}>
            <span className="title">{item}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

function SidebarFoot() {
  return (
    <div className="side-foot">
      <div className="avatar">H</div>
      <div className="who">
        <div className="name">operator</div>
        <div className="plan">Hermes · local</div>
      </div>
      <LocalePicker />
      <ThemePicker />
      <button className="icon-btn" title="More">
        <MoreVert />
      </button>
    </div>
  );
}

function ContextSidebar({ activeView }: { activeView: ViewId }) {
  return (
    <aside className="side">
      {activeView === 'chat' ? <ChatSidePanel /> : null}
      {activeView === 'kanban' ? <KanbanSidePanel /> : null}
      {activeView === 'workspace' ? <WorkspaceSidePanel /> : null}
      {['plugins', 'skills', 'cron', 'users', 'settings'].includes(activeView) ? (
        <GenericSidePanel view={activeView} />
      ) : null}
      <SidebarFoot />
    </aside>
  );
}

export default function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const activeView = viewFromPath(pathname);

  return (
    <div className="app" data-hermes-shell="donor">
      <NavRail activeView={activeView} />
      <ContextSidebar activeView={activeView} />
      <main className="main">{children ?? <Outlet />}</main>
    </div>
  );
}
