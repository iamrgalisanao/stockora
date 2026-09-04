/**
 * Same-origin cross-context coordination (2D.6A, ADR 0014 §7). BroadcastChannel lets the tabs/windows and the
 * service worker on ONE device tell each other about sync progress, auth changes, and app updates so they stay
 * consistent without polling. Like the sync lock, this is local coordination — not a cross-device channel.
 */

export const CHANNEL_NAME = 'inventory-mobile';

/** The coordination message set (ADR 0014 §7). Kept small and explicit. */
export type MobileChannelMessage =
  | { type: 'SYNC_STARTED'; at: number }
  | { type: 'COMMAND_SYNCED'; commandId: string; at: number }
  | { type: 'COMMAND_CONFLICT'; commandId: string; at: number }
  | { type: 'AUTH_LOGOUT'; at: number }
  | { type: 'APP_UPDATED'; version: string; at: number };

export function broadcastAvailable(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

/** A thin typed wrapper. No-ops gracefully where BroadcastChannel is unavailable. */
export class MobileChannel {
  private ch: BroadcastChannel | null = null;

  constructor() {
    if (broadcastAvailable()) this.ch = new BroadcastChannel(CHANNEL_NAME);
  }

  post(msg: MobileChannelMessage): void {
    this.ch?.postMessage(msg);
  }

  on(fn: (msg: MobileChannelMessage) => void): () => void {
    if (!this.ch) return () => {};
    const handler = (e: MessageEvent) => fn(e.data as MobileChannelMessage);
    this.ch.addEventListener('message', handler);
    return () => this.ch?.removeEventListener('message', handler);
  }

  close(): void {
    this.ch?.close();
    this.ch = null;
  }
}
