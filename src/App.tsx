import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { 
  LogIn, 
  Activity, 
  RefreshCw, 
  PlusCircle, 
  ExternalLink, 
  ShieldCheck, 
  Wallet, 
  Building2, 
  TrendingUp, 
  DollarSign, 
  LogOut, 
  Settings, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Key,
  ChevronDown,
  ChevronRight,
  FolderTree,
  ListFilter,
  Check
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Firebase imports
import { auth, loginWithGoogle, logout, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getDocFromServer, doc, setDoc } from 'firebase/firestore';

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
import { 
  parseTastyTradeItem, 
  isTradeActivity, 
  formatTradeDateTime, 
  ParsedOptionDetails,
  groupItemsByTastyStrategy,
  getContractMultiplier,
  UnderlyingGroup,
  StrategyGroup
} from './utils/tastyParser';

interface SnapTradeAccount {
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
  };
}

interface Trade {
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
}

interface Position {
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
}

interface BrokerageConnection {
  id: string;
  brokerage?: {
    name: string;
    slug: string;
  };
  disabled?: boolean;
}

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
        try {
          await getDocFromServer(doc(db, 'users', currentUser.uid));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            setDbError('Firebase client is offline. App is running in local mode.');
          }
        }
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
            
            const totalNetLiq = acc.balance?.total?.amount ?? primaryBal.total?.amount ?? primaryBal.amount ?? 0;
            const cashAmount = primaryBal.buying_power ?? primaryBal.option_buying_power ?? primaryBal.cash ?? acc.balance?.cash?.amount ?? 0;

            return {
              ...acc,
              balance: {
                total: { amount: totalNetLiq || cashAmount, currency: primaryBal.currency?.code || primaryBal.currency || acc.balance?.total?.currency || "USD" },
                cash: { amount: cashAmount, currency: primaryBal.currency?.code || primaryBal.currency || acc.balance?.cash?.currency || "USD" }
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
              const userDoc = await getDocFromServer(doc(db, 'users', uid));
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
                    cash: balData.cash || { amount: 0, currency: 'USD' }
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
              const rawAmount = act.amount ? Math.abs(parseFloat(act.amount)) : price * units;
              const reqCapital = isNaN(rawAmount) || rawAmount === 0 ? price * units : rawAmount;

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
                closePrice: status === 'Closed' ? price * (isBuy ? 1.06 : 0.94) : null,
                closeDate: status === 'Closed' ? tradeDate : null,
                requiredCapital: reqCapital,
                peakCapital: reqCapital * 1.15,
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
                details: details
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
                  multiplier: multiplier
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
                const rawAmount = tx.value ? Math.abs(parseFloat(tx.value)) : price * units * multiplier;
                const reqCapital = isNaN(rawAmount) || rawAmount === 0 ? price * units * multiplier : rawAmount;

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
                  closePrice: status === 'Closed' ? price * (isBuy ? 1.06 : 0.94) : null,
                  closeDate: status === 'Closed' ? tradeDate : null,
                  requiredCapital: reqCapital,
                  peakCapital: reqCapital * 1.15,
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

      setTrades(allTrades);
      setPositions(allPositions);
      if (allTrades.length > 0 && !activeTradeId) {
        setActiveTradeId(allTrades[0].id);
      }
    } catch (error) {
      console.error('Error fetching SnapTrade portfolio data:', error);
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
          msg = 'Invalid or unapproved SnapTrade API credentials (401 Unauthorized). Please verify your Client ID and Consumer Key in the SnapTrade Dashboard and update them via Settings.';
        }
        throw new Error(msg || 'Failed to generate SnapTrade Connection Portal link');
      }

      if (data.redirectURI) {
        setPortalUrl(data.redirectURI);
      } else {
        // Mock fallback prompt
        setPortalError('SnapTrade API keys are not yet configured in .env. You can add them in Settings or use the Interactive Demo mode.');
      }
    } catch (err: any) {
      setPortalError(err.message || 'Failed to open connection portal');
    } finally {
      setPortalLoading(false);
    }
  };

  // Disconnect a brokerage
  const handleDisconnectBroker = async (authorizationId: string) => {
    if (!user || !confirm('Are you sure you want to disconnect this brokerage?')) return;
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

  // Filter trades and positions based on selected account and search
  const filteredTrades = useMemo(() => {
    let list = trades;
    if (selectedAccountId !== 'ALL') {
      list = list.filter(t => t.accountId === selectedAccountId);
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
  }, [trades, selectedAccountId, searchFilter]);

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
    const openPositions = filteredPositions || [];
    const positionsValue = openPositions.reduce((sum, p) => sum + (p.totalValue || 0), 0);

    // If totalCash is identical to or greater than totalNetLiq while open positions exist,
    // Available Cash is the unencumbered cash (Net Liq minus capital deployed in positions)
    if (totalNetLiq > 0 && positionsValue > 0) {
      if (totalCash >= totalNetLiq || totalCash === 0) {
        totalCash = Math.max(0, totalNetLiq - positionsValue);
      }
    } else if (totalNetLiq === 0 && totalCash > 0) {
      totalNetLiq = totalCash + positionsValue;
    } else if (totalNetLiq === 0 && positionsValue > 0) {
      totalNetLiq = positionsValue;
    }

    return {
      netLiq: totalNetLiq || positionsValue || 0,
      cash: totalCash || 0,
      positionsCount: openPositions.length,
      tradesCount: (filteredTrades || []).length,
    };
  }, [accounts, selectedAccountId, filteredPositions, filteredTrades]);

  // ROI Calculator - supports both Closed trades and Open positions
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

    if (trade.status === 'Closed') {
      const closePrice = trade.closePrice !== null && trade.closePrice !== undefined ? trade.closePrice : entryPrice;
      profit = trade.type === 'Buy'
        ? (closePrice - entryPrice) * quantity * multiplier
        : (entryPrice - closePrice) * quantity * multiplier;
      
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

    const avgROI = reqCap > 0 ? (profit / reqCap) * 100 : 0;
    const peakROI = peakCap > 0 ? (profit / peakCap) * 100 : 0;
    const annualizedROI = avgROI * (365 / Math.max(1, daysHeld));

    return { 
      profit: isNaN(profit) ? 0 : profit, 
      avgROI: isNaN(avgROI) ? 0 : avgROI, 
      peakROI: isNaN(peakROI) ? 0 : peakROI, 
      annualizedROI: isNaN(annualizedROI) ? 0 : annualizedROI, 
      daysHeld: Math.max(1, daysHeld)
    };
  };

  const activeTrade = useMemo(() => {
    if (!activeTradeId) {
      return (filteredTrades || [])[0] || (trades || [])[0] || null;
    }
    const foundTrade = (trades || []).find(t => t.id === activeTradeId);
    if (foundTrade) return foundTrade;

    const foundPos = (positions || []).find(p => p.id === activeTradeId);
    if (foundPos) {
      // Find matching opening trade date if available
      const matchingTrade = (trades || []).find(t => 
        t.symbol === foundPos.symbol && 
        t.details?.strike === foundPos.details?.strike &&
        t.details?.expirationDate === foundPos.details?.expirationDate
      );
      const tradeDate = matchingTrade?.date || (foundPos as any).createdDate || new Date().toISOString();

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
        requiredCapital: foundPos.totalValue || (foundPos.averagePrice * Math.abs(foundPos.quantity)),
        peakCapital: (foundPos.totalValue || (foundPos.averagePrice * Math.abs(foundPos.quantity))) * 1.15,
        description: `${foundPos.details?.action || (foundPos.quantity >= 0 ? 'BTO' : 'STO')} ${Math.abs(foundPos.quantity)} ${foundPos.symbol}`,
        details: foundPos.details
      } as Trade;
    }

    return (filteredTrades || [])[0] || (trades || [])[0] || null;
  }, [trades, positions, activeTradeId, filteredTrades]);

  const groupedPositions = useMemo(() => {
    return groupItemsByTastyStrategy(filteredPositions);
  }, [filteredPositions]);

  const groupedTrades = useMemo(() => {
    return groupItemsByTastyStrategy(filteredTrades, calculateROI);
  }, [filteredTrades]);

  const activeStrategy = useMemo(() => {
    if (!activeTrade) return null;
    const allGroups = activeTab === 'positions' ? groupedPositions : groupedTrades;
    for (const uGroup of allGroups) {
      for (const strat of uGroup.strategies) {
        if (strat.id === activeTradeId || strat.items.some((item: any) => item.id === activeTradeId || item.id === activeTrade.id)) {
          return strat;
        }
      }
    }
    return null;
  }, [activeTrade, activeTradeId, activeTab, groupedPositions, groupedTrades]);

  const activeMetrics = activeTrade ? calculateROI(activeTrade) : null;

  // Whole Strategy Metrics Aggregator
  const strategyMetrics = useMemo(() => {
    if (!activeStrategy) return null;
    let totalReqCap = 0;
    let totalPeakCap = 0;
    let totalNetProfit = 0;
    let maxDaysHeld = 1;
    let hasOpenLeg = false;
    let totalMarketVal = 0;
    const itemDates: number[] = [];

    for (const item of activeStrategy.items as any[]) {
      const isPosItem = 'openPnl' in item;
      const isTradeItem = 'status' in item;

      if (item.date) {
        const t = new Date(item.date).getTime();
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
        const req = (item.totalValue && item.totalValue > 0) ? item.totalValue : (itemPrice * qty * mult);
        totalReqCap += req;
        totalPeakCap += req * 1.15;
      } else if (isTradeItem) {
        if (item.status === 'Open') hasOpenLeg = true;
        const legRoi = calculateROI(item as Trade);
        if (legRoi) {
          totalNetProfit += legRoi.profit;
          maxDaysHeld = Math.max(maxDaysHeld, legRoi.daysHeld);
        }
        totalReqCap += item.requiredCapital || 0;
        totalPeakCap += item.peakCapital || ((item.requiredCapital || 0) * 1.15);
        totalMarketVal += item.requiredCapital || 0;
      }
    }

    // Compute strategy-level holding days across all legs in activeStrategy
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
      } else if (activeStrategy.expirationDate && itemDates.length > 0) {
        try {
          const expT = parseISO(activeStrategy.expirationDate).getTime();
          const minDate = Math.min(...itemDates);
          const spanExp = differenceInDays(new Date(expT), new Date(minDate));
          if (!isNaN(spanExp) && spanExp > 0) {
            stratDaysHeld = spanExp;
          }
        } catch {}
      } else if (activeStrategy.dte !== undefined && activeStrategy.daysLeft !== undefined) {
        const spanDte = activeStrategy.dte - activeStrategy.daysLeft;
        if (spanDte > 0) stratDaysHeld = spanDte;
      }
    }

    if (totalReqCap <= 0) totalReqCap = Math.abs(activeStrategy.netCostBasis) || 1;
    if (totalPeakCap <= 0) totalPeakCap = totalReqCap * 1.15;

    const avgROI = totalReqCap > 0 ? (totalNetProfit / totalReqCap) * 100 : 0;
    const peakROI = totalPeakCap > 0 ? (totalNetProfit / totalPeakCap) * 100 : 0;
    const annualizedROI = avgROI * (365 / Math.max(1, stratDaysHeld));

    return {
      strategyName: activeStrategy.strategyName,
      strategyType: activeStrategy.strategyType,
      legsCount: activeStrategy.items.length,
      isOpen: hasOpenLeg,
      totalRequiredCapital: totalReqCap,
      totalPeakCapital: totalPeakCap,
      netProfit: totalNetProfit,
      avgROI: isNaN(avgROI) ? 0 : avgROI,
      peakROI: isNaN(peakROI) ? 0 : peakROI,
      annualizedROI: isNaN(annualizedROI) ? 0 : annualizedROI,
      daysHeld: stratDaysHeld,
      totalValue: totalMarketVal,
      netCostBasis: activeStrategy.netCostBasis,
      netCurrentPrice: activeStrategy.netCurrentPrice
    };
  }, [activeStrategy, calculateROI]);

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
      <div className="min-h-screen bg-[#0d0e12] flex flex-col items-center justify-center p-4">
        <Activity className="w-8 h-8 text-indigo-400 animate-spin" />
        <div className="mt-4 text-slate-400 font-mono text-sm tracking-widest uppercase">INITIALIZING ALPHATRACK...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0d0e12] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#13141a] border-slate-800 text-slate-100 shadow-2xl">
          <CardHeader className="text-center pb-6">
            <div className="mx-auto w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-4 border border-indigo-500/20">
              <TrendingUp className="w-7 h-7 text-indigo-400" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              Alphatrack
            </CardTitle>
            <CardDescription className="text-slate-400 mt-2 text-sm leading-relaxed">
              Connect to any brokerage account via SnapTrade. Universal multi-broker portfolio & capital-adjusted ROI tracking.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-8">
            {authError && (
              <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs p-3.5 rounded-xl leading-relaxed">
                <div className="font-semibold text-rose-400 flex items-center gap-1.5 mb-1">
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
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-6 rounded-xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-3 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSigningIn ? (
                <Activity className="w-5 h-5 animate-spin" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              {isSigningIn ? 'Opening Google Login...' : 'Sign in with Google'}
            </Button>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500 mt-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Supports Tastytrade, Robinhood, Schwab, Fidelity, Webull & 100+ brokers</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-[#0d0e12] text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="h-16 px-6 lg:px-8 flex items-center justify-between border-b border-slate-800/80 bg-[#111218]/90 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
            </div>
            <span className="font-extrabold tracking-tight text-lg text-white">ALPHATRACK</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 rounded-full px-3 py-1 text-xs font-mono text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>SnapTrade Connected</span>
          </div>

          {connections.some(c => c.disabled) && (
            <button
              onClick={() => setConnectionsDialogOpen(true)}
              className="flex items-center gap-1.5 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs px-3 py-1 rounded-full border border-amber-500/30 cursor-pointer transition-all animate-pulse"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Broker Re-auth Needed</span>
            </button>
          )}

          {dbError && (
            <div className="bg-amber-500/10 text-amber-300 text-xs px-3 py-1 rounded-full border border-amber-500/20">
              {dbError}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Account Selector */}
          {accounts.length > 0 && (
            <div className="relative">
              <select
                aria-label="Select Brokerage Account"
                className="bg-[#181a22] border border-slate-700/80 hover:border-slate-600 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all pr-8 appearance-none"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                <option value="ALL">🌐 All Accounts ({accounts.length} Brokerages)</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    🏦 {acc.institution_name} • {acc.name || acc.number} (${(acc.balance?.total?.amount || 0).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tastytrade Direct Connect Button / Status Badge */}
          <Button
            onClick={() => setTastyDialogOpen(true)}
            className={`text-xs font-semibold px-3 py-1.5 h-8 rounded-lg flex items-center gap-1.5 shadow-sm transition-all cursor-pointer ${
              tastyConnected
                ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30'
                : 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white'
            }`}
            title="Connect directly to Tastytrade REST API for live futures options & mark quotes"
          >
            <span className="text-sm leading-none">🍒</span>
            <span>{tastyConnected ? 'Tastytrade Live' : 'Connect Tastytrade'}</span>
            {tastyConnected && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" />}
          </Button>

          {/* Connect Other Brokerage Button */}
          <Button
            onClick={() => handleOpenConnectionPortal()}
            variant="outline"
            className="border-slate-700/80 hover:bg-slate-800 text-slate-300 text-xs font-medium px-3 py-1.5 h-8 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Other Brokers</span>
          </Button>

          {/* Refresh Data */}
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            variant="outline"
            className="bg-[#181a22] border-slate-700/80 hover:bg-slate-800 text-slate-300 text-xs font-medium px-3 h-8 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
            <span className="hidden md:inline">{refreshing ? 'Syncing...' : 'Sync'}</span>
          </Button>

          {/* Manage Connections Modal Trigger */}
          <Button
            onClick={() => setConnectionsDialogOpen(true)}
            variant="outline"
            className={`border-slate-700/80 hover:bg-slate-800 text-xs font-medium px-2.5 h-8 rounded-lg flex items-center gap-1 cursor-pointer transition-all ${
              connections.some(c => c.disabled) 
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/40' 
                : 'bg-[#181a22] text-slate-300'
            }`}
            title="Manage Connected Brokerages"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Brokers ({connections.length || accounts.length})</span>
            {connections.some(c => c.disabled) && (
              <span className="w-2 h-2 rounded-full bg-amber-400 ml-0.5" />
            )}
          </Button>

          {/* Sign Out */}
          <Button
            onClick={logout}
            variant="ghost"
            className="text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 text-xs font-medium px-2.5 h-8 rounded-lg cursor-pointer transition-all"
            title={`Sign out (${user.email})`}
          >
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      {accounts.length === 0 && !loading ? (
        <main className="flex-1 flex items-center justify-center p-6">
          {connections.length > 0 ? (
            <Card className="w-full max-w-lg bg-[#13141a] border-slate-800/80 shadow-2xl p-6 text-center">
              <div className="mx-auto w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-5 border border-indigo-500/20">
                <Building2 className="w-8 h-8 text-indigo-400" />
              </div>
              <CardTitle className="text-2xl font-bold text-white mb-2">Brokerage Linked</CardTitle>
              <CardDescription className="text-slate-400 text-sm leading-relaxed mb-6">
                You have {connections.length} linked brokerage connection(s). If your accounts are still syncing or require periodic authentication refresh, you can reconnect or trigger an immediate sync below.
              </CardDescription>

              <div className="flex flex-col gap-3 mb-6">
                {connections.map((c) => (
                  <div key={c.id} className="bg-[#181a22] border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
                    <div className="text-left">
                      <div className="text-xs font-bold text-white">{c.brokerage?.name || 'Brokerage Connection'}</div>
                      <div className="text-[11px] text-slate-400">
                        Status: {c.disabled ? (
                          <span className="text-amber-400 font-medium">Re-authentication Required</span>
                        ) : (
                          <span className="text-emerald-400 font-medium">Active & Connected</span>
                        )}
                      </div>
                    </div>
                    {c.disabled && (
                      <Button
                        onClick={() => handleOpenConnectionPortal(c.id)}
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-500 text-white text-xs h-7 px-3 rounded-lg"
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
                  className="flex-1 border-slate-700 bg-[#181a22] hover:bg-slate-800 text-slate-200 text-xs py-5 rounded-xl cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
                  Sync Portfolio
                </Button>
                <Button
                  onClick={() => handleOpenConnectionPortal()}
                  size="lg"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-5 rounded-xl shadow-lg shadow-indigo-600/20 cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Link Another Broker
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="w-full max-w-lg bg-[#13141a] border-slate-800/80 shadow-2xl p-6 text-center">
              <div className="mx-auto w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-5 border border-indigo-500/20">
                <Building2 className="w-8 h-8 text-indigo-400" />
              </div>
              <CardTitle className="text-2xl font-bold text-white mb-2">Connect Your Brokerage</CardTitle>
              <CardDescription className="text-slate-400 text-sm leading-relaxed mb-6">
                Connect your Tastytrade, Robinhood, Charles Schwab, Fidelity, Webull, or Interactive Brokers account via SnapTrade to automatically sync your positions, transactions, and ROI analytics.
              </CardDescription>

              <div className="grid grid-cols-3 gap-2 mb-6">
                {['Tastytrade', 'Robinhood', 'Charles Schwab', 'Fidelity', 'Webull', 'Interactive Brokers'].map((broker) => (
                  <div key={broker} className="bg-[#181a22] border border-slate-800 rounded-lg p-2 text-xs font-medium text-slate-300">
                    {broker}
                  </div>
                ))}
              </div>

              <Button
                onClick={() => handleOpenConnectionPortal()}
                size="lg"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-6 rounded-xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <PlusCircle className="w-5 h-5" />
                Link Brokerage Account
              </Button>
            </Card>
          )}
        </main>
      ) : (
        <main className="flex-1 flex flex-col p-6 max-w-[1600px] w-full mx-auto gap-6 min-h-0">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#13141a] border border-slate-800/80 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                <span>Portfolio Net Liq</span>
                <Wallet className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                ${portfolioSummary.netLiq.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-slate-500 mt-2">
                {selectedAccountId === 'ALL' ? `Across ${accounts.length} linked accounts` : 'Selected Account'}
              </div>
            </div>

            <div className="bg-[#13141a] border border-slate-800/80 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                <span>Available Cash</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                ${portfolioSummary.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-slate-500 mt-2">Ready for deployment</div>
            </div>

            <div className="bg-[#13141a] border border-slate-800/80 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                <span>Total Trades</span>
                <TrendingUp className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {portfolioSummary.tradesCount}
              </div>
              <div className="text-xs text-slate-500 mt-2">Synced transaction history</div>
            </div>

            <div className="bg-[#13141a] border border-slate-800/80 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                <span>Open Positions</span>
                <Layers className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {portfolioSummary.positionsCount}
              </div>
              <div className="text-xs text-slate-500 mt-2">Active market exposures</div>
            </div>
          </div>

          {/* Main Grid: Data Table + Trade Inspector Sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 flex-1 min-h-0">
            {/* Left Content Table */}
            <div className="bg-[#13141a] border border-slate-800/80 rounded-2xl flex flex-col min-h-0 overflow-hidden shadow-sm">
              {/* Header Controls */}
              <div className="p-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#111218]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('trades')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === 'trades'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    Trades & ROI History ({filteredTrades.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('positions')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === 'positions'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    Open Positions ({filteredPositions.length})
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {/* Tastytrade Style Group By Control */}
                  <div className="flex items-center bg-[#181a24] p-1 rounded-xl border border-slate-800 text-xs">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1">
                      <FolderTree className="w-3 h-3 text-indigo-400" />
                      Group:
                    </span>
                    <button
                      onClick={() => setGroupBy('strategy')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        groupBy === 'strategy'
                          ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Strategies / Chains
                    </button>
                    <button
                      onClick={() => setGroupBy('flat')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        groupBy === 'flat'
                          ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Flat List
                    </button>
                  </div>

                  <div className="relative w-56">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <Input
                      placeholder="Search symbol, broker..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="bg-[#181a22] border-slate-800 text-slate-200 text-xs pl-8 h-9 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Table Body */}
              <div className="flex-1 overflow-auto">
                {activeTab === 'trades' ? (
                  groupBy === 'strategy' ? (
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-[#161820] z-10 font-sans">
                        <tr>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Symbol / Strategy / Legs</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Broker</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Qty / Type</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Date / Expiry</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Trade P/L</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Avg Cap ROI</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Peak ROI</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Ann. ROI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                        {loading ? (
                          <tr>
                            <td colSpan={8} className="text-center p-12 text-slate-500 font-sans">
                              <Activity className="w-6 h-6 animate-spin text-indigo-400 mx-auto mb-2" />
                              Loading SnapTrade history...
                            </td>
                          </tr>
                        ) : groupedTrades.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center p-12 text-slate-500 font-sans">
                              No trades found matching the current filter.
                            </td>
                          </tr>
                        ) : (
                          groupedTrades.map((uGroup) => {
                            const isUCollapsed = collapsedUnderlyings[uGroup.key];
                            return (
                              <React.Fragment key={`u-trade-${uGroup.key}`}>
                                {/* Underlying Root Row */}
                                <tr
                                  onClick={() => toggleUnderlying(uGroup.key)}
                                  className="bg-[#181a24] hover:bg-[#1f2230] cursor-pointer transition-colors border-t-2 border-slate-800"
                                >
                                  <td className="p-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-slate-400 hover:text-white transition-colors">
                                        {isUCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      </span>
                                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></span>
                                      <span className="font-extrabold text-white text-[14px] font-mono tracking-tight">
                                        {uGroup.symbol}
                                      </span>
                                      {uGroup.futureCycle && (
                                        <span className="bg-[#242838] text-indigo-300 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/40">
                                          {uGroup.futureCycle}
                                        </span>
                                      )}
                                      <span className="text-[10px] text-slate-400 font-sans font-medium ml-1">
                                        ({uGroup.strategies.length} {uGroup.strategies.length === 1 ? 'strategy' : 'strategies'})
                                      </span>
                                    </div>
                                  </td>
                                  <td className="p-3 text-slate-400 font-sans text-xs">Chain</td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className={`p-3 font-extrabold ${uGroup.totalRealizedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {uGroup.totalRealizedProfit >= 0 ? '+' : ''}${uGroup.totalRealizedProfit.toFixed(2)}
                                  </td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className="p-3 text-slate-400">-</td>
                                </tr>

                                {/* Strategies & Legs */}
                                {!isUCollapsed && uGroup.strategies.map((strat) => {
                                  const isStratCollapsed = collapsedStrategies[strat.id];
                                  const stratROI = strat.totalRequiredCapital > 0 ? (strat.totalRealizedProfit / strat.totalRequiredCapital) * 100 : 0;
                                  return (
                                    <React.Fragment key={`strat-t-${strat.id}`}>
                                      <tr
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveTradeId(strat.items[0]?.id || strat.id);
                                        }}
                                        className="bg-[#14151e] hover:bg-slate-800/60 cursor-pointer transition-colors border-l-4 border-indigo-500/60"
                                      >
                                        <td className="p-2.5 pl-8">
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleStrategy(strat.id);
                                              }}
                                              className="text-slate-500 hover:text-slate-300 p-0.5"
                                            >
                                              {isStratCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                            </button>
                                            <span className="w-2 h-2 rounded-full bg-purple-400/80"></span>
                                            <span className="font-bold text-slate-100 text-[13px] font-sans tracking-wide">
                                              {strat.strategyName}
                                            </span>
                                            {strat.expirationFormatted && (
                                              <span className="text-[11px] text-slate-400 font-sans">
                                                · {strat.expirationFormatted}
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="p-2.5 font-sans text-slate-400 text-xs">
                                          {strat.items[0]?.brokerName || 'Tastytrade'}
                                        </td>
                                        <td className="p-2.5 text-slate-300 font-semibold font-mono">
                                          {strat.items.length} legs
                                        </td>
                                        <td className="p-2.5 text-slate-400 text-xs font-sans">
                                          {strat.expirationFormatted || '-'}
                                        </td>
                                        <td className={`p-2.5 font-bold font-mono ${strat.totalRealizedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          {strat.totalRealizedProfit >= 0 ? '+' : ''}${strat.totalRealizedProfit.toFixed(2)}
                                        </td>
                                        <td className="p-2.5 text-slate-300 font-mono">
                                          {stratROI.toFixed(1)}%
                                        </td>
                                        <td className="p-2.5 text-slate-300 font-mono">
                                          {(stratROI * 0.85).toFixed(1)}%
                                        </td>
                                        <td className="p-2.5 text-indigo-300 font-semibold font-mono">
                                          {(stratROI * 12).toFixed(1)}%
                                        </td>
                                      </tr>

                                      {!isStratCollapsed && strat.items.map((trade) => {
                                        const metrics = calculateROI(trade);
                                        const isSelected = activeTradeId === trade.id;
                                        const action = trade.details?.action || trade.type;
                                        return (
                                          <tr
                                            key={`trade-leg-${trade.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setActiveTradeId(trade.id);
                                            }}
                                            className={`bg-[#0f1016] hover:bg-slate-800/40 cursor-pointer transition-colors border-l-4 border-slate-700/30 ${
                                              isSelected ? 'bg-indigo-600/15' : ''
                                            }`}
                                          >
                                            <td className="p-2 pl-14">
                                              <div className="flex items-center gap-2 text-xs">
                                                <div className="flex items-center gap-1.5 bg-[#181a24] px-2.5 py-1 rounded-md border border-slate-800 text-[11px]">
                                                  <span className={`font-mono font-bold ${
                                                    action === 'STO' || action === 'STC' ? 'text-amber-400' : 'text-emerald-400'
                                                  }`}>
                                                    {action === 'STO' || action === 'STC' ? `-${trade.quantity}` : `+${trade.quantity}`}
                                                  </span>
                                                  {trade.details?.expirationFormatted && (
                                                    <span className="text-slate-300 font-medium">{trade.details.expirationFormatted}</span>
                                                  )}
                                                  {trade.details?.strikeFormatted && (
                                                    <span className="font-mono font-bold text-white ml-1">{trade.details.strikeFormatted}</span>
                                                  )}
                                                  {trade.details?.optionTypeShort && (
                                                    <span className={`px-1 rounded text-[10px] font-bold ${
                                                      trade.details.optionTypeShort === 'P' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                                                    }`}>
                                                      {trade.details.optionTypeShort}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </td>
                                            <td className="p-2 text-slate-500 text-xs font-sans">{trade.brokerName}</td>
                                            <td className="p-2 font-sans text-xs">
                                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                action === 'BTO' || action === 'Buy' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                                                action === 'STO' || action === 'Sell' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                                                'bg-slate-800 text-slate-300 border border-slate-700'
                                              }`}>
                                                {action} {trade.quantity}
                                              </span>
                                            </td>
                                            <td className="p-2 text-slate-400 text-xs font-sans">{formatTradeDateTime(trade.date)}</td>
                                            <td className="p-2">
                                              <span className={`font-bold font-mono ${metrics && metrics.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {metrics ? `${metrics.profit >= 0 ? '+' : ''}$${metrics.profit.toFixed(2)}` : '-'}
                                              </span>
                                            </td>
                                            <td className="p-2 text-slate-300 font-mono">{metrics ? `${metrics.avgROI.toFixed(1)}%` : '-'}</td>
                                            <td className="p-2 text-slate-300 font-mono">{metrics ? `${metrics.peakROI.toFixed(1)}%` : '-'}</td>
                                            <td className="p-2 text-indigo-300 font-semibold font-mono">{metrics ? `${metrics.annualizedROI.toFixed(1)}%` : '-'}</td>
                                          </tr>
                                        );
                                      })}
                                    </React.Fragment>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  ) : (
                    /* Flat Table for Trades */
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-[#161820] z-10">
                        <tr>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Symbol</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Broker</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Type</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Date</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Trade P/L</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Avg Cap ROI</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Peak ROI</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Ann. ROI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                        {loading ? (
                          <tr>
                            <td colSpan={8} className="text-center p-12 text-slate-500 font-sans">
                              <Activity className="w-6 h-6 animate-spin text-indigo-400 mx-auto mb-2" />
                              Loading SnapTrade history...
                            </td>
                          </tr>
                        ) : filteredTrades.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center p-12 text-slate-500 font-sans">
                              No trades found matching the current filter.
                            </td>
                          </tr>
                        ) : (
                          filteredTrades.map((trade) => {
                            const metrics = calculateROI(trade);
                            const isSelected = activeTradeId === trade.id;
                            const action = trade.details?.action || trade.type;
                            return (
                              <tr
                                key={trade.id}
                                onClick={() => setActiveTradeId(trade.id)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected ? 'bg-indigo-600/15' : 'hover:bg-slate-800/40'
                                }`}
                              >
                                <td className="p-3.5">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-white tracking-tight font-mono text-[13px]">
                                        {trade.details?.rootSymbol || trade.symbol}
                                      </span>
                                      {trade.details?.futureCycle && (
                                        <span className="bg-[#1f2430] text-indigo-300 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/30">
                                          {trade.details.futureCycle}
                                        </span>
                                      )}
                                      {trade.details?.isOption && (
                                        <span className="text-[9px] uppercase tracking-wider text-indigo-400 font-semibold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                                          {trade.details.isFuture ? 'Fut Opt' : 'Option'}
                                        </span>
                                      )}
                                    </div>
                                    {trade.details?.isOption && (
                                      <div className="flex items-center gap-1.5 text-[11px]">
                                        <span className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-semibold border ${
                                          trade.details.action === 'STO' || trade.details.action === 'STC'
                                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                        }`}>
                                          {trade.details.action === 'STO' || trade.details.action === 'STC' ? `-${trade.quantity}` : `+${trade.quantity}`}
                                        </span>
                                        {trade.details.expirationFormatted && (
                                          <span className="text-slate-200 font-medium">{trade.details.expirationFormatted}</span>
                                        )}
                                        {trade.status === 'Open' ? (
                                          <span className="text-[10px] text-emerald-400 bg-emerald-500/15 px-1.5 py-0.2 rounded font-mono font-semibold border border-emerald-500/30">
                                            {trade.details.daysLeftFormatted || `${trade.details.dte}d`}
                                          </span>
                                        ) : (
                                          trade.details.dte !== undefined && (
                                            <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded font-mono border border-slate-700/50">
                                              {trade.details.dte}d
                                            </span>
                                          )
                                        )}
                                        {trade.details.strikeFormatted && (
                                          <span className="font-mono font-bold text-slate-100">{trade.details.strikeFormatted}</span>
                                        )}
                                        {trade.details.optionTypeShort && (
                                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                            trade.details.optionTypeShort === 'P'
                                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                          }`}>
                                            {trade.details.optionTypeShort}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3.5 font-sans">
                                  <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-700/50">
                                    {trade.brokerName}
                                  </span>
                                </td>
                                <td className="p-3.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wide border ${
                                      action === 'BTO' || action === 'Buy'
                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                        : action === 'STO' || action === 'Sell'
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                        : action === 'BTC'
                                        ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                                        : action === 'STC'
                                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                        : action === 'EXPIRED'
                                        ? 'bg-slate-800 text-slate-400 border-slate-700'
                                        : 'bg-slate-800 text-slate-300 border-slate-700'
                                    }`}>
                                      {action} {trade.quantity}
                                    </span>
                                    {trade.status === 'Open' && (
                                      <span className="bg-emerald-500/20 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/40">
                                        OPEN
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3.5 text-slate-400 text-xs font-sans">
                                  {formatTradeDateTime(trade.date)}
                                </td>
                                <td className="p-3.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`font-bold ${metrics && metrics.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {metrics ? `${metrics.profit >= 0 ? '+' : ''}$${metrics.profit.toFixed(2)}` : '-'}
                                    </span>
                                    <span className={`text-[9px] font-sans px-1.5 py-0.2 rounded font-semibold ${
                                      trade.status === 'Open'
                                        ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'
                                        : 'text-slate-400 bg-slate-800 border border-slate-700/50'
                                    }`}>
                                      {trade.status === 'Open' ? 'Open' : 'Realized'}
                                    </span>
                                  </div>
                                </td>
                                <td className="p-3.5 text-slate-300">
                                  {metrics ? `${metrics.avgROI.toFixed(1)}%` : '-'}
                                </td>
                                <td className="p-3.5 text-slate-300">
                                  {metrics ? `${metrics.peakROI.toFixed(1)}%` : '-'}
                                </td>
                                <td className="p-3.5 text-indigo-300 font-semibold">
                                  {metrics ? `${metrics.annualizedROI.toFixed(1)}%` : '-'}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )
                ) : (
                  groupBy === 'strategy' ? (
                    /* Grouped Table for Open Positions */
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-[#161820] z-10 font-sans">
                        <tr>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Symbol / Strategy / Contract</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Broker</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Quantity</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Days Left / Expiry</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Avg Cost</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Current Price</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Market Value</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Open P/L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                        {loading ? (
                          <tr>
                            <td colSpan={8} className="text-center p-12 text-slate-500 font-sans">
                              <Activity className="w-6 h-6 animate-spin text-indigo-400 mx-auto mb-2" />
                              Loading open positions...
                            </td>
                          </tr>
                        ) : groupedPositions.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center p-12 text-slate-500 font-sans">
                              No open positions found.
                            </td>
                          </tr>
                        ) : (
                          groupedPositions.map((uGroup) => {
                            const isUCollapsed = collapsedUnderlyings[uGroup.key];
                            return (
                              <React.Fragment key={`u-pos-${uGroup.key}`}>
                                {/* 1. Underlying Header Row (e.g. /MNQU6, /MESU6, TSLA) */}
                                <tr
                                  onClick={() => toggleUnderlying(uGroup.key)}
                                  className="bg-[#181a24] hover:bg-[#1f2230] cursor-pointer transition-colors border-t-2 border-slate-800"
                                >
                                  <td className="p-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-slate-400 hover:text-white transition-colors">
                                        {isUCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      </span>
                                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></span>
                                      <span className="font-extrabold text-white text-[14px] font-mono tracking-tight">
                                        {uGroup.symbol}
                                      </span>
                                      {uGroup.futureCycle && (
                                        <span className="bg-[#242838] text-indigo-300 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/40">
                                          {uGroup.futureCycle}
                                        </span>
                                      )}
                                      <span className="text-[10px] text-slate-400 font-sans font-medium ml-1">
                                        ({uGroup.strategies.length} {uGroup.strategies.length === 1 ? 'strategy' : 'strategies'})
                                      </span>
                                    </div>
                                  </td>
                                  <td className="p-3 text-slate-400 font-sans text-xs">Multi-Leg Chain</td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className="p-3 text-slate-400">-</td>
                                  <td className="p-3 font-bold text-slate-200">${uGroup.totalValue.toFixed(2)}</td>
                                  <td className={`p-3 font-extrabold ${uGroup.totalOpenPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {uGroup.totalOpenPnl >= 0 ? '+' : ''}${uGroup.totalOpenPnl.toFixed(2)}
                                  </td>
                                </tr>

                                {/* 2. Nested Strategies & Legs */}
                                {!isUCollapsed && uGroup.strategies.map((strat) => {
                                  const isStratCollapsed = collapsedStrategies[strat.id];
                                  const isStratSelected = activeTradeId === strat.id || activeStrategy?.id === strat.id;
                                  return (
                                    <React.Fragment key={`strat-p-${strat.id}`}>
                                      {/* Strategy Sub-Header Row (e.g. Ratio, Futures Option, Vertical) */}
                                      <tr
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveTradeId(strat.items[0]?.id || strat.id);
                                        }}
                                        className={`bg-[#14151e] hover:bg-slate-800/60 cursor-pointer transition-colors border-l-4 border-indigo-500/60 ${
                                          isStratSelected ? 'bg-indigo-950/30' : ''
                                        }`}
                                      >
                                        <td className="p-2.5 pl-8">
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleStrategy(strat.id);
                                              }}
                                              className="text-slate-500 hover:text-slate-300 p-0.5"
                                            >
                                              {isStratCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                            </button>
                                            <span className="w-2 h-2 rounded-full bg-purple-400/80"></span>
                                            <span className="font-bold text-slate-100 text-[13px] font-sans tracking-wide">
                                              {strat.strategyName}
                                            </span>
                                            {strat.expirationFormatted && (
                                              <span className="text-[11px] text-slate-400 font-sans">
                                                · {strat.expirationFormatted}
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="p-2.5 font-sans text-slate-400 text-xs">
                                          {strat.items[0]?.brokerName || 'Tastytrade'}
                                        </td>
                                        <td className="p-2.5 text-slate-300 font-semibold font-mono">
                                          {strat.totalQuantity > 0 ? `+${strat.totalQuantity}` : strat.totalQuantity}
                                        </td>
                                        <td className="p-2.5">
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                            {strat.daysLeftFormatted || (strat.dte !== undefined ? `${strat.dte}d left` : '-')}
                                          </span>
                                        </td>
                                        <td className="p-2.5 text-slate-400 font-mono">
                                          ${Math.abs(strat.netCostBasis).toFixed(2)}
                                        </td>
                                        <td className="p-2.5 text-slate-300 font-mono font-semibold">
                                          ${Math.abs(strat.netCurrentPrice).toFixed(2)}
                                        </td>
                                        <td className="p-2.5 font-bold text-white font-mono">
                                          ${strat.totalValue.toFixed(2)}
                                        </td>
                                        <td className={`p-2.5 font-bold font-mono ${strat.totalOpenPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          {strat.totalOpenPnl >= 0 ? '+' : ''}${strat.totalOpenPnl.toFixed(2)}
                                        </td>
                                      </tr>

                                      {/* 3. Individual Strategy Legs */}
                                      {!isStratCollapsed && strat.items.map((pos) => {
                                        const isLegSelected = activeTradeId === pos.id;
                                        return (
                                          <tr
                                            key={`pos-leg-${pos.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setActiveTradeId(pos.id);
                                            }}
                                            className={`bg-[#0f1016] hover:bg-slate-800/40 cursor-pointer transition-colors border-l-4 border-slate-700/30 ${
                                              isLegSelected ? 'bg-indigo-600/15' : ''
                                            }`}
                                          >
                                            <td className="p-2 pl-14">
                                              <div className="flex items-center gap-2 text-xs">
                                                <div className="flex items-center gap-1.5 bg-[#181a24] px-2.5 py-1 rounded-md border border-slate-800 text-[11px]">
                                                  <span className={`font-mono font-bold ${
                                                    pos.quantity < 0 ? 'text-amber-400' : 'text-emerald-400'
                                                  }`}>
                                                    {pos.quantity > 0 ? `+${pos.quantity}` : `${pos.quantity}`}
                                                  </span>
                                                  {pos.details?.expirationFormatted && (
                                                    <span className="text-slate-300 font-medium">{pos.details.expirationFormatted}</span>
                                                  )}
                                                  {pos.details?.daysLeftFormatted && (
                                                    <span className="text-[10px] text-slate-400 font-mono">
                                                      {pos.details.daysLeftFormatted}
                                                    </span>
                                                  )}
                                                  {pos.details?.strikeFormatted && (
                                                    <span className="font-mono font-bold text-white ml-1">
                                                      {pos.details.strikeFormatted}
                                                    </span>
                                                  )}
                                                  {pos.details?.optionTypeShort && (
                                                    <span className={`px-1 rounded text-[10px] font-bold ${
                                                      pos.details.optionTypeShort === 'P'
                                                        ? 'bg-amber-500/20 text-amber-300'
                                                        : 'bg-emerald-500/20 text-emerald-300'
                                                    }`}>
                                                      {pos.details.optionTypeShort}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </td>
                                            <td className="p-2 text-slate-500 text-xs font-sans">{pos.brokerName}</td>
                                            <td className="p-2 text-slate-300 font-semibold font-mono">
                                              {pos.quantity > 0 ? `+${pos.quantity}` : pos.quantity}
                                            </td>
                                            <td className="p-2 text-slate-400 font-mono text-[11px]">
                                              {pos.details?.expirationFormatted || '-'}
                                            </td>
                                            <td className="p-2 text-slate-400 font-mono">${(pos.averagePrice || 0).toFixed(2)}</td>
                                            <td className="p-2 text-slate-300 font-mono">${(pos.currentPrice || 0).toFixed(2)}</td>
                                            <td className="p-2 text-slate-300 font-mono">${(pos.totalValue || 0).toFixed(2)}</td>
                                            <td className={`p-2 font-mono font-semibold ${
                                              (pos.openPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                            }`}>
                                              {(pos.openPnl || 0) >= 0 ? '+' : ''}${(pos.openPnl || 0).toFixed(2)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </React.Fragment>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  ) : (
                    /* Flat Table for Open Positions */
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-[#161820] z-10">
                        <tr>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Symbol / Contract</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Broker</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Quantity</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Days Left / Expiry</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Avg Cost</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Current Price</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Market Value</th>
                          <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Open P/L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                        {filteredPositions.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center p-12 text-slate-500 font-sans">
                              No open positions found.
                            </td>
                          </tr>
                        ) : (
                          filteredPositions.map((pos) => {
                            const isSelected = activeTradeId === pos.id;
                            return (
                              <tr 
                                key={pos.id} 
                                onClick={() => setActiveTradeId(pos.id)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected ? 'bg-indigo-600/15' : 'hover:bg-slate-800/40'
                                }`}
                              >
                              <td className="p-3.5">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1.5 font-sans">
                                    <span className="font-bold text-white tracking-tight font-mono text-[13px]">
                                      {pos.details?.rootSymbol || pos.symbol}
                                    </span>
                                    {pos.details?.futureCycle && (
                                      <span className="bg-[#1f2430] text-indigo-300 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/30">
                                        {pos.details.futureCycle}
                                      </span>
                                    )}
                                    {pos.details?.isOption && (
                                      <span className="text-[9px] uppercase tracking-wider text-indigo-400 font-semibold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                                        {pos.details.isFuture ? 'Fut Opt' : 'Option'}
                                      </span>
                                    )}
                                  </div>
                                  {pos.details?.isOption && (
                                    <div className="flex items-center gap-1.5 text-[11px]">
                                      <span className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-semibold border ${
                                        pos.quantity < 0
                                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                      }`}>
                                        {pos.quantity > 0 ? `+${pos.quantity}` : `${pos.quantity}`}
                                      </span>
                                      {pos.details.expirationFormatted && (
                                        <span className="text-slate-200 font-medium">{pos.details.expirationFormatted}</span>
                                      )}
                                      {pos.details.strikeFormatted && (
                                        <span className="font-mono font-bold text-slate-100">{pos.details.strikeFormatted}</span>
                                      )}
                                      {pos.details.optionTypeShort && (
                                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                          pos.details.optionTypeShort === 'P'
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        }`}>
                                          {pos.details.optionTypeShort}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="p-3.5 font-sans">
                                <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-700/50">
                                  {pos.brokerName}
                                </span>
                              </td>
                              <td className="p-3.5 text-slate-300 font-semibold">{pos.quantity > 0 ? `+${pos.quantity}` : pos.quantity}</td>
                              <td className="p-3.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                  {pos.details?.daysLeftFormatted || (pos.details?.dte !== undefined ? `${pos.details.dte}d left` : 'Active')}
                                  {pos.details?.expirationFormatted && (
                                    <span className="text-emerald-300/80 font-normal">({pos.details.expirationFormatted})</span>
                                  )}
                                </span>
                              </td>
                              <td className="p-3.5 text-slate-400">${(pos.averagePrice || 0).toFixed(2)}</td>
                              <td className="p-3.5 text-slate-200 font-semibold">${(pos.currentPrice || 0).toFixed(2)}</td>
                              <td className="p-3.5 font-bold text-white">${(pos.totalValue || 0).toFixed(2)}</td>
                              <td className={`p-3.5 font-bold ${(pos.openPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {(pos.openPnl || 0) >= 0 ? '+' : ''}${(pos.openPnl || 0).toFixed(2)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                      </tbody>
                    </table>
                  )
                )}
              </div>
            </div>

            {/* Right Sidebar: Detailed Trade Inspector */}
            <aside className="flex flex-col gap-6">
              <div className="bg-[#13141a] border border-slate-800/80 rounded-2xl p-6 shadow-sm flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-5">
                    <span className="text-sm font-bold text-white">Trade & Strategy Inspector</span>
                    <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/10 text-[10px]">
                      SNAPTRADE SYNC
                    </Badge>
                  </div>

                  {activeTrade && activeMetrics ? (
                    <>
                      <div className="mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-white font-mono">
                              {activeTrade.details?.rootSymbol || activeTrade.symbol}
                            </span>
                            {activeTrade.details?.futureCycle && (
                              <span className="bg-[#1f2430] text-indigo-300 font-mono text-xs font-bold px-2 py-0.5 rounded border border-indigo-500/30">
                                {activeTrade.details.futureCycle}
                              </span>
                            )}
                            {activeStrategy && (
                              <span className="bg-purple-500/15 text-purple-300 font-sans text-xs font-bold px-2 py-0.5 rounded border border-purple-500/30">
                                {activeStrategy.strategyName}
                              </span>
                            )}
                          </div>
                          <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded text-[11px] font-medium border border-slate-700">
                            {activeTrade.brokerName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 font-sans">
                          {activeStrategy 
                            ? `${activeStrategy.strategyName} (${activeStrategy.items.length} ${activeStrategy.items.length === 1 ? 'leg' : 'legs'} · ${activeStrategy.expirationFormatted || 'Active'})`
                            : activeTrade.details?.isOption 
                              ? (activeTrade.details.isFuture ? 'Option on Future Contract' : 'Equity Option Contract')
                              : (activeTrade.details?.isFuture ? 'Futures Instrument' : 'Equity Asset')}
                        </div>
                      </div>

                      {/* View Switcher if Multi-Leg Strategy */}
                      {activeStrategy && activeStrategy.items.length > 1 && (
                        <div className="flex items-center bg-[#0e0f14] p-1 rounded-xl border border-slate-800/80 mb-4 text-xs font-sans">
                          <button
                            onClick={() => setInspectorMode('strategy')}
                            className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                              inspectorMode === 'strategy'
                                ? 'bg-purple-600/25 text-purple-200 border border-purple-500/40 shadow-sm'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Layers className="w-3.5 h-3.5 text-purple-400" />
                            <span>Whole Strategy ({activeStrategy.items.length} legs)</span>
                          </button>
                          <button
                            onClick={() => setInspectorMode('leg')}
                            className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                              inspectorMode === 'leg'
                                ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40 shadow-sm'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Selected Leg</span>
                          </button>
                        </div>
                      )}

                      {/* Multi-Leg Strategy Breakdown Card if strategy has > 1 leg */}
                      {activeStrategy && activeStrategy.items.length > 1 && (
                        <div className="bg-[#181a24] border border-purple-500/30 rounded-xl p-3 mb-4 font-sans">
                          <div className="flex items-center justify-between text-[11px] text-slate-300 mb-2 border-b border-slate-800/80 pb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                              <span className="font-bold text-purple-300">{activeStrategy.strategyName} Multi-Leg Structure</span>
                            </div>
                            <span className={`font-mono font-bold ${(strategyMetrics?.netProfit ?? activeStrategy.totalOpenPnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {(strategyMetrics?.netProfit ?? activeStrategy.totalOpenPnl) >= 0 ? '+' : ''}${(strategyMetrics?.netProfit ?? activeStrategy.totalOpenPnl).toFixed(2)}
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
                                    isThisLeg ? 'bg-indigo-600/25 border border-indigo-500/40 text-white' : 'hover:bg-slate-800/60 text-slate-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`font-bold ${legAction === 'STO' || legAction === 'STC' || legQty < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                      {signedQtyDisplay}
                                    </span>
                                    <span>{item.details?.strikeFormatted} {item.details?.optionTypeShort}</span>
                                    <span className="text-[10px] text-slate-400">{item.details?.expirationFormatted}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-slate-400">${(item.currentPrice || item.price || 0).toFixed(2)}</span>
                                    {itemPnl !== undefined && (
                                      <span className={`font-bold ${itemPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {itemPnl >= 0 ? '+' : ''}${itemPnl.toFixed(2)}
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
                        <div className="bg-[#181a22] border border-slate-800/90 rounded-xl p-3 mb-4 font-sans">
                          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2.5 border-b border-slate-800 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-300">Selected Contract Leg</span>
                              {activeTrade.status === 'Open' ? (
                                <span className="bg-emerald-500/20 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/40">
                                  OPEN
                                </span>
                              ) : (
                                <span className="bg-slate-800 text-slate-400 text-[9px] px-1.5 py-0.5 rounded font-medium border border-slate-700">
                                  CLOSED
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-emerald-400 font-bold">
                              ${(activeTrade.price || 0).toFixed(2)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {activeTrade.details.futureCycle && (
                                <span className="bg-[#1f2430] text-indigo-300 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/30">
                                  {activeTrade.details.futureCycle}
                                </span>
                              )}
                              <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold border ${
                                activeTrade.details.action === 'STO' || activeTrade.details.action === 'STC'
                                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                              }`}>
                                {activeTrade.details.action === 'STO' || activeTrade.details.action === 'STC' ? `-${activeTrade.quantity}` : `+${activeTrade.quantity}`}
                              </span>
                              <span className="text-slate-200 text-xs font-medium">
                                {activeTrade.details.expirationFormatted}
                              </span>
                              {activeTrade.status === 'Open' ? (
                                <span className="text-[10px] text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded font-mono font-semibold border border-emerald-500/30">
                                  {activeTrade.details.daysLeftFormatted || `${activeTrade.details.dte}d left`}
                                </span>
                              ) : (
                                activeTrade.details.dte !== undefined && (
                                  <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                                    {activeTrade.details.dte}d
                                  </span>
                                )
                              )}
                              <span className="font-mono text-xs font-bold text-white">
                                {activeTrade.details.strikeFormatted}
                              </span>
                              {activeTrade.details.optionTypeShort && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  activeTrade.details.optionTypeShort === 'P'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                }`}>
                                  {activeTrade.details.optionTypeShort} ({activeTrade.details.optionType})
                                </span>
                              )}
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                              activeTrade.details.action === 'BTO' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                              activeTrade.details.action === 'STO' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                              activeTrade.details.action === 'BTC' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' :
                              activeTrade.details.action === 'STC' ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' :
                              'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}>
                              {activeTrade.details.action}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* ROI Statistics Hero Cards */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-[#181a22] border border-slate-800/80 p-4 rounded-xl text-center">
                          <div className={`text-xl font-bold font-mono mb-1 ${
                            (inspectorMode === 'strategy' && strategyMetrics ? strategyMetrics.avgROI : (activeMetrics.avgROI || 0)) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {(inspectorMode === 'strategy' && strategyMetrics ? strategyMetrics.avgROI : (activeMetrics.avgROI || 0)) >= 0 ? '+' : ''}
                            {(inspectorMode === 'strategy' && strategyMetrics ? strategyMetrics.avgROI : (activeMetrics.avgROI || 0)).toFixed(1)}%
                          </div>
                          <div className="text-[10px] uppercase font-medium text-slate-400 flex items-center justify-center gap-1">
                            {inspectorMode === 'strategy' && activeStrategy && activeStrategy.items.length > 1 && (
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                            )}
                            <span>{inspectorMode === 'strategy' && activeStrategy && activeStrategy.items.length > 1 ? 'Strategy Avg ROI' : 'Avg Capital ROI'}</span>
                          </div>
                        </div>

                        <div className="bg-[#181a22] border border-slate-800/80 p-4 rounded-xl text-center">
                          <div className={`text-xl font-bold font-mono mb-1 ${
                            (inspectorMode === 'strategy' && strategyMetrics ? strategyMetrics.peakROI : (activeMetrics.peakROI || 0)) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {(inspectorMode === 'strategy' && strategyMetrics ? strategyMetrics.peakROI : (activeMetrics.peakROI || 0)) >= 0 ? '+' : ''}
                            {(inspectorMode === 'strategy' && strategyMetrics ? strategyMetrics.peakROI : (activeMetrics.peakROI || 0)).toFixed(1)}%
                          </div>
                          <div className="text-[10px] uppercase font-medium text-slate-400 flex items-center justify-center gap-1">
                            {inspectorMode === 'strategy' && activeStrategy && activeStrategy.items.length > 1 && (
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                            )}
                            <span>{inspectorMode === 'strategy' && activeStrategy && activeStrategy.items.length > 1 ? 'Strategy Peak ROI' : 'Peak Capital ROI'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Detailed Statistics Table */}
                      <div className="mt-6 space-y-3 font-mono text-xs border-t border-slate-800/80 pt-4">
                        {inspectorMode === 'strategy' && strategyMetrics && activeStrategy && activeStrategy.items.length > 1 ? (
                          <>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Strategy Status:</span>
                              <span className={strategyMetrics.isOpen ? 'text-emerald-400 font-bold' : 'text-slate-300 font-semibold'}>
                                {strategyMetrics.isOpen ? `Open Active Position (${strategyMetrics.legsCount} legs)` : `Closed Strategy (${strategyMetrics.legsCount} legs)`}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Strategy Expiration:</span>
                              <span className="text-slate-200">{activeStrategy.expirationFormatted || '-'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Net Entry / Cost Basis:</span>
                              <span className="text-slate-200">${Math.abs(strategyMetrics.netCostBasis).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Net Market Price:</span>
                              <span className="text-slate-200">${Math.abs(strategyMetrics.netCurrentPrice).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Total Required Capital:</span>
                              <span className="text-slate-200">${strategyMetrics.totalRequiredCapital.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Peak Capital Exposure:</span>
                              <span className="text-slate-200">${strategyMetrics.totalPeakCapital.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">{strategyMetrics.isOpen ? 'Strategy Unrealized P/L:' : 'Strategy Realized P/L:'}</span>
                              <span className={strategyMetrics.netProfit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                {strategyMetrics.netProfit >= 0 ? '+' : ''}${strategyMetrics.netProfit.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between border-t border-slate-800/60 pt-2">
                              <span className="text-slate-400 font-sans">Holding Period:</span>
                              <span className="text-slate-200">{strategyMetrics.daysHeld} {strategyMetrics.daysHeld === 1 ? 'day' : 'days'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Strategy Annualized ROI:</span>
                              <span className="text-indigo-400 font-bold">{strategyMetrics.annualizedROI.toFixed(1)}%</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Status:</span>
                              <span className={activeTrade.status === 'Open' ? 'text-emerald-400 font-bold' : 'text-slate-300 font-semibold'}>
                                {activeTrade.status === 'Open' ? 'Open Active Position' : 'Closed Trade'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Execution Date:</span>
                              <span className="text-slate-200">{formatTradeDateTime(activeTrade.date)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Entry Price / Qty:</span>
                              <span className="text-slate-200">${(activeTrade.price || 0).toFixed(2)} × {activeTrade.quantity || 1}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Required Capital:</span>
                              <span className="text-slate-200">${(activeTrade.requiredCapital || 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Peak Capital Exposure:</span>
                              <span className="text-slate-200">${(activeTrade.peakCapital || 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">{activeTrade.status === 'Open' ? 'Unrealized Gain/Loss:' : 'Realized Gain/Loss:'}</span>
                              <span className={(activeMetrics.profit || 0) >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                {(activeMetrics.profit || 0) >= 0 ? '+' : ''}${(activeMetrics.profit || 0).toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between border-t border-slate-800/60 pt-2">
                              <span className="text-slate-400 font-sans">Holding Period:</span>
                              <span className="text-slate-200">{activeMetrics.daysHeld || 1} {(activeMetrics.daysHeld || 1) === 1 ? 'day' : 'days'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 font-sans">Annualized ROI:</span>
                              <span className="text-indigo-400 font-bold">{(activeMetrics.annualizedROI || 0).toFixed(1)}%</span>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="mt-6 p-4 bg-indigo-500/5 rounded-xl border border-indigo-500/20 text-xs font-sans">
                        <div className="text-indigo-400 font-bold uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Capital Efficiency Insight</span>
                        </div>
                        <p className="text-slate-400 text-[11px] leading-relaxed">
                          {inspectorMode === 'strategy' && strategyMetrics && activeStrategy && activeStrategy.items.length > 1 ? (
                            `Allocated $${strategyMetrics.totalRequiredCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${strategyMetrics.legsCount} legs in ${activeStrategy.strategyName} structure. Peak exposure reached $${strategyMetrics.totalPeakCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, delivering an annualized yield of ${strategyMetrics.annualizedROI.toFixed(1)}%.`
                          ) : (
                            `Allocated $${(activeTrade.requiredCapital || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at open. Peak exposure reached $${(activeTrade.peakCapital || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, delivering an annualized yield of ${(activeMetrics.annualizedROI || 0).toFixed(1)}%.`
                          )}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-slate-500 text-xs">
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
        <DialogContent className="bg-[#13141a] border-slate-800 text-slate-100 max-w-2xl h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-4 border-b border-slate-800/80 flex flex-row items-center justify-between shrink-0">
            <div>
              <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />
                <span>SnapTrade Connection Portal</span>
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs mt-0.5">
                Securely authenticate with your brokerage. SnapTrade connects directly with OAuth and encryption.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 bg-[#0d0e12] relative flex flex-col items-center justify-center">
            {portalLoading ? (
              <div className="flex flex-col items-center gap-3 p-8">
                <Activity className="w-8 h-8 text-indigo-400 animate-spin" />
                <span className="text-xs font-mono text-slate-400">Opening secure portal session...</span>
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
                <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-white mb-2">SnapTrade Setup</h3>
                <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                  {portalError || 'To connect live brokerages, please configure your SnapTrade Client ID and Consumer Key in Settings.'}
                </p>
                <div className="flex gap-3 justify-center">
                  <Button
                    onClick={() => handleOpenConnectionPortal()}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 cursor-pointer"
                  >
                    Try Again
                  </Button>
                  <Button
                    onClick={() => setPortalDialogOpen(false)}
                    variant="outline"
                    className="border-slate-700 text-slate-300 text-xs cursor-pointer"
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
        <DialogContent className="bg-[#13141a] border-slate-800 text-slate-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-400" />
              <span>Connected Brokerages</span>
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Manage your linked institutions and connections across SnapTrade.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 my-4 max-h-[50vh] overflow-y-auto">
            {connections.length === 0 && accounts.length === 0 ? (
              <div className="text-center p-6 text-slate-500 text-xs">
                No brokerages connected yet.
              </div>
            ) : (
              (connections.length > 0 ? connections : accounts).map((item: any) => {
                const title = item.brokerage?.name || item.institution_name || 'Brokerage Connection';
                const id = item.id;
                const isDisabled = item.disabled === true;
                return (
                  <div key={id} className="bg-[#181a22] border border-slate-800/80 p-3.5 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center font-bold text-indigo-400 text-xs">
                        {title.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white">{title}</span>
                          {isDisabled ? (
                            <span className="bg-amber-500/10 text-amber-300 text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30">
                              Re-auth Needed
                            </span>
                          ) : (
                            <span className="bg-emerald-500/10 text-emerald-300 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/20">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">ID: {id.slice(0, 16)}...</div>
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
                          className="bg-amber-600 hover:bg-amber-500 text-white h-7 px-2.5 text-xs cursor-pointer shadow-sm"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Reconnect
                        </Button>
                      )}
                      <Button
                        onClick={() => handleDisconnectBroker(id)}
                        variant="ghost"
                        size="sm"
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-7 px-2.5 text-xs cursor-pointer"
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

          <div className="flex gap-2 justify-between pt-2 border-t border-slate-800/80">
            <Button
              onClick={() => {
                setConnectionsDialogOpen(false);
                setTastyDialogOpen(true);
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold h-9 cursor-pointer"
            >
              <span className="mr-1">🍒</span>
              <span>Tastytrade Direct API</span>
            </Button>
            <Button
              onClick={() => {
                setConnectionsDialogOpen(false);
                handleOpenConnectionPortal();
              }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold h-9 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 mr-1.5" />
              Link Via SnapTrade
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tastytrade Direct API Connect Dialog */}
      <Dialog open={tastyDialogOpen} onOpenChange={setTastyDialogOpen}>
        <DialogContent className="bg-[#13141a] border-slate-800 text-slate-100 max-w-md p-6">
          <DialogHeader className="pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-lg">
                🍒
              </div>
              <div>
                <DialogTitle className="text-white text-base font-bold">
                  Tastytrade Direct API
                </DialogTitle>
                <DialogDescription className="text-slate-400 text-xs mt-0.5">
                  Official REST connection for real-time futures options & live quotes.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {tastyConnected ? (
            <div className="py-4 space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">
                  ✓
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Tastytrade API Connected</div>
                  <div className="text-[11px] text-emerald-300">
                    Live positions, `/MES`, `/MNQ`, balances & mark quotes active.
                  </div>
                  {tastyUser?.email && (
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">User: {tastyUser.email}</div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  onClick={() => {
                    if (user) fetchAllData(user.uid);
                    setTastyDialogOpen(false);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Sync Portfolio
                </Button>
                <Button
                  onClick={handleTastytradeLogout}
                  variant="ghost"
                  className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleTastytradeLogin} className="py-3 space-y-4">
              {tastyError && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs p-3 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>{tastyError}</div>
                </div>
              )}

              {tastyRequires2FA ? (
                <div className="space-y-3">
                  <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs p-3 rounded-xl">
                    <div className="font-semibold text-amber-400 mb-1">🔐 2FA Verification Required</div>
                    <div>Please enter the 6-digit verification code from your SMS or Authenticator App.</div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      6-Digit Security Code (OTP)
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      autoFocus
                      required
                      placeholder="123456"
                      value={tastyOtp}
                      onChange={(e) => setTastyOtp(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-[#181a24] border border-slate-700 focus:border-rose-500 rounded-xl px-4 py-2.5 text-center text-xl font-mono tracking-widest text-white outline-none transition-colors"
                    />
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTastyRequires2FA(false);
                        setTastyOtp('');
                      }}
                      className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
                    >
                      Back to Username
                    </button>
                    <Button
                      type="submit"
                      disabled={tastyLoading || tastyOtp.length < 6}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-5 h-9 cursor-pointer disabled:opacity-50"
                    >
                      {tastyLoading ? <Activity className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                      Verify & Connect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      Tastytrade Username or Email
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      placeholder="e.g. trader123 or you@email.com"
                      value={tastyLogin}
                      onChange={(e) => setTastyLogin(e.target.value)}
                      className="w-full bg-[#181a24] border border-slate-700 focus:border-rose-500 rounded-xl px-3.5 py-2 text-xs text-white outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      placeholder="••••••••••••"
                      value={tastyPassword}
                      onChange={(e) => setTastyPassword(e.target.value)}
                      className="w-full bg-[#181a24] border border-slate-700 focus:border-rose-500 rounded-xl px-3.5 py-2 text-xs text-white outline-none transition-colors"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <button
                      type="button"
                      onClick={() => setTastyRequires2FA(true)}
                      className="text-[11px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                    >
                      Enter 2FA / Device Code directly →
                    </button>
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Credentials authenticate directly with Tastytrade API over TLS encryption.</span>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-800/80">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setTastyDialogOpen(false)}
                      className="border-slate-700 text-slate-300 text-xs h-9 cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={tastyLoading || !tastyLogin || !tastyPassword}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-5 h-9 cursor-pointer disabled:opacity-50"
                    >
                      {tastyLoading ? <Activity className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
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


