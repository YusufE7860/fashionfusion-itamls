import { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6">
      <div className="min-w-0">
        <div className="mb-1 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-400">
          <span className="inline-block h-1 w-6 rounded-full bg-brand-500 shadow-[0_0_8px_rgba(254,102,32,0.6)]" />
          ITAMLS
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-200">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
