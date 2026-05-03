import type { NextApiRequest, NextApiResponse } from 'next';

import { streamStoredObjectToResponse } from '@/lib/batchStorage';
import { getDurableDocumentBatchItem, shouldUseDurableDocumentBatchState } from '@/lib/durableDocumentBatch';
import { getBatchJob, getBatchJobItem } from '@/lib/batchQueue';

function sessionFromHeader(req: NextApiRequest): string | null {
  const header = req.headers['x-clearpage-session'];
  if (typeof header === 'string' && header.trim()) return header.trim().slice(0, 128);
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim().slice(0, 128);
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const sessionId = sessionFromHeader(req);
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId.trim() : '';
  const itemId = typeof req.query.itemId === 'string' ? Number(req.query.itemId) : Number.NaN;

  if (!jobId || !Number.isFinite(itemId)) {
    return res.status(400).json({ success: false, error: 'Missing required query parameters.' });
  }

  const job = getBatchJob(jobId);
  const item = getBatchJobItem(jobId, itemId);

  if (!job || !item) {
    if (shouldUseDurableDocumentBatchState()) {
      const durable = await getDurableDocumentBatchItem({
        jobId,
        itemId,
        sessionId,
      });

      if (durable.kind === 'forbidden') {
        return res.status(403).json({ success: false, error: durable.error });
      }

      if (durable.kind === 'ok') {
        if (!durable.item.outputObjectKey || !durable.item.outputFilename || !durable.item.outputFormat) {
          return res.status(400).json({ success: false, error: 'This batch item is not ready for download.' });
        }

        try {
          await streamStoredObjectToResponse({
            objectKey: durable.item.outputObjectKey,
            response: res,
            contentType:
              durable.item.outputFormat === 'pdf'
                ? 'application/pdf'
                : durable.item.outputFormat === 'docx'
                  ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  : durable.item.outputFormat === 'md'
                    ? 'text/markdown; charset=utf-8'
                    : 'text/plain; charset=utf-8',
            filename: durable.item.outputFilename,
          });
          return;
        } catch (error) {
          return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to stream batch output.',
          });
        }
      }
    }

    return res.status(404).json({ success: false, error: 'Batch job item not found.' });
  }

  if (job.sessionId && sessionId && job.sessionId !== sessionId) {
    return res.status(403).json({ success: false, error: 'Not authorized to access this batch job.' });
  }

  if (job.sessionId && !sessionId) {
    return res.status(403).json({ success: false, error: 'Missing session identifier.' });
  }

  if (!item.outputObjectKey || !item.outputFilename || !item.outputFormat) {
    return res.status(400).json({ success: false, error: 'This batch item is not ready for download.' });
  }

  try {
    await streamStoredObjectToResponse({
      objectKey: item.outputObjectKey,
      response: res,
      contentType:
        item.outputFormat === 'pdf'
          ? 'application/pdf'
          : item.outputFormat === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : item.outputFormat === 'md'
              ? 'text/markdown; charset=utf-8'
              : 'text/plain; charset=utf-8',
      filename: item.outputFilename,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stream batch output.',
    });
  }
}
