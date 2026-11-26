export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new ApiError(res.status, String(data['error'] ?? 'error'), data);
  return data as T;
}

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
  status: 'pending' | 'approved' | 'blocked';
}

export interface FileInfo {
  id: string;
  name: string;
  typ: 'video' | 'image' | 'apk' | 'other';
  groesse: number;
  sha256: string | null;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  duplicateOf: string | null;
  meta: { codec?: string; width?: number; height?: number; fps?: number; durationSec?: number };
  warnungen: string[];
  uploadedBy: { id: number; name: string | null } | null;
  createdAt: string;
  canDelete: boolean;
}

export interface StorageInfo {
  freeBytes: number;
  minFreeBytes: number;
  maxUploadBytes: number;
  totalBytes: number;
  usedBytes: number;
  quotaBytes: number | null;
}

export interface AdminUser {
  id: number;
  ldapUid: string;
  displayName: string | null;
  role: 'user' | 'admin';
  status: 'pending' | 'approved' | 'blocked';
  quotaBytes: number | null;
  usedBytes: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export const getMe = () => api<{ user: User }>('GET', '/api/me');
export const login = (username: string, password: string) =>
  api<{ user: User }>('POST', '/api/login', { username, password });
export const logout = () => api<{ ok: true }>('POST', '/api/logout');
export const getFiles = () => api<{ files: FileInfo[] }>('GET', '/api/files');
export const deleteFile = (id: string) => api<{ ok: true }>('DELETE', `/api/files/${id}`);
export const getStorage = () => api<StorageInfo>('GET', '/api/storage');
export const getUsers = () => api<{ users: AdminUser[] }>('GET', '/api/admin/users');
export const patchUser = (id: number, body: { status?: AdminUser['status']; quotaBytes?: number | null }) =>
  api<{ user: AdminUser }>('PATCH', `/api/admin/users/${id}`, body);
export const preApprove = (username: string, displayName?: string) =>
  api<{ user: AdminUser }>('POST', '/api/admin/users', displayName ? { username, displayName } : { username });
export const ldapSearch = (q: string) =>
  api<{ results: Array<{ username: string; displayName: string | null }> }>(
    'GET',
    `/api/admin/ldap-search?q=${encodeURIComponent(q)}`,
  );
