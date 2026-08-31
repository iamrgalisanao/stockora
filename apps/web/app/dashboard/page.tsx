'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthenticatedUser, OrganizationResponse } from '@iw/contracts';
import { api, clearToken, getToken } from '../../lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [org, setOrg] = useState<OrganizationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    Promise.all([api.me(), api.currentOrganization()])
      .then(([me, organization]) => {
        setUser(me);
        setOrg(organization);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
  }, [router]);

  function logout() {
    clearToken();
    router.replace('/login');
  }

  if (error) {
    return (
      <div className="container">
        <div className="card">
          <div className="error">{error}</div>
          <button className="secondary" onClick={logout}>Back to sign in</button>
        </div>
      </div>
    );
  }

  if (!user || !org) {
    return (
      <div className="container">
        <div className="card muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 20 }}>
        <div className="brand" style={{ fontSize: 18 }}>Inventory Control Engine</div>
        <button className="secondary" style={{ width: 'auto', marginTop: 0 }} onClick={logout}>
          Sign out
        </button>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="muted" style={{ marginBottom: 8 }}>Signed in as</div>
          <div className="kv"><div className="k">Name</div><div className="v">{user.name}</div></div>
          <div className="kv"><div className="k">Email</div><div className="v">{user.email}</div></div>
          <div className="kv"><div className="k">Role</div><div className="v">{user.roleName}</div></div>
          <div className="kv">
            <div className="k">Warehouse scope</div>
            <div className="v">{user.warehouseScope === null ? 'All warehouses' : `${user.warehouseScope.length} assigned`}</div>
          </div>
        </div>

        <div className="card">
          <div className="muted" style={{ marginBottom: 8 }}>Organization</div>
          <div className="kv"><div className="k">Name</div><div className="v">{org.name}</div></div>
          <div className="kv"><div className="k">Slug</div><div className="v">{org.slug}</div></div>
          <div className="kv"><div className="k">Currency</div><div className="v">{org.currency}</div></div>
          <div className="kv"><div className="k">Status</div><div className="v">{org.status}</div></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="muted" style={{ marginBottom: 8 }}>
          Effective permissions ({user.permissions.length})
        </div>
        <div>
          {user.permissions.map((p) => (
            <span className="pill" key={p}>{p}</span>
          ))}
        </div>
      </div>

      <div className="muted" style={{ marginTop: 20, fontSize: 12 }}>
        Phase 01 foundation. Next: product master, warehouses, and the inventory ledger.
      </div>
    </div>
  );
}
