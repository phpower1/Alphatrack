/**
 * ShareTradeCard — Shareable trade/strategy card for social media.
 *
 * Renders a self-contained card as a React component, then captures it as a
 * PNG via html-to-image. The dialog lets the user add commentary, toggle
 * what data to show (dollar amounts vs percentages), pick a visual theme
 * and target platform, and export (download, clipboard, or native share).
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { toPng } from 'html-to-image';
import {
  ArrowUpRight,
  ArrowDownRight,
  Check,
  ClipboardCopy,
  Download,
  Layers,
  Share2,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatMoney, formatPercent } from '../lib/format';
import type { Trade, RoiMetrics } from '../types';
import type { StrategyGroup } from '../utils/tastyParser';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** The strategy metrics shape returned by calculateStrategyMetrics in App.tsx */
export interface StrategyMetricsData {
  strategyName: string;
  strategyType: string;
  legsCount: number;
  isOpen: boolean;
  totalRequiredCapital: number;
  totalPeakCapital: number;
  totalExitCapital: number;
  totalAvgCapital: number;
  netProfit: number;
  totalGrossCredit: number;
  totalGrossDebit: number;
  totalFees: number;
  avgROI: number;
  peakROI: number;
  annualizedROI: number;
  daysHeld: number;
  totalValue: number;
  netCostBasis: number;
  netCurrentPrice: number;
}

export interface ShareTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade: Trade | null;
  metrics: RoiMetrics | null;
  strategy: StrategyGroup<any> | null;
  strategyMetrics: StrategyMetricsData | null;
}

type CardTheme = 'dark' | 'glass' | 'minimal';

/* -------------------------------------------------------------------------- */
/*  Platform presets                                                           */
/* -------------------------------------------------------------------------- */

type Platform = 'twitter' | 'instagram' | 'discord';

interface PlatformPreset {
  label: string;
  /** CSS width in px */
  width: number;
  /** Aspect ratio as w/h — used to compute height. */
  aspect: number;
  icon: string;
}

const PLATFORMS: Record<Platform, PlatformPreset> = {
  twitter: { label: 'Twitter / X', width: 600, aspect: 2 / 1, icon: '𝕏' },
  instagram: { label: 'Instagram', width: 540, aspect: 1 / 1, icon: '📸' },
  discord: { label: 'Discord', width: 560, aspect: 16 / 9, icon: '💬' },
};

/* -------------------------------------------------------------------------- */
/*  Card themes                                                               */
/* -------------------------------------------------------------------------- */

interface ThemeConfig {
  /** Inline CSS styles for the outer wrapper (background, border). */
  wrapperStyle: React.CSSProperties;
  /** Inline CSS for inner surface panels. */
  surfaceStyle: React.CSSProperties;
  /** Border colour for the separator/dividers. */
  divider: string;
  label: string;
  /** Swatch colours for the theme picker. */
  swatch: { bg: string; border: string };
}

const THEMES: Record<CardTheme, ThemeConfig> = {
  dark: {
    wrapperStyle: {
      background: '#0a0b0f',
      borderColor: '#262a36',
    },
    surfaceStyle: {
      background: '#12131a',
      borderColor: '#262a36',
    },
    divider: '#262a36',
    label: 'Dark',
    swatch: { bg: '#0a0b0f', border: '#262a36' },
  },
  glass: {
    wrapperStyle: {
      background: 'linear-gradient(135deg, rgba(10,11,15,0.95) 0%, rgba(30,20,60,0.92) 50%, rgba(18,19,26,0.95) 100%)',
      borderColor: 'rgba(129, 140, 248, 0.25)',
    },
    surfaceStyle: {
      background: 'rgba(18, 19, 26, 0.55)',
      borderColor: 'rgba(129, 140, 248, 0.15)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
    },
    divider: 'rgba(129, 140, 248, 0.18)',
    label: 'Glassmorphism',
    swatch: { bg: '#1a1040', border: 'rgba(129,140,248,0.3)' },
  },
  minimal: {
    wrapperStyle: {
      background: '#0c0d12',
      borderColor: '#1a1c25',
    },
    surfaceStyle: {
      background: '#111318',
      borderColor: '#1a1c25',
    },
    divider: '#1a1c25',
    label: 'Minimal',
    swatch: { bg: '#0c0d12', border: '#1a1c25' },
  },
};

