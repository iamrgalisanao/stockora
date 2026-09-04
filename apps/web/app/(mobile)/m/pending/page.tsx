'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PendingCommand } from '@iw/contracts';
import { listCommands, syncPending } from '../../../../lib/mobile';
import { MobileHeader } from '../../../../components/mobile/MobileHeader';
import { StatusBadge, statusFromCommand } from '../../../../components/mobile/StatusBadge';

const TYPE_LABEL: Record<string, string> = {
  RECEIVE: 'Receive', RELEASE_PICK: 'Pick', TRANSFER_DISPATCH: 'Transfer dispatch',
  TRANSFER_RECEIVE: 'Transfer receive', COUNT_SUBMIT: 'Count', RETURN_RECEIVE: 'Return',
};

/** Pending Sync — the local command queue with manual "Sync now" (2D.6B). One owner drains under Web Locks. */
export default function PendingPage() {
  const [commands, setCommands] = useState<PendingCommand[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setCommands(await listCommands().catch(() => []));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const r = await syncPending();
      if (!r.owner) setMsg('Another tab is already syncing on this device.');
      else setMsg(`Synced ${r.synced}, needs attention ${r.failed}, uncertain ${r.unknown}, remaining ${r.remaining}.`);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const pending = commands.filter((c) => c.state !== 'SYNCED' && c.state !== 'CANCELLED');
  const done = commands.filter((c) => c.state === 'SYNCED');

  return (
    <div>
      <MobileHeader title="Pending Sync" back />
      <button className="m-btn" onClick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
      {msg && <p className="m-sub" style={{ marginTop: 8 }}>{msg}</p>}

      <p className="m-title" style={{ marginTop: 12, fontSize: 15 }}>Awaiting sync ({pending.length})</p>
      {pending.length === 0 && <p className="m-sub">Nothing waiting. All captured work has reached the server.</p>}
      {pending.map((c) => (
        <div className="m-card" key={c.commandId}>
          <div className="m-row" style={{ paddingTop: 0 }}>
            <span className="k">{TYPE_LABEL[c.commandType] ?? c.commandType}</span>
            <span className="v"><StatusBadge status={statusFromCommand(c.state, c.mayHaveReachedServer)} /></span>
          </div>
          <div className="m-sub" style={{ margin: 0 }}>
            {new Date(c.capturedAt).toLocaleString()}{c.attempts ? ` · ${c.attempts} attempt(s)` : ''}
            {c.mayHaveReachedServer ? ' · sent, response lost — will retry with the same key' : ''}
            {c.lastError ? ` · ${c.lastError}` : ''}
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <p className="m-title" style={{ marginTop: 16, fontSize: 15 }}>Synced ({done.length})</p>
          {done.slice(0, 20).map((c) => (
            <div className="m-row" key={c.commandId}>
              <span className="k">{TYPE_LABEL[c.commandType] ?? c.commandType}</span>
              <span className="v"><StatusBadge status="synced" /></span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
