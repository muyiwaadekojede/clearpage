'use client';

import { useRef, useState } from 'react';

import type { ExportFormat } from '@/lib/types';
import type { BatchItemResult } from '@/components/BatchUrlPanel';

type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';

export type DocumentUploadItem = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  status: UploadStatus;
  progress: number;
  uploadId?: string;
  error?: string;
};

type BatchDocumentPanelProps = {
  accept: string;
  files: DocumentUploadItem[];
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  onSelectFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onSubmit: () => void;
  processing: boolean;
  uploading: boolean;
  downloadingAll: boolean;
  jobId: string;
  processedCount: number;
  totalCount: number;
  successCount: number;
  failureCount: number;
  etaText: string;
  runMessage: string;
  maxFiles: number;
  maxFileBytes: number;
  maxBatchBytes: number;
  results: BatchItemResult[];
  onDownloadOne: (item: BatchItemResult) => void;
  onDownloadAll: () => void;
};

const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'txt', 'md', 'docx'];

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

function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0s';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function circleFill(processedCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  return Math.min(100, Math.round((processedCount / totalCount) * 100));
}

export function BatchDocumentPanel({
  accept,
  files,
  format,
  onFormatChange,
  onSelectFiles,
  onRemoveFile,
  onSubmit,
  processing,
  uploading,
  downloadingAll,
  jobId,
  processedCount,
  totalCount,
  successCount,
  failureCount,
  etaText,
  runMessage,
  maxFiles,
  maxFileBytes,
  maxBatchBytes,
  results,
  onDownloadOne,
  onDownloadAll,
}: BatchDocumentPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const totalSelectedBytes = files.reduce((sum, file) => sum + file.size, 0);
  const uploadedCount = files.filter((file) => file.status === 'uploaded').length;
  const fill = circleFill(processedCount, totalCount);

  function handleDrop(filesToAdd: FileList | null): void {
    if (!filesToAdd || filesToAdd.length === 0) return;
    onSelectFiles(Array.from(filesToAdd));
  }

  return (
    <section className="mt-7 rounded-2xl border border-[var(--color-border)] bg-white p-4 text-left">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 text-sm text-[var(--color-muted)]">
          <p>Technical limits keep batch conversion stable.</p>
          <p>{maxFiles.toLocaleString()} files per batch.</p>
          <p>{formatBytes(maxFileBytes)} per file.</p>
          <p>{formatBytes(maxBatchBytes)} total uploaded bytes.</p>
        </div>

        {(totalCount > 0 || successCount > 0 || failureCount > 0) ? (
          <div className="grid size-16 place-items-center rounded-full border-2 border-[var(--color-border)] bg-white text-center">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{fill}%</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 space-y-4">
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            handleDrop(event.dataTransfer.files);
          }}
          className={`rounded-xl border px-4 py-6 text-center transition ${
            dragActive
              ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
              : 'border-[var(--color-border)] text-[var(--color-muted)]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={(event) => {
              handleDrop(event.target.files);
              event.currentTarget.value = '';
            }}
          />

          <p className="text-sm">Drop documents here or choose files.</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 h-10 rounded-lg border border-[var(--color-border)] bg-white px-4 text-sm font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            Select Files
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="document-batch-format" className="text-sm font-medium text-[var(--color-ink)]">
            Convert to
          </label>
          <select
            id="document-batch-format"
            value={format}
            onChange={(event) => onFormatChange(event.target.value as ExportFormat)}
            className="h-10 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            {EXPORT_FORMATS.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onSubmit}
            disabled={processing || uploading || uploadedCount === 0}
            className="h-10 rounded-lg bg-[var(--color-accent)] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {processing ? 'Processing Batch...' : 'Start Batch'}
          </button>

          <button
            type="button"
            onClick={onDownloadAll}
            disabled={processing || downloadingAll || successCount === 0}
            className="h-10 rounded-lg border border-[var(--color-border)] bg-white px-4 text-sm font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloadingAll ? 'Downloading...' : `Download ${successCount.toLocaleString()}`}
          </button>
        </div>

        <p className="text-xs text-[var(--color-muted)]">
          {files.length.toLocaleString()} selected · {uploadedCount.toLocaleString()} uploaded · {formatBytes(totalSelectedBytes)} total
          {jobId ? ` · Job ${jobId.slice(0, 8)}` : ''}
          {processing ? ` · ETA ${etaText}` : ''}
        </p>

        {runMessage ? <p className="text-xs text-[var(--color-muted)]">{runMessage}</p> : null}

        <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
            <span>Selected files</span>
            <span>{formatBytes(totalSelectedBytes)}</span>
          </div>

          <div className="max-h-64 space-y-2 overflow-auto pr-1">
            {files.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No documents selected yet.</p>
            ) : (
              files.map((file) => (
                <article key={file.id} className="rounded-lg border border-[var(--color-border)] bg-white p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate font-semibold text-[var(--color-ink)]" title={file.name}>
                      {file.name}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        file.status === 'uploaded'
                          ? 'border border-[var(--color-accent)] bg-white text-[var(--color-accent)]'
                          : file.status === 'failed'
                            ? 'border border-red-700 bg-white text-red-700'
                            : 'border border-[var(--color-border)] bg-white text-[var(--color-ink)]'
                      }`}
                    >
                      {file.status === 'queued' ? 'ready' : file.status}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[var(--color-muted)]">
                    <span>{formatBytes(file.size)}</span>
                    {file.status !== 'uploading' ? (
                      <button
                        type="button"
                        onClick={() => onRemoveFile(file.id)}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      >
                        Remove
                      </button>
                    ) : (
                      <span>{file.progress > 0 ? `${Math.round(file.progress)}%` : 'Uploading'}</span>
                    )}
                  </div>

                  {file.error ? <p className="mt-1 break-words text-[11px] text-red-700">{file.error}</p> : null}
                </article>
              ))
            )}
          </div>
        </div>

        {results.length > 0 ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
              <span>Successful: {successCount.toLocaleString()}</span>
              <span>Failed: {failureCount.toLocaleString()}</span>
              <span>Visible: {results.length.toLocaleString()}</span>
            </div>

            <div className="max-h-64 space-y-2 overflow-auto pr-1">
              {results.map((row) => (
                <article key={`${row.originalFilename || row.url}-${row.durationMs}`} className="rounded-lg border border-[var(--color-border)] bg-white p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                      className="min-w-0 flex-1 truncate font-semibold text-[var(--color-ink)]"
                      title={row.originalFilename || row.title || row.url}
                    >
                      {row.originalFilename || row.outputFilename || row.title || row.url}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        row.status === 'success'
                          ? 'border border-[var(--color-accent)] bg-white text-[var(--color-accent)]'
                          : row.status === 'failure'
                            ? 'border border-red-700 bg-white text-red-700'
                            : row.status === 'running'
                              ? 'border border-[var(--color-border)] bg-white text-[var(--color-ink)]'
                              : 'border border-[var(--color-border)] bg-white text-[var(--color-muted)]'
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[var(--color-muted)]">
                    <span>{formatMs(row.durationMs)}</span>
                    {row.status === 'success' && row.outputObjectKey ? (
                      <button
                        type="button"
                        onClick={() => onDownloadOne(row)}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      >
                        Download
                      </button>
                    ) : null}
                  </div>

                  {row.status === 'failure' ? (
                    <p className="mt-1 break-words text-[11px] text-red-700">
                      {row.errorCode || 'DOCUMENT_CONVERSION_FAILED'}: {row.errorMessage || 'Failed to convert file.'}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
