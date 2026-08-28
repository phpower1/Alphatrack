import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import type { ParsedOptionDetails } from '../utils/tastyParser';

type Action = ParsedOptionDetails['action'];

/**
 * The BTO/STO/BTC/STC colour mapping, previously duplicated across three call
 * sites in App.tsx with slightly different class strings each time.
 *
 * Semantics preserved from the original: opening long = profit green, opening
 * short = warning amber, closing long = info cyan, closing short = loss rose,
 * lifecycle events = neutral.
 */
const actionBadgeVariants = cva(
  'inline-flex items-center rounded font-mono font-semibold border whitespace-nowrap',
  {
    variants: {
      tone: {
        long: 'bg-profit/10 text-profit border-profit/30',
        short: 'bg-warning/10 text-warning border-warning/30',
        closeLong: 'bg-info/10 text-info border-info/30',
        closeShort: 'bg-loss/10 text-loss border-loss/30',
        neutral: 'bg-surface-3 text-muted-foreground border-border',
      },
      size: {
        xs: 'px-1.5 py-0.5 text-[10px]',
        sm: 'px-2 py-0.5 text-[11px]',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  }
);

const ACTION_TONE: Record<Action, VariantProps<typeof actionBadgeVariants>['tone']> = {
  BTO: 'long',
  Buy: 'long',
  STO: 'short',
  BTC: 'closeLong',
  STC: 'closeShort',
  Sell: 'closeShort',
  EXPIRED: 'neutral',
  ASSIGNED: 'neutral',
};

/** Spelled-out form for screen readers — the abbreviations are opaque. */
const ACTION_LABEL: Record<Action, string> = {
  BTO: 'Bought to open',
  STO: 'Sold to open',
  BTC: 'Bought to close',
  STC: 'Sold to close',
  Buy: 'Bought',
  Sell: 'Sold',
  EXPIRED: 'Expired',
  ASSIGNED: 'Assigned',
};

export interface ActionBadgeProps {
  action: Action;
  size?: VariantProps<typeof actionBadgeVariants>['size'];
  className?: string;
}

export function ActionBadge({ action, size = 'sm', className }: ActionBadgeProps) {
  return (
    <span
      className={cn(actionBadgeVariants({ tone: ACTION_TONE[action], size }), className)}
      title={ACTION_LABEL[action]}
    >
      {action}
      <span className="sr-only"> ({ACTION_LABEL[action]})</span>
    </span>
  );
}

export { actionBadgeVariants };
