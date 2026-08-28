import { cn } from '@/lib/utils';
import type { ParsedOptionDetails } from '../utils/tastyParser';
import { formatSignedQuantity } from '../lib/format';

export interface ContractPillProps {
  details: ParsedOptionDetails;
  /** Override the quantity shown; defaults to `details.quantity`. */
  quantity?: number;
  showQuantity?: boolean;
  /** Drop the expiry to save horizontal room in dense table cells. */
  compact?: boolean;
  className?: string;
}

/**
 * The option-contract chip — signed quantity, expiry, strike, call/put.
 *
 * Previously duplicated at four call sites in App.tsx with divergent markup.
 * Call/put keeps the established convention: calls green, puts amber.
 */
export function ContractPill({
  details,
  quantity,
  showQuantity = true,
  compact = false,
  className,
}: ContractPillProps) {
  const isShort = details.action === 'STO' || details.action === 'STC';
  const qty = quantity ?? details.quantity;
  const isPut = details.optionTypeShort === 'P';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-[11px] ring-1 ring-border',
        className
      )}
    >
      {showQuantity && (
        <span
          className={cn(
            'font-mono font-bold tabular-nums',
            isShort ? 'text-warning' : 'text-profit'
          )}
        >
          {formatSignedQuantity(qty, isShort)}
        </span>
      )}

      {!compact && details.futureCycle && (
        <span className="rounded bg-surface-3 px-1 font-mono font-bold text-brand">
          {details.futureCycle}
        </span>
      )}

      {!compact && details.expirationFormatted && (
        <span className="font-medium text-muted-foreground">{details.expirationFormatted}</span>
      )}

      {details.strikeFormatted && (
        <span className="font-mono font-bold text-foreground tabular-nums">
          {details.strikeFormatted}
        </span>
      )}

      {details.optionTypeShort && (
        <span
          className={cn(
            'rounded px-1 text-[10px] font-bold',
            isPut ? 'bg-warning/20 text-warning' : 'bg-profit/20 text-profit'
          )}
        >
          {details.optionTypeShort}
          <span className="sr-only"> {isPut ? 'put' : 'call'}</span>
        </span>
      )}
    </span>
  );
}
