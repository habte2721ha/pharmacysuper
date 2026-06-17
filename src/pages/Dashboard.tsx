import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { db } from '../services/db';
import { Product, Sale, SupplierTransaction, ProductCategory, Supplier, Expense } from '../types';
import { useAppContext } from '../App';
import { 
  Activity, Wallet, TrendingUp, ShoppingBag, 
  AlertOctagon, CreditCard, BarChart3, PieChart, 
  RefreshCw, Package, Clock, Filter, Download, 
  CheckCircle, ArrowUpRight, Percent, Layers,
  Truck, X, FileSpreadsheet, ExternalLink, CalendarDays
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

export default function Dashboard() {
  const { globalBranch, user } = useAppContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ProductCategory.MEDICINE | ProductCategory.COSMETIC>('ALL');
  
  // Modal State
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [showOutOfStockModal, setShowOutOfStockModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
        const [p, s, t, su, exp] = await Promise.all([
            db.getProducts(), 
            db.getSales(),
            db.getSupplierTransactions(),
            db.getSuppliers(),
            db.getExpenses()
        ]);
        const productsArr = Array.isArray(p) ? p : [];
        const salesArr = Array.isArray(s) ? s : [];
        const transactionsArr = Array.isArray(t) ? t : [];
        const suppliersArr = Array.isArray(su) ? su : [];
        const expensesArr = Array.isArray(exp) ? exp : [];

        const matchesBranch = (itemBranch?: string) => {
            if (user?.role === 'ADMIN') {
                 if (globalBranch) {
                     if (globalBranch === 'MAIN') return !itemBranch;
                     return itemBranch === globalBranch;
                 }
                 return true;
            }
            return !itemBranch || itemBranch === user?.branch;
        };

        setProducts(productsArr.filter((item: any) => !item.isDeleted && matchesBranch(item.branch)));
        setSales(salesArr.filter((sale: any) => matchesBranch(sale.branch)));
        setTransactions(transactionsArr);
        setSuppliers(suppliersArr);
        setExpenses(expensesArr.filter((e: any) => !e.isDeleted && matchesBranch(e.branch)));
    };
    fetchData();
    window.addEventListener('local-data-update', fetchData);
    return () => window.removeEventListener('local-data-update', fetchData);
  }, [globalBranch, user]);

  const analytics = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayObj = new Date();
    const currentMonth = new Date().toISOString().slice(0, 7);

    // 1. Filter raw data based on category selection
    const filteredProducts = products.filter(p => categoryFilter === 'ALL' || p.type === categoryFilter);

    // Process Sales with filtering
    const processedSales = sales.filter(s => s.status !== 'VOIDED').map(sale => {
        const filteredItems = sale.items.filter((item: Product) => categoryFilter === 'ALL' || item.type === categoryFilter);
        const subTotal = filteredItems.reduce((sum, i) => sum + (i.sellingPrice * i.cartQty) - (i.discount || 0), 0);
        const vatAmount = subTotal * (sale.vatPercent / 100);
        const grandTotal = subTotal + vatAmount;
        const cogs = filteredItems.reduce((sum, i) => sum + (i.buyingPrice * i.cartQty), 0);
        const units = filteredItems.reduce((sum, i) => sum + i.cartQty, 0);
        
        return { ...sale, items: filteredItems, subTotal, vatAmount, grandTotal, cogs, units };
    }).filter(s => s.items.length > 0);

    // Today's Metrics
    const todaySales = processedSales.filter(s => s.date.startsWith(todayStr));
    const todayGross = todaySales.reduce((s, x) => s + x.grandTotal, 0);
    const todayCogs = todaySales.reduce((s, x) => s + x.cogs, 0);
    const todayNetProfit = todayGross - (todaySales.reduce((s, x) => s + x.vatAmount, 0)) - todayCogs;
    const todayMargin = todayGross > 0 ? (todayNetProfit / todayGross) * 100 : 0;
    const todayReceipts = todaySales.length;
    const todayUnits = todaySales.reduce((s, x) => s + x.units, 0);

    // Monthly Metrics
    const monthSales = processedSales.filter(s => s.date.startsWith(currentMonth));
    const monthGross = monthSales.reduce((s, x) => s + x.grandTotal, 0);
    const monthCogs = monthSales.reduce((s, x) => s + x.cogs, 0);
    const monthVat = monthSales.reduce((s, x) => s + x.vatAmount, 0);
    const monthNetProfit = monthGross - monthVat - monthCogs;

    // Month-over-Month Revenue
    const prevMonthDate = new Date(todayObj);
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonthStr = prevMonthDate.toISOString().slice(0, 7);
    const prevMonthSales = processedSales.filter(s => s.date.startsWith(prevMonthStr));
    const prevMonthGross = prevMonthSales.reduce((s, x) => s + x.grandTotal, 0);

    const monthOverMonthGrowth = prevMonthGross > 0 
        ? ((monthGross - prevMonthGross) / prevMonthGross) * 100 
        : (monthGross > 0 ? 100 : 0);

    // Expiry Analysis
    const expiringSoon = filteredProducts.filter(p => {
        const diff = (new Date(p.expiryDate).getTime() - todayObj.getTime()) / (1000 * 3600 * 24);
        return diff <= 90 && p.quantity > 0; // Includes expired items as high risk, excluding zero quantity
    }).sort((a,b) => ((a.expiryDate || '') > (b.expiryDate || '') ? 1 : (a.expiryDate || '') < (b.expiryDate || '') ? -1 : 0));
    
    const expiryRiskPercent = filteredProducts.length > 0 ? (expiringSoon.length / filteredProducts.length) * 100 : 0;

    // Velocity Analysis
    const itemsSoldMap = new Map<string, number>();
    processedSales.forEach((s: any) => s.items.forEach((i: any) => {
        const k = i.name.toLowerCase().trim();
        itemsSoldMap.set(k, (itemsSoldMap.get(k) || 0) + i.cartQty);
    }));
    
    const top20Fast = Array.from(itemsSoldMap.entries())
        .sort((a,b) => b[1] - a[1])
        .slice(0, 20);

    // Dead Stock Analysis
    const productsWithSales = new Set(Array.from(itemsSoldMap.keys()));
    const deadStock = filteredProducts.filter(p => !productsWithSales.has(p.name.toLowerCase().trim()));
    const deadStockPercent = filteredProducts.length > 0 ? (deadStock.length / filteredProducts.length) * 100 : 0;

    // Out of Stock Analysis
    const outOfStockProducts = filteredProducts.filter(p => p.quantity <= 0);
    const outOfStockCount = outOfStockProducts.length;
    const outOfStockPercent = filteredProducts.length > 0 ? (outOfStockCount / filteredProducts.length) * 100 : 0;

    // Supplier Debt
    const filteredSupplierNames = new Set(filteredProducts.map(p => p.supplier));
    const outstandingSupplierDebt = transactions
        .filter(t => {
            const supplier = suppliers.find(s => s.id === t.supplierId);
            return supplier && filteredSupplierNames.has(supplier.name);
        })
        .reduce((sum, t) => t.type === 'PURCHASE_CREDIT' ? sum + t.amount : sum - t.amount, 0);

    // Past 7 Days Revenue Trend
    const past7DaysRevenue = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(todayObj);
        d.setDate(d.getDate() - i);
        const dayStr = d.toISOString().split('T')[0];
        
        const daySales = processedSales.filter(s => s.date.startsWith(dayStr));
        const dayGross = daySales.reduce((s, x) => s + x.grandTotal, 0);
        
        past7DaysRevenue.push({
            date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            revenue: Number(dayGross.toFixed(2))
        });
    }

    // Past 6 Months Expense Trend
    const past6MonthsExpenses = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(todayObj);
        d.setMonth(d.getMonth() - i);
        const monthStr = d.toISOString().slice(0, 7);
        
        const monthExps = expenses.filter(e => e.date.startsWith(monthStr));
        const monthTotal = monthExps.reduce((s, x) => s + x.amount, 0);
        
        past6MonthsExpenses.push({
            month: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            expenses: Number(monthTotal.toFixed(2))
        });
    }

    return { 
        todayGross, todayNetProfit, todayMargin, todayReceipts, todayUnits,
        monthNetProfit, expiringSoon, expiryRiskPercent, top20Fast,
        deadStockPercent, outstandingSupplierDebt, past7DaysRevenue,
        monthGross, prevMonthGross, monthOverMonthGrowth, past6MonthsExpenses,
        outOfStockProducts, outOfStockCount, outOfStockPercent
    };
  }, [products, sales, transactions, suppliers, categoryFilter, expenses]);

  const handleExportDashboard = () => {
    const data = [
        ['Pharmacy Dashboard Report', new Date().toLocaleString()],
        ['Filter Category', categoryFilter],
        [],
        ['Metric', 'Value'],
        ["Today's Sales", `${analytics.todayGross.toFixed(2)}`],
        ['Profit Margin', `${analytics.todayMargin.toFixed(1)}%`],
        ['Net Profit (Today)', `${analytics.todayNetProfit.toFixed(2)}`],
        ['Receipts Issued', analytics.todayReceipts],
        ['Units Sold (Today)', analytics.todayUnits],
        ['Monthly Profit', `${analytics.monthNetProfit.toFixed(2)}`],
        ['Expiry Risk %', `${analytics.expiryRiskPercent.toFixed(1)}%`],
        ['Dead Stock %', `${analytics.deadStockPercent.toFixed(1)}%`],
        ['Out of Stock Items', analytics.outOfStockCount],
        ['Outstanding Supplier Debt', `${analytics.outstandingSupplierDebt.toFixed(2)}`],
        [],
        ['Top Fast Moving Items', 'Units Sold'],
        ...analytics.top20Fast.map(([name, qty]) => [name.toUpperCase(), qty])
    ];
    downloadExcel(data, `Pharmacy_Dashboard_${categoryFilter}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportExpiryList = () => {
    const data = [
        ['Pharmacy Expiry Risk Registry', new Date().toLocaleString()],
        ['Scope', categoryFilter],
        [],
        ['Item Name', 'Batch #', 'Category', 'Stock Qty', 'Supplier', 'Expiry Date', 'Days Remaining'],
        ...analytics.expiringSoon.map(p => {
            const diff = Math.ceil((new Date(p.expiryDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
            return [
                p.name.toUpperCase(),
                p.batchNumber || 'N/A',
                p.type,
                p.quantity,
                p.supplier,
                p.expiryDate,
                diff <= 0 ? 'EXPIRED' : diff
            ];
        })
    ];
    downloadExcel(data, `Expiry_Risk_List_${categoryFilter}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportOutOfStockList = () => {
    const data = [
        ['Pharmacy Out of Stock Registry', new Date().toLocaleString()],
        ['Scope', categoryFilter],
        [],
        ['Item Name', 'Batch #', 'Category', 'Minimum Stock Level', 'Supplier', 'Expiry Date', 'Buying Price', 'Selling Price'],
        ...analytics.outOfStockProducts.map(p => {
            return [
                p.name.toUpperCase(),
                p.batchNumber || 'N/A',
                p.type,
                p.minStockLevel || 0,
                p.supplier,
                p.expiryDate,
                p.buyingPrice,
                p.sellingPrice
            ];
        })
    ];
    downloadExcel(data, `Out_of_Stock_List_${categoryFilter}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const downloadExcel = (data: any[][], filename: string) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Export");
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
return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500 max-w-[1600px] mx-auto">
      
      {/* HEADER & GLOBAL CONTROLS */}
      <div className="flex flex-col lg:flex-row justify-between items-center gap-6 bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
        <div>
          <h1 className="text-4xl font-black text-slate-800 flex items-center gap-4 uppercase tracking-tighter italic leading-none">
            <Activity className="text-teal-600" size={42}/> Dashboard
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 ml-1">Live Clinical & Financial Performance Data</p>
        </div>
        
        <div className="flex items-center gap-4">
            <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner">
                {(['ALL', ProductCategory.MEDICINE, ProductCategory.COSMETIC] as const).map(type => (
                    <button 
                        key={type} 
                        onClick={() => setCategoryFilter(type)} 
                        className={`px-6 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${categoryFilter === type ? 'bg-white text-teal-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {type}
                    </button>
                ))}
            </div>
            <button 
                onClick={handleExportDashboard}
                className="flex items-center gap-3 px-8 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-black transition-all shadow-xl active:scale-95"
            >
                <Download size={18}/> Export Excel
            </button>
        </div>
      </div>
      
      {/* CORE KPI GRID */}
      <motion.div 
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
          }
        }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6"
      >
        
        {/* Row 1: Today's High-Velocity Metrics */}
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="bg-teal-900 p-8 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden group lg:col-span-1">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:rotate-12 transition-transform duration-500"><Wallet size={100}/></div>
            <p className="text-[10px] font-black uppercase text-teal-400 tracking-widest mb-6">Today's Sales</p>
            <h3 className="text-4xl font-black font-mono tracking-tighter leading-none">{analytics.todayGross.toLocaleString()}</h3>
            <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-center">
                <div><p className="text-[8px] font-bold text-teal-500 uppercase">Receipts</p><p className="font-black text-xl">{analytics.todayReceipts}</p></div>
                <div><p className="text-[8px] font-bold text-teal-500 uppercase">Units Sold</p><p className="font-black text-xl text-right">{analytics.todayUnits}</p></div>
            </div>
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="bg-white p-8 rounded-[3.5rem] shadow-sm border border-slate-100 group hover:border-indigo-500 transition-all">
            <div className="flex justify-between items-start mb-6">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Net Profit (Today)</p>
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><TrendingUp size={20}/></div>
            </div>
            <h3 className="text-4xl font-black text-slate-800 font-mono tracking-tighter">{analytics.todayNetProfit.toLocaleString()}</h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase mt-6 flex items-center gap-2">
                <Percent size={12} className="text-indigo-500"/> Margin: <span className="text-indigo-600 font-black">{analytics.todayMargin.toFixed(1)}%</span>
            </p>
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="bg-white p-8 rounded-[3.5rem] shadow-sm border border-slate-100 group hover:border-emerald-500 transition-all">
            <div className="flex justify-between items-start mb-6">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Monthly Profit</p>
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl"><Layers size={20}/></div>
            </div>
            <h3 className="text-4xl font-black text-slate-800 font-mono tracking-tighter">{analytics.monthNetProfit.toLocaleString()}</h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase mt-6">Accumulated Current Cycle</p>
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="bg-slate-900 p-8 rounded-[3.5rem] text-white shadow-xl relative overflow-hidden group transition-all">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-500"><BarChart3 size={100}/></div>
            <div className="flex justify-between items-start mb-6 relative z-10">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">MoM Revenue</p>
                <div className={`p-3 rounded-2xl ${analytics.monthOverMonthGrowth >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                    <TrendingUp size={20} className={analytics.monthOverMonthGrowth < 0 ? 'rotate-180' : ''}/>
                </div>
            </div>
            <h3 className="text-4xl font-black font-mono tracking-tighter relative z-10">{analytics.monthGross.toLocaleString()}</h3>
            <div className="flex justify-between items-center mt-6 relative z-10">
                <div>
                    <p className="text-[8px] font-bold text-slate-400 uppercase">vs Last Month</p>
                    <p className={`font-black text-lg ${analytics.monthOverMonthGrowth >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {analytics.monthOverMonthGrowth >= 0 ? '+' : ''}{analytics.monthOverMonthGrowth.toFixed(1)}%
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-[8px] font-bold text-slate-400 uppercase">Prev</p>
                    <p className="font-black text-sm text-slate-300 tracking-tighter">{analytics.prevMonthGross.toLocaleString()}</p>
                </div>
            </div>
        </motion.div>

        <motion.button 
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            onClick={() => setShowExpiryModal(true)}
            className={`p-8 rounded-[3.5rem] shadow-xl border-4 text-left transition-all relative overflow-hidden group outline-none ${analytics.expiryRiskPercent > 15 ? 'bg-rose-50 border-rose-100 text-rose-800 hover:bg-rose-100' : 'bg-white border-slate-100 text-slate-800 hover:border-rose-500'}`}
        >
            <div className="flex justify-between items-start mb-6 relative z-10">
                <p className="text-[10px] font-black uppercase opacity-60 tracking-widest">Expiry Risk %</p>
                <div className={`p-3 rounded-2xl transition-all ${analytics.expiryRiskPercent > 15 ? 'bg-rose-100 text-rose-600 group-hover:scale-110' : 'bg-slate-50 text-slate-400 group-hover:text-rose-500'}`}><AlertOctagon size={20}/></div>
            </div>
            <h3 className="text-4xl font-black font-mono tracking-tighter relative z-10">{analytics.expiryRiskPercent.toFixed(1)}%</h3>
            <div className="flex justify-between items-center mt-6 relative z-10">
                <p className="text-[9px] font-bold opacity-60 uppercase">{analytics.expiringSoon.length} Items at Risk</p>
                <span className="text-[8px] font-black uppercase text-rose-600 bg-white/50 px-2 py-1 rounded-lg">Trace Details <ArrowUpRight size={10} className="inline ml-1"/></span>
            </div>
            <CalendarDays size={100} className="absolute -bottom-4 -right-4 opacity-5 group-hover:opacity-10 transition-opacity" />
        </motion.button>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="bg-slate-900 p-8 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden col-span-1">
            <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6">Dead Stock %</p>
            <h3 className="text-4xl font-black font-mono tracking-tighter text-rose-500">{analytics.deadStockPercent.toFixed(1)}%</h3>
            <p className="text-[9px] font-bold text-slate-500 uppercase mt-6">Inactive items in 30 days</p>
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="bg-indigo-900 p-10 rounded-[3.5rem] text-white shadow-2xl col-span-1 lg:col-span-2 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5 -rotate-12"><CreditCard size={150}/></div>
            <div className="flex justify-between items-start relative z-10">
                <div>
                    <p className="text-[10px] font-black uppercase text-indigo-300 tracking-widest mb-6">Outstanding Supplier Debt</p>
                    <h3 className="text-5xl font-black font-mono tracking-tighter">{analytics.outstandingSupplierDebt.toLocaleString()}</h3>
                </div>
                <div className="p-5 bg-white/10 rounded-3xl border border-white/10"><Truck size={32} className="text-indigo-200"/></div>
            </div>
            <p className="text-[9px] font-bold text-indigo-400 uppercase mt-8 border-l-2 border-indigo-500 pl-4">Net liabilities across active vendors</p>
        </motion.div>

        <motion.button 
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            onClick={() => setShowOutOfStockModal(true)}
            className={`p-8 rounded-[3.5rem] shadow-xl border-4 text-left transition-all relative overflow-hidden group outline-none ${analytics.outOfStockCount > 0 ? 'bg-amber-50 border-amber-100 text-amber-800 hover:bg-amber-100' : 'bg-white border-slate-100 text-slate-800 hover:border-amber-500'}`}
        >
            <div className="flex justify-between items-start mb-6 relative z-15">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-amber-600 transition-colors">Out of Stock</p>
                <div className={`p-3 rounded-2xl transition-all ${analytics.outOfStockCount > 0 ? 'bg-amber-100 text-amber-600 group-hover:scale-110' : 'bg-slate-50 text-slate-400 group-hover:text-amber-500'}`}><AlertOctagon size={20}/></div>
            </div>
            <h3 className={`text-4xl font-black font-mono tracking-tighter relative z-15 ${analytics.outOfStockCount > 0 ? 'text-amber-700 font-extrabold shadow-sm' : 'text-slate-800'}`}>{analytics.outOfStockCount} Items</h3>
            <div className="flex justify-between items-center mt-6 relative z-15">
                <p className="text-[9px] font-bold opacity-60 uppercase">{analytics.outOfStockPercent.toFixed(1)}% of Catalog</p>
                <span className="text-[8px] font-black uppercase text-amber-600 bg-white/50 px-2.5 py-1 rounded-lg">Quick-View <ArrowUpRight size={10} className="inline ml-1"/></span>
            </div>
            <Package size={100} className="absolute -bottom-4 -right-4 opacity-5 group-hover:opacity-10 transition-opacity" />
        </motion.button>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="bg-white p-8 rounded-[3.5rem] shadow-sm border border-slate-100 flex flex-col justify-center items-center text-center">
            <RefreshCw size={32} className="text-teal-500 mb-4 animate-spin-slow"/>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Real-time Node</p>
            <p className="text-xs font-bold text-slate-800 uppercase mt-1">Syncing {categoryFilter} Archive</p>
        </motion.div>
      </motion.div>

      {/* TRENDS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 7-DAY REVENUE TREND */}
          <div className="bg-white p-10 rounded-[4rem] shadow-sm border border-slate-100 flex flex-col">
              <div className="flex items-center gap-4 mb-8">
                  <div className="p-4 bg-indigo-50 text-indigo-600 rounded-3xl"><TrendingUp size={24}/></div>
                  <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">7-Day Revenue</h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gross sales performance</p>
                  </div>
              </div>
              <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={analytics.past7DaysRevenue} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold', fontFamily: 'monospace' }} tickFormatter={(value) => `${value}`} />
                          <RechartsTooltip 
                              contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' }}
                              labelStyle={{ fontWeight: 'black', color: '#1e293b', marginBottom: '4px', fontSize: '12px' }}
                              itemStyle={{ fontFamily: 'monospace', fontWeight: 'black', color: '#4f46e5' }}
                              formatter={(value: number) => [`${value.toFixed(2)}`, 'Revenue']}
                          />
                          <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={4} dot={{ r: 4, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                      </LineChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* 6-MONTH EXPENSE TREND */}
          <div className="bg-white p-10 rounded-[4rem] shadow-sm border border-slate-100 flex flex-col">
              <div className="flex items-center gap-4 mb-8">
                  <div className="p-4 bg-rose-50 text-rose-600 rounded-3xl"><Activity size={24}/></div>
                  <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">6-Month Expenses</h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Monthly operational costs</p>
                  </div>
              </div>
              <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={analytics.past6MonthsExpenses} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold', fontFamily: 'monospace' }} tickFormatter={(value) => `${value}`} />
                          <RechartsTooltip 
                              contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' }}
                              labelStyle={{ fontWeight: 'black', color: '#1e293b', marginBottom: '4px', fontSize: '12px' }}
                              itemStyle={{ fontFamily: 'monospace', fontWeight: 'black', color: '#e11d48' }}
                              formatter={(value: number) => [`${value.toFixed(2)}`, 'Expenses']}
                          />
                          <Line type="monotone" dataKey="expenses" stroke="#e11d48" strokeWidth={4} dot={{ r: 4, fill: '#e11d48', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                      </LineChart>
                  </ResponsiveContainer>
              </div>
          </div>
      </div>

      {/* DETAILED TABLES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* TOP 20 FAST MOVING */}
        <div className="lg:col-span-2 bg-white p-10 rounded-[4rem] shadow-sm border border-slate-100 flex flex-col min-h-[600px]">
            <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl"><BarChart3 size={24}/></div>
                    <h3 className="text-xl font-black uppercase text-slate-800 tracking-tighter">Top 20 Velocity Catalog</h3>
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 bg-slate-50 px-4 py-2 rounded-full border border-slate-100">Filtered: {categoryFilter}</span>
            </div>
            <div className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar">
                <table className="w-full text-left min-w-[600px]">
                    <thead className="text-[10px] font-black text-slate-400 uppercase tracking-widest"><tr className="border-b border-slate-50"><th className="pb-6">Item Identity</th><th className="pb-6 text-right">Pooled Units Sold</th><th className="pb-6 text-center">Velocity Rank</th></tr></thead>
                    <tbody className="divide-y divide-slate-50 font-bold uppercase text-[10px]">
                        {analytics.top20Fast.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                <td className="py-5 font-black text-slate-700 tracking-tight">{item[0]}</td>
                                <td className="py-5 text-right font-black text-teal-800 font-mono text-lg">{item[1]} u</td>
                                <td className="py-5 text-center"><span className={`px-4 py-1.5 rounded-xl font-black ${idx < 3 ? 'bg-teal-900 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>{idx+1}</span></td>
                            </tr>
                        ))}
                        {analytics.top20Fast.length === 0 && <tr><td colSpan={3} className="py-20 text-center opacity-20"><Package size={48} className="mx-auto mb-4"/><p>No sales movement detected</p></td></tr>}
                    </tbody>
                </table>
            </div>
        </div>

        {/* EXPIRY RADAR */}
        <div className="bg-slate-50 p-10 rounded-[4rem] border border-slate-200 flex flex-col min-h-[600px]">
            <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-rose-100 text-rose-600 rounded-2xl shadow-sm"><Clock size={24}/></div>
                    <h3 className="text-xl font-black uppercase text-slate-800 tracking-tighter">Expiry Radar</h3>
                </div>
                <button onClick={() => setShowExpiryModal(true)} className="p-2 text-slate-400 hover:text-rose-600 transition-colors"><ExternalLink size={18}/></button>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-4">
                {analytics.expiringSoon.slice(0, 8).map(p => (
                    <div key={p.id} onClick={() => setShowExpiryModal(true)} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center group hover:border-rose-300 transition-all cursor-pointer">
                        <div className="min-w-0 pr-4">
                            <p className="text-xs font-black text-slate-800 uppercase truncate">{p.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Batch: {p.batchNumber}</p>
                        </div>
                        <div className="text-right shrink-0">
                            <p className={`text-[10px] font-black uppercase ${new Date(p.expiryDate) < new Date() ? 'text-rose-600 animate-pulse' : 'text-amber-600'}`}>
                                {p.expiryDate}
                            </p>
                            <p className="text-[8px] font-bold text-slate-400 uppercase">Registry</p>
                        </div>
                    </div>
                ))}
                {analytics.expiringSoon.length === 0 && (
                    <div className="py-20 text-center opacity-20 flex flex-col items-center">
                        <CheckCircle size={48} className="mb-4 text-teal-600"/>
                        <p className="font-black uppercase tracking-widest text-[10px]">No Expiry Risks Detected</p>
                    </div>
                )}
            </div>
            <button 
                onClick={() => setShowExpiryModal(true)}
                className="mt-8 p-6 bg-slate-900 rounded-[2.5rem] text-white group hover:bg-black transition-all text-left"
            >
                <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-2 group-hover:text-rose-400 transition-colors">Aggregate Risk Status</p>
                <div className="flex items-center gap-4">
                    <h4 className="text-3xl font-black font-mono">{analytics.expiryRiskPercent.toFixed(1)}%</h4>
                    <div className="h-2 flex-1 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-1000 ${analytics.expiryRiskPercent > 15 ? 'bg-rose-500' : 'bg-teal-500'}`} style={{ width: `${analytics.expiryRiskPercent}%` }}></div>
                    </div>
                </div>
                <p className="text-[8px] font-black uppercase tracking-widest mt-4 text-slate-500 text-center">Click to Expand Full Intelligence Registry</p>
            </button>
        </div>

      </div>

      {/* EXPIRY DETAIL MODAL */}
      {showExpiryModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[2000] flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="bg-white rounded-[4rem] shadow-4xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col border border-white/20">
                  <div className="p-10 border-b bg-slate-50 flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-5">
                          <div className="p-4 bg-rose-600 text-white rounded-3xl shadow-xl shadow-rose-200"><AlertOctagon size={32}/></div>
                          <div>
                              <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tighter leading-none mb-2">Expiry Forensic Registry</h2>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                  <Filter size={12}/> Scope: {categoryFilter} • Items Flagged: {analytics.expiringSoon.length}
                              </p>
                          </div>
                      </div>
                      <div className="flex items-center gap-4">
                          <button 
                            onClick={handleExportExpiryList}
                            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
                          >
                            <FileSpreadsheet size={18}/> Export Excel
                          </button>
                          <button 
                            onClick={() => setShowExpiryModal(false)}
                            className="p-4 hover:bg-slate-200 rounded-full transition-all text-slate-300 hover:text-rose-500"
                          >
                            <X size={32}/>
                          </button>
                      </div>
                  </div>

                  <div className="flex-1 overflow-x-auto overflow-y-auto p-10 no-scrollbar">
                      <table className="w-full text-left border-separate border-spacing-0 min-w-[800px]">
                          <thead className="bg-white text-slate-400 font-black uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm">
                              <tr className="border-b">
                                  <th className="p-6 rounded-l-2xl">Item Registry Name</th>
                                  <th className="p-6">Batch ID</th>
                                  <th className="p-6 text-right">Available Stock</th>
                                  <th className="p-6">Supplier Source</th>
                                  <th className="p-6">Expiry Timeline</th>
                                  <th className="p-6 text-center rounded-r-2xl pr-10">Risk Level</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 font-bold uppercase text-[11px]">
                              {analytics.expiringSoon.map(p => {
                                  const diff = Math.ceil((new Date(p.expiryDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
                                  return (
                                    <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                                        <td className="p-6 font-black text-slate-800 tracking-tight">{p.name}</td>
                                        <td className="p-6 font-mono text-indigo-600">{p.batchNumber || '---'}</td>
                                        <td className="p-6 text-right">
                                            <span className="text-sm font-black font-mono">{p.quantity}</span>
                                            <span className="text-[9px] text-slate-300 ml-1">UNITS</span>
                                        </td>
                                        <td className="p-6 text-slate-400 truncate max-w-[150px]">{p.supplier}</td>
                                        <td className="p-6">
                                            <div className="flex items-center gap-2">
                                                <CalendarDays size={14} className="text-slate-300"/>
                                                <span className={diff <= 0 ? 'text-rose-600 font-black' : 'text-slate-800'}>{p.expiryDate}</span>
                                            </div>
                                        </td>
                                        <td className="p-6 pr-10 text-center">
                                            <div className={`px-4 py-1.5 rounded-xl font-black text-[9px] tracking-widest inline-flex items-center gap-2 ${diff <= 0 ? 'bg-rose-600 text-white animate-pulse' : diff <= 30 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                                {diff <= 0 ? 'TERMINATED' : diff <= 30 ? 'CRITICAL' : 'WARNING'}
                                                <span className="opacity-50">({diff <= 0 ? 'Overdue' : `${diff}d left`})</span>
                                            </div>
                                        </td>
                                    </tr>
                                  );
                              })}
                              {analytics.expiringSoon.length === 0 && (
                                  <tr>
                                      <td colSpan={6} className="py-40 text-center opacity-20">
                                          <CheckCircle size={80} className="mx-auto mb-6 text-teal-600"/>
                                          <p className="font-black uppercase tracking-[0.5em] text-xs">Zero Registry Risks Detected</p>
                                      </td>
                                  </tr>
                              )}
                          </tbody>
                      </table>
                  </div>

                  <div className="p-10 border-t bg-slate-900 text-white flex justify-between items-center rounded-b-[4rem]">
                      <div className="flex items-center gap-6">
                          <div className="flex flex-col">
                              <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-1">Authorization</p>
                              <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-teal-400"></div><span className="text-xs font-black uppercase tracking-tight">Active Node Auditor</span></div>
                          </div>
                      </div>
                      <div className="text-right">
                          <p className="text-[9px] font-black uppercase text-teal-400 tracking-widest mb-1">Financial Exposure (Cost)</p>
                          <h4 className="text-3xl font-black font-mono tracking-tighter leading-none"> {analytics.expiringSoon.reduce((s, x) => s + (x.buyingPrice * x.quantity), 0).toLocaleString()}
                          </h4>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* OUT OF STOCK DETAIL MODAL */}
      {showOutOfStockModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[2000] flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="bg-white rounded-[4rem] shadow-4xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col border border-white/20">
                  <div className="p-10 border-b bg-slate-50 flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-5">
                          <div className="p-4 bg-amber-600 text-white rounded-3xl shadow-xl shadow-amber-200"><AlertOctagon size={32}/></div>
                          <div>
                              <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tighter leading-none mb-2">Zero Stock Inventory Alert</h2>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                  <Filter size={12}/> Scope: {categoryFilter} • Items Flagged: {analytics.outOfStockCount}
                              </p>
                          </div>
                      </div>
                      <div className="flex items-center gap-4">
                          <button 
                            onClick={handleExportOutOfStockList}
                            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
                          >
                            <FileSpreadsheet size={18}/> Export Excel
                          </button>
                          <button 
                            onClick={() => setShowOutOfStockModal(false)}
                            className="p-4 hover:bg-slate-200 rounded-full transition-all text-slate-300 hover:text-rose-500"
                          >
                            <X size={32}/>
                          </button>
                      </div>
                  </div>

                  <div className="flex-1 overflow-x-auto overflow-y-auto p-10 no-scrollbar">
                      <table className="w-full text-left border-separate border-spacing-0 min-w-[800px]">
                          <thead className="bg-white text-slate-400 font-black uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm">
                              <tr className="border-b">
                                  <th className="p-6 rounded-l-2xl">Item Registry Name</th>
                                  <th className="p-6">Batch ID</th>
                                  <th className="p-6">Category</th>
                                  <th className="p-6 text-right">Min Stock Level</th>
                                  <th className="p-6">Supplier Source</th>
                                  <th className="p-6">Expiry Timeline</th>
                                  <th className="p-6 text-center rounded-r-2xl pr-10">Stock Status</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 font-bold uppercase text-[11px]">
                              {analytics.outOfStockProducts.map(p => {
                                  return (
                                    <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                                        <td className="p-6 font-black text-slate-800 tracking-tight">{p.name}</td>
                                        <td className="p-6 font-mono text-indigo-600">{p.batchNumber || '---'}</td>
                                        <td className="p-6 font-semibold text-slate-500">{p.type}</td>
                                        <td className="p-6 text-right">
                                            <span className="text-sm font-black font-mono text-slate-700">{p.minStockLevel || 0}</span>
                                            <span className="text-[9px] text-slate-400 ml-1">Threshold</span>
                                        </td>
                                        <td className="p-6 text-slate-500 truncate max-w-[150px]">{p.supplier}</td>
                                        <td className="p-6">
                                            <div className="flex items-center gap-2">
                                                <CalendarDays size={14} className="text-slate-300"/>
                                                <span className="text-slate-600">{p.expiryDate}</span>
                                            </div>
                                        </td>
                                        <td className="p-6 pr-10 text-center">
                                            <div className="px-4 py-1.5 rounded-xl font-black text-[9px] tracking-widest inline-flex items-center gap-2 bg-rose-600 text-white animate-pulse">
                                                OUT OF STOCK
                                            </div>
                                        </td>
                                    </tr>
                                  );
                              })}
                              {analytics.outOfStockProducts.length === 0 && (
                                  <tr>
                                      <td colSpan={7} className="py-40 text-center opacity-20">
                                          <CheckCircle size={80} className="mx-auto mb-6 text-teal-600"/>
                                          <p className="font-black uppercase tracking-[0.5em] text-xs">All Products are adequately stocked</p>
                                      </td>
                                  </tr>
                              )}
                          </tbody>
                      </table>
                  </div>

                  <div className="p-10 border-t bg-slate-900 text-white flex justify-between items-center rounded-b-[4rem]">
                      <div className="flex items-center gap-6">
                          <div className="flex flex-col">
                              <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-1">Audit Node</p>
                              <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div><span className="text-xs font-black uppercase tracking-tight">Zero-Stock Alarm Engine Active</span></div>
                          </div>
                      </div>
                      <div className="text-right">
                          <p className="text-[9px] font-black uppercase text-amber-400 tracking-widest mb-1">Flagged Out-Of-Stock Products</p>
                          <h4 className="text-3xl font-black font-mono tracking-tighter leading-none text-red-500">
                              {analytics.outOfStockCount} ITEMS
                          </h4>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
