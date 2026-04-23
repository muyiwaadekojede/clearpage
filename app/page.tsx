'use client';

import { useEffect, useMemo, useState } from 'react';

import { FailureModal } from '@/components/FailureModal';
import { ProgressIndicator } from '@/components/ProgressIndicator';
import { ReadingPreview } from '@/components/ReadingPreview';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { UrlInput } from '@/components/UrlInput';
import type {
  ExportFormat,
  ExtractErrorCode,
  ExtractSuccessResponse,
  ImageMode,
  ReaderSettings,
} from '@/lib/types';

type FailureState = {
  errorCode: ExtractErrorCode;
  url: string;
};

function applyImageModeToHtml(content: string, imageMode: ImageMode): string {
  if (imageMode === 'on') return content;

  const parser = new DOMParser();
  const document = parser.parseFromString(content, 'text/html');
  const images = Array.from(document.querySelectorAll('img'));

  if (imageMode === 'off') {
    for (const img of images) img.remove();
    return document.body.innerHTML;
  }

  for (const img of images) {
    const em = document.createElement('em');
    const alt = img.getAttribute('alt')?.trim() || 'image unavailable';
    em.textContent = `[Image: ${alt}]`;
    img.replaceWith(em);
  }

  return document.body.innerHTML;
}

function initialThemeFromSystem(): ReaderSettings['colorTheme'] {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontFace: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  colorTheme: 'light',
};

export default function Page() {
  const [url, setUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [images, setImages] = useState<ImageMode>('on');
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<ExtractSuccessResponse | null>(null);
  const [failure, setFailure] = useState<FailureState | null>(null);
  const [exporting, setExporting] = useState<Partial<Record<ExportFormat, boolean>>>({});

  useEffect(() => {
    setSettings((current) => ({ ...current, colorTheme: initialThemeFromSystem() }));
  }, []);

  const transformedContent = useMemo(() => {
    if (!result) return '';
    return applyImageModeToHtml(result.content, images);
  }, [images, result]);

  async function handleExtract(): Promise<void> {
    const targetUrl = url.trim();
    if (!targetUrl) return;

    setExtracting(true);
    setFailure(null);
    setProgressStep(0);

    const timer = setInterval(() => {
      setProgressStep((current) => Math.min(current + 1, 2));
    }, 1300);

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, images: 'on' }),
      });

      const json = (await response.json()) as
        | ExtractSuccessResponse
        | { success: false; errorCode: ExtractErrorCode; errorMessage: string };

      if (!response.ok || !json.success) {
        const errorCode = (json as { errorCode?: ExtractErrorCode }).errorCode || 'EXTRACTION_FAILED';
        setFailure({ errorCode, url: targetUrl });
        setResult(null);
        return;
      }

      setProgressStep(3);
      setResult(json);
    } catch (error) {
      console.error(error);
      setFailure({ errorCode: 'EXTRACTION_FAILED', url: targetUrl });
      setResult(null);
    } finally {
      clearInterval(timer);
      setExtracting(false);
    }
  }

  async function handleExport(format: ExportFormat): Promise<void> {
    if (!result) return;

    setExporting((current) => ({ ...current, [format]: true }));

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          content: transformedContent,
          textContent: result.textContent,
          title: result.title,
          byline: result.byline,
          siteName: result.siteName,
          publishedTime: result.publishedTime,
          sourceUrl: result.sourceUrl,
          settings,
        }),
      });

      if (!response.ok) {
        throw new Error(`Export failed (${format}).`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
      const filename = match?.[1] || `clearpage-export.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error(error);
    } finally {
      setExporting((current) => ({ ...current, [format]: false }));
    }
  }

  function resetState(): void {
    setResult(null);
    setFailure(null);
    setUrl('');
    setImages('on');
    setSettings((current) => ({ ...DEFAULT_SETTINGS, colorTheme: current.colorTheme }));
    setProgressStep(0);
  }

  return (
    <>
      {!result ? (
        <div className="relative">
          <UrlInput url={url} onUrlChange={setUrl} onSubmit={() => void handleExtract()} loading={extracting} />
          {extracting && (
            <div className="pointer-events-none absolute inset-x-0 top-[60%] mx-auto w-full max-w-xl px-6">
              <ProgressIndicator activeStep={progressStep} />
            </div>
          )}
        </div>
      ) : (
        <div className={`cp-shell cp-enter theme-${settings.colorTheme} flex min-h-screen flex-col md:flex-row`}>
          <SettingsSidebar
            title={result.title}
            byline={result.byline}
            siteName={result.siteName}
            publishedTime={result.publishedTime}
            wordCount={result.wordCount}
            imageCount={result.imageCount}
            images={images}
            onImagesChange={setImages}
            settings={settings}
            onSettingsChange={setSettings}
            onExport={(format) => void handleExport(format)}
            exporting={exporting}
            onNewUrl={resetState}
          />

          <main className="flex-1 overflow-hidden pb-20 md:pb-0">
            <ReadingPreview content={transformedContent} settings={settings} />
          </main>
        </div>
      )}

      {failure ? (
        <FailureModal
          open={true}
          errorCode={failure.errorCode}
          failedUrl={failure.url}
          onClose={() => setFailure(null)}
        />
      ) : null}
    </>
  );
}
