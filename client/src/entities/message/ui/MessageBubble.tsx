import { useState, memo, useCallback } from 'react';
import { DeleteOutline, ContentCopy, Done, AutoAwesome } from '@mui/icons-material';
import { DeleteButton, MarkdownContent } from '../../../shared/ui';
import { useI18n } from '../../../shared/i18n';
import ThinkingBlock from './ThinkingBlock';
import FileAttachments from './FileAttachments';
import CronMessageBubble from './CronMessageBubble';
import ToolEventBlock from './ToolEventBlock';
import { parseCronMessage } from '../lib/parseCronMessage';
import { formatMessageTimestamp } from '../lib/formatMessageTimestamp';
import { useDeleteMessageMutation, type Message, type MessageFile } from '../api';

export type MessageLike =
  | Message
  | {
      text: string;
      role: string;
      thinking?: string | null;
      files?: MessageFile[];
      kind?: string;
      hidden?: boolean;
    };

interface MessageBubbleProps {
  message: MessageLike;
  isStreaming?: boolean;
  thinkingText?: string;
  messageId?: string;
}

const LONG_MESSAGE_CHARS = 100000;

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  thinkingText,
  messageId,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();
  const [deleteMessage] = useDeleteMessageMutation();

  const isUser = message.role === 'user';
  const kind = 'kind' in message ? message.kind : 'message';
  const hidden = 'hidden' in message ? message.hidden : false;
  const thinking = thinkingText || ('thinking' in message ? message.thinking : null);
  const files = ('files' in message ? message.files : undefined) ?? [];
  const parsedCron = isUser && !isStreaming ? parseCronMessage(message.text) : null;
  const displayText = message.text ?? '';
  const looksInstructional = /^\[(SYSTEM|Skill directory|The user has provided)/i.test(
    displayText.trim()
  );
  const hasTextContent = displayText && !displayText.startsWith('[Attached ');
  const shouldCollapse =
    !isStreaming && hasTextContent && displayText.length > LONG_MESSAGE_CHARS;
  const visibleText =
    shouldCollapse && !expanded
      ? `${displayText.slice(0, LONG_MESSAGE_CHARS)}\n\n...`
      : displayText;

  const handleCopy = () => {
    navigator.clipboard.writeText(displayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = useCallback(() => {
    if (messageId && 'conversationId' in message) {
      deleteMessage({ id: messageId, conversationId: message.conversationId });
    }
  }, [messageId, message, deleteMessage]);

  if (parsedCron) {
    return (
      <CronMessageBubble message={message as Message} messageId={messageId} parsed={parsedCron} />
    );
  }

  if (hidden) return null;

  if ('kind' in message && (kind === 'tool_call' || kind === 'tool_result')) {
    return <ToolEventBlock message={message as Message} />;
  }

  if (!isUser && kind === 'status' && !displayText && !thinking) {
    return null;
  }

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className="msg-avatar accent">
          <AutoAwesome />
        </div>
      )}
      <div className="msg-body">
        {hasTextContent || thinking || files.length > 0 ? (
          <div className="msg-actions">
            {hasTextContent ? (
              <button
                className="icon-btn"
                onClick={handleCopy}
                aria-label={copied ? t('chat.copied') : t('chat.copyMessage')}
                title={copied ? t('chat.copied') : t('chat.copyMessage')}
              >
                {copied ? <Done /> : <ContentCopy />}
              </button>
            ) : null}
            {messageId && 'conversationId' in message ? (
              <DeleteButton
                onConfirm={handleDelete}
                message={t('chat.deleteMessage')}
                renderTrigger={(onClick) => (
                  <button
                    className="icon-btn"
                    onClick={onClick}
                    aria-label={t('chat.deleteMessage')}
                    title={t('chat.deleteMessage')}
                  >
                    <DeleteOutline />
                  </button>
                )}
              />
            ) : null}
          </div>
        ) : null}
        {!isUser && thinking && (
          <ThinkingBlock text={thinking} isStreaming={isStreaming && !message.text} />
        )}
        {looksInstructional && (
          <span className="kb-tag">{t('chat.importedTranscript')}</span>
        )}
        {files.length > 0 && <FileAttachments files={files} isUser={isUser} />}
        {hasTextContent &&
          (isUser ? (
            <MarkdownContent inheritColor>{visibleText}</MarkdownContent>
          ) : (
            <MarkdownContent isStreaming={isStreaming}>{visibleText}</MarkdownContent>
          ))}
        {isStreaming && !hasTextContent && (
          <span className="stream-caret" />
        )}
        {(shouldCollapse || 'createdAt' in message) && (
          <div className="timestamp">
            {shouldCollapse && (
              <button
                className="icon-btn"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? t('chat.showLess') : t('chat.showFullMessage')}
              </button>
            )}
            {'createdAt' in message && <span>{formatMessageTimestamp(message.createdAt)}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

export default MessageBubble;
