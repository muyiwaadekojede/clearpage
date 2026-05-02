import type { NextApiRequest, NextApiResponse } from 'next';

import { trackAnalyticsEvent } from '@/lib/analytics';
import { cleanupBatchStorageArtifacts } from '@/lib/batchStorage';
import {
  createBatchJob,
  enqueueBatchProcessing,
  getBatchJobDetail,
  MAX_BATCH_JOB_URLS,
  normalizeBatchUrls,
} from '@/lib/batchQueue';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '30mb',
    },
  },
};

function sessionFromHeader(req: NextApiRequest): string | null {
  const header = req.headers['x-clearpage-session'];

  if (typeof header === 'string' && header.trim()) {
    return header.trim().slice(0, 128);
  }

  if (Array.isArray(header) && header[0]?.trim()) {
    return header[0].trim().slice(0, 128);
  }

  return null;
}

function parseUrlsFromBody(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];

  const value = (body as { urls?: unknown }).urls;

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === 'string') {
    return value
      .split(/[\s,;]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function parseFilesFromBody(body: unknown): Array<{ uploadId: string }> {
  if (!body || typeof body !== 'object') return [];

  const value = (body as { files?: unknown }).files;
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const uploadId =
        item && typeof item === 'object' && 'uploadId' in item
          ? String((item as { uploadId?: unknown }).uploadId || '').trim()
          : '';
      return { uploadId };
    })
    .filter((item) => item.uploadId.length > 0);
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    void cleanupBatchStorageArtifacts();
    const sessionId = sessionFromHeader(req);
    const body = req.body as {
      inputMode?: string;
      urls?: string[] | string;
      files?: Array<{ uploadId: string }>;
      format?: string;
      images?: string;
      settings?: unknown;
    };

    const inputMode = body?.inputMode === 'document' ? 'document' : 'url';
    const rawUrls = parseUrlsFromBody(body);
    const normalizedUrls = normalizeBatchUrls(rawUrls);
    const files = parseFilesFromBody(body);

    if (inputMode === 'url') {
      if (normalizedUrls.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid HTTP/HTTPS URLs were provided.',
        });
      }

      if (normalizedUrls.length > MAX_BATCH_JOB_URLS) {
        return res.status(400).json({
          success: false,
          error: `Batch exceeds maximum of ${MAX_BATCH_JOB_URLS.toLocaleString()} URLs.`,
        });
      }
    } else if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No uploaded files were provided.',
      });
    }

    try {
      const created = createBatchJob({
        sessionId,
        inputMode,
        urls: normalizedUrls,
        files,
        format: body?.format,
        images: body?.images,
        settings: body?.settings,
      });

      enqueueBatchProcessing();

      trackAnalyticsEvent(req, {
        eventName: 'batch_job_created',
        eventGroup: 'extract',
        status: 'success',
        pagePath: '/',
        metadata: {
          jobId: created.jobId,
          count: created.totalUrls,
          inputMode,
          format: body?.format || 'md',
          images: body?.images || 'off',
        },
      });

      return res.status(202).json({
        success: true,
        job: created,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create batch job.';

      trackAnalyticsEvent(req, {
        eventName: 'batch_job_created',
        eventGroup: 'extract',
        status: 'failure',
        pagePath: '/',
        errorCode: 'BATCH_JOB_CREATE_FAILED',
        errorMessage: message,
      });

      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  }

  if (req.method === 'GET') {
    void cleanupBatchStorageArtifacts();
    const sessionId = sessionFromHeader(req);
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId.trim() : '';

    if (!jobId) {
      return res.status(400).json({ success: false, error: 'Missing jobId query parameter.' });
    }

    const limit = Number(req.query.limit || 200);
    const offset = Number(req.query.offset || 0);

    const detail = getBatchJobDetail({ jobId, limit, offset });

    if (!detail) {
      return res.status(404).json({ success: false, error: 'Batch job not found.' });
    }

    if (detail.job.sessionId && sessionId && detail.job.sessionId !== sessionId) {
      return res.status(403).json({ success: false, error: 'Not authorized to access this batch job.' });
    }

    if (detail.job.sessionId && !sessionId) {
      return res.status(403).json({ success: false, error: 'Missing session identifier.' });
    }

    if (detail.job.status === 'queued') {
      enqueueBatchProcessing();
    }

    return res.status(200).json({
      success: true,
      job: detail.job,
      estimatedRemainingMs: detail.estimatedRemainingMs,
      items: detail.items,
      paging: {
        limit: Math.max(1, Math.min(1000, Math.floor(limit) || 200)),
        offset: Math.max(0, Math.floor(offset) || 0),
      },
    });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed.' });
}
