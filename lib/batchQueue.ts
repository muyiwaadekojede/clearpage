import crypto from 'crypto';

import db from '@/lib/db';
import { storeExtractSnapshot } from '@/lib/extractCache';
import { extractFromUrl } from '@/lib/extract';
import type { ExportFormat, ImageMode, ReaderSettings } from '@/lib/types';

export type BatchJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BatchItemStatus = 'pending' | 'running' | 'success' | 'failure';

export type BatchJobRow = {
  id: string;
  sessionId: string | null;
  status: BatchJobStatus;
  exportFormat: ExportFormat;
  imagesMode: ImageMode;
  settingsJson: string | null;
  totalUrls: number;
  processedUrls: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type BatchItemRow = {
  id: number;
  jobId: string;
  position: number;
  url: string;
  status: BatchItemStatus;
  durationMs: number;
  extractionId: string | null;
  sourceUrl: string | null;
  title: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export const MAX_BATCH_JOB_URLS = 50_000;
const DEFAULT_MS_PER_URL = 9_000;
const BATCH_WORKER_CONCURRENCY = 2;

const BOT_UA_MARKERS = [
  'bot',
  'spider',
  'crawl',
  'crawler',
  'slurp',
  'headless',
  'phantom',
  'python-requests',
  'python-urllib',
  'curl/',
  'wget/',
  'uptime',
  'monitor',
  'axios/',
  'postmanruntime',
  'httpclient',
];

function nowIso(): string {
  return new Date().toISOString();
}

function parseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeBatchUrls(rawUrls: string[]): string[] {
  const unique = new Set<string>();
  const urls: string[] = [];

  for (const raw of rawUrls) {
    const normalized = parseUrl(raw);
    if (!normalized || unique.has(normalized)) continue;

    unique.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

function normalizeExportFormat(value: unknown): ExportFormat {
  if (value === 'txt' || value === 'md' || value === 'docx' || value === 'pdf') return value;
  return 'pdf';
}

function normalizeImageMode(value: unknown): ImageMode {
  if (value === 'off' || value === 'captions' || value === 'on') return value;
  return 'on';
}

function normalizeSettings(input: unknown): Partial<ReaderSettings> {
  if (!input || typeof input !== 'object') return {};

  const candidate = input as Partial<ReaderSettings>;
  const out: Partial<ReaderSettings> = {};

  if (
    candidate.fontFace === 'serif' ||
    candidate.fontFace === 'sans-serif' ||
    candidate.fontFace === 'monospace' ||
    candidate.fontFace === 'dyslexic'
  ) {
    out.fontFace = candidate.fontFace;
  }

  if (typeof candidate.fontSize === 'number' && Number.isFinite(candidate.fontSize)) {
    out.fontSize = Math.max(12, Math.min(28, candidate.fontSize));
  }

  if (typeof candidate.lineSpacing === 'number' && Number.isFinite(candidate.lineSpacing)) {
    out.lineSpacing = Math.max(1.2, Math.min(2.4, candidate.lineSpacing));
  }

  if (candidate.colorTheme === 'light' || candidate.colorTheme === 'dark' || candidate.colorTheme === 'sepia') {
    out.colorTheme = candidate.colorTheme;
  }

  return out;
}

function mapJobRow(row: Record<string, unknown>): BatchJobRow {
  return {
    id: String(row.id),
    sessionId: row.sessionId ? String(row.sessionId) : null,
    status: String(row.status) as BatchJobStatus,
    exportFormat: String(row.exportFormat) as ExportFormat,
    imagesMode: String(row.imagesMode) as ImageMode,
    settingsJson: row.settingsJson ? String(row.settingsJson) : null,
    totalUrls: Number(row.totalUrls || 0),
    processedUrls: Number(row.processedUrls || 0),
    successCount: Number(row.successCount || 0),
    failureCount: Number(row.failureCount || 0),
    averageDurationMs: row.averageDurationMs === null || row.averageDurationMs === undefined ? null : Number(row.averageDurationMs),
    createdAt: String(row.createdAt),
    startedAt: row.startedAt ? String(row.startedAt) : null,
    completedAt: row.completedAt ? String(row.completedAt) : null,
    updatedAt: String(row.updatedAt),
    lastErrorCode: row.lastErrorCode ? String(row.lastErrorCode) : null,
    lastErrorMessage: row.lastErrorMessage ? String(row.lastErrorMessage) : null,
  };
}

function mapItemRow(row: Record<string, unknown>): BatchItemRow {
  return {
    id: Number(row.id),
    jobId: String(row.jobId),
    position: Number(row.position || 0),
    url: String(row.url),
    status: String(row.status) as BatchItemStatus,
    durationMs: Number(row.durationMs || 0),
    extractionId: row.extractionId ? String(row.extractionId) : null,
    sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
    title: row.title ? String(row.title) : null,
    errorCode: row.errorCode ? String(row.errorCode) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    startedAt: row.startedAt ? String(row.startedAt) : null,
    completedAt: row.completedAt ? String(row.completedAt) : null,
  };
}

export function getBatchJob(jobId: string): BatchJobRow | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        session_id AS sessionId,
        status,
        export_format AS exportFormat,
        images_mode AS imagesMode,
        settings_json AS settingsJson,
        total_urls AS totalUrls,
        processed_urls AS processedUrls,
        success_count AS successCount,
        failure_count AS failureCount,
        average_duration_ms AS averageDurationMs,
        created_at AS createdAt,
        started_at AS startedAt,
        completed_at AS completedAt,
        updated_at AS updatedAt,
        last_error_code AS lastErrorCode,
        last_error_message AS lastErrorMessage
      FROM batch_jobs
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(jobId) as Record<string, unknown> | undefined;

  return row ? mapJobRow(row) : null;
}

export function getBatchJobItems(jobId: string, limit: number, offset: number): BatchItemRow[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit) || 200));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);

  const rows = db
    .prepare(
      `
      SELECT
        id,
        job_id AS jobId,
        position,
        url,
        status,
        duration_ms AS durationMs,
        extraction_id AS extractionId,
        source_url AS sourceUrl,
        title,
        error_code AS errorCode,
        error_message AS errorMessage,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM batch_job_items
      WHERE job_id = ?
      ORDER BY position ASC
      LIMIT ? OFFSET ?
      `,
    )
    .all(jobId, safeLimit, safeOffset) as Array<Record<string, unknown>>;

  return rows.map(mapItemRow);
}

