import React, { useEffect, useRef, useState } from 'react';
import { X, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { renderAsync } from 'docx-preview';
import type { Attachment } from '../../types';
import {
  fetchAttachmentBlob,
  isServerStoredAttachment,
  recordAttachmentView as postAttachmentViewRecord,
} from '../../utils/serverAttachment';

const IMAGE_EXT = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.svg',
  '.ico',
  '.heic',
  '.avif',
] as const;

const SHEET_EXT = ['.xlsx', '.xls', '.xlsm', '.csv', '.ods'] as const;
const TEXT_EXT = ['.txt', '.log', '.md', '.json', '.xml', '.yml', '.yaml', '.tsv', '.env', '.ini'] as const;

const MAX_SHEET_ROWS = 800;
const MAX_SHEET_COLS = 40;
const MAX_ZIP_LIST = 2500;

type PreviewKind =
  | 'pdf'
  | 'image'
  | 'sheet'
  | 'docx'
  | 'zip'
  | 'text'
  | 'unsupported'
  | null;

function endsWithAny(name: string, exts: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

function classifyPreview(name: string): {
  kind: PreviewKind;
  unsupportedDetail?: string;
  unsupportedTitle?: string;
} {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return { kind: 'pdf' };
  if (endsWithAny(name, IMAGE_EXT)) return { kind: 'image' };
  if (endsWithAny(name, SHEET_EXT)) return { kind: 'sheet' };
  if (lower.endsWith('.docx')) return { kind: 'docx' };
  if (lower.endsWith('.doc')) {
    return {
      kind: 'unsupported',
      unsupportedTitle: 'Classic Word file (.doc)',
      unsupportedDetail:
        'This format is not shown in the viewer. Download to open it in Word or another compatible app on your computer.',
    };
  }
  if (lower.endsWith('.ppt') || lower.endsWith('.pptx') || lower.endsWith('.ppsx')) {
    return {
      kind: 'unsupported',
      unsupportedTitle: 'Presentation file',
      unsupportedDetail:
        'Slide decks are not rendered in the browser here. Download opens the file in PowerPoint (or your usual app) with full layout, notes, and animations.',
    };
  }
  if (lower.endsWith('.zip')) return { kind: 'zip' };
  if (endsWithAny(name, TEXT_EXT)) return { kind: 'text' };
  return {
    kind: 'unsupported',
    unsupportedTitle: 'No in-browser preview',
    unsupportedDetail:
      'This file type is not previewed here. Download lets you open it with the right application on your device.',
  };
}

interface SheetPreviewState {
  sheetNames: string[];
  rows: string[][];
  activeSheetIndex: number;
}

interface DocumentViewerModalProps {
  open: boolean;
  attachment: Attachment | null;
  onClose: () => void;
  /** Called after a server attachment view is recorded (refresh eye counts). */
  onViewRecorded?: () => void;
  /**
   * When false, opening the modal does not POST a view (e.g. document creator reviewing their own upload).
   * Default true.
   */
  recordAttachmentView?: boolean;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  open,
  attachment,
  onClose,
  onViewRecorded,
  recordAttachmentView = true,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [previewKind, setPreviewKind] = useState<PreviewKind>(null);
  const [unsupportedDetail, setUnsupportedDetail] = useState('');
  const [unsupportedTitle, setUnsupportedTitle] = useState('');
  const [sheetData, setSheetData] = useState<SheetPreviewState | null>(null);
  const [zipEntries, setZipEntries] = useState<{ path: string; dir: boolean }[]>([]);
  const [textContent, setTextContent] = useState('');
  const [docxBuffer, setDocxBuffer] = useState<ArrayBuffer | null>(null);

  const docxContainerRef = useRef<HTMLDivElement>(null);
  const onViewRecordedRef = useRef(onViewRecorded);
  onViewRecordedRef.current = onViewRecorded;

  useEffect(() => {
    if (!open || !attachment) {
      setBlobUrl(null);
      setError('');
      setLoading(false);
      setPreviewKind(null);
      setUnsupportedDetail('');
      setUnsupportedTitle('');
      setSheetData(null);
      setZipEntries([]);
      setTextContent('');
      setDocxBuffer(null);
      return;
    }

    let revoked = false;
    let objectUrl: string | null = null;

    const run = async () => {
      setError('');
      setLoading(true);
      setBlobUrl(null);
      setPreviewKind(null);
      setUnsupportedDetail('');
      setUnsupportedTitle('');
      setSheetData(null);
      setZipEntries([]);
      setTextContent('');
      setDocxBuffer(null);

      const { kind, unsupportedDetail: unsup, unsupportedTitle: unsupTitle } = classifyPreview(attachment.name);

      const url = attachment.url || '';
      if (url.startsWith('blob:')) {
        if (kind === 'pdf' || kind === 'image') {
          setBlobUrl(url);
          setPreviewKind(kind);
        } else if (kind === 'unsupported') {
          setPreviewKind('unsupported');
          setUnsupportedDetail(unsup || '');
          setUnsupportedTitle(unsupTitle || '');
        } else {
          try {
            const res = await fetch(url);
            const blob = await res.blob();
            const buf = await blob.arrayBuffer();
            await processBuffer(buf, kind, attachment.name, unsup, unsupTitle);
          } catch (e) {
            if (!revoked) setError((e as Error).message || 'Failed to load file');
          }
        }
        if (!revoked) setLoading(false);
        return;
      }

      if (isServerStoredAttachment(attachment)) {
        try {
          if (recordAttachmentView) {
            await postAttachmentViewRecord(attachment.id);
            onViewRecordedRef.current?.();
          }
          const blob = await fetchAttachmentBlob(attachment.id);
          const buf = await blob.arrayBuffer();

          if (kind === 'pdf' || kind === 'image') {
            objectUrl = URL.createObjectURL(new Blob([buf], { type: blob.type || 'application/octet-stream' }));
            if (!revoked) {
              setBlobUrl(objectUrl);
              setPreviewKind(kind);
            }
          } else {
            await processBuffer(buf, kind, attachment.name, unsup, unsupTitle);
          }
        } catch (e) {
          if (!revoked) setError((e as Error).message || 'Failed to load file');
        } finally {
          if (!revoked) setLoading(false);
        }
        return;
      }

      setError('This attachment cannot be previewed (legacy upload).');
      setLoading(false);
    };

    async function processBuffer(
      buf: ArrayBuffer,
      kind: PreviewKind,
      fileName: string,
      unsup?: string,
      unsupTitle?: string
    ) {
      if (revoked) return;

      if (kind === 'sheet') {
        try {
          const wb = XLSX.read(buf, { type: 'array', cellDates: true });
          const sheetNames = wb.SheetNames || [];
          if (sheetNames.length === 0) {
            setError('Spreadsheet has no sheets.');
            return;
          }
          const activeSheetIndex = 0;
          const ws = wb.Sheets[sheetNames[activeSheetIndex]];
          const rows = worksheetToMatrix(ws);
          setSheetData({ sheetNames, rows, activeSheetIndex });
          setPreviewKind('sheet');
        } catch (e) {
          setError((e as Error).message || 'Could not read spreadsheet');
        }
        return;
      }

      if (kind === 'docx') {
        setDocxBuffer(buf.slice(0));
        setPreviewKind('docx');
        return;
      }

      if (kind === 'zip') {
        try {
          const zip = await JSZip.loadAsync(buf);
          const list: { path: string; dir: boolean }[] = [];
          zip.forEach((relativePath, file) => {
            list.push({ path: relativePath, dir: file.dir });
          });
          list.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
          setZipEntries(list.slice(0, MAX_ZIP_LIST));
          setPreviewKind('zip');
        } catch (e) {
          setError((e as Error).message || 'Could not read ZIP archive');
        }
        return;
      }

      if (kind === 'text') {
        try {
          const dec = new TextDecoder('utf-8', { fatal: false });
          setTextContent(dec.decode(buf));
          setPreviewKind('text');
        } catch (e) {
          setError((e as Error).message || 'Could not read text file');
        }
        return;
      }

      if (kind === 'unsupported') {
        setPreviewKind('unsupported');
        setUnsupportedDetail(unsup || '');
        setUnsupportedTitle(unsupTitle || '');
        return;
      }

      setPreviewKind('unsupported');
      setUnsupportedTitle(unsupTitle || 'No in-browser preview');
      setUnsupportedDetail('Preview is not available for this file type. Use Download.');
    }

    void run();

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, attachment, recordAttachmentView]);

  useEffect(() => {
    if (!open || previewKind !== 'docx' || !docxBuffer) return;
    const el = docxContainerRef.current;
    if (!el) return;
    el.innerHTML = '';
    let cancelled = false;
    void renderAsync(new Blob([docxBuffer]), el, undefined, {
      className: 'docx-preview-wrap',
      breakPages: true,
      inWrapper: true,
    }).catch((e) => {
      if (!cancelled) setError((e as Error).message || 'Could not render Word document');
    });
    return () => {
      cancelled = true;
      el.innerHTML = '';
    };
  }, [open, previewKind, docxBuffer, attachment?.id]);

  if (!open || !attachment) return null;

  const handleDownload = async () => {
    try {
      if (isServerStoredAttachment(attachment)) {
        const blob = await fetchAttachmentBlob(attachment.id, true);
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = attachment.name || 'download';
        a.click();
        URL.revokeObjectURL(u);
        return;
      }
      if (attachment.url.startsWith('blob:')) {
        const a = document.createElement('a');
        a.href = attachment.url;
        a.download = attachment.name || 'download';
        a.click();
      }
    } catch (e) {
      alert((e as Error).message || 'Download failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 pr-2">
            <h2 className="text-lg font-bold text-slate-900">Document Viewer</h2>
            <p className="truncate text-xs text-slate-500">{attachment.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={22} />
          </button>
        </div>

        <div className="min-h-[240px] flex-1 overflow-auto bg-slate-50 p-4">
          {loading && (
            <div className="flex h-64 items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          )}
          {!loading && error && <p className="text-center text-sm font-medium text-red-600">{error}</p>}

          {!loading && !error && previewKind === 'pdf' && blobUrl && (
            <iframe title={attachment.name} src={blobUrl} className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white" />
          )}

          {!loading && !error && previewKind === 'image' && blobUrl && (
            <img
              src={blobUrl}
              alt={attachment.name}
              className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg border border-slate-200"
            />
          )}

          {!loading && !error && previewKind === 'sheet' && sheetData && (
            <div className="space-y-3">
              {sheetData.sheetNames.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {sheetData.sheetNames.map((name, i) => (
                    <button
                      key={`${i}-${name}`}
                      type="button"
                      onClick={() => void switchSheetIndex(attachment, i, setSheetData)}
                      className={`rounded-lg px-3 py-1 text-xs font-bold ${
                        i === sheetData.activeSheetIndex
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] font-medium text-slate-500">
                Showing up to {MAX_SHEET_ROWS} rows × {MAX_SHEET_COLS} columns. Large files may be truncated.
              </p>
              <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full border-collapse text-left text-xs">
                  <tbody>
                    {sheetData.rows.map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? 'bg-slate-100 font-semibold' : 'even:bg-slate-50/60'}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="max-w-[220px] truncate border border-slate-200 px-2 py-1 align-top">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && !error && previewKind === 'docx' && (
            <div
              ref={docxContainerRef}
              className="docx-viewer-root max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm"
            />
          )}

          {!loading && !error && previewKind === 'zip' && (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-3 text-xs font-medium text-slate-500">
                Archive contents ({zipEntries.length} entr{zipEntries.length === 1 ? 'y' : 'ies'}
                {zipEntries.length >= MAX_ZIP_LIST ? `, first ${MAX_ZIP_LIST} listed` : ''}).
              </p>
              <ul className="space-y-1 font-mono text-xs text-slate-700">
                {zipEntries.map((e) => (
                  <li key={e.path} className="truncate border-b border-slate-100 py-0.5">
                    {e.dir ? '📁 ' : '📄 '}
                    {e.path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && !error && previewKind === 'text' && (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-4 font-mono text-xs text-slate-800 shadow-sm">
              {textContent}
            </pre>
          )}

          {!loading && !error && previewKind === 'unsupported' && (
            <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-6 py-10 text-center shadow-sm">
              <div className="rounded-full bg-white p-3 text-slate-400 shadow-sm ring-1 ring-slate-100">
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-800">{unsupportedTitle || 'Open on your device'}</p>
              <p className="text-xs leading-relaxed text-slate-600">{unsupportedDetail}</p>
              <p className="text-[11px] text-slate-500">Download below opens the file locally in the app you normally use.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={() => void handleDownload()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <Download size={18} />
            Download
          </button>
        </div>
      </div>
    </div>
  );
};

function worksheetToMatrix(ws: XLSX.WorkSheet): string[][] {
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  const lastRow = Math.min(range.e.r, range.s.r + MAX_SHEET_ROWS - 1);
  const lastCol = Math.min(range.e.c, range.s.c + MAX_SHEET_COLS - 1);
  for (let R = range.s.r; R <= lastRow; R++) {
    const row: string[] = [];
    for (let C = range.s.c; C <= lastCol; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      let v = '';
      if (cell) {
        if (cell.w != null && cell.w !== '') v = String(cell.w);
        else if (cell.v != null && typeof cell.v === 'object' && 'getTime' in (cell.v as object)) {
          v = String((cell.v as Date).toISOString?.() ?? cell.v);
        } else if (cell.v != null) v = String(cell.v);
      }
      row.push(v);
    }
    rows.push(row);
  }
  return rows;
}

async function switchSheetIndex(
  attachment: Attachment,
  index: number,
  setSheetData: React.Dispatch<React.SetStateAction<SheetPreviewState | null>>
) {
  try {
    let buf: ArrayBuffer;
    if (isServerStoredAttachment(attachment)) {
      const b = await fetchAttachmentBlob(attachment.id);
      buf = await b.arrayBuffer();
    } else {
      const res = await fetch(attachment.url);
      buf = await (await res.blob()).arrayBuffer();
    }
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const name = wb.SheetNames[index];
    if (!name) return;
    const ws = wb.Sheets[name];
    const rows = worksheetToMatrix(ws);
    setSheetData({ sheetNames: wb.SheetNames, rows, activeSheetIndex: index });
  } catch {
    /* ignore */
  }
}
