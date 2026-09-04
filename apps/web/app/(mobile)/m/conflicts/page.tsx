'use client';

import { MobileHeader } from '../../../../components/mobile/MobileHeader';

/**
 * Conflicts inbox — a placeholder until 2D.6C. Conflicts arise only when queued intent meets live server
 * state at sync time (ADR 0014 §6); 2D.6B captures and acknowledges commands but does not yet execute them,
 * so there is nothing to resolve here yet.
 */
export default function ConflictsPage() {
  return (
    <div>
      <MobileHeader title="Conflicts" back />
      <div className="m-banner info">
        No conflicts. Conflicts appear here in 2D.6C, when the sync engine applies queued commands against live
        inventory and a precondition no longer holds — never silently merged or reallocated.
      </div>
    </div>
  );
}
