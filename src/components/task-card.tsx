export type DeadlineVariant = "red" | "yellow" | "green";

const deadlineStyles: Record<DeadlineVariant, string> = {
  red: "bg-red-50 text-[var(--color-deadline-red)]",
  yellow: "bg-amber-50 text-[var(--color-deadline-yellow)]",
  green: "bg-emerald-50 text-[var(--color-deadline-green)]",
};

export function DeadlineBadge({ variant, label }: { variant: DeadlineVariant; label: string }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${deadlineStyles[variant]}`}>
      {label}
    </span>
  );
}

export function SharedBadge() {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]">
      Shared
    </span>
  );
}

export function TaskCard({
  title,
  deadline,
  deadlineVariant,
  workspace,
  shared,
}: {
  title: string;
  deadline: string;
  deadlineVariant: DeadlineVariant;
  workspace: string;
  shared?: boolean;
}) {
  return (
    <div
      className="bg-[var(--color-surface)] rounded-[11px] border border-[var(--color-border)] px-4 py-3 flex items-center gap-3"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="flex-shrink-0">
        <circle cx="9" cy="9" r="7.5" stroke="var(--color-border)" strokeWidth="1.8"/>
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{title}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <DeadlineBadge variant={deadlineVariant} label={deadline} />
          {shared && <SharedBadge />}
          <span className="text-[11px] text-[var(--color-text-muted)]">{workspace}</span>
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--color-text-muted)" aria-hidden="true" className="flex-shrink-0">
        <circle cx="5" cy="4" r="1.2"/><circle cx="9" cy="4" r="1.2"/>
        <circle cx="5" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/>
        <circle cx="5" cy="10" r="1.2"/><circle cx="9" cy="10" r="1.2"/>
      </svg>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="var(--color-accent-subtle)"/>
        <path d="M20 38 Q26 26 32 30 Q38 34 44 22" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="20" cy="38" r="2.5" fill="var(--color-accent)" opacity="0.4"/>
        <circle cx="32" cy="30" r="2.5" fill="var(--color-accent)" opacity="0.65"/>
        <circle cx="44" cy="22" r="2.5" fill="var(--color-accent)"/>
        <path d="M24 46h16" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
        <path d="M27 51h10" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <p className="text-sm text-[var(--color-text-muted)]">
        No tasks yet.<br/>Add one to get started.
      </p>
    </div>
  );
}
