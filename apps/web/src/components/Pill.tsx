import clsx from 'clsx';

const map: Record<string, string> = {
  IN_STOCK: 'pill-blue', ALLOCATED: 'pill-slate', IN_STORE: 'pill-green',
  IN_TRANSIT: 'pill-amber', REPAIR: 'pill-amber', DAMAGED: 'pill-red',
  LOST: 'pill-red', WRITTEN_OFF: 'pill-slate', DISPOSED: 'pill-slate',
  INSTALLED: 'pill-green', PARTIAL: 'pill-amber', MISSING: 'pill-red',
  REQUESTED: 'pill-slate', APPROVED: 'pill-blue', DISPATCHED: 'pill-amber',
  RECEIVED: 'pill-green', CONFIRMED: 'pill-green', DRAFT: 'pill-slate',
};

export function Pill({ status }: { status: string }) {
  return <span className={clsx(map[status] ?? 'pill-slate')}>{status.replaceAll('_',' ')}</span>;
}
