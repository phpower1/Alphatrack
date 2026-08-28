import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'size-3.5',
  md: 'size-5',
  lg: 'size-8',
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  className?: string;
  /** Announced to screen readers; omit only when a sibling already labels it. */
  label?: string;
}

/**
 * Loading spinner.
 *
 * Uses `Loader2` — the app previously spun `Activity`, a heartbeat/pulse glyph,
 * in eight places, which reads as a broken icon rather than a loading state.
 */
export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  return (
    <>
      <Loader2
        className={cn('animate-spin text-brand', SIZES[size], className)}
        aria-hidden="true"
      />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}

export interface LoadingBlockProps {
  message?: string;
  className?: string;
}

/** Centred spinner + message, for filling a panel or table body. */
export function LoadingBlock({ message = 'Loading…', className }: LoadingBlockProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 p-12', className)}
      role="status"
      aria-live="polite"
    >
      <Spinner size="md" label="" />
      <span className="text-xs text-muted-foreground">{message}</span>
    </div>
  );
}
