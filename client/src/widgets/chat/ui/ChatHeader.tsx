import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Edit, Check, TuneOutlined, SettingsOutlined } from '@mui/icons-material';
import { useGetAgentQuery, useUpdateAgentMutation } from '../../../entities/agent';
import AgentSpendRing from '../../sidebar/ui/AgentSpendRing';
import { useI18n } from '../../../shared/i18n';

interface ChatHeaderProps {
  agentId: string;
  conversationId: string;
  showSessionSettings: boolean;
  onToggleSessionSettings: () => void;
}

export default function ChatHeader({
  agentId,
  showSessionSettings,
  onToggleSessionSettings,
}: ChatHeaderProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: agent } = useGetAgentQuery(agentId, { skip: !agentId });
  const [updateAgent, { isLoading: isUpdatingName }] = useUpdateAgentMutation();
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState('');

  if (!agent) return null;

  const handleSave = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    if (trimmed === agent.name) {
      setEditing(false);
      return;
    }
    try {
      await updateAgent({ id: agent._id, name: trimmed }).unwrap();
      setEditing(false);
    } catch {
      /* stay in edit mode; request failed */
    }
  };

  return (
    <div className="topbar chat-topbar">
      {editing ? (
        <>
          <input
            className="chat-title-input"
            autoFocus
            disabled={isUpdatingName}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (isUpdatingName) return;
              if (e.key === 'Enter') void handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button
            className="icon-btn"
            onClick={() => void handleSave()}
            disabled={isUpdatingName}
            aria-label={isUpdatingName ? t('chat.savingName') : t('chat.saveName')}
          >
            <Check />
          </button>
        </>
      ) : (
        <>
          <div className="title-block">
            <button
              className="spend-ring-btn"
              type="button"
              onClick={() => navigate(`/agent/${agent._id}/settings/usage`)}
              title={t('chat.agentSettings')}
            >
              <AgentSpendRing
                agentId={agent._id}
                hermesProfile={agent.hermesProfile}
                model={agent.model}
                size={36}
                display="percentage"
              />
            </button>
            <div className="chat-title-stack">
              <h1>{agent.name}</h1>
              <span className="subtitle">{t('chat.profile', { profile: agent.hermesProfile })}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-btn"
              onClick={onToggleSessionSettings}
              aria-label={t('chat.sessionSettings')}
              title={t('chat.sessionSettings')}
              data-active={showSessionSettings}
            >
              <TuneOutlined />
            </button>
            <button
              className="icon-btn"
              onClick={() => navigate(`/agent/${agent._id}/settings/usage`)}
              aria-label={t('chat.agentSettings')}
              title={t('chat.agentSettings')}
            >
              <SettingsOutlined />
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                setNameValue(agent.name);
                setEditing(true);
              }}
              title={t('chat.renameAgent')}
            >
              <Edit />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
