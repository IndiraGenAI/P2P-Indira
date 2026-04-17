import React, { useCallback, useMemo, useRef, useState } from 'react';
import { XCircle, UploadCloud, Download } from 'lucide-react';
import {
  BudgetType,
  BudgetControlType,
  type Budget,
  type MasterRecord,
  type MasterType,
} from '../../types';
import { parseBudgetUploadFile, downloadBudgetUploadTemplate } from '../../utils/budgetExcelParse';
import {
  coaCodesFromMasters,
  validateBudgetUploadRow,
} from '../../utils/budgetDistribution';
import { BudgetPreviewTable, type PreviewRow } from './BudgetPreviewTable';
import { useUploadBudget } from '../../hooks/useUploadBudget';
import { apiGet } from '../../api';

function indianFyStartYear(d = new Date()): number {
  const m = d.getMonth();
  return m >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function formatFy(startYear: number): string {
  const end = startYear + 1;
  return `${startYear}-${String(end).slice(-2)}`;
}

function fySelectOptions(): string[] {
  const c = indianFyStartYear();
  return [formatFy(c - 1), formatFy(c), formatFy(c + 1)];
}

function fyLabel(iso: string): string {
  return `FY ${iso}`;
}

interface UploadBudgetModalProps {
  open: boolean;
  onClose: () => void;
  masters: Record<MasterType, MasterRecord[]>;
  budgets: Budget[];
  setBudgets: React.Dispatch<React.SetStateAction<Budget[]>>;
}

export const UploadBudgetModal: React.FC<UploadBudgetModalProps> = ({
  open,
  onClose,
  masters,
  budgets,
  setBudgets,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const { uploadBudget, uploading } = useUploadBudget();

  const [financialYear, setFinancialYear] = useState(() => formatFy(indianFyStartYear()));
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState('');
  const [zoneError, setZoneError] = useState('');
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);

  const [defaultEntityName, setDefaultEntityName] = useState('');
  const [defaultLocationName, setDefaultLocationName] = useState('');
  const [defaultCostCenterName, setDefaultCostCenterName] = useState('');
  const [defaultBudgetType, setDefaultBudgetType] = useState<BudgetType>(BudgetType.OPEX);
  const [defaultControlType, setDefaultControlType] = useState<BudgetControlType>(
    BudgetControlType.HARD_STOP
  );
  const [fyError, setFyError] = useState('');

  const coaCodes = useMemo(() => coaCodesFromMasters(masters.COA || []), [masters.COA]);

  const glCountInFile = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of previewRows) {
      const k = r.data.glCode.trim();
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [previewRows]);

  const previewWithErrors = useMemo((): PreviewRow[] => {
    return previewRows.map((pr) => {
      const code = pr.data.glCode.trim();
      const dupFile = (glCountInFile.get(code) || 0) > 1;
      const dupDb = budgets.filter(
        (b) => b.financialYear === financialYear && String(b.coaCode).trim() === code
      ).length;
      const errors = validateBudgetUploadRow(pr.data, coaCodes, dupDb, dupFile);
      return { data: pr.data, errors };
    });
  }, [previewRows, coaCodes, budgets, financialYear, glCountInFile]);

  const errorCount = useMemo(() => previewWithErrors.filter((r) => r.errors.length > 0).length, [previewWithErrors]);
  const readyCount = previewWithErrors.length - errorCount;

  const needsDefaults = useMemo(() => {
    if (previewRows.length === 0) return false;
    return previewRows.some((pr) => {
      const code = pr.data.glCode.trim();
      return budgets.filter((b) => b.financialYear === financialYear && String(b.coaCode).trim() === code)
        .length === 0;
    });
  }, [previewRows, budgets, financialYear]);

  const defaultsOk =
    !needsDefaults ||
    (Boolean(defaultEntityName) && Boolean(defaultLocationName) && Boolean(defaultCostCenterName));

  const resetState = useCallback(() => {
    setFile(null);
    setParseError('');
    setZoneError('');
    setPreviewRows([]);
    setFyError('');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleClose = () => {
    resetState();
    setFinancialYear(formatFy(indianFyStartYear()));
    setDefaultEntityName('');
    setDefaultLocationName('');
    setDefaultCostCenterName('');
    setDefaultBudgetType(BudgetType.OPEX);
    setDefaultControlType(BudgetControlType.HARD_STOP);
    onClose();
  };

  const processFile = async (f: File | null) => {
    setParseError('');
    setZoneError('');
    setPreviewRows([]);
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.xlsx')) {
      setZoneError('Only .xlsx files are accepted');
      setFile(null);
      return;
    }
    setFile(f);
    const res = await parseBudgetUploadFile(f);
    if (!res.ok) {
      setParseError('error' in res ? res.error : 'Invalid file');
      setFile(null);
      return;
    }
    setPreviewRows(res.rows.map((data) => ({ data, errors: [] })));
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    void processFile(f ?? null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    void processFile(f ?? null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeFile = () => {
    setFile(null);
    setPreviewRows([]);
    setParseError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = async () => {
    setFyError('');
    if (!financialYear.trim()) {
      setFyError('Financial year is required');
      return;
    }
    if (!file || previewWithErrors.length === 0) return;
    if (errorCount > 0) return;
    if (!defaultsOk) return;

    const fd = new FormData();
    fd.append('file', file);
    fd.append('financialYear', financialYear.trim());
    if (needsDefaults) {
      fd.append('defaultEntityName', defaultEntityName);
      fd.append('defaultLocationName', defaultLocationName);
      fd.append('defaultCostCenterName', defaultCostCenterName);
      fd.append('defaultBudgetType', defaultBudgetType);
      fd.append('defaultControlType', defaultControlType);
    }

    try {
      const result = await uploadBudget(fd);
      if (result.success) {
        const rows = await apiGet<Budget[]>('budgets');
        setBudgets(
          Array.isArray(rows)
            ? rows.map((b) => ({
                ...b,
                amount: Number(b.amount) || 0,
                consumedAmount: Math.max(0, Number(b.consumedAmount) || 0),
              }))
            : []
        );
        alert(
          `Budget uploaded successfully. ${result.created} record(s) created, ${result.updated} record(s) updated.`
        );
        handleClose();
      }
    } catch (e) {
      alert((e as Error).message || 'Upload failed');
    }
  };

  if (!open) return null;

  const fyOptions = fySelectOptions();
  const uploadDisabled =
    uploading ||
    !file ||
    previewWithErrors.length === 0 ||
    errorCount > 0 ||
    !defaultsOk;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold text-slate-900">Upload Budget</h2>
          <button type="button" onClick={handleClose} className="text-slate-400 hover:text-slate-600">
            <XCircle size={24} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Financial Year *</label>
            <select
              className="w-full max-w-xs p-2 border border-slate-200 rounded-lg"
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
            >
              {fyOptions.map((iso) => (
                <option key={iso} value={iso}>
                  {fyLabel(iso)}
                </option>
              ))}
            </select>
            {fyError ? <p className="mt-1 text-sm text-red-600">{fyError}</p> : null}
          </div>

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
            }}
            onClick={() => fileRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors"
          >
            <UploadCloud className="mx-auto mb-2 text-slate-400" size={36} />
            <p className="text-sm font-medium text-slate-700">Drag & drop your Excel file here</p>
            <p className="text-xs text-slate-500 mt-1">or click to browse</p>
            <p className="text-xs text-slate-400 mt-2">Accepted: .xlsx only</p>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onInputChange} />
          </div>

          {zoneError ? <p className="text-sm font-medium text-red-600">{zoneError}</p> : null}
          {parseError ? <p className="text-sm font-medium text-red-600">{parseError}</p> : null}

          {file ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-sm text-slate-700 truncate pr-2">
                {file.name}{' '}
                <span className="text-slate-400">({(file.size / 1024).toFixed(1)} KB)</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile();
                }}
                className="shrink-0 text-slate-400 hover:text-red-600 p-1"
                aria-label="Remove file"
              >
                <XCircle size={20} />
              </button>
            </div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => downloadBudgetUploadTemplate()}
              className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800"
            >
              <Download size={16} />
              Download Template
            </button>
          </div>

          {needsDefaults && previewRows.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
              <p className="text-sm font-semibold text-amber-900">
                New budget rows need defaults (Entity, Location, Cost Center)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Entity</label>
                  <select
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    value={defaultEntityName}
                    onChange={(e) => setDefaultEntityName(e.target.value)}
                  >
                    <option value="">Select Entity</option>
                    {(masters.Entity || []).map((ent) => (
                      <option key={ent.id} value={ent.name}>
                        {ent.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
                  <select
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    value={defaultLocationName}
                    onChange={(e) => setDefaultLocationName(e.target.value)}
                  >
                    <option value="">Select Location</option>
                    {(masters.Center || []).map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cost Center</label>
                  <select
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    value={defaultCostCenterName}
                    onChange={(e) => setDefaultCostCenterName(e.target.value)}
                  >
                    <option value="">Select Cost Center</option>
                    {(masters['Cost Center'] || []).map((cc) => (
                      <option key={cc.id} value={cc.name}>
                        {cc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Budget Type</label>
                  <select
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    value={defaultBudgetType}
                    onChange={(e) => setDefaultBudgetType(e.target.value as BudgetType)}
                  >
                    <option value={BudgetType.OPEX}>OPEX</option>
                    <option value={BudgetType.CAPEX}>CAPEX</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Control Type</label>
                  <select
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    value={defaultControlType}
                    onChange={(e) => setDefaultControlType(e.target.value as BudgetControlType)}
                  >
                    <option value={BudgetControlType.HARD_STOP}>Hard Stop</option>
                    <option value={BudgetControlType.SOFT_WARNING}>Soft Warning</option>
                  </select>
                </div>
              </div>
            </div>
          ) : null}

          {previewWithErrors.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700 border-t border-slate-200 pt-4">Preview</p>
              <BudgetPreviewTable rows={previewWithErrors} />
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="font-medium text-emerald-700">✅ {readyCount} records ready</span>
                <span className={`font-medium ${errorCount > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                  ⚠️ {errorCount} errors
                </span>
              </div>
              {errorCount > 0 ? (
                <p className="text-sm text-amber-800">Fix errors in the file and re-upload</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button type="button" onClick={handleClose} className="px-4 py-2 text-slate-600 font-medium">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={uploadDisabled}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 inline-flex items-center gap-2"
          >
            {uploading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Uploading…
              </>
            ) : (
              'Upload & Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
