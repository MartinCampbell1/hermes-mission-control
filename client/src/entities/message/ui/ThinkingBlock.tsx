import { useState } from 'react';
import { ChevronRight } from '@mui/icons-material';
import { MarkdownContent } from '../../../shared/ui';
import { useI18n } from '../../../shared/i18n';

interface ThinkingBlockProps {
  text: string;
  isStreaming?: boolean;
}

function readableThinking(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const values: string[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if ('summary' in value && typeof value.summary === 'string') values.push(value.summary);
      if ('text' in value && typeof value.text === 'string') values.push(value.text);
      if ('content' in value && Array.isArray(value.content)) value.content.forEach(visit);
      if (Array.isArray(value)) value.forEach(visit);
    };
    visit(parsed);
    const cleaned = values
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .join('\n\n');
    return cleaned || 'Hermes recorded internal activity for this step.';
  } catch {
    return text;
  }
}

export default function ThinkingBlock({ text, isStreaming }: ThinkingBlockProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const displayText = readableThinking(text);

  if (!text) return null;

  return (
    <details className="thought" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <ChevronRight />
        <span>{isStreaming ? t('chat.thinking') : t('chat.thoughtProcess')}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
          ~{Math.max(1, Math.round(text.length / 6))} tokens
        </span>
      </summary>
      <div className="thought-body">
        <MarkdownContent isStreaming={isStreaming}>{displayText}</MarkdownContent>
      </div>
    </details>
  );
}
