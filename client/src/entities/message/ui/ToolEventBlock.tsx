import { useState } from 'react';
import { Check, ChevronRight, Close, PlayArrow, Terminal } from '@mui/icons-material';
import type { Message } from '../api';
import { useI18n } from '../../../shared/i18n';

interface ToolEventBlockProps {
  message: Message;
}

function ToolIcon({ status }: { status: Message['toolStatus'] }) {
  if (status === 'done') return <Check />;
  if (status === 'error') return <Close />;
  if (status === 'running') return <PlayArrow />;
  return <Terminal />;
}

function verbForTool(message: Message, toolName: string, status: Message['toolStatus']): string {
  if (message.kind === 'tool_result') return 'Result';
  if (status === 'running') return 'Running';
  if (/terminal|shell|bash|command/i.test(toolName)) return 'Ran';
  return 'Called';
}

export default function ToolEventBlock({ message }: ToolEventBlockProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const toolName = message.toolName || 'tool';
  const args = message.metadata?.arguments;
  const raw = message.metadata?.raw;
  const rawToolCalls = message.metadata?.rawToolCalls;
  const details = message.kind === 'tool_call' ? args ?? rawToolCalls ?? message.metadata : raw ?? message.metadata;
  const detailText = details && Object.keys(details as Record<string, unknown>).length ? JSON.stringify(details, null, 2) : '';
  const textDetails = message.text?.trim() ?? '';
  const hasDetails = Boolean(textDetails || detailText);
  const detailSize = [textDetails, detailText].filter(Boolean).join('\n\n').length;
  const status = message.toolStatus || (message.kind === 'tool_call' ? 'running' : 'done');
  const verb = verbForTool(message, toolName, status);

  return (
    <div>
      <button className="tool-chip" data-status={status} data-open={open} onClick={() => setOpen((value) => !value)}>
        <span className="tool-chip-icon">
          {status === 'running' ? <span className="spinner" /> : <ToolIcon status={status} />}
        </span>
        <span className="tool-chip-name">
          {verb}{' '}
          <code>{toolName}</code>
        </span>
        <span className="tool-chip-meta">
          <span>{detailSize > 0 ? `${Math.max(1, Math.ceil(detailSize / 1024))} KB` : t('tool.noPayload')}</span>
          <ChevronRight className="tool-chip-caret" />
        </span>
      </button>
      {open && hasDetails && (
        <div className="tool-detail">
          {textDetails ? (
            <>
              <div className="label">Output</div>
              {textDetails}
            </>
          ) : null}
          {detailText ? (
            <>
              <div className="label">Payload</div>
              {detailText}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
