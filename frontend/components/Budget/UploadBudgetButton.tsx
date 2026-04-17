import React from 'react';
import { UploadCloud } from 'lucide-react';

interface UploadBudgetButtonProps {
  onClick: () => void;
}

export const UploadBudgetButton: React.FC<UploadBudgetButtonProps> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="px-4 py-2 rounded-lg flex items-center gap-2 bg-white text-slate-600 border border-slate-200"
  >
    <UploadCloud size={18} /> Upload Budget
  </button>
);
