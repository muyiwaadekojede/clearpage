'use client';

import { useRef } from 'react';

import type { ExportFormat } from '@/lib/types';

export type BatchItemResult = {
  id?: number;
  url: string;
  status: 'pending' | 'running' | 'success' | 'failure';
  durationMs: number;
  extractionId?: string;
  sourceUrl?: string;
  title?: string;
  originalFilename?: string;
  contentType?: string;
  byteSize?: number;
  sourceObjectKey?: string;
  outputObjectKey?: string;
  outputFilename?: string;
  outputFormat?: string;
  errorCode?: string;
  errorMessage?: string;
};

type BatchUrlPanelProps = {
  urlsInput: string;
  onUrlsInputChange: (value: string) => void;
  onSubmit: () => void;
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  processing: boolean;
  downloadingAll: boolean;
  jobId: string;
  parsedCount: number;
  maxUrls: number;
  processedCount: number;
  totalCount: number;
  successCount: number;
  failureCount: number;
  etaText: string;
  downloadEstimateText: string;
  runMessage: string;
  results: BatchItemResult[];
  onDownloadOne: (item: BatchItemResult) => void;
  onDownloadAll: () => void;
};

const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'txt', 'md', 'docx'];

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

export function BatchUrlPanel({
  urlsInput,
  onUrlsInputChange,
  onSubmit,
  format,
  onFormatChange,
  processing,
  downloadingAll,
  jobId,
  parsedCount,
  maxUrls,
  processedCount,
  totalCount,
  successCount,
  failureCount,
  etaText,
  downloadEstimateText,
  runMessage,
  results,
  onDownloadOne,
  onDownloadAll,
}: BatchUrlPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fill = circleFill(processedCount, totalCount);
  const tooManyUrls = parsedCount > maxUrls;

  async function importUrlsFromFile(file: File): Promise<void> {
    const text = await file.text();
    const joined = urlsInput.trim().length > 0 ? `${urlsInput}\n${text}` : text;
    onUrlsInputChange(joined);
  }

  const visibleSuccessCount = results.filter((row) => row.status === 'success').length;
  const showProgress = totalCount > 0 || processedCount > 0 || results.length > 0;

  return (
    <section className="mt-7 rounded-2xl border border-[var(--color-border)] bg-white p-4 text-left">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-[var(--color-muted)]">Limit: {maxUrls.toLocaleString()} URLs per batch.</p>

        {showProgress ? (
          <div className="grid size-16 place-items-center rounded-full border-2 border-[var(--color-border)] bg-white text-center">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{fill}%</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        <label htmlFor="batch-urls" className="text-xs font-semibold text-[var(--color-muted)]">
          URLs
        </label>
        <textarea
          id="batch-urls"
          value={urlsInput}
          onChange={(event) => onUrlsInputChange(event.target.value)}
          placeholder="https://example.com/article-1&#10;https://example.com/article-2"
          rows={6}
          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-accent)]"
        />

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <span>
            {parsedCount.toLocaleString()} / {maxUrls.toLocaleString()} URLs
          </span>
          {jobId ? <span aria-hidden="true">|</span> : null}
          {jobId ? <span>Job {jobId.slice(0, 8)}</span> : null}
          {processing ? <span aria-hidden="true">|</span> : null}
          {processing ? <span>ETA {etaText}</span> : null}
          {!processing && successCount > 0 ? <span aria-hidden="true">|</span> : null}
          {!processing && successCount > 0 ? <span>Download est. {downloadEstimateText}</span> : null}
        </div>

        {tooManyUrls ? (
          <p className="text-xs font-medium text-red-700">
            URL count exceeds the batch cap. Remove some links before starting.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="batch-format" className="text-sm font-medium text-[var(--color-ink)]">
            Format
          </label>
          <select
            id="batch-format"
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

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.md,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void importUrlsFromFile(file);
              event.currentTarget.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-10 rounded-lg border border-[var(--color-border)] bg-white px-4 text-sm font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            Import
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={processing || parsedCount === 0 || tooManyUrls}
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

        {processing || runMessage ? (
          <p className="text-xs text-[var(--color-muted)]">
            {processing
              ? `Processed ${processedCount.toLocaleString()} of ${totalCount.toLocaleString()}`
              : runMessage}
          </p>
        ) : null}
      </div>

      {results.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
            <span>Successful: {successCount.toLocaleString()}</span>
            <span>Failed: {failureCount.toLocaleString()}</span>
            <span>Visible: {results.length.toLocaleString()}</span>
          </div>

          <div className="max-h-64 space-y-2 overflow-auto pr-1">
            {results.slice(0, 400).map((row) => (
              <article
                key={row.url}
                className="rounded-lg border border-[var(--color-border)] bg-white p-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-semibold text-[var(--color-ink)]" title={row.url}>
                    {row.url}
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
                  {row.status === 'success' && (row.extractionId || row.sourceUrl) ? (
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
                    {row.errorCode || 'EXTRACTION_FAILED'}: {row.errorMessage || 'Failed to process URL.'}
                  </p>
                ) : null}
              </article>
            ))}
          </div>

          {results.length > 400 ? (
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              Showing first 400 rows for readability.
            </p>
          ) : null}
          {successCount > visibleSuccessCount ? (
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              More successful rows exist outside the visible page.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

