'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setTokens } from '../../lib/api';

type Mode = 'login' | 'register';

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

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <div className="card">
        <div className="brand" style={{ fontSize: 18 }}>Inventory Control Engine</div>
        <div className="muted" style={{ marginTop: 4 }}>
          {mode === 'login' ? 'Sign in to your organization' : 'Register a new organization'}
        </div>

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
    </div>
  );
}
