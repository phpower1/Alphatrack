import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertCircle,
  Building2,
  FlaskConical,
  LogOut,
  PlusCircle,
  RefreshCw,
  TrendingUp,
  User as UserIcon,
} from 'lucide-react';
import type { User } from 'firebase/auth';

import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Spinner } from '../Spinner';
import { formatMoney } from '../../lib/format';
import type { BrokerageConnection, SnapTradeAccount } from '../../types';

export interface AppHeaderProps {
  user: User;
  accounts: SnapTradeAccount[];
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
  connections: BrokerageConnection[];
  tastyConnected: boolean;
  dbError: string | null;
  /** True when the server is serving mock fixtures rather than live broker data. */
  isDemoData: boolean;
  refreshing: boolean;
  lastSyncedAt: number | null;
  onRefresh: () => void;
  onOpenTastyDialog: () => void;
  onOpenConnectionsDialog: () => void;
  onOpenConnectionPortal: () => void;
  onSignOut: () => void;
}

/** Re-renders periodically so the "synced Nm ago" label stays truthful. */
function useTicker(intervalMs: number, enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
}

function Avatar({ user, size }: { user: User; size: 'sm' | 'lg' }) {
  const dimension = size === 'sm' ? 'size-6' : 'size-10';
  const rounding = size === 'sm' ? 'rounded-lg' : 'rounded-xl';

  if (user.photoURL) {
    return (
      <img
        src={user.photoURL}
        alt=""
        className={cn(dimension, rounding, 'object-cover')}
      />
    );
  }

  return (
    <div
      className={cn(
        dimension,
        rounding,
        'flex items-center justify-center bg-gradient-to-br from-brand to-strategy font-bold text-white',
        size === 'sm' ? 'text-[11px]' : 'text-sm'
      )}
      aria-hidden="true"
    >
      {user.email ? user.email[0].toUpperCase() : <UserIcon className="size-4" />}
    </div>
  );
}

function MenuRow({
  icon,
  iconTone,
  title,
  description,
  trailing,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  iconTone: string;
  title: string;
  description: string;
  trailing?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-2 p-2.5 text-left ring-1 ring-border transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg ring-1',
            iconTone
          )}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-foreground">{title}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{description}</span>
        </span>
      </span>
      {trailing}
    </button>
  );
}

