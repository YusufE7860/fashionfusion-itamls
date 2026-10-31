import React from 'react';

/**
 * ResponsiveTable — renders a classic table on >= md screens, and a stack
 * of cards on mobile. Each column tells the table how to render the cell
 * both as a td and as a card row.
 *
 * Usage:
 *   <ResponsiveTable
 *     rows={data}
 *     keyFn={(r) => r.id}
 *     columns={[
 *       { label: 'Name',     render: (r) => r.name,            primary: true },
 *       { label: 'Store',    render: (r) => r.store?.code },
 *       { label: 'Status',   render: (r) => <StatusPill s={r.status} /> },
 *     ]}
 *     onRowClick={(r) => nav(`/items/${r.id}`)}
 *   />
 *
 * `primary` marks the lead cell: on mobile it's rendered as the card title
 * instead of in a label/value grid.
 */
export interface ResponsiveColumn<T> {
  label: string;
  render: (row: T) => React.ReactNode;
  primary?: boolean;    // bigger text on mobile card
  align?: 'left' | 'right' | 'center';
  hideOnMobile?: boolean;
  className?: string;
}

export function ResponsiveTable<T>({
  rows, columns, keyFn, onRowClick, emptyLabel = 'No rows',
}: {
  rows: T[];
  columns: ResponsiveColumn<T>[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyLabel?: string;
}) {
  if (!rows.length) {
    return <div className="p-6 text-center text-xs text-ink-300">{emptyLabel}</div>;
  }
  return (
    <>
      {/* Desktop table */}
      <table className="hidden w-full md:table">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={`th text-${c.align ?? 'left'} ${c.className ?? ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={keyFn(r)}
              className={`border-t border-ink-500/10 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c, i) => (
                <td key={i} className={`td text-${c.align ?? 'left'} ${c.className ?? ''}`}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => {
          const primary = columns.find((c) => c.primary);
          const others  = columns.filter((c) => !c.primary && !c.hideOnMobile);
          return (
            <li key={keyFn(r)}
              className={`rounded-xl border border-ink-500/10 bg-white p-3 shadow-sm ${onRowClick ? 'active:bg-slate-50' : ''}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {primary && (
                <div className="mb-2 text-base font-semibold text-ink-50">
                  {primary.render(r)}
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {others.map((c, i) => (
                  <React.Fragment key={i}>
                    <dt className="text-ink-300">{c.label}</dt>
                    <dd className={`text-${c.align === 'right' ? 'right' : 'left'}`}>{c.render(r)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
