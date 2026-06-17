import React, { useState, useEffect, createContext, useContext, Suspense, lazy } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { User, PharmacyInfo, UserRole } from './types';
import { db } from './services/db';
import { connectSocket, getSocket } from './services/socket';
import { AppLayout } from './components/AppLayout';
import { Loader2 } from 'lucide-react';

// --- Safe Lazy Loader ---
function safeLazy(importFunc: () => Promise<any>) {
  return lazy(() => 
    importFunc().catch((err) => {
      console.warn("Dynamic import failed. Forced reload initiated to fetch latest assets:", err);
      const lastReload = sessionStorage.getItem('last_asset_reload');
      const now = Date.now();
      if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
        sessionStorage.setItem('last_asset_reload', now.toString());
        window.location.reload();
      }
      return { default: () => null };
    })
  );
}

const Dashboard = safeLazy(() => import('./pages/Dashboard'));
const Inventory = safeLazy(() => import('./pages/Inventory'));
const POS = safeLazy(() => import('./pages/POS'));
const Reports = safeLazy(() => import('./pages/ReportsPage'));
const Suppliers = safeLazy(() => import('./pages/Suppliers'));
const Customers = safeLazy(() => import('./pages/Customers'));
const BinCards = safeLazy(() => import('./pages/BinCards'));
const BulkTransfer = safeLazy(() => import('./pages/BulkTransfer'));
const Setup = safeLazy(() => import('./pages/Setup'));
const Login = safeLazy(() => import('./pages/Login'));
const AdminPanel = safeLazy(() => import('./pages/AdminPanel'));
const SalesHistory = safeLazy(() => import('./pages/SalesHistory'));

// --- Context ---
interface AppContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  pharmacyInfo: PharmacyInfo | null;
  refreshInfo: () => void;
  globalBranch: string;
  setGlobalBranch: (branch: string) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within AppProvider");
  return context;
};

// --- Main App ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [pharmacyInfo, setPharmacyInfo] = useState<PharmacyInfo | null>(null);
  const [globalBranch, setGlobalBranch] = useState<string>('MAIN');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
        // Initialize DB (Offline/Sync)
        await db.initialize();

        // Initialize Socket
        let savedUrl = localStorage.getItem('API_URL');
        if (!savedUrl) {
            if (typeof window !== 'undefined') {
                savedUrl = window.location.origin;
                localStorage.setItem('API_URL', savedUrl);
            } else {
                savedUrl = 'http://localhost:3000';
            }
        }
        connectSocket(savedUrl);

        const storedUser = localStorage.getItem('pharma_user_session');
        if (storedUser) setUser(JSON.parse(storedUser));
        
        try {
            const info = await db.getInfo();
            setPharmacyInfo(info);
        } catch (e) {
            console.error("Failed to fetch info", e);
        }
        setLoading(false);
    };
    init();

    // Listen for local updates from background sync
    const handleLocalUpdate = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail && detail.key === 'pharma_info') {
            db.getInfo().then(setPharmacyInfo);
        }
    };
    window.addEventListener('local-data-update', handleLocalUpdate);
    return () => window.removeEventListener('local-data-update', handleLocalUpdate);
  }, []);

  useEffect(() => {
    if (user?.branch) {
      setGlobalBranch(user.branch);
    }
  }, [user?.branch]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      if (navigator.onLine) {
        try {
          await db.reconcileAll(false);
        } catch (err) {
          console.warn("Background silent-sync bypassed:", err);
        }
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [user]);

  const login = (user: User) => {
    setUser(user);
    if (user.branch) {
        setGlobalBranch(user.branch);
    } else {
        setGlobalBranch('MAIN');
    }
    localStorage.setItem('pharma_user_session', JSON.stringify(user));
    
    const socket = getSocket();
    if (socket) {
        socket.emit('user_login', user);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('pharma_user_session');
  };

  const refreshInfo = async () => {
    const info = await db.getInfo();
    setPharmacyInfo(info);
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading System...</div>;

  return (
    <AppContext.Provider value={{ user, login, logout, pharmacyInfo, refreshInfo, globalBranch, setGlobalBranch }}>
      <Router>
        <AppRoutes />
      </Router>
    </AppContext.Provider>
  );
}

function AppRoutes() {
  const { user, pharmacyInfo } = useAppContext();
  const location = useLocation();

  if (!pharmacyInfo && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  if (pharmacyInfo && location.pathname === '/setup') {
    return <Navigate to="/login" replace />;
  }

  const LoadingFallback = () => (
    <div className="flex h-[calc(100vh-80px)] items-center justify-center">
      <Loader2 className="animate-spin text-teal-600" size={32} />
    </div>
  );

  const isAdmin = user?.role === UserRole.ADMIN;
  const perms = user?.permissions || [];
  
  const canViewReports = isAdmin || perms.includes('view_reports') || perms.includes('generate_report');
  const canManageStock = isAdmin || perms.includes('manage_stock') || user?.role === UserRole.PHARMACIST;
  const canAdmin = isAdmin || perms.includes('manage_settings') || perms.includes('manage_users');

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
        
        {/* Protected Routes */}
        {user ? (
          <Route element={<AppLayout />}>
            <Route path="/" element={isAdmin || canViewReports ? <Dashboard /> : <Navigate to="/pos" />} />
            <Route path="/pos" element={<POS />} />
            
            <Route path="/inventory" element={canManageStock ? <Inventory /> : <Navigate to="/" />} />
            <Route path="/bincards" element={canManageStock ? <BinCards /> : <Navigate to="/" />} />
            <Route path="/transfer" element={canManageStock ? <BulkTransfer /> : <Navigate to="/" />} />
            
            <Route path="/suppliers" element={canViewReports ? <Suppliers /> : <Navigate to="/" />} />
            <Route path="/customers" element={canViewReports ? <Customers /> : <Navigate to="/" />} />
            <Route path="/reports" element={canViewReports ? <Reports /> : <Navigate to="/" />} />
            <Route path="/history" element={<SalesHistory />} />
            <Route path="/admin" element={canAdmin ? <AdminPanel /> : <Navigate to="/" />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" />} />
        )}
      </Routes>
    </Suspense>
  );
}
