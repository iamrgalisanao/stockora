'use client';

import { useEffect, useState } from 'react';
import type { PickableLot } from '@iw/contracts';
import { api } from '../lib/api';

/**
 * Shared operational lot picker (2C.1C, ADR 0007). One contract across releases, transfers, adjustments,
 * counts, and return intake: for a batch-tracked product it lets the operator SELECT a recognized ACTIVE
 * lot with stock at the warehouse — never type a free-text lot number downstream. Availability figures
 * come from the inventory read model (the pickable feed), not the lot identity service.
 */
export function LotPicker({
  productId, warehouseId, variantId, value, onChange, disabled,
}: {
  productId: string;
  warehouseId: string;
  variantId?: string;
  value: string;
  onChange: (lotId: string) => void;
  disabled?: boolean;
}) {
  const [lots, setLots] = useState<PickableLot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId || !warehouseId) { setLots([]); return; }
    setLoading(true);
    api.lots.pickable(productId, warehouseId, variantId)
      .then(setLots)
      .catch(() => setLots([]))
      .finally(() => setLoading(false));
  }, [productId, warehouseId, variantId]);

  const label = (l: PickableLot) =>
    `${l.lotNumber}${l.origin === 'LEGACY_MIGRATION' ? ' (migrated)' : ''} · avail ${l.available}` +
    (l.quarantined !== '0' ? ` · quar ${l.quarantined}` : '') +
    (l.expiryDate ? ` · exp ${new Date(l.expiryDate).toLocaleDateString()}` : '');

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || loading || !warehouseId}>
      <option value="">{loading ? 'Loading lots…' : lots.length === 0 ? 'No stocked lots' : 'Select lot…'}</option>
      {lots.map((l) => <option key={l.lotId} value={l.lotId}>{label(l)}</option>)}
    </select>
  );
}
