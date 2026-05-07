import { useState } from 'react';
import { useChat } from '../model/useChat';
import ChatHeader from './ChatHeader';
import SessionSettingsBar from './SessionSettingsBar';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { useI18n } from '../../../shared/i18n';

interface ChatProps {
  agentId: string;
  conversationId: string;
}

/**
 * Full chat experience for a given agent/conversation: header,
 * optional session-settings bar, message list and input.
 */
export default function Chat({ agentId, conversationId }: ChatProps) {
  const { t } = useI18n();
  const [showSessionSettings, setShowSessionSettings] = useState(false);
  const chat = useChat(conversationId);

  return (
    <div className="chat-screen">
      <ChatHeader
        agentId={agentId}
        conversationId={conversationId}
        showSessionSettings={showSessionSettings}
        onToggleSessionSettings={() => setShowSessionSettings((v) => !v)}
      />
      {showSessionSettings && (
        <SessionSettingsBar agentId={agentId} conversationId={conversationId} />
      )}
      <MessageList chat={chat} />
      <ChatInput
        agentId={agentId}
        conversationId={conversationId}
        onSend={chat.send}
        isStreaming={chat.isStreaming}
        disabled={chat.isInitialLoading}
        disabledReason={chat.isInitialLoading ? t('chat.loadingConversation') : undefined}
        onToggleSessionSettings={() => setShowSessionSettings((v) => !v)}
        sessionSettingsOpen={showSessionSettings}
      />
    </div>
  );
}
