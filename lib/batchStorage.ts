import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { NextApiResponse } from 'next';

import db, { resolveDataDir } from '@/lib/db';
import { DOCUMENT_RETENTION_MS } from '@/lib/documentConversion';
import { sanitizeFilename } from '@/lib/sanitise';

export type UploadStorageMode = 'blob' | 'filesystem';

export type UploadedDocumentRef = {
  uploadId: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

type CompletedUploadRow = UploadedDocumentRef & {
  sessionId: string | null;
  objectKey: string;
  objectUrl: string | null;
  downloadUrl: string | null;
};

type StoredObjectDetails = {
  objectKey: string;
  objectUrl: string | null;
  downloadUrl: string | null;
  contentType: string;
  byteSize: number;
  originalFilename: string;
  createdAt: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __clearpageBatchStorageCleanupAt: number | undefined;
}

const FILESYSTEM_ROOT = path.join(resolveDataDir(), 'batch-storage');
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function getBlobSdk() {
  return await import('@vercel/blob');
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureBlobEnabled(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured.');
  }
}

function getFilesystemPath(relativePath: string): string {
  return path.join(FILESYSTEM_ROOT, relativePath.replace(/^[/\\]+/, ''));
}

function normalizeSessionSegment(sessionId: string | null): string {
  const value = (sessionId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  return value || 'anonymous';
}

function buildObjectPath(sessionId: string | null, bucket: 'uploads' | 'outputs', filename: string): string {
  const safeBase = sanitizeFilename(filename, bucket).slice(0, 180) || bucket;
  return `clearpage/${bucket}/${normalizeSessionSegment(sessionId)}/${crypto.randomUUID()}-${safeBase}`;
}

export function getBatchUploadStorageMode(): UploadStorageMode {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() ? 'blob' : 'filesystem';
}

function prefixedObjectKey(mode: UploadStorageMode, relativeKey: string): string {
  return `${mode}:${relativeKey.replace(/^[/\\]+/, '')}`;
}

function parseObjectKey(objectKey: string): { mode: UploadStorageMode; key: string } {
  if (objectKey.startsWith('blob:')) {
    return { mode: 'blob', key: objectKey.slice('blob:'.length) };
  }

  if (objectKey.startsWith('filesystem:')) {
    return { mode: 'filesystem', key: objectKey.slice('filesystem:'.length) };
  }

  throw new Error('Unsupported storage object key.');
}

function mapUploadRow(row: Record<string, unknown>): CompletedUploadRow {
  return {
    uploadId: String(row.id),
    sessionId: row.sessionId ? String(row.sessionId) : null,
    objectKey: String(row.objectKey),
    objectUrl: row.objectUrl ? String(row.objectUrl) : null,
    downloadUrl: row.downloadUrl ? String(row.downloadUrl) : null,
    originalFilename: String(row.originalFilename),
    contentType: String(row.contentType),
    byteSize: Number(row.byteSize || 0),
    createdAt: String(row.createdAt),
  };
}

async function removeStoredObject(objectKey: string): Promise<void> {
  const parsed = parseObjectKey(objectKey);

  if (parsed.mode === 'filesystem') {
    const absolutePath = getFilesystemPath(parsed.key);
    await fs.rm(absolutePath, { force: true });
    return;
  }

  try {
    const { del } = await getBlobSdk();
    await del(parsed.key);
  } catch {
    // Best-effort cleanup only.
  }
}

export async function cleanupBatchStorageArtifacts(): Promise<void> {
  const lastRun = global.__clearpageBatchStorageCleanupAt || 0;
  if (Date.now() - lastRun < CLEANUP_INTERVAL_MS) return;
  global.__clearpageBatchStorageCleanupAt = Date.now();

  const cutoffIso = new Date(Date.now() - DOCUMENT_RETENTION_MS).toISOString();
  const uploadRows = db
    .prepare(
      `
      SELECT object_key AS objectKey
      FROM batch_uploads
      WHERE created_at < ?
      `,
    )
    .all(cutoffIso) as Array<{ objectKey: string }>;
  const outputRows = db
    .prepare(
      `
      SELECT output_object_key AS objectKey
      FROM batch_job_items
      WHERE output_object_key IS NOT NULL AND completed_at < ?
      `,
    )
    .all(cutoffIso) as Array<{ objectKey: string | null }>;

  const uniqueKeys = new Set<string>();
  for (const row of uploadRows) {
    if (row.objectKey) uniqueKeys.add(row.objectKey);
  }
  for (const row of outputRows) {
    if (row.objectKey) uniqueKeys.add(row.objectKey);
  }

  for (const objectKey of uniqueKeys) {
    await removeStoredObject(objectKey);
  }

  db.prepare(`DELETE FROM batch_uploads WHERE created_at < ?`).run(cutoffIso);
}

export async function saveLocalUploadedFile(input: {
  sessionId: string | null;
  filename: string;
  contentType: string;
  bytes: Buffer;
}): Promise<StoredObjectDetails> {
  await cleanupBatchStorageArtifacts();

  const relativePath = buildObjectPath(input.sessionId, 'uploads', input.filename);
  const objectKey = prefixedObjectKey('filesystem', relativePath);
  const absolutePath = getFilesystemPath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, input.bytes);

  return {
    objectKey,
    objectUrl: null,
    downloadUrl: null,
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    originalFilename: input.filename,
    createdAt: nowIso(),
  };
}

export async function completeBlobUploadedFile(input: {
  sessionId: string | null;
  pathname: string;
  filename: string;
}): Promise<StoredObjectDetails> {
  await cleanupBatchStorageArtifacts();
  ensureBlobEnabled();

  const { head } = await getBlobSdk();
  const blob = await head(input.pathname);
  return {
    objectKey: prefixedObjectKey('blob', blob.pathname),
    objectUrl: blob.url,
    downloadUrl: blob.downloadUrl,
    contentType: blob.contentType,
    byteSize: blob.size,
    originalFilename: input.filename,
    createdAt: blob.uploadedAt.toISOString(),
  };
}

export function registerCompletedUpload(input: {
  sessionId: string | null;
  objectKey: string;
  objectUrl: string | null;
  downloadUrl: string | null;
  originalFilename: string;
  contentType: string;
  byteSize: number;
}): UploadedDocumentRef {
  const uploadId = crypto.randomUUID();
  const createdAt = nowIso();

  db.prepare(
    `
    INSERT INTO batch_uploads (
      id,
      session_id,
      object_key,
      object_url,
      download_url,
      original_filename,
      content_type,
      byte_size,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    uploadId,
    input.sessionId,
    input.objectKey,
    input.objectUrl,
    input.downloadUrl,
    input.originalFilename,
    input.contentType,
    input.byteSize,
    createdAt,
  );

  return {
    uploadId,
    originalFilename: input.originalFilename,
    contentType: input.contentType,
    byteSize: input.byteSize,
    createdAt,
  };
}

export function getUploadedDocumentsByIds(sessionId: string | null, uploadIds: string[]): CompletedUploadRow[] {
  if (uploadIds.length === 0) return [];

  const placeholders = uploadIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `
      SELECT
        id,
        session_id AS sessionId,
        object_key AS objectKey,
        object_url AS objectUrl,
        download_url AS downloadUrl,
        original_filename AS originalFilename,
        content_type AS contentType,
        byte_size AS byteSize,
        created_at AS createdAt
      FROM batch_uploads
      WHERE id IN (${placeholders})
      `,
    )
    .all(...uploadIds) as Array<Record<string, unknown>>;

  const mapped = rows.map(mapUploadRow);
  return mapped.filter((row) => row.sessionId === sessionId);
}

export async function readStoredObjectBuffer(objectKey: string): Promise<Buffer> {
  const parsed = parseObjectKey(objectKey);

  if (parsed.mode === 'filesystem') {
    return await fs.readFile(getFilesystemPath(parsed.key));
  }

  ensureBlobEnabled();
  const { get } = await getBlobSdk();
  const blob = await get(parsed.key, { access: 'private' });
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new Error('Stored blob could not be read.');
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

  return Buffer.concat(chunks);
}

export async function storeOutputBuffer(input: {
  sessionId: string | null;
  filename: string;
  contentType: string;
  buffer: Buffer;
}): Promise<{
  objectKey: string;
  objectUrl: string | null;
  downloadUrl: string | null;
}> {
  await cleanupBatchStorageArtifacts();

  const mode = getBatchUploadStorageMode();
  const relativePath = buildObjectPath(input.sessionId, 'outputs', input.filename);

  if (mode === 'filesystem') {
    const objectKey = prefixedObjectKey('filesystem', relativePath);
    const absolutePath = getFilesystemPath(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer);
    return {
      objectKey,
      objectUrl: null,
      downloadUrl: null,
    };
  }

  ensureBlobEnabled();
  const { put } = await getBlobSdk();
  const blob = await put(relativePath, input.buffer, {
    access: 'private',
    addRandomSuffix: false,
    contentType: input.contentType,
    allowOverwrite: true,
  });

  return {
    objectKey: prefixedObjectKey('blob', blob.pathname),
    objectUrl: blob.url,
    downloadUrl: blob.downloadUrl,
  };
}

export async function streamStoredObjectToResponse(input: {
  objectKey: string;
  response: NextApiResponse;
  contentType: string;
  filename: string;
}): Promise<void> {
  const parsed = parseObjectKey(input.objectKey);

  input.response.setHeader('Content-Type', input.contentType);
  input.response.setHeader('Content-Disposition', `attachment; filename="${input.filename}"`);

  if (parsed.mode === 'filesystem') {
    const bytes = await fs.readFile(getFilesystemPath(parsed.key));
    input.response.status(200).send(bytes);
    return;
  }

  ensureBlobEnabled();
  const { get } = await getBlobSdk();
  const blob = await get(parsed.key, { access: 'private' });
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new Error('Stored blob download is unavailable.');
  }

  input.response.status(200);
  const reader = blob.stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        input.response.write(Buffer.from(value));
      }
    }
  } finally {
    reader.releaseLock();
  }

  input.response.end();
}
