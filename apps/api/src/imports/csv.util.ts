import { createHash } from 'node:crypto';

export const MAX_IMPORT_BYTES = 2_000_000; // 2 MB
export const MAX_IMPORT_ROWS = 5_000;

export interface ParsedCsv {
  headers: string[];
  records: Array<Record<string, string>>;
}

/**
 * Minimal RFC4180-ish CSV parser (no external dependency). Handles quoted fields with embedded
 * commas / newlines / doubled quotes, strips a UTF-8 BOM, and skips blank lines. Header names are
 * lower-cased and trimmed. This only reads text — it never evaluates spreadsheet formulas.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }

  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { rec[h] = (r[idx] ?? '').trim(); });
    return rec;
  });
  return { headers, records };
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Neutralize CSV-injection: prefix a cell that would otherwise be read as a formula. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const needsGuard = /^[=+\-@\t\r]/.test(s);
  const guarded = needsGuard ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

// ---- typed cell helpers used by validators ----

export function parseBool(v: string | undefined): boolean | null {
  if (v === undefined || v.trim() === '') return null;
  const s = v.trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return null; // caller treats as invalid
}

export function parseDecimal(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : NaN;
}
