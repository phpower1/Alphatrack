import { cn } from '@/lib/utils';
import { formatMoney, type FormatMoneyOptions } from '../../lib/format';

export interface MoneyProps extends FormatMoneyOptions {
  value: number;
  /** Colour by sign. Always pair with `signed` so colour is never the only cue. */
  colored?: boolean;
  /** Suppress the tabular-nums / mono treatment (e.g. inside prose). */
  inline?: boolean;
  className?: string;
}

/**
 * Renders a currency figure. Use this instead of building strings by hand —
 * it is what keeps losses reading `-$45.20` rather than `$-45.20`.
 */
export function Money({
  value,
  colored = false,
  inline = false,
  className,
  ...formatOptions
}: MoneyProps) {
  const safe = Number.isFinite(value) ? value : 0;

  return (
    <span
      className={cn(
        !inline && 'font-mono tabular-nums',
        colored && (safe > 0 ? 'text-profit' : safe < 0 ? 'text-loss' : 'text-muted-foreground'),
        className
      )}
    >
      {formatMoney(safe, formatOptions)}
    </span>
  );
}
