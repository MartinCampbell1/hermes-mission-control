import { useState, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Send,
  AttachFile,
  Close,
  InsertDriveFileOutlined,
  ImageOutlined,
  AddCommentOutlined,
  ClearAllOutlined,
  CompressOutlined,
  HelpOutline,
  SettingsOutlined,
  ExtensionOutlined,
  BuildOutlined,
  HubOutlined,
} from '@mui/icons-material';
import { useNavigate } from 'react-router';
import { useCreateConversationMutation } from '../../../entities/conversation';
import { useGetAgentQuery, usePatchSessionSettingsMutation } from '../../../entities/agent';
import {
  useGetSlashCatalogQuery,
  useResolveSlashCommandMutation,
  type SlashCatalogItem,
} from '../../../entities/slash';
import {
  FALLBACK_SLASH_COMMANDS,
  getMatchingSlashCommands,
  getSlashCommand,
  parseSlashCommand,
  slashCommandHelpText,
  sourceLabel,
} from '../model/slashCommands';
import { getChatInputControls } from '../model/chatInputControls';
import { useI18n } from '../../../shared/i18n';

interface ChatInputProps {
  agentId: string;
  conversationId: string;
  onSend: (text: string, files: File[]) => Promise<void>;
  isStreaming: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onToggleSessionSettings: () => void;
  sessionSettingsOpen: boolean;
}

const COMPACT_PROMPT = 'Please compress and summarize the conversation context to free up space.';

function commandIcon(command: SlashCatalogItem): ReactNode {
  if (command.source === 'skill') return <ExtensionOutlined sx={{ fontSize: 17 }} />;
  if (command.source === 'toolset') return <BuildOutlined sx={{ fontSize: 17 }} />;
  if (command.source === 'workspace') return <HubOutlined sx={{ fontSize: 17 }} />;
  if (command.name === 'help') return <HelpOutline sx={{ fontSize: 17 }} />;
  if (command.name === 'new') return <AddCommentOutlined sx={{ fontSize: 17 }} />;
  if (command.name === 'clear') return <ClearAllOutlined sx={{ fontSize: 17 }} />;
  if (command.name === 'compact') return <CompressOutlined sx={{ fontSize: 17 }} />;
  return <SettingsOutlined sx={{ fontSize: 17 }} />;
}

