import type { NextApiRequest, NextApiResponse } from 'next';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

import { getBatchUploadStorageMode } from '@/lib/batchStorage';
import { isSupportedDocumentFilename, MAX_DOCUMENT_FILE_BYTES } from '@/lib/documentConversion';

type UploadClientPayload = {
  sessionId: string | null;
  filename: string;
  contentType: string;
  byteSize: number;
};

function parsePayload(raw: string | null): UploadClientPayload {
  if (!raw) {
    throw new Error('Missing upload payload.');
  }

  const parsed = JSON.parse(raw) as Partial<UploadClientPayload>;
  return {
    sessionId: typeof parsed.sessionId === 'string' && parsed.sessionId.trim() ? parsed.sessionId.trim() : null,
    filename: String(parsed.filename || '').trim(),
    contentType: String(parsed.contentType || 'application/octet-stream').trim() || 'application/octet-stream',
    byteSize: Number(parsed.byteSize || 0),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  if (getBatchUploadStorageMode() !== 'blob') {
    return res.status(400).json({ success: false, error: 'Blob uploads are not enabled in this environment.' });
  }

  try {
    const body = req.body as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const payload = parsePayload(clientPayload);
        if (!payload.filename || !isSupportedDocumentFilename(payload.filename)) {
          throw new Error('Unsupported file type.');
        }
        if (!Number.isFinite(payload.byteSize) || payload.byteSize <= 0) {
          throw new Error('Invalid upload size.');
        }
        if (payload.byteSize > MAX_DOCUMENT_FILE_BYTES) {
          throw new Error('File exceeds the technical size limit.');
        }

        return {
          allowedContentTypes: [payload.contentType || 'application/octet-stream'],
          maximumSizeInBytes: MAX_DOCUMENT_FILE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({
            sessionId: payload.sessionId,
            filename: payload.filename,
          }),
        };
      },
      onUploadCompleted: async () => {
        // The client explicitly finalizes uploads via /api/batch-upload-complete.
      },
    });

    if (result.type === 'blob.generate-client-token') {
      return res.status(200).json({ clientToken: result.clientToken });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate upload token.',
    });
  }
}
