import type { Trade, RoiMetrics } from '../types';
import type { StrategyGroup } from './tastyParser';
import type { StrategyMetricsData } from '../components/ShareTradeCard';

export interface SharedTradePayload {
  symbol: string;
  strategyName: string;
  profitFormatted: string;
  isProfit: boolean;
  roiFormatted: string;
  annualizedRoiFormatted?: string;
  daysHeldText: string;
  capitalFormatted: string;
  note?: string;
  theme?: string;
  dateFormatted?: string;
}

/**
 * Encodes a trade object into a safe base64url string.
 */
export function encodeTradePayload(payload: SharedTradePayload): string {
  try {
    const jsonStr = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (err) {
    console.error('Failed to encode trade payload:', err);
    return '';
  }
}

/**
 * Decodes a base64 or base64url encoded trade payload into SharedTradePayload.
 */
export function decodeTradePayload(rawEncoded: string): SharedTradePayload | null {
  if (!rawEncoded) return null;
  try {
    const base64 = rawEncoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const jsonStr = new TextDecoder().decode(bytes);
    return JSON.parse(jsonStr) as SharedTradePayload;
  } catch (err) {
    console.warn('Failed to decode trade payload:', err);
    return null;
  }
}

export interface SyntheticShareData {
  trade: Trade;
  metrics: RoiMetrics;
  strategy: StrategyGroup<Trade>;
  strategyMetrics: StrategyMetricsData;
  note?: string;
  theme?: string;
}

/**
 * Reconstructs a full trade and strategy object from a shared trade payload,
 * allowing browser recipients to view and interact with the card directly in the app.
 */
export function createSyntheticTradeFromPayload(payload: SharedTradePayload): SyntheticShareData {
  const cleanProfit = parseFloat(payload.profitFormatted.replace(/[^0-9.-]/g, '')) || 0;
  const profit = payload.profitFormatted.includes('-') ? -Math.abs(cleanProfit) : Math.abs(cleanProfit);
  const avgROI = parseFloat(payload.roiFormatted.replace(/[^0-9.-]/g, '')) || 0;
  const annROI = payload.annualizedRoiFormatted
    ? parseFloat(payload.annualizedRoiFormatted.replace(/[^0-9.-]/g, ''))
    : avgROI * 5;
  const daysHeld = parseInt(payload.daysHeldText.replace(/[^0-9]/g, '')) || 14;
  const cap = parseFloat(payload.capitalFormatted.replace(/[^0-9.-]/g, '')) || (profit !== 0 ? Math.round(Math.abs(profit) / (Math.max(avgROI, 1) / 100)) : 1000);

  const syntheticTrade: Trade = {
    id: `share-${payload.symbol.toLowerCase()}-${Date.now()}`,
    accountId: 'shared',
    brokerName: 'Alphatrack',
    symbol: payload.symbol,
    type: 'Sell',
    quantity: 1,
    price: 0,
    date: payload.dateFormatted || new Date().toISOString(),
    status: 'Closed',
    closePrice: null,
    closeDate: payload.dateFormatted || new Date().toISOString(),
    requiredCapital: cap,
    peakCapital: cap,
    details: {
      rootSymbol: payload.symbol,
      isOption: true,
      action: 'STO',
      expirationFormatted: `${daysHeld}d DTE`,
      strikeFormatted: '$---',
      optionTypeShort: 'P',
      optionType: 'PUT',
      daysLeftFormatted: `${daysHeld}d held`,
      dte: daysHeld,
    } as any,
  };

  const syntheticMetrics: RoiMetrics = {
    profit,
    reqCap: cap,
    peakCap: cap,
    exitCap: cap,
    avgCapital: cap,
    avgROI,
    peakROI: avgROI,
    annualizedROI: annROI,
    daysHeld,
  };

  const syntheticStrategy = {
    id: `strat-share-${payload.symbol.toLowerCase()}`,
    rootSymbol: payload.symbol,
    fullSymbol: payload.symbol,
    isFuture: false,
    strategyName: payload.strategyName || 'Option Strategy',
    strategyType: payload.strategyName || 'Option Strategy',
    expirationDate: '',
    items: [syntheticTrade],
  } as unknown as StrategyGroup<Trade>;

  const syntheticStrategyMetrics: StrategyMetricsData = {
    strategyName: payload.strategyName || 'Option Strategy',
    strategyType: payload.strategyName || 'Option Strategy',
    legsCount: 1,
    isOpen: false,
    totalRequiredCapital: cap,
    totalPeakCapital: cap,
    totalExitCapital: cap,
    totalAvgCapital: cap,
    netProfit: profit,
    totalGrossCredit: profit > 0 ? profit : 0,
    totalGrossDebit: profit < 0 ? Math.abs(profit) : 0,
    totalFees: 0,
    avgROI,
    peakROI: avgROI,
    annualizedROI: annROI,
    daysHeld,
    totalValue: 0,
    netCostBasis: cap,
    netCurrentPrice: 0,
  };

  return {
    trade: syntheticTrade,
    metrics: syntheticMetrics,
    strategy: syntheticStrategy,
    strategyMetrics: syntheticStrategyMetrics,
    note: payload.note,
    theme: payload.theme,
  };
}
