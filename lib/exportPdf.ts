import { JSDOM } from 'jsdom';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { BrowserContext } from 'playwright';

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

function buildPlainTextFromHtml(html: string): string {
  const dom = new JSDOM(`<article>${html}</article>`);
  const { document } = dom.window;
  const blocks = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code'));
  const lines: string[] = [];

  for (const block of blocks) {
    const text = block.textContent?.trim();
    if (!text) continue;
    lines.push(text);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function wrapTextToWidth(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  fontSize: number,
): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const wrapped: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width <= maxWidth || !current) {
        current = candidate;
      } else {
        wrapped.push(current);
        current = word;
      }
    }
    if (current) wrapped.push(current);
    wrapped.push('');
  }

  return wrapped;
}

async function fallbackPdfBuffer(params: {
  content: string;
  title: string;
  byline: string;
  settings: ReaderSettings;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(params.title || 'Untitled Article');
  if (params.byline?.trim()) {
    pdf.setAuthor(params.byline.trim());
  }

  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const pageMargin = 48;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const bodySize = clampNumber(params.settings.fontSize, 12, 24);
  const titleSize = Math.min(bodySize + 8, 30);
  const lineHeight = bodySize * clampNumber(params.settings.lineSpacing, 1.2, 2.0);
  const usableWidth = pageWidth - pageMargin * 2;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - pageMargin;

  page.drawText(params.title || 'Untitled Article', {
    x: pageMargin,
    y: cursorY - titleSize,
    size: titleSize,
    font: bold,
  });

  cursorY -= titleSize + 18;

  const plainText = buildPlainTextFromHtml(params.content);
  const lines = wrapTextToWidth(plainText, usableWidth, regular, bodySize);

  for (const line of lines) {
    if (cursorY <= pageMargin + lineHeight) {
      page = pdf.addPage([pageWidth, pageHeight]);
      cursorY = pageHeight - pageMargin;
    }

    if (!line) {
      cursorY -= lineHeight * 0.5;
      continue;
    }

    page.drawText(line, {
      x: pageMargin,
      y: cursorY - bodySize,
      size: bodySize,
      font: regular,
    });
    cursorY -= lineHeight;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

export async function exportPdfBuffer(params: {
  content: string;
  title: string;
  byline: string;
  settings: ReaderSettings;
}): Promise<Buffer> {
  const browser = await getBrowser();
  let context: BrowserContext | null = null;

  try {
    if (!browser) {
      throw new Error('PDF export engine is unavailable in this runtime.');
    }

    context = await browser.newContext();
    const page = await context.newPage();
    const html = renderStyledArticleHtml(
      params.content,
      params.title,
      params.byline,
      params.settings,
    );

    await page.setContent(html, { waitUntil: 'networkidle' });

    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '40px',
        bottom: '40px',
        left: '48px',
        right: '48px',
      },
    });

    return buffer;
  } catch (error) {
    console.error('Playwright PDF generation failed, using fallback:', error);
    return fallbackPdfBuffer(params);
  } finally {
    if (context) {
      await context.close();
    }
  }
}
