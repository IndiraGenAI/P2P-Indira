import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { fetchAttachmentViewStatus } from '../../utils/serverAttachment';

interface AttachmentEyeButtonProps {
  documentTable: string;
  documentId: string;
  /** Bump to refetch view status (e.g. after closing document viewer). */
  refreshKey?: number;
  /**
   * Count of server-backed attachments from document JSON (e.g. row.attachments with fup_ ids).
   * Keeps the control visible when the list payload has files but view-status briefly returns 0.
   */
  serverAttachmentHintCount?: number;
  /** When set and equal to currentUserId, the eye is hidden (creator is not the “reviewer” for this metric). */
  documentCreatedBy?: string | null;
  currentUserId?: string | null;
}

export const AttachmentEyeButton: React.FC<AttachmentEyeButtonProps> = ({
  documentTable,
  documentId,
  refreshKey = 0,
  serverAttachmentHintCount = 0,
  documentCreatedBy,
  currentUserId,
}) => {
  const [total, setTotal] = useState(0);
  const [viewed, setViewed] = useState(0);
  const [loading, setLoading] = useState(true);

  const hideForCreator =
    Boolean(documentCreatedBy) && Boolean(currentUserId) && documentCreatedBy === currentUserId;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchAttachmentViewStatus(documentTable, documentId);
      setTotal(s.totalAttachments);
      setViewed(s.viewedByMe);
    } catch {
      setTotal(0);
      setViewed(0);
    } finally {
      setLoading(false);
    }
  }, [documentTable, documentId]);

  useEffect(() => {
    if (hideForCreator) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, refreshKey, hideForCreator]);

  if (hideForCreator) {
    return null;
  }

  const hint = Math.max(0, serverAttachmentHintCount);
  const effectiveTotal = Math.max(total, hint);

  if (loading && effectiveTotal === 0) {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center text-slate-300" title="Loading…">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
      </span>
    );
  }

  if (effectiveTotal === 0) return null;

  const allViewed = total > 0 && viewed >= total;
  const title = allViewed
    ? 'All attachments reviewed'
    : total > 0
      ? `${viewed} of ${total} attachments reviewed`
      : hint > 0
        ? `${viewed} of ${hint} attachments (syncing…)`
        : `${viewed} of ${total} attachments reviewed`;

  return (
    <button
      type="button"
      title={title}
      onClick={() => void load()}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent hover:bg-slate-100"
    >
      {allViewed ? <Eye size={18} className="text-emerald-600" /> : <EyeOff size={18} className="text-slate-400" />}
    </button>
  );
};
