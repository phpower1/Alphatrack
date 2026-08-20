/**
 * Tastytrade / SnapTrade Symbology and Options Parser
 * Normalizes Futures, Futures Options, Equity Options, and Equities
 * into rich Tasty-styled contract metadata.
 */

export interface ParsedOptionDetails {
  rootSymbol: string;          // e.g. "/MNQ", "SNAP", "NVDA"
  futureCycle?: string;        // e.g. "U6", "Z6", "M6"
  fullSymbol: string;          // e.g. "/MNQU6", "SNAP"
  isOption: boolean;
  isFuture: boolean;
  expirationDate?: string;     // "2026-09-18"
  expirationFormatted?: string;// "Sep 18" or "Sep 18, 2026"
  dte?: number;                // Days to expiration from trade date
  isAmSettled?: boolean;       // Morning expiration indicator (AM)
  strike?: number;             // e.g. 26100, 25800, 5.50
  strikeFormatted?: string;    // "26100", "5.50"
  optionType?: 'CALL' | 'PUT'; // "CALL" | "PUT"
  optionTypeShort?: 'C' | 'P'; // "C" | "P"
  action: 'BTO' | 'STO' | 'BTC' | 'STC' | 'Buy' | 'Sell' | 'EXPIRED' | 'ASSIGNED';
  actionType: 'Buy' | 'Sell';
  quantity: number;            // Signed or absolute quantity
  price: number;               // Execution or trade price
  formattedTradeDate: string;  // "8/10 8:50a" or "Aug 10, 2026 8:50 AM"
  rawDescription: string;
}

const MONTH_CODES: Record<string, string> = {
  F: 'Jan', G: 'Feb', H: 'Mar', J: 'Apr', K: 'May', M: 'Jun',
  N: 'Jul', Q: 'Aug', U: 'Sep', V: 'Oct', X: 'Nov', Z: 'Dec'
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Format ISO or date string to Tasty-style readable format: "8/10 8:50a" or "Aug 10, 2026 12:50 PM"
 */
export function formatTradeDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;

    // Check if time component is present
    const hasTime = dateStr.includes('T') || dateStr.includes(':');
    const month = MONTH_NAMES[d.getUTCMonth()] || `${d.getUTCMonth() + 1}`;
    const day = d.getUTCDate();
    const year = d.getUTCFullYear();

    if (!hasTime) {
      return `${month} ${day}, ${year}`;
    }

    let hours = d.getUTCHours();
    const minutes = d.getUTCMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    return `${month} ${day}, ${year} ${hours}:${minutes} ${ampm}`;
  } catch {
    return dateStr;
  }
}

/**
 * Calculate DTE (Days to Expiration)
 */
export function calculateDTE(tradeDateStr?: string, expiryDateStr?: string): number | undefined {
  if (!tradeDateStr || !expiryDateStr) return undefined;
  try {
    const tDate = new Date(tradeDateStr);
    const eDate = new Date(expiryDateStr);
    if (isNaN(tDate.getTime()) || isNaN(eDate.getTime())) return undefined;
    const diffTime = eDate.getTime() - tDate.getTime();
    const diffDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    return diffDays;
  } catch {
    return undefined;
  }
}

/**
 * Parse an OCC Option Symbol (e.g. "SNAP  260911C00005500")
 */
