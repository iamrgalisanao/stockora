/**
 * Bulk import contracts (2A.3A). Import is a STAGED operation: preview parses + validates and writes
 * only to the staging tables; commit later replays the already-validated rows through domain rules
 * and the ledger. Never a direct bypass.
 */

export const IMPORT_TYPES = ['PRODUCTS', 'SUPPLIERS', 'OPENING_INVENTORY'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_STATUSES = ['PENDING', 'VALIDATED', 'COMMITTING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_ROW_STATUSES = ['VALID', 'INVALID', 'WARNING'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export interface ImportRowResponse {
  rowNumber: number;
  status: ImportRowStatus;
  rawData: Record<string, string>;
  normalizedData: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
}

export interface ImportJobResponse {
  id: string;
  organizationId: string;
  type: ImportType;
  status: ImportStatus;
  sourceFileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningRows: number;
  createdById: string | null;
  createdAt: string;
  committedAt: string | null;
  error: string | null;
}

export interface ImportPreviewResponse {
  job: ImportJobResponse;
  rows: ImportRowResponse[];
}

/** Upload payload — the raw CSV text plus its file name (kept simple; no multipart in v1). */
export interface ImportUploadRequest {
  fileName: string;
  content: string;
}
