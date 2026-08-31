import type {
  AuthenticatedUser,
  AuthTokenResponse,
  LoginRequest,
  OrganizationResponse,
  RegisterOrganizationRequest,
} from '@iw/contracts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';
const TOKEN_KEY = 'iw_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore storage errors */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  register: (body: RegisterOrganizationRequest) =>
    request<AuthTokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: LoginRequest) =>
    request<AuthTokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request<AuthenticatedUser>('/auth/me'),
  currentOrganization: () => request<OrganizationResponse>('/organizations/current'),
};
