# Alphatrack 📈

Alphatrack is a high-performance portfolio intelligence and options trading journal built for modern traders. It brings together multi-broker syncing, intelligent options strategy grouping, and capital-adjusted performance metrics.

---

## ✨ Features

- **Multi-Broker Connectivity**:
  - **Tastytrade Direct Integration**: Direct authentication (session & remember token), real-time balances, positions, orders, and full historical transaction sync.
  - **SnapTrade Multi-Broker Portal**: Connect 20+ brokerages (Interactive Brokers, Charles Schwab, Robinhood, Fidelity, Webull, E*TRADE, Alpaca, and more).
- **Intelligent Options & Strategy Parser**:
  - Automatically identifies and groups multi-leg options strategies:
    - Vertical Spreads (Debit & Credit)
    - Iron Condors & Iron Butterflies
    - Strangles, Straddles, & Synthetics
    - Calendar & Diagonal Spreads
    - Covered Calls & Cash-Secured Puts
    - Multi-phase rolling & adjustment tracking
- **Advanced Performance & Risk Metrics**:
  - Capital allocation & Return on Capital (ROC) tracking
  - Trade duration, win rate, profit factor, and max drawdown analytics
  - Inline sparklines and meters on the portfolio metric cards (cumulative realized P&L, capital utilisation, win/loss split), derived from synced trade data
- **Design System**:
  - Dark theme built on a 4-step elevation scale with a WCAG-verified semantic palette (profit / loss / warning / brand / strategy), Geist + Geist Mono, and tabular figures so numeric columns align
  - Shadcn UI primitives on Base UI, with one shared `DataTable` driving every trades/positions view — grouped or flat, sortable, keyboard-navigable
- **Secure & Persistent Architecture**:
  - Firebase Authentication (Google Sign-in & email auth)
  - Persistent cloud storage via Firestore with fallback local caching for credentials & session tokens.

---

## 🛠️ Tech Stack

- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/)
- **UI & Styling**: [Tailwind CSS v4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/), [Lucide React](https://lucide.dev/), [Motion](https://motion.dev/)
- **Charts**: [Recharts](https://recharts.org/) (sparklines)
- **Backend & APIs**: [Express](https://expressjs.com/), [TSX](https://github.com/privatenumber/tsx), [Axios](https://axios-http.com/)
- **Integrations**: [@tastytrade/api](https://www.npmjs.com/package/@tastytrade/api), [SnapTrade TypeScript SDK](https://snaptrade.com/)
- **Database & Auth**: [Firebase](https://firebase.google.com/) (Auth & Firestore)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `yarn` / `pnpm`

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/alphatrack.git
cd alphatrack
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

Create a `.env` file in the root directory based on `.env.example`:

```env
# Gemini AI Configuration
GEMINI_API_KEY="your_gemini_api_key"

# Application URL
APP_URL="http://localhost:3000"

# SnapTrade Configuration (https://dashboard.snaptrade.com)
SNAPTRADE_CLIENT_ID="your_snaptrade_client_id"
SNAPTRADE_CONSUMER_KEY="your_snaptrade_consumer_key"

# Optional Firebase Overrides
# FIREBASE_PROJECT_ID="your_firebase_project_id"
```

### 4. Run Locally

Start the development server (runs Express API backend + Vite frontend):

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000).

---

## 📜 Available Scripts

- `npm run dev` — Starts the full-stack development server with hot-reload via `tsx`.
- `npm run build` — Builds the Vite production bundle to the `dist/` directory.
- `npm run lint` — Runs TypeScript type-checking (`tsc --noEmit`).
- `npm run preview` — Previews the built production app locally.
- `npm run start` — Starts the production Express server.
- `npm run clean` — Deletes the `dist/` build directory.

---

## 🔒 Security & Privacy

- API keys, access tokens, and secret consumer keys are managed securely on the server layer.
- Tastytrade session tokens and SnapTrade credentials are encrypted / protected via Firebase Firestore security rules and scoped per authenticated user UID.
