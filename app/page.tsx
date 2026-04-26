'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { BatchUrlPanel, type BatchItemResult } from '@/components/BatchUrlPanel';
import { FailureModal } from '@/components/FailureModal';
import { ProgressIndicator } from '@/components/ProgressIndicator';
import { ReadingPreview } from '@/components/ReadingPreview';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { UrlInput } from '@/components/UrlInput';
import { UsageTrustRing } from '@/components/UsageTrustRing';
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

type PublicMetrics = {
  totalUsers: number;
  usersToday: number;
  usersLast7Days: number;
  totalTrackedSessions: number;
  excludedBotSessions: number;
  excludedLowQualitySessions: number;
  updatedAt: string;
};

type ExtractFailurePayload = {
  success: false;
  errorCode?: string;
  errorMessage?: string;
};

type BatchJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

type BatchJobApi = {
  id: string;
  status: Exclude<BatchJobStatus, 'idle'>;
  totalUrls: number;
  processedUrls: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type BatchItemApi = {
  url: string;
  status: 'pending' | 'running' | 'success' | 'failure';
  durationMs: number;
  extractionId: string | null;
  sourceUrl: string | null;
  title: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const BATCH_MAX_URLS = 50_000;
const BATCH_ESTIMATED_MS_PER_URL = 9_000;
const DOWNLOAD_ESTIMATED_MS_PER_URL: Record<ExportFormat, number> = {
  txt: 500,
  md: 650,
  docx: 2_000,
  pdf: 2_700,
};

function initialThemeFromSystem(): ReaderSettings['colorTheme'] {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function parseBatchUrls(value: string): string[] {
  const tokens = value
    .split(/[\s,;]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  const urls: string[] = [];

  for (const token of tokens) {
    try {
      const parsed = new URL(token);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        continue;
      }

      const normalized = parsed.toString();
      if (unique.has(normalized)) continue;

      unique.add(normalized);
      urls.push(normalized);
    } catch {
      continue;
    }
  }

  return urls;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function parseIsoMs(value: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
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

  const [publicMetrics, setPublicMetrics] = useState<PublicMetrics>({
    totalUsers: 0,
    usersToday: 0,
    usersLast7Days: 0,
    totalTrackedSessions: 0,
    excludedBotSessions: 0,
    excludedLowQualitySessions: 0,
    updatedAt: '',
  });
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [batchUrlsInput, setBatchUrlsInput] = useState('');
  const [batchFormat, setBatchFormat] = useState<ExportFormat>('pdf');
  const [batchDownloadingAll, setBatchDownloadingAll] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchItemResult[]>([]);
  const [batchJobId, setBatchJobId] = useState('');
  const [batchJobStatus, setBatchJobStatus] = useState<BatchJobStatus>('idle');
  const [batchProcessedCount, setBatchProcessedCount] = useState(0);
  const [batchTotalCount, setBatchTotalCount] = useState(0);
  const [batchSuccessCount, setBatchSuccessCount] = useState(0);
  const [batchFailureCount, setBatchFailureCount] = useState(0);
  const [batchEtaMs, setBatchEtaMs] = useState(0);
  const [batchRunMessage, setBatchRunMessage] = useState('');

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

  useEffect(() => {
    let active = true;

    async function loadPublicMetrics(): Promise<void> {
      try {
        const response = await fetch('/api/public-metrics');
        const json = (await response.json()) as {
          success: boolean;
          metrics?: PublicMetrics;
        };

        if (!active || !response.ok || !json.success || !json.metrics) return;
        setPublicMetrics(json.metrics);
      } catch {
        // Public metrics should never block UX.
      } finally {
        if (active) {
          setMetricsLoading(false);
        }
      }
    }

    void loadPublicMetrics();
    const interval = setInterval(() => {
      void loadPublicMetrics();
    }, 90_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const transformedContent = useMemo(() => {
    if (!result) return '';
    return result.contentVariants[images] || result.content;
  }, [images, result]);

  const parsedBatchUrls = useMemo(() => parseBatchUrls(batchUrlsInput), [batchUrlsInput]);

  const batchEstimatedTotalMs = useMemo(
    () => parsedBatchUrls.length * BATCH_ESTIMATED_MS_PER_URL,
    [parsedBatchUrls.length],
  );

  const batchDownloadEstimateMs = useMemo(() => {
    const count = batchSuccessCount > 0 ? batchSuccessCount : parsedBatchUrls.length;
    return count * DOWNLOAD_ESTIMATED_MS_PER_URL[batchFormat];
  }, [batchFormat, parsedBatchUrls.length, batchSuccessCount]);

  const batchProcessing = batchJobStatus === 'queued' || batchJobStatus === 'running';

  function buildHeaders(extra?: HeadersInit): HeadersInit {
    return {
      'Content-Type': 'application/json',
      ...(sessionIdRef.current ? { 'x-clearpage-session': sessionIdRef.current } : {}),
      ...(extra || {}),
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

      const json = (await response.json()) as ExtractSuccessResponse | ExtractFailurePayload;

      if (!response.ok || !json.success) {
        const errorCode = ((json as ExtractFailurePayload).errorCode || 'EXTRACTION_FAILED') as ExtractErrorCode;

        void trackClientEvent({
          eventName: 'extract_result',
          eventGroup: 'extract',
          status: 'failure',
          pagePath: '/',
          attemptedUrl: targetUrl,
          errorCode,
          errorMessage: (json as ExtractFailurePayload).errorMessage,
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
          images,
          extractionId: result.extractionId,
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

  async function loadBatchJob(jobId: string): Promise<void> {
    const response = await fetch(
      `/api/batch-jobs?jobId=${encodeURIComponent(jobId)}&limit=400&offset=0`,
      {
        headers: sessionIdRef.current ? { 'x-clearpage-session': sessionIdRef.current } : undefined,
      },
    );

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(raw || `Batch job lookup failed (${response.status}).`);
    }

    const json = (await response.json()) as {
      success: boolean;
      job: BatchJobApi;
      estimatedRemainingMs: number;
      items: BatchItemApi[];
    };

    if (!json.success || !json.job) {
      throw new Error('Batch job payload was not successful.');
    }

    setBatchJobStatus(json.job.status);
    setBatchProcessedCount(Number(json.job.processedUrls || 0));
    setBatchTotalCount(Number(json.job.totalUrls || 0));
    setBatchSuccessCount(Number(json.job.successCount || 0));
    setBatchFailureCount(Number(json.job.failureCount || 0));
    setBatchEtaMs(Math.max(0, Number(json.estimatedRemainingMs || 0)));

    const nextRows: BatchItemResult[] = (json.items || []).map((item) => ({
      url: item.url,
      status: item.status,
      durationMs: Number(item.durationMs || 0),
      extractionId: item.extractionId || undefined,
      sourceUrl: item.sourceUrl || undefined,
      title: item.title || undefined,
      errorCode: item.errorCode || undefined,
      errorMessage: item.errorMessage || undefined,
    }));

    setBatchResults(nextRows);

    const startedAtMs = parseIsoMs(json.job.startedAt);
    const completedAtMs = parseIsoMs(json.job.completedAt);

    if (json.job.status === 'completed') {
      const durationMs =
        startedAtMs > 0 && completedAtMs > startedAtMs
          ? completedAtMs - startedAtMs
          : Number(json.job.averageDurationMs || 0) * Number(json.job.processedUrls || 0);

      setBatchRunMessage(
        `Completed in ${formatDuration(durationMs)}. ${Number(json.job.successCount || 0).toLocaleString()} succeeded, ${Number(json.job.failureCount || 0).toLocaleString()} failed.`,
      );
    } else if (json.job.status === 'running' || json.job.status === 'queued') {
      setBatchRunMessage(
        `Processed ${Number(json.job.processedUrls || 0).toLocaleString()} of ${Number(json.job.totalUrls || 0).toLocaleString()} (${json.job.status}).`,
      );
    } else if (json.job.status === 'failed') {
      setBatchRunMessage('Batch job failed before completion.');
    }
  }

  useEffect(() => {
    if (!batchJobId) return;

    let active = true;

    async function poll(): Promise<void> {
      try {
        await loadBatchJob(batchJobId);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Failed to refresh batch job status.';
        setBatchRunMessage(message);
      }
    }

    void poll();

    const interval = setInterval(() => {
      if (!active) return;
      if (batchJobStatus === 'completed' || batchJobStatus === 'failed' || batchJobStatus === 'cancelled') {
        return;
      }

      void poll();
    }, 2200);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [batchJobId, batchJobStatus]);

  async function downloadBatchItem(row: BatchItemResult): Promise<void> {
    if (row.status !== 'success') return;

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          format: batchFormat,
          images,
          extractionId: row.extractionId,
          sourceUrl: row.sourceUrl || row.url,
          settings,
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(raw || `Export failed (${batchFormat}).`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
      const fallbackName = row.title ? row.title.replace(/\s+/g, '-').toLowerCase() : 'clearpage-batch';
      const filename = match?.[1] || `${fallbackName}.${batchFormat}`;
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
    }
  }

  async function getAllSuccessfulBatchRows(jobId: string): Promise<BatchItemResult[]> {
    const output: BatchItemResult[] = [];
    const limit = 1000;
    let offset = 0;
    let guard = 0;

    while (guard < 500) {
      const response = await fetch(
        `/api/batch-jobs?jobId=${encodeURIComponent(jobId)}&limit=${limit}&offset=${offset}`,
        {
          headers: sessionIdRef.current ? { 'x-clearpage-session': sessionIdRef.current } : undefined,
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to load batch rows (${response.status}).`);
      }

      const json = (await response.json()) as {
        success: boolean;
        job: BatchJobApi;
        items: BatchItemApi[];
      };

      if (!json.success) {
        throw new Error('Failed to load batch rows.');
      }

      const rows = (json.items || []).map((item) => ({
        url: item.url,
        status: item.status,
        durationMs: Number(item.durationMs || 0),
        extractionId: item.extractionId || undefined,
        sourceUrl: item.sourceUrl || undefined,
        title: item.title || undefined,
        errorCode: item.errorCode || undefined,
        errorMessage: item.errorMessage || undefined,
      }));

      output.push(...rows.filter((item) => item.status === 'success'));

      offset += rows.length;
      guard += 1;

      if (rows.length === 0 || offset >= Number(json.job.totalUrls || 0)) {
        break;
      }
    }

    return output;
  }

  async function handleDownloadAllBatch(): Promise<void> {
    if (!batchJobId || batchDownloadingAll) return;

    setBatchDownloadingAll(true);

    try {
      const rows = await getAllSuccessfulBatchRows(batchJobId);

      for (const row of rows) {
        await downloadBatchItem(row);
        await new Promise((resolve) => setTimeout(resolve, 160));
      }
    } catch (error) {
      setBatchRunMessage(error instanceof Error ? error.message : 'Failed to download batch files.');
    } finally {
      setBatchDownloadingAll(false);
    }
  }

  async function handleBatchSubmit(): Promise<void> {
    const urls = parsedBatchUrls;

    if (urls.length === 0) {
      setBatchRunMessage('Add at least one valid HTTP/HTTPS URL to start a batch.');
      return;
    }

    if (urls.length > BATCH_MAX_URLS) {
      setBatchRunMessage(`Batch limit exceeded. Max allowed is ${BATCH_MAX_URLS.toLocaleString()} URLs.`);
      return;
    }

    setBatchRunMessage('Submitting batch job...');
    setBatchResults([]);
    setBatchProcessedCount(0);
    setBatchTotalCount(urls.length);
    setBatchSuccessCount(0);
    setBatchFailureCount(0);
    setBatchEtaMs(urls.length * BATCH_ESTIMATED_MS_PER_URL);
    setBatchJobStatus('queued');

    void trackClientEvent({
      eventName: 'batch_extract_submit',
      eventGroup: 'extract',
      status: 'attempt',
      pagePath: '/',
      metadata: {
        count: urls.length,
        format: batchFormat,
        images,
      },
    });

    try {
      const response = await fetch('/api/batch-jobs', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          urls,
          format: batchFormat,
          images,
          settings,
        }),
      });

      const json = (await response.json()) as {
        success: boolean;
        error?: string;
        job?: {
          jobId: string;
          totalUrls: number;
          status: BatchJobStatus;
          estimatedProcessingMs: number;
        };
      };

      if (!response.ok || !json.success || !json.job) {
        throw new Error(json.error || 'Batch job creation failed.');
      }

      setBatchJobId(json.job.jobId);
      setBatchJobStatus((json.job.status as BatchJobStatus) || 'queued');
      setBatchTotalCount(Number(json.job.totalUrls || urls.length));
      setBatchEtaMs(Number(json.job.estimatedProcessingMs || 0));
      setBatchRunMessage(`Job queued (${json.job.jobId.slice(0, 8)}). Processing has started.`);

      await loadBatchJob(json.job.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Batch job creation failed.';
      setBatchRunMessage(message);
      setBatchJobStatus('failed');

      void trackClientEvent({
        eventName: 'batch_extract_result',
        eventGroup: 'extract',
        status: 'failure',
        pagePath: '/',
        errorCode: 'BATCH_JOB_CREATE_FAILED',
        errorMessage: message,
        metadata: {
          count: urls.length,
          format: batchFormat,
          images,
        },
      });
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
            trustWidget={
              <UsageTrustRing
                totalUsers={publicMetrics.totalUsers}
                usersToday={publicMetrics.usersToday}
                usersLast7Days={publicMetrics.usersLast7Days}
                totalTrackedSessions={publicMetrics.totalTrackedSessions}
                excludedBotSessions={publicMetrics.excludedBotSessions}
                excludedLowQualitySessions={publicMetrics.excludedLowQualitySessions}
                updatedAt={publicMetrics.updatedAt}
                loading={metricsLoading}
              />
            }
            batchPanel={
              <BatchUrlPanel
                urlsInput={batchUrlsInput}
                onUrlsInputChange={setBatchUrlsInput}
                onSubmit={() => void handleBatchSubmit()}
                format={batchFormat}
                onFormatChange={setBatchFormat}
                processing={batchProcessing}
                downloadingAll={batchDownloadingAll}
                jobId={batchJobId}
                parsedCount={parsedBatchUrls.length}
                maxUrls={BATCH_MAX_URLS}
                processedCount={batchProcessedCount}
                totalCount={batchTotalCount}
                successCount={batchSuccessCount}
                failureCount={batchFailureCount}
                etaText={formatDuration(batchEtaMs)}
                estimateText={formatDuration(batchEstimatedTotalMs)}
                downloadEstimateText={formatDuration(batchDownloadEstimateMs)}
                runMessage={batchRunMessage}
                results={batchResults}
                onDownloadOne={(row) => void downloadBatchItem(row)}
                onDownloadAll={() => void handleDownloadAllBatch()}
              />
            }
          />
          {extracting && (
            <div className="pointer-events-none absolute inset-x-0 top-[57%] mx-auto w-full max-w-xl px-6">
              <ProgressIndicator activeStep={progressStep} />
            </div>
          )}
        </div>
      ) : (
        <div
          className={`cp-shell cp-enter theme-${settings.colorTheme} flex min-h-screen flex-col md:h-screen md:flex-row`}
        >
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

          <main className="flex-1 overflow-hidden pb-20 md:h-screen md:pb-0">
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
