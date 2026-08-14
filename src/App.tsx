import React, { useState, useEffect } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { LogIn, Activity, Database, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// Firebase imports
import { auth, loginWithGoogle, logout, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getDocFromServer, doc } from 'firebase/firestore';

interface Trade {
  id: string;
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
}

interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  requiredCapital: number;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // App state
  const [trades, setTrades] = useState<Trade[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  // Tastytrade state
  const [tastyToken, setTastyToken] = useState<string | null>(null);
  const [tastyAccounts, setTastyAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isDeveloperMode, setIsDeveloperMode] = useState(false); // Default to Username/Password mode
  const [tastyClientSecret, setTastyClientSecret] = useState('');
  const [tastyRefreshToken, setTastyRefreshToken] = useState('');
  const [tastyLogin, setTastyLogin] = useState('');
  const [tastyPassword, setTastyPassword] = useState('');
  const [tastyOtp, setTastyOtp] = useState('');
  const [needsOtp, setNeedsOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        // Test Firestore connection on login
        try {
          await getDocFromServer(doc(db, 'users', currentUser.uid));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
             setDbError("Please check your Firebase configuration. The client is offline.");
          }
        }
        // In real app we might fetch the encrypted token from Firebase here.
        // For this demo context, we ask them to log in to Tastytrade per session for security.
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setTrades([]);
      setPositions([]);
      setTastyToken(null);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleTastyConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Initiating connection to proxy /api/tt/connect...");
    setConnecting(true);
    setConnectError('');
    try {
      const payload = isDeveloperMode 
        ? { isDeveloperMode, clientSecret: tastyClientSecret, refreshToken: tastyRefreshToken }
        : { userIdentifier: tastyLogin, secretToken: tastyPassword, otpCode: tastyOtp };

      const res = await fetch('/api/tt/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const textData = await res.text();
      let data;
      try {
        data = JSON.parse(textData);
      } catch (parseError) {
        throw new Error(`Server returned an unexpected response (Status: ${res.status}). Body: ${textData.substring(0, 100)}`);
      }

      if (!res.ok) throw new Error(data.error_description || data.error?.message || data.error?.code || 'Failed to authenticate');
      
      setTastyToken(data['session-token']);
      setConnectDialogOpen(false);
      setTastyPassword(''); // clear password from state
      setTastyOtp(''); // clear OTP
      setNeedsOtp(false); // Reset state
      fetchData(data['session-token']);
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes('device authentication challenge required')) {
        setNeedsOtp(true);
        setConnectError("A device authentication email may have been sent. If you did not receive an email, your Tastytrade account may require the Two-Factor Authenticator App code instead. Please check your authenticator app.");
      } else {
        setConnectError(err.message);
      }
    } finally {
      setConnecting(false);
    }
  };

  const fetchData = async (token: string = tastyToken || '', accountIdToFetch: string | null = selectedAccountId) => {
    if (!token) return;
    setLoading(true);
    try {
      // 1. Get Accounts
      let accRes = await fetch('/api/tastytrade/accounts', {
        headers: { 'Authorization': token }
      });
      let accData = await accRes.json();
      if (!accRes.ok) throw new Error(accData.error?.message || 'Failed fetching accounts');
      
      const accounts = accData.items || [];
      if (accounts.length === 0) {
          throw new Error('No broker accounts found on this login.');
      }
      
      setTastyAccounts(accounts);
      
      const targetAccountId = accountIdToFetch || accounts[0].account?.['account-number'] || accounts[0]?.['account-number'];
      if (!selectedAccountId && !accountIdToFetch) {
        setSelectedAccountId(targetAccountId);
      }
      
      console.log(`Fetching transactions for account ${targetAccountId}...`);

      // 2. Get Transactions for the specific account
      const allTransItems: any[] = [];
      
      try {
        const transRes = await fetch(`/api/tastytrade/accounts/${targetAccountId}/transactions`, { 
          headers: { 'Authorization': token } 
        });
        const transactions = await transRes.json();
        if (transactions.items && Array.isArray(transactions.items)) {
          allTransItems.push(...transactions.items);
        }
      } catch (e) {
        console.error(`Failed to fetch transactions for account ${targetAccountId}`, e);
      }

      console.log(`Total Parsed Transaction Items for account ${targetAccountId}: ${allTransItems.length}`);

      const parsedTrades: Trade[] = allTransItems.map((t: any, i: number) => ({
        id: t.id || String(i),
        symbol: t.symbol || t.underlyingSymbol || 'UNKNOWN',
        type: t.action?.toLowerCase().includes('buy') ? 'Buy' : 'Sell',
        quantity: Math.abs(parseFloat(t.quantity || '0')),
        price: parseFloat(t.price || t.value || '0'),
        date: (t.executedAt || t.transactionDate || new Date().toISOString()).split('T')[0],
        status: 'Closed', // Rough assumption for demo
        closePrice: parseFloat(t.price || t.value || '0') * 1.05, // Mocked close price
        closeDate: (t.executedAt || t.transactionDate || new Date().toISOString()).split('T')[0],
        requiredCapital: Math.abs(parseFloat(t.value || '1000')),
        peakCapital: Math.abs(parseFloat(t.value || '1200')),
      }));

      console.log('Final Mapped Trades:', parsedTrades);
      
      setTrades(parsedTrades);
      if (parsedTrades.length > 0) setActiveTradeId(parsedTrades[0].id);

    } catch (error: any) {
      console.error('API Sync Error (Using fallback mock data):', error);
      // Fallback to mock data so UI still functions if no Sandbox deals are matched
      /*try {
        const [tradesRes, positionsRes] = await Promise.all([fetch('/api/trades'), fetch('/api/positions')]);
        const tradesData = await tradesRes.json();
        const positionsData = await positionsRes.json();
        setTrades(Array.isArray(tradesData) ? tradesData : []);
        setPositions(Array.isArray(positionsData) ? positionsData : []);
        if (Array.isArray(tradesData) && tradesData.length > 0) setActiveTradeId(tradesData[0].id);
      } catch (fallbackErr) {
        setTrades([]);
        setPositions([]);
      }*/
      setTrades([]);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchData(tastyToken || '', selectedAccountId);
    } catch (error) {
      console.error('Failed to refresh data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const calculateROI = (trade: Trade) => {
    if (trade.status !== 'Closed' || !trade.closePrice || !trade.closeDate) return null;
    
    const profit = trade.type === 'Buy' 
      ? (trade.closePrice - trade.price) * trade.quantity
      : (trade.price - trade.closePrice) * trade.quantity;
      
    const avgROI = (profit / trade.requiredCapital) * 100;
    const peakROI = (profit / trade.peakCapital) * 100;
    
    const daysHeld = differenceInDays(parseISO(trade.closeDate), parseISO(trade.date)) || 1;
    const annualizedROI = avgROI * (365 / daysHeld);
    
    return { profit, avgROI, peakROI, annualizedROI, daysHeld };
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Activity className="w-8 h-8 text-brand-accent animate-spin" />
        <div className="mt-4 text-muted-foreground font-mono text-sm">INITIALIZING...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-border">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Activity className="w-6 h-6 text-brand-accent" />
            </div>
            <CardTitle className="text-2xl font-bold text-foreground">Alphatrack</CardTitle>
            <CardDescription className="text-muted-foreground">Log in to link your brokerage account data to the analytics platform.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-8">
            <Button onClick={handleLogin} size="lg" className="w-full bg-brand-accent hover:bg-brand-accent/90 text-white">
              <LogIn className="w-4 h-4 mr-2" />
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeTrade = trades.find(t => t.id === activeTradeId) || trades[0];
  const activeMetrics = activeTrade ? calculateROI(activeTrade) : null;
  const portfolioCapital = positions.reduce((sum, p) => sum + p.requiredCapital, 0);

  return (
    <div className="h-full flex flex-col font-sans bg-background text-foreground">
      <header className="h-[64px] px-8 flex items-center justify-between border-b border-border bg-black shrink-0">
        <div className="flex items-center gap-3">
          <div className="font-bold tracking-[-1px] text-[20px] text-foreground">ALPHATRACK</div>
          <div className="bg-success/10 text-success text-[11px] px-[10px] py-1 rounded-full border border-success/20 uppercase tracking-[0.5px]">
            {user.email}
          </div>
          {dbError && (
            <div className="bg-error/10 text-error text-[11px] px-[10px] py-1 rounded-full border border-error/20 uppercase tracking-[0.5px]">
              {dbError}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          {tastyToken && tastyAccounts.length > 1 && (
            <select
              title="Select Brokerage Account"
              className="bg-background border border-border text-foreground px-3 py-2 rounded-md text-[13px] font-semibold cursor-pointer outline-none focus:ring-1 focus:ring-brand-accent/50"
              value={selectedAccountId || ''}
              onChange={(e) => {
                setSelectedAccountId(e.target.value);
                fetchData(tastyToken, e.target.value);
              }}
            >
              {tastyAccounts.map(acc => {
                const id = acc.account?.['account-number'] || acc?.['account-number'];
                const title = acc.account?.['nickname'] || id;
                return (
                  <option key={id} value={id}>
                    {title} ({id})
                  </option>
                );
              })}
            </select>
          )}
          {tastyToken && (
            <button 
              onClick={handleRefresh} 
              disabled={refreshing}
              className="bg-brand-accent/10 border border-brand-accent/20 text-brand-accent hover:bg-brand-accent/20 px-4 py-2 rounded-md text-[13px] font-semibold cursor-pointer disabled:opacity-50 transition-colors"
            >
              {refreshing ? 'Syncing...' : 'Pull Fresh Data'}
            </button>
          )}
          <button 
            onClick={handleLogout}
            className="bg-foreground text-background border-none px-4 py-2 rounded-md text-[13px] font-semibold cursor-pointer transition-opacity hover:opacity-80"
          >
            Sign Out
          </button>
        </div>
      </header>

      {!tastyToken ? (
        <main className="flex-1 flex items-center justify-center p-6">
          <Card className="w-full max-w-md bg-card border-border shadow-2xl">
            <CardHeader className="text-center pb-4">
              <div className="mx-auto w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mb-4 border border-success/20">
                <Database className="w-5 h-5 text-success" />
              </div>
              <CardTitle className="text-2xl font-bold text-foreground">Link Brokerage</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 leading-relaxed">
                Connect your Tastytrade account to instantly sync your transaction history and power your ROI analytics.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
                <DialogTrigger className="w-full bg-success hover:bg-success/90 text-white font-semibold flex items-center justify-center gap-2 rounded-lg py-3 shadow-sm cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-success/50">
                  <KeyRound className="w-5 h-5" />
                  Connect Tastytrade 
                </DialogTrigger>
                <DialogContent className="bg-card border-border sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-foreground flex items-center gap-2">
                      <KeyRound className="w-5 h-5 text-brand-accent" />
                      Authenticate
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                      This app proxies your login directly to the Tastyworks API via a secure backend.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleTastyConnect} className="space-y-4 pt-4">
                    
                    {/* Mode Toggle Button */}
                    <div className="flex justify-end mb-2">
                       <button 
                         type="button" 
                         onClick={() => setIsDeveloperMode(!isDeveloperMode)}
                         className="text-[10px] uppercase font-bold text-brand-accent tracking-wider hover:underline"
                       >
                         {isDeveloperMode ? 'Switch to Username Login' : 'Use Developer App Mode'}
                       </button>
                    </div>

                    {isDeveloperMode ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="clientSecret" className="text-muted-foreground text-xs uppercase tracking-wider">Client Secret</Label>
                          <Input
                            id="clientSecret"
                            required
                            type="password"
                            value={tastyClientSecret}
                            onChange={(e) => setTastyClientSecret(e.target.value)}
                            className="bg-background border-border text-foreground h-11"
                            placeholder="Your Tastytrade Developer Client Secret"
                          />
                        </div>
                        <div className="space-y-2 bg-brand-accent/5 p-4 rounded-lg border border-brand-accent/20">
                          <Label htmlFor="refreshToken" className="text-brand-accent text-xs uppercase tracking-wider font-semibold">Refresh Token</Label>
                          <p className="text-[10px] text-muted-foreground mb-2">
                            Found in the Tastytrade Developer Portal alongside your Client ID.
                          </p>
                          <Input
                            id="refreshToken"
                            required
                            type="password"
                            value={tastyRefreshToken}
                            onChange={(e) => setTastyRefreshToken(e.target.value)}
                            className="bg-background border-brand-accent/30 focus-visible:ring-brand-accent text-foreground h-11"
                            placeholder="Your Refresh Token"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="login" className="text-muted-foreground text-xs uppercase tracking-wider">Username</Label>
                          <Input
                            id="login"
                            required={!isDeveloperMode}
                            value={tastyLogin}
                            onChange={(e) => setTastyLogin(e.target.value)}
                            className="bg-background border-border text-foreground h-11"
                            placeholder="Tastytrade Username or Email"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="pass" className="text-muted-foreground text-xs uppercase tracking-wider">Password</Label>
                          <div className="relative">
                            <Input
                              id="pass"
                              type={showPassword ? "text" : "password"}
                              required={!isDeveloperMode}
                              value={tastyPassword}
                              onChange={(e) => setTastyPassword(e.target.value)}
                              className="bg-background border-border text-foreground h-11 pr-10"
                              placeholder="••••••••"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                        {needsOtp && (
                          <div className="space-y-2 bg-brand-accent/5 p-4 rounded-lg border border-brand-accent/20">
                            <Label htmlFor="otp" className="text-brand-accent text-xs uppercase tracking-wider font-semibold">Device Auth Pin (Check Email)</Label>
                            <Input
                              id="otp"
                              required={!isDeveloperMode}
                              value={tastyOtp}
                              onChange={(e) => setTastyOtp(e.target.value)}
                              className="bg-background border-brand-accent/30 focus-visible:ring-brand-accent text-foreground h-11"
                              placeholder="6-digit PIN"
                            />
                          </div>
                        )}
                      </>
                    )}

                    {connectError && (
                      <div className="text-error text-sm p-3 bg-error/10 border border-error/20 rounded-md">
                        {connectError}
                      </div>
                    )}
                    <Button 
                      type="submit" 
                      disabled={connecting}
                      className="w-full bg-brand-accent hover:bg-brand-accent/90 text-white mt-4 h-11"
                    >
                      {connecting ? 'Authenticating...' : 'Secure Login'}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
              <p className="text-center text-[11px] text-muted-foreground mt-6">
                Protected by strict Firebase Database isolation rules. Only you can view your data.
              </p>
            </CardContent>
          </Card>
        </main>
      ) : (
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 p-6 min-h-0">
        <section className="flex flex-col min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 shrink-0">
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-[11px] uppercase text-muted-foreground tracking-[1px] mb-2">Portfolio Net Liq</div>
              <div className="text-2xl font-semibold font-mono">
                ${portfolioCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-[11px] uppercase text-muted-foreground tracking-[1px] mb-2">Total Trades</div>
              <div className="text-2xl font-semibold font-mono text-brand-accent">{trades.length}</div>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-[11px] uppercase text-muted-foreground tracking-[1px] mb-2">Open Positions</div>
              <div className="text-2xl font-semibold font-mono">{positions.length}</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-[#1c1c1f]">
                  <tr>
                    <th className="bg-[#1c1c1f] p-3 text-[11px] uppercase text-muted-foreground border-b border-border">Symbol</th>
                    <th className="bg-[#1c1c1f] p-3 text-[11px] uppercase text-muted-foreground border-b border-border">Trade Type</th>
                    <th className="bg-[#1c1c1f] p-3 text-[11px] uppercase text-muted-foreground border-b border-border">Status</th>
                    <th className="bg-[#1c1c1f] p-3 text-[11px] uppercase text-muted-foreground border-b border-border">P/L</th>
                    <th className="bg-[#1c1c1f] p-3 text-[11px] uppercase text-muted-foreground border-b border-border">Avg Cap ROI</th>
                    <th className="bg-[#1c1c1f] p-3 text-[11px] uppercase text-muted-foreground border-b border-border">Ann. ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">Loading...</td></tr>
                  ) : trades.map((trade) => {
                    const metrics = calculateROI(trade);
                    return (
                      <tr 
                        key={trade.id} 
                        onClick={() => setActiveTradeId(trade.id)}
                        className={`cursor-pointer transition-colors hover:bg-muted/50 ${activeTradeId === trade.id ? 'bg-muted/30' : ''}`}
                      >
                        <td className="p-3 text-[13px] border-b border-border font-mono font-bold text-brand-accent">{trade.symbol}</td>
                        <td className="p-3 text-[13px] border-b border-border font-mono">{trade.type}</td>
                        <td className="p-3 text-[13px] border-b border-border font-mono">
                          {trade.status === 'Open' ? <span className="text-brand-accent bg-brand-accent/10 px-2 py-0.5 rounded text-[11px]">OPEN</span> : <span className="text-muted-foreground">CLOSED</span>}
                        </td>
                        <td className={`p-3 text-[13px] border-b border-border font-mono ${metrics && metrics.profit >= 0 ? 'text-success' : metrics ? 'text-error' : ''}`}>
                          {metrics ? `${metrics.profit >= 0 ? '+' : ''}$${metrics.profit.toFixed(2)}` : '-'}
                        </td>
                        <td className="p-3 text-[13px] border-b border-border font-mono">
                          {metrics ? `${metrics.avgROI.toFixed(1)}%` : '-'}
                        </td>
                        <td className="p-3 text-[13px] border-b border-border font-mono">
                          {metrics ? `${metrics.annualizedROI.toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-6 overflow-y-auto">
          <div className="bg-card border border-border rounded-xl p-6 flex-1">
            <div className="text-[14px] font-semibold mb-5 pb-3 border-b border-border">Trade ROI Comparison</div>
            
            {activeTrade && activeMetrics ? (
              <>
                <div className="text-[12px] text-muted-foreground mb-2">
                  Active Analysis: <span className="text-foreground">{activeTrade.symbol} ({activeTrade.date})</span>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <div className="bg-[#1c1c1f] p-4 rounded-lg text-center">
                    <div className="text-[20px] font-bold text-success mb-1">{activeMetrics.avgROI.toFixed(1)}%</div>
                    <div className="text-[10px] text-muted-foreground uppercase">Avg Cap ROI</div>
                  </div>
                  <div className="bg-[#1c1c1f] p-4 rounded-lg text-center">
                    <div className="text-[20px] font-bold text-success mb-1">{activeMetrics.peakROI.toFixed(1)}%</div>
                    <div className="text-[10px] text-muted-foreground uppercase">Peak Cap ROI</div>
                  </div>
                </div>

                <div className="mt-8">
                  <div className="text-[12px] font-semibold mb-2 pb-2 border-b border-border">Capital Usage Summary</div>
                  <div className="space-y-3 mt-4 text-[13px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Required Capital:</span>
                      <span>${activeTrade.requiredCapital.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Peak Capital:</span>
                      <span>${activeTrade.peakCapital.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Profit/Loss:</span>
                      <span className={activeMetrics.profit >= 0 ? 'text-success' : 'text-error'}>
                        {activeMetrics.profit >= 0 ? '+' : ''}${activeMetrics.profit.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2">
                      <span className="text-muted-foreground">Days Held:</span>
                      <span>{activeMetrics.daysHeld}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-10 p-4 bg-brand-accent/5 rounded-lg border border-dashed border-brand-accent">
                  <div className="text-[11px] text-brand-accent font-bold mb-1 uppercase">Daily Sync Insight</div>
                  <p className="text-[12px] leading-[1.4] text-muted-foreground">
                    Required capital for <span className="text-foreground">{activeTrade.symbol}</span> was {activeTrade.requiredCapital.toLocaleString()} at open. Peak capital reached was {activeTrade.peakCapital.toLocaleString()} extending the true risk exposure.
                  </p>
                </div>
              </>
            ) : activeTrade && !activeMetrics ? (
               <div className="text-[13px] text-muted-foreground">
                 This trade is currently Open. ROI metrics will be available once closed.
                 <div className="mt-4 font-mono">
                   Required Capital: ${activeTrade.requiredCapital.toFixed(2)}
                 </div>
               </div>
            ) : (
              <div className="text-[13px] text-muted-foreground">Select a closed trade to view detailed analysis.</div>
            )}
          </div>
        </aside>
      </main>
      )}
    </div>
  );
}

