import { ActionBadge } from '../ActionBadge';
import { ContractPill } from '../ContractPill';
import { Money } from '../format/Money';
import { Percent } from '../format/Percent';
import { PnL } from '../format/PnL';
import type { ColumnDef } from '../DataTable/types';
import type { RoiMetrics, Trade } from '../../types';
import { formatTradeDateTime, type StrategyGroup } from '../../utils/tastyParser';

/**
 * Annualised ROI is `avgROI * (365 / daysHeld)` with no upper bound, so a
 * one-day trade can compute to five figures. Clamp the display rather than
 * printing "+18250.0%" in a table cell.
 */
const ANNUALIZED_CLAMP = 999;

export interface StrategyMetrics {
  netProfit: number;
  avgROI: number;
  peakROI: number;
  annualizedROI: number;
}

export interface TradeColumnDeps {
  calculateROI: (trade: Trade) => RoiMetrics | null;
  calculateStrategyMetrics: (strategy: StrategyGroup<Trade>) => StrategyMetrics | null;
}

const Dash = () => <span className="text-subtle-foreground">—</span>;

function SymbolBadges({ trade }: { trade: Trade }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[13px] font-bold tracking-tight text-foreground">
          {trade.details?.rootSymbol || trade.symbol}
        </span>
        {trade.details?.futureCycle && (
          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-bold text-brand ring-1 ring-brand/30">
            {trade.details.futureCycle}
          </span>
        )}
        {trade.details?.isOption && (
          <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand ring-1 ring-brand/20">
            {trade.details.isFuture ? 'Fut Opt' : 'Option'}
          </span>
        )}
      </div>

      {trade.details?.isOption && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <ContractPill details={trade.details} quantity={trade.quantity} />
          {trade.status === 'Open'
            ? trade.details.daysLeftFormatted && (
                <span className="rounded bg-profit/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-profit ring-1 ring-profit/30">
                  {trade.details.daysLeftFormatted}
                </span>
              )
            : trade.details.dte !== undefined && (
                <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border">
                  {trade.details.dte}d
                </span>
              )}
        </div>
      )}
    </div>
  );
}

