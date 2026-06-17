import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../services/db';
import { subscribeToChanges, unsubscribeFromChanges } from '../services/socket';
import { BinCardEntry, ProductCategory } from '../types';
import { useAppContext } from '../App';
import { MED_CATEGORIES, DB_KEYS } from '../constants';
import { Search, ClipboardList, ArrowLeft, Printer, Download, Filter, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, Beaker, Sparkles, X, Loader2 } from 'lucide-react';

interface AggregatedProduct {
  name: string;
  type: ProductCategory;
  category: string;
  unit: string;
  totalStock: number;
  maxPrice: number;
  ids: string[]; // All product IDs (batches) that share this name
}

interface ConsolidatedEntry extends BinCardEntry {
  runningBalance: number;
}

export default function BinCards() {
  const { pharmacyInfo, globalBranch, user } = useAppContext();
  const [aggregatedProducts, setAggregatedProducts] = useState<AggregatedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search & Filter State
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductCategory.MEDICINE | ProductCategory.COSMETIC>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortBy, setSortBy] = useState<'NAME' | 'STOCK' | 'PRICE' | 'CATEGORY'>('NAME');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
  
  // Detail View State
  const [selectedProduct, setSelectedProduct] = useState<AggregatedProduct | null>(null);
  const [consolidatedEntries, setConsolidatedEntries] = useState<ConsolidatedEntry[]>([]);

  const loadData = useCallback(async () => {
    try {
        const allProducts = await db.getProducts();
        
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

        const branchFilteredProducts = allProducts.filter((p: any) => !p.isDeleted && matchesBranch(p.branch));

        // Aggregate products by Name
        const map = new Map<string, AggregatedProduct>();

        branchFilteredProducts.forEach((p: any) => {
            const key = p.name.trim().toLowerCase();
            
            if (!map.has(key)) {
                map.set(key, {
                    name: p.name,
                    type: p.type,
                    category: p.type === ProductCategory.COSMETIC ? 'Cosmetics' : (p.medCategory || 'Medicine'),
                    unit: p.unit || 'N/A',
                    totalStock: 0,
                    maxPrice: 0,
                    ids: []
                });
            }
            
            const agg = map.get(key)!;
            agg.totalStock += p.quantity;
            agg.maxPrice = Math.max(agg.maxPrice, p.sellingPrice);
            agg.ids.push(p.id);
        });

        setAggregatedProducts(Array.from(map.values()));
    } catch (e) {
        console.error("Failed to load bin card data", e);
    } finally {
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const handleSocketUpdate = (data: { key: string }) => {
        if (data.key === DB_KEYS.PRODUCTS) loadData();
    };
    subscribeToChanges(handleSocketUpdate);

    const handleLocalUpdate = (e: any) => {
        if (e.detail?.key === DB_KEYS.PRODUCTS) loadData();
    };
    window.addEventListener('local-data-update', handleLocalUpdate);

    return () => {
        unsubscribeFromChanges(handleSocketUpdate);
        window.removeEventListener('local-data-update', handleLocalUpdate);
    };
  }, [loadData]);

  const handleSelectProduct = async (agg: AggregatedProduct) => {
    let allEntries: BinCardEntry[] = [];
    const promises = agg.ids.map(id => db.getBinCards(id));
    const results = await Promise.all(promises);
    
    results.forEach((entries: any) => {
        allEntries = [...allEntries, ...entries];
    });

    allEntries.sort((a, b) => ((a.date || '') > (b.date || '') ? 1 : (a.date || '') < (b.date || '') ? -1 : 0));

    let balance = 0;
    const computedEntries = allEntries.map(entry => {
      const change = entry.inQty - entry.outQty;
      balance += change;
      return {
        ...entry,
        runningBalance: balance
      };
    });

    setConsolidatedEntries(computedEntries);
    setSelectedProduct(agg);
  };

  const exportCSV = () => {
    if (!selectedProduct || !pharmacyInfo) return;

    const csvRows = [
      ['PHARMACY BIN CARD REPORT'],
      [`Pharmacy Name,${pharmacyInfo.name}`],
      [`Address,${pharmacyInfo.address}`],
      [`Phone,${pharmacyInfo.phone}`],
      [`TIN,${pharmacyInfo.tin}`],
      [],
      [`Item Name,${selectedProduct.name}`],
      [`Category,${selectedProduct.category}`],
      [`Unit,${selectedProduct.unit}`],
      [`Current Total Balance,${selectedProduct.totalStock}`],
      [],
      ['Date', 'Received From / Issued To', 'Batch Number', 'Expiry Date', 'Qty Received', 'Qty Issued', 'Balance', 'User']
    ];

    consolidatedEntries.forEach((entry: any) => {
      const safeRef = `"${entry.reference.replace(/"/g, '""')}"`;
      csvRows.push([
        new Date(entry.date).toLocaleDateString(),
        safeRef,
        entry.batchNumber || '-',
        entry.expiryDate || '-',
        entry.inQty > 0 ? entry.inQty.toString() : '0',
        entry.outQty > 0 ? entry.outQty.toString() : '0',
        entry.runningBalance.toString(),
        entry.user
      ]);
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BinCard_${selectedProduct.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredList = useMemo(() => {
    return aggregatedProducts.filter(p => {
        const s = search.toLowerCase();
        const matchesSearch = 
          p.name.toLowerCase().includes(s) || 
          p.category.toLowerCase().includes(s) ||
          p.unit.toLowerCase().includes(s);
        
        const matchesType = typeFilter === 'ALL' ? true : p.type === typeFilter;
        
        const matchesCategory = categoryFilter ? p.category === categoryFilter : true;
        
        return matchesSearch && matchesType && matchesCategory;
      }).sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'NAME') cmp = a.name.localeCompare(b.name);
        else if (sortBy === 'CATEGORY') cmp = a.category.localeCompare(b.category);
        else if (sortBy === 'STOCK') cmp = a.totalStock - b.totalStock;
        else if (sortBy === 'PRICE') cmp = a.maxPrice - b.maxPrice;
        
        return sortOrder === 'ASC' ? cmp : -cmp;
      });
  }, [aggregatedProducts, search, typeFilter, categoryFilter, sortBy, sortOrder]);

  if (selectedProduct) {
    return (
      <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 animate-in fade-in slide-in-from-right-4 duration-300">
        {/* Bin Card Header */}
        <div className="p-6 border-b bg-teal-50">
           <div className="flex justify-between items-start mb-6 no-print">
              <button 
                onClick={() => setSelectedProduct(null)} 
                className="flex items-center gap-2 text-gray-600 hover:text-teal-700 font-black uppercase text-xs tracking-widest"
              >
                <ArrowLeft size={18}/> Back to List
              </button>
              <div className="flex gap-2">
                <button 
                  onClick={exportCSV} 
                  className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-sm font-bold text-sm"
                >
                  <Download size={18}/> Export Excel
                </button>
                <button 
                  onClick={() => window.print()} 
                  className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors shadow-sm font-bold text-sm"
                >
                  <Printer size={18}/> Print Card
                </button>
              </div>
           </div>

           <div className="text-center mb-6 border-b border-teal-200 pb-4">
             <h2 className="text-2xl font-black text-teal-900 uppercase tracking-widest">{pharmacyInfo?.name || 'Bin Card'}</h2>
             <p className="text-sm text-teal-700 font-medium">{pharmacyInfo?.address}</p>
             <p className="text-xs text-teal-600 mt-1 font-bold">Phone: {pharmacyInfo?.phone} | TIN: {pharmacyInfo?.tin}</p>
           </div>

           <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-white p-4 rounded-xl border border-teal-100 shadow-inner">
              <div>
                <span className="block text-gray-400 text-[10px] uppercase font-black tracking-widest">Item Name</span>
                <span className="text-lg font-black text-gray-800 leading-tight">{selectedProduct.name}</span>
              </div>
              <div>
                <span className="block text-gray-400 text-[10px] uppercase font-black tracking-widest">Category</span>
                <span className="text-gray-800 font-bold">{selectedProduct.category}</span>
              </div>
              <div>
                <span className="block text-gray-400 text-[10px] uppercase font-black tracking-widest">Unit</span>
                <span className="text-gray-800 font-bold">{selectedProduct.unit}</span>
              </div>
              <div>
                <span className="block text-gray-400 text-[10px] uppercase font-black tracking-widest">Total Balance</span>
                <span className="text-2xl font-black text-teal-700">{selectedProduct.totalStock}</span>
              </div>
           </div>
        </div>

        {/* Entries Table */}
        <div className="flex-1 overflow-auto p-6">
          <table className="w-full text-sm border-collapse border border-gray-200">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="border border-gray-200 p-3 text-left uppercase text-[10px] font-black tracking-widest">Date</th>
                <th className="border border-gray-200 p-3 text-left w-1/3 uppercase text-[10px] font-black tracking-widest">Received From / Issued To</th>
                <th className="border border-gray-200 p-3 text-left uppercase text-[10px] font-black tracking-widest">Batch #</th>
                <th className="border border-gray-200 p-3 text-left uppercase text-[10px] font-black tracking-widest">Expiry</th>
                <th className="border border-gray-200 p-3 text-right uppercase text-[10px] font-black tracking-widest">In</th>
                <th className="border border-gray-200 p-3 text-right uppercase text-[10px] font-black tracking-widest">Out</th>
                <th className="border border-gray-200 p-3 text-right font-black bg-gray-100 uppercase text-[10px] tracking-widest">Balance</th>
                <th className="border border-gray-200 p-3 text-left uppercase text-[10px] font-black tracking-widest">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {consolidatedEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                  <td className="border border-gray-200 p-3 whitespace-nowrap font-mono text-xs text-gray-500">{new Date(entry.date).toLocaleDateString()}</td>
                  <td className="border border-gray-200 p-3 font-bold text-gray-700">{entry.reference}</td>
                  <td className="border border-gray-200 p-3 font-mono text-[10px] text-indigo-600">{entry.batchNumber || '-'}</td>
                  <td className="border border-gray-200 p-3 text-xs text-gray-500">{entry.expiryDate || '-'}</td>
                  <td className="border border-gray-200 p-3 text-right text-emerald-600 font-black">
                    {entry.inQty > 0 ? `+${entry.inQty}` : ''}
                  </td>
                  <td className="border border-gray-200 p-3 text-right text-rose-600 font-black">
                    {entry.outQty > 0 ? `-${entry.outQty}` : ''}
                  </td>
                  <td className="border border-gray-200 p-3 text-right font-black bg-gray-50 text-teal-800">{entry.runningBalance}</td>
                  <td className="border border-gray-200 p-3 text-[10px] text-gray-400 font-bold uppercase">@{entry.user}</td>
                </tr>
              ))}
              {consolidatedEntries.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center p-12 text-gray-400 italic font-bold uppercase tracking-widest text-[10px]">No activity recorded.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-12 pt-12 border-t border-dashed border-gray-200 flex justify-end gap-24 print-only">
             <div className="text-center">
               <div className="w-56 border-b-2 border-black mb-2"></div>
               <p className="text-[10px] font-black uppercase">Inventory Manager</p>
             </div>
             <div className="text-center">
               <div className="w-56 border-b-2 border-black mb-2"></div>
               <p className="text-[10px] font-black uppercase">Branch Pharmacist</p>
             </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
          <ClipboardList className="text-teal-600" /> Bin Cards & Stock Ledger
        </h1>
        <div className="text-xs font-black text-gray-400 uppercase tracking-widest">
            History Tracking Enabled
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col h-[calc(100vh-180px)] overflow-hidden">
         <div className="p-4 border-b flex flex-col lg:flex-row gap-4 bg-gray-50">
           <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
              <input 
                type="text" 
                placeholder="Find item ledger by name..." 
                className="w-full pl-10 pr-4 py-2 border-2 border-transparent focus:border-teal-500 rounded-xl outline-none bg-white shadow-sm font-bold text-sm transition-all"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
           </div>
           
           <div className="flex gap-2 items-center overflow-x-auto no-scrollbar">
              <div className="relative min-w-[150px]">
                <LayoutGrid className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <select 
                  className="w-full pl-9 pr-8 py-2 border rounded-xl outline-none cursor-pointer bg-white text-xs font-black uppercase tracking-tighter text-gray-600 appearance-none shadow-sm hover:border-teal-500"
                  value={typeFilter}
                  onChange={(e) => {
                      setTypeFilter(e.target.value as any);
                      setCategoryFilter(''); 
                  }}
                >
                  <option value="ALL">All Stocks</option>
                  <option value={ProductCategory.MEDICINE}>Medicines Only</option>
                  <option value={ProductCategory.COSMETIC}>Cosmetics Only</option>
                </select>
              </div>

              {typeFilter !== ProductCategory.COSMETIC && (
                <div className="relative min-w-[180px] animate-in slide-in-from-left-2 duration-200">
                    <Filter className="absolute left-3 top-2.5 text-gray-400" size={16} />
                    <select 
                    className="w-full pl-9 pr-8 py-2 border rounded-xl outline-none cursor-pointer bg-white text-xs font-black uppercase tracking-tighter text-gray-600 appearance-none shadow-sm hover:border-teal-500"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                    <option value="">All Med-Categories</option>
                    {MED_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="Cosmetics">Cosmetics</option>
                    </select>
                </div>
              )}

              <div className="h-6 w-px bg-gray-200 mx-2 hidden lg:block"></div>

              <div className="relative">
                <ArrowUpDown className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <select 
                  className="pl-9 pr-8 py-2 border rounded-xl outline-none cursor-pointer bg-white text-xs font-bold text-gray-600 appearance-none shadow-sm"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                >
                  <option value="NAME">Sort: Name</option>
                  <option value="CATEGORY">Sort: Category</option>
                  <option value="STOCK">Sort: Stock</option>
                  <option value="PRICE">Sort: Price</option>
                </select>
              </div>
              
              <button 
                onClick={() => setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC')}
                className="px-3 py-2 border rounded-xl bg-white hover:bg-gray-100 transition-colors flex items-center justify-center shadow-sm"
              >
                {sortOrder === 'ASC' ? <ArrowUp size={18} className="text-teal-600"/> : <ArrowDown size={18} className="text-rose-600"/>}
              </button>
           </div>
         </div>

         {loading ? <div className="p-20 text-center"><Loader2 className="animate-spin mx-auto text-teal-600 mb-4" size={48}/><p className="text-xs font-black uppercase text-gray-400 tracking-widest">Initializing Ledger...</p></div> : (
         <div className="flex-1 overflow-auto no-scrollbar">
           <table className="w-full text-left text-sm">
             <thead className="bg-gray-50 sticky top-0 z-10 text-gray-400 font-black uppercase text-[10px] tracking-widest">
               <tr>
                 <th className="p-4">Stock Entity</th>
                 <th className="p-4">Classification</th>
                 <th className="p-4">Category</th>
                 <th className="p-4 text-right">Avg Price</th>
                 <th className="p-4 text-right">Aggregated Stock</th>
                 <th className="p-4 text-center">Action</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-gray-50">
               {filteredList.map((p, idx) => (
                 <tr key={idx} className="hover:bg-teal-50/50 group transition-all">
                   <td className="p-4">
                        <div className="font-black text-gray-800 tracking-tight">{p.name}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">{p.unit} Packing</div>
                   </td>
                   <td className="p-4">
                      <div className="flex items-center gap-1.5">
                        {p.type === ProductCategory.MEDICINE ? (
                            <Beaker size={14} className="text-blue-500" />
                        ) : (
                            <Sparkles size={14} className="text-pink-500" />
                        )}
                        <span className={`text-[10px] font-black uppercase tracking-widest ${p.type === ProductCategory.MEDICINE ? 'text-blue-600' : 'text-pink-600'}`}>
                            {p.type}
                        </span>
                      </div>
                   </td>
                   <td className="p-4">
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] font-bold text-gray-500 uppercase tracking-tighter border border-gray-200">{p.category}</span>
                   </td>
                   <td className="p-4 text-right text-gray-400 font-mono text-xs tracking-tighter">
                        <span className="opacity-50"></span> {p.maxPrice.toFixed(2)}
                   </td>
                   <td className="p-4 text-right">
                        <span className={`font-black text-lg ${p.totalStock < 10 ? 'text-rose-500' : 'text-teal-700'}`}>{p.totalStock}</span>
                        <span className="text-[10px] text-gray-400 ml-1 font-bold uppercase">units</span>
                   </td>
                   <td className="p-4 text-center">
                     <button 
                       onClick={() => handleSelectProduct(p)}
                       className="px-6 py-2 bg-white border-2 border-teal-500 text-teal-700 rounded-xl hover:bg-teal-500 hover:text-white transition-all text-xs font-black uppercase tracking-widest shadow-sm active:scale-95"
                     >
                       Trace Ledger
                     </button>
                   </td>
                 </tr>
               ))}
               {filteredList.length === 0 && (
                 <tr>
                   <td colSpan={6} className="p-24 text-center text-gray-400">
                      <div className="flex flex-col items-center gap-4 opacity-30">
                        <Filter size={64} className="animate-pulse"/>
                        <p className="font-black uppercase tracking-widest text-xs">No records found matching criteria</p>
                        <button onClick={() => { setSearch(''); setTypeFilter('ALL'); setCategoryFilter(''); }} className="text-teal-600 underline font-bold text-xs">Clear All Filters</button>
                      </div>
                   </td>
                 </tr>
               )}
             </tbody>
           </table>
         </div>
         )}
      </div>
    </div>
  );
}
