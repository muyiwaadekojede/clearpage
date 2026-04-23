'use client';

import DOMPurify from 'isomorphic-dompurify';
import { useMemo } from 'react';

import type { ReaderSettings } from '@/lib/types';

function fontFamily(fontFace: ReaderSettings['fontFace']): string {
  if (fontFace === 'serif') return "'Source Serif 4', Georgia, 'Times New Roman', serif";
  if (fontFace === 'monospace') return "'IBM Plex Mono', 'Fira Code', Consolas, monospace";
  if (fontFace === 'dyslexic') return "'OpenDyslexic', 'Atkinson Hyperlegible', Arial, sans-serif";
  return "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif";
}

type ReadingPreviewProps = {
  content: string;
  settings: ReaderSettings;
};

export function ReadingPreview({ content, settings }: ReadingPreviewProps) {
  const safeHtml = useMemo(() => DOMPurify.sanitize(content), [content]);
  const themeClass = `theme-${settings.colorTheme}`;

  return (
    <section className={`h-full overflow-y-auto ${themeClass}`} aria-label="Reading preview">
      <div className="min-h-full bg-[var(--preview-bg)] px-6 py-8 md:px-10">
        <article
          className="reading-prose mx-auto w-full max-w-[720px] rounded-2xl border border-[var(--preview-border)] bg-[var(--preview-panel)] p-6 text-[var(--preview-text)] md:p-10"
          style={{
            fontFamily: fontFamily(settings.fontFace),
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineSpacing,
          }}
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    </section>
  );
}
