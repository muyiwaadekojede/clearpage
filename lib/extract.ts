import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

import { getBrowser } from './browser';
import { sanitizeHtml } from './sanitise';
import type { ExtractErrorCode, ExtractResponse, ImageMode } from './types';

const PAYWALL_MARKERS = [
  'subscriber-only',
  'subscribers only',
  'subscribe to continue reading',
  'sign in to read',
  'premium content',
  'members only',
  'join to continue',
  'already a subscriber',
  'unlock this article',
  'start your free trial',
];

const RENDER_ERROR_MARKERS = [
  'something went wrong on our end',
  'temporarily unavailable',
  'please try again later',
  'error loading story',
];

const IMAGE_EXTENSION_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

class ExtractPipelineError extends Error {
  readonly code: ExtractErrorCode;

  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function countWords(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

function hasPaywallSignals(html: string): boolean {
  const haystack = html.toLowerCase();
  return PAYWALL_MARKERS.some((marker) => haystack.includes(marker));
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  referer?: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(referer ? { Referer: referer } : {}),
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildImageCaption(alt: string | null | undefined): string {
  const text = alt?.trim() || 'image unavailable';
  return `<em>[Image: ${text}]</em>`;
}

function parseSrcSet(srcset: string | null): string | null {
  if (!srcset) return null;

  const candidates = srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [urlPart, sizePart] = part.split(/\s+/, 2);
      const sizeValue = Number((sizePart || '').replace(/\D+/g, '')) || 0;
      return { urlPart, sizeValue };
    })
    .filter((item) => item.urlPart);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.sizeValue - a.sizeValue);
  return candidates[0].urlPart;
}

function isLikelyPlaceholder(src: string): boolean {
  const lowered = src.toLowerCase();
  return (
    lowered.startsWith('data:image/gif;base64,r0lgod') ||
    lowered.includes('spacer') ||
    lowered.includes('pixel') ||
    lowered === '#'
  );
}

function resolveImageSource(img: Element): string | null {
  const src = img.getAttribute('src')?.trim() || '';
  const srcset = parseSrcSet(img.getAttribute('srcset'));
  const dataSrcset = parseSrcSet(img.getAttribute('data-srcset'));

  const altSources = [
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-url'),
    img.getAttribute('data-hi-res-src'),
  ]
    .map((value) => value?.trim() || '')
    .filter(Boolean);

  const primary = !isLikelyPlaceholder(src) ? src : '';
  const first = primary || srcset || dataSrcset || altSources[0] || '';
  return first || null;
}

function detectImageMime(
  contentType: string,
  sourceUrl: string,
  bytes: Buffer,
): string | null {
  const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();
  if (normalizedContentType.startsWith('image/')) {
    return normalizedContentType;
  }

  if (bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif';
    }
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
  }

  try {
    const pathname = new URL(sourceUrl).pathname.toLowerCase();
    const extension = Object.keys(IMAGE_EXTENSION_MIME).find((ext) => pathname.endsWith(ext));
    if (extension) return IMAGE_EXTENSION_MIME[extension];
  } catch {
    // ignored
  }

  return null;
}

