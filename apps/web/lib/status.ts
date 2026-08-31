/** Maps a document status to a badge CSS class. */
export const statusClass = (s: string): 'ok' | 'warn' | 'muted' =>
  s === 'RELEASED' || s === 'COMPLETED'
    ? 'ok'
    : s === 'FOR_APPROVAL' || s === 'APPROVED' || s === 'PARTIALLY_RECEIVED'
      ? 'warn'
      : 'muted';
