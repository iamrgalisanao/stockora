'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SYSTEM_ROLES, SYSTEM_ROLE_DEFINITIONS } from '@iw/contracts';
import { api, setTokens } from '../../lib/api';

type Mode = 'login' | 'register';

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const DEMO_PASSWORD = 'password123';
/** One seeded login per system role — see apps/api/prisma/seed.ts ensureDemoRoleUsers(). */
const DEMO_LOGINS = SYSTEM_ROLE_DEFINITIONS.map((r) => ({
  name: r.name,
  description: r.description,
  email: r.key === SYSTEM_ROLES.ADMINISTRATOR ? 'admin@demo.test' : `${r.key}@demo.test`,
}));

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // login fields
  const [email, setEmail] = useState('admin@demo.test');
  const [password, setPassword] = useState('password123');
  // register-only fields
  const [orgName, setOrgName] = useState('');
  const [adminName, setAdminName] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({
              organizationName: orgName,
              adminEmail: email,
              adminName,
              adminPassword: password,
            });
      setTokens(res.accessToken, res.refreshToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function useLogin(loginEmail: string) {
    setMode('login');
    setEmail(loginEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="container" style={{ maxWidth: DEMO_MODE ? 860 : 420, paddingTop: 60 }}>
      <div className={DEMO_MODE ? 'login-demo-grid' : undefined}>
        <div className="card">
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <img src="/stockora-logo-light.png" alt="Stockora" style={{ height: 72, width: 'auto', display: 'inline-block' }} />
            <div className="brand" style={{ fontSize: 26, marginTop: 6 }}>
              <span style={{ color: 'var(--ice)' }}>Stock</span><span style={{ color: 'var(--accent)' }}>ora</span>
            </div>
            <div style={{ marginTop: 4, fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--faint)' }}>
              Warehouse Intelligence <span style={{ color: 'var(--muted)' }}>by Abbadev</span>
            </div>
            <div className="muted" style={{ marginTop: 12 }}>
              {mode === 'login' ? 'Sign in to your organization' : 'Register a new organization'}
            </div>
          </div>

          {DEMO_MODE && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--accent-tint)',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                fontSize: 12.5,
                color: 'var(--text)',
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: 'var(--ice)' }}>Public demo.</strong> Pick a role on the right, or
              sign in as <code>admin@demo.test</code>. Data resets nightly; account and security
              settings are disabled for everyone.
            </div>
          )}

          <form onSubmit={onSubmit}>
            {mode === 'register' && (
              <>
                <label>Organization name</label>
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                <label>Your name</label>
                <input value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
              </>
            )}

            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

            <button type="submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create organization'}
            </button>
          </form>

          {error && <div className="error">{error}</div>}

          <button
            type="button"
            className="secondary"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Register a new organization' : 'Back to sign in'}
          </button>
        </div>

        {DEMO_MODE && (
          <div className="card">
            <div style={{ fontWeight: 600, color: 'var(--ice)', marginBottom: 2 }}>Demo accounts</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
              Every role below shares the password <code>{DEMO_PASSWORD}</code>. Click one to fill the
              form, then Sign in.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DEMO_LOGINS.map((l) => (
                <button
                  key={l.email}
                  type="button"
                  onClick={() => useLogin(l.email)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    width: '100%',
                    margin: 0,
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: email === l.email ? 'var(--accent-tint)' : 'var(--wash)',
                    border: email === l.email ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)' : '1px solid var(--border)',
                    color: 'var(--text)',
                    fontWeight: 500,
                    fontSize: 13.5,
                    textAlign: 'left',
                    cursor: 'pointer',
                    boxShadow: 'none',
                  }}
                >
                  <span>
                    <span style={{ color: 'var(--ice)' }}>{l.name}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 1 }}>{l.description}</span>
                  </span>
                  <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{l.email}</code>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
