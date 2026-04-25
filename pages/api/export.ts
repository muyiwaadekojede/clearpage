import type { NextApiRequest, NextApiResponse } from 'next';

import { trackAnalyticsEvent } from '@/lib/analytics';
import { exportDocxBuffer } from '@/lib/exportDocx';
import { buildMarkdownExport } from '@/lib/exportMarkdown';
import { exportPdfBuffer } from '@/lib/exportPdf';
import { buildTxtExport } from '@/lib/exportTxt';
import { getExtractSnapshot } from '@/lib/extractCache';
import { extractFromUrl } from '@/lib/extract';
import { sanitizeFilename } from '@/lib/sanitise';
import { clampNumber } from '@/lib/sanitise';
import type { ExportFormat, ImageMode, ReaderSettings } from '@/lib/types';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

const DEFAULT_SETTINGS: ReaderSettings = {
  fontFace: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  colorTheme: 'light',
};

function normalizeSettings(input: Partial<ReaderSettings> | undefined): ReaderSettings {
  return {
    fontFace:
      input?.fontFace === 'serif' ||
      input?.fontFace === 'sans-serif' ||
      input?.fontFace === 'monospace' ||
      input?.fontFace === 'dyslexic'
        ? input.fontFace
        : DEFAULT_SETTINGS.fontFace,
    fontSize: clampNumber(Number(input?.fontSize ?? DEFAULT_SETTINGS.fontSize), 12, 28),
    lineSpacing: clampNumber(Number(input?.lineSpacing ?? DEFAULT_SETTINGS.lineSpacing), 1.2, 2.4),
    colorTheme:
      input?.colorTheme === 'light' || input?.colorTheme === 'dark' || input?.colorTheme === 'sepia'
        ? input.colorTheme
        : DEFAULT_SETTINGS.colorTheme,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const body = req.body as {
    format?: ExportFormat;
    content?: string;
    textContent?: string;
    title?: string;
    byline?: string;
    siteName?: string;
    publishedTime?: string;
    sourceUrl?: string;
    images?: ImageMode;
    extractionId?: string;
    settings?: Partial<ReaderSettings>;
  };

  const format = body.format;
  let title = (body.title || 'Untitled Article').trim();
  const sourceUrl = (body.sourceUrl || '').trim();
  let byline = (body.byline || 'Unknown').trim();
  let siteName = (body.siteName || 'Unknown').trim();
  let publishedTime = (body.publishedTime || 'Unknown').trim();
  let textContent = (body.textContent || '').trim();
  const images: ImageMode =
    body.images === 'off' || body.images === 'captions' || body.images === 'on'
      ? body.images
      : 'on';
  const extractionId =
    typeof body.extractionId === 'string' && body.extractionId.trim().length > 0
      ? body.extractionId.trim()
      : null;

  if (!format || !['pdf', 'txt', 'md', 'docx'].includes(format)) {
    trackAnalyticsEvent(req, {
      eventName: 'api_export_result',
      eventGroup: 'export',
      status: 'failure',
      pagePath: '/',
      errorCode: 'INVALID_FORMAT',
      errorMessage: 'Invalid format.',
      sourceUrl,
    });
    return res.status(400).json({ success: false, error: 'Invalid format.' });
  }

  trackAnalyticsEvent(req, {
    eventName: 'api_export_request',
    eventGroup: 'export',
    status: 'attempt',
    pagePath: '/',
    sourceUrl,
    exportFormat: format,
    metadata: {
      title,
    },
  });

  let content = typeof body.content === 'string' ? body.content : '';

  if (!content && extractionId) {
    const snapshot = getExtractSnapshot(extractionId);

    if (snapshot) {
      content = snapshot.contentVariants[images];
      textContent = snapshot.textContent;
      title = snapshot.title || title;
      byline = snapshot.byline || byline;
      siteName = snapshot.siteName || siteName;
      publishedTime = snapshot.publishedTime || publishedTime;
    }
  }

  if (!content) {
    if (!sourceUrl) {
      trackAnalyticsEvent(req, {
        eventName: 'api_export_result',
        eventGroup: 'export',
        status: 'failure',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
        errorCode: 'MISSING_CONTENT',
        errorMessage: 'Missing content, extraction ID, and source URL.',
      });
      return res.status(400).json({
        success: false,
        error: 'Missing content, extraction ID, and source URL.',
      });
    }

    const extracted = await extractFromUrl(sourceUrl, images);

    if (!extracted.success) {
      trackAnalyticsEvent(req, {
        eventName: 'api_export_result',
        eventGroup: 'export',
        status: 'failure',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
        errorCode: extracted.errorCode,
        errorMessage: extracted.errorMessage,
      });

      return res.status(400).json({
        success: false,
        error: extracted.errorMessage || 'Failed to regenerate article content for export.',
        errorCode: extracted.errorCode,
      });
    }

    content = extracted.content;
    textContent = extracted.textContent;
    title = extracted.title || title;
    byline = extracted.byline || byline;
    siteName = extracted.siteName || siteName;
    publishedTime = extracted.publishedTime || publishedTime;
  }

  const settings = normalizeSettings(body.settings);
  const filenameBase = sanitizeFilename(title);

  try {
    if (format === 'pdf') {
      const buffer = await exportPdfBuffer({
        content,
        title,
        byline,
        settings,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
      trackAnalyticsEvent(req, {
        eventName: 'api_export_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
      });
      return res.status(200).send(buffer);
    }

    if (format === 'txt') {
      const txt = buildTxtExport({
        title,
        byline,
        sourceUrl,
        siteName,
        publishedTime,
        content,
        textContent,
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.txt"`);
      trackAnalyticsEvent(req, {
        eventName: 'api_export_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
      });
      return res.status(200).send(Buffer.from(txt, 'utf8'));
    }

    if (format === 'md') {
      const markdown = buildMarkdownExport({
        title,
        byline,
        sourceUrl,
        siteName,
        publishedTime,
        content,
      });

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.md"`);
      trackAnalyticsEvent(req, {
        eventName: 'api_export_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl,
        exportFormat: format,
      });
      return res.status(200).send(Buffer.from(markdown, 'utf8'));
    }

    const docx = await exportDocxBuffer({
      title,
      byline,
      sourceUrl,
      content,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.docx"`);
    trackAnalyticsEvent(req, {
      eventName: 'api_export_result',
      eventGroup: 'export',
      status: 'success',
      pagePath: '/',
      sourceUrl,
      exportFormat: format,
    });
    return res.status(200).send(docx);
  } catch (error) {
    console.error('Export error:', error);
    const details = error instanceof Error ? error.message : 'Unknown export error';
    trackAnalyticsEvent(req, {
      eventName: 'api_export_result',
      eventGroup: 'export',
      status: 'failure',
      pagePath: '/',
      sourceUrl,
      exportFormat: format,
      errorCode: 'EXPORT_FAILED',
      errorMessage: details,
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to generate export.',
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    });
  }
}
