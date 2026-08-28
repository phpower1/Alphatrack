import { useId } from 'react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

import { cn } from '@/lib/utils';
import { formatMoney, formatNumber } from '../../lib/format';

export interface SparkPoint {
  /** Label shown on hover — a date string, week label, etc. */
  label: string;
  value: number;
}

export interface SparklineProps {
  data: SparkPoint[];
  /**
   * `polarity` colours by the sign of the final value (gain green / loss rose)
   * and draws a zero baseline — right for cumulative P&L.
   * `brand` is a single neutral accent — right for counts and volumes.
   */
  tone?: 'polarity' | 'brand';
  /** Format hover values as currency rather than a plain number. */
  currency?: string;
  height?: number;
  className?: string;
  /** Describes the series for screen readers. */
  ariaLabel: string;
}

/**
 * A single-series sparkline.
 *
 * Deliberately minimal per the dataviz form heuristic: a stat tile's plot needs
 * no legend (the card label names the series), no axes, and no gridlines — but
 * it does get a hover layer, because an on-screen plot that can't be
 * interrogated is just decoration.
 *
 * Renders nothing below two points; a one-point "trend" is meaningless.
 */
export function Sparkline({
  data,
  tone = 'brand',
  currency,
  height = 32,
  className,
  ariaLabel,
}: SparklineProps) {
  const gradientId = useId();

  if (!data || data.length < 2) return null;

  const last = data[data.length - 1]?.value ?? 0;
  const isLoss = tone === 'polarity' && last < 0;
  const stroke =
    tone === 'polarity'
      ? isLoss
        ? 'var(--loss)'
        : 'var(--profit)'
      : 'var(--chart-1)';

  const hasNegative = data.some((d) => d.value < 0);

  const formatValue = (v: number) =>
    currency ? formatMoney(v, { currency, signed: tone === 'polarity' }) : formatNumber(v);

  return (
    <div
      className={cn('w-full', className)}
      style={{ height }}
      role="img"
      aria-label={`${ariaLabel}. Latest value ${formatValue(last)}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>

          <YAxis hide domain={['dataMin', 'dataMax']} />

          {/* Zero baseline only when the series actually crosses it. */}
          {tone === 'polarity' && hasNegative && (
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeWidth={1} />
          )}

          <Tooltip
            cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as SparkPoint;
              return (
                <div className="rounded-md bg-popover px-2 py-1 text-[11px] shadow-lg ring-1 ring-border">
                  <div className="text-subtle-foreground">{point.label}</div>
                  <div className="font-mono font-semibold text-foreground tabular-nums">
                    {formatValue(point.value)}
                  </div>
                </div>
              );
            }}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: stroke, stroke: 'var(--card)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
