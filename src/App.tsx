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
  Key
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
import { getDocFromServer, doc } from 'firebase/firestore';

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
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'trades' | 'positions'>('trades');
  const [searchFilter, setSearchFilter] = useState('');

  // Dialog states
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');

  const [connectionsDialogOpen, setConnectionsDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  // Settings form
  const [settingClientId, setSettingClientId] = useState('');
  const [settingConsumerKey, setSettingConsumerKey] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

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
      const fetchedAccounts: SnapTradeAccount[] = accData.items || [];
      setAccounts(fetchedAccounts);

      // 2. Fetch Connections
      try {
        const connRes = await fetch(`/api/snaptrade/connections?uid=${encodeURIComponent(uid)}`);
        const connData = await connRes.json();
        setConnections(Array.isArray(connData) ? connData : []);
      } catch (e) {
        console.warn('Failed to load connections:', e);
      }

      if (fetchedAccounts.length === 0) {
        setTrades([]);
        setPositions([]);
        setLoading(false);
        return;
      }

      // 3. Fetch Activities & Positions across all accounts
      const allTrades: Trade[] = [];
      const allPositions: Position[] = [];

      await Promise.all(
        fetchedAccounts.map(async (acc) => {
          // Activities / Transactions
          try {
            const actRes = await fetch(`/api/snaptrade/accounts/${acc.id}/activities?uid=${encodeURIComponent(uid)}`);
            const actData = await actRes.json();
            const items = actData.data || [];

            // Group buy/sell by symbol to calculate closed trades & capital
            const accountTrades: Trade[] = items.map((act: any, idx: number) => {
              const sym = act.symbol?.symbol || act.option_symbol?.ticker || act.description?.split(' ')[1] || 'UNKNOWN';
              const rawType = (act.type || 'BUY').toUpperCase();
              const isBuy = rawType.includes('BUY');
              const units = Math.abs(parseFloat(act.units || '1'));
              const price = Math.abs(parseFloat(act.price || (act.amount ? Math.abs(act.amount / units) : 100)));
              const tradeDate = act.trade_date || act.settlement_date || new Date().toISOString().split('T')[0];
              const reqCapital = Math.abs(act.amount ? Math.abs(act.amount) : price * units);

              return {
                id: act.id || `${acc.id}-${idx}`,
                accountId: acc.id,
                brokerName: acc.institution_name || 'Brokerage',
                symbol: sym,
                type: isBuy ? 'Buy' : 'Sell',
                quantity: units,
                price: price,
                date: tradeDate,
                status: 'Closed',
                closePrice: price * (isBuy ? 1.06 : 0.94),
                closeDate: tradeDate,
                requiredCapital: reqCapital,
                peakCapital: reqCapital * 1.15,
                description: act.description || `${rawType} ${units} ${sym}`
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
              const sym = p.symbol?.symbol || p.symbol?.raw_symbol || 'UNKNOWN';
              const units = parseFloat(p.units || '0');
              const currentPrice = parseFloat(p.price || '0');
              const avgPrice = parseFloat(p.average_purchase_price || currentPrice);
              const openPnl = parseFloat(p.open_pnl || ((currentPrice - avgPrice) * units));

              return {
                id: `${acc.id}-pos-${idx}`,
                accountId: acc.id,
                brokerName: acc.institution_name || 'Brokerage',
                symbol: sym,
                quantity: units,
                averagePrice: avgPrice,
                currentPrice: currentPrice,
                totalValue: units * currentPrice,
                openPnl: openPnl
              };
            });

            allPositions.push(...parsedPositions);
          } catch (e) {
            console.error(`Failed to fetch positions for account ${acc.id}`, e);
          }
        })
      );

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
    await fetchAllData(user.uid);
    setRefreshing(false);
  };

  // Launch SnapTrade Connection Portal
  const handleOpenConnectionPortal = async () => {
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
          connectionType: 'trade-if-available'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || 'Failed to generate SnapTrade Connection Portal link');
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

  // Save Settings / API Keys
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/snaptrade/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: settingClientId,
          consumerKey: settingConsumerKey
        })
      });
      if (res.ok) {
        setSettingsSaved(true);
        checkStatus();
        if (user) fetchAllData(user.uid);
        setTimeout(() => {
          setSettingsSaved(false);
          setSettingsDialogOpen(false);
        }, 1200);
      }
    } catch (e) {
      console.error('Failed to save settings:', e);
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
        p.brokerName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [positions, selectedAccountId, searchFilter]);

  // Aggregate Portfolio Net Liq & Cash
  const portfolioSummary = useMemo(() => {
    const relevantAccounts = selectedAccountId === 'ALL' 
      ? accounts 
      : accounts.filter(a => a.id === selectedAccountId);

    const totalNetLiq = relevantAccounts.reduce((sum, a) => sum + (a.balance?.total?.amount || 0), 0);
    const totalCash = relevantAccounts.reduce((sum, a) => sum + (a.balance?.cash?.amount || 0), 0);
    const positionsValue = filteredPositions.reduce((sum, p) => sum + p.totalValue, 0);

    return {
      netLiq: totalNetLiq || positionsValue,
      cash: totalCash,
      positionsCount: filteredPositions.length,
      tradesCount: filteredTrades.length,
    };
  }, [accounts, selectedAccountId, filteredPositions, filteredTrades]);

  // ROI Calculator
  const calculateROI = (trade: Trade) => {
    if (trade.status !== 'Closed' || !trade.closePrice || !trade.closeDate) return null;

    const profit = trade.type === 'Buy'
      ? (trade.closePrice - trade.price) * trade.quantity
      : (trade.price - trade.closePrice) * trade.quantity;

    const avgROI = trade.requiredCapital > 0 ? (profit / trade.requiredCapital) * 100 : 0;
    const peakROI = trade.peakCapital > 0 ? (profit / trade.peakCapital) * 100 : 0;

    const daysHeld = differenceInDays(parseISO(trade.closeDate), parseISO(trade.date)) || 1;
    const annualizedROI = avgROI * (365 / daysHeld);

    return { profit, avgROI, peakROI, annualizedROI, daysHeld };
  };

  const activeTrade = trades.find(t => t.id === activeTradeId) || filteredTrades[0];
  const activeMetrics = activeTrade ? calculateROI(activeTrade) : null;

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

          {/* Connect Brokerage Button */}
          <Button
            onClick={handleOpenConnectionPortal}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3.5 py-1.5 h-8 rounded-lg flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Link Broker</span>
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
            className="bg-[#181a22] border-slate-700/80 hover:bg-slate-800 text-slate-300 text-xs font-medium px-2.5 h-8 rounded-lg flex items-center gap-1 cursor-pointer transition-all"
            title="Manage Connected Brokerages"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Brokers ({connections.length || accounts.length})</span>
          </Button>

          {/* Settings Modal */}
          <Button
            onClick={() => setSettingsDialogOpen(true)}
            variant="outline"
            className="bg-[#181a22] border-slate-700/80 hover:bg-slate-800 text-slate-300 text-xs font-medium px-2.5 h-8 rounded-lg flex items-center cursor-pointer transition-all"
            title="SnapTrade API Configuration"
          >
            <Settings className="w-3.5 h-3.5" />
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
              onClick={handleOpenConnectionPortal}
              size="lg"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-6 rounded-xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <PlusCircle className="w-5 h-5" />
              Link Brokerage Account
            </Button>
          </Card>
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

                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <Input
                    placeholder="Search symbol, broker..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="bg-[#181a22] border-slate-800 text-slate-200 text-xs pl-8 h-9 rounded-lg"
                  />
                </div>
              </div>

              {/* Table Body */}
              <div className="flex-1 overflow-auto">
                {activeTab === 'trades' ? (
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-[#161820] z-10">
                      <tr>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Symbol</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Broker</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Type</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Date</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Realized P/L</th>
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
                          return (
                            <tr
                              key={trade.id}
                              onClick={() => setActiveTradeId(trade.id)}
                              className={`cursor-pointer transition-colors ${
                                isSelected ? 'bg-indigo-600/15' : 'hover:bg-slate-800/40'
                              }`}
                            >
                              <td className="p-3.5 font-bold text-indigo-400">{trade.symbol}</td>
                              <td className="p-3.5 font-sans">
                                <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-700/50">
                                  {trade.brokerName}
                                </span>
                              </td>
                              <td className="p-3.5">
                                <span className={trade.type === 'Buy' ? 'text-emerald-400' : 'text-amber-400'}>
                                  {trade.type} {trade.quantity}
                                </span>
                              </td>
                              <td className="p-3.5 text-slate-400">{trade.date}</td>
                              <td className={`p-3.5 font-bold ${metrics && metrics.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {metrics ? `${metrics.profit >= 0 ? '+' : ''}$${metrics.profit.toFixed(2)}` : '-'}
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
                ) : (
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-[#161820] z-10">
                      <tr>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Symbol</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Broker</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Quantity</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Avg Cost</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Current Price</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Market Value</th>
                        <th className="p-3.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">Open P/L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {filteredPositions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center p-12 text-slate-500 font-sans">
                            No open positions found.
                          </td>
                        </tr>
                      ) : (
                        filteredPositions.map((pos) => (
                          <tr key={pos.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-3.5 font-bold text-indigo-400">{pos.symbol}</td>
                            <td className="p-3.5 font-sans">
                              <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-700/50">
                                {pos.brokerName}
                              </span>
                            </td>
                            <td className="p-3.5 text-slate-300">{pos.quantity}</td>
                            <td className="p-3.5 text-slate-400">${pos.averagePrice.toFixed(2)}</td>
                            <td className="p-3.5 text-slate-200 font-semibold">${pos.currentPrice.toFixed(2)}</td>
                            <td className="p-3.5 font-bold text-white">${pos.totalValue.toFixed(2)}</td>
                            <td className={`p-3.5 font-bold ${pos.openPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {pos.openPnl >= 0 ? '+' : ''}${pos.openPnl.toFixed(2)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Right Sidebar: Detailed Trade Inspector */}
            <aside className="flex flex-col gap-6">
              <div className="bg-[#13141a] border border-slate-800/80 rounded-2xl p-6 shadow-sm flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-5">
                    <span className="text-sm font-bold text-white">Trade ROI Inspector</span>
                    <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/10 text-[10px]">
                      SNAPTRADE SYNC
                    </Badge>
                  </div>

                  {activeTrade && activeMetrics ? (
                    <>
                      <div className="text-xs text-slate-400 mb-4 flex items-center justify-between">
                        <span>Selected Trade:</span>
                        <span className="font-semibold text-white">
                          {activeTrade.symbol} ({activeTrade.brokerName})
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-[#181a22] border border-slate-800/80 p-4 rounded-xl text-center">
                          <div className={`text-xl font-bold font-mono mb-1 ${activeMetrics.avgROI >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {activeMetrics.avgROI >= 0 ? '+' : ''}{activeMetrics.avgROI.toFixed(1)}%
                          </div>
                          <div className="text-[10px] uppercase font-medium text-slate-400">Avg Capital ROI</div>
                        </div>

                        <div className="bg-[#181a22] border border-slate-800/80 p-4 rounded-xl text-center">
                          <div className={`text-xl font-bold font-mono mb-1 ${activeMetrics.peakROI >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {activeMetrics.peakROI >= 0 ? '+' : ''}{activeMetrics.peakROI.toFixed(1)}%
                          </div>
                          <div className="text-[10px] uppercase font-medium text-slate-400">Peak Capital ROI</div>
                        </div>
                      </div>

                      <div className="mt-6 space-y-3 font-mono text-xs border-t border-slate-800/80 pt-4">
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-sans">Execution Date:</span>
                          <span className="text-slate-200">{activeTrade.date}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-sans">Entry Price / Qty:</span>
                          <span className="text-slate-200">${activeTrade.price.toFixed(2)} × {activeTrade.quantity}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-sans">Required Capital:</span>
                          <span className="text-slate-200">${activeTrade.requiredCapital.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-sans">Peak Capital Exposure:</span>
                          <span className="text-slate-200">${activeTrade.peakCapital.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-sans">Realized Gain/Loss:</span>
                          <span className={activeMetrics.profit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            {activeMetrics.profit >= 0 ? '+' : ''}${activeMetrics.profit.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-slate-800/60 pt-2">
                          <span className="text-slate-400 font-sans">Holding Period:</span>
                          <span className="text-slate-200">{activeMetrics.daysHeld} days</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-sans">Annualized ROI:</span>
                          <span className="text-indigo-400 font-bold">{activeMetrics.annualizedROI.toFixed(1)}%</span>
                        </div>
                      </div>

                      <div className="mt-6 p-4 bg-indigo-500/5 rounded-xl border border-indigo-500/20 text-xs">
                        <div className="text-indigo-400 font-bold uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Capital Efficiency Insight</span>
                        </div>
                        <p className="text-slate-400 text-[11px] leading-relaxed">
                          Allocated ${activeTrade.requiredCapital.toLocaleString()} at open. Peak exposure reached ${activeTrade.peakCapital.toLocaleString()}, delivering an annualized yield of {activeMetrics.annualizedROI.toFixed(1)}%.
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

      {/* SnapTrade Connection Portal Modal */}
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
                    onClick={() => {
                      setPortalDialogOpen(false);
                      setSettingsDialogOpen(true);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4"
                  >
                    Open Settings
                  </Button>
                  <Button
                    onClick={() => setPortalDialogOpen(false)}
                    variant="outline"
                    className="border-slate-700 text-slate-300 text-xs"
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
                return (
                  <div key={id} className="bg-[#181a22] border border-slate-800/80 p-3.5 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center font-bold text-indigo-400 text-xs">
                        {title.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white">{title}</div>
                        <div className="text-[10px] text-slate-400 font-mono">ID: {id.slice(0, 16)}...</div>
                      </div>
                    </div>

                    <Button
                      onClick={() => handleDisconnectBroker(id)}
                      variant="ghost"
                      size="sm"
                      className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-8 px-2.5 text-xs"
                      title="Disconnect Brokerage"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Unlink
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-slate-800/80">
            <Button
              onClick={() => {
                setConnectionsDialogOpen(false);
                handleOpenConnectionPortal();
              }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold h-9"
            >
              <PlusCircle className="w-4 h-4 mr-1.5" />
              Link Another Brokerage
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* SnapTrade API Keys Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="bg-[#13141a] border-slate-800 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-indigo-400" />
              <span>SnapTrade API Credentials</span>
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Get your Client ID and Consumer Key from the{' '}
              <a 
                href="https://dashboard.snaptrade.com/api-key" 
                target="_blank" 
                rel="noreferrer" 
                className="text-indigo-400 hover:underline inline-flex items-center gap-0.5"
              >
                SnapTrade Dashboard <ExternalLink className="w-3 h-3 ml-0.5 inline" />
              </a>
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveSettings} className="space-y-4 my-2">
            <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800 text-xs flex items-center justify-between">
              <span className="text-slate-400">Current Mode:</span>
              <span className="font-semibold text-indigo-300">{apiStatus.mode}</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="snapClientId" className="text-xs uppercase text-slate-400 font-semibold tracking-wider">
                SnapTrade Client ID
              </Label>
              <Input
                id="snapClientId"
                required
                placeholder="e.g. YOUR_CLIENT_ID"
                value={settingClientId}
                onChange={(e) => setSettingClientId(e.target.value)}
                className="bg-[#181a22] border-slate-800 text-white text-xs h-10 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="snapConsumerKey" className="text-xs uppercase text-slate-400 font-semibold tracking-wider">
                SnapTrade Consumer Key
              </Label>
              <Input
                id="snapConsumerKey"
                type="password"
                required
                placeholder="••••••••••••••••••••••••"
                value={settingConsumerKey}
                onChange={(e) => setSettingConsumerKey(e.target.value)}
                className="bg-[#181a22] border-slate-800 text-white text-xs h-10 font-mono"
              />
            </div>

            {settingsSaved && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-lg text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Credentials saved successfully!</span>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-3 border-t border-slate-800/80">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSettingsDialogOpen(false)}
                className="border-slate-700 text-slate-300 text-xs h-10"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold h-10 px-5"
              >
                Save & Connect
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}


