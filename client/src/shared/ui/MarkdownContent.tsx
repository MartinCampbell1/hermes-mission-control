import { useEffect } from 'react';
import { Box, Chip, Typography, useTheme } from '@mui/material';
import { alpha, getLuminance } from '@mui/material/styles';
import { BuildOutlined } from '@mui/icons-material';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljsGithubLightUrl from 'highlight.js/styles/github.css?url';
import hljsGithubDarkUrl from 'highlight.js/styles/github-dark.css?url';

let hljsThemeLinkEl: HTMLLinkElement | null = null;

function syncHljsStylesheet(isDarkUi: boolean) {
  if (!hljsThemeLinkEl) {
    hljsThemeLinkEl = document.createElement('link');
    hljsThemeLinkEl.rel = 'stylesheet';
    hljsThemeLinkEl.id = 'hermes-hljs-theme';
    document.head.appendChild(hljsThemeLinkEl);
  }
  const href = isDarkUi ? hljsGithubDarkUrl : hljsGithubLightUrl;
  if (hljsThemeLinkEl.getAttribute('href') !== href) {
    hljsThemeLinkEl.setAttribute('href', href);
  }
}

function stripWrapperTags(text: string): string {
  if (!text) return text;
  const TAG = 'final|output|think|thinking|redacted_thinking';
  return text
    .replace(/<(?:think|thinking|redacted_thinking)>[\s\S]*?<\/(?:think|thinking|redacted_thinking)>/gi, '')
    .replace(new RegExp(`^<(?:${TAG})\\b[^>]*>`, 'i'), '')
    .replace(new RegExp(`</(?:${TAG})\\s*>\\s*$`, 'i'), '')
    .replace(/<\/[a-z]*\s*$/i, '')
    .trim();
}

type MarkdownBlock = {
  kind: 'markdown';
  text: string;
};

type ToolTranscriptBlock = {
  kind: 'tool-transcript';
  title: string;
  subtitle: string;
  preview: string[];
  raw: string;
};

type RenderBlock = MarkdownBlock | ToolTranscriptBlock;

