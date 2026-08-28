/**
 * Shared domain shapes.
 *
 * Extracted verbatim from App.tsx so presentational components can type their
 * props without importing from a 3,500-line module. App.tsx re-exports these,
 * so existing imports keep working.
 */
import type { ParsedOptionDetails } from './utils/tastyParser';

export interface SnapTradeAccount {
  id: string;
  brokerage_authorization?: string;
  name?: string | null;
  number: string;
  institution_name: string;
  created_date?: string;
  sync_status?: {
    initial_sync_completed?: boolean;
  };
  raw_type?: string;
  meta?: {
    type?: string;
  };
  balance?: {
    total?: { amount?: number; currency?: string };
    cash?: { amount?: number; currency?: string };
    buying_power?: { amount?: number; currency?: string };
    derivative_buying_power?: number;
    equity_buying_power?: number;
  };
}

export interface Trade {
  id: string;
  accountId: string;
  brokerName: string;
  symbol: string;
  type: 'Buy' | 'Sell';
  quantity: number;
  price: number;
  date: string;
  status: 'Open' | 'Closed';
  closePrice: number | null;
  closeDate: string | null;
  requiredCapital: number;
  peakCapital: number;
  description?: string;
  details?: ParsedOptionDetails;
  fees?: number;
  commission?: number;
  otherFees?: number;
  grossValue?: number;
  netValue?: number;
}

export interface Position {
  id: string;
  accountId: string;
  brokerName: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  totalValue: number;
  openPnl: number;
  multiplier?: number;
  details?: ParsedOptionDetails;
  date?: string;
  createdDate?: string;
  costBasis?: number;
  capReq?: number;
  requiredCapital?: number;
  peakCapital?: number;
  extrinsicValue?: number;
  realizedDayGain?: number;
}

export interface BrokerageConnection {
  id: string;
  brokerage?: {
    name: string;
    slug: string;
  };
  disabled?: boolean;
}

/** Return shape of App.tsx's calculateROI. All ROI fields are percent units. */
export interface RoiMetrics {
  profit: number;
  reqCap: number;
  peakCap: number;
  exitCap: number;
  avgCapital: number;
  avgROI: number;
  peakROI: number;
  annualizedROI: number;
  daysHeld: number;
}