export default function ChatInput({
  agentId,
  conversationId,
  onSend,
  isStreaming,
  disabled = false,
  disabledReason,
  onToggleSessionSettings,
  sessionSettingsOpen,
}: ChatInputProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const [createConversation] = useCreateConversationMutation();
  const [patchSessionSettings] = usePatchSessionSettingsMutation();
  const [resolveSlashCommand] = useResolveSlashCommandMutation();
  const { data: agent } = useGetAgentQuery(agentId, { skip: !agentId });
  const hermesProfile = agent?.hermesProfile ?? null;
  const { data: slashCatalog } = useGetSlashCatalogQuery({ profile: hermesProfile, limit: 200 });
  const controls = useMemo(
    () =>
      getChatInputControls({
        text,
        pendingFilesCount: pendingFiles.length,
        isStreaming,
        copy: {
          placeholder: t('chat.placeholder'),
          draftPlaceholder: t('chat.draftPlaceholder'),
          draftSaved: t('chat.draftSaved'),
          draftAllowed: t('chat.draftAllowed'),
          sendWhenDone: t('chat.sendWhenDone'),
          send: t('chat.send'),
          sendBlocked: t('chat.sendBlocked'),
          typeOrAttach: t('chat.typeOrAttach'),
          attach: t('chat.attach'),
          attachAfterStream: t('chat.attachAfterStream'),
          attachmentLimit: t('chat.attachmentLimit'),
        },
      }),
    [text, pendingFiles.length, isStreaming, t]
  );

  const slashCommands = useMemo(
    () =>
      slashCatalog?.items && slashCatalog.items.length > 0
        ? slashCatalog.items
        : FALLBACK_SLASH_COMMANDS,
    [slashCatalog]
  );
  const matchingCommands = useMemo(
    () => getMatchingSlashCommands(text, slashCommands),
    [text, slashCommands]
  );
  const showCommandMenu =
    matchingCommands.length > 0 && text.startsWith('/') && !text.includes('\n') && !isStreaming;

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      setSelectedCommandIndex(0);
      setCommandNotice(null);
      setCommandError(null);
    },
    []
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || controls.attachmentsDisabled) {
      e.target.value = '';
      inputRef.current?.focus();
      return;
    }
    const selected = e.target.files;
    if (!selected) return;
    setPendingFiles((prev) => [...prev, ...Array.from(selected)].slice(0, 5));
    e.target.value = '';
    inputRef.current?.focus();
  };

  const shortFileName = (name: string) =>
    name.length > 34 ? `${name.slice(0, 18)}...${name.slice(-12)}` : name;

  const applyTextSetting = useCallback(
    async (
      field: 'modelOverride' | 'providerOverride' | 'skillsOverride' | 'toolsetsOverride' | 'verboseLevel',
      value: string,
      usage: string
    ): Promise<boolean> => {
      const trimmed = value.trim();
      if (!trimmed) {
        setCommandError(t('chat.usage', { usage }));
        return false;
      }
      await patchSessionSettings({
        agentId,
        conversationId,
        settings: { [field]: trimmed === 'inherit' ? null : trimmed },
      }).unwrap();
      setCommandNotice(`${field.replace('Override', '').replace('Level', '')}: ${trimmed}`);
      return true;
    },
    [agentId, conversationId, patchSessionSettings, t]
  );

  const executeLocalCommand = useCallback(
    async (command: SlashCatalogItem): Promise<boolean> => {
      if (command.name === 'help') {
        setCommandNotice(slashCommandHelpText(slashCommands));
      } else if (command.name === 'new') {
        const created = await createConversation({ agentId }).unwrap();
        navigate(`/agent/${agentId}/chat/${created._id}`);
      } else if (command.name === 'clear') {
        setPendingFiles([]);
        setCommandNotice(t('chat.draftCleared'));
      } else if (command.name === 'settings') {
        onToggleSessionSettings();
        setCommandNotice(
          sessionSettingsOpen ? t('chat.sessionSettingsClosed') : t('chat.sessionSettingsOpened')
        );
      } else if (command.name === 'compact') {
        setText('');
        setPendingFiles([]);
        await onSend(COMPACT_PROMPT, []);
      } else {
        setCommandError(t('chat.commandUnavailable', { command: command.name }));
      }
      return true;
    },
    [
      agentId,
      createConversation,
      navigate,
      onSend,
      onToggleSessionSettings,
      sessionSettingsOpen,
      slashCommands,
      t,
    ]
  );

  const executeSlashCommand = useCallback(
    async (rawText: string, files: File[] = []): Promise<boolean> => {
      const parsed = parseSlashCommand(rawText.trim());
      if (!parsed || !parsed.name) return false;

      setCommandError(null);
      setCommandNotice(null);
      let clearDraft = false;
      let resolvedByApi = false;

      try {
        const result = await resolveSlashCommand({ text: rawText.trim(), profile: hermesProfile }).unwrap();
        resolvedByApi = true;
        if (result.kind === 'not_slash') return false;
        if (result.kind === 'unknown') {
          setCommandError(t('chat.unknownCommand', { command: result.commandName || '(empty)' }));
        } else if (result.kind === 'local') {
          await executeLocalCommand(result.item);
          clearDraft = true;
        } else if (result.kind === 'route') {
          navigate(result.route);
          clearDraft = true;
        } else if (result.kind === 'setting') {
          const key = result.item.settingKey;
          if (
            key === 'modelOverride' ||
            key === 'providerOverride' ||
            key === 'skillsOverride' ||
            key === 'toolsetsOverride' ||
            key === 'verboseLevel'
          ) {
            clearDraft = await applyTextSetting(key, result.value, result.item.usage);
          } else {
            setCommandError(`/${result.item.name} cannot be applied in this shell.`);
          }
        } else if (result.kind === 'web_v1_skill_invocation' || result.kind === 'send_message') {
          setText('');
          setPendingFiles([]);
          await onSend(result.messageText, files);
          clearDraft = true;
        }
      } catch (err) {
        const localCommand = !resolvedByApi ? getSlashCommand(parsed.name, FALLBACK_SLASH_COMMANDS) : null;
        if (localCommand?.executeMode === 'local') {
          await executeLocalCommand(localCommand);
          clearDraft = true;
        } else {
          setCommandError(err instanceof Error ? err.message : t('chat.slashFailed'));
        }
      }

      if (clearDraft) setText('');
      setTimeout(() => inputRef.current?.focus(), 0);
      return true;
    },
    [
      applyTextSetting,
      executeLocalCommand,
      hermesProfile,
      navigate,
      onSend,
      resolveSlashCommand,
      t,
    ]
  );

  const insertOrRunCommand = useCallback(
    async (command: SlashCatalogItem) => {
      if (command.argsHint || command.source === 'skill') {
        setText(command.insertText.endsWith(' ') ? command.insertText : `${command.insertText} `);
        setCommandNotice(null);
        setCommandError(null);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      await executeSlashCommand(`/${command.name}`);
    },
    [executeSlashCommand]
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (disabled || controls.sendDisabled) return;

    if (trimmed.startsWith('/') && !trimmed.includes('\n')) {
      const handled = await executeSlashCommand(trimmed, [...pendingFiles]);
      if (handled) return;
    }

    const filesToSend = [...pendingFiles];
    setText('');
    setPendingFiles([]);
    await onSend(trimmed, filesToSend);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [text, pendingFiles, controls.sendDisabled, disabled, onSend, executeSlashCommand]);

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex((idx) => (idx + 1) % matchingCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex((idx) => (idx - 1 + matchingCommands.length) % matchingCommands.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        await insertOrRunCommand(matchingCommands[selectedCommandIndex] ?? matchingCommands[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setText('');
        setCommandNotice(null);
        setCommandError(null);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && text.trim() === '/') {
        e.preventDefault();
        await insertOrRunCommand(matchingCommands[selectedCommandIndex] ?? matchingCommands[0]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="composer-wrap">
      {(commandNotice || commandError) && (
        <div className={`composer-notice ${commandError ? 'err' : ''}`}>
          {commandError || commandNotice}
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className="composer-files">
          <div className="composer-files-hd">
            <span>{t('chat.fileCount', { count: pendingFiles.length })}</span>
            <button className="icon-btn" aria-label={t('chat.clearAttachments')} onClick={() => setPendingFiles([])}>
              <Close />
            </button>
          </div>
          <div className="composer-file-list">
            {pendingFiles.map((file, index) => (
              <button
                key={`${file.name}-${index}`}
                className="file-chip"
                type="button"
                title={file.name}
                onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== index))}
              >
                {file.type.startsWith('image/') ? <ImageOutlined /> : <InsertDriveFileOutlined />}
                <span>{shortFileName(file.name)}</span>
                <Close />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="composer">
        {showCommandMenu && (
          <div className="slash-menu">
            {matchingCommands.map((command, idx) => (
              <button
                key={command.name}
                className="slash-row"
                data-active={idx === selectedCommandIndex}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  void insertOrRunCommand(command);
                }}
              >
                <span className="slash-icon">{commandIcon(command)}</span>
                <span className="slash-copy">
                  <span className="slash-top">
                    <span>{command.usage}</span>
                    <code>{sourceLabel(command.source)}</code>
                  </span>
                  <span className="slash-desc">{command.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          disabled={disabled || controls.attachmentsDisabled}
          onChange={handleFileChange}
        />
        <div className="composer-actions">
          <button
            className="icon-btn"
            aria-label={t('chat.attach')}
            title={disabled ? disabledReason : controls.attachmentTooltip}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || controls.attachmentsDisabled}
            type="button"
          >
            <AttachFile />
          </button>
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          placeholder={disabled ? (disabledReason ?? controls.placeholder) : controls.placeholder}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          className="send-btn"
          aria-label={controls.sendAriaLabel}
          title={disabled ? disabledReason : controls.sendTooltip}
          onClick={() => void handleSend()}
          disabled={disabled || controls.sendDisabled}
          type="button"
        >
          <Send />
        </button>
      </div>
      {(disabledReason || controls.statusText) && (
        <div className="composer-foot" role="status">
          {disabledReason || controls.statusText}
        </div>
      )}
    </div>
  );
}
