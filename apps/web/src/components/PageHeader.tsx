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
    <div className="mb-4 flex flex-col gap-3 md:mb-8 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0">
        <div className="mb-1 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-600">
          <span className="inline-block h-1 w-6 rounded-full bg-brand-500" />
          ITAMLS
        </div>
        <h1 className="font-display text-xl font-bold tracking-tight text-ink-50 md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-ink-300 md:text-sm">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 md:flex-shrink-0 md:flex-nowrap">
          {actions}
        </div>
      )}
    </div>
  );
}