export function buildTradeColumns(
  deps: TradeColumnDeps,
  mode: 'strategy' | 'flat'
): ColumnDef<Trade>[] {
  const { calculateROI, calculateStrategyMetrics } = deps;

  return [
    {
      id: 'symbol',
      header: mode === 'strategy' ? 'Symbol / Strategy / Legs' : 'Symbol',
      width: mode === 'strategy' ? '280px' : '260px',
      sticky: true,
      sortable: mode === 'flat',
      sortValue: (trade) => trade.details?.rootSymbol || trade.symbol,
      cell: (trade) =>
        mode === 'strategy' ? (
          trade.details ? (
            <ContractPill details={trade.details} quantity={trade.quantity} />
          ) : (
            <span className="font-mono font-bold text-foreground">{trade.symbol}</span>
          )
        ) : (
          <SymbolBadges trade={trade} />
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
      sortValue: (trade) => trade.brokerName,
      cell: (trade) =>
        mode === 'flat' ? (
          <span className="rounded bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
            {trade.brokerName}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">{trade.brokerName}</span>
        ),
      underlyingCell: () => <span className="text-xs text-muted-foreground">Chain</span>,
      strategyCell: (group) => (
        <span className="text-xs text-muted-foreground">
          {group.items[0]?.brokerName || 'Tastytrade'}
        </span>
      ),
    },

    {
      id: 'type',
      header: mode === 'strategy' ? 'Qty / Type' : 'Type',
      width: '130px',
      cell: (trade) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionBadge action={trade.details?.action || trade.type} />
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {trade.quantity}
          </span>
          {mode === 'flat' && trade.status === 'Open' && (
            <span className="rounded bg-profit/20 px-1.5 py-0.5 text-[9px] font-bold text-profit ring-1 ring-profit/40">
              OPEN
            </span>
          )}
        </div>
      ),
      underlyingCell: () => <Dash />,
      strategyCell: (group) => (
        <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
          {group.items.length} legs
        </span>
      ),
    },

    {
      id: 'date',
      header: mode === 'strategy' ? 'Date / Expiry' : 'Date',
      width: '150px',
      hideBelow: 'lg',
      sortable: true,
      sortValue: (trade) => new Date(trade.date).getTime(),
      cell: (trade) => (
        <span className="text-[11px] text-muted-foreground">{formatTradeDateTime(trade.date)}</span>
      ),
      underlyingCell: () => <Dash />,
      strategyCell: (group) => (
        <span className="text-[11px] text-muted-foreground">
          {group.expirationFormatted || '—'}
        </span>
      ),
    },

    {
      id: 'pnl',
      header: 'Trade P/L',
      align: 'end',
      width: '130px',
      sortable: true,
      sortValue: (trade) => calculateROI(trade)?.profit ?? null,
      cell: (trade) => {
        const metrics = calculateROI(trade);
        if (!metrics) return <Dash />;
        return (
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5">
              <PnL value={metrics.profit} />
              <span
                className={
                  trade.status === 'Open'
                    ? 'rounded bg-profit/10 px-1.5 py-0.5 text-[9px] font-semibold text-profit ring-1 ring-profit/20'
                    : 'rounded bg-surface-3 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground ring-1 ring-border'
                }
              >
                {trade.status === 'Open' ? 'Open' : 'Realized'}
              </span>
            </div>
            {trade.fees ? (
              <span className="text-[10px] text-subtle-foreground">
                <Money value={-Math.abs(trade.fees)} inline /> fee
              </span>
            ) : null}
          </div>
        );
      },
      underlyingCell: (group) => <PnL value={group.totalRealizedProfit} size="sm" />,
      strategyCell: (group) => {
        const metrics = calculateStrategyMetrics(group);
        return <PnL value={metrics ? metrics.netProfit : group.totalRealizedProfit} />;
      },
    },

    {
      id: 'avgRoi',
      header: 'Avg Cap ROI',
      align: 'end',
      width: '110px',
      hideBelow: 'md',
      sortable: true,
      sortValue: (trade) => calculateROI(trade)?.avgROI ?? null,
      cell: (trade) => {
        const metrics = calculateROI(trade);
        return metrics ? <Percent value={metrics.avgROI} signed colored /> : <Dash />;
      },
      underlyingCell: () => <Dash />,
      strategyCell: (group) => {
        const metrics = calculateStrategyMetrics(group);
        return metrics ? <Percent value={metrics.avgROI} signed colored /> : <Dash />;
      },
    },

    {
      id: 'peakRoi',
      header: 'Peak ROI',
      align: 'end',
      width: '100px',
      hideBelow: 'lg',
      sortable: true,
      sortValue: (trade) => calculateROI(trade)?.peakROI ?? null,
      cell: (trade) => {
        const metrics = calculateROI(trade);
        return metrics ? <Percent value={metrics.peakROI} signed colored /> : <Dash />;
      },
      underlyingCell: () => <Dash />,
      strategyCell: (group) => {
        const metrics = calculateStrategyMetrics(group);
        return metrics ? <Percent value={metrics.peakROI} signed colored /> : <Dash />;
      },
    },

    {
      id: 'annRoi',
      header: 'Ann. ROI',
      align: 'end',
      width: '100px',
      hideBelow: 'xl',
      sortable: true,
      sortValue: (trade) => calculateROI(trade)?.annualizedROI ?? null,
      cell: (trade) => {
        const metrics = calculateROI(trade);
        return metrics ? (
          <Percent
            value={metrics.annualizedROI}
            signed
            clamp={ANNUALIZED_CLAMP}
            className="font-semibold text-brand"
          />
        ) : (
          <Dash />
        );
      },
      underlyingCell: () => <Dash />,
      strategyCell: (group) => {
        const metrics = calculateStrategyMetrics(group);
        return metrics ? (
          <Percent
            value={metrics.annualizedROI}
            signed
            clamp={ANNUALIZED_CLAMP}
            className="font-semibold text-brand"
          />
        ) : (
          <Dash />
        );
      },
    },
  ];
}
