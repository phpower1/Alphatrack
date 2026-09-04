import { ContractPill } from '../ContractPill';
import { Money } from '../format/Money';
import { PnL } from '../format/PnL';
import type { ColumnDef } from '../DataTable/types';
import type { Position } from '../../types';
import { formatNumber } from '../../lib/format';

const Dash = () => <span className="text-subtle-foreground">—</span>;

function DaysLeftChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-profit/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-profit ring-1 ring-profit/30">
      {label}
    </span>
  );
}

function SignedQty({ quantity }: { quantity: number }) {
  const isShort = quantity < 0;
  return (
    <span
      className={`font-mono text-xs font-semibold tabular-nums ${
        isShort ? 'text-warning' : 'text-profit'
      }`}
    >
      {formatNumber(quantity, { signed: true })}
    </span>
  );
}

export function buildPositionColumns(mode: 'strategy' | 'flat'): ColumnDef<Position>[] {
  return [
    {
      id: 'symbol',
      header: mode === 'strategy' ? 'Symbol / Strategy / Contract' : 'Symbol / Contract',
      width: '280px',
      sticky: true,
      sortable: true,
      sortValue: (position) => position.details?.rootSymbol || position.symbol,
      sortStrategy: (group) => group.strategyName,
      sortUnderlying: (group) => group.symbol,
      cell: (position) =>
        position.details ? (
          <ContractPill details={position.details} quantity={position.quantity} />
        ) : (
          <span className="font-mono text-[13px] font-bold text-foreground">{position.symbol}</span>
        ),
      underlyingCell: (group) => (
        <>
          <span className="font-mono text-[14px] font-extrabold tracking-tight text-foreground">
            {group.symbol}
          </span>
          {group.futureCycle && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-bold text-brand ring-1 ring-brand/40">
              {group.futureCycle}
            </span>
          )}
          <span className="ml-1 text-[10px] font-medium text-muted-foreground">
            ({group.strategies.length} {group.strategies.length === 1 ? 'strategy' : 'strategies'})
          </span>
        </>
      ),
      strategyCell: (group) => (
        <>
          <span className="text-[13px] font-bold tracking-wide text-foreground">
            {group.strategyName}
          </span>
          {group.expirationFormatted && (
            <span className="text-[11px] text-muted-foreground">· {group.expirationFormatted}</span>
          )}
        </>
      ),
    },

    {
      id: 'broker',
      header: 'Broker',
      width: '110px',
      hideBelow: 'md',
      sortable: true,
      sortValue: (position) => position.brokerName,
      sortStrategy: (group) => group.items[0]?.brokerName ?? '',
      sortUnderlying: (group) => group.strategies[0]?.items[0]?.brokerName ?? '',
      cell: (position) => (
        <span className="text-[11px] text-muted-foreground">{position.brokerName}</span>
      ),
      underlyingCell: () => <span className="text-xs text-muted-foreground">Multi-Leg Chain</span>,
      strategyCell: (group) => (
        <span className="text-xs text-muted-foreground">
          {group.items[0]?.brokerName || 'Tastytrade'}
        </span>
      ),
    },

    {
      id: 'quantity',
      header: 'Quantity',
      align: 'end',
      width: '90px',
      sortable: true,
      sortValue: (position) => position.quantity,
      sortStrategy: (group) => group.totalQuantity,
      sortUnderlying: (group) => group.strategies.reduce((acc, s) => acc + s.totalQuantity, 0),
      cell: (position) => <SignedQty quantity={position.quantity} />,
      underlyingCell: () => <Dash />,
      strategyCell: (group) => <SignedQty quantity={group.totalQuantity} />,
    },

    {
      id: 'daysLeft',
      header: 'Days Left / Expiry',
      width: '140px',
      hideBelow: 'lg',
      sortable: true,
      sortValue: (position) => position.details?.daysLeft ?? position.details?.dte ?? null,
      sortStrategy: (group) => group.daysLeft ?? group.dte ?? null,
      sortUnderlying: (group, direction) => {
        const days = group.strategies
          .map((s) => s.daysLeft ?? s.dte)
          .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
        if (days.length === 0) return null;
        return direction === 'asc' ? Math.min(...days) : Math.max(...days);
      },
      cell: (position) =>
        position.details?.daysLeftFormatted ? (
          <DaysLeftChip label={position.details.daysLeftFormatted} />
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">
            {position.details?.expirationFormatted || '—'}
          </span>
        ),
      underlyingCell: () => <Dash />,
      strategyCell: (group) => {
        const label =
          group.daysLeftFormatted ?? (group.dte !== undefined ? `${group.dte}d left` : null);
        return label ? <DaysLeftChip label={label} /> : <Dash />;
      },
    },

    {
      id: 'avgCost',
      header: 'Avg Cost',
      align: 'end',
      width: '100px',
      hideBelow: 'md',
      sortable: true,
      sortValue: (position) => position.averagePrice,
      sortStrategy: (group) => Math.abs(group.netCostBasis),
      sortUnderlying: (group) => Math.abs(group.strategies.reduce((acc, s) => acc + s.netCostBasis, 0)),
      cell: (position) => (
        <Money value={position.averagePrice || 0} className="text-muted-foreground" />
      ),
      underlyingCell: () => <Dash />,
      strategyCell: (group) => (
        <Money value={Math.abs(group.netCostBasis)} className="text-muted-foreground" />
      ),
    },

    {
      id: 'currentPrice',
      header: 'Current Price',
      align: 'end',
      width: '110px',
      hideBelow: 'lg',
      sortable: true,
      sortValue: (position) => position.currentPrice,
      sortStrategy: (group) => Math.abs(group.netCurrentPrice),
      sortUnderlying: (group) => group.totalValue,
      cell: (position) => <Money value={position.currentPrice || 0} />,
      underlyingCell: () => <Dash />,
      strategyCell: (group) => (
        <Money value={Math.abs(group.netCurrentPrice)} className="font-semibold" />
      ),
    },

    {
      id: 'marketValue',
      header: 'Market Value',
      align: 'end',
      width: '120px',
      sortable: true,
      sortValue: (position) => position.totalValue,
      sortStrategy: (group) => group.totalValue,
      sortUnderlying: (group) => group.totalValue,
      cell: (position) => <Money value={position.totalValue || 0} />,
      underlyingCell: (group) => <Money value={group.totalValue} className="font-bold" />,
      strategyCell: (group) => <Money value={group.totalValue} className="font-bold" />,
    },

    {
      id: 'openPnl',
      header: 'Open P/L',
      align: 'end',
      width: '120px',
      sortable: true,
      sortValue: (position) => position.openPnl,
      sortStrategy: (group) => group.totalOpenPnl,
      sortUnderlying: (group) => group.totalOpenPnl,
      cell: (position) => <PnL value={position.openPnl || 0} />,
      underlyingCell: (group) => <PnL value={group.totalOpenPnl} size="sm" />,
      strategyCell: (group) => <PnL value={group.totalOpenPnl} />,
    },
  ];
}