export function createBatchJob(input: {
  sessionId: string | null;
  urls: string[];
  format: unknown;
  images: unknown;
  settings?: unknown;
}): {
  jobId: string;
  totalUrls: number;
  status: BatchJobStatus;
  estimatedProcessingMs: number;
} {
  const urls = normalizeBatchUrls(input.urls);

  if (urls.length === 0) {
    throw new Error('No valid URLs were provided for this batch.');
  }

  if (urls.length > MAX_BATCH_JOB_URLS) {
    throw new Error(`Batch exceeds maximum of ${MAX_BATCH_JOB_URLS.toLocaleString()} URLs.`);
  }

  const now = nowIso();
  const jobId = crypto.randomUUID();
  const format = normalizeExportFormat(input.format);
  const images = normalizeImageMode(input.images);
  const settingsJson = JSON.stringify(normalizeSettings(input.settings));

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO batch_jobs (
        id,
        session_id,
        status,
        export_format,
        images_mode,
        settings_json,
        total_urls,
        processed_urls,
        success_count,
        failure_count,
        average_duration_ms,
        created_at,
        started_at,
        completed_at,
        updated_at,
        last_error_code,
        last_error_message
      )
      VALUES (?, ?, 'queued', ?, ?, ?, ?, 0, 0, 0, NULL, ?, NULL, NULL, ?, NULL, NULL)
      `,
    ).run(jobId, input.sessionId, format, images, settingsJson, urls.length, now, now);

    const insertItem = db.prepare(
      `
      INSERT INTO batch_job_items (
        job_id,
        position,
        url,
        status,
        duration_ms,
        extraction_id,
        source_url,
        title,
        error_code,
        error_message,
        started_at,
        completed_at
      )
      VALUES (?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
      `,
    );

    for (let index = 0; index < urls.length; index += 1) {
      insertItem.run(jobId, index, urls[index]);
    }
  });

  tx();

  return {
    jobId,
    totalUrls: urls.length,
    status: 'queued',
    estimatedProcessingMs: urls.length * DEFAULT_MS_PER_URL,
  };
}

function claimNextQueuedJob(): { id: string } | null {
  const now = nowIso();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `
        SELECT id
        FROM batch_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        `,
      )
      .get() as { id: string } | undefined;

    if (!row) return null;

    db.prepare(
      `
      UPDATE batch_jobs
      SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE id = ?
      `,
    ).run(now, now, row.id);

    return row;
  });

  return tx();
}

function claimNextPendingItem(jobId: string): { id: number; url: string } | null {
  const now = nowIso();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `
        SELECT id, url
        FROM batch_job_items
        WHERE job_id = ? AND status = 'pending'
        ORDER BY position ASC
        LIMIT 1
        `,
      )
      .get(jobId) as { id: number; url: string } | undefined;

    if (!row) return null;

    db.prepare(
      `
      UPDATE batch_job_items
      SET status = 'running', started_at = ?
      WHERE id = ?
      `,
    ).run(now, row.id);

    return row;
  });

  return tx();
}

function markItemSuccess(input: {
  jobId: string;
  itemId: number;
  durationMs: number;
  extractionId: string | null;
  sourceUrl: string;
  title: string;
}): void {
  const now = nowIso();

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE batch_job_items
      SET
        status = 'success',
        duration_ms = ?,
        extraction_id = ?,
        source_url = ?,
        title = ?,
        error_code = NULL,
        error_message = NULL,
        completed_at = ?
      WHERE id = ?
      `,
    ).run(input.durationMs, input.extractionId, input.sourceUrl, input.title, now, input.itemId);

    db.prepare(
      `
      UPDATE batch_jobs
      SET
        processed_urls = processed_urls + 1,
        success_count = success_count + 1,
        average_duration_ms = CAST(
          ((COALESCE(average_duration_ms, 0) * processed_urls) + ?) / (processed_urls + 1)
          AS INTEGER
        ),
        updated_at = ?,
        last_error_code = NULL,
        last_error_message = NULL
      WHERE id = ?
      `,
    ).run(input.durationMs, now, input.jobId);
  });

  tx();
}