export function AppHeader({
  user,
  accounts,
  selectedAccountId,
  onSelectAccount,
  connections,
  tastyConnected,
  dbError,
  isDemoData,
  refreshing,
  lastSyncedAt,
  onRefresh,
  onOpenTastyDialog,
  onOpenConnectionsDialog,
  onOpenConnectionPortal,
  onSignOut,
}: AppHeaderProps) {
  useTicker(30_000, lastSyncedAt !== null);

  const needsReauth = connections.some((c) => c.disabled);
  const brokerCount = connections.length || accounts.length;

  const accountLabel = (id: string) => {
    if (id === 'ALL') {
      return `All accounts (${accounts.length})`;
    }
    const account = accounts.find((a) => a.id === id);
    if (!account) return 'Select account';
    return `${account.institution_name} · ${account.name || account.number}`;
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-1/85 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand-fill/20 ring-1 ring-brand/30">
            <TrendingUp className="size-4 text-brand" aria-hidden="true" />
          </div>
          <span className="font-heading text-lg font-extrabold tracking-tight text-foreground">
            Alphatrack
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          {isDemoData && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-strategy/10 px-2.5 py-1 text-[11px] font-medium text-strategy ring-1 ring-strategy/25">
              <FlaskConical className="size-3" aria-hidden="true" />
              Demo data
            </span>
          )}

          {needsReauth && (
            <button
              type="button"
              onClick={onOpenConnectionsDialog}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs text-warning ring-1 ring-warning/30 transition-colors hover:bg-warning/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <AlertCircle className="size-3.5" aria-hidden="true" />
              Broker re-auth needed
            </button>
          )}

          {dbError && (
            <span className="hidden truncate rounded-full bg-warning/10 px-3 py-1 text-xs text-warning ring-1 ring-warning/20 md:block">
              {dbError}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {accounts.length > 0 && (
          <Select
            value={selectedAccountId}
            onValueChange={(value) => onSelectAccount(String(value))}
          >
            <SelectTrigger
              size="sm"
              aria-label="Select brokerage account"
              className="max-w-[15rem] text-xs"
            >
              <SelectValue>{(value) => accountLabel(String(value))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">
                <span className="flex w-full items-center justify-between gap-3">
                  <span>All accounts</span>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {accounts.length} {accounts.length === 1 ? 'broker' : 'brokers'}
                  </span>
                </span>
              </SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="truncate">
                      {account.institution_name} · {account.name || account.number}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {formatMoney(account.balance?.total?.amount || 0, {
                        currency: account.balance?.total?.currency,
                        decimals: 0,
                      })}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Refresh moved out of the dropdown — it was two clicks deep, with no
            indication of when data was last synced. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  aria-label={refreshing ? 'Syncing portfolio data' : 'Sync portfolio data'}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-border transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
                >
                  {refreshing ? (
                    <Spinner size="sm" label="" />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  )}
                  <span className="hidden font-mono tabular-nums sm:inline">
                    {refreshing
                      ? 'Syncing…'
                      : lastSyncedAt
                        ? formatDistanceToNow(lastSyncedAt, { addSuffix: true })
                        : 'Sync'}
                  </span>
                </button>
              }
            />
            <TooltipContent>
              {lastSyncedAt
                ? `Last synced ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}`
                : 'Not synced yet'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Account and broker settings"
                className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-surface-2 px-2 py-1.5 ring-1 ring-border transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-expanded:bg-surface-3 aria-expanded:ring-brand/50"
              >
                <span className="relative">
                  <Avatar user={user} size="sm" />
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface-1',
                      needsReauth ? 'bg-warning' : tastyConnected ? 'bg-profit' : 'bg-brand'
                    )}
                    aria-hidden="true"
                  />
                </span>
                <span className="hidden flex-col items-start leading-tight sm:flex">
                  <span className="max-w-[130px] truncate text-xs font-semibold text-foreground">
                    {user.displayName || user.email?.split('@')[0] || 'Trader'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {brokerCount} {brokerCount === 1 ? 'broker' : 'brokers'}
                  </span>
                </span>
              </button>
            }
          />

          <DropdownMenuContent align="end" sideOffset={8} className="w-80 space-y-2 p-3">
            <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5 ring-1 ring-border">
              <Avatar user={user} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-foreground">
                  {user.displayName || user.email?.split('@')[0] || 'Trading Account'}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-profit" aria-hidden="true" />
                  <span className="text-[10px] font-medium text-profit">Authenticated</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-subtle-foreground">
                Broker integrations
              </p>

              <MenuRow
                icon={<span aria-hidden="true">🍒</span>}
                iconTone="bg-loss/10 ring-loss/20"
                title="Tastytrade Direct API"
                description={
                  tastyConnected
                    ? 'Real-time quotes & futures active'
                    : 'Connect for real-time data'
                }
                trailing={
                  tastyConnected ? (
                    <Badge className="border border-profit/30 bg-profit/15 text-[10px] font-semibold text-profit">
                      Live
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-loss/30 bg-loss/10 text-[10px] font-semibold text-loss"
                    >
                      Connect
                    </Badge>
                  )
                }
                onClick={onOpenTastyDialog}
              />

              <MenuRow
                icon={<Building2 className="size-4" aria-hidden="true" />}
                iconTone="bg-brand/10 text-brand ring-brand/20"
                title="Connected brokerages"
                description={`${brokerCount} linked ${brokerCount === 1 ? 'account' : 'accounts'}`}
                trailing={
                  needsReauth ? (
                    <Badge className="border border-warning/30 bg-warning/15 text-[10px] font-semibold text-warning">
                      Re-auth
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-semibold">
                      Manage
                    </Badge>
                  )
                }
                onClick={onOpenConnectionsDialog}
              />

              <MenuRow
                icon={<PlusCircle className="size-4" aria-hidden="true" />}
                iconTone="bg-strategy/10 text-strategy ring-strategy/20"
                title="Link other brokers"
                description="Robinhood, Schwab, Fidelity…"
                trailing={
                  <Badge
                    variant="outline"
                    className="border-brand/30 bg-brand/10 text-[10px] font-semibold text-brand"
                  >
                    Link
                  </Badge>
                }
                onClick={onOpenConnectionPortal}
              />
            </div>

            <DropdownMenuSeparator />

            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-2 text-xs font-semibold text-loss transition-colors hover:bg-loss/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
