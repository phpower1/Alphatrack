import { cn } from '@/lib/utils';
import { formatPercent, type FormatPercentOptions } from '../../lib/format';

export interface PercentProps extends FormatPercentOptions {
  /** Already in percent units — 12.5 renders as 12.5%. */
  value: number;
  /** Colour by sign. Always pair with `signed` so colour is never the only cue. */
  colored?: boolean;
  inline?: boolean;
  className?: string;
}

export function Percent({
  value,
  colored = false,
  inline = false,
  className,
  ...formatOptions
}: PercentProps) {
  const safe = Number.isFinite(value) ? value : 0;

  return (
    <span
      className={cn(
        !inline && 'font-mono tabular-nums',
        colored && (safe > 0 ? 'text-profit' : safe < 0 ? 'text-loss' : 'text-muted-foreground'),
        className
      )}
    >
      {formatPercent(safe, formatOptions)}
    </span>
  );
}
