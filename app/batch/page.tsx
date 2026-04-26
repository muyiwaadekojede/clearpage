'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { BatchUrlPanel, type BatchItemResult } from '@/components/BatchUrlPanel';
import { getClientSessionId, trackClientEvent } from '@/lib/clientAnalytics';
import type { ExportFormat, ImageMode, ReaderSettings } from '@/lib/types';

type BatchJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

type BatchJobApi = {
  id: string;
  status: Exclude<BatchJobStatus, 'idle'>;
  totalUrls: number;
  processedUrls: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number | null;
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

const DEFAULT_SETTINGS: ReaderSettings = {
  fontFace: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  colorTheme: 'light',
};

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
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;

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
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function parseIsoMs(value: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export default function BatchPage() {
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

  const sessionIdRef = useRef('');
  const imagesRef = useRef<ImageMode>('on');

  useEffect(() => {
    sessionIdRef.current = getClientSessionId();

    void trackClientEvent({
      eventName: 'batch_page_opened',
      eventGroup: 'navigation',
      status: 'success',
      pagePath: '/batch',
    });
  }, []);

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

  function buildHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      ...(sessionIdRef.current ? { 'x-clearpage-session': sessionIdRef.current } : {}),
    };
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

      void trackClientEvent({
        eventName: 'batch_extract_result',
        eventGroup: 'extract',
        status: Number(json.job.failureCount || 0) > 0 ? 'failure' : 'success',
        pagePath: '/batch',
        metadata: {
          jobId: json.job.id,
          count: Number(json.job.totalUrls || 0),
          successCount: Number(json.job.successCount || 0),
          failureCount: Number(json.job.failureCount || 0),
          format: batchFormat,
        },
      });
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
      if (batchJobStatus === 'completed' || batchJobStatus === 'failed' || batchJobStatus === 'cancelled') return;
      void poll();
    }, 2200);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [batchJobId, batchJobStatus]);

  async function downloadBatchItem(row: BatchItemResult): Promise<void> {
    if (row.status !== 'success') return;

    const response = await fetch('/api/export', {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        format: batchFormat,
        images: imagesRef.current,
        extractionId: row.extractionId,
        sourceUrl: row.sourceUrl || row.url,
        settings: DEFAULT_SETTINGS,
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

      if (rows.length === 0 || offset >= Number(json.job.totalUrls || 0)) break;
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
      pagePath: '/batch',
      metadata: {
        count: urls.length,
        format: batchFormat,
        images: imagesRef.current,
      },
    });

    try {
      const response = await fetch('/api/batch-jobs', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          urls,
          format: batchFormat,
          images: imagesRef.current,
          settings: DEFAULT_SETTINGS,
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
    }
  }

  return (
    <main className="cp-shell cp-enter mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="logo-mark text-5xl font-semibold text-[var(--color-ink)]">Batch Workspace</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Dedicated large-run processing page. Homepage stays clean and focused.
          </p>
        </div>

        <Link
          href="/"
          className="rounded-lg border border-[var(--color-border)] bg-white/80 px-4 py-2 text-sm font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          Back to Homepage
        </Link>
      </div>

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
    </main>
  );
}
