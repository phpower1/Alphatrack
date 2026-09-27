import { Resvg } from '@resvg/resvg-js';

export interface TradeOgData {
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

function escapeXml(unsafe: string): string {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an SVG string for the default app Open Graph card (1200x630).
 */
export function generateDefaultOgSvg(): string {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0b0f"/>
      <stop offset="50%" stop-color="#10121a"/>
      <stop offset="100%" stop-color="#0d0e15"/>
    </linearGradient>
    <radialGradient id="topGlow" cx="50%" cy="0%" r="60%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.25"/>
      <stop offset="50%" stop-color="#6366f1" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#0a0b0f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#181a24" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#12131b" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect width="1200" height="400" fill="url(#topGlow)"/>

  <!-- Border Frame -->
  <rect x="30" y="30" width="1140" height="570" rx="28" fill="none" stroke="#272a3a" stroke-width="1.5"/>

  <!-- Header -->
  <g transform="translate(80, 85)">
    <!-- Brand Glyph "A" -->
    <path d="M0 32 L14 0 L28 32 L21 32 L18.5 24 L9.5 24 L7 32 Z M11 18 L17 18 L14 8 Z" fill="#8b5cf6"/>
    <!-- Wordmark -->
    <text x="40" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900" letter-spacing="4px" fill="url(#brandGrad)">ALPHATRACK</text>
    
    <!-- Tagline Badge -->
    <rect x="260" y="4" width="280" height="28" rx="14" fill="#1e1b4b" stroke="#4338ca" stroke-width="1"/>
    <text x="275" y="22" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" letter-spacing="1.5px" fill="#c7d2fe">TRADE STRATEGY ANALYTICS</text>
  </g>

  <!-- Hero Title -->
  <text x="80" y="195" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="800" fill="#fafafa" letter-spacing="-0.5px">
    Track Multi-Leg Option Strategies
  </text>
  <text x="80" y="245" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="800" fill="#a78bfa" letter-spacing="-0.5px">
    With Real-Time Capital Intelligence
  </text>

  <!-- Subtitle -->
  <text x="80" y="295" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="400" fill="#9ca3af">
    Automated leg detection, lifecycle margin tracking, and realistic annualized ROI metrics.
  </text>

  <!-- 3 Mini Sample Strategy Cards -->
  <g transform="translate(80, 345)">
    <!-- Card 1: NVDA Jade Lizard -->
    <rect x="0" y="0" width="320" height="175" rx="18" fill="url(#cardGrad)" stroke="#2d3142" stroke-width="1.5"/>
    <rect x="20" y="20" width="60" height="22" rx="6" fill="#1e1b4b" stroke="#4338ca" stroke-width="1"/>
    <text x="30" y="35" font-family="monospace" font-size="12" font-weight="700" fill="#c7d2fe">NVDA</text>
    <rect x="90" y="20" width="90" height="22" rx="6" fill="#312e81" stroke="#6366f1" stroke-width="1"/>
    <text x="100" y="35" font-family="sans-serif" font-size="11" font-weight="600" fill="#e0e7ff">Jade Lizard</text>
    <text x="20" y="90" font-family="-apple-system, sans-serif" font-size="32" font-weight="800" fill="#34d399">+$320.00</text>
    <text x="20" y="125" font-family="monospace" font-size="14" font-weight="700" fill="#34d399">+18.1% ROI</text>
    <text x="135" y="125" font-family="sans-serif" font-size="12" font-weight="500" fill="#6b7280">• 19 DTE</text>
    <text x="20" y="152" font-family="sans-serif" font-size="11" font-weight="500" fill="#9ca3af">$1,765 capital deployed</text>

    <!-- Card 2: /MESZ6 Short Put -->
    <rect x="345" y="0" width="320" height="175" rx="18" fill="url(#cardGrad)" stroke="#2d3142" stroke-width="1.5"/>
    <rect x="365" y="20" width="75" height="22" rx="6" fill="#1e1b4b" stroke="#4338ca" stroke-width="1"/>
    <text x="375" y="35" font-family="monospace" font-size="12" font-weight="700" fill="#c7d2fe">/MESZ6</text>
    <rect x="450" y="20" width="85" height="22" rx="6" fill="#312e81" stroke="#6366f1" stroke-width="1"/>
    <text x="460" y="35" font-family="sans-serif" font-size="11" font-weight="600" fill="#e0e7ff">Short Put</text>
    <text x="365" y="90" font-family="-apple-system, sans-serif" font-size="32" font-weight="800" fill="#34d399">+$132.50</text>
    <text x="365" y="125" font-family="monospace" font-size="14" font-weight="700" fill="#34d399">+14.4% ROI</text>
    <text x="480" y="125" font-family="sans-serif" font-size="12" font-weight="500" fill="#6b7280">• 18 DTE</text>
    <text x="365" y="152" font-family="sans-serif" font-size="11" font-weight="500" fill="#9ca3af">$920 capital deployed</text>

    <!-- Card 3: SPY Short Strangle -->
    <rect x="690" y="0" width="350" height="175" rx="18" fill="url(#cardGrad)" stroke="#2d3142" stroke-width="1.5"/>
    <rect x="710" y="20" width="55" height="22" rx="6" fill="#1e1b4b" stroke="#4338ca" stroke-width="1"/>
    <text x="720" y="35" font-family="monospace" font-size="12" font-weight="700" fill="#c7d2fe">SPY</text>
    <rect x="775" y="20" width="110" height="22" rx="6" fill="#312e81" stroke="#6366f1" stroke-width="1"/>
    <text x="785" y="35" font-family="sans-serif" font-size="11" font-weight="600" fill="#e0e7ff">Short Strangle</text>
    <text x="710" y="90" font-family="-apple-system, sans-serif" font-size="32" font-weight="800" fill="#34d399">+$551.00</text>
    <text x="710" y="125" font-family="monospace" font-size="14" font-weight="700" fill="#34d399">+17.2% ROI</text>
    <text x="825" y="125" font-family="sans-serif" font-size="12" font-weight="500" fill="#6b7280">• 24d held</text>
    <text x="710" y="152" font-family="sans-serif" font-size="11" font-weight="500" fill="#9ca3af">$3,200 capital deployed</text>
  </g>

  <!-- Footer Tag -->
  <text x="80" y="565" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#6b7280" letter-spacing="1px">
    SNAPTRADE SYNC • TASTYTRADE CSV PARSER • MULTI-LEG ENGINE
  </text>
  <text x="1120" y="565" text-anchor="end" font-family="monospace" font-size="13" font-weight="600" fill="#818cf8">
    alphatrack.app
  </text>
</svg>`;
}

/**
 * Generates an SVG string for a specific trade card Open Graph image (1200x630).
 */
export function generateTradeOgSvg(data: TradeOgData): string {
  const symbol = escapeXml(data.symbol || 'TRADE');
  const strategy = escapeXml(data.strategyName || 'Strategy');
  const profit = escapeXml(data.profitFormatted || '$0.00');
  const isProfit = data.isProfit;
  const pColor = isProfit ? '#34d399' : '#f87171';
  const pBg = isProfit ? 'rgba(52, 211, 153, 0.12)' : 'rgba(248, 113, 113, 0.12)';
  const roi = escapeXml(data.roiFormatted || '0.0%');
  const annRoi = data.annualizedRoiFormatted ? escapeXml(data.annualizedRoiFormatted) : null;
  const days = escapeXml(data.daysHeldText || '');
  const capital = escapeXml(data.capitalFormatted || '');
  const note = data.note ? escapeXml(data.note.slice(0, 180)) : '';
  const dateStr = escapeXml(data.dateFormatted || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tradeBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0b0f"/>
      <stop offset="100%" stop-color="#13141f"/>
    </linearGradient>
    <radialGradient id="cardGlow" cx="40%" cy="25%" r="70%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0a0b0f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="innerPanel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#181a26"/>
      <stop offset="100%" stop-color="#12131c"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
  </defs>

  <!-- Background Canvas -->
  <rect width="1200" height="630" fill="url(#tradeBg)"/>
  <rect width="1200" height="630" fill="url(#cardGlow)"/>

  <!-- Outer Card Frame -->
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="url(#innerPanel)" stroke="#272a3a" stroke-width="2"/>

  <!-- Header: Brand Wordmark (Left) + Strategy Pills (Right) -->
  <g transform="translate(80, 90)">
    <!-- Glyph -->
    <path d="M0 28 L12 0 L24 28 L18 28 L15.5 21 L8.5 21 L6 28 Z M9.8 15.5 L14.2 15.5 L12 7 Z" fill="#8b5cf6"/>
    <text x="34" y="21" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="900" letter-spacing="3.5px" fill="url(#brand)">ALPHATRACK</text>
  </g>

  <!-- Strategy & Symbol Badges (Top Right) -->
  <g transform="translate(1080, 80)">
    <g transform="translate(-320, 0)">
      <!-- Symbol Badge -->
      <rect x="0" y="0" width="110" height="34" rx="8" fill="#1e1b4b" stroke="#4338ca" stroke-width="1.5"/>
      <text x="55" y="22" text-anchor="middle" font-family="monospace" font-size="15" font-weight="800" fill="#e0e7ff">${symbol}</text>

      <!-- Strategy Badge -->
      <rect x="120" y="0" width="190" height="34" rx="8" fill="#312e81" stroke="#6366f1" stroke-width="1.5"/>
      <text x="215" y="22" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${strategy}</text>
    </g>
  </g>

  <!-- Horizontal Divider -->
  <line x1="80" y1="135" x2="1120" y2="135" stroke="#262939" stroke-width="1.5"/>

  <!-- P&L Section -->
  <g transform="translate(80, 175)">
    <text x="0" y="0" font-family="-apple-system, sans-serif" font-size="12" font-weight="800" letter-spacing="2px" fill="#9ca3af">NET CASH FLOW / P&amp;L</text>
    <text x="0" y="65" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="70" font-weight="900" fill="${pColor}" letter-spacing="-1px">${profit}</text>
    
    ${days ? `<text x="0" y="105" font-family="-apple-system, sans-serif" font-size="16" font-weight="500" fill="#9ca3af">${days} ${capital ? `• Allocated: <tspan font-weight="700" fill="#fafafa">${capital}</tspan>` : ''}</text>` : ''}
  </g>

  <!-- Metric Panels (Top Right Grid) -->
  <g transform="translate(740, 160)">
    <!-- Metric 1: Avg Capital ROI -->
    <rect x="0" y="0" width="180" height="105" rx="14" fill="#151722" stroke="#262939" stroke-width="1.5"/>
    <text x="20" y="32" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" letter-spacing="1px" fill="#9ca3af">AVG CAPITAL ROI</text>
    <text x="20" y="78" font-family="monospace" font-size="34" font-weight="900" fill="${pColor}">${roi}</text>

    <!-- Metric 2: Annualized ROI -->
    <rect x="195" y="0" width="185" height="105" rx="14" fill="#151722" stroke="#262939" stroke-width="1.5"/>
    <text x="215" y="32" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" letter-spacing="1px" fill="#9ca3af">ANNUALIZED ROI</text>
    <text x="215" y="78" font-family="monospace" font-size="34" font-weight="900" fill="${annRoi ? pColor : '#9ca3af'}">${annRoi || roi}</text>
  </g>

  <!-- User Commentary Box (If note is provided) -->
  ${note ? `
  <g transform="translate(80, 310)">
    <rect x="0" y="0" width="1040" height="110" rx="14" fill="rgba(139, 92, 246, 0.08)" stroke="rgba(139, 92, 246, 0.25)" stroke-width="1.5"/>
    <text x="24" y="34" font-family="-apple-system, sans-serif" font-size="12" font-weight="700" letter-spacing="1.5px" fill="#a78bfa">TRADER COMMENTARY</text>
    <text x="24" y="70" font-family="-apple-system, sans-serif" font-size="18" font-style="italic" font-weight="500" fill="#e5e7eb">"${note}"</text>
  </g>
  ` : `
  <!-- Capital Efficiency Bar (If no note) -->
  <g transform="translate(80, 330)">
    <rect x="0" y="0" width="1040" height="85" rx="14" fill="#151722" stroke="#262939" stroke-width="1.5"/>
    <text x="24" y="32" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" letter-spacing="1px" fill="#9ca3af">CAPITAL EFFICIENCY &amp; LIFECYCLE DEPLOYMENT</text>
    <rect x="24" y="48" width="992" height="10" rx="5" fill="#202330"/>
    <rect x="24" y="48" width="760" height="10" rx="5" fill="#6366f1"/>
    <text x="24" y="74" font-family="sans-serif" font-size="12" font-weight="600" fill="#9ca3af">Lifecycle Capital Exposure</text>
    <text x="1016" y="74" text-anchor="end" font-family="monospace" font-size="12" font-weight="700" fill="#fafafa">${capital || '$1,500'}</text>
  </g>
  `}

  <!-- Footer Divider & Content -->
  <line x1="80" y1="480" x2="1120" y2="480" stroke="#262939" stroke-width="1.5"/>

  <g transform="translate(80, 520)">
    <text x="0" y="0" font-family="-apple-system, sans-serif" font-size="13" font-weight="600" fill="#6b7280">Tracked with Alphatrack</text>
    <text x="1040" y="0" text-anchor="end" font-family="-apple-system, sans-serif" font-size="13" font-weight="500" fill="#6b7280">${dateStr}</text>
  </g>
</svg>`;
}

/**
 * Converts an SVG string to a high-resolution PNG Buffer.
 */
export function renderSvgToPng(svg: string, width: number = 1200): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: width,
    },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

/**
 * Parses TradeOgData from query parameters or a base64 encoded 'd' payload.
 */
export function parseTradeFromQuery(query: Record<string, any>): TradeOgData {
  let data: Partial<TradeOgData> = {};
  if (query.d) {
    try {
      const raw = String(query.d).replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(raw, 'base64').toString('utf-8');
      data = JSON.parse(decoded);
    } catch (e) {
      console.warn('Failed to parse d query parameter:', e);
    }
  }

  const pnl = data.profitFormatted || (query.pnl as string) || '+$0.00';
  const isProfit = data.isProfit !== undefined
    ? Boolean(data.isProfit)
    : !pnl.trim().startsWith('-');

  return {
    symbol: (data.symbol || (query.sym as string) || 'TRADE').toUpperCase(),
    strategyName: data.strategyName || (query.strat as string) || 'Option Strategy',
    profitFormatted: pnl,
    isProfit,
    roiFormatted: data.roiFormatted || (query.roi as string) || '0.0%',
    annualizedRoiFormatted: data.annualizedRoiFormatted || (query.annRoi as string) || undefined,
    daysHeldText: data.daysHeldText || (query.days as string) || '',
    capitalFormatted: data.capitalFormatted || (query.cap as string) || '',
    note: data.note || (query.note as string) || undefined,
    theme: data.theme || (query.theme as string) || 'dark',
    dateFormatted: data.dateFormatted || (query.date as string) || undefined,
  };
}

/**
 * Injects dynamic Open Graph and Twitter Card tags for shared trade links into the HTML template.
 */
export function injectTradeOgMeta(
  html: string,
  data: TradeOgData,
  reqUrl: string,
  hostHeader?: string,
  protocolHeader?: string
): string {
  const protocol = protocolHeader || 'https';
  const host = hostHeader || 'alphatrack.app';
  const origin = `${protocol}://${host}`;

  const title = `${data.symbol} ${data.strategyName} (${data.profitFormatted}) — Alphatrack`;
  const desc = `${data.symbol} ${data.strategyName}: ${data.profitFormatted} P&L (${data.roiFormatted} ROI)${
    data.daysHeldText ? ' in ' + data.daysHeldText : ''
  }.${data.note ? ' "' + data.note + '"' : ' Tracked with Alphatrack options intelligence.'}`;

  // Preserve query params for image generation endpoint
  const searchParams = reqUrl.includes('?') ? reqUrl.slice(reqUrl.indexOf('?')) : '';
  const ogImageUrl = `${origin}/api/og/trade${searchParams}`;

  let result = html;
  result = result.replace(/<title>.*?<\/title>/i, `<title>${escapeXml(title)}</title>`);
  result = result.replace(/<meta\s+name="description"\s+content=".*?"\s*\/?>/i, `<meta name="description" content="${escapeXml(desc)}" />`);
  result = result.replace(/<meta\s+property="og:title"\s+content=".*?"\s*\/?>/i, `<meta property="og:title" content="${escapeXml(title)}" />`);
  result = result.replace(/<meta\s+property="og:description"\s+content=".*?"\s*\/?>/i, `<meta property="og:description" content="${escapeXml(desc)}" />`);
  result = result.replace(/<meta\s+property="og:image"\s+content=".*?"\s*\/?>/i, `<meta property="og:image" content="${escapeXml(ogImageUrl)}" />`);
  result = result.replace(/<meta\s+name="twitter:title"\s+content=".*?"\s*\/?>/i, `<meta name="twitter:title" content="${escapeXml(title)}" />`);
  result = result.replace(/<meta\s+name="twitter:description"\s+content=".*?"\s*\/?>/i, `<meta name="twitter:description" content="${escapeXml(desc)}" />`);
  result = result.replace(/<meta\s+name="twitter:image"\s+content=".*?"\s*\/?>/i, `<meta name="twitter:image" content="${escapeXml(ogImageUrl)}" />`);

  return result;
}

