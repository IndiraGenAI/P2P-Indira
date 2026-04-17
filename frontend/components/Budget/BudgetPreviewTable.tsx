import React from 'react';
import type { ParsedBudgetExcelRow } from '../../utils/budgetExcelParse';
import { EXCEL_MONTHS, formatIndianCurrency } from '../../utils/budgetDistribution';

const SHORT: Record<string, string> = {
  April: 'Apr',
  May: 'May',
  June: 'Jun',
  July: 'Jul',
  August: 'Aug',
  September: 'Sep',
  October: 'Oct',
  November: 'Nov',
  December: 'Dec',
  January: 'Jan',
  February: 'Feb',
  March: 'Mar',
};

export interface PreviewRow {
  data: ParsedBudgetExcelRow;
  errors: string[];
}

interface BudgetPreviewTableProps {
  rows: PreviewRow[];
}

export const BudgetPreviewTable: React.FC<BudgetPreviewTableProps> = ({ rows }) => (
  <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
    <table className="w-full min-w-[720px] text-left text-xs border-collapse">
      <thead>
        <tr className="bg-slate-50 border-b border-slate-200">
          <th className="sticky top-0 z-[1] bg-slate-50 p-2 font-semibold text-slate-700">GL Code</th>
          <th className="sticky top-0 z-[1] bg-slate-50 p-2 font-semibold text-slate-700">GL Name</th>
          <th className="sticky top-0 z-[1] bg-slate-50 p-2 font-semibold text-slate-700">Total</th>
          {EXCEL_MONTHS.map((m) => (
            <th key={m} className="sticky top-0 z-[1] bg-slate-50 p-2 font-semibold text-slate-700 whitespace-nowrap">
              {SHORT[m] ?? m}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ data, errors }) => {
          const bad = errors.length > 0;
          return (
            <tr
              key={`${data.sheetRowIndex}-${data.glCode}`}
              className={`border-b border-slate-100 ${bad ? 'bg-rose-50' : 'hover:bg-slate-50'}`}
            >
              <td className="p-2 font-medium text-slate-900">{data.glCode}</td>
              <td className="p-2 text-slate-600 max-w-[140px] truncate" title={data.glName}>
                {data.glName || '—'}
              </td>
              <td className="p-2 font-medium tabular-nums">{formatIndianCurrency(data.yearlyAmount)}</td>
              {EXCEL_MONTHS.map((m) => (
                <td key={m} className="p-2 tabular-nums text-slate-700 whitespace-nowrap">
                  {formatIndianCurrency(data.months[m] ?? 0)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
