'use client';

import Link from 'next/link';
import { upload } from '@vercel/blob/client';
import { useEffect, useMemo, useRef, useState } from 'react';

import { BatchDocumentPanel, type DocumentUploadItem } from '@/components/BatchDocumentPanel';
import { BatchUrlPanel, type BatchItemResult } from '@/components/BatchUrlPanel';
import { getClientSessionId, trackClientEvent } from '@/lib/clientAnalytics';
import type { BatchInputMode, ExportFormat, ImageMode, ReaderSettings } from '@/lib/types';

type BatchJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

type BatchJobApi = {
  id: string;
  status: Exclude<BatchJobStatus, 'idle'>;
  inputMode: BatchInputMode;
  totalUrls: number;
  processedUrls: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
};

type BatchItemApi = {
  id: number;
  url: string;
  status: 'pending' | 'running' | 'success' | 'failure';
  durationMs: number;
  extractionId: string | null;
  sourceUrl: string | null;
  title: string | null;
  originalFilename: string | null;
  contentType: string | null;
  byteSize: number | null;
  sourceObjectKey: string | null;
  outputObjectKey: string | null;
  outputFilename: string | null;
  outputFormat: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type UploadConfig = {
  success: boolean;
  mode: 'blob' | 'filesystem';
  accept: string;
  limits: {
    maxFileBytes: number;
    maxFiles: number;
    maxBatchBytes: number;
    retentionHours: number;
  };
};

type UploadedDocumentRef = {
  uploadId: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

type DocumentUploadEntry = DocumentUploadItem & {
  file: File;
  uploadRef?: UploadedDocumentRef;
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
const DEFAULT_UPLOAD_CONFIG: UploadConfig = {
  success: true,
  mode: 'filesystem',
  accept: '.pdf,.docx,.txt,.md,.html,.htm,.csv,.tsv,.json,.xml,.yaml,.yml,.log,.rst',
  limits: {
    maxFileBytes: 60 * 1024 * 1024,
    maxFiles: 500,
    maxBatchBytes: 2 * 1024 * 1024 * 1024,
    retentionHours: 24,
  },
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function parseIsoMs(value: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file';
}

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  const contentDisposition = header || '';
  const match = contentDisposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function mapBatchItem(item: BatchItemApi): BatchItemResult {
  return {
    id: item.id,
    url: item.url,
    status: item.status,
    durationMs: Number(item.durationMs || 0),
    extractionId: item.extractionId || undefined,
    sourceUrl: item.sourceUrl || undefined,
    title: item.title || undefined,
    originalFilename: item.originalFilename || undefined,
    contentType: item.contentType || undefined,
    byteSize: item.byteSize === null || item.byteSize === undefined ? undefined : Number(item.byteSize),
    sourceObjectKey: item.sourceObjectKey || undefined,
    outputObjectKey: item.outputObjectKey || undefined,
    outputFilename: item.outputFilename || undefined,
    outputFormat: item.outputFormat || undefined,
    errorCode: item.errorCode || undefined,
    errorMessage: item.errorMessage || undefined,
  };
}

export default function BatchPage() {
  const [mode, setMode] = useState<BatchInputMode>('url');
  const [uploadConfig, setUploadConfig] = useState<UploadConfig>(DEFAULT_UPLOAD_CONFIG);

  const [batchUrlsInput, setBatchUrlsInput] = useState('');
  const [batchFormat, setBatchFormat] = useState<ExportFormat>('md');
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

  const [documentFormat, setDocumentFormat] = useState<ExportFormat>('pdf');
  const [documentUploads, setDocumentUploads] = useState<DocumentUploadEntry[]>([]);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentDownloadingAll, setDocumentDownloadingAll] = useState(false);
  const [documentResults, setDocumentResults] = useState<BatchItemResult[]>([]);
  const [documentJobId, setDocumentJobId] = useState('');
  const [documentJobStatus, setDocumentJobStatus] = useState<BatchJobStatus>('idle');
  const [documentProcessedCount, setDocumentProcessedCount] = useState(0);
  const [documentTotalCount, setDocumentTotalCount] = useState(0);
  const [documentSuccessCount, setDocumentSuccessCount] = useState(0);
  const [documentFailureCount, setDocumentFailureCount] = useState(0);
  const [documentEtaMs, setDocumentEtaMs] = useState(0);
  const [documentRunMessage, setDocumentRunMessage] = useState('');

  const sessionIdRef = useRef('');
  const imagesRef = useRef<ImageMode>('off');

  useEffect(() => {
    sessionIdRef.current = getClientSessionId();

    void trackClientEvent({
      eventName: 'batch_page_opened',
      eventGroup: 'navigation',
      status: 'success',
      pagePath: '/batch',
    });

    void (async () => {
      try {
        const response = await fetch('/api/batch-upload-config');
        if (!response.ok) return;
        const json = (await response.json()) as UploadConfig;
        if (json.success) {
          setUploadConfig(json);
        }
      } catch {
        // Fallback config is good enough for local rendering.
      }
    })();
  }, []);

  const parsedBatchUrls = useMemo(() => parseBatchUrls(batchUrlsInput), [batchUrlsInput]);

  const batchDownloadEstimateMs = useMemo(() => {
    const count = batchSuccessCount > 0 ? batchSuccessCount : parsedBatchUrls.length;
    return count * DOWNLOAD_ESTIMATED_MS_PER_URL[batchFormat];
  }, [batchFormat, parsedBatchUrls.length, batchSuccessCount]);

  const documentDownloadEstimateMs = useMemo(() => {
    const count = documentSuccessCount > 0 ? documentSuccessCount : documentUploads.length;
    return count * DOWNLOAD_ESTIMATED_MS_PER_URL[documentFormat];
  }, [documentFormat, documentSuccessCount, documentUploads.length]);

  const batchProcessing = batchJobStatus === 'queued' || batchJobStatus === 'running';
  const documentProcessing = documentJobStatus === 'queued' || documentJobStatus === 'running';

  function buildHeaders(): HeadersInit {
    return sessionIdRef.current ? { 'x-clearpage-session': sessionIdRef.current } : {};
  }

  async function readErrorMessage(response: Response): Promise<string> {
    const raw = await response.text();
    if (!raw) return 'Download failed.';
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('text/html') || /^\s*<!doctype html/i.test(raw) || /^\s*<html/i.test(raw)) {
      if (response.status >= 500) {
        return 'Server error while preparing this file. Retry download.';
      }
      return `Download failed (${response.status}). Retry.`;
    }

    try {
      const parsed = JSON.parse(raw) as { error?: string; details?: string };
      return parsed.error || parsed.details || raw;
    } catch {
      const cleaned = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return `Download failed (${response.status}).`;
      return cleaned.slice(0, 220);
    }
  }

  async function loadBatchJob(
    jobId: string,
    handlers: {
      setStatus: (value: BatchJobStatus) => void;
      setProcessedCount: (value: number) => void;
      setTotalCount: (value: number) => void;
      setSuccessCount: (value: number) => void;
      setFailureCount: (value: number) => void;
      setEtaMs: (value: number) => void;
      setResults: (rows: BatchItemResult[]) => void;
      setRunMessage: (value: string) => void;
      selectedFormat: ExportFormat;
      pagePath: '/batch';
    },
  ): Promise<BatchJobApi> {
    const response = await fetch(
      `/api/batch-jobs?jobId=${encodeURIComponent(jobId)}&limit=400&offset=0`,
      {
        headers: buildHeaders(),
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

    handlers.setStatus(json.job.status);
    handlers.setProcessedCount(Number(json.job.processedUrls || 0));
    handlers.setTotalCount(Number(json.job.totalUrls || 0));
    handlers.setSuccessCount(Number(json.job.successCount || 0));
    handlers.setFailureCount(Number(json.job.failureCount || 0));
    handlers.setEtaMs(Math.max(0, Number(json.estimatedRemainingMs || 0)));
    handlers.setResults((json.items || []).map(mapBatchItem));

    const startedAtMs = parseIsoMs(json.job.startedAt);
    const completedAtMs = parseIsoMs(json.job.completedAt);

    if (json.job.status === 'completed') {
      const durationMs =
        startedAtMs > 0 && completedAtMs > startedAtMs
          ? completedAtMs - startedAtMs
          : Number(json.job.averageDurationMs || 0) * Number(json.job.processedUrls || 0);

      const message = `Completed in ${formatDuration(durationMs)}. ${Number(json.job.successCount || 0).toLocaleString()} succeeded, ${Number(json.job.failureCount || 0).toLocaleString()} failed.`;
      handlers.setRunMessage(message);

      void trackClientEvent({
        eventName: 'batch_extract_result',
        eventGroup: 'extract',
        status: Number(json.job.failureCount || 0) > 0 ? 'failure' : 'success',
        pagePath: handlers.pagePath,
        metadata: {
          jobId: json.job.id,
          count: Number(json.job.totalUrls || 0),
          successCount: Number(json.job.successCount || 0),
          failureCount: Number(json.job.failureCount || 0),
          format: handlers.selectedFormat,
          inputMode: json.job.inputMode,
        },
      });
    } else if (json.job.status === 'running' || json.job.status === 'queued') {
      handlers.setRunMessage(
        `Processed ${Number(json.job.processedUrls || 0).toLocaleString()} of ${Number(json.job.totalUrls || 0).toLocaleString()} (${json.job.status}).`,
      );
    } else if (json.job.status === 'failed') {
      handlers.setRunMessage('Batch job failed before completion.');
    }

    return json.job;
  }

  useEffect(() => {
    if (!batchJobId) return;

    let active = true;

    async function poll(): Promise<void> {
      try {
        await loadBatchJob(batchJobId, {
          setStatus: setBatchJobStatus,
          setProcessedCount: setBatchProcessedCount,
          setTotalCount: setBatchTotalCount,
          setSuccessCount: setBatchSuccessCount,
          setFailureCount: setBatchFailureCount,
          setEtaMs: setBatchEtaMs,
          setResults: setBatchResults,
          setRunMessage: setBatchRunMessage,
          selectedFormat: batchFormat,
          pagePath: '/batch',
        });
      } catch (error) {
        if (!active) return;
        setBatchRunMessage(error instanceof Error ? error.message : 'Failed to refresh batch job status.');
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
  }, [batchFormat, batchJobId, batchJobStatus]);

  useEffect(() => {
    if (!documentJobId) return;

    let active = true;

    async function poll(): Promise<void> {
      try {
        await loadBatchJob(documentJobId, {
          setStatus: setDocumentJobStatus,
          setProcessedCount: setDocumentProcessedCount,
          setTotalCount: setDocumentTotalCount,
          setSuccessCount: setDocumentSuccessCount,
          setFailureCount: setDocumentFailureCount,
          setEtaMs: setDocumentEtaMs,
          setResults: setDocumentResults,
          setRunMessage: setDocumentRunMessage,
          selectedFormat: documentFormat,
          pagePath: '/batch',
        });
      } catch (error) {
        if (!active) return;
        setDocumentRunMessage(error instanceof Error ? error.message : 'Failed to refresh document batch status.');
      }
    }

    void poll();
    const interval = setInterval(() => {
      if (!active) return;
      if (documentJobStatus === 'completed' || documentJobStatus === 'failed' || documentJobStatus === 'cancelled') return;
      void poll();
    }, 2200);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [documentFormat, documentJobId, documentJobStatus]);

  async function downloadBlobResponse(response: Response, fallbackName: string): Promise<void> {
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const blob = await response.blob();
    const filename = filenameFromContentDisposition(response.headers.get('content-disposition'), fallbackName);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  async function downloadBatchItem(
    row: BatchItemResult,
    allowFallback = true,
    requestedFormat: ExportFormat = batchFormat,
  ): Promise<void> {
    if (row.status !== 'success') return;

    if (row.outputObjectKey && row.id && documentJobId) {
      const response = await fetch(
        `/api/batch-jobs/download?jobId=${encodeURIComponent(documentJobId)}&itemId=${row.id}`,
        {
          headers: buildHeaders(),
        },
      );
      await downloadBlobResponse(response, row.outputFilename || `batch-document.${row.outputFormat || 'pdf'}`);
      return;
    }

    if (!row.extractionId && row.sourceUrl) {
      const response = await fetch('/api/direct-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildHeaders(),
        },
        body: JSON.stringify({
          url: row.sourceUrl,
          format: requestedFormat,
        }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        if (allowFallback && requestedFormat !== 'pdf') {
          setBatchFormat('pdf');
          setBatchRunMessage(
            `Format ${requestedFormat.toUpperCase()} unavailable for one direct file. Falling back to original download.`,
          );
          await downloadBatchItem(row, false, 'pdf');
          return;
        }
        throw new Error(message || `Direct file download failed (${requestedFormat}).`);
      }

      await downloadBlobResponse(
        response,
        `${(row.title || 'clearpage-direct-file').replace(/\s+/g, '-').toLowerCase()}.${requestedFormat}`,
      );

      if (response.headers.get('x-clearpage-fallback-format') === 'original' && requestedFormat !== 'pdf') {
        setBatchRunMessage('Downloaded original file for one item because conversion was unavailable.');
      }
      return;
    }

    const response = await fetch('/api/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildHeaders(),
      },
      body: JSON.stringify({
        format: requestedFormat,
        images: imagesRef.current,
        extractionId: row.extractionId,
        sourceUrl: row.sourceUrl || row.url,
        settings: DEFAULT_SETTINGS,
      }),
    });

    await downloadBlobResponse(
      response,
      `${(row.title || 'clearpage-batch').replace(/\s+/g, '-').toLowerCase()}.${requestedFormat}`,
    );
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
          headers: buildHeaders(),
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

      const rows = (json.items || []).map(mapBatchItem);
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

  async function handleDownloadAllDocuments(): Promise<void> {
    if (!documentJobId || documentDownloadingAll) return;

    setDocumentDownloadingAll(true);
    try {
      const rows = await getAllSuccessfulBatchRows(documentJobId);
      for (const row of rows.filter((item) => item.outputObjectKey)) {
        await downloadBatchItem(row);
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
    } catch (error) {
      setDocumentRunMessage(error instanceof Error ? error.message : 'Failed to download converted files.');
    } finally {
      setDocumentDownloadingAll(false);
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
        inputMode: 'url',
      },
    });

    try {
      const response = await fetch('/api/batch-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildHeaders(),
        },
        body: JSON.stringify({
          inputMode: 'url',
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
    } catch (error) {
      setBatchRunMessage(error instanceof Error ? error.message : 'Batch job creation failed.');
      setBatchJobStatus('failed');
    }
  }

  async function uploadSingleDocument(entry: DocumentUploadEntry): Promise<void> {
    setDocumentUploads((current) =>
      current.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              status: 'uploading',
              progress: 0,
              error: undefined,
            }
          : item,
      ),
    );

    try {
      let uploadRef: UploadedDocumentRef;

      if (uploadConfig.mode === 'blob') {
        const pathname = `${sanitizePathSegment(sessionIdRef.current || 'anonymous')}/${Date.now()}-${sanitizePathSegment(entry.name)}`;
        const blob = await upload(pathname, entry.file, {
          access: 'private',
          handleUploadUrl: '/api/batch-upload-token',
          multipart: entry.file.size > 5 * 1024 * 1024,
          contentType: entry.contentType || 'application/octet-stream',
          clientPayload: JSON.stringify({
            sessionId: sessionIdRef.current || null,
            filename: entry.name,
            contentType: entry.contentType || 'application/octet-stream',
            byteSize: entry.size,
          }),
          headers: buildHeaders() as Record<string, string>,
          onUploadProgress: ({ percentage }) => {
            setDocumentUploads((current) =>
              current.map((item) =>
                item.id === entry.id
                  ? {
                      ...item,
                      progress: percentage,
                    }
                  : item,
              ),
            );
          },
        });

        const completedResponse = await fetch('/api/batch-upload-complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildHeaders(),
          },
          body: JSON.stringify({
            mode: 'blob',
            pathname: blob.pathname,
            filename: entry.name,
          }),
        });

        const completedJson = (await completedResponse.json()) as {
          success: boolean;
          error?: string;
          file?: UploadedDocumentRef;
        };

        if (!completedResponse.ok || !completedJson.success || !completedJson.file) {
          throw new Error(completedJson.error || 'Failed to finalize blob upload.');
        }

        uploadRef = completedJson.file;
      } else {
        const uploadResponse = await fetch(
          `/api/batch-upload-local?sessionId=${encodeURIComponent(sessionIdRef.current)}&filename=${encodeURIComponent(entry.name)}&contentType=${encodeURIComponent(entry.contentType || 'application/octet-stream')}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': entry.contentType || 'application/octet-stream',
            },
            body: entry.file,
          },
        );

        const uploadJson = (await uploadResponse.json()) as {
          success: boolean;
          error?: string;
          file?: {
            objectKey: string;
            objectUrl: string | null;
            downloadUrl: string | null;
            contentType: string;
            byteSize: number;
            originalFilename: string;
          };
        };

        if (!uploadResponse.ok || !uploadJson.success || !uploadJson.file) {
          throw new Error(uploadJson.error || 'Failed to upload file.');
        }

        const completedResponse = await fetch('/api/batch-upload-complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildHeaders(),
          },
          body: JSON.stringify({
            mode: 'filesystem',
            objectKey: uploadJson.file.objectKey,
            objectUrl: uploadJson.file.objectUrl,
            downloadUrl: uploadJson.file.downloadUrl,
            filename: uploadJson.file.originalFilename,
            contentType: uploadJson.file.contentType,
            byteSize: uploadJson.file.byteSize,
          }),
        });

        const completedJson = (await completedResponse.json()) as {
          success: boolean;
          error?: string;
          file?: UploadedDocumentRef;
        };

        if (!completedResponse.ok || !completedJson.success || !completedJson.file) {
          throw new Error(completedJson.error || 'Failed to finalize uploaded file.');
        }

        uploadRef = completedJson.file;
      }

      setDocumentUploads((current) =>
        current.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                status: 'uploaded',
                progress: 100,
                uploadRef,
              }
            : item,
        ),
      );
    } catch (error) {
      setDocumentUploads((current) =>
        current.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                status: 'failed',
                error: error instanceof Error ? error.message : 'Failed to upload file.',
              }
            : item,
        ),
      );
    }
  }

  async function handleSelectDocumentFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;

    const currentCount = documentUploads.length;
    const currentBytes = documentUploads.reduce((sum, item) => sum + item.size, 0);
    if (currentCount + files.length > uploadConfig.limits.maxFiles) {
      setDocumentRunMessage(`Document limit exceeded. Max allowed is ${uploadConfig.limits.maxFiles.toLocaleString()} files.`);
      return;
    }

    const nextBytes = currentBytes + files.reduce((sum, file) => sum + file.size, 0);
    if (nextBytes > uploadConfig.limits.maxBatchBytes) {
      setDocumentRunMessage(
        `Document selection exceeds the total technical limit of ${formatBytes(uploadConfig.limits.maxBatchBytes)}.`,
      );
      return;
    }

    const entries = files.map<DocumentUploadEntry>((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      status: 'queued',
      progress: 0,
    }));

    setDocumentRunMessage('');
    setDocumentUploads((current) => [...current, ...entries]);
    setDocumentUploading(true);

    try {
      for (const entry of entries) {
        if (entry.size > uploadConfig.limits.maxFileBytes) {
          setDocumentUploads((current) =>
            current.map((item) =>
              item.id === entry.id
                ? {
                    ...item,
                    status: 'failed',
                    error: `File exceeds the per-file limit of ${formatBytes(uploadConfig.limits.maxFileBytes)}.`,
                  }
                : item,
            ),
          );
          continue;
        }

        await uploadSingleDocument(entry);
      }
    } finally {
      setDocumentUploading(false);
    }
  }

  function removeDocumentUpload(id: string): void {
    setDocumentUploads((current) => current.filter((item) => item.id !== id));
  }

  async function handleDocumentBatchSubmit(): Promise<void> {
    const uploadedFiles = documentUploads
      .filter((item) => item.status === 'uploaded' && item.uploadRef)
      .map((item) => ({ uploadId: item.uploadRef!.uploadId }));

    if (uploadedFiles.length === 0) {
      setDocumentRunMessage('Upload at least one supported file before starting a document batch.');
      return;
    }

    setDocumentResults([]);
    setDocumentProcessedCount(0);
    setDocumentTotalCount(uploadedFiles.length);
    setDocumentSuccessCount(0);
    setDocumentFailureCount(0);
    setDocumentEtaMs(uploadedFiles.length * BATCH_ESTIMATED_MS_PER_URL);
    setDocumentJobStatus('queued');
    setDocumentRunMessage('Submitting document batch...');

    void trackClientEvent({
      eventName: 'batch_extract_submit',
      eventGroup: 'extract',
      status: 'attempt',
      pagePath: '/batch',
      metadata: {
        count: uploadedFiles.length,
        format: documentFormat,
        inputMode: 'document',
      },
    });

    try {
      const response = await fetch('/api/batch-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildHeaders(),
        },
        body: JSON.stringify({
          inputMode: 'document',
          files: uploadedFiles,
          format: documentFormat,
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
        throw new Error(json.error || 'Document batch creation failed.');
      }

      setDocumentJobId(json.job.jobId);
      setDocumentJobStatus((json.job.status as BatchJobStatus) || 'queued');
      setDocumentTotalCount(Number(json.job.totalUrls || uploadedFiles.length));
      setDocumentEtaMs(Number(json.job.estimatedProcessingMs || 0));
      setDocumentRunMessage(`Job queued (${json.job.jobId.slice(0, 8)}). Conversion has started.`);
    } catch (error) {
      setDocumentRunMessage(error instanceof Error ? error.message : 'Document batch creation failed.');
      setDocumentJobStatus('failed');
    }
  }

  return (
    <main className="cp-shell cp-enter mx-auto w-full max-w-5xl px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="logo-mark text-5xl font-semibold text-[var(--color-ink)]">Batch Workspace</h1>

          <Link
            href="/"
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            Back to Homepage
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(['url', 'document'] as BatchInputMode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`h-10 rounded-lg border px-4 text-sm font-semibold transition ${
                mode === value
                  ? 'border-[var(--color-accent)] bg-white text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-white text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
              }`}
            >
              {value === 'url' ? 'URLs' : 'Documents'}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {mode === 'url' ? (
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
              downloadEstimateText={formatDuration(batchDownloadEstimateMs)}
              runMessage={batchRunMessage}
              results={batchResults}
              onDownloadOne={(row) =>
                void downloadBatchItem(row).catch((error) =>
                  setBatchRunMessage(
                    error instanceof Error ? error.message : 'Failed to download selected file.',
                  ),
                )
              }
              onDownloadAll={() => void handleDownloadAllBatch()}
            />
          ) : (
            <BatchDocumentPanel
              accept={uploadConfig.accept}
              files={documentUploads}
              format={documentFormat}
              onFormatChange={setDocumentFormat}
              onSelectFiles={(files) => void handleSelectDocumentFiles(files)}
              onRemoveFile={removeDocumentUpload}
              onSubmit={() => void handleDocumentBatchSubmit()}
              processing={documentProcessing}
              uploading={documentUploading}
              downloadingAll={documentDownloadingAll}
              jobId={documentJobId}
              processedCount={documentProcessedCount}
              totalCount={documentTotalCount}
              successCount={documentSuccessCount}
              failureCount={documentFailureCount}
              etaText={formatDuration(documentEtaMs)}
              runMessage={
                documentProcessing || documentSuccessCount > 0
                  ? `${documentRunMessage}${documentSuccessCount > 0 && !documentProcessing ? ` Download est. ${formatDuration(documentDownloadEstimateMs)}.` : ''}`
                  : documentRunMessage
              }
              maxFiles={uploadConfig.limits.maxFiles}
              maxFileBytes={uploadConfig.limits.maxFileBytes}
              maxBatchBytes={uploadConfig.limits.maxBatchBytes}
              results={documentResults}
              onDownloadOne={(row) =>
                void downloadBatchItem(row).catch((error) =>
                  setDocumentRunMessage(
                    error instanceof Error ? error.message : 'Failed to download selected file.',
                  ),
                )
              }
              onDownloadAll={() => void handleDownloadAllDocuments()}
            />
          )}
        </div>
      </div>
    </main>
  );
}
