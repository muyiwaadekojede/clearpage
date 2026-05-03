import { buildMarkdownExport } from '@/lib/exportMarkdown';
import { buildTxtExport } from '@/lib/exportTxt';
import { sanitizeFilename } from '@/lib/sanitise';
import type { ExportFormat, ReaderSettings } from '@/lib/types';

export const MAX_DOCUMENT_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_DOCUMENT_BATCH_FILES = 500;
export const MAX_DOCUMENT_BATCH_BYTES = 2 * 1024 * 1024 * 1024;
export const DOCUMENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DOCUMENT_SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.html',
  '.htm',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.rst',
] as const;
export const DOCUMENT_ACCEPT_ATTRIBUTE = DOCUMENT_SUPPORTED_EXTENSIONS.join(',');

const MAX_PDF_CONVERSION_PAGES = 120;
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

export type ConversionSource = {
  title: string;
  textContent: string;
  htmlContent: string;
};

async function getPdfParseClass() {
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
    const canvas = await import('@napi-rs/canvas');
    const globals = globalThis as {
      DOMMatrix?: unknown;
      DOMPoint?: unknown;
      DOMRect?: unknown;
      ImageData?: unknown;
      Path2D?: unknown;
    };

    globals.DOMMatrix ??= canvas.DOMMatrix;
    globals.DOMPoint ??= canvas.DOMPoint;
    globals.DOMRect ??= canvas.DOMRect;
    globals.ImageData ??= canvas.ImageData;
    globals.Path2D ??= canvas.Path2D;
  }

  const mod = await import('pdf-parse');
  return mod.PDFParse;
}

async function getMammoth() {
  return await import('mammoth');
}

async function getJSDOMClass() {
  const mod = await import('jsdom');
  return mod.JSDOM;
}

async function getDocxExporter() {
  return await import('@/lib/exportDocx');
}

async function getPdfExporter() {
  return await import('@/lib/exportPdf');
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,8}$/i, '');
}

export function extensionFromName(name: string): string {
  const match = name.match(/(\.[a-z0-9]{1,8})$/i);
  return match?.[1]?.toLowerCase() || '';
}

function isPdfLike(input: { contentType: string; filename: string; bytes: Buffer }): boolean {
  const contentType = input.contentType.toLowerCase();
  if (contentType.includes('application/pdf') || contentType.includes('application/x-pdf')) return true;
  if (input.filename.toLowerCase().endsWith('.pdf')) return true;
  if (input.bytes.length >= 4) {
    return (
      input.bytes[0] === 0x25 &&
      input.bytes[1] === 0x50 &&
      input.bytes[2] === 0x44 &&
      input.bytes[3] === 0x46
    );
  }

  return false;
}

function isDocxLike(input: { contentType: string; filename: string; bytes: Buffer }): boolean {
  const contentType = input.contentType.toLowerCase();
  if (DOCX_MIME_MARKERS.some((marker) => contentType.includes(marker))) return true;
  if (input.filename.toLowerCase().endsWith('.docx')) return true;
  if (input.bytes.length >= 4) {
    return input.bytes[0] === 0x50 && input.bytes[1] === 0x4b && input.filename.toLowerCase().endsWith('.docx');
  }

  return false;
}

function isTextLike(input: { contentType: string; filename: string }): boolean {
  const contentType = input.contentType.toLowerCase();
  if (contentType.startsWith('text/')) return true;
  if (TEXT_MIME_MARKERS.some((marker) => contentType.includes(marker))) return true;
  return DOCUMENT_SUPPORTED_EXTENSIONS.some((ext) => input.filename.toLowerCase().endsWith(ext));
}

export function inferFileKind(input: { contentType: string; filename: string; bytes: Buffer }): FileKind {
  if (isPdfLike(input)) return 'pdf';
  if (isDocxLike(input)) return 'docx';
  if (isTextLike(input)) return 'text';
  return 'unknown';
}