/* -------------------------------------------------------------------------- */
/*  Wordmark                                                                  */
/* -------------------------------------------------------------------------- */

function Wordmark({ theme }: { theme: CardTheme }) {
  const isGlass = theme === 'glass';
  return (
    <div className="flex items-center gap-1.5">
      {/* Stylised "A" glyph */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: 'block' }}>
        <path
          d="M7 1L1 13h3l1-2.5h4L10 13h3L7 1zm0 4.5L9 10H5l2-4.5z"
          fill={isGlass ? '#a78bfa' : '#818cf8'}
          fillOpacity={isGlass ? 1 : 0.9}
        />
      </svg>
      <span
        style={{
          fontSize: '10px',
          fontWeight: 800,
          letterSpacing: '0.18em',
          color: isGlass ? '#a78bfa' : '#818cf8',
          fontFamily: "'Geist Variable', system-ui, sans-serif",
        }}
      >
        ALPHATRACK
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shareable Card (the rendered image content)                               */
/* -------------------------------------------------------------------------- */

interface CardProps {
  trade: Trade;
  metrics: RoiMetrics;
  strategy: StrategyGroup<any> | null;
  strategyMetrics: StrategyMetricsData | null;
  note: string;
  theme: CardTheme;
  platform: Platform;
  showDollars: boolean;
  showROI: boolean;
  showLegs: boolean;
  showCapital: boolean;
}

function ShareableCard({
  trade,
  metrics,
  strategy,
  strategyMetrics,
  note,
  theme,
  platform,
  showDollars,
  showROI,
  showLegs,
  showCapital,
}: CardProps) {
  const ts = THEMES[theme];
  const pp = PLATFORMS[platform];
  const isMultiLeg = strategy && strategy.items.length > 1;

  // Determine what metrics to display: strategy-level or leg-level
  const displayMetrics = isMultiLeg && strategyMetrics
    ? {
        profit: strategyMetrics.netProfit,
        avgROI: strategyMetrics.avgROI,
        peakROI: strategyMetrics.peakROI,
        annualizedROI: strategyMetrics.annualizedROI,
        avgCap: strategyMetrics.totalAvgCapital,
        peakCap: strategyMetrics.totalPeakCapital,
        daysHeld: strategyMetrics.daysHeld,
        isOpen: strategyMetrics.isOpen,
      }
    : {
        profit: metrics.profit,
        avgROI: metrics.avgROI,
        peakROI: metrics.peakROI,
        annualizedROI: metrics.annualizedROI,
        avgCap: metrics.avgCapital,
        peakCap: metrics.peakCap,
        daysHeld: metrics.daysHeld,
        isOpen: trade.status === 'Open',
      };

  const symbol = trade.details?.rootSymbol || trade.symbol;
  const isProfit = displayMetrics.profit >= 0;

  // Capital meter ratio
  const capRatio = displayMetrics.peakCap > 0
    ? Math.min(1, displayMetrics.avgCap / displayMetrics.peakCap)
    : 0;

  // Dynamic sizing based on platform
  const cardWidth = pp.width;
  const cardHeight = Math.round(cardWidth / pp.aspect);
  const isCompact = platform === 'twitter'; // 2:1 is the tightest
  const isSquare = platform === 'instagram';
  const pad = isCompact ? 20 : 24;

  // Font scaling for larger canvases (instagram)
  const scaledFont = (base: number) => isSquare ? base + 1 : base;

  return (
    <div
      style={{
        width: `${cardWidth}px`,
        minHeight: `${cardHeight}px`,
        borderRadius: '16px',
        border: '1px solid',
        padding: `${pad}px`,
        fontFamily: "'Geist Variable', system-ui, -apple-system, sans-serif",
        color: '#fafafa',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        ...ts.wrapperStyle,
      }}
    >
      <div>
        {/* ── Header ─────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isCompact ? '12px' : '18px' }}>
          <Wordmark theme={theme} />
          <span
            style={{
              fontSize: '10px',
              fontWeight: 500,
              padding: '2px 8px',
              borderRadius: '6px',
              color: '#a1a1aa',
              border: `1px solid ${ts.divider}`,
              ...ts.surfaceStyle,
            }}
          >
            {trade.brokerName}
          </span>
        </div>

        {/* ── Symbol + Strategy ──────────────────────────── */}
        <div style={{ marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: `${scaledFont(20)}px`,
                fontWeight: 700,
                fontFamily: "'Geist Mono Variable', monospace",
              }}
            >
              {symbol}
            </span>
            {trade.details?.futureCycle && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: "'Geist Mono Variable', monospace",
                  padding: '2px 6px',
                  borderRadius: '5px',
                  color: '#818cf8',
                  backgroundColor: 'rgba(129, 140, 248, 0.12)',
                  border: '1px solid rgba(129, 140, 248, 0.3)',
                }}
              >
                {trade.details.futureCycle}
              </span>
            )}
            {strategy && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '5px',
                  color: '#a78bfa',
                  backgroundColor: 'rgba(167, 139, 250, 0.12)',
                  border: '1px solid rgba(167, 139, 250, 0.3)',
                }}
              >
                {strategy.strategyName}
              </span>
            )}
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '5px',
                marginLeft: 'auto',
                color: displayMetrics.isOpen ? '#34d399' : '#a1a1aa',
                backgroundColor: displayMetrics.isOpen ? 'rgba(52, 211, 153, 0.12)' : 'rgba(33, 36, 47, 0.8)',
                border: `1px solid ${displayMetrics.isOpen ? 'rgba(52, 211, 153, 0.3)' : ts.divider}`,
              }}
            >
              {displayMetrics.isOpen ? 'OPEN' : 'CLOSED'}
            </span>
          </div>
          <div style={{ fontSize: '11px', marginTop: '4px', color: '#a1a1aa' }}>
            {isMultiLeg && strategy
              ? `${strategy.strategyName} · ${strategy.items.length} legs · ${strategy.expirationFormatted || 'Active'}`
              : trade.details?.isOption
                ? `${trade.details.expirationFormatted || ''} ${trade.details.strikeFormatted || ''} ${trade.details.optionType || ''}`
                : trade.details?.isFuture
                  ? 'Futures Instrument'
                  : 'Equity'
            }
          </div>
        </div>

        {/* ── Separator ──────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${ts.divider}`, margin: isCompact ? '10px 0' : '16px 0' }} />

        {/* ── P&L Hero ───────────────────────────────────── */}
        {(showDollars || showROI) && (
          <div style={{ marginBottom: isCompact ? '10px' : '16px' }}>
            {showDollars && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: showROI ? '10px' : '0' }}>
                {isProfit ? (
                  <ArrowUpRight style={{ width: '20px', height: '20px', color: '#34d399' }} />
                ) : (
                  <ArrowDownRight style={{ width: '20px', height: '20px', color: '#fb7185' }} />
                )}
                <span
                  style={{
                    fontSize: `${scaledFont(24)}px`,
                    fontWeight: 700,
                    fontFamily: "'Geist Mono Variable', monospace",
                    color: isProfit ? '#34d399' : '#fb7185',
                  }}
                >
                  {formatMoney(displayMetrics.profit, { signed: true })}
                </span>
              </div>
            )}

            {showROI && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: isCompact ? '8px' : '12px' }}>
                {[
                  {
                    label: isMultiLeg ? 'Strategy Avg ROI' : 'Avg ROI',
                    value: displayMetrics.avgROI,
                  },
                  {
                    label: isMultiLeg ? 'Strategy Peak ROI' : 'Peak ROI',
                    value: displayMetrics.peakROI,
                  },
                  {
                    label: 'Annualized',
                    value: displayMetrics.annualizedROI,
                  },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    style={{
                      borderRadius: '12px',
                      padding: isCompact ? '8px' : '12px',
                      textAlign: 'center',
                      border: '1px solid',
                      ...ts.surfaceStyle,
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: `${scaledFont(isCompact ? 16 : 18)}px`,
                        fontWeight: 700,
                        fontFamily: "'Geist Mono Variable', monospace",
                        color: tile.value >= 0 ? '#34d399' : '#fb7185',
                      }}
                    >
                      {formatPercent(tile.value, { signed: true, clamp: 999 })}
                    </span>
                    <span style={{ fontSize: '9px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#a1a1aa' }}>
                      {tile.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Capital Meter ──────────────────────────────── */}
        {showCapital && (
          <div
            style={{
              borderRadius: '12px',
              padding: isCompact ? '10px' : '14px',
              marginBottom: isCompact ? '10px' : '16px',
              border: '1px solid',
              ...ts.surfaceStyle,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', fontSize: '10px' }}>
              <span style={{ fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b8b96' }}>
                Avg Capital vs Peak
              </span>
              <span style={{ fontFamily: "'Geist Mono Variable', monospace", color: '#a1a1aa' }}>
                {showDollars
                  ? `${formatMoney(displayMetrics.avgCap, { decimals: 0 })} / ${formatMoney(displayMetrics.peakCap, { decimals: 0 })}`
                  : formatPercent(capRatio * 100, { decimals: 0 })
                }
              </span>
            </div>
            <div style={{ height: '6px', width: '100%', overflow: 'hidden', borderRadius: '9999px', backgroundColor: '#21242f' }}>
              <div
                style={{
                  height: '100%',
                  borderRadius: '9999px',
                  width: `${capRatio * 100}%`,
                  background: theme === 'glass'
                    ? 'linear-gradient(90deg, #818cf8, #a78bfa)'
                    : '#818cf8',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', fontSize: '10px', color: '#8b8b96' }}>
              <span>{displayMetrics.daysHeld} {displayMetrics.daysHeld === 1 ? 'day' : 'days'} held</span>
            </div>
          </div>
        )}

        {/* ── Multi-Leg Breakdown ────────────────────────── */}
        {showLegs && isMultiLeg && strategy && (
          <div
            style={{
              borderRadius: '12px',
              padding: isCompact ? '10px' : '14px',
              marginBottom: isCompact ? '10px' : '16px',
              border: '1px solid rgba(167, 139, 250, 0.25)',
              ...ts.surfaceStyle,
              borderColor: 'rgba(167, 139, 250, 0.25)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '10px',
                fontWeight: 700,
                marginBottom: '10px',
                paddingBottom: '6px',
                color: '#a78bfa',
                borderBottom: `1px solid ${ts.divider}`,
              }}
            >
              <Layers style={{ width: '12px', height: '12px', color: '#a78bfa' }} />
              <span>{strategy.strategyName} Legs</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', fontFamily: "'Geist Mono Variable', monospace" }}>
              {strategy.items.map((item: any) => {
                const legAction = item.details?.action;
                const legQty = item.quantity;
                const isShort = legAction === 'STO' || legAction === 'STC';
                const signedQtyDisplay = isShort ? `-${Math.abs(legQty)}` : `+${Math.abs(legQty)}`;

                return (
                  <div
                    key={`share-leg-${item.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(33, 36, 47, 0.5)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 700, color: isShort ? '#fbbf24' : '#34d399' }}>
                        {signedQtyDisplay}
                      </span>
                      <span style={{ color: '#fafafa' }}>
                        {item.details?.strikeFormatted} {item.details?.optionTypeShort}
                      </span>
                      <span style={{ fontSize: '10px', color: '#8b8b96' }}>
                        {item.details?.expirationFormatted}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#a1a1aa' }}>
                        {showDollars ? formatMoney(item.currentPrice || item.price || 0) : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Single-Leg Contract Details ────────────────── */}
        {!isMultiLeg && trade.details?.isOption && (
          <div
            style={{
              borderRadius: '12px',
              padding: isCompact ? '10px' : '14px',
              marginBottom: isCompact ? '10px' : '16px',
              fontSize: '11px',
              border: '1px solid',
              ...ts.surfaceStyle,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              {trade.details.futureCycle && (
                <span
                  style={{
                    fontFamily: "'Geist Mono Variable', monospace",
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '5px',
                    fontSize: '10px',
                    color: '#818cf8',
                    backgroundColor: 'rgba(129,140,248,0.1)',
                    border: '1px solid rgba(129,140,248,0.3)',
                  }}
                >
                  {trade.details.futureCycle}
                </span>
              )}
              <span
                style={{
                  fontFamily: "'Geist Mono Variable', monospace",
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '5px',
                  fontSize: '10px',
                  color: trade.details.action === 'STO' || trade.details.action === 'STC' ? '#fbbf24' : '#34d399',
                  backgroundColor: trade.details.action === 'STO' || trade.details.action === 'STC' ? 'rgba(251,191,36,0.1)' : 'rgba(52,211,153,0.1)',
                  border: `1px solid ${trade.details.action === 'STO' || trade.details.action === 'STC' ? 'rgba(251,191,36,0.3)' : 'rgba(52,211,153,0.3)'}`,
                }}
              >
                {trade.details.action === 'STO' || trade.details.action === 'STC' ? `-${trade.quantity}` : `+${trade.quantity}`}
              </span>
              <span style={{ color: '#fafafa' }}>{trade.details.expirationFormatted}</span>
              {trade.details.dte !== undefined && (
                <span
                  style={{
                    fontFamily: "'Geist Mono Variable', monospace",
                    padding: '2px 6px',
                    borderRadius: '5px',
                    fontSize: '10px',
                    color: displayMetrics.isOpen ? '#34d399' : '#8b8b96',
                    backgroundColor: displayMetrics.isOpen ? 'rgba(52,211,153,0.1)' : 'rgba(33,36,47,0.8)',
                  }}
                >
                  {trade.details.dte}d
                </span>
              )}
              <span style={{ fontFamily: "'Geist Mono Variable', monospace", fontWeight: 700, color: '#fafafa' }}>
                {trade.details.strikeFormatted}
              </span>
              {trade.details.optionTypeShort && (
                <span
                  style={{
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '5px',
                    fontSize: '10px',
                    color: trade.details.optionTypeShort === 'P' ? '#fbbf24' : '#34d399',
                    backgroundColor: trade.details.optionTypeShort === 'P' ? 'rgba(251,191,36,0.15)' : 'rgba(52,211,153,0.15)',
                    border: `1px solid ${trade.details.optionTypeShort === 'P' ? 'rgba(251,191,36,0.3)' : 'rgba(52,211,153,0.3)'}`,
                  }}
                >
                  {trade.details.optionTypeShort} ({trade.details.optionType})
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── User Note ──────────────────────────────────── */}
        {note.trim() && (
          <div
            style={{
              borderRadius: '12px',
              padding: isCompact ? '10px' : '14px',
              marginBottom: isCompact ? '10px' : '16px',
              fontSize: '12px',
              lineHeight: 1.6,
              fontStyle: 'italic',
              backgroundColor: theme === 'glass' ? 'rgba(167, 139, 250, 0.06)' : 'rgba(129, 140, 248, 0.06)',
              border: `1px solid ${theme === 'glass' ? 'rgba(167, 139, 250, 0.18)' : 'rgba(129, 140, 248, 0.18)'}`,
              color: '#d4d4d8',
            }}
          >
            "{note.trim()}"
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '10px',
          paddingTop: '12px',
          color: '#8b8b96',
          borderTop: `1px solid ${ts.divider}`,
        }}
      >
        <span style={{ fontWeight: 500 }}>Tracked with Alphatrack</span>
        <span>
          {new Date().toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Share Dialog                                                              */
/* -------------------------------------------------------------------------- */

export function ShareTradeDialog({
  open,
  onOpenChange,
  trade,
  metrics,
  strategy,
  strategyMetrics,
}: ShareTradeDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  const [note, setNote] = useState('');
  const [theme, setTheme] = useState<CardTheme>('dark');
  const [platform, setPlatform] = useState<Platform>('twitter');
  const [showDollars, setShowDollars] = useState(true);
  const [showROI, setShowROI] = useState(true);
  const [showLegs, setShowLegs] = useState(true);
  const [showCapital, setShowCapital] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Measure container width for responsive scaling
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [open]);

  // Measure card height whenever card content changes
  useEffect(() => {
    if (!open || !cardRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setCardHeight(entry.contentRect.height);
        }
      }
    });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [open, trade, metrics, strategy, strategyMetrics, note, theme, platform, showDollars, showROI, showLegs, showCapital]);

  const targetWidth = PLATFORMS[platform].width;
  const padding = 24;
  const effectiveContainerWidth = containerWidth > 0
    ? containerWidth
    : (typeof window !== 'undefined' ? Math.min(720, window.innerWidth - 48) : 720);
  const availableWidth = Math.max(280, effectiveContainerWidth - padding);
  const scale = Math.min(1, availableWidth / targetWidth);
  const fallbackHeight = Math.round(targetWidth / PLATFORMS[platform].aspect);
  const currentHeight = cardHeight ?? fallbackHeight;

  const generateImage = useCallback(async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;
    try {
      // Double the pixel density for crisp output
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#0a0b0f',
      });
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch (err) {
      console.error('Failed to generate card image:', err);
      return null;
    }
  }, []);

  const handleDownload = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await generateImage();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const symbol = trade?.details?.rootSymbol || trade?.symbol || 'trade';
      a.download = `alphatrack-${symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}-${platform}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [generateImage, trade, platform]);

  const handleCopy = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await generateImage();
      if (!blob) return;
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    } finally {
      setExporting(false);
    }
  }, [generateImage]);

  const handleShare = useCallback(async () => {
    if (!navigator.share) return;
    setExporting(true);
    try {
      const blob = await generateImage();
      if (!blob) return;
      const symbol = trade?.details?.rootSymbol || trade?.symbol || 'trade';
      const file = new File([blob], `alphatrack-${symbol}.png`, { type: 'image/png' });
      await navigator.share({
        title: `${symbol} Trade Card`,
        text: note || undefined,
        files: [file],
      });
    } catch (err) {
      // User cancelled share — not an error
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    } finally {
      setExporting(false);
    }
  }, [generateImage, trade, note]);

  if (!trade || !metrics) return null;

  const canShare = typeof navigator.share === 'function';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-card border-border text-foreground w-full max-w-[calc(100vw-2rem)] sm:max-w-[760px] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl"
      >
        <DialogHeader className="p-4 sm:p-5 pb-3 sm:pb-4 pr-12 shrink-0 border-b border-border/40">
          <DialogTitle className="text-foreground text-base sm:text-lg font-bold flex items-center gap-2">
            <Share2 className="w-5 h-5 text-brand" />
            <span>Share Trade Card</span>
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Customize your card, add your thoughts, and share it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar space-y-4 sm:space-y-5">
          {/* ── Platform Selector ─────────────────────────── */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Platform
            </h4>
            <div className="flex gap-2">
              {(Object.entries(PLATFORMS) as [Platform, PlatformPreset][]).map(([key, val]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPlatform(key)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer',
                    platform === key
                      ? 'bg-brand-fill/25 text-brand border border-brand/40 shadow-sm'
                      : 'bg-surface-2 text-muted-foreground border border-border hover:text-foreground hover:bg-surface-3'
                  )}
                >
                  <span className="text-sm">{val.icon}</span>
                  <span>{val.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Card Preview ──────────────────────────────── */}
          <div
            ref={containerRef}
            className="w-full flex justify-center items-center p-3 sm:p-4 rounded-2xl bg-surface-1/60 border border-border/40 overflow-hidden min-h-[160px]"
          >
            <div
              style={{
                width: `${Math.round(targetWidth * scale)}px`,
                height: `${Math.round(currentHeight * scale)}px`,
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '16px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
              }}
            >
              <div
                style={{
                  width: `${targetWidth}px`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <div ref={cardRef} style={{ width: `${targetWidth}px` }}>
                  <ShareableCard
                    trade={trade}
                    metrics={metrics}
                    strategy={strategy}
                    strategyMetrics={strategyMetrics}
                    note={note}
                    theme={theme}
                    platform={platform}
                    showDollars={showDollars}
                    showROI={showROI}
                    showLegs={showLegs}
                    showCapital={showCapital}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── User Note ──────────────────────────────────── */}
          <div>
            <label
              htmlFor="share-note"
              className="block text-xs font-semibold text-muted-foreground mb-1.5"
            >
              Your thoughts
            </label>
            <textarea
              id="share-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add your commentary... (optional)"
              maxLength={280}
              rows={2}
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none focus:ring-2 focus:ring-brand/50 resize-none"
            />
            <div className="text-right text-[10px] text-subtle-foreground mt-0.5">
              {note.length}/280
            </div>
          </div>

          {/* ── Controls ───────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Toggles */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Show / Hide
              </h4>
              {[
                { id: 'dollars', label: 'Dollar amounts', checked: showDollars, set: setShowDollars },
                { id: 'roi', label: 'ROI percentages', checked: showROI, set: setShowROI },
                { id: 'capital', label: 'Capital meter', checked: showCapital, set: setShowCapital },
                ...(strategy && strategy.items.length > 1
                  ? [{ id: 'legs', label: 'Strategy legs', checked: showLegs, set: setShowLegs }]
                  : []),
              ].map((toggle) => (
                <div key={toggle.id} className="flex items-center justify-between">
                  <label htmlFor={`toggle-${toggle.id}`} className="text-xs text-foreground cursor-pointer select-none">
                    {toggle.label}
                  </label>
                  <Switch
                    id={`toggle-${toggle.id}`}
                    checked={toggle.checked}
                    onCheckedChange={toggle.set}
                  />
                </div>
              ))}
            </div>

            {/* Theme Picker */}
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Card Style
              </h4>
              <div className="space-y-1.5">
                {(Object.entries(THEMES) as [CardTheme, ThemeConfig][]).map(
                  ([key, val]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTheme(key)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                        theme === key
                          ? 'bg-brand-fill/25 text-brand border border-brand/40'
                          : 'bg-surface-2 text-muted-foreground border border-border hover:text-foreground hover:bg-surface-3'
                      )}
                    >
                      {/* Swatch */}
                      <span
                        className="size-4 rounded-md"
                        style={{ background: val.swatch.bg, border: `1px solid ${val.swatch.border}` }}
                      />
                      <span>{val.label}</span>
                      {theme === key && <Check className="size-3 ml-auto text-brand" />}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Export Actions ──────────────────────────────── */}
        <div className="p-4 sm:p-5 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 shrink-0 border-t border-border/60 bg-card">
          <Button
            onClick={handleDownload}
            disabled={exporting}
            className="bg-brand-fill hover:bg-brand-fill/85 text-foreground text-xs font-semibold px-4 cursor-pointer flex-1 min-w-[130px] h-9.5"
          >
            <Download className="size-3.5 mr-1.5" />
            Download PNG
          </Button>
          <Button
            onClick={handleCopy}
            disabled={exporting}
            variant="outline"
            className="border-border text-muted-foreground hover:text-foreground text-xs cursor-pointer flex-1 min-w-[130px] h-9.5"
          >
            {copied ? (
              <>
                <Check className="size-3.5 mr-1.5 text-profit" />
                Copied!
              </>
            ) : (
              <>
                <ClipboardCopy className="size-3.5 mr-1.5" />
                Copy to Clipboard
              </>
            )}
          </Button>
          {canShare && (
            <Button
              onClick={handleShare}
              disabled={exporting}
              variant="outline"
              className="border-border text-muted-foreground hover:text-foreground text-xs cursor-pointer shrink-0 h-9.5 px-3.5"
            >
              <Share2 className="size-3.5 mr-1.5" />
              Share
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
