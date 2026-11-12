import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * RandInput — one place to enter money across the whole app.
 *
 * Why:
 *   - The backend stores money as integer cents (correct for accuracy; no
 *     floating-point error on totals).
 *   - Humans type rand with decimals. Asking an operator to multiply by
 *     100 — or showing "5000" for "R 50.00" — is a UX trap we kept falling
 *     into.
 *   - Browsers render <input type="number"> with ugly spin-arrows, and
 *     intercept wheel scroll while the field is focused. Using a text input
 *     with `inputmode="decimal"` keeps the mobile numeric keypad but drops
 *     the arrows and the wheel trap.
 *
 * API:
 *   - `valueCents` is the canonical model value (integer cents). Always
 *     integer; undefined = empty.
 *   - `onChangeCents` fires with the new integer cents (or undefined when
 *     the user clears the field).
 *   - While the field has focus, we show exactly what the operator typed
 *     (including a trailing ".", in-progress digits, etc.) so the caret
 *     doesn't jump. On blur we re-format to two-decimal rand.
 *
 * Use it as a drop-in replacement wherever a cents field used to live:
 *
 *   <RandInput valueCents={line.estUnitCostCents}
 *     onChangeCents={(v) => setLine({ ...line, estUnitCostCents: v ?? 0 })} />
 */
export function RandInput({
  valueCents,
  onChangeCents,
  placeholder,
  className,
  disabled,
  autoFocus,
  prefix = 'R',
  allowEmpty = false,
}: {
  valueCents: number | undefined | null;
  onChangeCents: (next: number | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  prefix?: string;
  allowEmpty?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft]     = useState<string>(centsToDraft(valueCents));

  // When the model value changes from the outside (not from our own edit),
  // re-sync the draft. Skip while focused so we don't fight the typist.
  useEffect(() => {
    if (!focused) setDraft(centsToDraft(valueCents));
  }, [valueCents, focused]);

  const displayed = focused ? draft : prettyRand(valueCents, allowEmpty);

  return (
    <div className={clsx('flex items-stretch rounded border border-ink-500/30 bg-white', disabled && 'opacity-60', className)}>
      <span className="grid place-items-center px-2 text-xs font-semibold text-ink-300 border-r border-ink-500/20 bg-slate-50">
        {prefix}
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="w-full bg-transparent px-2 py-1 text-right text-sm outline-none focus:ring-0"
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder ?? '0.00'}
        value={displayed}
        onFocus={() => { setFocused(true); setDraft(centsToDraft(valueCents)); }}
        onBlur={() => {
          setFocused(false);
          const cents = parseDraftToCents(draft);
          if (cents === undefined && allowEmpty) onChangeCents(undefined);
          else onChangeCents(cents ?? 0);
        }}
        onChange={(e) => {
          // Accept digits, up to one dot, up to two decimals. Allow
          // in-progress typing (e.g. "12." or "12.4") without immediately
          // mangling the caret.
          const raw = e.target.value.replace(/[^\d.]/g, '');
          const [intPart, decRaw = ''] = raw.split('.');
          const dec = decRaw.slice(0, 2);
          const cleaned = raw.includes('.') ? `${intPart}.${dec}` : intPart;
          setDraft(cleaned);
          const cents = parseDraftToCents(cleaned);
          if (cents === undefined && allowEmpty) {
            onChangeCents(undefined);
          } else if (cents !== undefined) {
            onChangeCents(cents);
          }
        }}
      />
    </div>
  );
}

/**
 * NumInput — integer-only text input. Replaces number spin boxes used for
 * quantities, counts, warranty months, days-of-week, percentages, etc.
 * Keeps the mobile numeric keypad via inputMode="numeric" but drops the
 * spinner arrows that `<input type="number">` renders.
 */
export function NumInput({
  value,
  onChange,
  min,
  max,
  placeholder,
  className,
  disabled,
  autoFocus,
}: {
  value: number | undefined | null;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={clsx('field', className)}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        // Allow typing "-" temporarily, then coerce on commit.
        let raw = e.target.value.replace(/[^\d-]/g, '');
        if (raw === '' || raw === '-') { onChange(0); return; }
        let n = parseInt(raw, 10);
        if (!Number.isFinite(n)) n = 0;
        if (min !== undefined && n < min) n = min;
        if (max !== undefined && n > max) n = max;
        onChange(n);
      }}
    />
  );
}

function centsToDraft(cents: number | undefined | null): string {
  if (cents == null) return '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rem   = abs % 100;
  const sign  = cents < 0 ? '-' : '';
  if (rem === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(rem).padStart(2, '0')}`;
}

function parseDraftToCents(draft: string): number | undefined {
  if (!draft || draft === '-' || draft === '.') return undefined;
  const n = Number(draft);
  if (!Number.isFinite(n)) return undefined;
  // Round to the nearest cent to avoid the classic 0.1 + 0.2 float story.
  return Math.round(n * 100);
}

function prettyRand(cents: number | undefined | null, allowEmpty: boolean): string {
  if (cents == null) return allowEmpty ? '' : '0.00';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rem   = abs % 100;
  const formatted = `${whole.toLocaleString('en-ZA')}.${String(rem).padStart(2, '0')}`;
  return cents < 0 ? `-${formatted}` : formatted;
}
