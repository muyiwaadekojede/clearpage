import type { NextApiRequest, NextApiResponse } from 'next';

import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  convertDocumentBuffer,
  extensionFromName,
  stripExtension,
  MAX_DOCUMENT_FILE_BYTES,
} from '@/lib/documentConversion';
import { sanitizeFilename } from '@/lib/sanitise';
import type { ExportFormat } from '@/lib/types';

const DIRECT_FILE_CONVERSION_TIMEOUT_MS = 120_000;
const DIRECT_FILE_PASSTHROUGH_TIMEOUT_MS = 300_000;
const DEFAULT_DIRECT_FILE_FORMAT: ExportFormat = 'md';
const DIRECT_FILE_FORMATS: ExportFormat[] = ['pdf', 'md', 'txt', 'docx'];

function parseFilenameFromDisposition(disposition: string | null): string {
  const value = disposition || '';
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      // ignored
    }
  }

  const fallback = value.match(/filename="?([^"]+)"?/i);
  return (fallback?.[1] || '').trim();
}

function inferFilename(sourceUrl: string, response: Response): string {
  const dispositionName = parseFilenameFromDisposition(response.headers.get('content-disposition'));
  if (dispositionName) return dispositionName;

  try {
    const parsed = new URL(response.url || sourceUrl);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() || 'direct-file';
    return decodeURIComponent(segment);
  } catch {
    return 'direct-file';
  }
}

function isLikelyPdfFromMeta(input: { contentType: string; filename: string }): boolean {
  const contentType = (input.contentType || '').toLowerCase();
  if (contentType.includes('application/pdf') || contentType.includes('application/x-pdf')) return true;
  return input.filename.toLowerCase().endsWith('.pdf');
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function streamResponseBodyToClient(input: {
  response: Response;
  res: NextApiResponse;
  maxBytes: number;
}): Promise<number> {
  if (!input.response.body) {
    input.res.end();
    return 0;
  }

  const reader = input.response.body.getReader();
  let sentBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      sentBytes += value.byteLength;
      if (sentBytes > input.maxBytes) {
        throw new Error('DIRECT_FILE_TOO_LARGE_STREAM');
      }

      input.res.write(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  input.res.end();
  return sentBytes;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const body = req.body as { url?: string; format?: ExportFormat; sessionId?: string } | undefined;
  const firstQueryValue = (value: string | string[] | undefined): string =>
    typeof value === 'string' ? value : Array.isArray(value) ? value[0] || '' : '';

  const sourceUrl =
    req.method === 'GET'
      ? firstQueryValue(req.query.url).trim()
      : (body?.url || '').trim();
  const format =
    (() => {
      const rawFormat =
        req.method === 'GET'
          ? (firstQueryValue(req.query.format) as ExportFormat)
          : body?.format;
      return rawFormat && DIRECT_FILE_FORMATS.includes(rawFormat)
        ? rawFormat
        : DEFAULT_DIRECT_FILE_FORMAT;
    })();

  const requestSessionId =
    req.method === 'GET' ? firstQueryValue(req.query.sessionId).trim() : body?.sessionId?.trim();

  if (!sourceUrl) {
    return res.status(400).json({ success: false, error: 'Missing required field: url.' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ success: false, error: 'Only HTTP/HTTPS URLs are supported.' });
  }

  trackAnalyticsEvent(req, {
    sessionId: requestSessionId || undefined,
    eventName: 'api_direct_file_request',
    eventGroup: 'export',
    status: 'attempt',
    pagePath: '/',
    sourceUrl,
    exportFormat: format,
  });

  const timeoutMs = format === 'pdf' ? DIRECT_FILE_PASSTHROUGH_TIMEOUT_MS : DIRECT_FILE_CONVERSION_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(400).json({
        success: false,
        error: `Failed to fetch direct file (HTTP ${response.status}).`,
      });
    }

    const contentType = (response.headers.get('content-type') || 'application/octet-stream').toLowerCase();
    const rawFilename = inferFilename(sourceUrl, response);
    const safeBase = sanitizeFilename(stripExtension(rawFilename) || 'direct-file');
    const currentExtension = extensionFromName(rawFilename) || '.bin';

    if (format === 'pdf') {
      const declaredBytes = parseContentLength(response.headers.get('content-length'));
      if (declaredBytes !== null && declaredBytes > MAX_DOCUMENT_FILE_BYTES) {
        return res.status(400).json({
          success: false,
          error: `Direct file exceeds ${Math.round(MAX_DOCUMENT_FILE_BYTES / (1024 * 1024))}MB size limit.`,
        });
      }

      const isPdf = isLikelyPdfFromMeta({ contentType, filename: rawFilename });
      const ext = isPdf ? '.pdf' : currentExtension;
      res.setHeader('Content-Type', isPdf ? 'application/pdf' : contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}${ext}"`);
      res.status(200);

      const streamedBytes = await streamResponseBodyToClient({
        response,
        res,
        maxBytes: MAX_DOCUMENT_FILE_BYTES,
      });

      trackAnalyticsEvent(req, {
        sessionId: requestSessionId || undefined,
        eventName: 'api_direct_file_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
        metadata: {
          mode: 'passthrough',
          streamedBytes,
        },
      });
      return;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOCUMENT_FILE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Direct file exceeds ${Math.round(MAX_DOCUMENT_FILE_BYTES / (1024 * 1024))}MB size limit.`,
      });
    }

    const converted = await convertDocumentBuffer({
      bytes,
      rawFilename,
      contentType,
      format,
      sourceLabel: sourceUrl,
      settings: {
        fontFace: 'serif',
        fontSize: 16,
        lineSpacing: 1.6,
        colorTheme: 'light',
      },
    });

    if (!converted.success) {
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}${currentExtension}"`);
      res.setHeader('x-clearpage-fallback-format', 'original');
      trackAnalyticsEvent(req, {
        sessionId: requestSessionId || undefined,
        eventName: 'api_direct_file_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
        metadata: {
          fallback: 'original_file',
          fallbackExtension: currentExtension,
        },
      });
      return res.status(200).send(bytes);
    }

    res.setHeader('Content-Type', converted.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${converted.filename}"`);
    trackAnalyticsEvent(req, {
      sessionId: requestSessionId || undefined,
      eventName: 'api_direct_file_result',
      eventGroup: 'export',
      status: 'success',
      pagePath: '/',
      sourceUrl,
      exportFormat: format,
    });
    return res.status(200).send(converted.buffer);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unexpected direct file error.';
    const isAbort = error instanceof Error && error.name === 'AbortError';
    const isTooLarge = details === 'DIRECT_FILE_TOO_LARGE_STREAM';
    const statusCode = isTooLarge ? 400 : isAbort ? 504 : 500;
    const errorMessage = isTooLarge
      ? `Direct file exceeds ${Math.round(MAX_DOCUMENT_FILE_BYTES / (1024 * 1024))}MB size limit.`
      : isAbort
        ? 'Direct file request timed out.'
        : 'Failed to process direct file URL.';

    trackAnalyticsEvent(req, {
      sessionId: requestSessionId || undefined,
      eventName: 'api_direct_file_result',
      eventGroup: 'export',
      status: 'failure',
      pagePath: '/',
      sourceUrl,
      exportFormat: format,
      errorCode: isAbort ? 'DIRECT_FILE_TIMEOUT' : isTooLarge ? 'DIRECT_FILE_TOO_LARGE' : 'DIRECT_FILE_FAILED',
      errorMessage: details,
    });

    if (res.headersSent) {
      if (!res.writableEnded) {
        res.destroy(error instanceof Error ? error : new Error(details));
      }
      return;
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
