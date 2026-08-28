import type { LucideIcon } from 'lucide-react';
import { Info } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const ACCENT_ICON = {
  neutral: 'text-subtle-foreground',
  brand: 'text-brand',
  profit: 'text-profit',
  loss: 'text-loss',
  warning: 'text-warning',
} as const;

const ACCENT_VALUE = {
  neutral: 'text-foreground',
  brand: 'text-foreground',
  profit: 'text-profit',
  loss: 'text-loss',
  warning: 'text-warning',
} as const;

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  accent?: keyof typeof ACCENT_ICON;
  /** Secondary line under the value. */
  footer?: React.ReactNode;
  /** Sparkline or meter slot. */
  viz?: React.ReactNode;
  loading?: boolean;
  /**
   * Marks the figure as derived rather than reported by the broker.
   *
   * The app synthesises some values (a theta-decay price estimate, and a flat
   * 5% assumption for open trades with no matching position). Those must not
   * masquerade as broker-reported numbers.
   */
  estimated?: boolean;
  className?: string;
}

/**
 * A stat tile — value, optional delta, optional sparkline. Replaces four
 * copy-pasted card blocks in App.tsx.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  accent = 'neutral',
  footer,
  viz,
  loading = false,
  estimated = false,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-2 rounded-xl bg-card p-5 ring-1 ring-border',
        'transition-colors hover:ring-foreground/15',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {estimated && (
            <span
              className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning ring-1 ring-warning/25"
              title="Derived from available data, not reported directly by the broker"
            >
              <Info className="size-2.5" aria-hidden="true" />
              Est.
            </span>
          )}
          {Icon && <Icon className={cn('size-4 shrink-0', ACCENT_ICON[accent])} aria-hidden="true" />}
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-8 w-32" />
      ) : (
        <div
          className={cn(
            'font-mono text-2xl font-bold tabular-nums',
            ACCENT_VALUE[accent]
          )}
        >
          {value}
        </div>
      )}

      {viz && !loading && <div className="pt-1">{viz}</div>}

      {footer && !loading && (
        <div className="text-xs text-subtle-foreground">{footer}</div>
      )}

      {loading && footer && <Skeleton className="h-3 w-24" />}
    </div>
  );
}
