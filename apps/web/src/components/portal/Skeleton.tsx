/** Lightweight shimmer placeholders used by the Store Portal while
 *  queries load. Preferred over "Loading..." text - makes the app feel
 *  faster even before the real data arrives. */
export function SkeletonLine({ w = 'w-full', h = 'h-3' }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} rounded bg-slate-200/70 dark:bg-slate-700/60 animate-pulse`} />;
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2">
      <SkeletonLine w="w-1/3" h="h-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} w={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

/** Soft-tinted icon badge used in the issue picker and anywhere else we
 *  want an iconographic group label. */
export function IconBadge({ icon, tone = 'slate', size = 'md' }: {
  icon: React.ReactNode;
  tone?: 'slate'|'sky'|'amber'|'emerald'|'rose'|'violet'|'cyan'|'pink'|'orange';
  size?: 'sm'|'md'|'lg';
}) {
  const bg = {
    slate:   'bg-slate-100   text-slate-600   dark:bg-slate-800   dark:text-slate-300',
    sky:     'bg-sky-50      text-sky-600     dark:bg-sky-900/40  dark:text-sky-300',
    amber:   'bg-amber-50    text-amber-600   dark:bg-amber-900/40 dark:text-amber-300',
    emerald: 'bg-emerald-50  text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
    rose:    'bg-rose-50     text-rose-600    dark:bg-rose-900/40 dark:text-rose-300',
    violet:  'bg-violet-50   text-violet-600  dark:bg-violet-900/40 dark:text-violet-300',
    cyan:    'bg-cyan-50     text-cyan-600    dark:bg-cyan-900/40 dark:text-cyan-300',
    pink:    'bg-pink-50     text-pink-600    dark:bg-pink-900/40 dark:text-pink-300',
    orange:  'bg-orange-50   text-orange-600  dark:bg-orange-900/40 dark:text-orange-300',
  }[tone];
  const dim = size === 'lg' ? 'h-10 w-10' : size === 'sm' ? 'h-6 w-6' : 'h-8 w-8';
  return <span className={`flex ${dim} flex-shrink-0 items-center justify-center rounded-lg ${bg}`}>{icon}</span>;
}
