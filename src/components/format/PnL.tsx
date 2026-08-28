import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatMoney } from '../../lib/format';

const SIZE_CLASSES = {
  sm: 'text-[11px]',
  md: 'text-xs',
  lg: 'text-base font-semibold',
} as const;

export interface PnLProps {
  value: number;
  currency?: string;
  /** Show a direction arrow alongside the figure. */
  showIcon?: boolean;
  size?: keyof typeof SIZE_CLASSES;
  compact?: boolean;
  className?: string;
}

/**
 * A profit/loss figure.
 *
 * Colour alone never carries the meaning: the sign is always explicit, and a
 * screen-reader-only "gain"/"loss" word accompanies it. That matters both for
 * accessibility and for the ~8% of readers with a colour-vision deficiency who
 * cannot separate the green and red steps.
 */
export function PnL({
  value,
  currency,
  showIcon = false,
  size = 'md',
  compact = false,
  className,
}: PnLProps) {
  const safe = Number.isFinite(value) ? value : 0;
  const isProfit = safe > 0;
  const isLoss = safe < 0;

  const Icon = isProfit ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono font-semibold tabular-nums',
        SIZE_CLASSES[size],
        isProfit && 'text-profit',
        isLoss && 'text-loss',
        !isProfit && !isLoss && 'text-muted-foreground',
        className
      )}
    >
      {showIcon && safe !== 0 && <Icon className="size-3 shrink-0" aria-hidden="true" />}
      {formatMoney(safe, { currency, signed: true, compact })}
      {safe !== 0 && <span className="sr-only">{isProfit ? ' gain' : ' loss'}</span>}
    </span>
  );
}
