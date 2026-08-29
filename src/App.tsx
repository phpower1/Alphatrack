import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { differenceInDays, parseISO, subDays, subMonths, subYears, startOfYear, isAfter, isSameDay } from 'date-fns';
import {
  AlertCircle,
  Building2,
  DollarSign,
  Layers,
  LogIn,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Wallet,
  X
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Firebase imports
import { auth, loginWithGoogle, logout, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getDoc, doc, setDoc } from 'firebase/firestore';

import {
  parseTastyTradeItem,
  isTradeActivity,
  formatTradeDateTime,
  groupItemsByTastyStrategy,
  getContractMultiplier,
  StrategyGroup
} from './utils/tastyParser';
import type {
  SnapTradeAccount,
  Trade,
  Position,
  BrokerageConnection
} from './types';

export type { SnapTradeAccount, Trade, Position, BrokerageConnection };

import { DataTable } from './components/DataTable/DataTable';
import { buildTradeColumns } from './components/dashboard/tradeColumns';
import { buildPositionColumns } from './components/dashboard/positionColumns';
import { EmptyState } from './components/EmptyState';
import { TableToolbar, type PeriodFilter } from './components/dashboard/TableToolbar';
import { AppHeader } from './components/layout/AppHeader';
import { MetricCard } from './components/MetricCard';
import { Money } from './components/format/Money';
import { PnL } from './components/format/PnL';
import { Percent } from './components/format/Percent';
import { Spinner } from './components/Spinner';
import { formatMoney } from './lib/format';
import { Sparkline } from './components/viz/Sparkline';
import { SplitMeter, WinLossBar } from './components/viz/SplitMeter';

// Local / Firestore persistence helpers for Tastytrade session
const TASTY_STORAGE_KEY = 'alphatrack_tastytrade_session';

interface StoredTastytradeSession {
  login: string;
  sessionToken?: string;
  rememberToken?: string;
  user?: any;
  updatedAt?: string;
}

const saveLocalTastySession = (data: StoredTastytradeSession | null) => {
  try {
    if (data) {
      localStorage.setItem(TASTY_STORAGE_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(TASTY_STORAGE_KEY);
    }
  } catch (e) {}
};

const getLocalTastySession = (): StoredTastytradeSession | null => {
  try {
    const raw = localStorage.getItem(TASTY_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
};

// Domain shapes live in ./types so presentational components can import them
// without pulling in this module.

/**
 * Post-processing pass: pair opening trades (BTO/STO) with their closing
 * trades (BTC/STC) on the same contract. Without this, an STO whose option
 * hasn't expired yet stays marked "Open" even after a BTC has been executed,
 * causing the P/L to use a bogus flat-5% estimate instead of the real close.
 */
const pairOpenAndClosingTrades = (trades: Trade[]): Trade[] => {
  // Build contract key for matching: rootSymbol + expiration + strike + optionType
  const contractKey = (t: Trade): string => {
    const d = t.details;
    const root = (d?.rootSymbol || t.symbol || '').toUpperCase();
    const exp = d?.expirationDate || 'NO_EXP';
    const strike = d?.strike !== undefined ? d.strike.toString() : 'NO_STRIKE';
    const optType = d?.optionType || 'NO_TYPE';
    return `${root}|${exp}|${strike}|${optType}`;
  };

  // Group trades by contract
  const byContract = new Map<string, { openers: Trade[]; closers: Trade[] }>();
  for (const t of trades) {
    const key = contractKey(t);
    if (!byContract.has(key)) {
      byContract.set(key, { openers: [], closers: [] });
    }
    const group = byContract.get(key)!;
    const action = t.details?.action;
    if (action === 'BTC' || action === 'STC') {
      group.closers.push(t);
    } else if (action === 'BTO' || action === 'STO') {
      group.openers.push(t);
    }
  }

  // For each contract group, pair openers with closers
  for (const [, group] of byContract) {
    if (group.closers.length === 0) continue;

    // Sort closers by date (earliest first) so we pair in chronological order
    group.closers.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    for (const opener of group.openers) {
      if (opener.status !== 'Open') continue; // Already marked closed

      // Find a closer that matches this opener's quantity
      const closerIdx = group.closers.findIndex(c => c.quantity === opener.quantity);
      if (closerIdx === -1) {
        // Also try matching any closer (for partial fills we just use the first available)
        if (group.closers.length > 0) {
          const closer = group.closers[0];
          opener.status = 'Closed';
          opener.closePrice = closer.price;
          opener.closeDate = closer.date;
          group.closers.splice(0, 1);
        }
        continue;
      }

      const closer = group.closers[closerIdx];
      opener.status = 'Closed';
      opener.closePrice = closer.price;
      opener.closeDate = closer.date;
      group.closers.splice(closerIdx, 1);
    }
  }

  return trades;
};


export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // SnapTrade API status & state
  const [apiStatus, setApiStatus] = useState<{ isConfigured: boolean; mode: string; clientIdMasked: string | null }>({
    isConfigured: false,
    mode: 'Interactive Demo Mode',
    clientIdMasked: null
  });

  // Sync feedback. Previously the app gave none: fetchAllData's catch only
  // logged to the console, so a total API outage looked identical to an empty
  // portfolio, and there was no indication of when data was last refreshed.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<{ id: string; name: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Accounts & Data
  const [accounts, setAccounts] = useState<SnapTradeAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL'); // 'ALL' or specific accountId
  const [trades, setTrades] = useState<Trade[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [connections, setConnections] = useState<BrokerageConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // View & Grouping states
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'trades' | 'positions'>('positions');
  const [groupBy, setGroupBy] = useState<'strategy' | 'flat'>('strategy');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [collapsedUnderlyings, setCollapsedUnderlyings] = useState<Record<string, boolean>>({});
  const [collapsedStrategies, setCollapsedStrategies] = useState<Record<string, boolean>>({});
  const [searchFilter, setSearchFilter] = useState('');

  const toggleUnderlying = (key: string) => {
    setCollapsedUnderlyings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleStrategy = (id: string) => {
    setCollapsedStrategies(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Dialog states
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');

  const [inspectorMode, setInspectorMode] = useState<'strategy' | 'leg'>('strategy');
  const [connectionsDialogOpen, setConnectionsDialogOpen] = useState(false);

  // User Configuration Menu Dropdown State
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  // Tastytrade Direct Connection State
  const [tastyConnected, setTastyConnected] = useState(false);
  const [tastyUser, setTastyUser] = useState<any>(null);
  const [tastyDialogOpen, setTastyDialogOpen] = useState(false);
  const [tastyLogin, setTastyLogin] = useState('');
  const [tastyPassword, setTastyPassword] = useState('');
  const [tastyOtp, setTastyOtp] = useState('');
  const [tastyRequires2FA, setTastyRequires2FA] = useState(false);
  const [tastyLoading, setTastyLoading] = useState(false);
  const [tastyError, setTastyError] = useState('');

  const handleTastytradeLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user) return;
    setTastyLoading(true);
    setTastyError('');

    try {
      const res = await fetch('/api/tastytrade/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: tastyLogin,
          password: tastyPassword,
          otp: tastyOtp || undefined,
          uid: user.uid,
          rememberMe: true
        })
      });

      const data = await res.json();
      const errorMsg = String(data.error || '').toLowerCase();
      const is2FA = Boolean(
        data.requires2FA ||
        errorMsg.includes('challenge') ||
        errorMsg.includes('device') ||
        errorMsg.includes('2fa') ||
        errorMsg.includes('two-factor') ||
        errorMsg.includes('otp') ||
        errorMsg.includes('verification')
      );

      if (res.ok && data.success) {
        setTastyConnected(true);
        setTastyUser(data.user);
        setTastyDialogOpen(false);
        setTastyRequires2FA(false);
        setTastyOtp('');
        setTastyPassword('');

        // Persist session metadata to Firestore & LocalStorage for automatic reconnect
        if ((data.sessionToken || data.rememberToken) && (data.login || tastyLogin)) {
          const sessionToSave: StoredTastytradeSession = {
            login: data.login || tastyLogin.trim(),
            sessionToken: data.sessionToken,
            rememberToken: data.rememberToken,
            user: data.user,
            updatedAt: new Date().toISOString()
          };
          saveLocalTastySession(sessionToSave);
          try {
            setDoc(doc(db, 'users', user.uid), {
              tastytradeSession: sessionToSave
            }, { merge: true }).catch(err => console.warn('Could not sync Tastytrade session to Firestore:', err));
          } catch (e) {}
        }

        await fetchAllData(user.uid);
      } else if (is2FA) {
        setTastyRequires2FA(true);
        setTastyError('');
      } else {
        setTastyError(data.error || 'Failed to authenticate with Tastytrade');
      }
    } catch (err: any) {
      setTastyError(err.message || 'Connection error. Please try again.');
    } finally {
      setTastyLoading(false);
    }
  };

  const handleTastytradeLogout = async () => {
    if (!user) return;
    try {
      await fetch('/api/tastytrade/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid })
      });
      saveLocalTastySession(null);
      try {
        await setDoc(doc(db, 'users', user.uid), {
          tastytradeSession: null
        }, { merge: true });
      } catch (e) {}
      setTastyConnected(false);
      setTastyUser(null);
      setTastyDialogOpen(false);
      await fetchAllData(user.uid);
    } catch (err) {
      console.error('Error logging out of Tastytrade:', err);
    }
  };

  // Fetch API status on mount
  const checkStatus = async () => {
    try {
      const res = await fetch('/api/snaptrade/status');
      if (res.ok) {
        const data = await res.json();
        setApiStatus(data);
      }
    } catch (e) {
      console.error('Error checking API status:', e);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  // Listen for window messages from SnapTrade Connection Portal
  useEffect(() => {
    const handlePortalMessage = (event: MessageEvent) => {
      if (!event.data) return;
      const data = event.data;

      if (data.status === 'SUCCESS') {
        console.log('[SnapTrade Portal] Connected institution successfully:', data.authorizationId);
        setPortalDialogOpen(false);
        setPortalUrl(null);
        if (user) {
          fetchAllData(user.uid);
        }
      } else if (data.status === 'ERROR') {
        console.error('[SnapTrade Portal] Connection error:', data);
        setPortalError(data.detail || `Error code: ${data.errorCode || 'Unknown'}`);
      } else if (data === 'CLOSE_MODAL' || data === 'CLOSED' || data === 'ABANDONED') {
        setPortalDialogOpen(false);
        setPortalUrl(null);
        if (user) {
          fetchAllData(user.uid);
        }
      }
    };

    window.addEventListener('message', handlePortalMessage);
    return () => window.removeEventListener('message', handlePortalMessage);
  }, [user]);

  // Auth observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        getDoc(doc(db, 'users', currentUser.uid)).catch((error) => {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            setDbError('Firebase client is offline. App is running in local mode.');
          }
        });
        fetchAllData(currentUser.uid);
      } else {
        setAccounts([]);
        setTrades([]);
        setPositions([]);
        setConnections([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch all accounts, positions, activities and connections
  const fetchAllData = useCallback(async (uid: string) => {
    if (!uid) return;
    setLoading(true);
    try {
      // 1. Fetch Accounts
      const accRes = await fetch(`/api/snaptrade/accounts?uid=${encodeURIComponent(uid)}`);
      const accData = await accRes.json();
      const rawAccounts: SnapTradeAccount[] = accData.items || [];

      // Fetch live balances (Option BP / Cash / NetLiq) for each account
      const fetchedAccounts: SnapTradeAccount[] = await Promise.all(
        rawAccounts.map(async (acc) => {
          try {
            const balRes = await fetch(`/api/snaptrade/accounts/${acc.id}/balances?uid=${encodeURIComponent(uid)}`);
            const balData = await balRes.json();
            const balances = Array.isArray(balData) ? balData : (balData.data || [balData]);
            const primaryBal = balances[0] || {};
            
            const totalNetLiq = acc.balance?.total?.amount ?? (typeof primaryBal.total === 'object' ? primaryBal.total?.amount : primaryBal.total) ?? primaryBal.amount ?? 0;
            const rawCash = (typeof primaryBal.cash === 'object' ? primaryBal.cash?.amount : primaryBal.cash) ?? acc.balance?.cash?.amount ?? 0;
            const rawBp = (typeof primaryBal.buying_power === 'object' ? primaryBal.buying_power?.amount : primaryBal.buying_power) ?? primaryBal.option_buying_power ?? rawCash;

            return {
              ...acc,
              balance: {
                total: { amount: totalNetLiq || rawCash, currency: primaryBal.currency?.code || primaryBal.currency || acc.balance?.total?.currency || "USD" },
                cash: { amount: rawCash || rawBp, currency: primaryBal.currency?.code || primaryBal.currency || acc.balance?.cash?.currency || "USD" },
                buying_power: { amount: rawBp, currency: primaryBal.currency?.code || primaryBal.currency || "USD" },
                derivative_buying_power: rawBp
              }
            };
          } catch {
            return acc;
          }
        })
      );
      setAccounts(fetchedAccounts);

      // 2. Check Tastytrade Direct Connection & Accounts (with persistent auto-restore)
      let tastyAccs: SnapTradeAccount[] = [];
      try {
        let tastyStatusRes = await fetch(`/api/tastytrade/status?uid=${encodeURIComponent(uid)}`);
        let tastyStatusData = await tastyStatusRes.json();
        let isTastyConnected = Boolean(tastyStatusData.isConnected);

        // If not currently connected on server (e.g. after an app update, container reboot, or restart), attempt silent restore
        if (!isTastyConnected) {
          let savedSession = getLocalTastySession();
          if (!savedSession) {
            try {
              const userDoc = await getDoc(doc(db, 'users', uid));
              if (userDoc.exists() && userDoc.data()?.tastytradeSession) {
                savedSession = userDoc.data().tastytradeSession;
                if (savedSession) saveLocalTastySession(savedSession);
              }
            } catch (e) {}
          }

          if (savedSession && (savedSession.sessionToken || savedSession.rememberToken) && savedSession.login) {
            try {
              console.log(`[Tastytrade] Restoring persistent connection for user ${savedSession.login}...`);
              const restoreRes = await fetch('/api/tastytrade/restore-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  uid,
                  login: savedSession.login,
                  sessionToken: savedSession.sessionToken,
                  rememberToken: savedSession.rememberToken
                })
              });
              const restoreData = await restoreRes.json();
              if (restoreRes.ok && restoreData.success) {
                isTastyConnected = true;
                tastyStatusData = { isConnected: true, user: restoreData.user };
                const updatedSession: StoredTastytradeSession = {
                  ...savedSession,
                  sessionToken: restoreData.sessionToken || savedSession.sessionToken,
                  rememberToken: restoreData.rememberToken || savedSession.rememberToken,
                  user: restoreData.user || savedSession.user,
                  updatedAt: new Date().toISOString()
                };
                saveLocalTastySession(updatedSession);
                setDoc(doc(db, 'users', uid), { tastytradeSession: updatedSession }, { merge: true }).catch(() => {});
              } else {
                console.warn('[Tastytrade] Auto-restore did not succeed, keeping saved session metadata for next attempt.');
              }
            } catch (rErr) {
              console.warn('[Tastytrade] Silent auto-restore network error:', rErr);
            }
          }
        }

        setTastyConnected(isTastyConnected);
        setTastyUser(tastyStatusData.user || null);

        if (isTastyConnected) {
          const tastyAccRes = await fetch(`/api/tastytrade/accounts?uid=${encodeURIComponent(uid)}`);
          const tastyAccData = await tastyAccRes.json();
          const rawTastyAccs = tastyAccData.items || [];

          tastyAccs = await Promise.all(
            rawTastyAccs.map(async (acc: any) => {
              try {
                const balRes = await fetch(`/api/tastytrade/accounts/${acc.number}/balances?uid=${encodeURIComponent(uid)}`);
                const balData = await balRes.json();
                return {
                  ...acc,
                  balance: {
                    total: balData.total || { amount: 0, currency: 'USD' },
                    cash: balData.cash || { amount: 0, currency: 'USD' },
                    buying_power: { amount: balData.derivative_buying_power ?? balData.cash?.amount ?? 0, currency: 'USD' },
                    derivative_buying_power: balData.derivative_buying_power,
                    equity_buying_power: balData.equity_buying_power
                  }
                };
              } catch {
                return acc;
              }
            })
          );
        }
      } catch (tErr) {
        console.warn('Tastytrade direct check error:', tErr);
      }

      // If Tastytrade Direct is connected, prioritize Tastytrade Direct over SnapTrade duplicate Tasty accounts
      const activeSnapAccounts = tastyAccs.length > 0
        ? fetchedAccounts.filter(a => !(a.institution_name?.toLowerCase().includes('tasty') || a.name?.toLowerCase().includes('tasty')))
        : fetchedAccounts;

      const combinedAccounts = [...activeSnapAccounts, ...tastyAccs];
      setAccounts(combinedAccounts);

      // 3. Fetch Connections
      try {
        const connRes = await fetch(`/api/snaptrade/connections?uid=${encodeURIComponent(uid)}`);
        const connData = await connRes.json();
        setConnections(Array.isArray(connData) ? connData : []);
      } catch (e) {
        console.warn('Failed to load connections:', e);
      }

      if (combinedAccounts.length === 0) {
        setTrades([]);
        setPositions([]);
        setLoading(false);
        return;
      }

      // 4. Fetch Activities & Positions across all accounts
      const allTrades: Trade[] = [];
      const allPositions: Position[] = [];

      // A. SnapTrade Accounts
      await Promise.all(
        activeSnapAccounts.map(async (acc) => {
          let accountTrades: Trade[] = [];

          // Activities / Transactions
          try {
            const actRes = await fetch(`/api/snaptrade/accounts/${acc.id}/activities?uid=${encodeURIComponent(uid)}`);
            const actData = await actRes.json();
            const items = actData.data || [];

            // Filter out non-trade events (e.g. fees, deposits, interest)
            const tradeItems = items.filter(isTradeActivity);

            // Parse activities with Tasty parser
            accountTrades = tradeItems.map((act: any, idx: number) => {
              const details = parseTastyTradeItem(act);
              const sym = details.fullSymbol || details.rootSymbol || 'UNKNOWN';
              const isBuy = details.actionType === 'Buy';
              const units = details.quantity;
              const price = details.price;
              const tradeDate = act.trade_date || act.settlement_date || new Date().toISOString();
              const multiplier = details.multiplier || getContractMultiplier(details.rootSymbol, details.isOption, details.isFuture);
              
              const brokerReqCap = parseFloat(act.required_capital || act.cap_req || act['cap-req'] || act.margin_requirement || '0');
              const rawAmount = act.amount ? Math.abs(parseFloat(act.amount)) : price * units * multiplier;
              let reqCapital = brokerReqCap > 0 ? brokerReqCap : (isNaN(rawAmount) || rawAmount === 0 ? price * units * multiplier : rawAmount);

              if (isBuy === false && details.isOption && (!brokerReqCap || brokerReqCap <= 0)) {
                const root = (details.rootSymbol || sym).toUpperCase();
                if (root.includes('MES')) reqCapital = Math.abs(units) * 900.55;
                else if (root.includes('MNQ')) reqCapital = Math.abs(units) * 580.19;
                else if (root.includes('ES')) reqCapital = Math.abs(units) * 9000.00;
                else if (root.includes('NQ')) reqCapital = Math.abs(units) * 11600.00;
              }

              // A trade is an active open position ONLY if it has an unexpired future expiration date
              const isOpeningAction = details.action === 'BTO' || details.action === 'STO';
              const hasValidFutureExpiry = details.daysLeft !== undefined && details.daysLeft >= 0 && !details.isExpired;
              const isOpenTrade = isOpeningAction && hasValidFutureExpiry;
              const status: 'Open' | 'Closed' = isOpenTrade ? 'Open' : 'Closed';

              return {
                id: act.id || `${acc.id}-${idx}`,
                accountId: acc.id,
                brokerName: acc.institution_name || 'Brokerage',
                symbol: sym,
                type: isBuy ? 'Buy' : 'Sell',
                quantity: units,
                price: price,
                date: tradeDate,
                status: status,
                closePrice: null,
                closeDate: status === 'Closed' ? tradeDate : null,
                requiredCapital: reqCapital,
                peakCapital: reqCapital * 1.15,
                fees: details.fees || 0,
                commission: details.commission || 0,
                otherFees: details.otherFees || 0,
                grossValue: details.grossValue,
                netValue: details.netValue,
                description: act.description || `${details.action} ${units} ${sym}`,
                details: details
              };
            });

            allTrades.push(...accountTrades);
          } catch (e) {
            console.error(`Failed to fetch activities for account ${acc.id}`, e);
          }

          // Positions
          try {
            const posRes = await fetch(`/api/snaptrade/accounts/${acc.id}/positions?uid=${encodeURIComponent(uid)}`);
            const posData = await posRes.json();
            const pItems = posData.positions || [];

            const parsedPositions: Position[] = pItems.map((p: any, idx: number) => {
              const details = parseTastyTradeItem(p);
              const sym = details.fullSymbol || details.rootSymbol || p.symbol?.symbol || p.symbol?.raw_symbol || p.instrument?.symbol || 'UNKNOWN';
              const rawUnits = parseFloat(p.units || p.quantity || '0');
              const units = isNaN(rawUnits) ? 0 : rawUnits;
              const multiplier = details.multiplier || getContractMultiplier(details.rootSymbol, details.isOption, details.isFuture, p.multiplier);
              const rawPrice = parseFloat(p.price || p.current_price || p.market_price || '0');
              const currentPrice = isNaN(rawPrice) ? 0 : rawPrice;
              const rawAvg = parseFloat(p.average_purchase_price || p.cost_basis || p.average_price || (currentPrice || '0'));
              const avgPrice = isNaN(rawAvg) ? (currentPrice || 0) : rawAvg;

              // Find matching opening trade date from accountTrades or allTrades
              const pRoot = (details.rootSymbol || sym).toUpperCase().replace('/', '');
              const pExp = details.expirationDate;
              const pStrike = details.strike;
              const pType = details.optionTypeShort;

              const matchingTrade = accountTrades.find(t => {
                const tRoot = (t.details?.rootSymbol || t.symbol || '').toUpperCase().replace('/', '');
                const sameRoot = tRoot === pRoot || tRoot.includes(pRoot) || pRoot.includes(tRoot);
                if (!sameRoot) return false;
                if (pExp && t.details?.expirationDate && t.details.expirationDate !== pExp) return false;
                if (pStrike !== undefined && t.details?.strike !== undefined && Math.abs(t.details.strike - pStrike) > 0.1) return false;
                if (pType && t.details?.optionTypeShort && t.details.optionTypeShort !== pType) return false;
                return true;
              });

              let entryDate = matchingTrade?.date || p.created_at || p['created-at'] || p.trade_date || p.date;
              if (!entryDate && details.dte !== undefined && details.daysLeft !== undefined && details.dte > details.daysLeft) {
                const daysAgo = details.dte - details.daysLeft;
                entryDate = subDays(new Date(), daysAgo).toISOString();
              }

              let openPnl = 0;
              if (p.open_pnl !== undefined && p.open_pnl !== null && !isNaN(parseFloat(p.open_pnl))) {
                openPnl = parseFloat(p.open_pnl);
              } else if (p.unrealized_pnl !== undefined && p.unrealized_pnl !== null && !isNaN(parseFloat(p.unrealized_pnl))) {
                openPnl = parseFloat(p.unrealized_pnl);
              } else if (currentPrice && avgPrice && units !== 0) {
                const isShort = units < 0 || details.action === 'STO';
                const pnlPoints = isShort ? (avgPrice - currentPrice) : (currentPrice - avgPrice);
                openPnl = +(pnlPoints * Math.abs(units) * multiplier).toFixed(2);
              }
              if (isNaN(openPnl)) openPnl = 0;

              const totalValue = (p.total_value !== undefined && p.total_value !== null && !isNaN(parseFloat(p.total_value)))
                ? Math.abs(parseFloat(p.total_value))
                : Math.abs(units * (currentPrice || avgPrice) * multiplier);

              const brokerCapReq = parseFloat(
                p.cap_req || 
                p.capReq || 
                p['cap-req'] || 
                p['capital-requirement'] || 
                p.capital_requirement || 
                p['margin-requirement'] || 
                p.margin_requirement || 
                p['buying-power-requirement'] || 
                p.buying_power_requirement || 
                p.required_capital || 
                '0'
              );

              let reqCapital = brokerCapReq;
              if (!reqCapital || reqCapital <= 0) {
                if (units > 0) {
                  reqCapital = Math.abs(units * avgPrice * multiplier);
                } else if (details.isOption) {
                  const root = (details.rootSymbol || sym).toUpperCase();
                  if (root.includes('MES')) reqCapital = Math.abs(units) * 900.55;
                  else if (root.includes('MNQ')) reqCapital = Math.abs(units) * 580.19;
                  else if (root.includes('ES')) reqCapital = Math.abs(units) * 9000.00;
                  else if (root.includes('NQ')) reqCapital = Math.abs(units) * 11600.00;
                  else reqCapital = Math.max(Math.abs(units * avgPrice * multiplier * 3), Math.abs(units) * 500);
                } else {
                  reqCapital = totalValue;
                }
              }

              return {
                id: `${acc.id}-pos-${idx}`,
                accountId: acc.id,
                brokerName: acc.institution_name || 'Brokerage',
                symbol: sym,
                quantity: units,
                averagePrice: avgPrice,
                currentPrice: currentPrice || avgPrice,
                totalValue: totalValue,
                openPnl: openPnl,
                multiplier: multiplier,
                details: details,
                date: entryDate,
                createdDate: entryDate,
                capReq: reqCapital,
                requiredCapital: reqCapital,
                peakCapital: reqCapital * 1.15
              };
            });

            // If broker positions endpoint is empty for this account (e.g. Tasty options cache),
            // derive open positions strictly from the active unexpired open trades of THIS account!
            if (parsedPositions.length === 0) {
              const openAccountTrades = accountTrades.filter(t => t.status === 'Open');
              const derivedPositions: Position[] = openAccountTrades.map((t, idx) => {
                const units = t.details?.signedQuantity ?? (t.type === 'Buy' ? t.quantity : -t.quantity);
                const entryPrice = t.price || 0;
                const isShort = units < 0 || t.details?.action === 'STO';
                const multiplier = t.details?.multiplier || getContractMultiplier(t.details?.rootSymbol, t.details?.isOption, t.details?.isFuture);

                let daysHeld = 1;
                try {
                  if (t.date) {
                    const d = differenceInDays(new Date(), parseISO(t.date));
                    daysHeld = !isNaN(d) && d > 0 ? d : 1;
                  }
                } catch {
                  daysHeld = 1;
                }

                let estimatedCurrentPrice = entryPrice;
                let openPnl = 0;
                
                const dteTotal = (t.details?.dte && t.details.dte > 0) ? t.details.dte : Math.max(30, daysHeld + (t.details?.daysLeft || 10));
                const decayRatio = Math.min(0.85, daysHeld / dteTotal);

                if (isShort) {
                  // Short option benefits from theta decay over holding days
                  estimatedCurrentPrice = Math.max(0.01, +(entryPrice * (1 - decayRatio * 0.45)).toFixed(2));
                  openPnl = +((entryPrice - estimatedCurrentPrice) * Math.abs(units) * multiplier).toFixed(2);
                } else if (t.details?.isOption) {
                  // Long option
                  estimatedCurrentPrice = +(entryPrice * (1 + 0.05)).toFixed(2);
                  openPnl = +((estimatedCurrentPrice - entryPrice) * Math.abs(units) * multiplier).toFixed(2);
                } else {
                  // Equity
                  estimatedCurrentPrice = +(entryPrice * 1.02).toFixed(2);
                  openPnl = +((estimatedCurrentPrice - entryPrice) * units * multiplier).toFixed(2);
                }

                const totalValue = Math.abs(units * estimatedCurrentPrice * multiplier);

                return {
                  id: `${acc.id}-derived-pos-${idx}`,
                  accountId: acc.id,
                  brokerName: acc.institution_name || 'Brokerage',
                  symbol: t.symbol,
                  quantity: units,
                  averagePrice: entryPrice,
                  currentPrice: estimatedCurrentPrice,
                  totalValue: totalValue,
                  openPnl: openPnl,
                  multiplier: multiplier,
                  details: t.details
                };
              });
              parsedPositions.push(...derivedPositions);
            }

            allPositions.push(...parsedPositions);
          } catch (e) {
            console.error(`Failed to fetch positions for account ${acc.id}`, e);
          }
        })
      );

      // B. Tastytrade Direct Accounts (100% native positions with live mark quotes)
      if (tastyAccs.length > 0) {
        await Promise.all(
          tastyAccs.map(async (acc) => {
            // Native Live Positions
            try {
              const posRes = await fetch(`/api/tastytrade/accounts/${acc.number}/positions?uid=${encodeURIComponent(uid)}`);
              const posData = await posRes.json();
              const pItems = posData.positions || [];

              const parsedTastyPositions: Position[] = pItems.map((p: any, idx: number) => {
                const details = parseTastyTradeItem(p);
                const sym = details.fullSymbol || details.rootSymbol || p.symbol || 'UNKNOWN';
                const units = p.quantity;
                const multiplier = p.multiplier || details.multiplier || 1;
                const avgPrice = p.average_purchase_price;
                const currentPrice = p.current_price || p.price;
                const totalValue = p.total_value;
                const openPnl = p.open_pnl;

                // Find matching trade date from allTrades
                const pRoot = (details.rootSymbol || sym).toUpperCase().replace('/', '');
                const pExp = details.expirationDate;
                const pStrike = details.strike;
                const pType = details.optionTypeShort;

                const matchingTrade = (allTrades || []).find(t => {
                  const tRoot = (t.details?.rootSymbol || t.symbol || '').toUpperCase().replace('/', '');
                  const sameRoot = tRoot === pRoot || tRoot.includes(pRoot) || pRoot.includes(tRoot);
                  if (!sameRoot) return false;
                  if (pExp && t.details?.expirationDate && t.details.expirationDate !== pExp) return false;
                  if (pStrike !== undefined && t.details?.strike !== undefined && Math.abs(t.details.strike - pStrike) > 0.1) return false;
                  if (pType && t.details?.optionTypeShort && t.details.optionTypeShort !== pType) return false;
                  return true;
                });

                let entryDate = matchingTrade?.date || p.created_at || p['created-at'] || p.opened_at;
                if (!entryDate && details.dte !== undefined && details.daysLeft !== undefined && details.dte > details.daysLeft) {
                  const daysAgo = details.dte - details.daysLeft;
                  entryDate = subDays(new Date(), daysAgo).toISOString();
                }

                const brokerCapReq = parseFloat(
                  p.cap_req || 
                  p.capReq || 
                  p['cap-req'] || 
                  p['capital-requirement'] || 
                  p.capital_requirement || 
                  p['margin-requirement'] || 
                  p.margin_requirement || 
                  p['buying-power-requirement'] || 
                  p.buying_power_requirement || 
                  p.required_capital || 
                  '0'
                );

                let reqCapital = brokerCapReq;
                if (!reqCapital || reqCapital <= 0) {
                  if (units > 0) {
                    reqCapital = Math.abs(units * avgPrice * multiplier);
                  } else if (details.isOption) {
                    const root = (details.rootSymbol || sym).toUpperCase();
                    if (root.includes('MES')) reqCapital = Math.abs(units) * 900.55;
                    else if (root.includes('MNQ')) reqCapital = Math.abs(units) * 580.19;
                    else if (root.includes('ES')) reqCapital = Math.abs(units) * 9000.00;
                    else if (root.includes('NQ')) reqCapital = Math.abs(units) * 11600.00;
                    else reqCapital = Math.max(Math.abs(units * avgPrice * multiplier * 3), Math.abs(units) * 500);
                  } else {
                    reqCapital = totalValue;
                  }
                }

                return {
                  id: `tasty-${acc.number}-pos-${idx}`,
                  accountId: acc.id,
                  brokerName: 'Tastytrade',
                  symbol: sym,
                  quantity: units,
                  averagePrice: avgPrice,
                  currentPrice: currentPrice,
                  totalValue: totalValue,
                  openPnl: openPnl,
                  costBasis: p.cost_basis,
                  extrinsicValue: p.extrinsic_value,
                  realizedDayGain: p.realized_day_gain,
                  details: details,
                  multiplier: multiplier,
                  date: entryDate,
                  createdDate: entryDate,
                  capReq: reqCapital,
                  requiredCapital: reqCapital,
                  peakCapital: reqCapital * 1.15
                };
              });

              allPositions.push(...parsedTastyPositions);
            } catch (e) {
              console.error(`Failed to fetch Tastytrade positions for account ${acc.number}`, e);
            }

            // Native Live Transactions
            try {
              const txRes = await fetch(`/api/tastytrade/accounts/${acc.number}/transactions?uid=${encodeURIComponent(uid)}`);
              const txData = await txRes.json();
              const rawTxs = txData.data || [];
              const tradeItems = rawTxs.filter(isTradeActivity);

              const parsedTastyTrades: Trade[] = tradeItems.map((tx: any, idx: number) => {
                const details = parseTastyTradeItem(tx);
                const sym = details.fullSymbol || details.rootSymbol || 'UNKNOWN';
                const isBuy = details.actionType === 'Buy';
                const units = details.quantity;
                const price = details.price;
                const tradeDate = tx['executed-at'] || tx.executed_at || new Date().toISOString();
                const multiplier = details.multiplier || 1;
                
                const brokerReqCap = parseFloat(tx.required_capital || tx.cap_req || tx['cap-req'] || tx.margin_requirement || '0');
                const rawAmount = tx.value ? Math.abs(parseFloat(tx.value)) : price * units * multiplier;
                let reqCapital = brokerReqCap > 0 ? brokerReqCap : (isNaN(rawAmount) || rawAmount === 0 ? price * units * multiplier : rawAmount);

                if (isBuy === false && details.isOption && (!brokerReqCap || brokerReqCap <= 0)) {
                  const root = (details.rootSymbol || sym).toUpperCase();
                  if (root.includes('MES')) reqCapital = Math.abs(units) * 900.55;
                  else if (root.includes('MNQ')) reqCapital = Math.abs(units) * 580.19;
                  else if (root.includes('ES')) reqCapital = Math.abs(units) * 9000.00;
                  else if (root.includes('NQ')) reqCapital = Math.abs(units) * 11600.00;
                }

                const isOpeningAction = details.action === 'BTO' || details.action === 'STO';
                const hasValidFutureExpiry = details.daysLeft !== undefined && details.daysLeft >= 0 && !details.isExpired;
                const isOpenTrade = isOpeningAction && hasValidFutureExpiry;
                const status: 'Open' | 'Closed' = isOpenTrade ? 'Open' : 'Closed';

                return {
                  id: tx.id ? `tasty-tx-${tx.id}` : `tasty-tx-${acc.id}-${idx}`,
                  accountId: acc.id,
                  brokerName: 'Tastytrade',
                  symbol: sym,
                  type: isBuy ? 'Buy' : 'Sell',
                  quantity: units,
                  price: price,
                  date: tradeDate,
                  status: status,
                  closePrice: null,
                  closeDate: status === 'Closed' ? tradeDate : null,
                  requiredCapital: reqCapital,
                  peakCapital: reqCapital * 1.15,
                  fees: details.fees || 0,
                  commission: details.commission || 0,
                  otherFees: details.otherFees || 0,
                  grossValue: details.grossValue,
                  netValue: details.netValue,
                  description: tx.description || `${details.action} ${units} ${sym}`,
                  details: details
                };
              });

              allTrades.push(...parsedTastyTrades);
            } catch (e) {
              console.error(`Failed to fetch Tastytrade transactions for account ${acc.number}`, e);
            }
          })
        );
      }

      // Pair opening trades with their closers before storing — this fixes
      // P/L for trades that were closed (BTC/STC) but whose option hasn't
      // expired yet (the opener would otherwise stay marked "Open" and get
      // a bogus 5% flat-estimate P/L instead of using the real close price).
      pairOpenAndClosingTrades(allTrades);
      setTrades(allTrades);
      setPositions(allPositions);
      if (allTrades.length > 0 && !activeTradeId) {
        setActiveTradeId(allTrades[0].id);
      }
      // Only stamp a successful sync, so the header never claims fresh data
      // after a failed fetch.
      setLastSyncedAt(Date.now());
      setSyncError(null);
    } catch (error) {
      console.error('Error fetching SnapTrade portfolio data:', error);
      setSyncError(
        error instanceof Error
          ? `Could not sync portfolio data: ${error.message}`
          : 'Could not sync portfolio data. Check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [activeTradeId]);

  const handleRefresh = async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      // Trigger live sync on all connected brokerages with SnapTrade
      const currentConns = connections.filter(c => !c.disabled);
      if (currentConns.length > 0) {
        await Promise.allSettled(
          currentConns.map(c =>
            fetch(`/api/snaptrade/connections/${c.id}/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uid: user.uid })
            })
          )
        );
      }
    } catch (e) {
      console.warn('Background brokerage refresh triggered:', e);
    }
    await fetchAllData(user.uid);
    setRefreshing(false);
  };

  // Launch SnapTrade Connection Portal (supports reconnect mode for expired/disabled sessions)
  const handleOpenConnectionPortal = async (reconnectId?: string) => {
    if (!user) return;
    setPortalLoading(true);
    setPortalError('');
    setPortalDialogOpen(true);

    try {
      const res = await fetch('/api/snaptrade/portal-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          reconnect: typeof reconnectId === 'string' && reconnectId.trim() ? reconnectId.trim() : undefined,
          connectionType: 'trade-if-available'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        let msg = data.error?.message || data.error || (typeof data.detail === 'string' ? data.detail : '');
        if (res.status === 401 || (typeof msg === 'string' && msg.includes('401'))) {
          msg = 'Invalid or unapproved SnapTrade API credentials (401 Unauthorized). Please verify your Client ID and Consumer Key in the SnapTrade Dashboard, then update SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in the server .env file.';
        }
        throw new Error(msg || 'Failed to generate SnapTrade Connection Portal link');
      }

      if (data.redirectURI) {
        setPortalUrl(data.redirectURI);
      } else {
        // Mock fallback prompt
        setPortalError('SnapTrade API keys are not configured. Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to the server .env file, or continue in demo mode.');
      }
    } catch (err: any) {
      setPortalError(err.message || 'Failed to open connection portal');
    } finally {
      setPortalLoading(false);
    }
  };

  // Disconnect a brokerage. Confirmation is handled by the AlertDialog that
  // sets `pendingDisconnect`, replacing a native confirm() dialog.
  const handleDisconnectBroker = async (authorizationId: string) => {
    if (!user) return;
    try {
      const res = await fetch(`/api/snaptrade/connections/${authorizationId}?uid=${encodeURIComponent(user.uid)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchAllData(user.uid);
      }
    } catch (e) {
      console.error('Error disconnecting brokerage:', e);
    }
  };

  // Filter trades and positions based on selected account, period, and search
  const filteredTrades = useMemo(() => {
    let list = trades;
    if (selectedAccountId !== 'ALL') {
      list = list.filter(t => t.accountId === selectedAccountId);
    }
    if (periodFilter !== 'all') {
      const now = new Date();
      let cutoff: Date | null = null;
      if (periodFilter === '1m') {
        cutoff = subMonths(now, 1);
      } else if (periodFilter === '3m') {
        cutoff = subMonths(now, 3);
      } else if (periodFilter === '6m') {
        cutoff = subMonths(now, 6);
      } else if (periodFilter === 'ytd') {
        cutoff = startOfYear(now);
      } else if (periodFilter === '1y') {
        cutoff = subYears(now, 1);
      }

      if (cutoff) {
        list = list.filter((t) => {
          const dateStr = t.closeDate || t.date;
          if (!dateStr) return true;
          try {
            const parsed = parseISO(dateStr);
            if (isNaN(parsed.getTime())) return true;
            return isAfter(parsed, cutoff) || isSameDay(parsed, cutoff);
          } catch {
            return true;
          }
        });
      }
    }
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter(t => 
        t.symbol.toLowerCase().includes(q) || 
        t.brokerName.toLowerCase().includes(q) ||
        (t.details?.rootSymbol && t.details.rootSymbol.toLowerCase().includes(q)) ||
        (t.details?.futureCycle && t.details.futureCycle.toLowerCase().includes(q)) ||
        (t.details?.expirationFormatted && t.details.expirationFormatted.toLowerCase().includes(q)) ||
        (t.details?.strikeFormatted && t.details.strikeFormatted.toLowerCase().includes(q)) ||
        (t.details?.action && t.details.action.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q))
      );
    }
    return list;
  }, [trades, selectedAccountId, periodFilter, searchFilter]);

  const filteredPositions = useMemo(() => {
    let list = positions;
    if (selectedAccountId !== 'ALL') {
      list = list.filter(p => p.accountId === selectedAccountId);
    }
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter(p => 
        p.symbol.toLowerCase().includes(q) || 
        p.brokerName.toLowerCase().includes(q) ||
        (p.details?.rootSymbol && p.details.rootSymbol.toLowerCase().includes(q)) ||
        (p.details?.futureCycle && p.details.futureCycle.toLowerCase().includes(q))
      );
    }
    return list;
  }, [positions, selectedAccountId, searchFilter]);

  // Aggregate Portfolio Net Liq & Cash
  const portfolioSummary = useMemo(() => {
    const relevantAccounts = selectedAccountId === 'ALL' 
      ? accounts 
      : accounts.filter(a => a.id === selectedAccountId);

    let totalNetLiq = relevantAccounts.reduce((sum, a) => sum + (a.balance?.total?.amount || 0), 0);
    let totalCash = relevantAccounts.reduce((sum, a) => sum + (a.balance?.cash?.amount || 0), 0);
    let totalBuyingPower = relevantAccounts.reduce((sum, a) => {
      const bp = a.balance?.derivative_buying_power ?? a.balance?.buying_power?.amount ?? a.balance?.cash?.amount ?? 0;
      return sum + bp;
    }, 0);

    const openPositions = filteredPositions || [];
    const positionsValue = openPositions.reduce((sum, p) => sum + (p.totalValue || 0), 0);

    // If broker didn't return netLiq, fallback to cash or positions value
    if (totalNetLiq === 0 && (totalCash > 0 || positionsValue > 0)) {
      totalNetLiq = totalCash > 0 ? totalCash : positionsValue;
    }

    return {
      netLiq: totalNetLiq || positionsValue || 0,
      cash: totalCash || 0,
      buyingPower: totalBuyingPower || totalCash || 0,
      positionsCount: openPositions.length,
      tradesCount: (filteredTrades || []).length,
    };
  }, [accounts, selectedAccountId, filteredPositions, filteredTrades]);

  // ROI Calculator - supports both Closed trades and Open positions with Lifecycle-Weighted Average Capital
  const calculateROI = (trade: Trade) => {
    if (!trade) return null;

    const entryPrice = trade.price || 0;
    const quantity = trade.quantity || 1;
    const multiplier = trade.details?.multiplier || getContractMultiplier(trade.details?.rootSymbol, trade.details?.isOption, trade.details?.isFuture);
    const reqCap = (trade.requiredCapital && trade.requiredCapital > 0) 
      ? trade.requiredCapital 
      : (entryPrice * quantity * multiplier) || 1;
    const peakCap = (trade.peakCapital && trade.peakCapital > 0) ? trade.peakCapital : reqCap * 1.15;

    let profit = 0;
    let daysHeld = 1;
    let exitCap = reqCap;

    if (trade.status === 'Closed') {
      const fees = trade.fees || trade.details?.fees || 0;
      const isCredit = trade.details?.action === 'STO' || trade.details?.action === 'STC' || (trade.details?.actionType === 'Sell' && trade.details.action !== 'BTC');

      if (trade.netValue !== undefined && trade.netValue !== 0) {
        profit = trade.netValue;
      } else if (trade.details?.netValue !== undefined && trade.details.netValue !== 0) {
        profit = trade.details.netValue;
      } else if (trade.closePrice !== null && trade.closePrice !== undefined && trade.closePrice !== entryPrice) {
        profit = trade.type === 'Buy'
          ? ((trade.closePrice - entryPrice) * quantity * multiplier) - fees
          : ((entryPrice - trade.closePrice) * quantity * multiplier) - fees;
      } else {
        const gross = entryPrice * quantity * multiplier;
        profit = isCredit ? (gross - fees) : (-gross - fees);
      }
      
      // Exit capital for closed option / trade
      if (trade.details?.isOption || trade.symbol.startsWith('/') || (trade.requiredCapital && trade.requiredCapital > 0)) {
        exitCap = reqCap;
      } else {
        exitCap = Math.abs(entryPrice * quantity * multiplier);
      }

      let days = 1;
      // 1. If trade has closeDate and date, and closeDate != date:
      if (trade.closeDate && trade.date && trade.closeDate !== trade.date) {
        try {
          const d = differenceInDays(parseISO(trade.closeDate), parseISO(trade.date));
          if (!isNaN(d) && d > 0) days = d;
        } catch {}
      }

      // 2. If days is still 1, look for matching trades in `trades` with same symbol & strike & expiration
      if (days === 1 && trades && trades.length > 0) {
        const related = trades.filter(t => 
          (t.symbol === trade.symbol || t.details?.fullSymbol === trade.details?.fullSymbol) && 
          t.details?.expirationDate === trade.details?.expirationDate &&
          t.details?.strike === trade.details?.strike
        );
        if (related.length > 1) {
          const tDates = related.map(t => new Date(t.date).getTime()).filter(t => !isNaN(t));
          if (tDates.length > 1) {
            const minT = Math.min(...tDates);
            const maxT = Math.max(...tDates);
            const d = differenceInDays(new Date(maxT), new Date(minT));
            if (!isNaN(d) && d > 0) days = d;
          }
        }
      }

      // 3. Fallback: if it expired, compute days between trade entry and expirationDate
      if (days === 1 && trade.details?.expirationDate && trade.date) {
        try {
          const expDate = parseISO(trade.details.expirationDate);
          const trDate = parseISO(trade.date);
          const d = differenceInDays(expDate, trDate);
          if (!isNaN(d) && d > 0) days = d;
        } catch {}
      }

      daysHeld = Math.max(1, days);
    } else {
      // Open active position: match with open position's openPnl if available
      const matchingPos = (positions || []).find(p => 
        p.id === trade.id || 
        (p.symbol === trade.symbol && Math.abs(p.averagePrice - entryPrice) < 0.01)
      );

      if (matchingPos && matchingPos.openPnl !== undefined && matchingPos.openPnl !== 0) {
        profit = matchingPos.openPnl;
      } else {
        const isShort = trade.details?.signedQuantity ? trade.details.signedQuantity < 0 : trade.type === 'Sell';
        profit = isShort 
          ? entryPrice * 0.05 * quantity * multiplier
          : entryPrice * 0.05 * quantity * multiplier;
      }

      // Current capital mark for open position (margin requirement / required capital deployed today)
      if (matchingPos && matchingPos.requiredCapital !== undefined && matchingPos.requiredCapital > 0) {
        exitCap = matchingPos.requiredCapital;
      } else if (matchingPos && matchingPos.capReq !== undefined && matchingPos.capReq > 0) {
        exitCap = matchingPos.capReq;
      } else {
        exitCap = reqCap;
      }

      let days = 1;
      try {
        if (trade.date) {
          const d = differenceInDays(new Date(), parseISO(trade.date));
          if (!isNaN(d) && d > 0) days = d;
        }
      } catch {}

      // Fallback from DTE at entry vs days left today
      if (days === 1 && trade.details?.dte !== undefined && trade.details?.daysLeft !== undefined) {
        const d = trade.details.dte - trade.details.daysLeft;
        if (d > 0) days = d;
      }

      daysHeld = Math.max(1, days);
    }

    // Option A: Lifecycle-Weighted Average Capital = (Entry Capital + Peak Capital + Exit/Current Capital) / 3
    const avgCapital = Math.max(1, (reqCap + peakCap + exitCap) / 3);
    const avgROI = avgCapital > 0 ? (profit / avgCapital) * 100 : 0;
    const peakROI = peakCap > 0 ? (profit / peakCap) * 100 : 0;
    const annualizedROI = avgROI * (365 / Math.max(1, daysHeld));

    return { 
      profit: isNaN(profit) ? 0 : profit, 
      reqCap: isNaN(reqCap) ? 1 : reqCap,
      peakCap: isNaN(peakCap) ? 1 : peakCap,
      exitCap: isNaN(exitCap) ? 1 : exitCap,
      avgCapital: isNaN(avgCapital) ? reqCap : avgCapital,
      avgROI: isNaN(avgROI) ? 0 : avgROI, 
      peakROI: isNaN(peakROI) ? 0 : peakROI, 
      annualizedROI: isNaN(annualizedROI) ? 0 : annualizedROI, 
      daysHeld: Math.max(1, daysHeld)
    };
  };

  const groupedPositions = useMemo(() => {
    return groupItemsByTastyStrategy(filteredPositions);
  }, [filteredPositions]);

  const groupedTrades = useMemo(() => {
    return groupItemsByTastyStrategy(filteredTrades, calculateROI);
  }, [filteredTrades]);

  const normalizePositionToTrade = useCallback((foundPos: Position): Trade => {
    const pRoot = (foundPos.details?.rootSymbol || foundPos.symbol || '').toUpperCase().replace('/', '');
    const pExp = foundPos.details?.expirationDate;
    const pStrike = foundPos.details?.strike;
    const pType = foundPos.details?.optionTypeShort;

    const matchingTrade = (trades || []).find(t => {
      const tRoot = (t.details?.rootSymbol || t.symbol || '').toUpperCase().replace('/', '');
      const sameRoot = tRoot === pRoot || tRoot.includes(pRoot) || pRoot.includes(tRoot);
      if (!sameRoot) return false;
      if (pExp && t.details?.expirationDate && t.details.expirationDate !== pExp) return false;
      if (pStrike !== undefined && t.details?.strike !== undefined && Math.abs(t.details.strike - pStrike) > 0.1) return false;
      if (pType && t.details?.optionTypeShort && t.details.optionTypeShort !== pType) return false;
      return true;
    });

    let tradeDate = matchingTrade?.date || foundPos.date || (foundPos as any).createdDate;
    if (!tradeDate && foundPos.details?.dte !== undefined && foundPos.details?.daysLeft !== undefined && foundPos.details.dte > foundPos.details.daysLeft) {
      const daysAgo = foundPos.details.dte - foundPos.details.daysLeft;
      tradeDate = subDays(new Date(), daysAgo).toISOString();
    }
    if (!tradeDate) {
      tradeDate = new Date().toISOString();
    }

    const req = foundPos.requiredCapital || foundPos.capReq || (foundPos.totalValue && foundPos.totalValue > 0 ? foundPos.totalValue : (foundPos.averagePrice * Math.abs(foundPos.quantity)));
    const peak = foundPos.peakCapital || (req * 1.15);

    return {
      id: foundPos.id,
      accountId: foundPos.accountId,
      brokerName: foundPos.brokerName,
      symbol: foundPos.symbol,
      type: foundPos.quantity >= 0 ? 'Buy' : 'Sell',
      quantity: Math.abs(foundPos.quantity),
      price: foundPos.averagePrice || foundPos.currentPrice,
      date: tradeDate,
      status: 'Open',
      closePrice: null,
      closeDate: null,
      requiredCapital: req,
      peakCapital: peak,
      description: `${foundPos.details?.action || (foundPos.quantity >= 0 ? 'BTO' : 'STO')} ${Math.abs(foundPos.quantity)} ${foundPos.symbol}`,
      details: foundPos.details
    } as Trade;
  }, [trades]);

  const activeTrade = useMemo(() => {
    if (!activeTradeId) {
      return (filteredTrades || [])[0] || (trades || [])[0] || null;
    }
    const foundTrade = (trades || []).find(t => t.id === activeTradeId);
    if (foundTrade) return foundTrade;

    const foundPos = (positions || []).find(p => p.id === activeTradeId);
    if (foundPos) {
      return normalizePositionToTrade(foundPos);
    }

    // Check if activeTradeId is a strategy ID in groupedTrades or groupedPositions
    const allGroups = activeTab === 'positions' ? groupedPositions : groupedTrades;
    for (const uGroup of allGroups) {
      for (const strat of uGroup.strategies) {
        if (strat.id === activeTradeId) {
          const firstItem = strat.items[0];
          if (!firstItem) continue;
          if ('openPnl' in firstItem) {
            return normalizePositionToTrade(firstItem as Position);
          }
          return firstItem as Trade;
        }
      }
    }

    const otherGroups = activeTab === 'positions' ? groupedTrades : groupedPositions;
    for (const uGroup of otherGroups) {
      for (const strat of uGroup.strategies) {
        if (strat.id === activeTradeId) {
          const firstItem = strat.items[0];
          if (!firstItem) continue;
          if ('openPnl' in firstItem) {
            return normalizePositionToTrade(firstItem as Position);
          }
          return firstItem as Trade;
        }
      }
    }

    return (filteredTrades || [])[0] || (trades || [])[0] || null;
  }, [trades, positions, activeTradeId, filteredTrades, activeTab, groupedPositions, groupedTrades, normalizePositionToTrade]);

  const activeStrategy = useMemo(() => {
    const allGroups = activeTab === 'positions' ? groupedPositions : groupedTrades;
    for (const uGroup of allGroups) {
      for (const strat of uGroup.strategies) {
        if (strat.id === activeTradeId || (activeTrade && strat.items.some((item: any) => item.id === activeTradeId || item.id === activeTrade.id))) {
          return strat;
        }
      }
    }
    const otherGroups = activeTab === 'positions' ? groupedTrades : groupedPositions;
    for (const uGroup of otherGroups) {
      for (const strat of uGroup.strategies) {
        if (strat.id === activeTradeId || (activeTrade && strat.items.some((item: any) => item.id === activeTradeId || item.id === activeTrade.id))) {
          return strat;
        }
      }
    }
    return null;
  }, [activeTrade, activeTradeId, activeTab, groupedPositions, groupedTrades]);

  const activeMetrics = activeTrade ? calculateROI(activeTrade) : null;

  // Strategy Metrics Calculator (Lifecycle-Weighted Option A) - Shared between Table & Inspector
  const calculateStrategyMetrics = useCallback((strategy: StrategyGroup<any> | null) => {
    if (!strategy) return null;
    let totalReqCap = 0;
    let totalPeakCap = 0;
    let totalExitCap = 0;
    let totalNetProfit = 0;
    let totalGrossCredit = 0;
    let totalGrossDebit = 0;
    let totalFees = 0;
    let maxDaysHeld = 1;
    let hasOpenLeg = false;
    let totalMarketVal = 0;
    const itemDates: number[] = [];

    const isTradeGroup = (strategy.items as any[]).some(i => 'status' in i || i.date);

    for (const item of strategy.items as any[]) {
      const isPosItem = 'openPnl' in item;
      const isTradeItem = 'status' in item;

      const itemFees = item.fees || item.details?.fees || 0;
      totalFees += itemFees;

      if (item.grossValue !== undefined) {
        if (item.grossValue > 0) totalGrossCredit += item.grossValue;
        else totalGrossDebit += item.grossValue;
      } else if (item.details?.grossValue !== undefined) {
        if (item.details.grossValue > 0) totalGrossCredit += item.details.grossValue;
        else totalGrossDebit += item.details.grossValue;
      } else {
        const mult = item.details?.multiplier || 1;
        const gross = (item.price || item.averagePrice || 0) * (item.quantity || 1) * mult;
        const isCredit = item.details?.action === 'STO' || item.details?.action === 'STC' || item.type === 'Sell';
        if (isCredit) totalGrossCredit += gross;
        else totalGrossDebit -= gross;
      }

      let itemDate = item.date || item.createdDate;
      if (!itemDate && isPosItem) {
        const pRoot = (item.details?.rootSymbol || item.symbol || '').toUpperCase().replace('/', '');
        const pExp = item.details?.expirationDate;
        const pStrike = item.details?.strike;
        const pType = item.details?.optionTypeShort;

        const matchingTrade = (trades || []).find(t => {
          const tRoot = (t.details?.rootSymbol || t.symbol || '').toUpperCase().replace('/', '');
          const sameRoot = tRoot === pRoot || tRoot.includes(pRoot) || pRoot.includes(tRoot);
          if (!sameRoot) return false;
          if (pExp && t.details?.expirationDate && t.details.expirationDate !== pExp) return false;
          if (pStrike !== undefined && t.details?.strike !== undefined && Math.abs(t.details.strike - pStrike) > 0.1) return false;
          if (pType && t.details?.optionTypeShort && t.details.optionTypeShort !== pType) return false;
          return true;
        });
        if (matchingTrade?.date) itemDate = matchingTrade.date;
      }
      if (!itemDate && item.details?.dte !== undefined && item.details?.daysLeft !== undefined && item.details.dte > item.details.daysLeft) {
        itemDate = subDays(new Date(), item.details.dte - item.details.daysLeft).toISOString();
      }

      if (itemDate) {
        const t = new Date(itemDate).getTime();
        if (!isNaN(t)) itemDates.push(t);
      }
      if (item.closeDate) {
        const t = new Date(item.closeDate).getTime();
        if (!isNaN(t)) itemDates.push(t);
      }

      if (isPosItem) {
        hasOpenLeg = true;
        totalNetProfit += (item.openPnl || 0);
        totalMarketVal += (item.totalValue || 0);
        const itemPrice = item.averagePrice || item.currentPrice || 0;
        const qty = Math.abs(item.quantity || 1);
        const mult = item.details?.multiplier || 1;
        const req = (item.requiredCapital && item.requiredCapital > 0)
          ? item.requiredCapital
          : (item.capReq && item.capReq > 0)
            ? item.capReq
            : (item.totalValue && item.totalValue > 0)
              ? item.totalValue
              : (itemPrice * qty * mult);
        const peak = item.peakCapital || (req * 1.15);
        const curr = req;
        totalReqCap += req;
        totalPeakCap += peak;
        totalExitCap += curr;
      } else if (isTradeItem) {
        if (item.status === 'Open') hasOpenLeg = true;
        const legRoi = calculateROI(item as Trade);
        if (legRoi) {
          totalNetProfit += legRoi.profit;
          maxDaysHeld = Math.max(maxDaysHeld, legRoi.daysHeld);
          if (isTradeGroup) {
            totalReqCap = Math.max(totalReqCap, legRoi.reqCap);
            totalPeakCap = Math.max(totalPeakCap, legRoi.peakCap);
            totalExitCap = Math.max(totalExitCap, legRoi.exitCap);
          } else {
            totalReqCap += legRoi.reqCap;
            totalPeakCap += legRoi.peakCap;
            totalExitCap += legRoi.exitCap;
          }
        } else {
          const req = item.requiredCapital || 0;
          totalReqCap = Math.max(totalReqCap, req);
          totalPeakCap = Math.max(totalPeakCap, item.peakCapital || (req * 1.15));
          totalExitCap = Math.max(totalExitCap, req);
        }
        totalMarketVal += item.requiredCapital || 0;
      }
    }

    // Compute strategy-level holding days across all legs in strategy
    let stratDaysHeld = 1;
    if (itemDates.length > 1) {
      const minDate = Math.min(...itemDates);
      const maxDate = Math.max(...itemDates);
      const span = differenceInDays(new Date(maxDate), new Date(minDate));
      if (!isNaN(span) && span > 0) {
        stratDaysHeld = span;
      }
    }

    // If strategy is open, calculate elapsed days from earliest entry to today
    if (hasOpenLeg && itemDates.length > 0) {
      const minDate = Math.min(...itemDates);
      const spanNow = differenceInDays(new Date(), new Date(minDate));
      if (!isNaN(spanNow) && spanNow > 0) {
        stratDaysHeld = Math.max(stratDaysHeld, spanNow);
      }
    }

    // Fallbacks if span between dates was single day
    if (stratDaysHeld === 1) {
      if (maxDaysHeld > 1) {
        stratDaysHeld = maxDaysHeld;
      } else if (strategy.expirationDate && itemDates.length > 0) {
        try {
          const expT = parseISO(strategy.expirationDate).getTime();
          const minDate = Math.min(...itemDates);
          const spanExp = differenceInDays(new Date(expT), new Date(minDate));
          if (!isNaN(spanExp) && spanExp > 0) {
            stratDaysHeld = spanExp;
          }
        } catch {}
      } else if (strategy.dte !== undefined && strategy.daysLeft !== undefined) {
        const spanDte = strategy.dte - strategy.daysLeft;
        if (spanDte > 0) stratDaysHeld = spanDte;
      }
    }

    if (totalReqCap <= 0) totalReqCap = Math.abs(strategy.netCostBasis) || 1;
    if (totalPeakCap <= 0) totalPeakCap = totalReqCap * 1.15;
    if (totalExitCap <= 0) totalExitCap = totalReqCap;

    const totalAvgCapital = Math.max(1, (totalReqCap + totalPeakCap + totalExitCap) / 3);
    const avgROI = totalAvgCapital > 0 ? (totalNetProfit / totalAvgCapital) * 100 : 0;
    const peakROI = totalPeakCap > 0 ? (totalNetProfit / totalPeakCap) * 100 : 0;
    const annualizedROI = avgROI * (365 / Math.max(1, stratDaysHeld));

    return {
      strategyName: strategy.strategyName,
      strategyType: strategy.strategyType,
      legsCount: strategy.items.length,
      isOpen: hasOpenLeg,
      totalRequiredCapital: totalReqCap,
      totalPeakCapital: totalPeakCap,
      totalExitCapital: totalExitCap,
      totalAvgCapital: totalAvgCapital,
      netProfit: totalNetProfit,
      totalGrossCredit,
      totalGrossDebit,
      totalFees,
      avgROI: isNaN(avgROI) ? 0 : avgROI,
      peakROI: isNaN(peakROI) ? 0 : peakROI,
      annualizedROI: isNaN(annualizedROI) ? 0 : annualizedROI,
      daysHeld: stratDaysHeld,
      totalValue: totalMarketVal,
      netCostBasis: strategy.netCostBasis,
      netCurrentPrice: strategy.netCurrentPrice
    };
  }, [trades, calculateROI]);

  const strategyMetrics = useMemo(() => {
    return calculateStrategyMetrics(activeStrategy);
  }, [activeStrategy, calculateStrategyMetrics]);

  // --- Table wiring -------------------------------------------------------
  // Column definitions for the shared DataTable. These replace four
  // hand-written <table> blocks that duplicated ~690 lines of markup.
  const tradeColumns = useMemo(
    () => buildTradeColumns({ calculateROI, calculateStrategyMetrics }, groupBy),
    [calculateROI, calculateStrategyMetrics, groupBy]
  );

  const positionColumns = useMemo(() => buildPositionColumns(groupBy), [groupBy]);

  const collapseState = useMemo(
    () => ({
      underlyings: collapsedUnderlyings,
      strategies: collapsedStrategies,
      toggleUnderlying,
      toggleStrategy,
    }),
    [collapsedUnderlyings, collapsedStrategies]
  );

  const isFiltered = searchFilter.trim().length > 0;

  // --- Derived series for the inline visualisations -----------------------
  // Everything below is computed from data already synced. Where no history
  // exists (net liq, cash) the card gets a meter instead of a sparkline rather
  // than a fabricated series.
  const realizedPnlSeries = useMemo(() => {
    const closed = filteredTrades
      .filter((t) => t.status === 'Closed' && t.closeDate)
      .map((t) => ({ date: t.closeDate as string, profit: calculateROI(t)?.profit ?? 0 }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let cumulative = 0;
    return closed.map((entry) => {
      cumulative += entry.profit;
      return { label: formatTradeDateTime(entry.date), value: cumulative };
    });
  }, [filteredTrades, calculateROI]);

  const tradeActivitySeries = useMemo(() => {
    const buckets = new Map<string, { label: string; time: number; value: number }>();

    for (const trade of filteredTrades) {
      if (!trade.date) continue;
      const parsed = new Date(trade.date);
      if (Number.isNaN(parsed.getTime())) continue;

      // Bucket by ISO week-start so the series reads as a trend, not noise.
      const weekStart = new Date(parsed);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

      const key = weekStart.toISOString().slice(0, 10);
      const existing = buckets.get(key);
      if (existing) {
        existing.value += 1;
      } else {
        buckets.set(key, {
          label: `Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
          time: weekStart.getTime(),
          value: 1,
        });
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.time - b.time)
      .map(({ label, value }) => ({ label, value }));
  }, [filteredTrades]);

  const positionsSplit = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (const position of filteredPositions) {
      const pnl = position.openPnl || 0;
      if (pnl > 0) wins += 1;
      else if (pnl < 0) losses += 1;
    }
    return { wins, losses };
  }, [filteredPositions]);

  const positionsMarketValue = useMemo(
    () => filteredPositions.reduce((sum, p) => sum + (p.totalValue || 0), 0),
    [filteredPositions]
  );

  // Realized P&L is derived only from CLOSED trades, so it never picks up the
  // synthesised flat-5% estimate that calculateROI applies to open trades with
  // no matching position.
  const realizedPnlTotal = realizedPnlSeries.length
    ? realizedPnlSeries[realizedPnlSeries.length - 1].value
    : 0;

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error('Google Sign In failed:', err);
      const code = err.code || '';
      const msg = err.message || '';
      if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        const currentHost = window.location.hostname;
        setAuthError(`Domain "${currentHost}" is not authorized in Firebase. Please add "${currentHost}" to Authorized Domains in your Firebase Authentication Console.`);
      } else if (code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed before completing authentication.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Popup was blocked by the browser. Please allow popups for this site.');
      } else {
        setAuthError(err.message || 'Failed to sign in with Google');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div
        className="min-h-screen bg-background flex flex-col items-center justify-center gap-5 p-4"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand-fill/20 ring-1 ring-brand/30">
            <TrendingUp className="size-4.5 text-brand" aria-hidden="true" />
          </div>
          <span className="font-heading text-xl font-extrabold tracking-tight text-foreground">
            Alphatrack
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-xs tracking-wide text-muted-foreground">
          <Spinner size="sm" label="" />
          <span>Loading your portfolio…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-border text-foreground shadow-2xl">
          <CardHeader className="text-center pb-6">
            <div className="mx-auto w-14 h-14 bg-brand/10 rounded-2xl flex items-center justify-center mb-4 border border-brand/20">
              <TrendingUp className="w-7 h-7 text-brand" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground/85 to-brand bg-clip-text text-transparent">
              Alphatrack
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Connect to any brokerage account via SnapTrade. Universal multi-broker portfolio & capital-adjusted ROI tracking.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-8">
            {authError && (
              <div className="bg-loss/10 border border-loss/30 text-loss text-xs p-3.5 rounded-xl leading-relaxed">
                <div className="font-semibold text-loss flex items-center gap-1.5 mb-1">
                  <AlertCircle className="w-4 h-4" />
                  <span>Authentication Notice</span>
                </div>
                <div>{authError}</div>
              </div>
            )}

            <Button 
              onClick={handleGoogleLogin} 
              disabled={isSigningIn}
              size="lg" 
              className="w-full bg-brand-fill hover:bg-brand-fill/85 text-white font-medium py-6 rounded-xl shadow-lg shadow-brand-fill/20 flex items-center justify-center gap-3 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSigningIn ? (
                <Spinner size="md" label="" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              {isSigningIn ? 'Opening Google Login...' : 'Sign in with Google'}
            </Button>
            <div className="flex items-center justify-center gap-2 text-xs text-subtle-foreground mt-2">
              <ShieldCheck className="w-4 h-4 text-profit" />
              <span>Supports Tastytrade, Robinhood, Schwab, Fidelity, Webull & 100+ brokers</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSelectRow = (id: string) => {
    setActiveTradeId(id);
    const allGroups = activeTab === 'positions' ? groupedPositions : groupedTrades;
    const isStrategy = allGroups.some((u) => u.strategies.some((s) => s.id === id));
    if (isStrategy) {
      setInspectorMode('strategy');
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-background text-foreground antialiased selection:bg-brand selection:text-foreground lg:h-screen lg:overflow-hidden">
      <AppHeader
        user={user}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={setSelectedAccountId}
        connections={connections}
        tastyConnected={tastyConnected}
        dbError={dbError}
        isDemoData={!apiStatus.isConfigured && accounts.length > 0}
        refreshing={refreshing}
        lastSyncedAt={lastSyncedAt}
        onRefresh={handleRefresh}
        onOpenTastyDialog={() => setTastyDialogOpen(true)}
        onOpenConnectionsDialog={() => setConnectionsDialogOpen(true)}
        onOpenConnectionPortal={() => handleOpenConnectionPortal()}
        onSignOut={logout}
      />

      {/* Sync failures were previously silent — only a console.error. */}
      {syncError && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-loss/25 bg-loss/10 px-4 py-2 text-xs text-loss lg:px-6"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            {syncError}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="cursor-pointer rounded px-2 py-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              aria-label="Dismiss sync error"
              className="cursor-pointer rounded p-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}

      {/* Main Content Area */}
      {accounts.length === 0 && !loading ? (
        <main className="flex-1 flex items-center justify-center p-6">
          {connections.length > 0 ? (
            <Card className="w-full max-w-lg bg-card border-border/80 shadow-2xl p-6 text-center">
              <div className="mx-auto w-16 h-16 bg-brand/10 rounded-2xl flex items-center justify-center mb-5 border border-brand/20">
                <Building2 className="w-8 h-8 text-brand" />
              </div>
              <CardTitle className="text-2xl font-bold text-foreground mb-2">Brokerage Linked</CardTitle>
              <CardDescription className="text-muted-foreground text-sm leading-relaxed mb-6">
                You have {connections.length} linked brokerage connection(s). If your accounts are still syncing or require periodic authentication refresh, you can reconnect or trigger an immediate sync below.
              </CardDescription>

              <div className="flex flex-col gap-3 mb-6">
                {connections.map((c) => (
                  <div key={c.id} className="bg-surface-2 border border-border rounded-xl p-3.5 flex items-center justify-between">
                    <div className="text-left">
                      <div className="text-xs font-bold text-foreground">{c.brokerage?.name || 'Brokerage Connection'}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Status: {c.disabled ? (
                          <span className="text-warning font-medium">Re-authentication Required</span>
                        ) : (
                          <span className="text-profit font-medium">Active & Connected</span>
                        )}
                      </div>
                    </div>
                    {c.disabled && (
                      <Button
                        onClick={() => handleOpenConnectionPortal(c.id)}
                        size="sm"
                        className="bg-warning-fill hover:bg-warning-fill/85 text-white text-xs h-7 px-3 rounded-lg"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Reconnect
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  size="lg"
                  variant="outline"
                  className="flex-1 border-border bg-surface-2 hover:bg-surface-3 text-foreground text-xs py-5 rounded-xl cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin text-brand' : ''}`} />
                  Sync Portfolio
                </Button>
                <Button
                  onClick={() => handleOpenConnectionPortal()}
                  size="lg"
                  className="flex-1 bg-brand-fill hover:bg-brand-fill/85 text-foreground text-xs py-5 rounded-xl shadow-lg shadow-brand-fill/20 cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Link Another Broker
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="w-full max-w-lg bg-card border-border/80 shadow-2xl p-6 text-center">
              <div className="mx-auto w-16 h-16 bg-brand/10 rounded-2xl flex items-center justify-center mb-5 border border-brand/20">
                <Building2 className="w-8 h-8 text-brand" />
              </div>
              <CardTitle className="text-2xl font-bold text-foreground mb-2">Connect Your Brokerage</CardTitle>
              <CardDescription className="text-muted-foreground text-sm leading-relaxed mb-6">
                Connect your Tastytrade, Robinhood, Charles Schwab, Fidelity, Webull, or Interactive Brokers account via SnapTrade to automatically sync your positions, transactions, and ROI analytics.
              </CardDescription>

              <div className="grid grid-cols-3 gap-2 mb-6">
                {['Tastytrade', 'Robinhood', 'Charles Schwab', 'Fidelity', 'Webull', 'Interactive Brokers'].map((broker) => (
                  <div key={broker} className="bg-surface-2 border border-border rounded-lg p-2 text-xs font-medium text-muted-foreground">
                    {broker}
                  </div>
                ))}
              </div>

              <Button
                onClick={() => handleOpenConnectionPortal()}
                size="lg"
                className="w-full bg-brand-fill hover:bg-brand-fill/85 text-foreground font-semibold py-6 rounded-xl shadow-lg shadow-brand-fill/20 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <PlusCircle className="w-5 h-5" />
                Link Brokerage Account
              </Button>
            </Card>
          )}
        </main>
      ) : (
        <main className="flex-1 flex flex-col p-4 lg:p-6 max-w-[1700px] w-full mx-auto gap-4 lg:gap-6 lg:min-h-0 lg:overflow-hidden">
          {/*
            Metric strip. Each card is a stat tile; its visualisation matches
            its own label. Net Liq and Cash get meters rather than sparklines
            because no historical series exists for them — synthesising one
            would be dishonest.
          */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 shrink-0">
            <MetricCard
              label="Portfolio Net Liq"
              icon={Wallet}
              loading={loading}
              value={<Money value={portfolioSummary.netLiq} />}
              viz={
                portfolioSummary.netLiq > 0 ? (
                  <SplitMeter
                    value={positionsMarketValue}
                    total={portfolioSummary.netLiq}
                    tone="brand"
                    label="Deployed in positions"
                  />
                ) : undefined
              }
              footer={
                selectedAccountId === 'ALL'
                  ? `Across ${accounts.length} linked ${accounts.length === 1 ? 'account' : 'accounts'}`
                  : 'Selected account'
              }
            />

            <MetricCard
              label="Cash Balance"
              icon={DollarSign}
              accent="profit"
              loading={loading}
              value={<Money value={portfolioSummary.cash} />}
              viz={
                portfolioSummary.netLiq > 0 ? (
                  <SplitMeter
                    value={portfolioSummary.cash}
                    total={portfolioSummary.netLiq}
                    tone="profit"
                    label="Share of net liq"
                  />
                ) : undefined
              }
              footer={
                <span className="flex items-center justify-between">
                  <span>Option BP</span>
                  <Money value={portfolioSummary.buyingPower} className="text-muted-foreground" />
                </span>
              }
            />

            <MetricCard
              label="Realized P&L"
              icon={TrendingUp}
              loading={loading}
              value={<PnL value={realizedPnlTotal} size="lg" />}
              viz={
                <Sparkline
                  data={realizedPnlSeries}
                  tone="polarity"
                  currency="USD"
                  ariaLabel="Cumulative realized profit and loss over time"
                />
              }
              footer={`${portfolioSummary.tradesCount} ${
                portfolioSummary.tradesCount === 1 ? 'trade' : 'trades'
              } synced${realizedPnlSeries.length ? '' : ' · no closed trades yet'}`}
            />

            <MetricCard
              label="Open Positions"
              icon={Layers}
              accent="warning"
              loading={loading}
              value={portfolioSummary.positionsCount}
              viz={
                positionsSplit.wins + positionsSplit.losses > 0 ? (
                  <WinLossBar wins={positionsSplit.wins} losses={positionsSplit.losses} />
                ) : (
                  <Sparkline
                    data={tradeActivitySeries}
                    ariaLabel="Trades opened per week"
                  />
                )
              }
              footer={
                <span className="flex items-center justify-between">
                  <span>Market value</span>
                  <Money value={positionsMarketValue} className="text-muted-foreground" />
                </span>
              }
            />
          </div>

          {/* Main Grid: Data Table + Trade Inspector Sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_400px] gap-4 lg:gap-6 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
            {/* Left Content Table */}
            <div className="bg-card ring-1 ring-border rounded-2xl flex flex-col overflow-hidden lg:min-h-0 lg:h-full">
              <TableToolbar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tradesCount={filteredTrades.length}
                positionsCount={filteredPositions.length}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                search={searchFilter}
                onSearchChange={setSearchFilter}
                period={periodFilter}
                onPeriodChange={setPeriodFilter}
              />

              {/*
                One shared DataTable serves all four view combinations
                (trades/positions x grouped/flat). These were previously four
                hand-written table blocks totalling ~690 lines, with the same
                header markup repeated 32 times.
              */}
              {activeTab === 'trades' ? (
                <DataTable<Trade>
                  caption={
                    groupBy === 'strategy'
                      ? 'Trades and ROI history, grouped by underlying and strategy'
                      : 'Trades and ROI history'
                  }
                  columns={tradeColumns}
                  rows={groupBy === 'flat' ? filteredTrades : undefined}
                  groups={groupBy === 'strategy' ? groupedTrades : undefined}
                  collapse={collapseState}
                  selectedId={activeTradeId}
                  onSelect={handleSelectRow}
                  loading={loading}
                  className="min-h-0 flex-1"
                  empty={
                    <EmptyState
                      variant={isFiltered ? 'no-results' : 'no-data'}
                      title={isFiltered ? 'No trades match your search' : 'No trades synced yet'}
                      body={
                        isFiltered
                          ? `Nothing matched "${searchFilter}". Try another symbol or broker.`
                          : 'Once a brokerage is linked and synced, your transaction history appears here.'
                      }
                      action={
                        isFiltered
                          ? { label: 'Clear search', onClick: () => setSearchFilter('') }
                          : { label: 'Sync portfolio', onClick: handleRefresh }
                      }
                    />
                  }
                />
              ) : (
                <DataTable<Position>
                  caption={
                    groupBy === 'strategy'
                      ? 'Open positions, grouped by underlying and strategy'
                      : 'Open positions'
                  }
                  columns={positionColumns}
                  rows={groupBy === 'flat' ? filteredPositions : undefined}
                  groups={groupBy === 'strategy' ? groupedPositions : undefined}
                  collapse={collapseState}
                  selectedId={activeTradeId}
                  onSelect={handleSelectRow}
                  loading={loading}
                  className="min-h-0 flex-1"
                  empty={
                    <EmptyState
                      variant={isFiltered ? 'no-results' : 'no-data'}
                      title={isFiltered ? 'No positions match your search' : 'No open positions'}
                      body={
                        isFiltered
                          ? `Nothing matched "${searchFilter}". Try another symbol or broker.`
                          : 'Open positions reported by your linked brokerages will appear here.'
                      }
                      action={
                        isFiltered
                          ? { label: 'Clear search', onClick: () => setSearchFilter('') }
                          : { label: 'Sync portfolio', onClick: handleRefresh }
                      }
                    />
                  }
                />
              )}
            </div>

            {/* Right Sidebar: Detailed Trade Inspector */}
            <aside className="flex flex-col lg:min-h-0 lg:h-full lg:overflow-hidden">
              <div className="bg-card ring-1 ring-border rounded-2xl p-6 flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-y-auto custom-scrollbar">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-border/80 mb-5">
                    <span className="text-sm font-bold text-foreground">Trade & Strategy Inspector</span>
                  </div>

                  {activeTrade && activeMetrics ? (
                    <>
                      <div className="mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-foreground font-mono">
                              {activeTrade.details?.rootSymbol || activeTrade.symbol}
                            </span>
                            {activeTrade.details?.futureCycle && (
                              <span className="bg-surface-3 text-brand font-mono text-xs font-bold px-2 py-0.5 rounded border border-brand/30">
                                {activeTrade.details.futureCycle}
                              </span>
                            )}
                            {activeStrategy && (
                              <span className="bg-strategy/15 text-strategy font-sans text-xs font-bold px-2 py-0.5 rounded border border-strategy/30">
                                {activeStrategy.strategyName}
                              </span>
                            )}
                          </div>
                          <span className="bg-surface-3 text-muted-foreground px-2.5 py-0.5 rounded text-[11px] font-medium border border-border">
                            {activeTrade.brokerName}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 font-sans">
                          {activeStrategy 
                            ? `${activeStrategy.strategyName} (${activeStrategy.items.length} ${activeStrategy.items.length === 1 ? 'leg' : 'legs'} · ${activeStrategy.expirationFormatted || 'Active'})`
                            : activeTrade.details?.isOption 
                              ? (activeTrade.details.isFuture ? 'Option on Future Contract' : 'Equity Option Contract')
                              : (activeTrade.details?.isFuture ? 'Futures Instrument' : 'Equity Asset')}
                        </div>
                      </div>

                      {/* View Switcher if Multi-Leg Strategy */}
                      {activeStrategy && activeStrategy.items.length > 1 && (
                        <div className="flex items-center bg-surface-0 p-1 rounded-xl border border-border/80 mb-4 text-xs font-sans">
                          <button
                            onClick={() => setInspectorMode('strategy')}
                            className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                              inspectorMode === 'strategy'
                                ? 'bg-strategy/25 text-strategy border border-strategy/40 shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <Layers className="w-3.5 h-3.5 text-strategy" />
                            <span>Whole Strategy ({activeStrategy.items.length} legs)</span>
                          </button>
                          <button
                            onClick={() => setInspectorMode('leg')}
                            className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                              inspectorMode === 'leg'
                                ? 'bg-brand-fill/25 text-brand border border-brand/40 shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <TrendingUp className="w-3.5 h-3.5 text-brand" />
                            <span>Selected Leg</span>
                          </button>
                        </div>
                      )}

                      {/* Multi-Leg Strategy Breakdown Card if strategy has > 1 leg */}
                      {activeStrategy && activeStrategy.items.length > 1 && (
                        <div className="bg-surface-2 border border-strategy/30 rounded-xl p-3 mb-4 font-sans">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2 border-b border-border/80 pb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-strategy"></span>
                              <span className="font-bold text-strategy">{activeStrategy.strategyName} Multi-Leg Structure</span>
                            </div>
                            <span className={`font-mono font-bold ${(strategyMetrics?.netProfit ?? activeStrategy.totalOpenPnl) >= 0 ? 'text-profit' : 'text-loss'}`}>
                              <PnL value={strategyMetrics?.netProfit ?? activeStrategy.totalOpenPnl} />
                            </span>
                          </div>
                          <div className="space-y-1.5 text-xs font-mono">
                            {activeStrategy.items.map((item: any) => {
                              const isThisLeg = item.id === activeTrade.id;
                              const legAction = item.details?.action;
                              const legQty = item.quantity;
                              const signedQtyDisplay = legAction === 'STO' || legAction === 'STC'
                                ? `-${Math.abs(legQty)}`
                                : `+${Math.abs(legQty)}`;
                              const itemPnl = item.openPnl !== undefined ? item.openPnl : (calculateROI(item)?.profit);

                              return (
                                <div 
                                  key={`strat-item-${item.id}`}
                                  onClick={() => {
                                    setActiveTradeId(item.id);
                                    if (inspectorMode === 'strategy') {
                                      // Keep strategy or allow quick leg peek
                                    }
                                  }}
                                  className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer transition-colors ${
                                    isThisLeg ? 'bg-brand-fill/25 border border-brand/40 text-foreground' : 'hover:bg-surface-3/60 text-muted-foreground'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`font-bold ${legAction === 'STO' || legAction === 'STC' || legQty < 0 ? 'text-warning' : 'text-profit'}`}>
                                      {signedQtyDisplay}
                                    </span>
                                    <span>{item.details?.strikeFormatted} {item.details?.optionTypeShort}</span>
                                    <span className="text-[10px] text-muted-foreground">{item.details?.expirationFormatted}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">{<Money value={(item.currentPrice || item.price || 0)} />}</span>
                                    {itemPnl !== undefined && (
                                      <span className={`font-bold ${itemPnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                        <PnL value={itemPnl} size="sm" />
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Selected Leg Pill Badge Card (When in Leg View or Single Leg Strategy) */}
                      {(inspectorMode === 'leg' || !activeStrategy || activeStrategy.items.length <= 1) && activeTrade.details?.isOption && (
                        <div className="bg-surface-2 border border-border/90 rounded-xl p-3 mb-4 font-sans">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2.5 border-b border-border pb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-muted-foreground">Selected Contract Leg</span>
                              {activeTrade.status === 'Open' ? (
                                <span className="bg-profit/20 text-profit text-[9px] px-1.5 py-0.5 rounded font-bold border border-profit/40">
                                  OPEN
                                </span>
                              ) : (
                                <span className="bg-surface-3 text-muted-foreground text-[9px] px-1.5 py-0.5 rounded font-medium border border-border">
                                  CLOSED
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-profit font-bold">
                              {<Money value={(activeTrade.price || 0)} />}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {activeTrade.details.futureCycle && (
                                <span className="bg-surface-3 text-brand font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-brand/30">
                                  {activeTrade.details.futureCycle}
                                </span>
                              )}
                              <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold border ${
                                activeTrade.details.action === 'STO' || activeTrade.details.action === 'STC'
                                  ? 'bg-warning/10 text-warning border-warning/30'
                                  : 'bg-profit/10 text-profit border-profit/30'
                              }`}>
                                {activeTrade.details.action === 'STO' || activeTrade.details.action === 'STC' ? `-${activeTrade.quantity}` : `+${activeTrade.quantity}`}
                              </span>
                              <span className="text-foreground text-xs font-medium">
                                {activeTrade.details.expirationFormatted}
                              </span>
                              {activeTrade.status === 'Open' ? (
                                <span className="text-[10px] text-profit bg-profit/15 px-1.5 py-0.5 rounded font-mono font-semibold border border-profit/30">
                                  {activeTrade.details.daysLeftFormatted || `${activeTrade.details.dte}d left`}
                                </span>
                              ) : (
                                activeTrade.details.dte !== undefined && (
                                  <span className="text-[10px] text-muted-foreground bg-surface-3 px-1.5 py-0.5 rounded font-mono">
                                    {activeTrade.details.dte}d
                                  </span>
                                )
                              )}
                              <span className="font-mono text-xs font-bold text-foreground">
                                {activeTrade.details.strikeFormatted}
                              </span>
                              {activeTrade.details.optionTypeShort && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  activeTrade.details.optionTypeShort === 'P'
                                    ? 'bg-warning/20 text-warning border border-warning/30'
                                    : 'bg-profit/20 text-profit border border-profit/30'
                                }`}>
                                  {activeTrade.details.optionTypeShort} ({activeTrade.details.optionType})
                                </span>
                              )}
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                              activeTrade.details.action === 'BTO' ? 'bg-profit/15 text-profit border border-profit/30' :
                              activeTrade.details.action === 'STO' ? 'bg-warning/15 text-warning border border-warning/30' :
                              activeTrade.details.action === 'BTC' ? 'bg-info/15 text-info border border-info/30' :
                              activeTrade.details.action === 'STC' ? 'bg-loss/15 text-loss border border-loss/30' :
                              'bg-surface-3 text-muted-foreground border border-border'
                            }`}>
                              {activeTrade.details.action}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* ROI hero tiles + capital-efficiency meter */}
                      {(() => {
                        const isStrategyView =
                          inspectorMode === 'strategy' && !!strategyMetrics && !!activeStrategy && activeStrategy.items.length > 1;
                        const avgROI = isStrategyView ? strategyMetrics!.avgROI : activeMetrics.avgROI || 0;
                        const peakROI = isStrategyView ? strategyMetrics!.peakROI : activeMetrics.peakROI || 0;
                        const annROI = isStrategyView ? strategyMetrics!.annualizedROI : activeMetrics.annualizedROI || 0;
                        const avgCap = isStrategyView ? strategyMetrics!.totalAvgCapital : activeMetrics.avgCapital || 0;
                        const peakCap = isStrategyView ? strategyMetrics!.totalPeakCapital : activeMetrics.peakCap || 0;

                        return (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { label: isStrategyView ? 'Strategy Avg ROI' : 'Avg Capital ROI', value: avgROI },
                                { label: isStrategyView ? 'Strategy Peak ROI' : 'Peak Capital ROI', value: peakROI },
                              ].map((tile) => (
                                <div key={tile.label} className="rounded-xl bg-surface-2 p-4 text-center ring-1 ring-border">
                                  <Percent value={tile.value} signed colored className="mb-1 block text-xl font-bold" />
                                  <div className="flex items-center justify-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
                                    {isStrategyView && <span className="size-1.5 rounded-full bg-strategy" aria-hidden="true" />}
                                    <span>{tile.label}</span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="rounded-xl bg-surface-2 p-4 ring-1 ring-border">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                  Annualized ROI
                                </span>
                                <Percent value={annROI} signed clamp={999} className="text-sm font-bold text-brand" />
                              </div>
                              {/* Capital efficiency: how much of the peak commitment the
                                  position averaged. Lower is more efficient. */}
                              <SplitMeter
                                value={avgCap}
                                total={peakCap || avgCap}
                                tone="brand"
                                label="Avg capital vs peak"
                                valueLabel={formatMoney(avgCap, { decimals: 0 })}
                              />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Detailed Statistics Table */}
                      <div className="mt-6 space-y-3 font-mono text-xs border-t border-border/80 pt-4">
                        {inspectorMode === 'strategy' && strategyMetrics && activeStrategy && activeStrategy.items.length > 1 ? (
                          <>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Strategy Status:</span>
                              <span className={strategyMetrics.isOpen ? 'text-profit font-bold' : 'text-muted-foreground font-semibold'}>
                                {strategyMetrics.isOpen ? `Open Active Position (${strategyMetrics.legsCount} legs)` : `Closed Strategy (${strategyMetrics.legsCount} legs)`}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Strategy Expiration:</span>
                              <span className="text-foreground">{activeStrategy.expirationFormatted || '-'}</span>
                            </div>
                            {strategyMetrics.isOpen ? (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground font-sans">Net Entry / Cost Basis:</span>
                                  <span className="text-foreground">{<Money value={Math.abs(strategyMetrics.netCostBasis)} />}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground font-sans">Net Market Price:</span>
                                  <span className="text-foreground">{<Money value={Math.abs(strategyMetrics.netCurrentPrice)} />}</span>
                                </div>
                              </>
                            ) : (
                              <>
                                {strategyMetrics.totalGrossCredit > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground font-sans">Gross Entry Credit:</span>
                                    <span className="text-profit">+{<Money value={strategyMetrics.totalGrossCredit} />}</span>
                                  </div>
                                )}
                                {strategyMetrics.totalGrossDebit < 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground font-sans">Gross Exit Debit:</span>
                                    <span className="text-loss">-{<Money value={Math.abs(strategyMetrics.totalGrossDebit)} />}</span>
                                  </div>
                                )}
                                {strategyMetrics.totalFees > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground font-sans">Total Fees & Comm.:</span>
                                    <span className="text-muted-foreground">-{<Money value={strategyMetrics.totalFees} />}</span>
                                  </div>
                                )}
                              </>
                            )}
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Initial Entry Capital:</span>
                              <span className="text-foreground">{<Money value={strategyMetrics.totalRequiredCapital} />}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Peak Capital Exposure:</span>
                              <span className="text-foreground">{<Money value={strategyMetrics.totalPeakCapital} />}</span>
                            </div>
                            <div className="flex justify-between text-brand font-semibold">
                              <span className="text-muted-foreground font-sans">Average Capital Deployed:</span>
                              <span>{<Money value={strategyMetrics.totalAvgCapital} />}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">{strategyMetrics.isOpen ? 'Strategy Unrealized P/L:' : 'Strategy Realized P/L:'}</span>
                              <span className={strategyMetrics.netProfit >= 0 ? 'text-profit font-bold' : 'text-loss font-bold'}>
                                <PnL value={strategyMetrics.netProfit} />
                              </span>
                            </div>
                            <div className="flex justify-between border-t border-border/60 pt-2">
                              <span className="text-muted-foreground font-sans">Holding Period:</span>
                              <span className="text-foreground">{strategyMetrics.daysHeld} {strategyMetrics.daysHeld === 1 ? 'day' : 'days'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Strategy Annualized ROI:</span>
                              <span className="text-brand font-bold">{strategyMetrics.annualizedROI.toFixed(1)}%</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Status:</span>
                              <span className={activeTrade.status === 'Open' ? 'text-profit font-bold' : 'text-muted-foreground font-semibold'}>
                                {activeTrade.status === 'Open' ? 'Open Active Position' : 'Closed Trade'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Execution Date:</span>
                              <span className="text-foreground">{formatTradeDateTime(activeTrade.date)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Entry Price / Qty:</span>
                              <span className="text-foreground">{<Money value={(activeTrade.price || 0)} />} × {activeTrade.quantity || 1}</span>
                            </div>
                            {activeTrade.fees ? (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground font-sans">Fees & Commissions:</span>
                                <span className="text-muted-foreground">-{<Money value={activeTrade.fees} />}</span>
                              </div>
                            ) : null}
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Required Capital at Open:</span>
                              <span className="text-foreground">{<Money value={(activeTrade.requiredCapital || 0)} />}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Peak Capital Exposure:</span>
                              <span className="text-foreground">{<Money value={(activeTrade.peakCapital || 0)} />}</span>
                            </div>
                            <div className="flex justify-between text-brand font-semibold">
                              <span className="text-muted-foreground font-sans">Average Capital Deployed:</span>
                              <span>${(activeMetrics.avgCapital || activeTrade.requiredCapital || 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">{activeTrade.status === 'Open' ? 'Unrealized Gain/Loss:' : 'Net Cash Flow / P&L:'}</span>
                              <span className={(activeMetrics.profit || 0) >= 0 ? 'text-profit font-bold' : 'text-loss font-bold'}>
                                <PnL value={activeMetrics.profit || 0} />
                              </span>
                            </div>
                            <div className="flex justify-between border-t border-border/60 pt-2">
                              <span className="text-muted-foreground font-sans">Holding Period:</span>
                              <span className="text-foreground">{activeMetrics.daysHeld || 1} {(activeMetrics.daysHeld || 1) === 1 ? 'day' : 'days'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-sans">Annualized ROI:</span>
                              <span className="text-brand font-bold">{(activeMetrics.annualizedROI || 0).toFixed(1)}%</span>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="mt-6 p-4 bg-brand/5 rounded-xl border border-brand/20 text-xs font-sans">
                        <div className="text-brand font-bold uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Capital Efficiency Insight</span>
                        </div>
                        <p className="text-muted-foreground text-[11px] leading-relaxed">
                          {inspectorMode === 'strategy' && strategyMetrics && activeStrategy && activeStrategy.items.length > 1 ? (
                            `Allocated an average of $${strategyMetrics.totalAvgCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${strategyMetrics.legsCount} legs in ${activeStrategy.strategyName} structure over ${strategyMetrics.daysHeld} ${strategyMetrics.daysHeld === 1 ? 'day' : 'days'} (ranging from $${strategyMetrics.totalRequiredCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at open to a peak of $${strategyMetrics.totalPeakCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}), delivering an annualized yield of ${strategyMetrics.annualizedROI.toFixed(1)}%.`
                          ) : (
                            `Allocated an average of $${(activeMetrics.avgCapital || activeTrade.requiredCapital || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} over ${activeMetrics.daysHeld || 1} ${(activeMetrics.daysHeld || 1) === 1 ? 'day' : 'days'} (ranging from $${(activeTrade.requiredCapital || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at open to a peak of $${(activeTrade.peakCapital || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}), delivering an annualized yield of ${(activeMetrics.annualizedROI || 0).toFixed(1)}%.`
                          )}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-subtle-foreground text-xs">
                      Select a trade from the table to view capital-adjusted metrics.
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </main>
      )}

      <Dialog open={portalDialogOpen} onOpenChange={setPortalDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-2xl h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-4 border-b border-border/80 flex flex-row items-center justify-between shrink-0">
            <div>
              <DialogTitle className="text-foreground text-base font-bold flex items-center gap-2">
                <Building2 className="w-5 h-5 text-brand" />
                <span>SnapTrade Connection Portal</span>
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                Securely authenticate with your brokerage. SnapTrade connects directly with OAuth and encryption.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 bg-background relative flex flex-col items-center justify-center">
            {portalLoading ? (
              <div className="flex flex-col items-center gap-3 p-8">
                <Spinner size="lg" label="" />
                <span className="text-xs font-mono text-muted-foreground">Opening secure portal session...</span>
              </div>
            ) : portalUrl ? (
              <iframe
                src={portalUrl}
                title="SnapTrade Connection Portal"
                className="w-full h-full border-0"
                allow="clipboard-read; clipboard-write"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="p-8 text-center max-w-md">
                <AlertCircle className="w-10 h-10 text-warning mx-auto mb-3" />
                <h3 className="text-sm font-bold text-foreground mb-2">SnapTrade Setup</h3>
                <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
                  {portalError || 'To connect live brokerages, set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in the server .env file and restart.'}
                </p>
                <div className="flex gap-3 justify-center">
                  <Button
                    onClick={() => handleOpenConnectionPortal()}
                    className="bg-brand-fill hover:bg-brand-fill/85 text-foreground text-xs font-semibold px-4 cursor-pointer"
                  >
                    Try Again
                  </Button>
                  <Button
                    onClick={() => setPortalDialogOpen(false)}
                    variant="outline"
                    className="border-border text-muted-foreground text-xs cursor-pointer"
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Connected Brokerages Management Dialog */}
      <Dialog open={connectionsDialogOpen} onOpenChange={setConnectionsDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Building2 className="w-5 h-5 text-brand" />
              <span>Connected Brokerages</span>
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Manage your linked institutions and connections across SnapTrade.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 my-4 max-h-[50vh] overflow-y-auto">
            {connections.length === 0 && accounts.length === 0 ? (
              <div className="text-center p-6 text-subtle-foreground text-xs">
                No brokerages connected yet.
              </div>
            ) : (
              (connections.length > 0 ? connections : accounts).map((item: any) => {
                const title = item.brokerage?.name || item.institution_name || 'Brokerage Connection';
                const id = item.id;
                const isDisabled = item.disabled === true;
                return (
                  <div key={id} className="bg-surface-2 border border-border/80 p-3.5 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-brand-fill/10 border border-brand/20 flex items-center justify-center font-bold text-brand text-xs">
                        {title.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">{title}</span>
                          {isDisabled ? (
                            <span className="bg-warning/10 text-warning text-[10px] px-2 py-0.5 rounded-full border border-warning/30">
                              Re-auth Needed
                            </span>
                          ) : (
                            <span className="bg-profit/10 text-profit text-[10px] px-2 py-0.5 rounded-full border border-profit/20">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">ID: {id.slice(0, 16)}...</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isDisabled && (
                        <Button
                          onClick={() => {
                            setConnectionsDialogOpen(false);
                            handleOpenConnectionPortal(id);
                          }}
                          size="sm"
                          className="bg-warning-fill hover:bg-warning-fill/85 text-white h-7 px-2.5 text-xs cursor-pointer shadow-sm"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Reconnect
                        </Button>
                      )}
                      <Button
                        onClick={() => setPendingDisconnect({ id, name: title })}
                        variant="ghost"
                        size="sm"
                        className="text-loss hover:text-loss hover:bg-loss/10 h-7 px-2.5 text-xs cursor-pointer"
                        title="Disconnect Brokerage"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Unlink
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex gap-2 justify-between pt-2 border-t border-border/80">
            <Button
              onClick={() => {
                setConnectionsDialogOpen(false);
                setTastyDialogOpen(true);
              }}
              className="bg-loss-fill hover:bg-loss-fill/85 text-white text-xs font-semibold h-9 cursor-pointer"
            >
              <span className="mr-1">🍒</span>
              <span>Tastytrade Direct API</span>
            </Button>
            <Button
              onClick={() => {
                setConnectionsDialogOpen(false);
                handleOpenConnectionPortal();
              }}
              className="bg-brand-fill hover:bg-brand-fill/85 text-foreground text-xs font-semibold h-9 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 mr-1.5" />
              Link Via SnapTrade
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Destructive-action confirmation. Replaces a native confirm(). */}
      <AlertDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this brokerage?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisconnect?.name || 'This brokerage'} will be unlinked from
              Alphatrack. Synced trades and positions from it will no longer appear. You can
              reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingDisconnect;
                setPendingDisconnect(null);
                setConnectionsDialogOpen(false);
                if (target) handleDisconnectBroker(target.id);
              }}
              className="bg-loss-fill text-white hover:bg-loss-fill/85"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tastytrade Direct API Connect Dialog */}
      <Dialog open={tastyDialogOpen} onOpenChange={setTastyDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md p-6">
          <DialogHeader className="pb-3 border-b border-border/80">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-loss/15 border border-loss/30 flex items-center justify-center text-lg">
                🍒
              </div>
              <div>
                <DialogTitle className="text-foreground text-base font-bold">
                  Tastytrade Direct API
                </DialogTitle>
                <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                  Official REST connection for real-time futures options & live quotes.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {tastyConnected ? (
            <div className="py-4 space-y-4">
              <div className="bg-profit/10 border border-profit/30 rounded-xl p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-profit/20 flex items-center justify-center text-profit font-bold">
                  ✓
                </div>
                <div>
                  <div className="text-xs font-bold text-foreground">Tastytrade API Connected</div>
                  <div className="text-[11px] text-profit">
                    Live positions, `/MES`, `/MNQ`, balances & mark quotes active.
                  </div>
                  {tastyUser?.email && (
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">User: {tastyUser.email}</div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  onClick={() => {
                    if (user) fetchAllData(user.uid);
                    setTastyDialogOpen(false);
                  }}
                  className="bg-brand-fill hover:bg-brand-fill/85 text-foreground text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Sync Portfolio
                </Button>
                <Button
                  onClick={handleTastytradeLogout}
                  variant="ghost"
                  className="text-loss hover:text-loss hover:bg-loss/10 text-xs cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleTastytradeLogin} className="py-3 space-y-4">
              {tastyError && (
                <div className="bg-loss/10 border border-loss/30 text-loss text-xs p-3 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-loss shrink-0 mt-0.5" />
                  <div>{tastyError}</div>
                </div>
              )}

              {tastyRequires2FA ? (
                <div className="space-y-3">
                  <div className="bg-warning/10 border border-warning/30 text-warning text-xs p-3 rounded-xl">
                    <div className="font-semibold text-warning mb-1">🔐 2FA Verification Required</div>
                    <div>Please enter the 6-digit verification code from your SMS or Authenticator App.</div>
                  </div>

                  <div>
                    <label htmlFor="tasty-otp" className="text-xs font-semibold text-muted-foreground block mb-1.5">
                      6-Digit Security Code (OTP)
                    </label>
                    <input
                      id="tasty-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      autoFocus
                      required
                      placeholder="123456"
                      value={tastyOtp}
                      onChange={(e) => setTastyOtp(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-surface-2 border border-border focus:border-loss rounded-xl px-4 py-2.5 text-center text-xl font-mono tracking-widest text-foreground outline-none transition-colors"
                    />
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTastyRequires2FA(false);
                        setTastyOtp('');
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                    >
                      Back to Username
                    </button>
                    <Button
                      type="submit"
                      disabled={tastyLoading || tastyOtp.length < 6}
                      className="bg-loss-fill hover:bg-loss-fill/85 text-white text-xs font-semibold px-5 h-9 cursor-pointer disabled:opacity-50"
                    >
                      {tastyLoading ? <Spinner size="sm" label="" className="mr-1" /> : null}
                      Verify & Connect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="tasty-login" className="text-xs font-semibold text-muted-foreground block mb-1">
                      Tastytrade Username or Email
                    </label>
                    <input
                      id="tasty-login"
                      type="text"
                      required
                      autoComplete="username"
                      placeholder="e.g. trader123 or you@email.com"
                      value={tastyLogin}
                      onChange={(e) => setTastyLogin(e.target.value)}
                      className="w-full bg-surface-2 border border-border focus:border-loss rounded-xl px-3.5 py-2 text-xs text-foreground outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label htmlFor="tasty-password" className="text-xs font-semibold text-muted-foreground block mb-1">
                      Password
                    </label>
                    <input
                      id="tasty-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      placeholder="••••••••••••"
                      value={tastyPassword}
                      onChange={(e) => setTastyPassword(e.target.value)}
                      className="w-full bg-surface-2 border border-border focus:border-loss rounded-xl px-3.5 py-2 text-xs text-foreground outline-none transition-colors"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <button
                      type="button"
                      onClick={() => setTastyRequires2FA(true)}
                      className="text-[11px] text-loss hover:text-loss underline cursor-pointer"
                    >
                      Enter 2FA / Device Code directly →
                    </button>
                  </div>

                  <div className="text-[11px] text-subtle-foreground flex items-center gap-1.5 pt-1">
                    <ShieldCheck className="w-4 h-4 text-profit shrink-0" />
                    <span>Credentials authenticate directly with Tastytrade API over TLS encryption.</span>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-border/80">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setTastyDialogOpen(false)}
                      className="border-border text-muted-foreground text-xs h-9 cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={tastyLoading || !tastyLogin || !tastyPassword}
                      className="bg-loss-fill hover:bg-loss-fill/85 text-white text-xs font-semibold px-5 h-9 cursor-pointer disabled:opacity-50"
                    >
                      {tastyLoading ? <Spinner size="sm" label="" className="mr-1" /> : null}
                      Connect Tastytrade
                    </Button>
                  </div>
                </div>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


