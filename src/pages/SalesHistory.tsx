import React, { useState, useEffect, useCallback, useMemo, useTransition } from 'react';
import { db } from '../services/db';
import { Sale, UserRole } from '../types';
import { useAppContext } from '../App';
import * as XLSX from 'xlsx';
import { DB_KEYS } from '../constants';
import { Search, Eye, FileText, X, Loader2, History, FileSpreadsheet, Download, Printer, AlertTriangle, ChevronRight, Package, Calendar, RefreshCw, Trash2 } from 'lucide-react';
import { ReceiptTemplate } from '../components/ReceiptTemplate';
import { generateReceiptPDF, generateA4AttachmentPDF, generateEndOfDaySummaryPDF } from '../services/pdfService';

export default function SalesHistory() {
  const { pharmacyInfo, user, globalBranch } = useAppContext();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deferredSearchTerm, setDeferredSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [showEODModal, setShowEODModal] = useState(false);
  const [eodDate, setEodDate] = useState(new Date().toISOString().split('T')[0]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const loadSales = useCallback(async (useCacheFirst = true) => {
    const filterBranch = (list: Sale[]) => {
      return list.filter(sale => {
        if (user?.role === 'ADMIN') {
             if (globalBranch) {
                 if (globalBranch === 'MAIN') return !sale.branch;
                 return sale.branch === globalBranch;
             }
             return true;
        }
        return !sale.branch || sale.branch === user?.branch;
      });
    };

    if (useCacheFirst) {
      const raw = localStorage.getItem(DB_KEYS.SALES);
      if (raw) {
        try {
          const localSales = JSON.parse(raw) || [];
          const filtered = filterBranch(localSales);
          const sortedLocal = filtered.sort((a: Sale, b: Sale) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
          setSales(sortedLocal);
          setLoading(false);
        } catch (e) {}
      }
    }
    try {
      const allSales = await db.getSales() || [];
      const filtered = filterBranch(allSales);
      const sortedSales = filtered.sort((a: Sale, b: Sale) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
      setSales(sortedSales);
    } catch (e) { 
      console.error(e); 
    } finally { 
      setLoading(false); 
    }
  }, [user, globalBranch]);

  useEffect(() => {
    loadSales(true);
    const handleUpdate = (e: any) => { 
        if (e.detail?.key === DB_KEYS.SALES || e.detail?.key === 'all') {
            loadSales(false);
        }
    };
    window.addEventListener('local-data-update', handleUpdate);
    return () => window.removeEventListener('local-data-update', handleUpdate);
  }, [loadSales]);

  // Use deferred search to prevent UI lockup while typing
  useEffect(() => {
    const timer = setTimeout(() => {
        startTransition(() => {
            setDeferredSearchTerm(searchTerm);
            setCurrentPage(1);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filteredSales = useMemo(() => {
    if (!deferredSearchTerm) return sales;
    const lower = deferredSearchTerm.toLowerCase().trim();
    return sales.filter(s => 
        (s.customerName || '').toLowerCase().includes(lower) || 
        (s.receiptNumber || '').toLowerCase().includes(lower)
    );
  }, [sales, deferredSearchTerm]);

  const paginatedSales = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredSales.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredSales, currentPage, itemsPerPage]);

  const totalPages = useMemo(() => {
    return Math.ceil(filteredSales.length / itemsPerPage);
  }, [filteredSales, itemsPerPage]);

  const handleVoid = async (sale: Sale) => {
    if (!window.confirm(`CRITICAL: Reverse transaction ${sale.receiptNumber}? This will restock all items and log as VOIDED.`)) return;
    setIsVoiding(true);
    try {
        await db.voidSale(sale.id, user!);
        await loadSales();
        setSelectedSale(null);
    } catch (e) { alert("Void failed."); } finally { setIsVoiding(false); }
  };

  const exportJournalToCSV = () => {
    const csvHeader = [
        'Receipt #', 
        'Date & Time', 
        'Cashier', 
        'Customer Name', 
        'Status', 
        'Grand Total', 
        'Payment Methods',
        'Items (Qty x Name)'
    ];

    const csvBody = sales.map(s => {
        const pmStrings = (s.paymentMethods || []).map(pm => `${pm.method} (${pm.amount})`).join(' | ');
        const itemsString = (s.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ');
        
        return [
            s.receiptNumber,
            new Date(s.date).toLocaleString(),
            s.soldBy,
            s.customerName || 'Walk-in',
            s.status || 'COMPLETED',
            s.grandTotal,
            pmStrings,
            itemsString
        ];
    });

    const data = [csvHeader, ...csvBody];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Journal");
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    const dStr = new Date().toISOString().split('T')[0];
    link.download = `Transaction_Audit_Trail_${dStr}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic">
              <History className="text-teal-600" size={32} /> Forensic Ledger
            </h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1 ml-1">Universal Transaction Archive</p>
        </div>
        <div className="flex items-center gap-3">
            <button onClick={() => setShowEODModal(true)} className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl active:scale-95 hover:bg-indigo-700 transition-all">
              <Printer size={16} /> End of Day Summary
            </button>
            <button onClick={exportJournalToCSV} className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl active:scale-95 hover:bg-emerald-700 transition-all">
              <FileSpreadsheet size={16} /> Export Excel
            </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row gap-6 items-end">
        <div className="flex-1 space-y-2">
            <div className="flex justify-between px-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Quick Filter</label>
                {(isPending || loading) && <span className="text-[8px] font-black text-teal-600 animate-pulse uppercase tracking-widest">Searching...</span>}
            </div>
            <div className="relative">
                <Search className="absolute left-4 top-3.5 text-slate-300" size={18} />
                <input 
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border-2 border-transparent focus:border-teal-500 rounded-2xl outline-none font-bold text-sm transition-all shadow-inner" 
                    placeholder="Patient Entity or Verification ID..." 
                    value={searchTerm} 
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden min-h-[400px]">
        <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left text-sm border-separate border-spacing-0">
            <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest sticky top-0 z-10 shadow-sm">
                <tr>
                    <th className="p-6 pl-10">Verification ID</th>
                    <th className="p-6">Patient Entity</th>
                    <th className="p-6">Items Dispensed</th>
                    <th className="p-6 text-right">Settled Value</th>
                    <th className="p-6 text-center pr-10">Action</th>
                </tr>
            </thead>
            <tbody className={`divide-y divide-slate-50 font-bold uppercase text-[10px] ${isPending ? 'opacity-50' : 'opacity-100'} transition-opacity`}>
                {loading && sales.length === 0 ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                            <td className="p-6 pl-10"><div className="h-4 bg-slate-200 rounded-lg w-24 mb-2"></div><div className="h-3 bg-slate-100 rounded-lg w-16"></div></td>
                            <td className="p-6"><div className="h-4 bg-slate-200 rounded-lg w-32"></div></td>
                            <td className="p-6"><div className="flex gap-2"><div className="h-5 bg-slate-100 rounded-lg w-16"></div><div className="h-5 bg-slate-100 rounded-lg w-20"></div></div></td>
                            <td className="p-6 text-right"><div className="h-4 bg-slate-200 rounded-lg w-16 ml-auto"></div></td>
                            <td className="p-6 pr-10 text-center"><div className="h-8 bg-slate-100 rounded-xl w-10 mx-auto"></div></td>
                        </tr>
                    ))
                ) : (
                    paginatedSales.map(sale => (
                        <tr key={sale.id} className={`hover:bg-slate-50 transition-colors group ${sale.status === 'VOIDED' ? 'opacity-40 grayscale' : ''}`}>
                            <td className="p-6 pl-10">
                                <div className="font-black text-teal-800 tracking-tight text-xs">{sale.receiptNumber}</div>
                                <div className="text-[9px] text-slate-400 font-bold uppercase mt-1">{new Date(sale.date).toLocaleDateString()}</div>
                            </td>
                            <td className="p-6 text-slate-800 text-xs tracking-tight">{sale.customerName}</td>
                            <td className="p-6">
                                <div className="flex flex-wrap gap-1">
                                    {sale.items.slice(0, 3).map((item, idx) => (
                                        <span key={idx} className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest truncate max-w-[120px]">
                                            {item.name} ({item.cartQty})
                                        </span>
                                    ))}
                                    {sale.items.length > 3 && <span className="text-[8px] font-black text-teal-600 uppercase ml-1 font-mono">+{sale.items.length - 3}</span>}
                                </div>
                            </td>
                            <td className="p-6 text-right font-black text-slate-800 font-mono text-sm tracking-tighter">{sale.grandTotal.toFixed(2)}</td>
                            <td className="p-6 pr-10 text-center">
                            <button onClick={() => setSelectedSale(sale)} className="bg-white border-2 p-2.5 rounded-2xl text-slate-300 border-slate-100 hover:text-teal-600 hover:border-teal-100 transition-all shadow-sm active:scale-95 group-hover:shadow-md">
                                <Eye size={18} />
                            </button>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
            </table>
            {!loading && filteredSales.length === 0 && (
                <div className="p-20 text-center flex flex-col items-center opacity-10">
                    <History size={100} strokeWidth={1} />
                    <p className="text-[10px] font-black uppercase tracking-[0.5em] mt-6">Zero Matches Found</p>
                </div>
            )}
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Showing <span className="text-slate-800 font-mono">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="text-slate-800 font-mono">{Math.min(currentPage * itemsPerPage, filteredSales.length)}</span> of <span className="text-slate-800 font-mono">{filteredSales.length}</span> Records
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border ${
                currentPage === 1
                  ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                  : 'bg-white text-teal-700 border-teal-100 hover:bg-teal-50 active:scale-95'
              }`}
            >
              Previous
            </button>
            
            {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
              let pageNum = currentPage;
              if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              
              if (pageNum < 1 || pageNum > totalPages) return null;
              
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-8 h-8 rounded-xl text-[10px] font-black font-mono transition-all border ${
                    currentPage === pageNum
                      ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                      : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border ${
                currentPage === totalPages
                  ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                  : 'bg-white text-teal-700 border-teal-100 hover:bg-teal-50 active:scale-95'
              }`}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selectedSale && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center backdrop-blur-md p-4">
           <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
              <div className="p-8 border-b flex justify-between items-center bg-slate-50 rounded-t-[3rem]">
                 <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl shadow-lg text-white ${selectedSale.status === 'VOIDED' ? 'bg-rose-600' : 'bg-teal-600'}`}><FileText size={24}/></div>
                    <div><h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter leading-none">{selectedSale.status === 'VOIDED' ? 'Voided Record' : 'Forensic Detail'}</h2><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Ref: {selectedSale.receiptNumber}</p></div>
                 </div>
                 <button onClick={() => setSelectedSale(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-rose-500"><X size={32}/></button>
              </div>
              <div className="flex-1 overflow-auto p-10 bg-slate-50/50 flex flex-col md:flex-row gap-10 no-scrollbar">
                 <div className="shadow-2xl ring-1 ring-slate-200 transform scale-90 origin-top bg-white shrink-0">
                    <ReceiptTemplate sale={selectedSale} info={pharmacyInfo} />
                 </div>
                 
                 <div className="flex-1 space-y-8 py-6">
                    <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 mb-6 flex items-center gap-2"><Package size={18} className="text-indigo-500"/> Itemized Assets</h3>
                        <div className="space-y-4">
                            {selectedSale.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <div><p className="font-black text-slate-800 uppercase text-xs">{item.name}</p><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-1">Batch: {item.batchNumber || 'N/A'}</p></div>
                                    <div className="text-right"><p className="font-black text-teal-800 text-sm">{item.cartQty} <span className="text-[9px] opacity-50">units</span></p><p className="text-[10px] font-bold text-slate-400 font-mono tracking-tighter">{(item.sellingPrice * item.cartQty).toFixed(2)}</p></div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-teal-600 mb-6 flex items-center gap-2"><Download size={18}/> Registry Copies</h3>
                            <div className="space-y-3">
                                <button onClick={() => generateReceiptPDF(selectedSale, pharmacyInfo)} className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all group">
                                    <div className="flex items-center gap-3"><div className="p-2 bg-white rounded-xl shadow-sm"><Download size={18} className="text-slate-400 group-hover:text-teal-600"/></div><span className="text-[10px] font-black uppercase tracking-widest">Receipt PDF</span></div>
                                    <ChevronRight size={14} className="text-slate-300"/>
                                </button>
                                <button onClick={() => generateA4AttachmentPDF(selectedSale, pharmacyInfo)} className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all group">
                                    <div className="flex items-center gap-3"><div className="p-2 bg-white rounded-xl shadow-sm"><FileText size={18} className="text-slate-400 group-hover:text-indigo-600"/></div><span className="text-[10px] font-black uppercase tracking-widest">Dispensing Manifest</span></div>
                                    <ChevronRight size={14} className="text-slate-300"/>
                                </button>
                            </div>
                        </div>
                        {selectedSale.status !== 'VOIDED' && user?.role === UserRole.ADMIN && (
                            <div className="bg-rose-50/50 p-8 rounded-[2rem] border border-rose-100">
                                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-rose-500 mb-6 flex items-center gap-2"><AlertTriangle size={18}/> Registry Void</h3>
                                <p className="text-[10px] text-rose-400 font-bold uppercase tracking-tight mb-6 leading-relaxed">Reverse this transaction to restore stock and record deletion. Action is permanent.</p>
                                <button onClick={() => handleVoid(selectedSale)} disabled={isVoiding} className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-rose-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-rose-200">
                                    {isVoiding ? <RefreshCw className="animate-spin" size={18}/> : <Trash2 size={18}/>} Void Transaction
                                </button>
                            </div>
                        )}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {showEODModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-[110] flex items-center justify-center backdrop-blur-md p-4">
           <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
               <div className="p-6 border-b bg-indigo-50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                       <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg"><Calendar size={20}/></div>
                       <h2 className="font-black text-slate-800 uppercase tracking-tight text-lg">End of Day</h2>
                   </div>
                   <button onClick={() => setShowEODModal(false)} className="text-slate-400 hover:text-rose-500 transition-colors"><X size={24}/></button>
               </div>
               <div className="p-6">
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Select Date</label>
                   <input type="date" value={eodDate} onChange={e => setEodDate(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold shadow-sm outline-none focus:border-indigo-300" max={new Date().toISOString().split('T')[0]} />
                   
                   <button onClick={() => {
                       generateEndOfDaySummaryPDF(sales, eodDate, pharmacyInfo);
                       setShowEODModal(false);
                   }} className="mt-8 w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
                       <Printer size={16}/> Generate PDF Report
                   </button>
               </div>
           </div>
        </div>
      )}
    </div>
  );
}