function markItemFailure(input: {
  jobId: string;
  itemId: number;
  durationMs: number;
  errorCode: string;
  errorMessage: string;
}): void {
  const now = nowIso();

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE batch_job_items
      SET
        status = 'failure',
        duration_ms = ?,
        extraction_id = NULL,
        source_url = NULL,
        title = NULL,
        error_code = ?,
        error_message = ?,
        completed_at = ?
      WHERE id = ?
      `,
    ).run(input.durationMs, input.errorCode, input.errorMessage.slice(0, 1200), now, input.itemId);

    db.prepare(
      `
      UPDATE batch_jobs
      SET
        processed_urls = processed_urls + 1,
        failure_count = failure_count + 1,
        average_duration_ms = CAST(
          ((COALESCE(average_duration_ms, 0) * processed_urls) + ?) / (processed_urls + 1)
          AS INTEGER
        ),
        updated_at = ?,
        last_error_code = ?,
        last_error_message = ?
      WHERE id = ?
      `,
    ).run(input.durationMs, now, input.errorCode.slice(0, 120), input.errorMessage.slice(0, 1200), input.jobId);
  });

  tx();
}

function finalizeJob(jobId: string): void {
  const now = nowIso();
  const row = db
    .prepare(
      `
      SELECT
        total_urls AS totalUrls,
        processed_urls AS processedUrls,
        success_count AS successCount,
        failure_count AS failureCount
      FROM batch_jobs
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(jobId) as
    | {
        totalUrls: number;
        processedUrls: number;
        successCount: number;
        failureCount: number;
      }
    | undefined;

  if (!row) return;

  const done = Number(row.processedUrls) >= Number(row.totalUrls);
  const status: BatchJobStatus = done ? 'completed' : 'running';

  db.prepare(
    `
    UPDATE batch_jobs
    SET status = ?, completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END, updated_at = ?
    WHERE id = ?
    `,
  ).run(status, done ? 1 : 0, now, now, jobId);
}

