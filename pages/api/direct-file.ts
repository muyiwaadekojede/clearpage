import type { NextApiRequest, NextApiResponse } from 'next';

import { trackAnalyticsEvent } from '@/lib/analytics';
import { exportDocxBuffer } from '@/lib/exportDocx';
import { buildMarkdownExport } from '@/lib/exportMarkdown';
import { buildTxtExport } from '@/lib/exportTxt';
import { sanitizeFilename } from '@/lib/sanitise';
import type { ExportFormat } from '@/lib/types';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { JSDOM } from 'jsdom';

const DIRECT_FILE_CONVERSION_TIMEOUT_MS = 120_000;
const DIRECT_FILE_PASSTHROUGH_TIMEOUT_MS = 300_000;
const MAX_DIRECT_FILE_BYTES = 60 * 1024 * 1024;
const MAX_PDF_CONVERSION_PAGES = 120;
const DEFAULT_DIRECT_FILE_FORMAT: ExportFormat = 'md';
const DIRECT_FILE_FORMATS: ExportFormat[] = ['pdf', 'md', 'txt', 'docx'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.yaml', '.yml', '.log', '.rst'];
const DOCX_MIME_MARKERS = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const TEXT_MIME_MARKERS = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/xhtml+xml',
];

type FileKind = 'pdf' | 'docx' | 'text' | 'unknown';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,8}$/i, '');
}

function extensionFromName(name: string): string {
  const match = name.match(/(\.[a-z0-9]{1,8})$/i);
  return match?.[1]?.toLowerCase() || '';
}

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

function isPdfLike(input: { contentType: string; filename: string; bytes: Buffer }): boolean {
  const contentType = input.contentType.toLowerCase();
  if (contentType.includes('application/pdf') || contentType.includes('application/x-pdf')) return true;
  if (input.filename.toLowerCase().endsWith('.pdf')) return true;
  if (input.bytes.length >= 4) {
    return (
      input.bytes[0] === 0x25 && // %
      input.bytes[1] === 0x50 && // P
      input.bytes[2] === 0x44 && // D
      input.bytes[3] === 0x46 // F
    );
  }

  return false;
}

function isDocxLike(input: { contentType: string; filename: string; bytes: Buffer }): boolean {
  const contentType = input.contentType.toLowerCase();
  if (DOCX_MIME_MARKERS.some((marker) => contentType.includes(marker))) return true;
  if (input.filename.toLowerCase().endsWith('.docx')) return true;
  if (input.bytes.length >= 4) {
    return (
      input.bytes[0] === 0x50 && // P
      input.bytes[1] === 0x4b && // K
      input.filename.toLowerCase().endsWith('.docx')
    );
  }

  return false;
}

function isTextLike(input: { contentType: string; filename: string }): boolean {
  const contentType = input.contentType.toLowerCase();
  if (contentType.startsWith('text/')) return true;
  if (TEXT_MIME_MARKERS.some((marker) => contentType.includes(marker))) return true;
  return TEXT_EXTENSIONS.some((ext) => input.filename.toLowerCase().endsWith(ext));
}

