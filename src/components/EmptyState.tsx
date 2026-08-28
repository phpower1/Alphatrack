import { Inbox, SearchX, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /**
   * `no-data` = nothing has been synced yet (offer an action).
   * `no-results` = data exists but the filter excluded all of it (offer a reset).
   *
   * The app previously used one sentence for both, so users couldn't tell an
   * empty portfolio from an over-narrow search.
   */
  variant?: 'no-data' | 'no-results';
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  size?: 'sm' | 'md';
  className?: string;
}

export function EmptyState({
  variant = 'no-data',
  icon,
  title,
  body,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  const Icon = icon ?? (variant === 'no-results' ? SearchX : Inbox);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'gap-3 p-12' : 'gap-2 p-8',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-xl bg-surface-2 text-subtle-foreground ring-1 ring-border',
          size === 'md' ? 'size-12' : 'size-10'
        )}
        aria-hidden="true"
      >
        <Icon className={size === 'md' ? 'size-5' : 'size-4'} />
      </div>

      <div className="space-y-1">
        <p className={cn('font-medium text-foreground', size === 'md' ? 'text-sm' : 'text-xs')}>
          {title}
        </p>
        {body && (
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-muted-foreground">{body}</p>
        )}
      </div>

      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}
