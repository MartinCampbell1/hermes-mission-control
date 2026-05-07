export interface HermesThreadRowLike {
  id?: string | null;
  parent_session_id?: string | null;
  session_kind?: string | null;
  is_user_visible?: number | null;
  message_count?: number | null;
  started_at?: number | null;
  ended_at?: number | null;
  last_active?: number | null;
}

export interface SelectThreadRowsOptions {
  maxChainRows?: number;
  maxChainMessages?: number;
}

export const DEFAULT_MAX_CHAIN_ROWS = 6;
export const DEFAULT_MAX_CHAIN_MESSAGES = 1500;

function rowTimestamp(row: HermesThreadRowLike): number {
  return Number(row.last_active || row.ended_at || row.started_at || 0);
}

function rowMessageCount(row: HermesThreadRowLike): number {
  return Math.max(0, Number(row.message_count || 0));
}

function isCompressionRow(row: HermesThreadRowLike | null | undefined): boolean {
  return String(row?.session_kind || '').toLowerCase() === 'compression';
}

function isVisibleRow(row: HermesThreadRowLike | null | undefined): boolean {
  return row?.is_user_visible == null || Number(row.is_user_visible) === 1;
}

function sortNewestFirst<T extends HermesThreadRowLike>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const delta = rowTimestamp(b) - rowTimestamp(a);
    if (delta !== 0) return delta;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

export function selectThreadRowsForDetail<T extends HermesThreadRowLike>(
  rows: T[],
  requestedId: string,
  options: SelectThreadRowsOptions = {}
): T[] {
  const requestedRow = rows.find((row) => row.id === requestedId) || null;
  if (!requestedRow) {
    return sortNewestFirst(rows.filter(isVisibleRow)).slice(0, 1);
  }

  if (!isCompressionRow(requestedRow)) {
    return [requestedRow];
  }

  const maxChainRows = Math.max(1, options.maxChainRows ?? DEFAULT_MAX_CHAIN_ROWS);
  const maxChainMessages = Math.max(1, options.maxChainMessages ?? DEFAULT_MAX_CHAIN_MESSAGES);
  const visibleRows = rows.filter(isVisibleRow);
  const visibleRowsById = new Map<string, T>();
  const visibleChildrenByParent = new Map<string, T[]>();

  for (const row of visibleRows) {
    const rowId = String(row.id || '');
    if (rowId) visibleRowsById.set(rowId, row);
    if (!row.parent_session_id) continue;
    const parentId = String(row.parent_session_id);
    const current = visibleChildrenByParent.get(parentId) || [];
    current.push(row);
    visibleChildrenByParent.set(parentId, current);
  }

  Array.from(visibleChildrenByParent.entries()).forEach(([parentId, children]) => {
    visibleChildrenByParent.set(parentId, sortNewestFirst(children));
  });

  const selected: T[] = [requestedRow];
  const seen = new Set<string>([String(requestedRow.id || '')]);
  let totalMessages = rowMessageCount(requestedRow);
  let currentId = String(requestedRow.id || '');

  while (selected.length < maxChainRows) {
    const children = visibleChildrenByParent.get(currentId) || [];
    const nextRow = children.find((row) => {
      const rowId = String(row.id || '');
      return rowId && !seen.has(rowId);
    });
    if (!nextRow) break;

    const nextMessageCount = rowMessageCount(nextRow);
    if (selected.length > 0 && totalMessages + nextMessageCount > maxChainMessages) break;

    selected.push(nextRow);
    seen.add(String(nextRow.id || ''));
    totalMessages += nextMessageCount;
    currentId = String(nextRow.id || '');
  }

  if (selected.length > 1) return selected;

  const ancestors: T[] = [];
  let ancestorId = String(requestedRow.parent_session_id || '');
  while (ancestorId && selected.length + ancestors.length < maxChainRows) {
    const ancestor = visibleRowsById.get(ancestorId);
    if (!ancestor || !isCompressionRow(ancestor)) break;

    const ancestorRowId = String(ancestor.id || '');
    const ancestorMessageCount = rowMessageCount(ancestor);
    if ((ancestorRowId && seen.has(ancestorRowId)) || totalMessages + ancestorMessageCount > maxChainMessages) {
      break;
    }

    ancestors.push(ancestor);
    seen.add(ancestorRowId);
    totalMessages += ancestorMessageCount;
    ancestorId = String(ancestor.parent_session_id || '');
  }

  ancestors.reverse();
  return [...ancestors, ...selected];
}
