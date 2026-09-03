import type { LotExpiryState } from '@iw/contracts';
import { DEFAULT_EXPIRING_SOON_DAYS } from '@iw/contracts';

/**
 * Business-date expiry boundary (ADR 0008 §3). A lot is *valid through* its expiryDate and becomes
 * expired when the local business date > expiryDate — never an arbitrary UTC-midnight timestamp compare.
 * The org timezone is centralized here (org settings may override; a single default for now).
 */
export const DEFAULT_BUSINESS_TZ = 'UTC';

/** The local calendar date ('YYYY-MM-DD') in the business timezone. */
export function businessToday(tz: string = DEFAULT_BUSINESS_TZ, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The calendar date ('YYYY-MM-DD') of a stored timestamp, in the business timezone. */
export function toBusinessDate(d: Date, tz: string = DEFAULT_BUSINESS_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const dayNumber = (isoDate: string): number => Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10)) / 86_400_000;

/** Whole days from the business today until a date ('YYYY-MM-DD'); negative if past. */
export function daysUntil(isoDate: string, tz: string = DEFAULT_BUSINESS_TZ, now: Date = new Date()): number {
  return dayNumber(isoDate) - dayNumber(businessToday(tz, now));
}

/** Expired when the business date is strictly after the expiry date. */
export function isExpired(expiryDate: Date | null, tz: string = DEFAULT_BUSINESS_TZ, now: Date = new Date()): boolean {
  if (!expiryDate) return false;
  return businessToday(tz, now) > toBusinessDate(expiryDate, tz);
}

/** Derived, non-persisted expiry state (ADR 0008 §9). */
export function expiryStateOf(
  expiryDate: Date | null,
  expiringSoonDays: number = DEFAULT_EXPIRING_SOON_DAYS,
  tz: string = DEFAULT_BUSINESS_TZ,
  now: Date = new Date(),
): LotExpiryState {
  if (!expiryDate) return 'NO_EXPIRY';
  const days = daysUntil(toBusinessDate(expiryDate, tz), tz, now);
  if (days < 0) return 'EXPIRED';
  if (days <= expiringSoonDays) return 'EXPIRING_SOON';
  return 'HEALTHY';
}
