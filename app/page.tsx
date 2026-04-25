'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { FailureModal } from '@/components/FailureModal';
import { ProgressIndicator } from '@/components/ProgressIndicator';
import { ReadingPreview } from '@/components/ReadingPreview';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { UrlInput } from '@/components/UrlInput';
import { getClientSessionId, trackClientEvent } from '@/lib/clientAnalytics';
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
  const sessionIdRef = useRef<string>('');

  useEffect(() => {
    setSettings((current) => ({ ...current, colorTheme: initialThemeFromSystem() }));

    sessionIdRef.current = getClientSessionId();
    void trackClientEvent({
      eventName: 'page_view',
      eventGroup: 'navigation',
      status: 'success',
      pagePath: '/',
      metadata: {
        href: window.location.href,
      },
    });
  }, []);

  const transformedContent = useMemo(() => {
    if (!result) return '';
    return result.contentVariants[images] || result.content;
  }, [images, result]);

  function buildHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      ...(sessionIdRef.current ? { 'x-clearpage-session': sessionIdRef.current } : {}),
    };
  }

  async function handleExtract(urlValue?: string): Promise<void> {
    const targetUrl = (urlValue ?? url).trim();

    if (!targetUrl) {
      void trackClientEvent({
        eventName: 'extract_submit',
        eventGroup: 'extract',
        status: 'failure',
        pagePath: '/',
        errorCode: 'EMPTY_URL',
        errorMessage: 'User attempted extract without a URL.',
      });
      return;
    }

    void trackClientEvent({
      eventName: 'extract_submit',
      eventGroup: 'extract',
      status: 'attempt',
      pagePath: '/',
      attemptedUrl: targetUrl,
      metadata: {
        images,
      },
    });

    setExtracting(true);
    setFailure(null);
    setProgressStep(0);

    const timer = setInterval(() => {
      setProgressStep((current) => Math.min(current + 1, 2));
    }, 1300);

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ url: targetUrl, images }),
      });

      const json = (await response.json()) as
        | ExtractSuccessResponse
        | { success: false; errorCode: ExtractErrorCode; errorMessage: string };

      if (!response.ok || !json.success) {
        const errorCode = (json as { errorCode?: ExtractErrorCode }).errorCode || 'EXTRACTION_FAILED';

        void trackClientEvent({
          eventName: 'extract_result',
          eventGroup: 'extract',
          status: 'failure',
          pagePath: '/',
          attemptedUrl: targetUrl,
          errorCode,
          errorMessage: (json as { errorMessage?: string }).errorMessage,
        });

        setFailure({ errorCode, url: targetUrl });
        setResult(null);
        return;
      }

      void trackClientEvent({
        eventName: 'extract_result',
        eventGroup: 'extract',
        status: 'success',
        pagePath: '/',
        attemptedUrl: targetUrl,
        sourceUrl: json.sourceUrl,
        metadata: {
          title: json.title,
          siteName: json.siteName,
          wordCount: json.wordCount,
          imageCount: json.imageCount,
        },
      });

      setProgressStep(3);
      setResult(json);
    } catch (error) {
      void trackClientEvent({
        eventName: 'extract_result',
        eventGroup: 'extract',
        status: 'failure',
        pagePath: '/',
        attemptedUrl: targetUrl,
        errorCode: 'CLIENT_REQUEST_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Client extraction request failed.',
      });
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

    void trackClientEvent({
      eventName: 'export_submit',
      eventGroup: 'export',
      status: 'attempt',
      pagePath: '/',
      sourceUrl: result.sourceUrl,
      exportFormat: format,
      metadata: {
        title: result.title,
      },
    });

    setExporting((current) => ({ ...current, [format]: true }));

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: buildHeaders(),
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
        const raw = await response.text();
        throw new Error(raw || `Export failed (${format}).`);
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

      void trackClientEvent({
        eventName: 'export_result',
        eventGroup: 'export',
        status: 'success',
        pagePath: '/',
        sourceUrl: result.sourceUrl,
        exportFormat: format,
        metadata: {
          filename,
        },
      });
    } catch (error) {
      void trackClientEvent({
        eventName: 'export_result',
        eventGroup: 'export',
        status: 'failure',
        pagePath: '/',
        sourceUrl: result.sourceUrl,
        exportFormat: format,
        errorCode: 'CLIENT_EXPORT_ERROR',
        errorMessage: error instanceof Error ? error.message : `Export failed (${format}).`,
      });
      console.error(error);
    } finally {
      setExporting((current) => ({ ...current, [format]: false }));
    }
  }

  function handleImagesChange(value: ImageMode): void {
    setImages(value);
    void trackClientEvent({
      eventName: 'image_mode_changed',
      eventGroup: 'settings',
      status: 'success',
      pagePath: '/',
      metadata: {
        value,
      },
    });
  }

  function handleSettingsChange(next: ReaderSettings): void {
    const changed: Partial<Record<keyof ReaderSettings, { from: string | number; to: string | number }>> = {};

    for (const key of Object.keys(next) as Array<keyof ReaderSettings>) {
      if (settings[key] !== next[key]) {
        changed[key] = {
          from: settings[key],
          to: next[key],
        };
      }
    }

    setSettings(next);

    if (Object.keys(changed).length > 0) {
      void trackClientEvent({
        eventName: 'reader_settings_changed',
        eventGroup: 'settings',
        status: 'success',
        pagePath: '/',
        metadata: changed,
      });
    }
  }

  function resetState(): void {
    setResult(null);
    setFailure(null);
    setUrl('');
    setImages('on');
    setSettings((current) => ({ ...DEFAULT_SETTINGS, colorTheme: current.colorTheme }));
    setProgressStep(0);

    void trackClientEvent({
      eventName: 'new_url_clicked',
      eventGroup: 'navigation',
      status: 'success',
      pagePath: '/',
    });
  }

  return (
    <>
      {!result ? (
        <div className="relative">
          <UrlInput
            url={url}
            onUrlChange={setUrl}
            onSubmit={(submittedUrl) => void handleExtract(submittedUrl)}
            loading={extracting}
          />
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
            onImagesChange={handleImagesChange}
            settings={settings}
            onSettingsChange={handleSettingsChange}
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
          sessionId={sessionIdRef.current}
          onSubmitted={() => {
            void trackClientEvent({
              eventName: 'feedback_form_submitted',
              eventGroup: 'feedback',
              status: 'success',
              pagePath: '/',
              attemptedUrl: failure.url,
              errorCode: failure.errorCode,
            });
          }}
          onClose={() => setFailure(null)}
        />
      ) : null}
    </>
  );
}
