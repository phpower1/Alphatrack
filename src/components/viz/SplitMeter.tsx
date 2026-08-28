import { cn } from '@/lib/utils';
import { formatPercent } from '../../lib/format';

export interface SplitMeterProps {
  /** Filled portion. */
  value: number;
  /** Total the value is measured against. */
  total: number;
  tone?: 'brand' | 'profit' | 'loss' | 'warning';
  /** Left-hand caption, e.g. "Cash". */
  label?: string;
  /** Right-hand caption; defaults to the percentage. */
  valueLabel?: string;
  className?: string;
}

const TONE_FILL = {
  brand: 'bg-brand',
  profit: 'bg-profit',
  loss: 'bg-loss',
  warning: 'bg-warning',
} as const;

/**
 * A ratio against a limit — the correct form per the dataviz heuristic (a meter,
 * not a two-slice pie and not a one-bar chart).
 *
 * Used where no history exists to plot: portfolio composition and buying-power
 * utilisation. Deliberately a meter rather than a sparkline, because the app has
 * no time series for those figures and inventing one would be dishonest.
 */
export function SplitMeter({
  value,
  total,
  tone = 'brand',
  label,
  valueLabel,
  className,
}: SplitMeterProps) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const ratio = safeTotal > 0 ? Math.min(1, safeValue / safeTotal) : 0;
  const pct = ratio * 100;

  return (
    <div className={cn('space-y-1', className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ? `${label} share` : 'Share of total'}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', TONE_FILL[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>

      {(label || valueLabel) && (
        <div className="flex items-center justify-between text-[11px]">
          {label && <span className="text-subtle-foreground">{label}</span>}
          <span className="font-mono text-muted-foreground tabular-nums">
            {valueLabel ?? formatPercent(pct, { decimals: 0 })}
          </span>
        </div>
      )}
    </div>
  );
}

export interface WinLossBarProps {
  wins: number;
  losses: number;
  className?: string;
}

/**
 * Two-segment part-to-whole bar. A 2px surface gap separates the segments per
 * the mark spec, so adjacent fills never read as one block.
 */
export function WinLossBar({ wins, losses, className }: WinLossBarProps) {
  const total = wins + losses;
  if (total <= 0) return null;

  const winPct = (wins / total) * 100;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-profit"
          style={{ width: `${winPct}%` }}
          aria-hidden="true"
        />
        <div className="h-full flex-1 rounded-full bg-loss" aria-hidden="true" />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono text-profit tabular-nums">{wins} up</span>
        <span className="font-mono text-loss tabular-nums">{losses} down</span>
      </div>
    </div>
  );
}
