/** Maps a document status to a badge CSS class. */
export const statusClass = (s: string): 'ok' | 'warn' | 'muted' =>
  s === 'RELEASED' || s === 'COMPLETED' || s === 'RECEIVED'
    ? 'ok'
    : s === 'FOR_APPROVAL' || s === 'APPROVED' || s === 'PARTIALLY_RECEIVED' || s === 'IN_TRANSIT'
      ? 'warn'
      : 'muted';