function normalizeEscapedTranscript(content: string): string {
  if (!/Assistant Tool Calls|###\s*Tool\s*\(/i.test(content)) return content;
  return content
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

function findFirstIndexAfter(regex: RegExp, content: string, start: number, before?: number) {
  regex.lastIndex = start;
  let match = regex.exec(content);
  while (match) {
    const index = match.index;
    if (index > start && (before === undefined || index < before)) return index;
    match = regex.exec(content);
  }
  return undefined;
}

function findToolTranscriptRanges(content: string): Array<{ start: number; end: number }> {
  const assistantToolsMarker =
    /(?:^|\n)\s*(?:\d+\s*)?\|?\s*#{1,6}\s*Assistant Tool Calls\b/gi;
  const toolHeadingMarker = /(?:^|\n)\s*(?:\d+\s*)?\|?\s*#{1,6}\s*Tool\s*\(/gi;
  const answerMarker =
    /(?:^|\n)\s*(?:\d+\s*)?\|?\s*#{1,6}\s*(?:Assistant Response|Assistant Message|Assistant Final|Final Answer|Response)\b/gi;
  const ranges: Array<{ start: number; end: number }> = [];
  const assistantMatches = Array.from(content.matchAll(assistantToolsMarker));

  if (assistantMatches.length > 0) {
    for (let index = 0; index < assistantMatches.length; index += 1) {
      const start = assistantMatches[index].index ?? 0;
      const nextStart = assistantMatches[index + 1]?.index;
      const answerStart = findFirstIndexAfter(answerMarker, content, start, nextStart);
      const end = answerStart ?? nextStart ?? content.length;
      if (end > start) ranges.push({ start, end });
    }
    return ranges;
  }

  const firstTool = Array.from(content.matchAll(toolHeadingMarker))[0];
  if (!firstTool) return ranges;

  const start = firstTool.index ?? 0;
  const answerStart = findFirstIndexAfter(answerMarker, content, start);
  ranges.push({ start, end: answerStart ?? content.length });
  return ranges;
}

function readToolNames(raw: string): string[] {
  const names = new Set<string>();
  const listItem = /(?:^|\n)\s*(?:\d+\s*)?\|?\s*-\s*([a-zA-Z0-9_.:/-]+)/g;
  for (const match of raw.matchAll(listItem)) {
    const name = match[1]?.trim();
    if (name) names.add(name);
  }
  return Array.from(names);
}

function summarizeToolTranscript(raw: string): ToolTranscriptBlock {
  const toolNames = readToolNames(raw);
  const explicitToolBlocks = raw.match(/#{1,6}\s*Tool\s*\(/gi)?.length ?? 0;
  const count = Math.max(toolNames.length, explicitToolBlocks, 1);
  const preview = toolNames.slice(0, 4);
  const moreCount = Math.max(0, count - preview.length);

  return {
    kind: 'tool-transcript',
    title: 'Hermes tool calls',
    subtitle: `${count} ${count === 1 ? 'tool call' : 'tool calls'} hidden by default`,
    preview: moreCount > 0 ? [...preview, `+${moreCount} more`] : preview,
    raw: raw.trim(),
  };
}

function buildRenderBlocks(content: string): RenderBlock[] {
  const normalized = normalizeEscapedTranscript(content);
  const ranges = findToolTranscriptRanges(normalized);
  if (ranges.length === 0) return [{ kind: 'markdown', text: normalized }];

  const blocks: RenderBlock[] = [];
  let cursor = 0;

  for (const range of ranges) {
    const before = normalized.slice(cursor, range.start).trim();
    if (before) blocks.push({ kind: 'markdown', text: before });

    const rawToolTranscript = normalized.slice(range.start, range.end);
    blocks.push(summarizeToolTranscript(rawToolTranscript));
    cursor = range.end;
  }

  const after = normalized.slice(cursor).trim();
  if (after) blocks.push({ kind: 'markdown', text: after });

  return blocks;
}

function ToolTranscriptAccordion({ block }: { block: ToolTranscriptBlock }) {
  return (
    <Box
      component="details"
      sx={{
        my: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.default',
        overflow: 'hidden',
        '&[open] summary': {
          borderBottom: '1px solid',
          borderColor: 'divider',
        },
      }}
    >
      <Box
        component="summary"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 44,
          px: 1.25,
          py: 0.9,
          cursor: 'pointer',
          listStyle: 'none',
          userSelect: 'none',
          '&::-webkit-details-marker': { display: 'none' },
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <BuildOutlined sx={{ fontSize: 17, color: 'text.secondary', flex: '0 0 auto' }} />
        <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {block.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {block.subtitle}
          </Typography>
        </Box>
        {block.preview.length > 0 && (
          <Box
            sx={{
              display: { xs: 'none', sm: 'flex' },
              alignItems: 'center',
              gap: 0.5,
              maxWidth: '42%',
              overflow: 'hidden',
            }}
          >
            {block.preview.map((item) => (
              <Chip
                key={item}
                size="small"
                label={item}
                variant="outlined"
                sx={{
                  height: 20,
                  maxWidth: 140,
                  '& .MuiChip-label': {
                    px: 0.75,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                }}
              />
            ))}
          </Box>
        )}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: 'auto', flex: '0 0 auto', fontWeight: 700 }}
        >
          Details
        </Typography>
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          maxHeight: 420,
          overflow: 'auto',
          p: 1.25,
          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
          fontSize: '0.74rem',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          color: 'text.secondary',
          bgcolor: 'background.paper',
        }}
      >
        {block.raw}
      </Box>
    </Box>
  );
}

const markdownComponents: Partial<Components> = {
  table({ children, ...props }) {
    return (
      <Box sx={{ overflowX: 'auto', maxWidth: '100%', mb: 0.75, WebkitOverflowScrolling: 'touch' }}>
        <Box
          component="table"
          {...props}
          sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}
        >
          {children}
        </Box>
      </Box>
    );
  },
};

