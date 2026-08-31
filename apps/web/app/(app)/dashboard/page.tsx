'use client';

import { useEffect, useState } from 'react';
import type { AuthenticatedUser, BalanceResponse } from '@iw/contracts';
import { api } from '../../../lib/api';

export default function DashboardPage() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [products, setProducts] = useState(0);
  const [warehouses, setWarehouses] = useState(0);
  const [balances, setBalances] = useState<BalanceResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.me(), api.products(), api.warehouses(), api.balances()])
      .then(([me, p, w, b]) => {
        setUser(me);
        setProducts(p.length);
        setWarehouses(w.length);
        setBalances(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  const totalValue = balances.reduce((sum, b) => sum + (b.value ? Number(b.value) : 0), 0);
  const totalOnHand = balances.reduce((sum, b) => sum + Number(b.onHand), 0);
  const outOfStock = balances.filter((b) => Number(b.available) <= 0).length;

  const currency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Dashboard</h1>
        {user && <span className="muted">{user.organizationName} · {user.roleName}</span>}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Products (SKUs)" value={String(products)} />
        <Kpi label="Warehouses" value={String(warehouses)} />
        <Kpi label="Total on hand" value={totalOnHand.toLocaleString()} />
        <Kpi label="Inventory value" value={user?.permissions.includes('valuation.view') ? currency(totalValue) : '—'} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <div className="muted">Stock signals</div>
        </div>
        <div className="kv"><div className="k">Balance records</div><div className="v">{balances.length}</div></div>
        <div className="kv"><div className="k">Out of stock</div><div className="v">{outOfStock}</div></div>
      </div>

      <div className="muted" style={{ marginTop: 20, fontSize: 12 }}>
        Receiving is live — post a goods receipt to bring stock in, then watch it appear in Stock Overview.
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  );
}