function parseOCCOption(ticker: string): Partial<ParsedOptionDetails> | null {
  // Format: 1-6 chars ticker + 6 digits date (YYMMDD) + C/P + 8 digits strike (divide by 1000)
  const match = ticker.trim().match(/^([A-Z]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/i);
  if (!match) return null;

  const [, root, yy, mm, dd, typeChar, strikeRaw] = match;
  const year = 2000 + parseInt(yy, 10);
  const monthNum = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  const strike = parseInt(strikeRaw, 10) / 1000;
  const optionTypeShort = typeChar.toUpperCase() as 'C' | 'P';
  const optionType = optionTypeShort === 'C' ? 'CALL' : 'PUT';
  const monthName = MONTH_NAMES[monthNum - 1] || mm;
  const expirationDate = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const expirationFormatted = `${monthName} ${day}`;

  return {
    rootSymbol: root.toUpperCase(),
    fullSymbol: root.toUpperCase(),
    isOption: true,
    isFuture: false,
    expirationDate,
    expirationFormatted,
    strike,
    strikeFormatted: strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(2),
    optionType,
    optionTypeShort
  };
}

/**
 * Parse Futures / Futures Option Strings from Tastytrade
 * Examples:
 *   - "./MNQU6 260918P26100"
 *   - "./MNQU6 EW3U6 260810C19000"
 *   - "/MNQU6 260810C19000"
 *   - "/MNQU6"
 *   - "BOT +1 /MNQU6 19500 CALL"
 *   - "SLD 2 /MNQU6 260918P25800"
 */
function parseTastyFuturesOrOption(str: string): Partial<ParsedOptionDetails> | null {
  if (!str) return null;

  // 1. Check for Tasty Futures Option: e.g. "./MNQU6 260918P26100" or "./MNQU6 EW3U6 240823C5750" or "/MNQU6 260918P26100"
  const futOptMatch = str.match(/\.?\/([A-Z0-9]+)(?:\s+[A-Z0-9]+)?\s+(\d{2})(\d{2})(\d{2})([CP])(\d+)/i)
    || str.match(/\/([A-Z0-9]+)\s+(\d{2})(\d{2})(\d{2})([CP])(\d+)/i)
    || str.match(/\b([A-Z0-9]+)\s+(\d{2})(\d{2})(\d{2})([CP])(\d+)\b/i);

  if (futOptMatch) {
    const [, futureCode, yy, mm, dd, typeChar, strikeRaw] = futOptMatch;
    const year = 2000 + parseInt(yy, 10);
    const monthNum = parseInt(mm, 10);
    const day = parseInt(dd, 10);
    const strike = parseFloat(strikeRaw);
    const optionTypeShort = typeChar.toUpperCase() as 'C' | 'P';
    const optionType = optionTypeShort === 'C' ? 'CALL' : 'PUT';
    const monthName = MONTH_NAMES[monthNum - 1] || mm;
    const expirationDate = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    const expirationFormatted = `${monthName} ${day}`;

    // Extract root and cycle from futureCode (e.g. "MNQU6" -> root "/MNQ", cycle "U6")
    let root = futureCode.startsWith('/') ? futureCode : `/${futureCode}`;
    let cycle = '';
    const cycleMatch = root.match(/^(\/[A-Z0-9]+?)([FGHJKMNQUVXZ]\d{1,2})$/i);
    if (cycleMatch) {
      root = cycleMatch[1];
      cycle = cycleMatch[2].toUpperCase();
    }

    return {
      rootSymbol: root.toUpperCase(),
      futureCycle: cycle,
      fullSymbol: `${root}${cycle}`.toUpperCase(),
      isOption: true,
      isFuture: true,
      expirationDate,
      expirationFormatted,
      strike,
      strikeFormatted: strike.toString(),
      optionType,
      optionTypeShort
    };
  }

  // 2. Check for Future without option (e.g. "/MNQU6", "/ESU6", "/MESZ6", "/NQZ26")
  const futMatch = str.match(/\/?([A-Z]{2,5})([FGHJKMNQUVXZ]\d{1,2})/i);
  if (futMatch) {
    const [, base, cycle] = futMatch;
    const root = `/${base.toUpperCase()}`;
    const cycleCode = cycle.toUpperCase();
    return {
      rootSymbol: root,
      futureCycle: cycleCode,
      fullSymbol: `${root}${cycleCode}`,
      isOption: false,
      isFuture: true
    };
  }

  return null;
}

/**
 * Main parser: takes a SnapTrade activity or position item and returns parsed Tasty details.
 */
export function parseTastyTradeItem(act: any): ParsedOptionDetails {
  const description = act.description || '';
  const rawSymbol = act.symbol?.raw_symbol || act.raw_symbol || act.symbol?.symbol || '';
  const optionTicker = act.option_symbol?.ticker || '';
  const rawType = (act.option_type || act.type || 'BUY').toUpperCase();
  const tradeDate = act.trade_date || act.settlement_date || act.date || new Date().toISOString();

  // Determine Action: BTO, STO, BTC, STC, Buy, Sell, Expired
  let action: ParsedOptionDetails['action'] = 'Buy';
  let actionType: 'Buy' | 'Sell' = 'Buy';

  if (rawType.includes('BUY_TO_OPEN') || rawType === 'BTO') {
    action = 'BTO';
    actionType = 'Buy';
  } else if (rawType.includes('SELL_TO_OPEN') || rawType === 'STO') {
    action = 'STO';
    actionType = 'Sell';
  } else if (rawType.includes('BUY_TO_CLOSE') || rawType === 'BTC') {
    action = 'BTC';
    actionType = 'Buy';
  } else if (rawType.includes('SELL_TO_CLOSE') || rawType === 'STC') {
    action = 'STC';
    actionType = 'Sell';
  } else if (rawType.includes('OPTIONEXPIRATION') || description.toUpperCase().includes('EXPIRED')) {
    action = 'EXPIRED';
    actionType = rawType.includes('SELL') ? 'Sell' : 'Buy';
  } else if (rawType.includes('ASSIGN')) {
    action = 'ASSIGNED';
    actionType = 'Sell';
  } else if (rawType.includes('SELL') || rawType === 'SLD') {
    action = 'STO';
    actionType = 'Sell';
  } else {
    action = 'BTO';
    actionType = 'Buy';
  }

  const rawUnits = parseFloat(act.units || act.quantity || '1');
  const quantity = isNaN(rawUnits) || rawUnits === 0 ? 1 : Math.abs(rawUnits);
  const rawPrice = parseFloat(act.price || (act.amount ? Math.abs(act.amount / quantity) : 0));
  const price = isNaN(rawPrice) ? 0 : Math.abs(rawPrice);

  // Try 1: Parse from OCC Option Ticker
  if (optionTicker) {
    const parsedOcc = parseOCCOption(optionTicker);
    if (parsedOcc) {
      const dte = calculateDTE(tradeDate, parsedOcc.expirationDate);
      return {
        rootSymbol: parsedOcc.rootSymbol || 'UNKNOWN',
        futureCycle: parsedOcc.futureCycle,
        fullSymbol: parsedOcc.fullSymbol || parsedOcc.rootSymbol || 'UNKNOWN',
        isOption: true,
        isFuture: false,
        expirationDate: parsedOcc.expirationDate,
        expirationFormatted: parsedOcc.expirationFormatted,
        dte,
        strike: parsedOcc.strike,
        strikeFormatted: parsedOcc.strikeFormatted,
        optionType: parsedOcc.optionType,
        optionTypeShort: parsedOcc.optionTypeShort,
        action,
        actionType,
        quantity,
        price,
        formattedTradeDate: formatTradeDateTime(tradeDate),
        rawDescription: description || optionTicker
      };
    }
  }

  // Try 2: Parse from Futures/Option strings in rawSymbol or description
  const combinedText = `${rawSymbol} ${description}`;
  const parsedFutures = parseTastyFuturesOrOption(combinedText);
  if (parsedFutures) {
    const dte = calculateDTE(tradeDate, parsedFutures.expirationDate);
    return {
      rootSymbol: parsedFutures.rootSymbol || '/MNQ',
      futureCycle: parsedFutures.futureCycle,
      fullSymbol: parsedFutures.fullSymbol || `${parsedFutures.rootSymbol || '/MNQ'}${parsedFutures.futureCycle || ''}`,
      isOption: Boolean(parsedFutures.isOption),
      isFuture: true,
      expirationDate: parsedFutures.expirationDate,
      expirationFormatted: parsedFutures.expirationFormatted,
      dte,
      strike: parsedFutures.strike,
      strikeFormatted: parsedFutures.strikeFormatted,
      optionType: parsedFutures.optionType,
      optionTypeShort: parsedFutures.optionTypeShort,
      action,
      actionType,
      quantity,
      price,
      formattedTradeDate: formatTradeDateTime(tradeDate),
      rawDescription: description || rawSymbol
    };
  }

  // Try 3: OCC in description
  const occInDesc = parseOCCOption(description);
  if (occInDesc) {
    const dte = calculateDTE(tradeDate, occInDesc.expirationDate);
    return {
      rootSymbol: occInDesc.rootSymbol || 'UNKNOWN',
      futureCycle: occInDesc.futureCycle,
      fullSymbol: occInDesc.fullSymbol || occInDesc.rootSymbol || 'UNKNOWN',
      isOption: true,
      isFuture: false,
      expirationDate: occInDesc.expirationDate,
      expirationFormatted: occInDesc.expirationFormatted,
      dte,
      strike: occInDesc.strike,
      strikeFormatted: occInDesc.strikeFormatted,
      optionType: occInDesc.optionType,
      optionTypeShort: occInDesc.optionTypeShort,
      action,
      actionType,
      quantity,
      price,
      formattedTradeDate: formatTradeDateTime(tradeDate),
      rawDescription: description
    };
  }

  // Fallback: Standard Equity ticker (e.g. NVDA, AAPL)
  const sym = act.symbol?.symbol || rawSymbol || 'UNKNOWN';
  return {
    rootSymbol: sym,
    fullSymbol: sym,
    isOption: false,
    isFuture: sym.startsWith('/'),
    action: actionType === 'Buy' ? 'Buy' : 'Sell',
    actionType,
    quantity,
    price,
    formattedTradeDate: formatTradeDateTime(tradeDate),
    rawDescription: description || sym
  };
}

/**
 * Filter non-trade events (e.g. FEE, INTEREST, DEPOSIT, WITHDRAWAL)
 */
export function isTradeActivity(act: any): boolean {
  const type = (act.type || '').toUpperCase();
  const desc = (act.description || '').toUpperCase();

  const nonTradeTypes = ['FEE', 'INTEREST', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'TAX', 'ADJUSTMENT', 'DIVIDEND'];
  if (nonTradeTypes.includes(type)) return false;
  if (desc.startsWith('FEE ') || desc === 'FEE' || desc.includes('ACCOUNT FEE') || desc.includes('REGULATORY FEE')) {
    return false;
  }
  return true;
}
