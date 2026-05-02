import type { NextApiRequest, NextApiResponse } from 'next';

import { saveLocalUploadedFile, getBatchUploadStorageMode } from '@/lib/batchStorage';
import { isSupportedDocumentFilename, MAX_DOCUMENT_FILE_BYTES } from '@/lib/documentConversion';

export const config = {
  api: {
    bodyParser: false,
  },
};

function firstQueryValue(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] || '' : '';
}

async function readBody(req: NextApiRequest, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error('Uploaded file exceeds the technical size limit.');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  if (getBatchUploadStorageMode() !== 'filesystem') {
    return res.status(400).json({ success: false, error: 'Local upload endpoint is disabled in this environment.' });
  }

  const filename = decodeURIComponent(firstQueryValue(req.query.filename)).trim();
  const contentType = decodeURIComponent(firstQueryValue(req.query.contentType)).trim() || 'application/octet-stream';
  const sessionId = firstQueryValue(req.query.sessionId).trim() || null;

  if (!filename || !isSupportedDocumentFilename(filename)) {
    return res.status(400).json({ success: false, error: 'Unsupported file type.' });
  }

  try {
    const bytes = await readBody(req, MAX_DOCUMENT_FILE_BYTES);
    if (bytes.byteLength === 0) {
      return res.status(400).json({ success: false, error: 'Uploaded file was empty.' });
    }

    const stored = await saveLocalUploadedFile({
      sessionId,
      filename,
      contentType,
      bytes,
    });

    return res.status(200).json({
      success: true,
      file: stored,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload file.',
    });
  }
}
