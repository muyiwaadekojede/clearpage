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

export async function exportPdfBuffer(params: {
  content: string;
  title: string;
  byline: string;
  settings: ReaderSettings;
}): Promise<Buffer> {
  const browser = await getBrowser();
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
}
