/**
 * Frontend API client. All backend calls go through this.
 * Vite proxies /api to http://localhost:4050, so use paths like /api/...
 * Sends JWT in Authorization header when present.
 */
const API_BASE = '/api/';
const TOKEN_KEY = 'p2p_token';
const LOGIN_TIME_KEY = 'p2p_login_time';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export interface ApiError extends Error {
  code?: string;
}

async function handleErrorResponse(res: Response, text: string): Promise<never> {
  if (res.status === 401) {
    try {
      const j = JSON.parse(text);
      if (j.code === 'SESSION_EXPIRED') {
        clearToken();
        sessionStorage.removeItem(LOGIN_TIME_KEY);
        window.location.href = '/login?expired=true';
      }
    } catch {
      // not JSON, fall through to throw
    }
    throw new Error(text || 'Unauthorized');
  }
  if (res.status === 503) {
    try {
      const j = JSON.parse(text);
      const err = new Error(j.error || j.message || text) as ApiError;
      err.code = j.code;
      throw err;
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error(text || 'Service Unavailable');
    }
  }
  throw new Error(text || res.statusText);
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    await handleErrorResponse(res, text);
  }
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    await handleErrorResponse(res, text);
  }
  return res.json();
}

/** Multipart POST (e.g. file upload). Do not set Content-Type — browser sets boundary. */
export async function apiPostFormData<T = unknown>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const text = await res.text().catch(() => res.statusText);
  if (res.status === 401) {
    await handleErrorResponse(res, text);
  }
  if (!res.ok) {
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      if (j.message) message = j.message;
      else if (j.error) message = j.error;
    } catch {
      /* use raw text */
    }
    throw new Error(message);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export async function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    await handleErrorResponse(res, text);
  }
  return res.json();
}

export async function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    await handleErrorResponse(res, text);
  }
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: getAuthHeaders() });
  const text = await res.text().catch(() => res.statusText);
  if (!res.ok) {
    await handleErrorResponse(res, text);
  }
}

export async function apiDownloadFile(path: string, fallbackFileName: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    await handleErrorResponse(res, text);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename=\"?([^"]+)\"?/i);
  const fileName = match?.[1] || fallbackFileName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