export function isSupportedDocumentFilename(filename: string): boolean {
  const lowered = filename.toLowerCase();
  return DOCUMENT_SUPPORTED_EXTENSIONS.some((extension) => lowered.endsWith(extension));
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

async function htmlToText(html: string): Promise<string> {
  const JSDOM = await getJSDOMClass();
  const dom = new JSDOM(html);
  try {
    return normalizeExtractedText(dom.window.document.body?.textContent || dom.window.document.documentElement.textContent || '');
  } finally {
    dom.window.close();
  }
}

export async function buildConversionSource(input: {
  fileKind: FileKind;
  bytes: Buffer;
  contentType: string;
  rawFilename: string;
}): Promise<ConversionSource | null> {
  const title = stripExtension(input.rawFilename) || 'Untitled Document';

  if (input.fileKind === 'pdf') {
    const PDFParse = await getPdfParseClass();
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
    const mammoth = await getMammoth();
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
        textContent: await htmlToText(decodedText),
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

function normalizeSourceLabel(sourceLabel: string): string {
  const trimmed = sourceLabel.trim();
  return trimmed.length > 0 ? trimmed : 'upload://document';
}

export async function convertDocumentBuffer(input: {
  bytes: Buffer;
  rawFilename: string;
  contentType: string;
  format: ExportFormat;
  sourceLabel: string;
  settings: ReaderSettings;
}): Promise<{
  success: true;
  buffer: Buffer;
  contentType: string;
  filename: string;
  title: string;
} | {
  success: false;
}> {
  const safeFilename = input.rawFilename.trim() || 'document';
  const safeContentType = input.contentType.trim() || 'application/octet-stream';
  const fileKind = inferFileKind({
    contentType: safeContentType,
    filename: safeFilename,
    bytes: input.bytes,
  });

  const titleBase = stripExtension(safeFilename) || 'document';
  const filenameBase = sanitizeFilename(titleBase, 'document');

  if (input.format === 'pdf' && fileKind === 'pdf') {
    return {
      success: true,
      buffer: input.bytes,
      contentType: 'application/pdf',
      filename: `${filenameBase}.pdf`,
      title: titleBase,
    };
  }

  const source = await buildConversionSource({
    fileKind,
    bytes: input.bytes,
    contentType: safeContentType,
    rawFilename: safeFilename,
  });

  if (!source) {
    return { success: false };
  }

  const sourceLabel = normalizeSourceLabel(input.sourceLabel);

  if (input.format === 'md') {
    const markdown = buildMarkdownExport({
      title: source.title,
      byline: 'Unknown',
      sourceUrl: sourceLabel,
      siteName: 'Uploaded Document',
      publishedTime: 'Unknown',
      content: source.htmlContent,
    });

    return {
      success: true,
      buffer: Buffer.from(markdown, 'utf8'),
      contentType: 'text/markdown; charset=utf-8',
      filename: `${filenameBase}.md`,
      title: source.title,
    };
  }

  if (input.format === 'txt') {
    const txt = buildTxtExport({
      title: source.title,
      byline: 'Unknown',
      sourceUrl: sourceLabel,
      siteName: 'Uploaded Document',
      publishedTime: 'Unknown',
      content: source.htmlContent,
      textContent: source.textContent,
    });

    return {
      success: true,
      buffer: Buffer.from(txt, 'utf8'),
      contentType: 'text/plain; charset=utf-8',
      filename: `${filenameBase}.txt`,
      title: source.title,
    };
  }

  if (input.format === 'docx') {
    const { exportDocxBuffer } = await getDocxExporter();
    const docx = await exportDocxBuffer({
      title: source.title,
      byline: 'Unknown',
      sourceUrl: sourceLabel,
      content: source.htmlContent,
    });

    return {
      success: true,
      buffer: docx,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: `${filenameBase}.docx`,
      title: source.title,
    };
  }

  const { exportPdfBuffer } = await getPdfExporter();
  const pdf = await exportPdfBuffer({
    content: source.htmlContent,
    title: source.title,
    byline: 'Unknown',
    settings: input.settings,
  });

  return {
    success: true,
    buffer: pdf,
    contentType: 'application/pdf',
    filename: `${filenameBase}.pdf`,
    title: source.title,
  };
}
