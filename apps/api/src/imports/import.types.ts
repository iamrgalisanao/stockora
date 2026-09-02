/** One row after validation — the staged unit the commit later replays. */
export interface ValidatedRow {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
}

export function rowStatus(r: ValidatedRow): 'VALID' | 'INVALID' | 'WARNING' {
  if (r.errors.length > 0) return 'INVALID';
  if (r.warnings.length > 0) return 'WARNING';
  return 'VALID';
}
