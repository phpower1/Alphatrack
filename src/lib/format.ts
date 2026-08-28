/**
 * Number formatting — the single place currency and percentages are rendered.
 *
 * Why this file exists: the app previously built money strings by hand with
 * `${x >= 0 ? '+' : ''}${x.toFixed(2)}` at ~12 sites, which produces `$-45.20`
 * for losses (sign on the wrong side of the symbol) and never emits thousands
 * separators. Intl handles both correctly, so route everything through here.
 */

/** Currency codes we've seen from the broker APIs; anything unknown falls back. */
const FALLBACK_CURRENCY = 'USD';

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = formatterCache.get(key);
  if (!f) {
    f = build();
    formatterCache.set(key, f);
  }
  return f;
}

export interface FormatMoneyOptions {
  /** ISO 4217 code. Broker payloads carry this; unknown values fall back to USD. */
  currency?: string;
  /** Render an explicit `+` on positive values (losses always show `-`). */
  signed?: boolean;
  /** Abbreviate large magnitudes: $1.2M. */
  compact?: boolean;
  /** Fraction digits. Defaults to 2, or 1 when compact. */
  decimals?: number;
}

export function formatMoney(value: number, options: FormatMoneyOptions = {}): string {
  const { currency, signed = false, compact = false, decimals } = options;

  const safe = Number.isFinite(value) ? value : 0;
  const code = normalizeCurrency(currency);
  const digits = decimals ?? (compact ? 1 : 2);

  const key = `m|${code}|${signed}|${compact}|${digits}`;
  const formatter = getFormatter(key, () =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      // 'exceptZero' keeps zero as "$0.00" rather than "+$0.00".
      signDisplay: signed ? 'exceptZero' : 'auto',
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact ? 0 : digits,
      maximumFractionDigits: digits,
    })
  );

  return formatter.format(safe);
}

export interface FormatPercentOptions {
  /** Render an explicit `+` on positive values. */
  signed?: boolean;
  /** Fraction digits. Defaults to 1. */
  decimals?: number;
  /**
   * Hard cap. Above it, renders `>1000%` / `<-1000%`.
   *
   * Annualised ROI is computed as `avgROI * (365 / daysHeld)` with no bound, so
   * a one-day trade can legitimately produce 18250%. Rendering that verbatim in
   * a table cell is noise, not information — pass a clamp on those columns.
   */
  clamp?: number;
}

/**
 * `value` is already in percent units (12.5 means 12.5%), matching what
 * calculateROI returns.
 */
export function formatPercent(value: number, options: FormatPercentOptions = {}): string {
  const { signed = false, decimals = 1, clamp } = options;

  const safe = Number.isFinite(value) ? value : 0;

  if (clamp !== undefined && Math.abs(safe) > clamp) {
    return `${safe < 0 ? '<-' : '>'}${formatPercent(clamp, { decimals: 0 })}`;
  }

  // Beyond 4 digits the exact figure stops being meaningful; keep the magnitude
  // readable rather than printing "18250.0%".
  if (Math.abs(safe) >= 10000) {
    const key = `pc|${signed}`;
    const formatter = getFormatter(key, () =>
      new Intl.NumberFormat(undefined, {
        notation: 'compact',
        signDisplay: signed ? 'exceptZero' : 'auto',
        maximumFractionDigits: 1,
      })
    );
    return `${formatter.format(safe)}%`;
  }

  const key = `p|${signed}|${decimals}`;
  const formatter = getFormatter(key, () =>
    new Intl.NumberFormat(undefined, {
      signDisplay: signed ? 'exceptZero' : 'auto',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );

  return `${formatter.format(safe)}%`;
}

export interface FormatNumberOptions {
  signed?: boolean;
  decimals?: number;
  compact?: boolean;
}

export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  const { signed = false, decimals = 0, compact = false } = options;
  const safe = Number.isFinite(value) ? value : 0;

  const key = `n|${signed}|${decimals}|${compact}`;
  const formatter = getFormatter(key, () =>
    new Intl.NumberFormat(undefined, {
      signDisplay: signed ? 'exceptZero' : 'auto',
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact ? 0 : decimals,
      maximumFractionDigits: decimals,
    })
  );

  return formatter.format(safe);
}

/** Signed contract quantity, e.g. `+2` / `-2`. Short legs read as negative. */
export function formatSignedQuantity(quantity: number, isShort: boolean): string {
  const magnitude = Math.abs(Number.isFinite(quantity) ? quantity : 0);
  return `${isShort ? '-' : '+'}${magnitude}`;
}

function normalizeCurrency(currency?: string): string {
  if (!currency) return FALLBACK_CURRENCY;
  const code = currency.trim().toUpperCase();
  // Intl throws on malformed codes; only well-formed 3-letter codes get through.
  if (!/^[A-Z]{3}$/.test(code)) return FALLBACK_CURRENCY;
  try {
    new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(0);
    return code;
  } catch {
    return FALLBACK_CURRENCY;
  }
}
