'use client';

import type { CSSProperties } from 'react';

import { ExportButton } from '@/components/ExportButton';
import { ImageToggle } from '@/components/ImageToggle';
import type { ExportFormat, ImageMode, ReaderSettings } from '@/lib/types';

type SettingsSidebarProps = {
  title: string;
  byline: string;
  siteName: string;
  publishedTime: string;
  wordCount: number;
  imageCount: number;
  images: ImageMode;
  onImagesChange: (value: ImageMode) => void;
  settings: ReaderSettings;
  onSettingsChange: (settings: ReaderSettings) => void;
  onExport: (format: ExportFormat) => void;
  exporting: Partial<Record<ExportFormat, boolean>>;
  onNewUrl: () => void;
};

export function SettingsSidebar({
  title,
  byline,
  siteName,
  publishedTime,
  wordCount,
  imageCount,
  images,
  onImagesChange,
  settings,
  onSettingsChange,
  onExport,
  exporting,
  onNewUrl,
}: SettingsSidebarProps) {
  function updateSetting<Key extends keyof ReaderSettings>(key: Key, value: ReaderSettings[Key]): void {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <aside className={`theme-${settings.colorTheme} h-full bg-[var(--preview-bg)]`}>
      <div className="hidden h-full w-[280px] overflow-y-auto border-r border-[var(--preview-border)] p-4 md:block">
        <SidebarBody
          title={title}
          byline={byline}
          siteName={siteName}
          publishedTime={publishedTime}
          wordCount={wordCount}
          imageCount={imageCount}
          images={images}
          onImagesChange={onImagesChange}
          settings={settings}
          updateSetting={updateSetting}
          onExport={onExport}
          exporting={exporting}
          onNewUrl={onNewUrl}
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 block border-t border-[var(--preview-border)] bg-[var(--preview-panel)] p-3 md:hidden">
        <details>
          <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--preview-text)]">
            Settings & Export
          </summary>
          <div className="mt-3 max-h-[70vh] overflow-y-auto pr-1">
            <SidebarBody
              title={title}
              byline={byline}
              siteName={siteName}
              publishedTime={publishedTime}
              wordCount={wordCount}
              imageCount={imageCount}
              images={images}
              onImagesChange={onImagesChange}
              settings={settings}
              updateSetting={updateSetting}
              onExport={onExport}
              exporting={exporting}
              onNewUrl={onNewUrl}
            />
          </div>
        </details>
      </div>
    </aside>
  );
}

type SidebarBodyProps = {
  title: string;
  byline: string;
  siteName: string;
  publishedTime: string;
  wordCount: number;
  imageCount: number;
  images: ImageMode;
  onImagesChange: (value: ImageMode) => void;
  settings: ReaderSettings;
  updateSetting: <Key extends keyof ReaderSettings>(key: Key, value: ReaderSettings[Key]) => void;
  onExport: (format: ExportFormat) => void;
  exporting: Partial<Record<ExportFormat, boolean>>;
  onNewUrl: () => void;
};

function SidebarBody({
  title,
  byline,
  siteName,
  publishedTime,
  wordCount,
  imageCount,
  images,
  onImagesChange,
  settings,
  updateSetting,
  onExport,
  exporting,
  onNewUrl,
}: SidebarBodyProps) {
  return (
    <div className="space-y-5 pb-4 text-[var(--preview-text)]">
      <section>
        <h2 className="mb-2 text-lg font-semibold">Article</h2>
        <dl className="space-y-1 text-sm text-[var(--preview-muted)]">
          <div>
            <dt className="font-semibold text-[var(--preview-text)]">Title</dt>
            <dd className="truncate">{title}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--preview-text)]">Author</dt>
            <dd>{byline || 'Unknown'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--preview-text)]">Site</dt>
            <dd>{siteName || 'Unknown'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--preview-text)]">Published</dt>
            <dd>{publishedTime || 'Unknown'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--preview-text)]">Words</dt>
            <dd>{wordCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--preview-text)]">Images</dt>
            <dd>
              {imageCount}
              {imageCount === 0 ? ' (No images found in this article)' : ''}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Images</h3>
        <ImageToggle value={images} onChange={onImagesChange} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Font Face</h3>
        <select
          value={settings.fontFace}
          onChange={(event) => updateSetting('fontFace', event.target.value as ReaderSettings['fontFace'])}
          className="w-full rounded-lg border border-[var(--preview-border)] bg-[var(--preview-panel)] px-3 py-2 text-sm"
        >
          <option value="serif">Serif</option>
          <option value="sans-serif">Sans-serif</option>
          <option value="monospace">Monospace</option>
          <option value="dyslexic">Dyslexic</option>
        </select>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Font Size ({settings.fontSize}px)</h3>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={12}
            max={28}
            step={1}
            value={settings.fontSize}
            onChange={(event) => updateSetting('fontSize', Number(event.target.value))}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => updateSetting('fontSize', 16)}
            className="rounded-md border border-[var(--preview-border)] px-2 py-1 text-xs"
          >
            Reset
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Line Spacing ({settings.lineSpacing.toFixed(1)})</h3>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1.2}
            max={2.4}
            step={0.1}
            value={settings.lineSpacing}
            onChange={(event) => updateSetting('lineSpacing', Number(event.target.value))}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => updateSetting('lineSpacing', 1.6)}
            className="rounded-md border border-[var(--preview-border)] px-2 py-1 text-xs"
          >
            Reset
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Color Theme</h3>
        <div className="grid grid-cols-3 gap-2">
          <ThemeSwatch
            label="Light"
            active={settings.colorTheme === 'light'}
            style={{ background: '#faf9f6', borderColor: '#d4d9da' }}
            onClick={() => updateSetting('colorTheme', 'light')}
          />
          <ThemeSwatch
            label="Dark"
            active={settings.colorTheme === 'dark'}
            style={{ background: '#141b23', borderColor: '#2d3947' }}
            onClick={() => updateSetting('colorTheme', 'dark')}
          />
          <ThemeSwatch
            label="Sepia"
            active={settings.colorTheme === 'sepia'}
            style={{ background: '#f8eedb', borderColor: '#cdbb9f' }}
            onClick={() => updateSetting('colorTheme', 'sepia')}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Export</h3>
        <div className="space-y-2">
          <ExportButton label="Download PDF" onClick={() => onExport('pdf')} loading={!!exporting.pdf} />
          <ExportButton label="Download TXT" onClick={() => onExport('txt')} loading={!!exporting.txt} />
          <ExportButton label="Download Markdown" onClick={() => onExport('md')} loading={!!exporting.md} />
          <ExportButton label="Download DOCX" onClick={() => onExport('docx')} loading={!!exporting.docx} />
        </div>
      </section>

      <button
        type="button"
        onClick={onNewUrl}
        className="w-full rounded-lg border border-[var(--preview-border)] px-3 py-2 text-sm font-semibold text-[var(--preview-text)]"
      >
        New URL
      </button>
    </div>
  );
}

function ThemeSwatch({
  label,
  active,
  style,
  onClick,
}: {
  label: string;
  active: boolean;
  style: CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-2 text-xs font-medium ${
        active ? 'ring-2 ring-[var(--color-accent)] ring-offset-2' : ''
      }`}
      style={style}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
