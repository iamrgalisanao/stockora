/** Maps a document status to a badge CSS class. */
const OK = ['RELEASED', 'COMPLETED', 'RECEIVED', 'POSTED'];
const WARN = [
  'FOR_APPROVAL',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'IN_TRANSIT',
  'SUBMITTED',
  'PENDING_SECOND_APPROVAL',
];

export const statusClass = (s: string): 'ok' | 'warn' | 'muted' =>
  OK.includes(s) ? 'ok' : WARN.includes(s) ? 'warn' : 'muted';
