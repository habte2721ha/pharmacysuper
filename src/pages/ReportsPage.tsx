import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../services/db';
import { analyzeFinancialPeriod } from '../services/geminiService';
import { useAppContext } from '../App';
import { 
  TrendingUp, ShoppingBag, Coins, 
  Loader2, Activity, Sparkles, PieChart, Calendar, 
  Printer, Calculator, Zap, FileText, 
  Percent, Clock, AlertCircle, Download, Truck, 
  Layers, ChevronRight, BarChart3, Filter,
  ArrowUpRight, Target, Trash2, Box, RefreshCw, 
  Plus, Receipt, Wallet, ArrowDownCircle, AlertTriangle,
  AlertOctagon, Landmark, CheckCircle2, X, Save,
  History as HistoryIcon,
  FileSpreadsheet, Award
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sale, Product, ProductCategory, Supplier, Expense, SupplierTransaction } from '../types';
import * as XLSX from 'xlsx';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';

type ReportTab = 'FISCAL' | 'SUPPLIERS' | 'PROCUREMENT' | 'EXPENSES' | 'LOSS_EXPIRY' | 'AI_AUDIT' | 'PROFIT_EXPENSE' | 'STAFF_PERFORMANCE';

export default function Reports() {
  const { pharmacyInfo, globalBranch, user } = useAppContext();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<ReportTab>('FISCAL');

  useEffect(() => {
    if (location.hash === '#expenses') setActiveTab('EXPENSES');
    else if (location.hash === '#fiscal') setActiveTab('FISCAL');
    else if (location.hash === '#suppliers') setActiveTab('SUPPLIERS');
    else if (location.hash === '#procurement') setActiveTab('PROCUREMENT');
    else if (location.hash === '#loss') setActiveTab('LOSS_EXPIRY');
    else if (location.hash === '#ai') setActiveTab('AI_AUDIT');
    else if (location.hash === '#profit-and-expense') setActiveTab('PROFIT_EXPENSE');
    else if (location.hash === '#staff-performance') setActiveTab('STAFF_PERFORMANCE');
  }, [location.hash]);
  const [loading, setLoading] = useState(true);
  
  // GLOBAL FILTERS
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ProductCategory.MEDICINE | ProductCategory.COSMETIC>('ALL');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [userFilter, setUserFilter] = useState('ALL');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('ALL');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // RAW DATA
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  
  // UI & AI STATE
  const [aiReport, setAiReport] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [newExpense, setNewExpense] = useState({ amount: 0, category: 'Utilities', description: '', date: new Date().toISOString().split('T')[0], branch: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, sup, exp, tx] = await Promise.all([
        db.getSales(), db.getProducts(), db.getSuppliers(), db.getExpenses(), db.getSupplierTransactions()
      ]);
      const salesArr = Array.isArray(s) ? s : [];
      const productsArr = Array.isArray(p) ? p : [];
      const suppliersArr = Array.isArray(sup) ? sup : [];
      const expensesArr = (Array.isArray(exp) ? exp : []).map((e: any) => ({
        ...e,
        amount: typeof e.amount === 'number' && !isNaN(e.amount) ? e.amount : (parseFloat(e.amount as any) || 0)
      }));

      const matchesBranch = (itemBranch?: string) => {
        if (user?.role === 'ADMIN') {
            const activeFilter = branchFilter && branchFilter !== 'ALL' ? branchFilter : globalBranch;
            if (activeFilter) {
                if (activeFilter === 'MAIN') return !itemBranch;
                return itemBranch === activeFilter;
            }
            return true;
        }
        return !itemBranch || itemBranch === user?.branch;
      };

      setSales(salesArr.filter(s => matchesBranch(s.branch)));
      setProducts(productsArr.filter((item: any) => !item.isDeleted && matchesBranch(item.branch)));
      setSuppliers(suppliersArr.filter((x: Supplier) => !x.isDeleted));
      setExpenses(expensesArr.filter((e: Expense) => !e.isDeleted && matchesBranch(e.branch)));
      setTransactions(tx || []); // transactions can be global mapped to suppliers, skipping branch filter over here
    } finally { setLoading(false); }
  }, [globalBranch, user, branchFilter]);

  useEffect(() => {
    loadData();
    const handleUpdate = (e: any) => { if (e.detail?.key) loadData(); };
    window.addEventListener('local-data-update', handleUpdate);
    return () => window.removeEventListener('local-data-update', handleUpdate);
  }, [loadData]);

  // --- BUSINESS INTELLIGENCE ENGINE ---
  
  const uniqueSellers = useMemo(() => Array.from(new Set(sales.map(s => s.soldBy).filter(Boolean))), [sales]);

  const analytics = useMemo(() => {
    const start = new Date(startDate); start.setHours(0,0,0,0);
    const end = new Date(endDate); end.setHours(23,59,59,999);

    // 1. Filter Sales by Date, Category, and Supplier
    const fSales = sales.filter(s => {
        const d = new Date(s.date);
        const matchesUser = userFilter === 'ALL' || s.soldBy === userFilter;
        const matchesPayment = paymentMethodFilter === 'ALL' || s.paymentMethods?.some(pm => pm.method === paymentMethodFilter);
        return d >= start && d <= end && s.status !== 'VOIDED' && matchesUser && matchesPayment;
    });

    // 2. Fiscal Analysis
    let totalRevenue = 0;
    let totalCogs = 0;
    const itemPerformance = new Map<string, { name: string; qty: number; rev: number; category: string }>();
    const staffPerformance = new Map<string, { username: string; totalSales: number; totalItems: number; totalRevenue: number; totalCogs: number }>();

    fSales.forEach((sale: any) => {
        const seller = sale.soldBy || 'Unknown';
        const staffRec = staffPerformance.get(seller) || { username: seller, totalSales: 0, totalItems: 0, totalRevenue: 0, totalCogs: 0 };
        
        let saleRev = 0;
        let saleCogs = 0;
        let saleItems = 0;

        sale.items.forEach((item: any) => {
            const matchesCat = categoryFilter === 'ALL' || item.type === categoryFilter;
            const matchesSup = supplierFilter === 'ALL' || item.supplier === supplierFilter;
            
            if (matchesCat && matchesSup) {
                const rev = (item.sellingPrice * item.cartQty) - (item.discount || 0);
                const cogs = (item.buyingPrice * item.cartQty);
                saleRev += rev;
                saleCogs += cogs;
                saleItems += item.cartQty;

                totalRevenue += rev;
                totalCogs += cogs;

                const existing = itemPerformance.get(item.id) || { name: item.name, qty: 0, rev: 0, category: item.type };
                existing.qty += item.cartQty;
                existing.rev += rev;
                itemPerformance.set(item.id, existing);
            }
        });
        
        if (saleItems > 0) {
            staffRec.totalSales += 1;
            staffRec.totalItems += saleItems;
            staffRec.totalRevenue += saleRev;
            staffRec.totalCogs += saleCogs;
            staffPerformance.set(seller, staffRec);
        }
    });

    const grossProfit = totalRevenue - totalCogs;
    const fExpenses = expenses.filter(e => {
        const d = new Date(e.date);
        return d >= start && d <= end;
    });
    const totalExpenses = fExpenses.reduce((s, x) => s + x.amount, 0);
    const netProfit = grossProfit - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    // 3. Stock Valuation (at Cost vs Retail)
    const fProducts = products.filter(p => {
        const matchCat = categoryFilter === 'ALL' || p.type === categoryFilter;
        const matchSup = supplierFilter === 'ALL' || p.supplier === supplierFilter;
        return matchCat && matchSup;
    });
    const valuationCost = fProducts.reduce((s, x) => s + (x.buyingPrice * x.quantity), 0);
    const valuationRetail = fProducts.reduce((s, x) => s + (x.sellingPrice * x.quantity), 0);

    // 4. Procurement Planner (Auto Purchase Orders)
    const poRequests = fProducts
        .filter(p => p.quantity <= p.minStockLevel)
        .map(p => ({
            ...p,
            suggestedOrder: Math.max(50, (p.minStockLevel * 2) - p.quantity)
        }));

    // 5. Expiry & Loss Analysis
    const today = new Date();
    const expiredStock = fProducts.filter(p => new Date(p.expiryDate) < today && p.quantity > 0);
    const nearExpiryStock = fProducts.filter(p => {
        const diff = (new Date(p.expiryDate).getTime() - today.getTime()) / (1000 * 3600 * 24);
        return diff >= 0 && diff <= 90 && p.quantity > 0;
    });
    const expiredLossValue = expiredStock.reduce((s, x) => s + (x.buyingPrice * x.quantity), 0);

    // 6. Supplier Ledger Analysis
    const supplierLedgers = suppliers.map(s => {
        const sTx = transactions.filter(t => t.supplierId === s.id);
        const balance = sTx.reduce((sum, t) => t.type === 'PURCHASE_CREDIT' ? sum + t.amount : sum - t.amount, 0);
        const totalSpent = sTx.filter(t => t.type === 'PURCHASE_CREDIT').reduce((sum, t) => sum + t.amount, 0);
        // Find items associated with this supplier
        const itemsSourced = Array.from(new Set(products.filter(p => p.supplier === s.name).map(p => p.name)));
        return { ...s, balance, totalSpent, itemsSourced, txCount: sTx.length };
    }).filter(s => supplierFilter === 'ALL' || s.name === supplierFilter);

    // 7. Daily Payment Summary
    const summaryMap: Record<string, { count: number, amount: number }> = {};
    fSales.forEach(s => {
        const dObj = new Date(s.date);
        const dayStr = dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (!summaryMap[dayStr]) summaryMap[dayStr] = { count: 0, amount: 0 };
        summaryMap[dayStr].count += 1;
        let amt = s.grandTotal;
        if (paymentMethodFilter !== 'ALL') {
            const matched = s.paymentMethods?.find(pm => pm.method === paymentMethodFilter);
            amt = matched ? matched.amount : 0;
        }
        summaryMap[dayStr].amount += amt;
    });
    const dailyPaymentSummary = Object.entries(summaryMap)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // 8. Profit & Expense Trend Analysis (Daily Breakdown)
    const trendMap: Record<string, { date: string, rawDate: Date, revenue: number, cogs: number, expenses: number, profit: number }> = {};
    
    let currentD = new Date(start);
    while (currentD <= end) {
        const dStr = currentD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        trendMap[dStr] = { date: dStr, rawDate: new Date(currentD), revenue: 0, cogs: 0, expenses: 0, profit: 0 };
        currentD.setDate(currentD.getDate() + 1);
    }
    
    fSales.forEach(s => {
        const dStr = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (trendMap[dStr]) {
            let saleRev = 0;
            let saleCogs = 0;
            s.items.forEach((item: any) => {
                saleRev += (item.sellingPrice * item.cartQty) - (item.discount || 0);
                saleCogs += (item.buyingPrice * item.cartQty);
            });
            trendMap[dStr].revenue += saleRev;
            trendMap[dStr].cogs += saleCogs;
        }
    });

    fExpenses.forEach(e => {
        const dStr = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (trendMap[dStr]) {
            trendMap[dStr].expenses += e.amount;
        }
    });

    const profitTrendData = Object.values(trendMap).sort((a,b) => a.rawDate.getTime() - b.rawDate.getTime()).map(day => {
        day.profit = day.revenue - day.cogs - day.expenses;
        return day;
    });

    const staffPerformanceList = Array.from(staffPerformance.values())
        .map(s => ({ ...s, netProfit: s.totalRevenue - s.totalCogs }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue); // Sort by total revenue descending

    return {
        totalRevenue, totalCogs, grossProfit, totalExpenses, netProfit, profitMargin,
        valuationCost, valuationRetail, poRequests, expiredStock, nearExpiryStock, expiredLossValue,
        supplierLedgers, fExpenses, fProducts, fSales, dailyPaymentSummary, profitTrendData,
        staffPerformanceList,
        topItems: Array.from(itemPerformance.values()).sort((a,b) => b.rev - a.rev).slice(0, 15)
    };
  }, [sales, products, suppliers, expenses, transactions, startDate, endDate, categoryFilter, supplierFilter, userFilter, paymentMethodFilter]);

  const downloadExcel = (data: any[][], filename: string) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    
    // Generate buffer
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportFiscal = () => {
    const data = [
        ['Metric', 'Value'],
        ['Total Revenue', analytics.totalRevenue],
        ['Total COGS', analytics.totalCogs],
        ['Gross Profit', analytics.grossProfit],
        ['Total Expenses', analytics.totalExpenses],
        ['Net Profit', analytics.netProfit],
        ['Profit Margin %', analytics.profitMargin.toFixed(2)],
        [],
        ['Top Performing Items'],
        ['Item Name', 'Quantity Sold', 'Revenue Yield'],
        ...analytics.topItems.map(i => [i.name, i.qty, i.rev])
    ];
    downloadExcel(data, `Fiscal_Report_${startDate}.xlsx`);
  };

  const exportSuppliers = () => {
    const data = [
        ['Supplier Name', 'Net Liability', 'Total Spent', 'Transaction Records'],
        ...analytics.supplierLedgers.map(s => [s.name, s.balance, s.totalSpent, s.txCount])
    ];
    downloadExcel(data, `Supplier_Ledger_${startDate}.xlsx`);
  };

  const exportProcurement = () => {
    const data = [
        ['Item Name', 'Vendor', 'Current Stock', 'Min Level', 'Suggested Re-Order'],
        ...analytics.poRequests.map(p => [p.name, p.supplier, p.quantity, p.minStockLevel, p.suggestedOrder])
    ];
    downloadExcel(data, `Purchase_Order_Requests_${startDate}.xlsx`);
  };

  const exportExpenses = () => {
    const data = [
        ['Date', 'Category', 'Description', 'Amount'],
        ...analytics.fExpenses.map(e => [e.date, e.category, e.description, e.amount])
    ];
    downloadExcel(data, `Expense_Ledger_${startDate}.xlsx`);
  };

  const exportLossForensic = () => {
    const data = [
        ['Type', 'Item Name', 'Batch', 'Quantity', 'Loss Value'],
        ...analytics.expiredStock.map(p => ['EXPIRED', p.name, p.batchNumber, p.quantity, p.buyingPrice * p.quantity]),
        ...analytics.nearExpiryStock.map(p => ['RISK (90d)', p.name, p.batchNumber, p.quantity, p.buyingPrice * p.quantity])
    ];
    downloadExcel(data, `Loss_Forensic_Audit_${startDate}.xlsx`);
  };

  const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);

  const handleAiAudit = async () => {
    if (!pharmacyInfo) return;
    setIsAiLoading(true);
    try {
        const report = await analyzeFinancialPeriod(sales, products, `${startDate} to ${endDate}`, pharmacyInfo);
        setAiReport(report);
    } finally { setIsAiLoading(false); }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalAmount = Number(newExpense.amount) || 0;
    if (finalAmount <= 0) {
      alert("Please enter a valid expense amount greater than 0.");
      return;
    }
    await db.addExpense({ 
      id: generateId(), 
      ...newExpense, 
      amount: finalAmount,
      branch: newExpense.branch || (globalBranch === 'MAIN' ? undefined : globalBranch) || user?.branch || undefined 
    });
    setNewExpense({ amount: 0, category: 'Utilities', description: '', date: new Date().toISOString().split('T')[0], branch: '' });
    setShowExpenseModal(false);
    loadData();
  };

  const navigate = useNavigate();

  const TabButton = ({ id, label, icon }: { id: ReportTab, label: string, icon: React.ReactNode }) => {
    const hash = id === 'LOSS_EXPIRY' ? 'loss' : id === 'AI_AUDIT' ? 'ai' : id === 'PROFIT_EXPENSE' ? 'profit-and-expense' : id === 'STAFF_PERFORMANCE' ? 'staff-performance' : id.toLowerCase();
    return (
    <button 
      onClick={() => {
          setActiveTab(id);
          navigate(`#${hash}`);
      }}
      className={`flex items-center gap-3 px-8 py-5 font-black uppercase text-[10px] tracking-widest transition-all border-b-4 ${
        activeTab === id ? 'border-teal-600 text-teal-800 bg-teal-50' : 'border-transparent text-slate-400 hover:bg-slate-50'
      }`}
    >
      {icon} {label}
    </button>
  );
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* STICKY FILTER BAR */}
      <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-2xl border border-slate-100 p-6 rounded-[2.5rem] shadow-xl flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
            <div className="p-3 bg-teal-900 text-white rounded-2xl"><Filter size={20}/></div>
            <div><h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Intelligence Filters</h2><p className="text-[8px] font-bold text-slate-400 uppercase">Synchronized Clinical Period Audit</p></div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
            {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
                <select className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500" value={branchFilter} onChange={e => setBranchFilter(e.target.value)}>
                    <option value="ALL">All Branches (Aggregated)</option>
                    <option value="MAIN">Main Branch (Original Data)</option>
                    {pharmacyInfo.branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
            )}

            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                {(['ALL', ProductCategory.MEDICINE, ProductCategory.COSMETIC] as const).map(cat => (
                    <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${categoryFilter === cat ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-400'}`}>{cat}</button>
                ))}
            </div>

            <select className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-700 outline-none focus:ring-2 focus:ring-teal-500" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                <option value="ALL">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>

            <select className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" value={userFilter} onChange={e => setUserFilter(e.target.value)}>
                <option value="ALL">All Users</option>
                {uniqueSellers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>

            <select className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" value={paymentMethodFilter} onChange={e => setPaymentMethodFilter(e.target.value)}>
                <option value="ALL">All Payment Methods</option>
                <option value="CASH">CASH</option>
                <option value="CBE">CBE</option>
                <option value="BOA">BOA</option>
                <option value="AWASH">AWASH</option>
                <option value="DASHEN">DASHEN</option>
                <option value="TELEBIRR">TELEBIRR</option>
                <option value="CREDIT">CREDIT</option>
                <option value="CARD">CARD</option>
                <option value="OTHER">OTHER</option>
            </select>

            <div className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200">
                <Calendar size={14} className="text-teal-600"/>
                <input type="date" className="bg-transparent text-[10px] font-black uppercase text-slate-700 outline-none" value={startDate} onChange={e => setStartDate(e.target.value)}/>
                <span className="text-slate-300 font-bold px-1">TO</span>
                <input type="date" className="bg-transparent text-[10px] font-black uppercase text-slate-700 outline-none" value={endDate} onChange={e => setEndDate(e.target.value)}/>
            </div>

            <button onClick={() => window.print()} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-black transition-all shadow-lg active:scale-95"><Printer size={18}/></button>
        </div>
      </div>

      {/* CORE KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-teal-900 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:rotate-12 transition-transform duration-500"><Coins size={100}/></div>
              <p className="text-[10px] font-black uppercase text-teal-400 tracking-widest mb-4">Net Yield (Filtered)</p>
              <h3 className="text-4xl font-black font-mono tracking-tighter">{analytics.netProfit.toLocaleString()}</h3>
              <p className="text-[8px] font-bold text-teal-500 uppercase mt-8 border-l-2 border-teal-500 pl-4">Profit after COGS and Expenses.</p>
          </div>
          <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col justify-center">
              <div className="flex justify-between items-center mb-2"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Gross Revenue</p><TrendingUp className="text-teal-500" size={16}/></div>
              <h3 className="text-3xl font-black text-slate-800 font-mono tracking-tighter">{analytics.totalRevenue.toLocaleString()}</h3>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-4">Profit Margin: <span className="text-teal-600 font-black">{analytics.profitMargin.toFixed(1)}%</span></p>
          </div>
          <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col justify-center">
              <div className="flex justify-between items-center mb-2"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Stock Capital (at Cost)</p><Box className="text-indigo-500" size={16}/></div>
              <h3 className="text-3xl font-black text-slate-800 font-mono tracking-tighter">{analytics.valuationCost.toLocaleString()}</h3>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-4">Estimated Sale Value: <span className="text-indigo-600 font-black">{analytics.valuationRetail.toLocaleString()}</span></p>
          </div>
          <div className="bg-rose-50 p-8 rounded-[3rem] border border-rose-100 text-rose-800">
              <div className="flex justify-between items-center mb-2"><p className="text-[10px] font-black uppercase tracking-widest opacity-60">Loss Exposure</p><AlertOctagon className="text-rose-600" size={16}/></div>
              <h3 className="text-3xl font-black font-mono tracking-tighter">{analytics.expiredLossValue.toLocaleString()}</h3>
              <p className="text-[8px] font-bold uppercase mt-4">{analytics.expiredStock.length} Wasted Batches identified.</p>
          </div>
      </div>

      {/* MODULE TABS */}
      <div className="bg-white rounded-[4rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col min-h-[700px]">
        <div className="flex overflow-x-auto no-scrollbar border-b bg-slate-50/30">
            <TabButton id="FISCAL" label="Fiscal Audit" icon={<Calculator size={18}/>}/>
            <TabButton id="PROFIT_EXPENSE" label="Profit Analysis" icon={<BarChart3 size={18}/>}/>
            <TabButton id="SUPPLIERS" label="Supplier Ledger" icon={<Truck size={18}/>}/>
            <TabButton id="PROCUREMENT" label="Purchase Requests" icon={<Target size={18}/>}/>
            <TabButton id="LOSS_EXPIRY" label="Loss Forensic" icon={<Clock size={18}/>}/>
            <TabButton id="EXPENSES" label="Expense Registry" icon={<Receipt size={18}/>}/>
            <TabButton id="STAFF_PERFORMANCE" label="Top Sellers" icon={<Award size={18}/>}/>
            <TabButton id="AI_AUDIT" label="Cognitive Analysis" icon={<Sparkles size={18}/>}/>
        </div>

        <div className="p-10 flex-1">
            {loading ? <div className="flex flex-col items-center justify-center h-full py-40 opacity-20"><Loader2 className="animate-spin" size={48}/><p className="font-black uppercase tracking-[0.5em] text-xs">Syncing Registry...</p></div> : (
              <div className="animate-in slide-in-from-bottom-4 duration-500">
                
                {/* FISCAL AUDIT TAB */}
                {activeTab === 'FISCAL' && (
                  <div className="space-y-12">
                     <div className="flex justify-between items-center px-4">
                        <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3"><Calculator className="text-indigo-600"/> High Density Yield Analysis</h4>
                        <button onClick={exportFiscal} className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95"><FileSpreadsheet size={16}/> Export Excel</button>
                     </div>
                     <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                        <div className="bg-slate-50 p-8 rounded-[3rem] border border-slate-100">
                            <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 mb-8 flex items-center gap-3"><ArrowUpRight className="text-teal-600"/> Itemized Performance</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">
                                        <tr><th className="pb-4">Stock Identity</th><th className="pb-4 text-right">Units</th><th className="pb-4 text-right pr-4">Revenue</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-bold text-[11px] uppercase">
                                        {analytics.topItems.map((p, idx) => (
                                            <tr key={idx} className="hover:bg-white transition-colors"><td className="py-4 text-slate-800">{p.name}</td><td className="py-4 text-right text-slate-400">{p.qty} sold</td><td className="py-4 text-right text-teal-700 pr-4">{p.rev.toFixed(2)}</td></tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="bg-slate-50 p-8 rounded-[3rem] border border-slate-100">
                            <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 mb-8 flex items-center gap-3"><Landmark className="text-indigo-600"/> Cash Flow Reconciler</h4>
                            <div className="space-y-6">
                                <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm flex justify-between items-center"><p className="font-black text-xs uppercase text-slate-500">Gross Sales Intake</p><p className="text-2xl font-black font-mono text-slate-800">{analytics.totalRevenue.toLocaleString()}</p></div>
                                <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm flex justify-between items-center"><p className="font-black text-xs uppercase text-slate-500">Inventory Burden (COGS)</p><p className="text-2xl font-black font-mono text-rose-600">-{analytics.totalCogs.toLocaleString()}</p></div>
                                <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm flex justify-between items-center"><p className="font-black text-xs uppercase text-slate-500">Operational Overhead</p><p className="text-2xl font-black font-mono text-rose-600">-{analytics.totalExpenses.toLocaleString()}</p></div>
                                <div className="p-8 bg-teal-900 rounded-[2rem] text-white shadow-xl flex justify-between items-center">
                                    <div><p className="text-[8px] font-black uppercase tracking-widest text-teal-400">Net Business Yield</p><h3 className="text-3xl font-black font-mono tracking-tighter">{analytics.netProfit.toLocaleString()}</h3></div>
                                    <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-md"><Zap size={24} className="text-teal-400 animate-pulse"/></div>
                                </div>
                            </div>
                        </div>
                     </div>

                     {/* DETAILED PAYMENT METHOD TRANSACTION LEDGER */}
                     <div className="bg-slate-50 p-8 rounded-[3rem] border border-slate-100 mt-10">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                              <div>
                                  <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                      <Receipt size={14} className="text-teal-600"/> 
                                      {paymentMethodFilter === 'ALL' ? 'All Payment Transactions' : `${paymentMethodFilter} Ledger`}
                                  </h4>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">
                                      {paymentMethodFilter === 'ALL' 
                                          ? 'Complete history of all sales transactions and checkout sessions' 
                                          : `All historical payments processed via ${paymentMethodFilter}`}
                                  </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-3">
                                  <span className="px-3 py-1.5 bg-teal-100/60 text-teal-800 rounded-xl text-[9px] font-black uppercase tracking-widest">
                                      {analytics.fSales.length} Transactions
                                  </span>
                                  <span className="px-3 py-1.5 bg-indigo-100/60 text-indigo-800 rounded-xl text-[9px] font-black uppercase tracking-widest">
                                      Filtered Volume: 
                                      {analytics.fSales.reduce((sum, s) => {
                                          if (paymentMethodFilter === 'ALL') {
                                              return sum + s.grandTotal;
                                          } else {
                                              const matchingPM = s.paymentMethods?.find(pm => pm.method === paymentMethodFilter);
                                              return sum + (matchingPM ? matchingPM.amount : 0);
                                          }
                                      }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  <button
                                      onClick={() => {
                                          const csvHeader = ['Receipt #', 'Date & Time', 'Cashier', 'Customer Name', 'Payment Method', 'Reference', 'Amount'];
                                          const csvBody = analytics.fSales.map(s => {
                                              const pm = paymentMethodFilter === 'ALL' 
                                                  ? s.paymentMethods?.map(p => p.method).join(' + ')
                                                  : paymentMethodFilter;
                                              const ref = paymentMethodFilter === 'ALL'
                                                  ? s.paymentMethods?.map(p => p.reference || 'N/A').join(' | ')
                                                  : s.paymentMethods?.find(p => p.method === paymentMethodFilter)?.reference || 'N/A';
                                              const amt = paymentMethodFilter === 'ALL'
                                                  ? s.grandTotal
                                                  : s.paymentMethods?.find(p => p.method === paymentMethodFilter)?.amount || 0;
                                              
                                              return [
                                                  s.receiptNumber,
                                                  s.date,
                                                  s.soldBy,
                                                  s.customerName || 'Walk-In',
                                                  pm,
                                                  ref,
                                                  amt
                                              ];
                                          });
                                          downloadExcel([csvHeader, ...csvBody], `Payment_Ledger_${paymentMethodFilter}_${startDate}.xlsx`);
                                      }}
                                      className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 text-white rounded-xl font-black uppercase text-[8px] tracking-widest hover:bg-emerald-700 transition-all shadow-md"
                                  >
                                      Export Transactions
                                  </button>
                              </div>
                          </div>

                          {/* Daily Sales Summary */}
                          {paymentMethodFilter !== 'ALL' && analytics.dailyPaymentSummary.length > 0 && (
                              <div className="mb-6">
                                  <div className="flex items-center justify-between mb-2">
                                      <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daily Summary</h5>
                                      <button 
                                          onClick={() => {
                                              const csvHeader = ['Date', 'Transaction Count', 'Amount'];
                                              const csvBody = analytics.dailyPaymentSummary.map(d => [d.date, d.count, d.amount.toFixed(2)]);
                                              downloadExcel([csvHeader, ...csvBody], `Daily_Summary_${paymentMethodFilter}_${startDate}.xlsx`);
                                          }}
                                          className="text-[9px] font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                                      >
                                          <FileSpreadsheet size={12} /> Export Daily Summary
                                      </button>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                                      {analytics.dailyPaymentSummary.map((dayLine, idx) => (
                                          <div key={idx} className="bg-white p-3 rounded-xl border border-slate-100 flex flex-col items-center justify-center text-center shadow-sm">
                                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{dayLine.date}</p>
                                              <p className="text-sm font-black text-slate-800 font-mono my-0.5">{dayLine.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                              <p className="text-[8px] font-black text-teal-600 uppercase tracking-wider">{dayLine.count} Trans</p>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          )}

                          <div className="overflow-x-auto max-h-[450px] no-scrollbar">
                              <table className="w-full text-left text-sm relative">
                                  <thead className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200 bg-slate-50/90 backdrop-blur-sm sticky top-0 z-10">
                                      <tr>
                                          <th className="pb-4 pl-4 pt-2">Receipt #</th>
                                          <th className="pb-4 pt-2">Date & Time</th>
                                          <th className="pb-4 pt-2">Cashier</th>
                                          <th className="pb-4 pt-2">Customer Details</th>
                                          <th className="pb-4 pt-2 text-center">Payment Methods / Ref</th>
                                          <th className="pb-4 pt-2 text-right pr-4">Processed Amount</th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 font-bold text-[11px] uppercase">
                                      {analytics.fSales.map((sale) => {
                                          const matchedPM = sale.paymentMethods?.find(pm => pm.method === paymentMethodFilter);
                                          const displayAmount = paymentMethodFilter === 'ALL' 
                                              ? sale.grandTotal 
                                              : (matchedPM?.amount ?? sale.grandTotal);
                                          
                                          let formattedDateStr = sale.date;
                                          try {
                                              const d = new Date(sale.date);
                                              formattedDateStr = d.toLocaleString('en-US', {
                                                  month: 'short',
                                                  day: 'numeric',
                                                  year: 'numeric',
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                                  hourCycle: 'h23'
                                              });
                                          } catch (_) {}

                                          return (
                                              <tr key={sale.id} className="hover:bg-white transition-colors">
                                                  <td className="py-4 pl-4 text-indigo-600 font-mono">
                                                      {sale.receiptNumber}
                                                  </td>
                                                  <td className="py-4 text-slate-500 font-mono tracking-tighter">
                                                      {formattedDateStr}
                                                  </td>
                                                  <td className="py-4 text-slate-600">
                                                      {sale.soldBy || 'System'}
                                                  </td>
                                                  <td className="py-4 text-slate-700">
                                                      <div className="flex flex-col">
                                                          <span className="font-semibold text-slate-800">{sale.customerName || 'Walk-In Customer'}</span>
                                                          {sale.customerPhone && <span className="text-[8px] text-slate-400 font-mono">{sale.customerPhone}</span>}
                                                      </div>
                                                  </td>
                                                  <td className="py-4 text-center">
                                                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                                          {sale.paymentMethods?.map((pm, pmIdx) => {
                                                              const isFilterMatch = pm.method === paymentMethodFilter;
                                                              return (
                                                                  <span 
                                                                      key={pmIdx} 
                                                                      className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase border flex items-center gap-1 ${
                                                                          isFilterMatch 
                                                                              ? 'bg-teal-600 border-teal-600 text-white shadow-sm' 
                                                                              : 'bg-white text-slate-400 border-slate-200'
                                                                      }`}
                                                                  >
                                                                      {pm.method}: {pm.amount.toFixed(2)}
                                                                      {pm.reference && (
                                                                          <span className={`text-[7px] font-bold font-mono border-l pl-1 ml-1 ${
                                                                              isFilterMatch ? 'border-teal-500 text-teal-100' : 'border-slate-200 text-slate-400'
                                                                          }`}>
                                                                              REF: {pm.reference}
                                                                          </span>
                                                                      )}
                                                                  </span>
                                                              );
                                                          })}
                                                      </div>
                                                  </td>
                                                  <td className="py-4 text-right pr-4 text-teal-800 font-mono font-black text-xs"> {displayAmount.toFixed(2)}
                                                  </td>
                                              </tr>
                                          );
                                      })}
                                      {analytics.fSales.length === 0 && (
                                          <tr>
                                              <td colSpan={6} className="py-20 text-center text-slate-400 font-black tracking-widest text-[9px]">
                                                  No matching transactions found for this date range & payment method filter
                                              </td>
                                          </tr>
                                      )}
                                  </tbody>
                              </table>
                          </div>
                      </div>
                  </div>
                )}

                {/* SUPPLIER LEDGER TAB */}
                {activeTab === 'SUPPLIERS' && (
                  <div className="space-y-10">
                     <div className="flex justify-between items-center px-4">
                        <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3"><Truck className="text-teal-600"/> Vendor Credit Registry</h4>
                        <button onClick={exportSuppliers} className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95"><FileSpreadsheet size={16}/> Export Ledger</button>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {analytics.supplierLedgers.map(s => (
                            <div key={s.id} className="bg-slate-50 p-8 rounded-[3rem] border border-slate-100 hover:bg-white hover:shadow-xl transition-all group">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="p-3 bg-white rounded-2xl shadow-sm"><Truck size={20} className="text-teal-600"/></div>
                                    <span className={`text-[8px] font-black uppercase px-3 py-1 rounded-lg ${s.balance > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{s.balance > 0 ? 'Debt Node' : 'Cleared'}</span>
                                </div>
                                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-4 truncate">{s.name}</h3>
                                <div className="space-y-2 mb-6">
                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Supply Mix Analysis</p>
                                    <div className="flex flex-wrap gap-2">
                                        {s.itemsSourced.slice(0, 5).map((it, idx) => (
                                            <span key={idx} className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[9px] font-bold text-slate-500 uppercase">{it}</span>
                                        ))}
                                        {s.itemsSourced.length > 5 && <span className="text-[9px] font-black text-teal-600">+{s.itemsSourced.length - 5} More</span>}
                                    </div>
                                </div>
                                <div className="bg-white p-6 rounded-2xl border border-slate-100 flex justify-between items-center shadow-inner">
                                    <div><p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Fiscal Liability</p><p className="font-black text-2xl font-mono text-rose-600">{s.balance.toLocaleString()}</p></div>
                                    <div className="text-right"><p className="text-[8px] font-bold text-slate-400 uppercase mb-1">TX Registry</p><p className="font-black text-sm text-slate-600">{s.txCount} Records</p></div>
                                </div>
                            </div>
                        ))}
                     </div>
                  </div>
                )}

                {/* PURCHASE REQUESTS TAB */}
                {activeTab === 'PROCUREMENT' && (
                  <div className="space-y-8">
                     <div className="bg-indigo-900 p-10 rounded-[3.5rem] text-white flex justify-between items-center shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5"><Target size={200}/></div>
                        <div className="relative z-10">
                            <h3 className="text-3xl font-black uppercase tracking-tighter italic mb-2">Automated Procurement Orders</h3>
                            <p className="text-indigo-200 text-sm max-w-xl">Intelligent stock thresholds detected depletion. Suggested quantities calculated using Safety Stock multipliers.</p>
                        </div>
                        <div className="flex gap-4">
                            <button onClick={exportProcurement} className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl flex items-center gap-3 hover:bg-emerald-700 transition-all"><FileSpreadsheet size={18}/> Export Excel</button>
                            <button onClick={() => window.print()} className="px-8 py-4 bg-white text-indigo-900 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl flex items-center gap-3 hover:bg-indigo-50 transition-all"><FileText size={18}/> Print PO List</button>
                        </div>
                     </div>

                     <div className="grid grid-cols-1 gap-4">
                         {analytics.poRequests.map(p => (
                             <div key={p.id} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between hover:border-teal-500 transition-all group">
                                 <div className="flex items-center gap-6">
                                     <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl"><AlertTriangle size={20}/></div>
                                     <div>
                                         <h4 className="font-black text-sm uppercase text-slate-800 tracking-tight">{p.name}</h4>
                                         <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Vendor: {p.supplier} • Classification: {p.type === ProductCategory.COSMETIC ? 'Cosmetic' : p.medCategory || 'General'}</p>
                                     </div>
                                 </div>
                                 <div className="flex items-center gap-12 text-right">
                                     <div><p className="text-[8px] font-bold text-slate-400 uppercase mb-1">On Hand</p><p className="font-black text-rose-600 text-lg">{p.quantity}</p></div>
                                     <div className="bg-teal-50 px-6 py-3 rounded-2xl border border-teal-100 group-hover:bg-teal-600 group-hover:text-white transition-all">
                                         <p className="text-[8px] font-black uppercase text-teal-600 group-hover:text-white/80 mb-1">Target Re-Order</p>
                                         <p className="font-black text-xl tracking-tighter">+{p.suggestedOrder}</p>
                                     </div>
                                 </div>
                             </div>
                         ))}
                         {!analytics.poRequests.length && (
                             <div className="py-32 text-center opacity-20 flex flex-col items-center"><CheckCircle2 size={100} strokeWidth={1}/><p className="font-black uppercase tracking-[0.4em] text-xs mt-6">Supply Nodes Stabilized</p></div>
                         )}
                     </div>
                  </div>
                )}

                {/* EXPENSE REGISTRY TAB */}
                {activeTab === 'EXPENSES' && (
                  <div className="space-y-8">
                     <div className="flex justify-between items-center">
                        <div><h3 className="text-xl font-black uppercase tracking-tighter text-slate-800">Operational Expenditure Ledger</h3><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Managing overhead and recurring liabilities</p></div>
                        <div className="flex gap-4">
                            <button onClick={exportExpenses} className="px-8 py-3 bg-emerald-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl flex items-center gap-2 hover:bg-emerald-700 transition-all active:scale-95"><FileSpreadsheet size={18}/> Export Excel</button>
                            <button onClick={() => setShowExpenseModal(true)} className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl flex items-center gap-2 hover:bg-black transition-all active:scale-95"><Plus size={18}/> Post Expense</button>
                        </div>
                     </div>

                     <div className="bg-white rounded-[3rem] border border-slate-100 overflow-hidden shadow-sm overflow-x-auto">
                        <table className="w-full text-left min-w-[600px]">
                            <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest">
                                <tr><th className="p-6 pl-10">Entry Date</th><th className="p-6">Classification</th><th className="p-6">Description</th><th className="p-6 text-right pr-10">Fiscal Impact</th><th className="p-6 text-center">Action</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 font-bold uppercase text-[10px]">
                                {analytics.fExpenses.sort((a,b) => ((b.date || '') > (a.date || '') ? 1 : (b.date || '') < (a.date || '') ? -1 : 0)).map(e => (
                                    <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-6 pl-10 text-slate-400 font-mono">{e.date}</td>
                                        <td className="p-6"><span className="px-2 py-1 bg-slate-100 rounded text-[8px] font-black">{e.category}</span></td>
                                        <td className="p-6 text-slate-700 tracking-tight">{e.description}</td>
                                        <td className="p-6 text-right pr-10 font-black text-rose-600 font-mono">-{e.amount.toFixed(2)}</td>
                                        <td className="p-6 text-center"><button onClick={async () => { if(window.confirm("Purge expense node?")) { await db.deleteExpense(e.id); loadData(); } }} className="p-2 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={14}/></button></td>
                                    </tr>
                                ))}
                                {!analytics.fExpenses.length && <tr><td colSpan={5} className="py-20 text-center opacity-20"><HistoryIcon size={48} className="mx-auto mb-4"/><p className="font-black uppercase tracking-widest text-[10px]">Zero Expense Logs Captured</p></td></tr>}
                            </tbody>
                        </table>
                     </div>
                  </div>
                )}

                {/* LOSS FORENSIC TAB */}
                {activeTab === 'LOSS_EXPIRY' && (
                  <div className="space-y-12">
                     <div className="flex justify-between items-center px-4">
                        <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3"><AlertTriangle className="text-rose-600"/> Sunk Cost Registry</h4>
                        <button onClick={exportLossForensic} className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95"><FileSpreadsheet size={16}/> Export Forensic Data</button>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-rose-50 p-8 rounded-[3.5rem] border border-rose-100 flex flex-col h-full">
                           <h4 className="text-xs font-black uppercase tracking-[0.3em] text-rose-700 mb-8 flex items-center gap-3"><AlertTriangle size={18}/> Stability Termination (Expired)</h4>
                           <div className="space-y-4 flex-1 overflow-y-auto no-scrollbar max-h-[500px]">
                               {analytics.expiredStock.map(p => (
                                   <div key={p.id} className="bg-white p-5 rounded-3xl border border-rose-200 shadow-sm flex justify-between items-center group hover:border-rose-500">
                                       <div><p className="font-black text-xs uppercase text-slate-800 leading-none">{p.name}</p><p className="text-[8px] text-rose-500 font-bold uppercase mt-2">Terminated: {p.expiryDate}</p></div>
                                       <div className="text-right"><p className="font-black text-rose-600 font-mono tracking-tighter text-sm">- { (p.buyingPrice * p.quantity).toFixed(2) }</p><p className="text-[8px] text-slate-300 font-bold uppercase">{p.quantity} units</p></div>
                                   </div>
                               ))}
                               {!analytics.expiredStock.length && <div className="text-center py-20 text-rose-300 font-black uppercase text-[10px] tracking-widest">No Sunk Cost Detected</div>}
                           </div>
                           <div className="mt-8 pt-8 border-t border-rose-200 flex justify-between items-center text-rose-900 font-black uppercase tracking-widest text-xs">
                               <span>Aggregate Sunk Cost:</span>
                               <span>{analytics.expiredLossValue.toFixed(2)}</span>
                           </div>
                        </div>
                        <div className="bg-amber-50 p-8 rounded-[3.5rem] border border-amber-100 flex flex-col h-full">
                           <h4 className="text-xs font-black uppercase tracking-[0.3em] text-amber-700 mb-8 flex items-center gap-3"><Clock size={18}/> High Risk Forensic Scan (90d)</h4>
                           <div className="space-y-4 flex-1 overflow-y-auto no-scrollbar max-h-[500px]">
                               {analytics.nearExpiryStock.map(p => (
                                   <div key={p.id} className="bg-white p-5 rounded-3xl border border-amber-200 shadow-sm flex justify-between items-center group hover:border-amber-500">
                                       <div><p className="font-black text-xs uppercase text-slate-800 leading-none">{p.name}</p><p className="text-[8px] text-amber-500 font-bold uppercase mt-2">Registry End: {p.expiryDate}</p></div>
                                       <div className="text-right"><p className="font-black text-slate-700 font-mono tracking-tighter text-sm"> { (p.buyingPrice * p.quantity).toFixed(2) }</p><p className="text-[8px] text-slate-300 font-bold uppercase">Exposure Node</p></div>
                                   </div>
                               ))}
                               {!analytics.nearExpiryStock.length && <div className="text-center py-20 text-amber-300 font-black uppercase text-[10px] tracking-widest">Zero Timeline Risks Detected</div>}
                           </div>
                        </div>
                     </div>
                  </div>
                )}

                {/* PROFIT & EXPENSE ANALYSIS TAB */}
                {activeTab === 'PROFIT_EXPENSE' && (
                  <div className="space-y-8">
                     <div className="flex justify-between items-center px-4">
                        <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3"><BarChart3 className="text-teal-600"/> Advanced Profit & Expense Analysis</h4>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                         <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center">
                             <p className="text-[10px] font-black tracking-widest uppercase text-slate-400 mb-2">Total Gross Revenue</p>
                             <h3 className="text-3xl font-black font-mono text-teal-700">{analytics.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                         </div>
                         <div className="bg-rose-50 p-6 rounded-3xl border border-rose-100 flex flex-col items-center justify-center text-center">
                             <p className="text-[10px] font-black tracking-widest uppercase text-rose-400 mb-2">Total Overheads (COGS + Exp)</p>
                             <h3 className="text-3xl font-black font-mono text-rose-700">{(analytics.totalCogs + analytics.totalExpenses).toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                         </div>
                         <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 flex flex-col items-center justify-center text-center">
                             <p className="text-[10px] font-black tracking-widest uppercase text-indigo-400 mb-2">Net Realized Profit</p>
                             <h3 className="text-3xl font-black font-mono text-indigo-700">{analytics.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                         </div>
                     </div>
                     
                     <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
                         <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-600 mb-8 flex items-center gap-2"><TrendingUp size={16} className="text-teal-500"/> Profit Timeline (Revenue vs COGS vs Expenses)</h4>
                         <div className="h-80 w-full mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={analytics.profitTrendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                      <defs>
                                          <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                              <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3}/>
                                              <stop offset="95%" stopColor="#0d9488" stopOpacity={0}/>
                                          </linearGradient>
                                          <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                              <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                                              <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                                          </linearGradient>
                                      </defs>
                                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} tickFormatter={(value) => `${value}`} />
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                      <RechartsTooltip 
                                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)', fontWeight: 'bold', fontSize: '12px' }}
                                          itemStyle={{ fontSize: '12px', fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '1px' }}
                                      />
                                      <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }} />
                                      <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#0d9488" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                                      <Area type="monotone" dataKey="profit" name="Net Profit" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorProfit)" />
                                      <Line type="monotone" dataKey="expenses" name="Op Expenses" stroke="#e11d48" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                                      <Line type="monotone" dataKey="cogs" name="COGS" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                                  </AreaChart>
                              </ResponsiveContainer>
                         </div>
                     </div>
                     
                     <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm mt-8">
                         <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-600 mb-8 flex items-center gap-2"><Activity size={16} className="text-indigo-500"/> Daily Profit Breakdown</h4>
                         <div className="h-80 w-full mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={analytics.profitTrendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                      <RechartsTooltip 
                                          cursor={{ fill: '#f8fafc' }}
                                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)', fontWeight: 'bold', fontSize: '12px' }}
                                      />
                                      <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }} />
                                      <Bar dataKey="revenue" name="Gross Sales" fill="#0d9488" radius={[4, 4, 0, 0]} />
                                      <Bar dataKey="profit" name="Profit Node" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                                  </BarChart>
                              </ResponsiveContainer>
                         </div>
                     </div>
                  </div>
                )}
                {/* STAFF PERFORMANCE TAB */}
                {activeTab === 'STAFF_PERFORMANCE' && (
                  <div className="space-y-8">
                     <div className="flex justify-between items-center px-4">
                        <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3"><Award className="text-teal-600"/> Top Sellers Performance</h4>
                     </div>
                     <div className="grid grid-cols-1 gap-6">
                        {analytics.staffPerformanceList.map((staff, idx) => (
                           <div key={staff.username} className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 flex items-center justify-between shadow-sm">
                              <div className="flex items-center gap-6">
                                 <div className={`p-4 rounded-[1.5rem] flex items-center justify-center font-black text-2xl w-16 h-16 ${idx === 0 ? 'bg-amber-100 text-amber-600 border-2 border-amber-200' : idx === 1 ? 'bg-slate-200 text-slate-600 border-2 border-slate-300' : idx === 2 ? 'bg-orange-100 text-orange-600 border-2 border-orange-200' : 'bg-slate-50 text-slate-400'}`}>
                                     {idx + 1}
                                 </div>
                                 <div className="flex flex-col">
                                     <span className="font-black text-2xl text-slate-800 tracking-tight">{staff.username}</span>
                                     <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{staff.totalSales} Checkout Sessions • {staff.totalItems} Items Sold</span>
                                 </div>
                              </div>
                              <div className="flex gap-10 text-right">
                                  <div className="flex flex-col">
                                     <span className="text-2xl font-black text-teal-600">ETB {staff.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                     <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Gross Sales</span>
                                  </div>
                              </div>
                           </div>
                        ))}
                        {analytics.staffPerformanceList.length === 0 && (
                            <div className="p-20 text-center border-2 border-dashed border-slate-200 rounded-[2rem]">
                                <Award className="mx-auto text-slate-300 mb-4" size={48}/>
                                <h3 className="font-black text-slate-500 uppercase tracking-widest text-sm mb-2">No Performance Data</h3>
                                <p className="text-xs font-bold text-slate-400">There were no sales recorded for this period.</p>
                            </div>
                        )}
                     </div>
                  </div>
                )}
                {/* AI AUDIT TAB */}
                {activeTab === 'AI_AUDIT' && (
                  <div className="space-y-8">
                     <div className="flex justify-between items-center px-4">
                        <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3"><Sparkles className="text-teal-600"/> Cognitive Financial Audit</h4>
                        <button onClick={handleAiAudit} disabled={isAiLoading} className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50">
                            {isAiLoading ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>} 
                            {isAiLoading ? 'Analyzing...' : 'Generate New Audit'}
                        </button>
                     </div>
                     {!aiReport && !isAiLoading ? (
                        <div className="py-20 flex flex-col items-center justify-center bg-slate-50 border border-slate-100 rounded-[3rem] text-center px-6">
                            <Sparkles size={64} className="text-slate-300 mb-6"/>
                            <h3 className="text-xl font-black uppercase tracking-widest text-slate-700 mb-2">Awaiting Cognitive Scan</h3>
                            <p className="text-sm font-bold text-slate-400 max-w-lg mb-8">Initiate the Gemini intelligence engine to perform a comprehensive forensic analysis of your financial data, identifying trends, anomalies, and recommendations.</p>
                            <button onClick={handleAiAudit} className="px-8 py-3 bg-teal-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl flex items-center gap-3 hover:bg-teal-700 transition-all">Execute Core Audit</button>
                        </div>
                     ) : isAiLoading ? (
                        <div className="py-32 flex flex-col items-center justify-center bg-slate-50 border border-slate-100 rounded-[3rem]">
                            <Loader2 size={48} className="animate-spin text-teal-600 mb-6"/>
                            <p className="font-black uppercase tracking-[0.4em] text-xs text-slate-500">Synthesizing Financial Vectors...</p>
                        </div>
                     ) : (
                         <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                             <div className="prose prose-slate prose-headings:font-black prose-headings:uppercase prose-headings:tracking-widest prose-h1:text-2xl prose-h2:text-xl prose-a:text-teal-600 max-w-none">
                                 <ReactMarkdown>{aiReport}</ReactMarkdown>
                             </div>
                             <div className="mt-10 pt-6 border-t border-slate-100 flex justify-end">
                                 <button onClick={() => window.print()} className="px-6 py-2 bg-slate-100 text-slate-700 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2"><Printer size={14}/> Print Report</button>
                             </div>
                         </div>
                     )}
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
      {/* EXPENSE REGISTRATION MODAL */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white w-full max-w-lg rounded-[3rem] p-10 shadow-2xl relative">
            <button onClick={() => setShowExpenseModal(false)} className="absolute top-10 right-10 text-slate-400 hover:text-slate-800 transition-colors"><X size={24} /></button>
            <div className="flex items-center gap-4 mb-8">
              <div className="p-4 bg-rose-50 text-rose-600 rounded-3xl"><Receipt size={24} /></div>
              <div><h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Post Loss / Expense</h2><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Register Operational Overhead</p></div>
            </div>
            <form onSubmit={handleAddExpense} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Fiscal Amount ()</label>
                <div className="relative">
                  <Coins className="absolute left-4 top-4 text-slate-400" size={20}/>
                  <input type="number" step="0.01" required value={newExpense.amount || ''} onChange={e => setNewExpense({...newExpense, amount: parseFloat(e.target.value) || 0})} className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 font-mono font-black text-xl text-slate-800 focus:ring-4 focus:ring-rose-500/20" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Category Node</label>
                  <select value={newExpense.category} onChange={e => setNewExpense({...newExpense, category: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-rose-500/20">
                    <option>Utilities</option><option>Payroll</option><option>Rent</option><option>Maintenance</option><option>Marketing</option><option>Loss/Damage</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Execution Date</label>
                  <input type="date" required value={newExpense.date} onChange={e => setNewExpense({...newExpense, date: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 font-mono font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-rose-500/20" />
                </div>
              </div>
              {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Branch Context</label>
                  <select value={newExpense.branch || ''} onChange={e => setNewExpense({...newExpense, branch: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-rose-500/20">
                    <option value="">Main Branch</option>
                    {pharmacyInfo.branches.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Forensic Description</label>
                <textarea required value={newExpense.description} onChange={e => setNewExpense({...newExpense, description: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-rose-500/20" rows={3} placeholder="Justification..." />
              </div>
              <button type="submit" className="w-full bg-rose-600 text-white rounded-2xl py-4 font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-xl shadow-rose-600/20 active:scale-95">Commit Expense to Ledger</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