async function processImages(
  html: string,
  mode: ImageMode,
  sourceUrl: string,
): Promise<{ content: string; totalImages: number; embeddedImages: number }> {
  const dom = new JSDOM(`<body>${html}</body>`, { url: sourceUrl });

  try {
    const document = dom.window.document;
    const images = Array.from(document.querySelectorAll('img'));
    const totalImages = images.length;

    if (mode === 'off') {
      for (const img of images) img.remove();
      return { content: document.body.innerHTML, totalImages, embeddedImages: 0 };
    }

    if (mode === 'captions') {
      for (const img of images) {
        img.insertAdjacentHTML('afterend', buildImageCaption(img.getAttribute('alt')));
        img.remove();
      }
      return { content: document.body.innerHTML, totalImages, embeddedImages: 0 };
    }

    let embeddedImages = 0;

    for (const img of images) {
      const rawSrc = resolveImageSource(img);

      if (!rawSrc) {
        img.insertAdjacentHTML('afterend', buildImageCaption(img.getAttribute('alt')));
        img.remove();
        continue;
      }

      if (rawSrc.startsWith('data:')) {
        embeddedImages += 1;
        continue;
      }

      const resolvedSrc = new URL(rawSrc, sourceUrl).toString();

      try {
        const response = await fetchWithTimeout(resolvedSrc, 10_000, sourceUrl);

        if (!response.ok) {
          throw new Error(`Image fetch failed with status ${response.status}`);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        const mime = detectImageMime(contentType, resolvedSrc, bytes);

        if (!mime) {
          throw new Error(`Unexpected content type: ${contentType}`);
        }

        const dataUri = `data:${mime};base64,${bytes.toString('base64')}`;

        img.setAttribute('src', dataUri);
        embeddedImages += 1;
      } catch {
        img.insertAdjacentHTML('afterend', buildImageCaption(img.getAttribute('alt')));
        img.remove();
      }
    }

    return { content: document.body.innerHTML, totalImages, embeddedImages };
  } finally {
    dom.window.close();
  }
}

async function fetchRenderedHtml(url: string): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
    },
  });

  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (response && !response.ok()) {
      throw new ExtractPipelineError(
        'FETCH_FAILED',
        `Failed to reach URL (HTTP ${response.status()}).`,
      );
    }

    try {
      await page.waitForLoadState('networkidle', { timeout: 8_000 });
    } catch {
      // Some sites keep long-running requests open; continue with rendered content.
    }

    return await page.content();
  } catch (error) {
    const maybeError = error as { name?: string; message?: string; code?: ExtractErrorCode };

    if (maybeError.code) {
      throw error;
    }

    if (maybeError.name === 'TimeoutError') {
      throw new ExtractPipelineError('TIMEOUT', 'The page took too long to load.');
    }

    throw new ExtractPipelineError('FETCH_FAILED', 'Could not fetch the target URL.');
  } finally {
    await context.close();
  }
}

function normalizeExtractText(value: string | undefined | null): string {
  return (value || '').replace(/\u00a0/g, ' ').trim();
}

function getMetaContent(document: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value =
      document.querySelector(selector)?.getAttribute('content')?.trim() ||
      document.querySelector(selector)?.textContent?.trim() ||
      '';
    if (value) return value;
  }
  return '';
}

function normalizeCandidateTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripTitleSuffixes(title: string, siteName: string): string {
  let output = title;

  if (siteName) {
    const escapedSite = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`\\s*[|\\-:]\\s*${escapedSite}\\s*$`, 'i'), '').trim();
    output = output.replace(new RegExp(`\\s*${escapedSite}\\s*[|\\-:]\\s*$`, 'i'), '').trim();
  }

  output = output.replace(/\s*\|\s*by\s+.+$/i, '').trim();
  output = output.replace(/\s*[|:]\s*(medium|blog|techblog|engineering at .+)$/i, '').trim();
  return output;
}

function deriveBestTitle(
  articleTitle: string,
  document: Document,
  siteName: string,
): string {
  const candidates = [
    articleTitle,
    getMetaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']),
    document.querySelector('h1')?.textContent || '',
    document.title || '',
  ]
    .map((candidate) => normalizeCandidateTitle(candidate))
    .map((candidate) => stripTitleSuffixes(candidate, siteName))
    .filter(Boolean);

  const preferred = candidates.find((candidate) => candidate.split(/\s+/).length >= 3);
  return preferred || candidates[0] || 'Untitled Article';
}

function hasRenderErrorSignals(textContent: string, html: string): boolean {
  const haystack = `${textContent}\n${html}`.toLowerCase();
  return RENDER_ERROR_MARKERS.some((marker) => haystack.includes(marker));
}

