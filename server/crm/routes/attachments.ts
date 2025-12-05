import { Router } from "express";
import * as path from "path";
import * as multer from "multer";
import { promises as fs } from "fs";
import { attachmentStorage } from "../storage";
import { crmDb } from "../db-postgres";

// Security constants for file uploads (based on WhatsApp limits)
const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40MB per file (PDF catalogs, etc.)
const MAX_FILES = 5; // Max files per upload request
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/aac',
  'audio/amr',
  'video/mp4',
  'video/3gpp',
  'video/webm',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

/**
 * Creates PUBLIC router for attachments (GET endpoint)
 * This is needed so bots can download files without authentication
 */
export function createPublicAttachmentsRouter() {
  const router = Router();

  router.get("/:id", async (req, res) => {
    try {
      // Try to get metadata from storage first (works even if not in DB)
      const metadata = await attachmentStorage.getMetadata(req.params.id);
      if (!metadata) {
        res.status(404).end();
        return;
      }

      // Try to get attachment from DB for filename
      const attachment = await crmDb.getAttachment(req.params.id);
      const filename = attachment?.filename || metadata.filename || "attachment";

      // Allow cross-origin access for images/media (override helmet's default)
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Type", metadata.mime);
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      const stream = await attachmentStorage.getStream(req.params.id);
      if (!stream) {
        res.status(404).end();
        return;
      }
      stream.pipe(res);
    } catch (error) {
      console.error("[CRM] attachment download error", error);
      res.status(500).end();
    }
  });

  return router;
}

/**
 * Creates PRIVATE router for attachments (POST endpoint)
 * Requires authentication
 */
export function createAttachmentsRouter() {
  const router = Router();

  router.post("/upload", async (req, res) => {
    try {
      const { filename, mime, data } = req.body as { filename?: string; mime?: string; data?: string };

      // Validate required fields
      if (!filename || !mime || !data) {
        res.status(400).json({ error: "invalid_payload", message: "Missing required fields" });
        return;
      }

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.includes(mime)) {
        res.status(400).json({
          error: "invalid_file_type",
          message: "File type not allowed",
          allowedTypes: ALLOWED_MIME_TYPES
        });
        return;
      }

      // Validate base64 data
      if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
        res.status(400).json({ error: "invalid_data", message: "Invalid base64 data" });
        return;
      }

      // Decode and validate file size
      const buffer = Buffer.from(data, "base64");
      if (buffer.length > MAX_FILE_SIZE) {
        res.status(413).json({
          error: "file_too_large",
          message: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
          maxSize: MAX_FILE_SIZE
        });
        return;
      }

      // Sanitize filename - prevent path traversal
      const sanitizedFilename = path.basename(filename).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
      if (sanitizedFilename.length === 0 || sanitizedFilename === '.' || sanitizedFilename === '..') {
        res.status(400).json({ error: "invalid_filename", message: "Invalid filename" });
        return;
      }

      // Store the file
      const stored = await attachmentStorage.saveBuffer({
        buffer,
        filename: sanitizedFilename,
        mime
      });

      const attachment = await crmDb.storeAttachment({
        id: stored.id,
        msgId: null,
        filename: sanitizedFilename,
        mime,
        size: stored.size,
        url: stored.url,
        thumbUrl: stored.url,
      });

      res.json({ attachment });
    } catch (error) {
      console.error("[CRM] upload error", error);
      res.status(500).json({ error: "upload_failed" });
    }
  });

  // Multer configuration for multipart uploads (direct file upload from forms)
  const upload = multer.default({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        try {
          const tmpDir = path.join(process.cwd(), 'uploads', 'tmp');
          await fs.mkdir(tmpDir, { recursive: true });
          cb(null, tmpDir);
        } catch (error) {
          cb(error as Error, "");
        }
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        cb(null, `${unique}-${file.originalname}`);
      }
    }),
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed: ${file.mimetype}`));
      }
    }
  });

  // Multipart file upload endpoint (for direct form uploads)
  router.post("/upload-multipart", upload.array('file', MAX_FILES), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        res.status(400).json({ error: "no_file", message: "No file provided" });
        return;
      }

      const attachments = [];

      for (const file of files) {
        // Sanitize filename
        const sanitizedFilename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
        if (sanitizedFilename.length === 0 || sanitizedFilename === '.' || sanitizedFilename === '..') {
          res.status(400).json({ error: "invalid_filename", message: "Invalid filename" });
          return;
        }

        const tmpPath = file.path;
        const buffer = await fs.readFile(tmpPath);

        try {
          // Store the file
          const stored = await attachmentStorage.saveBuffer({
            buffer,
            filename: sanitizedFilename,
            mime: file.mimetype
          });

          // Save to database
          const attachment = await crmDb.storeAttachment({
            id: stored.id,
            msgId: null,
            filename: sanitizedFilename,
            mime: file.mimetype,
            size: stored.size,
            url: stored.url,
            thumbUrl: stored.url,
          });

          attachments.push({
            id: attachment.id,
            url: attachment.url,
            filename: attachment.filename,
            mime: attachment.mime,
            size: attachment.size
          });
        } finally {
          // Clean up temp file
          try {
            await fs.unlink(tmpPath);
          } catch (cleanupError) {
            console.error("[CRM] Failed to clean temp upload:", cleanupError);
          }
        }
      }

      // Maintain backward compatibility: single file returns object, multiple returns array
      if (attachments.length === 1) {
        res.json(attachments[0]);
      } else {
        res.json({ attachments });
      }
    } catch (error: any) {
      console.error("[CRM] multipart upload error", error);
      if (error.message && error.message.includes('File type not allowed')) {
        res.status(400).json({ error: "invalid_file_type", message: error.message });
      } else {
        res.status(500).json({ error: "upload_failed", message: error.message || "Upload failed" });
      }
    }
  });

  return router;
}