function getJobProcessingConfig(jobId: string): { imagesMode: ImageMode } | null {
  const row = db
    .prepare(
      `
      SELECT images_mode AS imagesMode
      FROM batch_jobs
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(jobId) as { imagesMode: ImageMode } | undefined;

  return row || null;
}

async function runJob(jobId: string): Promise<void> {
  const config = getJobProcessingConfig(jobId);
  if (!config) return;

  while (true) {
    const item = claimNextPendingItem(jobId);
    if (!item) break;

    const startedAt = Date.now();

    try {
      const result = await extractFromUrl(item.url, config.imagesMode);
      const durationMs = Date.now() - startedAt;

      if (!result.success) {
        markItemFailure({
          jobId,
          itemId: item.id,
          durationMs,
          errorCode: result.errorCode || 'EXTRACTION_FAILED',
          errorMessage: result.errorMessage || 'Extraction failed for this URL.',
        });
        continue;
      }

      const extractionId = storeExtractSnapshot({
        title: result.title,
        byline: result.byline,
        siteName: result.siteName,
        publishedTime: result.publishedTime,
        sourceUrl: result.sourceUrl,
        textContent: result.textContent,
        contentVariants: result.contentVariants,
      });

      markItemSuccess({
        jobId,
        itemId: item.id,
        durationMs,
        extractionId,
        sourceUrl: result.sourceUrl,
        title: result.title,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      markItemFailure({
        jobId,
        itemId: item.id,
        durationMs,
        errorCode: 'EXTRACTION_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unexpected extraction error.',
      });
    }
  }

  finalizeJob(jobId);
}

type QueueRuntime = {
  running: boolean;
  bootstrapped: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __clearpageBatchQueue: QueueRuntime | undefined;
}

function getRuntime(): QueueRuntime {
  if (!global.__clearpageBatchQueue) {
    global.__clearpageBatchQueue = {
      running: false,
      bootstrapped: false,
    };
  }

  return global.__clearpageBatchQueue;
}

function bootstrapQueueState(): void {
  const runtime = getRuntime();
  if (runtime.bootstrapped) return;

  const now = nowIso();

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE batch_job_items
      SET status = 'pending', started_at = NULL
      WHERE status = 'running'
      `,
    ).run();

    db.prepare(
      `
      UPDATE batch_jobs
      SET status = 'queued', updated_at = ?
      WHERE status = 'running' AND processed_urls < total_urls
      `,
    ).run(now);
  });

  tx();
  runtime.bootstrapped = true;
}

function hasQueuedJobs(): boolean {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM batch_jobs
      WHERE status = 'queued'
      `,
    )
    .get() as { count: number };

  return Number(row.count || 0) > 0;
}

async function workerLoop(): Promise<void> {
  while (true) {
    const nextJob = claimNextQueuedJob();
    if (!nextJob) break;

    await runJob(nextJob.id);
  }
}

export function enqueueBatchProcessing(): void {
  bootstrapQueueState();

  const runtime = getRuntime();
  if (runtime.running) return;
  if (!hasQueuedJobs()) return;

  runtime.running = true;

  const workers = Array.from({ length: BATCH_WORKER_CONCURRENCY }, () => workerLoop());

  void Promise.allSettled(workers).then(() => {
    runtime.running = false;
    if (hasQueuedJobs()) {
      enqueueBatchProcessing();
    }
  });
}

export function getBatchJobDetail(input: {
  jobId: string;
  limit?: number;
  offset?: number;
}): {
  job: BatchJobRow;
  items: BatchItemRow[];
  estimatedRemainingMs: number;
} | null {
  const job = getBatchJob(input.jobId);
  if (!job) return null;

  const items = getBatchJobItems(job.id, input.limit || 200, input.offset || 0);
  const remaining = Math.max(0, job.totalUrls - job.processedUrls);
  const msPerUrl = job.averageDurationMs && job.averageDurationMs > 0 ? job.averageDurationMs : DEFAULT_MS_PER_URL;

  return {
    job,
    items,
    estimatedRemainingMs: remaining * msPerUrl,
  };
}

export function isLikelyBotUserAgent(userAgent: string): boolean {
  const lowered = (userAgent || '').toLowerCase();
  if (!lowered) return true;
  return BOT_UA_MARKERS.some((marker) => lowered.includes(marker));
}