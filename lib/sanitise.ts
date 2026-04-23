import DOMPurify from 'isomorphic-dompurify';

const WINDOWS_RESERVED_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const MULTI_SPACE = /\s+/g;
const MULTI_HYPHEN = /-+/g;

function maybeClearWindow(): void {
  const clearWindow = (DOMPurify as unknown as { clearWindow?: () => void }).clearWindow;
  if (typeof clearWindow === 'function') {
    clearWindow();
  }
}

export function sanitizeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|ftp|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });

  maybeClearWindow();
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
    .replace(/^-|-$/g, '');

  const candidate = base.slice(0, 80).trim();
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
