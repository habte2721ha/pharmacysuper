import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, Package, ShoppingCart, FileText, LogOut, Activity, 
  Truck, Users, ClipboardList, Shield, History, ArrowRightLeft, 
  Wifi, WifiOff, Zap, ShieldCheck, Wallet, Leaf, Menu, X, DownloadCloud
} from 'lucide-react';
import { useAppContext } from '../App';
import { UserRole } from '../types';

import { NotificationsPanel } from './NotificationsPanel';

export const AppLayout: React.FC = () => {
  const { user, logout, pharmacyInfo, globalBranch, setGlobalBranch } = useAppContext();
  const location = useLocation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSync, setLastSync] = useState(new Date().toLocaleTimeString());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleOnline = () => {
        setIsOnline(true);
        import('../services/db').then(({ db }) => {
            db.pushAllToServer();
            db.reconcileAll(true);
        }).catch(e => console.error("Sync error on online:", e));
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const syncInterval = setInterval(() => setLastSync(new Date().toLocaleTimeString()), 15000);
    
    const handleBeforeInstallPrompt = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        clearInterval(syncInterval);
    };
  }, []);

  const handleInstallClick = async () => {
      if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
              setDeferredPrompt(null);
          }
      }
  };

  const navItems = [];

  const isAdmin = user?.role === UserRole.ADMIN;
  const perms = user?.permissions || [];

  if (isAdmin || perms.includes('view_reports')) {
    navItems.push({ label: 'Dashboard', path: '/', icon: <LayoutDashboard size={20} /> });
  }

  // Everyone can usually access POS, but let's say sales permission allows it. Or default true for legacy compatibility if perms is missing
  if (isAdmin || !user?.permissions || perms.includes('sales') || user?.role === UserRole.CASHIER) {
    navItems.push({ label: 'POS Terminal', path: '/pos', icon: <ShoppingCart size={20} /> });
    navItems.push({ label: 'Sales History', path: '/history', icon: <History size={20} /> });
  }

  if (isAdmin || perms.includes('manage_stock') || user?.role === UserRole.PHARMACIST) {
    navItems.push({ label: 'Bulk Transfer', path: '/transfer', icon: <Truck size={20} /> });
    navItems.push({ label: 'Inventory', path: '/inventory', icon: <Package size={20} /> });
    navItems.push({ label: 'Bin Cards', path: '/bincards', icon: <ClipboardList size={20} /> });
  }

  if (isAdmin || perms.includes('view_reports') || perms.includes('generate_report')) {
    navItems.push(
      { label: 'Credit Ledger', path: '/suppliers', icon: <Wallet size={20} /> },
      { label: 'Financials', path: '/reports', icon: <FileText size={20} /> },
      { label: 'Expense Registry', path: '/reports#expenses', icon: <ClipboardList size={20} /> }
    );
  }

  if (isAdmin || perms.includes('manage_settings') || perms.includes('manage_users')) {
    navItems.push({ label: 'Admin Panel', path: '/admin', icon: <Shield size={20} /> });
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden font-sans text-slate-800">
      
      {/* Mobile Top Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-teal-900 border-b border-teal-800 text-white z-30 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-50 rounded-lg shadow-sm overflow-hidden flex items-center justify-center p-0.5 border border-teal-100 shrink-0">
            <img 
              src={pharmacyInfo?.logo || "/pharmacy_logo.png"} 
              alt="System Logo" 
              className="w-full h-full object-contain rounded-md"
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-[10px] font-black tracking-tighter truncate uppercase leading-tight text-white max-w-[160px]">
            {pharmacyInfo?.name || 'Advanced Pharmacy Stock'}
          </h1>
        </div>
        <div className="flex items-center gap-3 relative">
          <NotificationsPanel />
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 bg-teal-800 hover:bg-teal-700 rounded-lg transition-colors">
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}

      {/* Sidebar Navigation */}
      <aside className={`fixed inset-y-0 left-0 bg-teal-900 text-white flex flex-col no-print shrink-0 shadow-2xl z-50 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition-transform duration-300 w-64`}>
        <div className="p-6 border-b border-teal-800/50">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-teal-50 rounded-2xl shadow-lg shadow-teal-500/20 overflow-hidden flex items-center justify-center p-0.5 border border-teal-100">
                <img 
                  src={pharmacyInfo?.logo || "/pharmacy_logo.png"} 
                  alt="System Logo" 
                  className="w-full h-full object-contain rounded-xl"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <h1 className="text-xs font-black tracking-tighter truncate uppercase leading-tight text-white">
                  {pharmacyInfo?.name || 'Advanced Pharmacy Stock Management System'}
                </h1>
                <span className="text-[7px] font-black text-teal-400 uppercase tracking-widest leading-none mt-0.5">Clinical Node</span>
              </div>
            </div>
            <button className="md:hidden p-2 text-teal-400 hover:text-white" onClick={() => setIsMobileMenuOpen(false)}><X size={20} /></button>
          </div>

          <div className="p-4 bg-black/20 rounded-2xl border border-white/5 space-y-3">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></div><span className="text-[8px] font-black uppercase tracking-widest text-teal-400">Node Active</span></div>
                {isOnline ? <Wifi size={10} className="text-emerald-400" /> : <WifiOff size={10} className="text-rose-400" />}
             </div>
             <div className="flex items-center gap-2"><Zap size={10} className="text-amber-400 animate-pulse"/><p className="text-[9px] font-bold text-teal-200 uppercase truncate">Last Audit: {lastSync}</p></div>
          </div>

          {user?.role === UserRole.ADMIN && pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
            <div className="mt-4 px-1">
              <label className="text-[8px] font-black uppercase text-teal-400 tracking-widest block mb-1">Active View Context</label>
              <select className="w-full bg-teal-800/80 text-white font-bold text-xs p-3 rounded-xl outline-none appearance-none border-2 border-teal-700 focus:border-teal-400 transition-all shadow-inner" value={globalBranch} onChange={e => setGlobalBranch(e.target.value)}>
                <option value="MAIN">Main Branch (Original Data)</option>
                <option value="">All Branches (Aggregated)</option>
                {pharmacyInfo.branches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          {navItems.map((item) => {
            const isActive = item.path.includes('#') 
                ? location.pathname + location.hash === item.path 
                : location.pathname === item.path && location.hash === '';

            return (
              <Link key={item.path} to={item.path} onClick={() => setIsMobileMenuOpen(false)} className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group ${isActive ? 'bg-teal-600 text-white shadow-xl ring-1 ring-white/10' : 'text-teal-100/60 hover:bg-teal-800 hover:text-white'}`}>
                <span className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>{item.icon}</span>
                <span className="font-black uppercase text-[10px] tracking-widest">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-teal-800/50 bg-black/10">
          {deferredPrompt && (
              <button 
                onClick={handleInstallClick} 
                className="flex items-center gap-3 px-4 py-3 mb-2 w-full text-left bg-teal-500 hover:bg-teal-400 text-white rounded-xl transition-all font-black uppercase text-[10px] tracking-widest shadow-lg active:scale-95"
              >
                  <DownloadCloud size={16} /><span>Install App Offline</span>
              </button>
          )}
          <div className="px-4 py-3 mb-2 flex items-center gap-2 opacity-40"><ShieldCheck size={12} className="text-teal-400"/><span className="text-[8px] font-black uppercase tracking-widest">{user?.role} ACCESS</span></div>
          <button onClick={logout} className="flex items-center gap-3 px-4 py-4 w-full text-left text-rose-300 hover:bg-rose-950/30 hover:text-rose-100 rounded-2xl transition-all font-black uppercase text-[10px] tracking-widest"><LogOut size={20} /><span>Termination</span></button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-4 md:p-8 no-print relative bg-slate-50/50 flex flex-col min-w-0">
        <div className="absolute top-4 right-4 md:top-8 md:right-8 z-50 hidden md:block">
          <NotificationsPanel />
        </div>
        
        <Outlet />
      </main>
    </div>
  );
};

