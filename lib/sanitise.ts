const WINDOWS_RESERVED_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const MULTI_SPACE = /\s+/g;
const MULTI_HYPHEN = /-+/g;

type DomPurifyShape = {
  sanitize: (html: string, options?: unknown) => string;
  clearWindow?: () => void;
};

let domPurifyRef: DomPurifyShape | null | undefined;

function getDomPurify(): DomPurifyShape | null {
  if (domPurifyRef !== undefined) {
    return domPurifyRef;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    domPurifyRef = require('isomorphic-dompurify') as DomPurifyShape;
  } catch (error) {
    console.error('DOMPurify require failed, falling back to passthrough sanitization:', error);
    domPurifyRef = null;
  }

  return domPurifyRef;
}

function maybeClearWindow(purifier: DomPurifyShape): void {
  const clearWindow = purifier.clearWindow;
  if (typeof clearWindow === 'function') {
    clearWindow();
  }
}

export function sanitizeHtml(html: string): string {
  const purifier = getDomPurify();
  if (!purifier) {
    return html;
  }

  const clean = purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|ftp|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });

  maybeClearWindow(purifier);
  return clean;
}

export function sanitizeFilename(title: string, fallback = 'clearpage-export'): string {
  const normalizedTitle = (title || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const base = normalizedTitle
    .replace(WINDOWS_RESERVED_CHARS, '')
    .replace(/[^\w\s\-().,&']/g, '')
    .replace(MULTI_SPACE, '-')
    .replace(MULTI_HYPHEN, '-')
    .replace(/^-|-$/g, '')
    .replace(/[.\s]+$/g, '');

  // Keep full readable titles by default while staying under practical OS filename limits.
  const candidate = base.slice(0, 220).trim();
  return candidate.length > 0 ? candidate : fallback;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
