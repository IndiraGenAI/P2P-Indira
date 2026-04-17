import { apiDelete, apiPost, apiPostFormData } from '../api';

const API_BASE = '/api/';
const TOKEN_KEY = 'p2p_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type ServerAttachmentMeta = {
  id: string;
  name: string;
  url: string;
  uploadedAt: string;
};

export async function uploadServerAttachment(
  documentTable: string,
  documentId: string,
  file: File
): Promise<ServerAttachmentMeta> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('documentTable', documentTable);
  fd.append('documentId', documentId);
  return apiPostFormData<ServerAttachmentMeta>('attachments/upload', fd);
}

export async function linkDocumentAttachments(
  documentTable: string,
  draftDocumentId: string,
  documentId: string
): Promise<void> {
  await apiPost('attachments/link-document', {
    documentTable,
    draftDocumentId,
    documentId,
  });
}

export async function recordAttachmentView(fileUploadId: string): Promise<void> {
  await apiPost(`attachments/${encodeURIComponent(fileUploadId)}/view`, {});
}

export async function deleteServerAttachment(fileUploadId: string): Promise<void> {
  await apiDelete(`attachments/${encodeURIComponent(fileUploadId)}`);
}

export interface AttachmentViewStatus {
  totalAttachments: number;
  viewedByMe: number;
  allViewed: boolean;
}

export async function fetchAttachmentViewStatus(
  documentTable: string,
  documentId: string
): Promise<AttachmentViewStatus> {
  const q = new URLSearchParams({ documentTable, documentId });
  return apiGetJson<AttachmentViewStatus>(`attachments/view-status?${q.toString()}`);
}

async function apiGetJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || res.statusText);
  }
  return JSON.parse(text) as T;
}

export async function fetchAttachmentBlob(fileUploadId: string, download?: boolean): Promise<Blob> {
  const q = download ? '?download=1' : '';
  const res = await fetch(
    `${API_BASE}attachment-files/${encodeURIComponent(fileUploadId)}${q}`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.blob();
}

export function isServerStoredAttachment(att: { id?: string; url?: string }): boolean {
  if (att.id && /^fup_[a-fA-F0-9]{32}$/.test(att.id)) return true;
  return typeof att.url === 'string' && att.url.includes('/api/attachment-files/');
}
