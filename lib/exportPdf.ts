import { JSDOM } from 'jsdom';

import { getBrowser } from './browser';
import { clampNumber, escapeHtml } from './sanitise';
import type { ReaderSettings } from './types';

function resolveFont(fontFace: ReaderSettings['fontFace']): string {
  if (fontFace === 'serif') return "'Source Serif 4', Georgia, 'Times New Roman', serif";
  if (fontFace === 'monospace') return "'IBM Plex Mono', 'Fira Code', Consolas, monospace";
  if (fontFace === 'dyslexic') return "'OpenDyslexic', 'Atkinson Hyperlegible', Arial, sans-serif";
  return "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif";
}

function resolveTheme(theme: ReaderSettings['colorTheme']): { bg: string; text: string; code: string; border: string } {
  if (theme === 'dark') {
    return { bg: '#111418', text: '#e5e9ee', code: '#1b2129', border: '#344252' };
  }

  if (theme === 'sepia') {
    return { bg: '#f4ecd8', text: '#302317', code: '#eadfc8', border: '#8f7150' };
  }

  return { bg: '#faf9f6', text: '#14171b', code: '#f0f2f4', border: '#7c8a96' };
}

export function renderStyledArticleHtml(
  articleHtml: string,
  title: string,
  byline: string,
  settings: ReaderSettings,
): string {
  const font = resolveFont(settings.fontFace);
  const theme = resolveTheme(settings.colorTheme);
  const fontSize = clampNumber(settings.fontSize, 12, 28);
  const lineSpacing = clampNumber(settings.lineSpacing, 1.2, 2.4);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="author" content="${escapeHtml(byline || 'Unknown')}" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        font-family: ${font};
        font-size: ${fontSize}px;
        line-height: ${lineSpacing};
        color: ${theme.text};
        background: ${theme.bg};
      }
      article {
        max-width: 720px;
        margin: 0 auto;
      }
      h1, h2, h3, h4, h5, h6 {
        line-height: 1.2;
        margin: 1.4em 0 0.5em;
        page-break-after: avoid;
      }
      h1 { font-size: 2.1em; font-weight: 700; }
      h2 { font-size: 1.65em; font-weight: 650; }
      h3 { font-size: 1.38em; font-weight: 640; }
      p { margin: 0 0 1em; orphans: 3; widows: 3; }
      a { color: inherit; text-decoration: underline; }
      img { max-width: 100%; height: auto; display: block; margin: 1.2em auto; page-break-inside: avoid; }
      blockquote {
        margin: 1.2em 0;
        padding: 0.2em 1em;
        border-left: 4px solid ${theme.border};
      }
      code {
        font-family: 'IBM Plex Mono', 'Fira Code', Consolas, monospace;
        background: ${theme.code};
        border-radius: 4px;
        padding: 0.1em 0.3em;
      }
      pre {
        overflow-x: auto;
        padding: 0.85em;
        border-radius: 8px;
        background: ${theme.code};
        page-break-inside: avoid;
      }
      pre code { background: transparent; padding: 0; }
      ul, ol { margin: 0 0 1.1em 1.4em; }
      @media print {
        p, img, blockquote, pre, ul, ol {
          page-break-inside: avoid;
        }
      }
    </style>
  </head>
  <body>
    <article>
      ${articleHtml}
    </article>
  </body>
</html>`;
}

function toPlainTextLines(html: string): string[] {
  const dom = new JSDOM(`<article>${html}</article>`);
  const blocks = Array.from(
    dom.window.document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code'),
  );

  const lines: string[] = [];
  for (const block of blocks) {
    const text = block.textContent?.trim();
    if (!text) continue;
    lines.push(text);
    lines.push('');
  }

  return lines.length > 0 ? lines : ['No readable text content was available.'];
}

function wrapLines(input: string[], maxCharsPerLine: number): string[] {
  const output: string[] = [];

  for (const line of input) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      output.push('');
      continue;
    }

    const words = cleaned.split(' ');
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharsPerLine || !current) {
        current = candidate;
      } else {
        output.push(current);
        current = word;
      }
    }

    if (current) output.push(current);
  }

  return output;
}

function pdfEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function buildFallbackPdf(params: {
  content: string;
  title: string;
  byline: string;
  settings: ReaderSettings;
}): Buffer {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 48;
  const fontSize = clampNumber(params.settings.fontSize, 12, 24);
  const lineHeight = Math.max(14, Math.round(fontSize * clampNumber(params.settings.lineSpacing, 1.2, 2)));
  const linesPerPage = Math.max(20, Math.floor((pageHeight - margin * 2) / lineHeight));

  const titleLine = (params.title || 'Untitled Article').trim();
  const bylineLine = (params.byline || 'Unknown').trim();
  const contentLines = wrapLines(toPlainTextLines(params.content), 90);
  const allLines = [titleLine, bylineLine ? `By: ${bylineLine}` : '', '', ...contentLines];

  const pages: string[][] = [];
  for (let i = 0; i < allLines.length; i += linesPerPage) {
    pages.push(allLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push(['']);

  const objects: Array<string | null> = [null];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Count 0 /Kids [] >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>';

  let nextObjectId = 4;
  const pageIds: number[] = [];

  for (const pageLines of pages) {
    const contentId = nextObjectId++;
    const pageId = nextObjectId++;

    const streamRows: string[] = [
      'BT',
      `/F1 ${fontSize} Tf`,
      `${margin} ${pageHeight - margin} Td`,
      `${lineHeight} TL`,
    ];

    for (const line of pageLines) {
      streamRows.push(`(${pdfEscape(line)}) Tj`);
      streamRows.push('T*');
    }
    streamRows.push('ET');

    const stream = streamRows.join('\n');
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }

  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`;

  const infoId = nextObjectId++;
  objects[infoId] = `<< /Title (${pdfEscape(titleLine)}) /Author (${pdfEscape(bylineLine || 'Unknown')}) >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let id = 1; id < objects.length; id += 1) {
    const objectBody = objects[id];
    if (!objectBody) continue;
    offsets[id] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${id} 0 obj\n${objectBody}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';

  for (let id = 1; id < objects.length; id += 1) {
    const offset = offsets[id] || 0;
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

export async function exportPdfBuffer(params: {
  content: string;
  title: string;
  byline: string;
  settings: ReaderSettings;
}): Promise<Buffer> {
  try {
    const browser = await getBrowser();
    if (!browser) {
      throw new Error('PDF export engine is unavailable in this runtime.');
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const html = renderStyledArticleHtml(
        params.content,
        params.title,
        params.byline,
        params.settings,
      );

      await page.setContent(html, { waitUntil: 'networkidle' });

      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '40px',
          bottom: '40px',
          left: '48px',
          right: '48px',
        },
      });
    } finally {
      await context.close();
    }
  } catch (error) {
    console.error('Playwright PDF export failed. Falling back to text PDF:', error);
    return buildFallbackPdf(params);
  }
}