function deriveMediumCustomDomainUrl(inputUrl: URL): string | null {
  if (!inputUrl.hostname.endsWith('.medium.com')) return null;

  const publication = inputUrl.hostname.replace(/\.medium\.com$/i, '').trim();
  if (!publication || publication.includes('.')) return null;

  const path = `${inputUrl.pathname}${inputUrl.search || ''}${inputUrl.hash || ''}`;
  return `https://${publication}.com${path}`;
}

export async function extractFromUrl(url: string, images: ImageMode): Promise<ExtractResponse> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      success: false,
      errorCode: 'FETCH_FAILED',
      errorMessage: 'Invalid URL. Provide a full URL including protocol.',
    };
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      success: false,
      errorCode: 'FETCH_FAILED',
      errorMessage: 'Only HTTP and HTTPS URLs are supported.',
    };
  }

  const mediumCustomDomainUrl = deriveMediumCustomDomainUrl(parsedUrl);
  if (mediumCustomDomainUrl) {
    const customDomainResult = await extractFromUrl(mediumCustomDomainUrl, images);
    if (customDomainResult.success) {
      return {
        ...customDomainResult,
        sourceUrl: parsedUrl.toString(),
      };
    }
  }

  try {
    let html = await fetchRenderedHtml(parsedUrl.toString());

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const dom = new JSDOM(html, { url: parsedUrl.toString() });

      try {
        const article = new Readability(dom.window.document).parse();

        if (!article) {
          return {
            success: false,
            errorCode: 'EXTRACTION_FAILED',
            errorMessage:
              "We reached the page but couldn't identify the main article content.",
          };
        }

        const textContent = normalizeExtractText(article.textContent);
        const wordCount = countWords(textContent);

        if (wordCount < 80 && hasRenderErrorSignals(textContent, html)) {
          if (attempt === 0) {
            html = await fetchRenderedHtml(parsedUrl.toString());
            continue;
          }

          return {
            success: false,
            errorCode: 'EXTRACTION_FAILED',
            errorMessage:
              "We reached the page but couldn't identify the main article content.",
          };
        }

        if (wordCount < 220 && hasPaywallSignals(`${html}\n${textContent}`)) {
          return {
            success: false,
            errorCode: 'PAYWALL_DETECTED',
            errorMessage:
              'This page appears to be behind a paywall or requires a login.',
          };
        }

        if (textContent.length < 100) {
          return {
            success: false,
            errorCode: 'EMPTY_CONTENT',
            errorMessage: 'The page loaded but contained no readable text content.',
          };
        }

        const cleanHtml = sanitizeHtml(article.content || '');
        const processedImages = await processImages(cleanHtml, images, parsedUrl.toString());
        const finalizedHtml = sanitizeHtml(processedImages.content);

        return {
          success: true,
          title: deriveBestTitle(
            normalizeExtractText(article.title),
            dom.window.document,
            normalizeExtractText(article.siteName),
          ),
          byline: normalizeExtractText(article.byline) || 'Unknown',
          siteName: normalizeExtractText(article.siteName) || 'Unknown',
          publishedTime: normalizeExtractText((article as { publishedTime?: string }).publishedTime) || 'Unknown',
          excerpt: normalizeExtractText(article.excerpt) || '',
          lang: normalizeExtractText((article as { lang?: string }).lang) || 'Unknown',
          content: finalizedHtml,
          textContent,
          wordCount,
          imageCount: processedImages.totalImages,
          sourceUrl: parsedUrl.toString(),
        };
      } finally {
        dom.window.close();
      }
    }

    return {
      success: false,
      errorCode: 'EXTRACTION_FAILED',
      errorMessage:
        "We reached the page but couldn't identify the main article content.",
    };
  } catch (error) {
    const maybeError = error as ExtractPipelineError;

    if (maybeError.code) {
      return {
        success: false,
        errorCode: maybeError.code,
        errorMessage: maybeError.message,
      };
    }

    return {
      success: false,
      errorCode: 'EXTRACTION_FAILED',
      errorMessage: 'Unexpected extraction error.',
    };
  }
}
