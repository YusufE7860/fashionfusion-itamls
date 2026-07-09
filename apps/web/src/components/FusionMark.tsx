import clsx from 'clsx';

/**
 * Displays the official Fashion Fusion logo image.
 * Expects the file at /public/fusion-logo.png (served at /fusion-logo.png).
 */
export function FusionMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}) {
  const h = {
    sm:  'h-10',
    md:  'h-16',
    lg:  'h-24',
    xl:  'h-32',
    '2xl': 'h-44',
  }[size];
  return (
    <img
      src="/fusion-logo.png"
      alt="Fashion Fusion"
      className={clsx(h, 'w-auto select-none', className)}
      draggable={false}
    />
  );
}
