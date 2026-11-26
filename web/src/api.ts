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

export interface DeviceInfo {
  id: number;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  freeBytes: number | null;
  batteryPercent: number | null;
  appVersion: string | null;
  androidVersion: string | null;
  createdAt: string;
  openTransfers: number;
}

export type TransferStatus =
  | 'pending' | 'downloading' | 'verified' | 'done' | 'awaiting_confirmation' | 'installed' | 'failed' | 'cancelled';

export interface TransferInfo {
  id: number;
  batchId: string | null;
  kind: string;
  fileId: string | null;
  fileName: string | null;
  fileSize: number | null;
  deviceId: number;
  deviceName: string | null;
  createdBy: string | null;
  status: TransferStatus;
  queued: boolean;
  bytesDone: number;
  errorCode: string | null;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface SendResult {
  batchId: string;
  created: number;
  skipped: Array<{ deviceId: number; reason: 'unknown_device' | 'already_queued' | 'no_space' }>;
}

export const getDevices = () => api<{ devices: DeviceInfo[] }>('GET', '/api/devices');
export const confirmDevice = (code: string, name?: string) =>
  api<{ device: { id: number; name: string } }>('POST', '/api/devices/confirm', name ? { code, name } : { code });
export const renameDevice = (id: number, name: string) => api<{ ok: true }>('PATCH', `/api/devices/${id}`, { name });
export const revokeDevice = (id: number) => api<{ ok: true; cancelled: number }>('DELETE', `/api/devices/${id}`);
export const sendFile = (fileId: string, deviceIds: number[]) =>
  api<SendResult>('POST', '/api/transfers', { fileId, deviceIds });
export const getTransfers = (all: boolean) =>
  api<{ transfers: TransferInfo[] }>('GET', `/api/transfers?status=${all ? 'all' : 'open'}&limit=500`);
export const cancelTransfer = (id: number) => api<{ cancelled: number }>('POST', `/api/transfers/${id}/cancel`);
export const retryTransfer = (id: number) => api<{ ok: true }>('POST', `/api/transfers/${id}/retry`);
export const cancelBatch = (id: string) => api<{ cancelled: number }>('POST', `/api/batches/${id}/cancel`);
