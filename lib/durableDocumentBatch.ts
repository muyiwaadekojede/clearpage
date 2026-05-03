import fs from 'fs/promises';
import path from 'path';

import { readStoredObjectBuffer, storeOutputBuffer } from '@/lib/batchStorage';
import { resolveDataDir } from '@/lib/db';
import {
  convertDocumentBuffer,
  isSupportedDocumentFilename,
  MAX_DOCUMENT_BATCH_BYTES,
  MAX_DOCUMENT_BATCH_FILES,
} from '@/lib/documentConversion';
import type { ExportFormat, ReaderSettings } from '@/lib/types';

type DurableJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type DurableItemStatus = 'pending' | 'running' | 'success' | 'failure';

type DurableUploadRecord = {
  uploadId: string;
  sessionId: string | null;
  objectKey: string;
  objectUrl: string | null;
  downloadUrl: string | null;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

type DurableDocumentBatchItem = {
  id: number;
  jobId: string;
  position: number;
  url: string;
  status: DurableItemStatus;
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
  startedAt: string | null;
  completedAt: string | null;
};

type DurableDocumentBatchManifest = {
  job: {
    id: string;
    sessionId: string | null;
    status: DurableJobStatus;
    inputMode: 'document';
    exportFormat: ExportFormat;
    imagesMode: 'off' | 'captions' | 'on';
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
  items: DurableDocumentBatchItem[];
};

const DEFAULT_MS_PER_ITEM = 9_000;
const ITEMS_PER_PROGRESS_TICK = 2;
const DEFAULT_SETTINGS: ReaderSettings = {
  fontFace: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  colorTheme: 'light',
};
const FILESYSTEM_ROOT = path.join(resolveDataDir(), 'durable-document-batch');

async function getBlobSdk() {
  return await import('@vercel/blob');
}

function nowIso(): string {
  return new Date().toISOString();
}

function dataMode(): 'blob' | 'filesystem' {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() ? 'blob' : 'filesystem';
}

function uploadRecordKey(uploadId: string): string {
  return `clearpage/state/uploads/${uploadId}.json`;
}

function jobManifestKey(jobId: string): string {
  return `clearpage/state/jobs/${jobId}.json`;
}

function filesystemPath(relativePath: string): string {
  return path.join(FILESYSTEM_ROOT, relativePath.replace(/^[/\\]+/, ''));
}

async function writeJson(relativeKey: string, value: unknown): Promise<void> {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');

  if (dataMode() === 'blob') {
    const { put } = await getBlobSdk();
    await put(relativeKey, payload, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
    return;
  }

  const absolutePath = filesystemPath(relativeKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, payload);
}

async function readJson<T>(relativeKey: string): Promise<T | null> {
  try {
    if (dataMode() === 'blob') {
      const { get } = await getBlobSdk();
      const blob = await get(relativeKey, { access: 'private' });
      if (!blob || blob.statusCode !== 200 || !blob.stream) {
        return null;
      }

      const chunks: Buffer[] = [];
      const reader = blob.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(Buffer.from(value));
          }
        }
      } finally {
        reader.releaseLock();
      }

      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
    }

    const absolutePath = filesystemPath(relativeKey);
    const payload = await fs.readFile(absolutePath, 'utf8');
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function normalizeSettings(input: unknown): ReaderSettings {
  if (!input || typeof input !== 'object') return DEFAULT_SETTINGS;

  const value = input as Partial<ReaderSettings>;
  return {
    fontFace:
      value.fontFace === 'serif' ||
      value.fontFace === 'sans-serif' ||
      value.fontFace === 'monospace' ||
      value.fontFace === 'dyslexic'
        ? value.fontFace
        : DEFAULT_SETTINGS.fontFace,
    fontSize:
      typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)
        ? Math.max(12, Math.min(28, value.fontSize))
        : DEFAULT_SETTINGS.fontSize,
    lineSpacing:
      typeof value.lineSpacing === 'number' && Number.isFinite(value.lineSpacing)
        ? Math.max(1.2, Math.min(2.4, value.lineSpacing))
        : DEFAULT_SETTINGS.lineSpacing,
    colorTheme:
      value.colorTheme === 'light' || value.colorTheme === 'dark' || value.colorTheme === 'sepia'
        ? value.colorTheme
        : DEFAULT_SETTINGS.colorTheme,
  };
}

function estimateRemainingMs(job: DurableDocumentBatchManifest['job']): number {
  const remaining = Math.max(0, job.totalUrls - job.processedUrls);
  const msPerItem = job.averageDurationMs && job.averageDurationMs > 0 ? job.averageDurationMs : DEFAULT_MS_PER_ITEM;
  return remaining * msPerItem;
}

function cloneDetail(
  manifest: DurableDocumentBatchManifest,
  limit = 200,
  offset = 0,
): {
  job: DurableDocumentBatchManifest['job'];
  items: DurableDocumentBatchItem[];
  estimatedRemainingMs: number;
} {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit) || 200));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  return {
    job: manifest.job,
    items: manifest.items.slice(safeOffset, safeOffset + safeLimit),
    estimatedRemainingMs: estimateRemainingMs(manifest.job),
  };
}

