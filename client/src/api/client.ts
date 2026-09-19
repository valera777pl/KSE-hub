const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getInitData(): string {
  try {
    // @ts-ignore - Telegram WebApp SDK
    if (window.Telegram?.WebApp?.initData) {
      // @ts-ignore
      return window.Telegram.WebApp.initData;
    }
  } catch {
    // Not in Telegram context
  }
  return '';
}

function getDevHeaders(): Record<string, string> {
  // In development without Telegram, use a dev user
  if (import.meta.env.DEV && !getInitData()) {
    return { 'X-Dev-User-Id': '12345678' };
  }
  return {};
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const initData = getInitData();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(initData ? { Authorization: `tma ${initData}` } : {}),
    ...getDevHeaders(),
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Network error' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint),
  post: <T>(endpoint: string, body?: any) =>
    apiRequest<T>(endpoint, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(endpoint: string, body?: any) =>
    apiRequest<T>(endpoint, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(endpoint: string, body?: any) =>
    apiRequest<T>(endpoint, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(endpoint: string) =>
    apiRequest<T>(endpoint, { method: 'DELETE' }),
};
