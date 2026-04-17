import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import multer from 'multer';
import { query } from '../db.js';

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), 'uploads');

/** Max extension length after the dot (e.g. "jpeg" → 4). */
const EXT_BODY_MAX = 32;

/**
 * Derive a safe disk extension from the client filename.
 * Allows common business extensions; rejects weird/pathy names → ".bin".
 */
function safeStoredExtension(originalName) {
  const raw = path.extname(originalName || '').toLowerCase();
  const body = raw.startsWith('.') ? raw.slice(1) : raw;
  if (!body || body.length > EXT_BODY_MAX) return '.bin';
  if (!/^[a-z0-9]+$/.test(body)) return '.bin';
  return `.${body}`;
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_ROOT)) {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  }
}

ensureUploadDir();

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureUploadDir();
      cb(null, UPLOAD_ROOT);
    },
    filename: (_req, file, cb) => {
      const ext = safeStoredExtension(file.originalname);
      const id = `fup_${randomBytes(16).toString('hex')}`;
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const DOCUMENT_TABLES = new Set([
  'purchase_requests',
  'rate_contracts',
  'purchase_orders',
  'grns',
  'invoices',
  'direct_invoices',
]);

/**
 * @param {import('express').Router} router
 */
export default function registerFileAttachmentRoutes(router) {
  router.post(
    '/attachments/upload',
    (req, res, next) => {
      attachmentUpload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
        next();
      });
    },
    async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const documentTable = String(req.body.documentTable || '').trim();
      const documentId = String(req.body.documentId || '').trim();
      if (!DOCUMENT_TABLES.has(documentTable)) {
        return res.status(400).json({ error: 'Invalid documentTable' });
      }
      if (!documentId) {
        return res.status(400).json({ error: 'documentId is required' });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'file is required' });
      }

      const storedFilename = file.filename;
      const id = path.basename(storedFilename, path.extname(storedFilename));
      const originalName = file.originalname || storedFilename;
      const mimeType = file.mimetype || 'application/octet-stream';
      const sizeBytes = file.size || 0;

      await query(
        `INSERT INTO file_uploads (id, document_table, document_id, original_name, stored_filename, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, documentTable, documentId, originalName, storedFilename, mimeType, sizeBytes, userId]
      );

      return res.json({
        id,
        name: originalName,
        url: `/api/attachment-files/${id}`,
        uploadedAt: new Date().toISOString(),
      });
    } catch (e) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
      }
      return res.status(500).json({ error: e.message || 'Upload failed' });
    }
  }
  );

  router.post('/attachments/link-document', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { draftDocumentId, documentId, documentTable } = req.body || {};
      const dt = String(documentTable || '').trim();
      const draft = String(draftDocumentId || '').trim();
      const finalId = String(documentId || '').trim();
      if (!DOCUMENT_TABLES.has(dt)) {
        return res.status(400).json({ error: 'Invalid documentTable' });
      }
      if (!draft || !finalId) {
        return res.status(400).json({ error: 'draftDocumentId and documentId are required' });
      }

      const r = await query(
        `UPDATE file_uploads SET document_id = $1 WHERE document_table = $2 AND document_id = $3 RETURNING id`,
        [finalId, dt, draft]
      );
      return res.json({ updated: r.rowCount || 0 });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.delete('/attachments/:id', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const id = String(req.params.id || '').trim();
      if (!/^fup_[a-fA-F0-9]{32}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const r = await query('SELECT * FROM file_uploads WHERE id = $1', [id]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'Not found' });

      const abs = path.join(UPLOAD_ROOT, row.stored_filename);
      const resolved = path.resolve(abs);
      if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      await query('DELETE FROM file_uploads WHERE id = $1', [id]);

      if (fs.existsSync(resolved)) {
        try {
          fs.unlinkSync(resolved);
        } catch {
          /* ignore */
        }
      }

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Delete failed' });
    }
  });

  router.get('/attachment-files/:id', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).send('Unauthorized');

      const id = String(req.params.id || '').trim();
      if (!/^fup_[a-fA-F0-9]{32}$/.test(id)) {
        return res.status(400).send('Invalid id');
      }

      const r = await query('SELECT * FROM file_uploads WHERE id = $1', [id]);
      const row = r.rows[0];
      if (!row) return res.status(404).send('Not found');

      const abs = path.join(UPLOAD_ROOT, row.stored_filename);
      const resolved = path.resolve(abs);
      if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) {
        return res.status(400).send('Invalid path');
      }
      if (!fs.existsSync(resolved)) {
        return res.status(404).send('File missing on disk');
      }

      const download = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      if (download) {
        const safeName = String(row.original_name || 'download').replace(/[^\w.\- ()]+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }
      fs.createReadStream(resolved).pipe(res);
    } catch (e) {
      res.status(500).send(e.message || 'Error');
    }
  });

  router.post('/attachments/:id/view', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const id = String(req.params.id || '').trim();
      if (!/^fup_[a-fA-F0-9]{32}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const exists = await query('SELECT 1 FROM file_uploads WHERE id = $1', [id]);
      if (!exists.rows[0]) return res.status(404).json({ error: 'Not found' });

      await query(
        `INSERT INTO attachment_views (file_upload_id, user_id) VALUES ($1, $2)
         ON CONFLICT (file_upload_id, user_id) DO NOTHING`,
        [id, userId]
      );
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/attachments/view-status', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const documentTable = String(req.query.documentTable || '').trim();
      const documentId = String(req.query.documentId || '').trim();
      if (!DOCUMENT_TABLES.has(documentTable) || !documentId) {
        return res.status(400).json({ error: 'Invalid documentTable or documentId' });
      }

      const files = await query(
        'SELECT id FROM file_uploads WHERE document_table = $1 AND document_id = $2',
        [documentTable, documentId]
      );
      const ids = (files.rows || []).map((row) => row.id);
      const totalAttachments = ids.length;
      if (totalAttachments === 0) {
        return res.json({ totalAttachments: 0, viewedByMe: 0, allViewed: true });
      }

      const viewed = await query(
        'SELECT COUNT(*)::int AS c FROM attachment_views WHERE user_id = $1 AND file_upload_id = ANY($2::varchar[])',
        [userId, ids]
      );
      const viewedByMe = viewed.rows[0]?.c ?? 0;
      const allViewed = viewedByMe >= totalAttachments;
      return res.json({ totalAttachments, viewedByMe, allViewed });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
}