export function shouldUseDurableDocumentBatchState(): boolean {
  return Boolean(process.env.VERCEL);
}

export async function persistDurableUploadRecord(input: DurableUploadRecord): Promise<void> {
  await writeJson(uploadRecordKey(input.uploadId), input);
}

async function getDurableUploadRecords(sessionId: string | null, uploadIds: string[]): Promise<DurableUploadRecord[]> {
  const records = await Promise.all(uploadIds.map((uploadId) => readJson<DurableUploadRecord>(uploadRecordKey(uploadId))));
  return records.filter((record): record is DurableUploadRecord => {
    if (!record) return false;
    return record.sessionId === sessionId;
  });
}

export async function createDurableDocumentBatchJob(input: {
  jobId: string;
  sessionId: string | null;
  files: Array<{ uploadId: string }>;
  format: ExportFormat;
  images: 'off' | 'captions' | 'on';
  settings: unknown;
}): Promise<{
  jobId: string;
  totalUrls: number;
  status: DurableJobStatus;
  estimatedProcessingMs: number;
}> {
  const uploadIds = Array.from(new Set(input.files.map((file) => String(file.uploadId || '').trim()).filter(Boolean)));
  if (uploadIds.length === 0) {
    throw new Error('No uploaded files were provided for this batch.');
  }

  if (uploadIds.length > MAX_DOCUMENT_BATCH_FILES) {
    throw new Error(`Batch exceeds maximum of ${MAX_DOCUMENT_BATCH_FILES.toLocaleString()} files.`);
  }

  const uploads = await getDurableUploadRecords(input.sessionId, uploadIds);
  if (uploads.length !== uploadIds.length) {
    throw new Error('One or more uploaded files are missing or unavailable for this session.');
  }

  const totalBytes = uploads.reduce((sum, upload) => sum + upload.byteSize, 0);
  if (totalBytes > MAX_DOCUMENT_BATCH_BYTES) {
    throw new Error('Combined uploaded files exceed the technical batch size limit.');
  }

  for (const upload of uploads) {
    if (!isSupportedDocumentFilename(upload.originalFilename)) {
      throw new Error(`Unsupported uploaded file type: ${upload.originalFilename}`);
    }
  }

  const now = nowIso();
  const manifest: DurableDocumentBatchManifest = {
    job: {
      id: input.jobId,
      sessionId: input.sessionId,
      status: 'queued',
      inputMode: 'document',
      exportFormat: input.format,
      imagesMode: input.images,
      settingsJson: JSON.stringify(normalizeSettings(input.settings)),
      totalUrls: uploads.length,
      processedUrls: 0,
      successCount: 0,
      failureCount: 0,
      averageDurationMs: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    items: uploads.map((upload, index) => ({
      id: index + 1,
      jobId: input.jobId,
      position: index,
      url: `upload://${upload.uploadId}`,
      status: 'pending',
      durationMs: 0,
      extractionId: null,
      sourceUrl: null,
      title: null,
      originalFilename: upload.originalFilename,
      contentType: upload.contentType,
      byteSize: upload.byteSize,
      sourceObjectKey: upload.objectKey,
      outputObjectKey: null,
      outputFilename: null,
      outputFormat: input.format,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    })),
  };

  await writeJson(jobManifestKey(input.jobId), manifest);

  return {
    jobId: input.jobId,
    totalUrls: uploads.length,
    status: 'queued',
    estimatedProcessingMs: uploads.length * DEFAULT_MS_PER_ITEM,
  };
}

async function loadManifest(jobId: string): Promise<DurableDocumentBatchManifest | null> {
  return await readJson<DurableDocumentBatchManifest>(jobManifestKey(jobId));
}

async function saveManifest(manifest: DurableDocumentBatchManifest): Promise<void> {
  manifest.job.updatedAt = nowIso();
  await writeJson(jobManifestKey(manifest.job.id), manifest);
}

function updateAverageDuration(currentAverage: number | null, processed: number, nextDuration: number): number {
  const base = currentAverage && currentAverage > 0 ? currentAverage : 0;
  return Math.round(((base * processed) + nextDuration) / (processed + 1));
}

async function progressManifest(manifest: DurableDocumentBatchManifest): Promise<DurableDocumentBatchManifest> {
  if (manifest.job.status === 'completed' || manifest.job.status === 'failed' || manifest.job.status === 'cancelled') {
    return manifest;
  }

  if (!manifest.job.startedAt) {
    manifest.job.startedAt = nowIso();
  }
  manifest.job.status = 'running';
  await saveManifest(manifest);

  const settings = normalizeSettings(manifest.job.settingsJson ? JSON.parse(manifest.job.settingsJson) : {});
  let processedThisTick = 0;

  for (const item of manifest.items) {
    if (processedThisTick >= ITEMS_PER_PROGRESS_TICK) break;
    if (item.status !== 'pending') continue;

    item.status = 'running';
    item.startedAt = nowIso();
    await saveManifest(manifest);

    const startedAt = Date.now();
    try {
      if (!item.sourceObjectKey || !item.originalFilename || !item.contentType) {
        throw new Error('Missing uploaded file metadata.');
      }

      const bytes = await readStoredObjectBuffer(item.sourceObjectKey);
      const converted = await convertDocumentBuffer({
        bytes,
        rawFilename: item.originalFilename,
        contentType: item.contentType,
        format: manifest.job.exportFormat,
        sourceLabel: item.url,
        settings,
      });

      if (!converted.success) {
        throw new Error('Failed to convert file.');
      }

      const stored = await storeOutputBuffer({
        sessionId: manifest.job.sessionId,
        filename: converted.filename,
        contentType: converted.contentType,
        buffer: converted.buffer,
      });

      const durationMs = Date.now() - startedAt;
      item.status = 'success';
      item.durationMs = durationMs;
      item.title = converted.title;
      item.outputObjectKey = stored.objectKey;
      item.outputFilename = converted.filename;
      item.outputFormat = manifest.job.exportFormat;
      item.errorCode = null;
      item.errorMessage = null;
      item.completedAt = nowIso();

      manifest.job.averageDurationMs = updateAverageDuration(
        manifest.job.averageDurationMs,
        manifest.job.processedUrls,
        durationMs,
      );
      manifest.job.processedUrls += 1;
      manifest.job.successCount += 1;
      manifest.job.lastErrorCode = null;
      manifest.job.lastErrorMessage = null;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : 'Failed to convert file.';
      item.status = 'failure';
      item.durationMs = durationMs;
      item.outputObjectKey = null;
      item.outputFilename = null;
      item.outputFormat = manifest.job.exportFormat;
      item.errorCode = 'DOCUMENT_CONVERSION_FAILED';
      item.errorMessage = message.slice(0, 1200);
      item.completedAt = nowIso();

      manifest.job.averageDurationMs = updateAverageDuration(
        manifest.job.averageDurationMs,
        manifest.job.processedUrls,
        durationMs,
      );
      manifest.job.processedUrls += 1;
      manifest.job.failureCount += 1;
      manifest.job.lastErrorCode = 'DOCUMENT_CONVERSION_FAILED';
      manifest.job.lastErrorMessage = message.slice(0, 1200);
    }

    processedThisTick += 1;
    await saveManifest(manifest);
  }

  if (manifest.job.processedUrls >= manifest.job.totalUrls) {
    manifest.job.status = 'completed';
    manifest.job.completedAt = nowIso();
    await saveManifest(manifest);
  }

  return manifest;
}

export async function getDurableDocumentBatchDetail(input: {
  jobId: string;
  sessionId: string | null;
  limit?: number;
  offset?: number;
}): Promise<
  | { kind: 'not_found' }
  | { kind: 'forbidden'; error: string }
  | {
      kind: 'ok';
      detail: {
        job: DurableDocumentBatchManifest['job'];
        items: DurableDocumentBatchItem[];
        estimatedRemainingMs: number;
      };
    }
> {
  const manifest = await loadManifest(input.jobId);
  if (!manifest) {
    return { kind: 'not_found' };
  }

  if (manifest.job.sessionId && input.sessionId && manifest.job.sessionId !== input.sessionId) {
    return { kind: 'forbidden', error: 'Not authorized to access this batch job.' };
  }

  if (manifest.job.sessionId && !input.sessionId) {
    return { kind: 'forbidden', error: 'Missing session identifier.' };
  }

  const progressed = await progressManifest(manifest);
  return {
    kind: 'ok',
    detail: cloneDetail(progressed, input.limit, input.offset),
  };
}

export async function getDurableDocumentBatchItem(input: {
  jobId: string;
  itemId: number;
  sessionId: string | null;
}): Promise<
  | { kind: 'not_found' }
  | { kind: 'forbidden'; error: string }
  | {
      kind: 'ok';
      job: DurableDocumentBatchManifest['job'];
      item: DurableDocumentBatchItem;
    }
> {
  const manifest = await loadManifest(input.jobId);
  if (!manifest) {
    return { kind: 'not_found' };
  }

  if (manifest.job.sessionId && input.sessionId && manifest.job.sessionId !== input.sessionId) {
    return { kind: 'forbidden', error: 'Not authorized to access this batch job.' };
  }

  if (manifest.job.sessionId && !input.sessionId) {
    return { kind: 'forbidden', error: 'Missing session identifier.' };
  }

  const item = manifest.items.find((entry) => entry.id === input.itemId) || null;
  if (!item) {
    return { kind: 'not_found' };
  }

  return {
    kind: 'ok',
    job: manifest.job,
    item,
  };
}