export default function MarkdownContent({
  children,
  isStreaming,
  inheritColor,
}: {
  children: string;
  isStreaming?: boolean;
  /** Use bubble text color (e.g. user messages on tinted background). */
  inheritColor?: boolean;
}) {
  const theme = useTheme();
  const isDarkUi =
    theme.palette.mode === 'dark' || getLuminance(theme.palette.background.paper) < 0.5;

  const codeBlockBg = isDarkUi ? '#0d1117' : '#f6f8fa';
  const safe = inheritColor ? children : stripWrapperTags(children);
  const renderBlocks = buildRenderBlocks(safe);
  const ut = theme.palette.chat.userText;

  useEffect(() => {
    syncHljsStylesheet(isDarkUi);
  }, [isDarkUi]);

  // Streaming: do not use react-markdown — incomplete `<final` is parsed as HTML and hides the rest until `>`.
  if (isStreaming) {
    return (
      <Box
        sx={{
          fontSize: '0.92rem',
          lineHeight: 1.72,
          minWidth: 0,
          maxWidth: '100%',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          color: inheritColor ? 'inherit' : 'text.primary',
        }}
      >
        <Typography component="div" variant="body1" sx={{ whiteSpace: 'pre-wrap', m: 0 }}>
          {safe}
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              width: 6,
              height: 14,
              bgcolor: 'text.secondary',
              ml: 0.3,
              animation: 'blink 1s step-end infinite',
              verticalAlign: 'text-bottom',
              '@keyframes blink': { '50%': { opacity: 0 } },
            }}
          />
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        fontSize: '0.92rem',
        lineHeight: 1.72,
        minWidth: 0,
        maxWidth: '100%',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        color: inheritColor ? 'inherit' : 'text.primary',
        '& p': {
          m: 0,
          mb: 1,
          '&:last-child': { mb: 0 },
          ...(inheritColor ? { color: 'inherit' } : {}),
        },
        '& h1,& h2,& h3,& h4,& h5,& h6': {
          mt: 1.75,
          mb: 0.5,
          fontWeight: 600,
          lineHeight: 1.3,
          color: inheritColor ? 'inherit' : 'text.primary',
          '&:first-of-type': { mt: 0 },
        },
        '& h1': { fontSize: '1.18rem' },
        '& h2': { fontSize: '1.05rem' },
        '& h3': { fontSize: '0.95rem' },
        '& ul,& ol': { pl: 2.5, m: 0, mb: 1 },
        '& li': { mb: 0.35 },
        '& li > p': { mb: 0 },
        '& blockquote': inheritColor
          ? {
              m: 0,
              mb: 1,
              pl: 1.5,
              borderLeft: '3px solid',
              borderColor: alpha(ut, 0.45),
              color: 'inherit',
              fontStyle: 'italic',
              opacity: 0.95,
            }
          : {
              m: 0,
              mb: 1,
              pl: 1.5,
              borderLeft: '3px solid',
              borderColor: 'divider',
              color: 'text.secondary',
              fontStyle: 'italic',
            },
        '& a': inheritColor
          ? {
              color: 'inherit',
              textDecoration: 'underline',
              fontWeight: 500,
              opacity: 0.95,
              '&:hover': { opacity: 1 },
            }
          : {
              color: 'primary.main',
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' },
            },
        '& img': { maxWidth: '100%', height: 'auto', borderRadius: '8px' },
        '& hr': { border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 1 },
        '& th,& td': {
          border: '1px solid',
          borderColor: 'divider',
          px: 1.5,
          py: 0.75,
          textAlign: 'left',
          wordBreak: 'break-word',
        },
        '& th': {
          fontWeight: 600,
          bgcolor: isDarkUi ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        },
        '& code:not(pre code)': {
          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
          fontSize: '0.82rem',
          px: 0.6,
          py: 0.15,
          borderRadius: '4px',
          bgcolor: inheritColor
            ? alpha(ut, 0.2)
            : isDarkUi
              ? 'rgba(255,255,255,0.1)'
              : 'rgba(0,0,0,0.07)',
          color: inheritColor ? 'inherit' : undefined,
        },
        '& pre': {
          m: 0,
          mb: 1,
          maxWidth: '100%',
          width: '100%',
          boxSizing: 'border-box',
          borderRadius: '8px',
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          bgcolor: codeBlockBg,
          border: '1px solid',
          borderColor: 'divider',
          '& code': {
            fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
            fontSize: '0.82rem',
            background: 'none',
            p: 0,
            whiteSpace: 'pre',
            wordBreak: 'normal',
            display: 'block',
          },
          '& .hljs': {
            background: 'transparent !important',
            p: 1.5,
            display: 'block',
          },
        },
      }}
    >
      {renderBlocks.map((block, index) =>
        block.kind === 'tool-transcript' ? (
          <ToolTranscriptAccordion key={`tool-${index}`} block={block} />
        ) : (
          <ReactMarkdown
            key={`markdown-${index}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {block.text}
          </ReactMarkdown>
        )
      )}
    </Box>
  );
}
