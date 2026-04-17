import { useState, useCallback } from 'react';
import { apiPostFormData } from '../api';

export interface BudgetUploadErrorItem {
  row: number;
  glCode: string;
  reason: string;
}

export interface BudgetUploadResponse {
  success: boolean;
  created: number;
  updated: number;
  errors: BudgetUploadErrorItem[];
  message: string;
}

export function useUploadBudget() {
  const [uploading, setUploading] = useState(false);

  const uploadBudget = useCallback(async (formData: FormData) => {
    setUploading(true);
    try {
      return await apiPostFormData<BudgetUploadResponse>('budgets/upload', formData);
    } finally {
      setUploading(false);
    }
  }, []);

  return { uploadBudget, uploading };
}
