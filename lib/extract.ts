import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { Agent as UndiciAgent } from 'undici';

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

const BOT_CHALLENGE_WEAK_MARKERS = [
  '__cf_chl_tk',
  'challenge-platform',
  'cf-browser-verification',
];

const BOT_CHALLENGE_STRONG_MARKERS = [
  'just a moment...',
  'checking your browser before accessing',
  'enable javascript and cookies to continue',
  'vercel security checkpoint',
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

const INSECURE_TLS_DISPATCHER = new UndiciAgent({
  connect: { rejectUnauthorized: false },
});

const FEED_FALLBACK_BY_HOST: Record<string, string[]> = {
  'hashicorp.com': ['https://www.hashicorp.com/blog/feed.xml'],
  'www.hashicorp.com': ['https://www.hashicorp.com/blog/feed.xml'],
  'supabase.com': ['https://supabase.com/rss.xml'],
  'www.supabase.com': ['https://supabase.com/rss.xml'],
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

function isTlsCertificateError(error: unknown): boolean {
  const maybeError = error as { cause?: { code?: string }; message?: string };
  const code = maybeError.cause?.code || '';
  if (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'CERT_HAS_EXPIRED'
  ) {
    return true;
  }

  const message = (maybeError.message || '').toLowerCase();
  return message.includes('certificate') && message.includes('verify');
}

function normalizeUrlForMatch(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.search = '';
    let pathname = parsed.pathname || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}`;
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, '');
  }
}

function decodeEscapedText(input: string): string {
  return input
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\\n/g, ' ')
    .replace(/\\\\r/g, ' ')
    .replace(/\\\\t/g, ' ')
    .replace(/\\\\\"/g, '"')
    .replace(/\\\\'/g, "'")
    .replace(/\\\\\//g, '/')
    .replace(/\\\\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const requestInitBase = {
    signal: controller.signal,
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...(referer ? { Referer: referer } : {}),
    },
  };

  try {
    return await fetch(url, requestInitBase);
  } catch (error) {
    if (!isTlsCertificateError(error)) {
      throw error;
    }

    const retryInit = requestInitBase as RequestInit & { dispatcher?: UndiciAgent };
    retryInit.dispatcher = INSECURE_TLS_DISPATCHER;
    return await fetch(url, retryInit);
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
    lowered.includes('placeholder') ||
    lowered.includes('blur') ||
    /\.max-\d+x\d+\./i.test(lowered) ||
    lowered === '#'
  );
}

function extractWidthHintFromUrl(url: string): number {
  const patterns = [
    /[._-]width-(\d{2,5})\b/i,
    /[?&]w=(\d{2,5})\b/i,
    /[._-](\d{2,5})x(\d{2,5})\b/i,
    /[._-]max-(\d{2,5})x(\d{2,5})\b/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (!match) continue;
    const width = Number(match[1] || 0);
    if (Number.isFinite(width) && width > 0) return width;
  }

  return 0;
}

function parseJsonImageCandidates(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];

    const urls: string[] = [];
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) {
        urls.push(value.trim());
      }
    }
    return urls;
  } catch {
    return [];
  }
}

async function fetchHtmlWithTimeout(url: string, timeoutMs: number): Promise<string> {
  async function fetchAttempt(timeout: number, insecureTls: boolean): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const requestInit = {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    } as RequestInit & { dispatcher?: UndiciAgent };

    if (insecureTls) {
      requestInit.dispatcher = INSECURE_TLS_DISPATCHER;
    }

    try {
      const response = await fetch(url, requestInit);

      if (!response.ok) {
        throw new ExtractPipelineError(
          'FETCH_FAILED',
          `Failed to reach URL (HTTP ${response.status}).`,
        );
      }

      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  try {
    return await fetchAttempt(timeoutMs, false);
  } catch (error) {
    const maybeError = error as { name?: string };

    if (isTlsCertificateError(error)) {
      try {
        return await fetchAttempt(timeoutMs, true);
      } catch (tlsRetryError) {
        if (tlsRetryError instanceof ExtractPipelineError) throw tlsRetryError;
        throw new ExtractPipelineError('FETCH_FAILED', 'Could not fetch the target URL.');
      }
    }

    if (maybeError?.name === 'AbortError') {
      try {
        return await fetchAttempt(timeoutMs + 15_000, false);
      } catch (retryError) {
        const retryMaybe = retryError as { name?: string };
        if (retryMaybe?.name === 'AbortError') {
          throw new ExtractPipelineError('TIMEOUT', 'The page took too long to load.');
        }
        if (retryError instanceof ExtractPipelineError) throw retryError;
        throw new ExtractPipelineError('FETCH_FAILED', 'Could not fetch the target URL.');
      }
    }

    if (error instanceof ExtractPipelineError) {
      throw error;
    }

    throw new ExtractPipelineError('FETCH_FAILED', 'Could not fetch the target URL.');
  }
}

function pickBestImageSource(candidates: string[]): string | null {
  if (candidates.length === 0) return null;

  const scored = candidates.map((candidate, index) => {
    const lowered = candidate.toLowerCase();
    let score = extractWidthHintFromUrl(candidate);

    if (isLikelyPlaceholder(candidate)) {
      score -= 10_000;
    }

    if (lowered.includes('desktop')) {
      score += 500;
    }

    // Prefer earlier candidates when quality signals are equal.
    score += Math.max(0, 100 - index);

    return { candidate, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.candidate || null;
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

  const jsonSources = [
    ...parseJsonImageCandidates(img.getAttribute('data-loading')),
    ...parseJsonImageCandidates(img.getAttribute('data-image')),
    ...parseJsonImageCandidates(img.getAttribute('data-sources')),
  ];

  const candidates = [dataSrcset, srcset, ...jsonSources, ...altSources, src]
    .map((value) => value?.trim() || '')
    .filter(Boolean);

  return pickBestImageSource(Array.from(new Set(candidates)));
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
        img.removeAttribute('srcset');
        img.removeAttribute('data-srcset');
        img.removeAttribute('data-loading');
        img.removeAttribute('data-image');
        img.removeAttribute('data-sources');
        img.removeAttribute('data-src');
        img.removeAttribute('data-original');
        img.removeAttribute('data-lazy-src');
        img.removeAttribute('data-url');
        img.removeAttribute('data-hi-res-src');
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

async function buildImageVariants(
  html: string,
  sourceUrl: string,
): Promise<{
  on: { content: string; totalImages: number; embeddedImages: number };
  off: { content: string; totalImages: number; embeddedImages: number };
  captions: { content: string; totalImages: number; embeddedImages: number };
}> {
  const [on, off, captions] = await Promise.all([
    processImages(html, 'on', sourceUrl),
    processImages(html, 'off', sourceUrl),
    processImages(html, 'captions', sourceUrl),
  ]);

  return { on, off, captions };
}

async function fetchRenderedHtml(url: string): Promise<string> {
  let context: any = null;

  try {
    const browser = await getBrowser();

    if (!browser) {
      return await fetchHtmlWithTimeout(url, 30_000);
    }

    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'accept-language': 'en-US,en;q=0.9',
      },
    });

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
      return await fetchHtmlWithTimeout(url, 30_000);
    }

    // Fallback for serverless environments where browser launch/context may fail.
    return await fetchHtmlWithTimeout(url, 30_000);
  } finally {
    if (context) {
      await context.close();
    }
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

function tokenizeTitle(value: string): string[] {
  return normalizeCandidateTitle(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function titlesAreRelated(a: string, b: string): boolean {
  const tokensA = tokenizeTitle(a);
  const tokensB = tokenizeTitle(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const setB = new Set(tokensB);
  const overlap = tokensA.filter((token) => setB.has(token)).length;
  const ratio = overlap / Math.max(tokensA.length, tokensB.length);
  return ratio >= 0.35;
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
  articleContentHtml: string,
  document: Document,
  siteName: string,
): string {
  let contentHeading = '';
  try {
    const contentDom = new JSDOM(articleContentHtml || '');
    const headingCandidates = Array.from(
      contentDom.window.document.querySelectorAll('h1, h2'),
    )
      .map((node) => normalizeCandidateTitle(node.textContent || ''))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    contentHeading = headingCandidates[0] || '';
    contentDom.window.close();
  } catch {
    contentHeading = '';
  }

  const labeledCandidates = [
    { source: 'content-heading', value: contentHeading, boost: 30 },
    { source: 'article', value: articleTitle, boost: 10 },
    {
      source: 'og',
      value: getMetaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']),
      boost: 20,
    },
    { source: 'h1', value: document.querySelector('h1')?.textContent || '', boost: 16 },
    { source: 'document', value: document.title || '', boost: 8 },
  ]
    .map((candidate) => ({
      ...candidate,
      value: stripTitleSuffixes(normalizeCandidateTitle(candidate.value), siteName),
    }))
    .filter((candidate) => candidate.value.length > 0);

  if (labeledCandidates.length === 0) return 'Untitled Article';
  const h1Title = normalizeCandidateTitle(document.querySelector('h1')?.textContent || '');

  const scored = labeledCandidates.map((candidate) => {
    const words = candidate.value.split(/\s+/).filter(Boolean).length;
    const chars = candidate.value.length;
    const genericPrefixPenalty =
      /^on\s+/i.test(candidate.value) && words <= 8
        ? -8
        : 0;
    const contentHeadingPenalty =
      candidate.source === 'content-heading' && h1Title && !titlesAreRelated(candidate.value, h1Title)
        ? -22
        : 0;

    return {
      ...candidate,
      score: candidate.boost + words * 4 + chars * 0.2 + genericPrefixPenalty + contentHeadingPenalty,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.value || 'Untitled Article';
}

function hasRenderErrorSignals(textContent: string, html: string): boolean {
  const haystack = `${textContent}\n${html}`.toLowerCase();
  return RENDER_ERROR_MARKERS.some((marker) => haystack.includes(marker));
}

function hasBotChallengeSignals(html: string): boolean {
  const haystack = html.toLowerCase();
  const strong = BOT_CHALLENGE_STRONG_MARKERS.some((marker) => haystack.includes(marker));
  const weakCount = BOT_CHALLENGE_WEAK_MARKERS.filter((marker) => haystack.includes(marker)).length;
  const hasReadableScaffold = /<article|<main|<h1/i.test(haystack) && haystack.length > 8_000;

  if (strong) return true;
  return weakCount >= 2 && !hasReadableScaffold;
}

function resolveFeedFallbackUrls(inputUrl: URL): string[] {
  return FEED_FALLBACK_BY_HOST[inputUrl.hostname.toLowerCase()] || [];
}

function getHostSiteName(inputUrl: URL): string {
  return inputUrl.hostname.replace(/^www\./i, '');
}

async function buildResponseFromFallbackContent(input: {
  sourceUrl: URL;
  images: ImageMode;
  title: string;
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  excerpt?: string;
  lang?: string;
  contentHtml: string;
}): Promise<ExtractResponse | null> {
  const cleanHtml = sanitizeHtml(input.contentHtml || '');
  if (!cleanHtml.trim()) return null;

  const textDom = new JSDOM(`<body>${cleanHtml}</body>`, { url: input.sourceUrl.toString() });
  let textContent = '';

  try {
    textContent = normalizeExtractText(textDom.window.document.body.textContent || '');
  } finally {
    textDom.window.close();
  }

  if (textContent.length < 100) {
    return null;
  }

  const variants = await buildImageVariants(cleanHtml, input.sourceUrl.toString());
  const finalizedVariants = {
    on: sanitizeHtml(variants.on.content),
    off: sanitizeHtml(variants.off.content),
    captions: sanitizeHtml(variants.captions.content),
  };

  return {
    success: true,
    title: normalizeExtractText(input.title) || 'Untitled Article',
    byline: normalizeExtractText(input.byline) || 'Unknown',
    siteName: normalizeExtractText(input.siteName) || getHostSiteName(input.sourceUrl),
    publishedTime: normalizeExtractText(input.publishedTime) || 'Unknown',
    excerpt: normalizeExtractText(input.excerpt) || '',
    lang: normalizeExtractText(input.lang) || 'Unknown',
    content: finalizedVariants[input.images],
    contentVariants: finalizedVariants,
    textContent,
    wordCount: countWords(textContent),
    imageCount: variants.on.totalImages,
    sourceUrl: input.sourceUrl.toString(),
  };
}

async function trySyndicationFallback(url: URL, images: ImageMode): Promise<ExtractResponse | null> {
  const feedUrls = resolveFeedFallbackUrls(url);
  if (feedUrls.length === 0) return null;

  const targetNormalized = normalizeUrlForMatch(url.toString());

  for (const feedUrl of feedUrls) {
    let feedXml = '';
    try {
      feedXml = await fetchHtmlWithTimeout(feedUrl, 20_000);
    } catch {
      continue;
    }

    const xmlDom = new JSDOM(feedXml, { contentType: 'text/xml', url: feedUrl });
    try {
      const entries = Array.from(xmlDom.window.document.querySelectorAll('entry, item'));
      for (const entry of entries) {
        const atomLink = entry.querySelector('link[href]')?.getAttribute('href')?.trim() || '';
        const rssLink = entry.querySelector('link')?.textContent?.trim() || '';
        const guidLink = entry.querySelector('guid')?.textContent?.trim() || '';
        const idLink = entry.querySelector('id')?.textContent?.trim() || '';
        const candidateLinks = [atomLink, rssLink, guidLink, idLink].filter(Boolean);

        const matchedLink = candidateLinks.find((candidate) => {
          const normalizedCandidate = normalizeUrlForMatch(candidate);
          if (normalizedCandidate === targetNormalized) return true;

          try {
            const candidateUrl = new URL(candidate);
            return candidateUrl.pathname === url.pathname;
          } catch {
            return false;
          }
        });

        if (!matchedLink) continue;

        const contentEncoded =
          entry.querySelector('content')?.textContent ||
          entry.getElementsByTagName('content:encoded')[0]?.textContent ||
          entry.querySelector('description')?.textContent ||
          entry.querySelector('summary')?.textContent ||
          '';

        const fallbackResponse = await buildResponseFromFallbackContent({
          sourceUrl: url,
          images,
          title: entry.querySelector('title')?.textContent || 'Untitled Article',
          byline:
            entry.querySelector('author > name')?.textContent ||
            entry.querySelector('dc\\:creator')?.textContent ||
            '',
          siteName: getHostSiteName(url),
          publishedTime:
            entry.querySelector('updated')?.textContent ||
            entry.querySelector('published')?.textContent ||
            entry.querySelector('pubDate')?.textContent ||
            '',
          excerpt:
            entry.querySelector('summary')?.textContent ||
            entry.querySelector('description')?.textContent ||
            '',
          lang: xmlDom.window.document.documentElement.getAttribute('xml:lang') || 'Unknown',
          contentHtml: contentEncoded,
        });

        if (fallbackResponse?.success) {
          return fallbackResponse;
        }
      }
    } finally {
      xmlDom.window.close();
    }
  }

  return null;
}

async function tryRscPayloadFallback(
  html: string,
  url: URL,
  images: ImageMode,
): Promise<ExtractResponse | null> {
  if (!html.includes('self.__next_f.push')) return null;

  const rawSegments = Array.from(
    html.matchAll(/children:\s*\\\"([^\\\"]{20,})\\\"/g),
    (match) => decodeEscapedText(match[1]),
  ).filter(Boolean);

  if (rawSegments.length < 5) return null;

  const uniqueSegments: string[] = [];
  const seen = new Set<string>();
  for (const segment of rawSegments) {
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSegments.push(segment);
  }

  const combinedText = normalizeExtractText(uniqueSegments.join(' '));
  if (countWords(combinedText) < 180) return null;

  const contentHtml = uniqueSegments.map((segment) => `<p>${escapeHtml(segment)}</p>`).join('\n');
  const dom = new JSDOM(html, { url: url.toString() });

  try {
    const title =
      getMetaContent(dom.window.document, ['meta[property="og:title"]']) ||
      dom.window.document.title ||
      'Untitled Article';
    const siteName =
      getMetaContent(dom.window.document, ['meta[property="og:site_name"]']) ||
      getHostSiteName(url);
    const excerpt = getMetaContent(dom.window.document, ['meta[property="og:description"]']);

    return await buildResponseFromFallbackContent({
      sourceUrl: url,
      images,
      title,
      siteName,
      excerpt,
      contentHtml,
    });
  } finally {
    dom.window.close();
  }
}

function deriveMediumCustomDomainUrls(inputUrl: URL): string[] {
  if (!inputUrl.hostname.endsWith('.medium.com')) return [];

  const publication = inputUrl.hostname.replace(/\.medium\.com$/i, '').trim();
  if (!publication || publication.includes('.')) return [];

  const path = `${inputUrl.pathname}${inputUrl.search || ''}${inputUrl.hash || ''}`;
  const base = `https://${publication}.com`;
  const candidates = [new URL(path, base).toString()];

  if (!inputUrl.pathname.endsWith('/')) {
    const withSlashPath = `${inputUrl.pathname}/${inputUrl.search || ''}${inputUrl.hash || ''}`;
    candidates.unshift(new URL(withSlashPath, base).toString());
  }

  return Array.from(new Set(candidates));
}

function deriveMediumPublicationFallbackUrls(inputUrl: URL): string[] {
  const host = inputUrl.hostname.toLowerCase();
  const likelyPublications = ['netflixtechblog.com'];

  if (!likelyPublications.includes(host)) return [];

  const mediumHost = host.replace(/\.com$/i, '.medium.com');
  const path = `${inputUrl.pathname}${inputUrl.search || ''}${inputUrl.hash || ''}`;
  const candidates = [new URL(path, `https://${mediumHost}`).toString()];

  if (!inputUrl.pathname.endsWith('/')) {
    candidates.unshift(new URL(`${inputUrl.pathname}/${inputUrl.search || ''}${inputUrl.hash || ''}`, `https://${mediumHost}`).toString());
  }

  return Array.from(new Set(candidates));
}

export async function extractFromUrl(
  url: string,
  images: ImageMode,
  visitedUrls?: Set<string>,
): Promise<ExtractResponse> {
  let parsedUrl: URL;
  const visited = visitedUrls ?? new Set<string>();

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

  const normalizedUrl = parsedUrl.toString();
  if (visited.has(normalizedUrl)) {
    return {
      success: false,
      errorCode: 'FETCH_FAILED',
      errorMessage: 'This URL could not be reached. It may be offline, private, or blocking automated requests.',
    };
  }
  visited.add(normalizedUrl);

  const mediumCustomDomainUrls = deriveMediumCustomDomainUrls(parsedUrl);
  if (mediumCustomDomainUrls.length > 0) {
    for (const candidate of mediumCustomDomainUrls) {
      const customDomainResult = await extractFromUrl(candidate, images, visited);
      if (customDomainResult.success) {
        return {
          ...customDomainResult,
          sourceUrl: parsedUrl.toString(),
        };
      }
    }
  }

  const mediumPublicationFallbackUrls = deriveMediumPublicationFallbackUrls(parsedUrl);
  if (mediumPublicationFallbackUrls.length > 0) {
    for (const candidate of mediumPublicationFallbackUrls) {
      const mediumResult = await extractFromUrl(candidate, images, visited);
      if (mediumResult.success) {
        return {
          ...mediumResult,
          sourceUrl: parsedUrl.toString(),
        };
      }
    }
  }

  try {
    let html = await fetchRenderedHtml(parsedUrl.toString());
    if (hasBotChallengeSignals(html)) {
      const syndicationFallback = await trySyndicationFallback(parsedUrl, images);
      if (syndicationFallback) {
        return syndicationFallback;
      }

      return {
        success: false,
        errorCode: 'FETCH_FAILED',
        errorMessage: 'This URL could not be reached. It may be offline, private, or blocking automated requests.',
      };
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const dom = new JSDOM(html, { url: parsedUrl.toString() });

      try {
        const article = new Readability(dom.window.document).parse();

        if (!article) {
          const rscFallback = await tryRscPayloadFallback(html, parsedUrl, images);
          if (rscFallback) {
            return rscFallback;
          }

          const syndicationFallback = await trySyndicationFallback(parsedUrl, images);
          if (syndicationFallback) {
            return syndicationFallback;
          }

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
          const rscFallback = await tryRscPayloadFallback(html, parsedUrl, images);
          if (rscFallback) {
            return rscFallback;
          }

          const syndicationFallback = await trySyndicationFallback(parsedUrl, images);
          if (syndicationFallback) {
            return syndicationFallback;
          }

          return {
            success: false,
            errorCode: 'EMPTY_CONTENT',
            errorMessage: 'The page loaded but contained no readable text content.',
          };
        }

        const cleanHtml = sanitizeHtml(article.content || '');
        const variants = await buildImageVariants(cleanHtml, parsedUrl.toString());
        const finalizedVariants = {
          on: sanitizeHtml(variants.on.content),
          off: sanitizeHtml(variants.off.content),
          captions: sanitizeHtml(variants.captions.content),
        };
        const imageCount = variants.on.totalImages;

        return {
          success: true,
          title: deriveBestTitle(
            normalizeExtractText(article.title),
            article.content || '',
            dom.window.document,
            normalizeExtractText(article.siteName),
          ),
          byline: normalizeExtractText(article.byline) || 'Unknown',
          siteName: normalizeExtractText(article.siteName) || 'Unknown',
          publishedTime: normalizeExtractText((article as { publishedTime?: string }).publishedTime) || 'Unknown',
          excerpt: normalizeExtractText(article.excerpt) || '',
          lang: normalizeExtractText((article as { lang?: string }).lang) || 'Unknown',
          content: finalizedVariants[images],
          contentVariants: finalizedVariants,
          textContent,
          wordCount,
          imageCount,
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
    const fallbackCodes: ExtractErrorCode[] = ['FETCH_FAILED', 'TIMEOUT', 'EXTRACTION_FAILED'];
    if (maybeError?.code && fallbackCodes.includes(maybeError.code)) {
      const syndicationFallback = await trySyndicationFallback(parsedUrl, images);
      if (syndicationFallback) {
        return syndicationFallback;
      }
    }

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
