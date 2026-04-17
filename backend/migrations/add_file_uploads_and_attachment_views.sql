-- Server-stored document attachments (metadata + on-disk filename under backend/uploads/)
CREATE TABLE IF NOT EXISTS file_uploads (
  id VARCHAR(64) PRIMARY KEY,
  document_table VARCHAR(64) NOT NULL,
  document_id VARCHAR(64) NOT NULL,
  original_name TEXT NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_uploads_document ON file_uploads(document_table, document_id);

CREATE TABLE IF NOT EXISTS attachment_views (
  id BIGSERIAL PRIMARY KEY,
  file_upload_id VARCHAR(64) NOT NULL REFERENCES file_uploads(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(file_upload_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_views_file ON attachment_views(file_upload_id);
CREATE INDEX IF NOT EXISTS idx_attachment_views_user ON attachment_views(user_id);
