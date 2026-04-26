'use client';

type ExportButtonProps = {
  label: string;
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
};

export function ExportButton({ label, onClick, loading, disabled = false }: ExportButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="flex h-11 w-full items-center justify-center rounded-lg border border-[var(--preview-border)] bg-[var(--preview-panel)] px-4 text-sm font-semibold text-[var(--preview-text)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? 'Generating...' : label}
    </button>
  );
}
