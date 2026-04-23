'use client';

import type { ImageMode } from '@/lib/types';

type ImageToggleProps = {
  value: ImageMode;
  onChange: (value: ImageMode) => void;
};

const OPTIONS: Array<{ label: string; value: ImageMode }> = [
  { label: 'On', value: 'on' },
  { label: 'Off', value: 'off' },
  { label: 'Captions', value: 'captions' },
];

export function ImageToggle({ value, onChange }: ImageToggleProps) {
  return (
    <div className="rounded-xl border border-[var(--preview-border)] bg-[var(--preview-bg)] p-1">
      <div className="grid grid-cols-3 gap-1">
        {OPTIONS.map((option) => {
          const active = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
                active
                  ? 'bg-[var(--color-accent)] text-white shadow-sm'
                  : 'text-[var(--preview-text)] hover:bg-[color:color-mix(in_srgb,var(--preview-text)_8%,transparent)]'
              }`}
              aria-pressed={active}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
