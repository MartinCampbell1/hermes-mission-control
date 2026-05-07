import { useMemo, useState } from 'react';
import { Check, ChevronRight } from '@mui/icons-material';
import type { Message } from '../api';
import ThinkingBlock from './ThinkingBlock';
import ToolEventBlock from './ToolEventBlock';

interface AgentActivityBlockProps {
  thinkingText?: string;
  toolMessages?: Message[];
  isStreaming?: boolean;
}

function formatBytes(size: number): string {
  if (size <= 0) return '0 KB';
  return `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

function detailSize(message: Message): number {
  const details = [
    message.text?.trim() ?? '',
    JSON.stringify(message.metadata ?? {}),
  ].filter(Boolean).join('\n\n');
  return details.length;
}

export default function AgentActivityBlock({
  thinkingText,
  toolMessages = [],
  isStreaming,
}: AgentActivityBlockProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolCallCount = toolMessages.filter((message) => message.kind === 'tool_call').length || toolMessages.length;
  const totalSize = useMemo(
    () => toolMessages.reduce((sum, message) => sum + detailSize(message), 0),
    [toolMessages]
  );
  const allDone = toolMessages.every((message) => (message.toolStatus ?? 'done') !== 'running');

  if (!thinkingText && toolMessages.length === 0) return null;

  return (
    <div className="activity-block">
      {thinkingText ? <ThinkingBlock text={thinkingText} isStreaming={isStreaming} /> : null}
      {toolMessages.length > 0 ? (
        <div className="tool-group" data-open={toolsOpen}>
          <button
            className="tool-group-hd"
            type="button"
            onClick={() => setToolsOpen((value) => !value)}
            aria-expanded={toolsOpen}
          >
            <span className="tool-chip-icon" data-status={allDone ? 'done' : 'running'}>
              {allDone ? <Check /> : <span className="spinner" />}
            </span>
            <span className="label">{toolCallCount} tool {toolCallCount === 1 ? 'call' : 'calls'}</span>
            <span className="meta">
              {formatBytes(totalSize)}
              <span>·</span>
              <span>{allDone ? 'all done' : 'running'}</span>
            </span>
            <ChevronRight className="caret" />
          </button>
          {toolsOpen ? (
            <div className="tool-group-body">
              {toolMessages.map((message) => (
                <ToolEventBlock key={message._id} message={message} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