function inferFileKind(input: { contentType: string; filename: string; bytes: Buffer }): FileKind {
  if (isPdfLike(input)) return 'pdf';
  if (isDocxLike(input)) return 'docx';
  if (isTextLike(input)) return 'text';
  return 'unknown';
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

function normalizeExtractedPdfText(input: string): string {
  return input.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeExtractedText(input: string): string {
  return input.replace(/\r/g, '').replace(/\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function textToSimpleHtml(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return '<p></p>';
  }

  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

function isHtmlLike(input: { contentType: string; filename: string; text: string }): boolean {
  const contentType = input.contentType.toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) return true;
  if (input.filename.toLowerCase().endsWith('.html') || input.filename.toLowerCase().endsWith('.htm')) return true;
  const sample = input.text.slice(0, 400).toLowerCase();
  return sample.includes('<html') || sample.includes('<body') || sample.includes('<p');
}

function htmlToText(html: string): string {
  const dom = new JSDOM(html);
  try {
    return normalizeExtractedText(dom.window.document.body?.textContent || dom.window.document.documentElement.textContent || '');
  } finally {
    dom.window.close();
  }
}

type ConversionSource = {
  title: string;
  textContent: string;
  htmlContent: string;
};

async function buildConversionSource(input: {
  fileKind: FileKind;
  bytes: Buffer;
  contentType: string;
  rawFilename: string;
  sourceUrl: string;
}): Promise<ConversionSource | null> {
  const title = stripExtension(input.rawFilename) || 'Untitled Document';

  if (input.fileKind === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(input.bytes) });
    let extractedText = '';
    let truncated = false;

    try {
      const textResult = await parser.getText({ first: MAX_PDF_CONVERSION_PAGES });
      extractedText = normalizeExtractedPdfText(textResult.text || '');
      truncated = textResult.total > textResult.pages.length;
    } finally {
      await parser.destroy();
    }

    if (!extractedText) return null;

    const textContent = truncated
      ? `${extractedText}\n\n[Truncated] Converted first ${MAX_PDF_CONVERSION_PAGES} pages only.`
      : extractedText;
    return {
      title,
      textContent,
      htmlContent: textToSimpleHtml(textContent),
    };
  }

  if (input.fileKind === 'docx') {
    const extracted = await mammoth.extractRawText({ buffer: input.bytes });
    const textContent = normalizeExtractedText(extracted.value || '');
    if (!textContent) return null;

    return {
      title,
      textContent,
      htmlContent: textToSimpleHtml(textContent),
    };
  }

  if (input.fileKind === 'text') {
    const decodedText = normalizeExtractedText(new TextDecoder('utf-8').decode(input.bytes));
    if (!decodedText) return null;

    if (isHtmlLike({ contentType: input.contentType, filename: input.rawFilename, text: decodedText })) {
      return {
        title,
        textContent: htmlToText(decodedText),
        htmlContent: decodedText,
      };
    }

    return {
      title,
      textContent: decodedText,
      htmlContent: textToSimpleHtml(decodedText),
    };
  }

  return null;
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
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const body = req.body as { url?: string; format?: ExportFormat };
  const sourceUrl = (body?.url || '').trim();
  const format =
    body?.format && DIRECT_FILE_FORMATS.includes(body.format) ? body.format : DEFAULT_DIRECT_FILE_FORMAT;

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
      if (declaredBytes !== null && declaredBytes > MAX_DIRECT_FILE_BYTES) {
        return res.status(400).json({
          success: false,
          error: `Direct file exceeds ${Math.round(MAX_DIRECT_FILE_BYTES / (1024 * 1024))}MB size limit.`,
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
        maxBytes: MAX_DIRECT_FILE_BYTES,
      });

      trackAnalyticsEvent(req, {
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
    if (bytes.length > MAX_DIRECT_FILE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Direct file exceeds ${Math.round(MAX_DIRECT_FILE_BYTES / (1024 * 1024))}MB size limit.`,
      });
    }

    const fileKind = inferFileKind({ contentType, filename: rawFilename, bytes });
    const conversionSource = await buildConversionSource({
      fileKind,
      bytes,
      contentType,
      rawFilename,
      sourceUrl,
    });

    if (!conversionSource) {
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}${currentExtension}"`);
      res.setHeader('x-clearpage-fallback-format', 'original');
      trackAnalyticsEvent(req, {
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

    if (format === 'md') {
      const markdown = buildMarkdownExport({
        title: conversionSource.title,
        byline: 'Unknown',
        sourceUrl,
        siteName: parsedUrl.hostname,
        publishedTime: 'Unknown',
        content: conversionSource.htmlContent,
      });

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}.md"`);
      trackAnalyticsEvent(req, {
        eventName: 'api_direct_file_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
      });
      return res.status(200).send(Buffer.from(markdown, 'utf8'));
    }

    if (format === 'txt') {
      const txt = buildTxtExport({
        title: conversionSource.title,
        byline: 'Unknown',
        sourceUrl,
        siteName: parsedUrl.hostname,
        publishedTime: 'Unknown',
        content: conversionSource.htmlContent,
        textContent: conversionSource.textContent,
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}.txt"`);
      trackAnalyticsEvent(req, {
        eventName: 'api_direct_file_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
      });
      return res.status(200).send(Buffer.from(txt, 'utf8'));
    }

    const docx = await exportDocxBuffer({
      title: conversionSource.title,
      byline: 'Unknown',
      sourceUrl,
      content: conversionSource.htmlContent,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeBase}.docx"`);
    trackAnalyticsEvent(req, {
      eventName: 'api_direct_file_result',
      eventGroup: 'export',
      status: 'success',
      pagePath: '/',
      sourceUrl,
      exportFormat: format,
    });
    return res.status(200).send(docx);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unexpected direct file error.';
    const isAbort = error instanceof Error && error.name === 'AbortError';
    const isTooLarge = details === 'DIRECT_FILE_TOO_LARGE_STREAM';
    const statusCode = isTooLarge ? 400 : isAbort ? 504 : 500;
    const errorMessage = isTooLarge
      ? `Direct file exceeds ${Math.round(MAX_DIRECT_FILE_BYTES / (1024 * 1024))}MB size limit.`
      : isAbort
        ? 'Direct file request timed out.'
        : 'Failed to process direct file URL.';

    trackAnalyticsEvent(req, {
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
