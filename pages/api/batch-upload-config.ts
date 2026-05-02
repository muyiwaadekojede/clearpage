import type { NextApiRequest, NextApiResponse } from 'next';

import {
  DOCUMENT_ACCEPT_ATTRIBUTE,
  MAX_DOCUMENT_BATCH_BYTES,
  MAX_DOCUMENT_BATCH_FILES,
  MAX_DOCUMENT_FILE_BYTES,
} from '@/lib/documentConversion';
import { getBatchUploadStorageMode } from '@/lib/batchStorage';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(200).json({
    success: true,
    mode: getBatchUploadStorageMode(),
    limits: {
      maxFileBytes: MAX_DOCUMENT_FILE_BYTES,
      maxFiles: MAX_DOCUMENT_BATCH_FILES,
      maxBatchBytes: MAX_DOCUMENT_BATCH_BYTES,
      retentionHours: 24,
    },
    accept: DOCUMENT_ACCEPT_ATTRIBUTE,
  });
}
