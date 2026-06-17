import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../services/db';
import { Supplier, UserRole, SupplierTransaction, Product } from '../types';
import { DB_KEYS } from '../constants';
import { useAppContext } from '../App';
import { 
  Plus, Trash2, Edit, Truck, Phone, Mail, MapPin, 
  Wallet, Receipt, History, X, Save, 
  ArrowUpRight, ArrowDownLeft, Calendar, User, 
  Landmark, FileText, CheckCircle2,
  Package, FileSpreadsheet, Download, Coins, Clock, ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function Suppliers() {
  const { user } = useAppContext();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [isProcurementOpen, setIsProcurementOpen] = useState(false);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [txType, setTxType] = useState<'PURCHASE_CREDIT' | 'PAYMENT'>('PURCHASE_CREDIT');

  const initialFormState: Supplier = {
    id: '', name: '', contactPerson: '', phone: '', email: '', address: ''
  };
  const [formData, setFormData] = useState<Supplier>(initialFormState);

  const initialTxState = {
    amount: 0, date: new Date().toISOString().split('T')[0], 
    dueDate: '', reference: '', notes: '', linkedCreditId: ''
  };
  const [txData, setTxData] = useState(initialTxState);

  const loadData = useCallback(async () => {
    const [s, t, p] = await Promise.all([
      db.getSuppliers(), 
      db.getSupplierTransactions(), 
      db.getProducts()
    ]);
    const suppliersArr = Array.isArray(s) ? s : [];
    const productsArr = Array.isArray(p) ? p : [];
    setSuppliers(suppliersArr.filter((x: any) => !x.isDeleted));
    setTransactions(t || []);
    setProducts(productsArr.filter((x: any) => !x.isDeleted));
  }, []);

  useEffect(() => {
    loadData();
    const handleUpdate = (e: any) => {
        if (e.detail && [DB_KEYS.SUPPLIERS, DB_KEYS.SUPPLIER_TRANSACTIONS, DB_KEYS.PRODUCTS, 'all'].includes(e.detail.key)) loadData();
    };
    window.addEventListener('local-data-update', handleUpdate);
    return () => window.removeEventListener('local-data-update', handleUpdate);
  }, [loadData]);

  const supplierBalances = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((t: SupplierTransaction) => {
        const current: number = map.get(t.supplierId) || 0;
        if (t.type === 'PURCHASE_CREDIT') map.set(t.supplierId, current + t.amount);
        else map.set(t.supplierId, current - t.amount);
    });
    return map;
  }, [transactions]);

  const totalOutstanding = useMemo(() => {
      return Array.from(supplierBalances.values()).reduce((sum: number, val: number) => sum + Math.max(0, val), 0);
  }, [supplierBalances]);

  const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) await db.updateSupplier(formData);
    else await db.addSupplier({ ...formData, id: generateId() });
    closeModal();
    loadData();
  };

  const handleSaveTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier || !user) return;
    
    let targetCreditId = txType === 'PAYMENT' ? txData.linkedCreditId : undefined;

    // Auto-match reference if not linked explicitly
    if (txType === 'PAYMENT' && !targetCreditId && txData.reference) {
        const trimmedRef = txData.reference.trim().toUpperCase();
        if (trimmedRef) {
            const matchedCredit = transactions.find(t => 
                t.supplierId === selectedSupplier.id && 
                t.type === 'PURCHASE_CREDIT' && 
                t.reference && 
                t.reference.trim().toUpperCase() === trimmedRef
            );
            if (matchedCredit) {
                targetCreditId = matchedCredit.id;
            }
        }
    }

    if (editingTxId) {
        const oldTx = transactions.find(t => t.id === editingTxId);
        
        const updatedTx: SupplierTransaction = {
            id: editingTxId,
            supplierId: selectedSupplier.id,
            type: txType,
            amount: txData.amount,
            date: txData.date,
            dueDate: txType === 'PURCHASE_CREDIT' ? txData.dueDate : undefined,
            reference: txData.reference,
            notes: txData.notes,
            recordedBy: user.username,
            linkedCreditId: txType === 'PAYMENT' ? targetCreditId : undefined
        };

        if (txType === 'PAYMENT') {
            if (targetCreditId) {
                const creditTx = transactions.find(t => t.id === targetCreditId);
                if (creditTx && creditTx.type === 'PURCHASE_CREDIT') {
                    const oldAmount = oldTx && oldTx.type === 'PAYMENT' && oldTx.linkedCreditId === targetCreditId ? oldTx.amount : 0;
                    const newPaidAmount = Math.max(0, (creditTx.paidAmount || 0) - oldAmount + txData.amount);
                    
                    let newStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'PARTIAL';
                    if (newPaidAmount >= creditTx.amount) newStatus = 'PAID';
                    else if (newPaidAmount <= 0) newStatus = 'UNPAID';

                    let discrepancyRemark = '';
                    const amtDiff = txData.amount - creditTx.amount;
                    if (amtDiff < 0) {
                        discrepancyRemark = `Underpaid by ${Math.abs(amtDiff).toFixed(2)} (Payment: ${txData.amount.toFixed(2)}, Invoice: ${creditTx.amount.toFixed(2)})`;
                    } else if (amtDiff > 0) {
                        discrepancyRemark = `Overpaid by ${Math.abs(amtDiff).toFixed(2)} (Payment: ${txData.amount.toFixed(2)}, Invoice: ${creditTx.amount.toFixed(2)})`;
                    } else {
                        discrepancyRemark = `Fully matched (Exact payment of ${txData.amount.toFixed(2)})`;
                    }

                    await db.updateSupplierTransaction({
                        ...creditTx,
                        paidAmount: newPaidAmount,
                        status: newStatus,
                        discrepancyRemark: discrepancyRemark
                    });

                    updatedTx.discrepancyRemark = discrepancyRemark;
                }
            }
        }

        await db.updateSupplierTransaction(updatedTx);
        await db.logActivity(user, txType, `Updated ${txType} for ${selectedSupplier.name}: ${txData.amount}`);
    } else {
        const newTx: SupplierTransaction = {
            id: generateId(),
            supplierId: selectedSupplier.id,
            type: txType,
            amount: txData.amount,
            date: txData.date,
            dueDate: txType === 'PURCHASE_CREDIT' ? txData.dueDate : undefined,
            reference: txData.reference,
            notes: txData.notes,
            recordedBy: user.username,
            linkedCreditId: txType === 'PAYMENT' ? targetCreditId : undefined,
            status: txType === 'PURCHASE_CREDIT' ? 'UNPAID' : undefined,
            paidAmount: txType === 'PURCHASE_CREDIT' ? 0 : undefined
        };

        if (txType === 'PAYMENT' && targetCreditId) {
            const creditTx = transactions.find(t => t.id === targetCreditId);
            if (creditTx && creditTx.type === 'PURCHASE_CREDIT') {
                const newPaidAmount = (creditTx.paidAmount || 0) + txData.amount;
                let newStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'PARTIAL';
                if (newPaidAmount >= creditTx.amount) newStatus = 'PAID';
                else if (newPaidAmount <= 0) newStatus = 'UNPAID';

                let discrepancyRemark = '';
                const amtDiff = txData.amount - creditTx.amount;
                if (amtDiff < 0) {
                    discrepancyRemark = `Underpaid by ${Math.abs(amtDiff).toFixed(2)} (Payment: ${txData.amount.toFixed(2)}, Invoice: ${creditTx.amount.toFixed(2)})`;
                } else if (amtDiff > 0) {
                    discrepancyRemark = `Overpaid by ${Math.abs(amtDiff).toFixed(2)} (Payment: ${txData.amount.toFixed(2)}, Invoice: ${creditTx.amount.toFixed(2)})`;
                } else {
                    discrepancyRemark = `Fully matched (Exact payment of ${txData.amount.toFixed(2)})`;
                }

                await db.updateSupplierTransaction({
                    ...creditTx,
                    paidAmount: newPaidAmount,
                    status: newStatus,
                    discrepancyRemark: discrepancyRemark
                });

                newTx.linkedCreditId = targetCreditId;
                newTx.discrepancyRemark = discrepancyRemark;
            }
        }

        await db.addSupplierTransaction(newTx);
        await db.logActivity(user, txType, `Logged ${txType} for ${selectedSupplier.name}: ${txData.amount}`);
    }

    closeTxModal();
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this supplier record?')) {
      await db.deleteSupplier(id);
      loadData();
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormData(initialFormState);
    setEditingId(null);
  };

  const closeTxModal = () => {
    setIsTxModalOpen(false);
    setEditingTxId(null);
    setTxData(initialTxState);
  };

  const supplierHistory = useMemo(() => {
    if (!selectedSupplier) return [];
    return transactions
        .filter(t => t.supplierId === selectedSupplier.id)
        .sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : (b.date || '') < (a.date || '') ? -1 : 0));
  }, [transactions, selectedSupplier]);

  const supplierPurchases = useMemo(() => {
      if (!selectedSupplier) return [];
      // Link items based on supplier name match
      return products.filter(p => p.supplier?.toLowerCase().trim() === selectedSupplier.name?.toLowerCase().trim());
  }, [products, selectedSupplier]);

  const exportLedger = () => {
    if (!selectedSupplier) return;
    
    let running = 0;
    const processed = [...supplierHistory].reverse().map(t => {
        if (t.type === 'PURCHASE_CREDIT') running += t.amount;
        else running -= t.amount;
        return { ...t, running };
    }).reverse();

    const csvData = [
        ['FISCAL STATEMENT LEDGER', selectedSupplier.name.toUpperCase()],
        ['GENERATED AT', new Date().toLocaleString()],
        [],
        ['DATE', 'REGISTRY ENTRY', 'REFERENCE ID', 'DEBIT (DEBT)', 'CREDIT (PAID)', 'RUNNING NET'],
        ...processed.map(tx => [
            new Date(tx.date).toLocaleDateString(),
            tx.type.replace('_', ' '),
            tx.reference || 'SYSTEM_LOG',
            tx.type === 'PURCHASE_CREDIT' ? tx.amount.toFixed(2) : '-',
            tx.type === 'PAYMENT' ? tx.amount.toFixed(2) : '-',
            tx.running.toFixed(2)
        ])
    ];
    downloadExcel(csvData, `Ledger_${selectedSupplier.name.replace(/\s+/g, '_')}.xlsx`);
  };

  const exportProcurement = () => {
    if (!selectedSupplier) return;
    const csvData = [
        ['ITEMIZED PROCUREMENT STATEMENT', selectedSupplier.name.toUpperCase()],
        ['GENERATED AT', new Date().toLocaleString()],
        [],
        ['MEDICATION NAME', 'CATEGORY', 'BATCH NUMBER', 'EXPIRY', 'QTY PURCHASED', 'UNIT COST', 'TOTAL VALUATION'],
        ...supplierPurchases.map(p => [
            p.name?.toUpperCase() || 'UNKNOWN',
            p.medCategory || 'GENERAL',
            p.batchNumber || 'N/A',
            p.expiryDate || 'N/A',
            p.quantity || 0,
            (p.buyingPrice || 0).toFixed(2),
            ((p.quantity || 0) * (p.buyingPrice || 0)).toFixed(2)
        ])
    ];
    downloadExcel(csvData, `Procurement_${selectedSupplier.name.replace(/\s+/g, '_')}.xlsx`);
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
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic leading-none">
            <Truck className="text-teal-600" size={40} /> Credit Ledger
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 ml-1">Supplier Network & Account Settlements</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-3 px-8 py-3.5 bg-teal-600 text-white rounded-2xl hover:bg-teal-700 shadow-xl font-black uppercase text-[10px] tracking-widest transition-all active:scale-95"
        >
          <Plus size={20} /> Register Supplier
        </button>
      </div>

      {/* AGGREGATE KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-indigo-900 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:rotate-12 transition-transform duration-500"><Landmark size={120}/></div>
              <p className="text-[10px] font-black uppercase text-indigo-300 tracking-[0.2em] mb-4">Total Net Payables</p>
              <h3 className="text-4xl font-black font-mono tracking-tighter leading-none">{totalOutstanding.toLocaleString()}</h3>
              <p className="text-[8px] font-bold text-indigo-400 uppercase mt-8 border-l-2 border-indigo-500 pl-4">Global liabilities across all registered nodes.</p>
          </div>
          <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-teal-50 text-teal-600 rounded-xl"><History size={20}/></div><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Active Accounts</p></div>
              <h3 className="text-3xl font-black text-slate-800 leading-none">{suppliers.length} <span className="text-xs text-slate-300 font-normal">Entities</span></h3>
          </div>
          <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-amber-50 text-amber-600 rounded-xl"><Clock size={20}/></div><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Overdue Settlements</p></div>
              <h3 className="text-3xl font-black text-rose-600 leading-none">
                {transactions.filter(t => t.type === 'PURCHASE_CREDIT' && t.dueDate && new Date(t.dueDate) < new Date()).length}
              </h3>
          </div>
      </div>

      {/* SUPPLIER GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {suppliers.map(supplier => {
          const balance = supplierBalances.get(supplier.id) || 0;
          return (
            <div key={supplier.id} className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 hover:shadow-xl transition-all group relative">
                <div className="flex justify-between items-start mb-6">
                    <div className="flex-1 min-w-0 pr-4">
                        <h3 className="text-lg font-black text-slate-800 uppercase truncate tracking-tight group-hover:text-teal-600 transition-colors">{supplier.name}</h3>
                        <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">ID: {supplier.id.slice(0, 8)}</p>
                    </div>
                    <div className="flex gap-1">
                        <button onClick={() => { setFormData(supplier); setEditingId(supplier.id); setIsModalOpen(true); }} className="p-2 text-slate-300 hover:text-indigo-600 transition-colors"><Edit size={16}/></button>
                        {user?.role === UserRole.ADMIN && <button onClick={() => handleDelete(supplier.id)} className="p-2 text-slate-300 hover:text-rose-600 transition-colors"><Trash2 size={16}/></button>}
                    </div>
                </div>

                <div className="space-y-3 mb-8">
                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-tight"><Phone size={14} className="text-teal-500"/> {supplier.phone || 'N/A'}</div>
                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-tight"><Mail size={14} className="text-teal-500"/> {supplier.email || 'N/A'}</div>
                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-tight truncate"><MapPin size={14} className="text-teal-500"/> {supplier.address || 'N/A'}</div>
                </div>

                <div className={`p-5 rounded-3xl border mb-6 flex justify-between items-center ${balance > 0 ? 'bg-rose-50 border-rose-100 text-rose-800' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                    <div>
                        <p className="text-[8px] font-black uppercase opacity-60 tracking-widest mb-1">Account Balance</p>
                        <p className="text-xl font-black font-mono tracking-tighter">{balance.toLocaleString()}</p>
                    </div>
                    <div className="p-2.5 bg-white rounded-xl shadow-sm"><Wallet size={20} className={balance > 0 ? 'text-rose-500' : 'text-slate-300'}/></div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                    <button 
                        onClick={() => { setSelectedSupplier(supplier); setTxType('PURCHASE_CREDIT'); setIsTxModalOpen(true); }}
                        className="py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2"
                    >
                        <ArrowUpRight size={14}/> Log Credit
                    </button>
                    <button 
                        onClick={() => { setSelectedSupplier(supplier); setIsLedgerOpen(true); }}
                        className="py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                    >
                        <History size={14}/> Ledger
                    </button>
                </div>
                <button 
                    onClick={() => { setSelectedSupplier(supplier); setIsProcurementOpen(true); }}
                    className="w-full py-3 bg-indigo-50 text-indigo-700 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-indigo-100 transition-all flex items-center justify-center gap-2 border border-indigo-100"
                >
                    <Package size={14}/> Item Detail History
                </button>
            </div>
          );
        })}
        {suppliers.length === 0 && (
          <div className="col-span-full py-24 text-center bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
            <Truck size={48} className="mx-auto text-slate-300 mb-4 opacity-20" />
            <p className="text-slate-400 font-black uppercase text-xs tracking-widest">No active suppliers found.</p>
          </div>
        )}
      </div>

      {/* Modal: Add/Edit Supplier */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 flex items-center justify-center z-[200] p-4 backdrop-blur-xl animate-in fade-in">
          <div className="bg-white rounded-[3rem] shadow-3xl w-full max-w-xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b bg-slate-50 flex justify-between items-center">
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter italic">{editingId ? 'Modify Entity' : 'Vendor Registry'}</h2>
              <button onClick={closeModal} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={32} className="text-slate-300"/></button>
            </div>
            <form onSubmit={handleSaveSupplier} className="p-10 space-y-6">
              <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Entity Name</label><input required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black uppercase outline-none focus:ring-2 focus:ring-teal-500" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Contact Person</label><input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" value={formData.contactPerson} onChange={e => setFormData({...formData, contactPerson: e.target.value})} /></div>
                <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Work Phone</label><input required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} /></div>
              </div>
              <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label><input type="email" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} /></div>
              <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Street Location</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" rows={2} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} /></div>
              <button type="submit" className="w-full py-5 bg-teal-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-teal-700 shadow-xl transition-all flex items-center justify-center gap-3"><Save size={18}/> Save Node Identity</button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Post Transaction */}
      {isTxModalOpen && selectedSupplier && (
        <div className="fixed inset-0 bg-slate-950/70 flex items-center justify-center z-[500] p-4 backdrop-blur-xl animate-in fade-in">
            <div className="bg-white rounded-[3rem] shadow-3xl w-full max-w-lg overflow-hidden">
                <div className="p-8 border-b bg-slate-50 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl text-white shadow-lg ${txType === 'PURCHASE_CREDIT' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                            {txType === 'PURCHASE_CREDIT' ? <ArrowUpRight size={24}/> : <ArrowDownLeft size={24}/>}
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter leading-none">{txType === 'PURCHASE_CREDIT' ? (editingTxId ? 'Edit Credit Invoice' : 'Log Credit Invoice') : (editingTxId ? 'Edit Payment' : 'Issue Payment')}</h2>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">{selectedSupplier.name}</p>
                        </div>
                    </div>
                    <button onClick={closeTxModal} className="text-slate-300 hover:text-rose-500"><X size={32}/></button>
                </div>
                <div className="p-6 bg-slate-100 flex gap-2">
                    <button type="button" disabled={!!editingTxId} onClick={() => setTxType('PURCHASE_CREDIT')} className={`flex-1 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${txType === 'PURCHASE_CREDIT' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:bg-white/50'} ${editingTxId ? 'opacity-50 cursor-not-allowed' : ''}`}>Credit Buy</button>
                    <button type="button" disabled={!!editingTxId} onClick={() => setTxType('PAYMENT')} className={`flex-1 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${txType === 'PAYMENT' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:bg-white/50'} ${editingTxId ? 'opacity-50 cursor-not-allowed' : ''}`}>Outbound Payment</button>
                </div>
                <form onSubmit={handleSaveTx} className="p-10 space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Amount</label>
                            <div className="relative">
                                <Coins className="absolute left-4 top-4 text-slate-300" size={18}/>
                                <input required type="number" step="0.01" className="w-full pl-12 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-lg outline-none focus:border-teal-500 transition-all" value={txData.amount} onChange={e => setTxData({...txData, amount: parseFloat(e.target.value) || 0})}/>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Date</label>
                            <input required type="date" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none" value={txData.date} onChange={e => setTxData({...txData, date: e.target.value})}/>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Ref / Invoice Number</label><input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none" value={txData.reference} onChange={e => setTxData({...txData, reference: e.target.value})} placeholder="INV-001" /></div>
                        {txType === 'PURCHASE_CREDIT' && (
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Due Date</label>
                                <input required type="date" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:border-indigo-500 transition-all" value={txData.dueDate} onChange={e => setTxData({...txData, dueDate: e.target.value})}/>
                            </div>
                        )}
                        {txType === 'PAYMENT' && (
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Link to Credit Invoice</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:border-emerald-500 transition-all appearance-none" value={txData.linkedCreditId || ''} onChange={e => setTxData({...txData, linkedCreditId: e.target.value})}>
                                    <option value="">-- Apply Generic Payment --</option>
                                    {transactions.filter(t => t.supplierId === selectedSupplier.id && t.type === 'PURCHASE_CREDIT').map(t => (
                                        <option key={t.id} value={t.id}>
                                            Ref: {t.reference || 'N/A'} - {new Date(t.date).toLocaleDateString()} - Amt: {t.amount} ({t.status || 'UNPAID'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                    <button type="submit" className={`w-full py-5 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${txType === 'PURCHASE_CREDIT' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                        <CheckCircle2 size={18}/> {editingTxId ? 'Update Ledger Entry' : 'Commit Ledger Entry'}
                    </button>
                </form>
            </div>
        </div>
      )}

      {/* Procurement Details Modal */}
      {isProcurementOpen && selectedSupplier && (
          <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[400] p-4 backdrop-blur-2xl animate-in fade-in">
              <div className="bg-white rounded-[3.5rem] shadow-4xl w-full max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
                  <div className="p-10 border-b bg-slate-50 flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-5">
                          <div className="p-4 bg-indigo-600 text-white rounded-2xl shadow-xl"><Package size={32}/></div>
                          <div>
                              <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tighter leading-none mb-2">Itemized History</h2>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Full registry of items sourced from {selectedSupplier.name}</p>
                          </div>
                      </div>
                      <div className="flex gap-4">
                          <button onClick={exportProcurement} className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95">
                              <FileSpreadsheet size={18}/> Export Statement
                          </button>
                          <button onClick={() => setIsProcurementOpen(false)} className="p-4 hover:bg-slate-200 rounded-full transition-all text-slate-300 hover:text-rose-500"><X size={36}/></button>
                      </div>
                  </div>
                  
                  <div className="flex-1 overflow-x-auto overflow-y-auto p-10 no-scrollbar">
                      <table className="w-full text-left border-separate border-spacing-0 min-w-[700px]">
                          <thead className="bg-slate-100 text-slate-400 font-black uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm">
                              <tr>
                                  <th className="p-6 rounded-l-2xl">Stock Identity</th>
                                  <th className="p-6">Classification</th>
                                  <th className="p-6">Batch ID</th>
                                  <th className="p-6 text-right">Qty</th>
                                  <th className="p-6 text-right">Buying Rate</th>
                                  <th className="p-6 text-right rounded-r-2xl pr-10">Total Value</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 font-bold uppercase text-[10px]">
                              {supplierPurchases.sort((a,b) => ((b.createdAt || '') > (a.createdAt || '') ? 1 : (b.createdAt || '') < (a.createdAt || '') ? -1 : 0)).map(p => (
                                  <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                                      <td className="p-6">
                                          <p className="text-slate-800 font-black tracking-tight">{p.name}</p>
                                          <p className="text-[8px] text-slate-400 mt-1 uppercase">Created: {new Date(p.createdAt || Date.now()).toLocaleDateString()}</p>
                                      </td>
                                      <td className="p-6"><span className="px-2 py-1 bg-slate-100 rounded text-[8px] font-black">{p.medCategory || 'General'}</span></td>
                                      <td className="p-6 font-mono text-indigo-600">{p.batchNumber || 'N/A'}</td>
                                      <td className="p-6 text-right">{p.quantity} <span className="opacity-50">{p.unit || 'U'}</span></td>
                                      <td className="p-6 text-right font-black text-teal-700">{(p.buyingPrice || 0).toFixed(2)}</td>
                                      <td className="p-6 text-right pr-10 font-black text-slate-900 font-mono text-xs tracking-tighter">{(p.quantity * (p.buyingPrice || 0)).toFixed(2)}</td>
                                  </tr>
                              ))}
                              {supplierPurchases.length === 0 && (
                                  <tr><td colSpan={6} className="py-32 text-center opacity-20 flex flex-col items-center">
                                      <Package size={100} strokeWidth={1}/><p className="font-black uppercase tracking-[0.4em] text-xs mt-6">Zero Intake Records Found</p>
                                  </td></tr>
                              )}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      )}

      {/* Ledger Modal: Statement History */}
      {isLedgerOpen && selectedSupplier && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[400] p-4 backdrop-blur-2xl animate-in fade-in">
            <div className="bg-white rounded-[3.5rem] shadow-4xl w-full max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
                <div className="p-10 border-b bg-slate-50 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-5">
                        <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-xl"><Receipt size={32}/></div>
                        <div>
                            <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tighter leading-none mb-2">Fiscal Statement</h2>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Running Ledger for {selectedSupplier.name}</p>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <button onClick={exportLedger} className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95">
                            <FileSpreadsheet size={18}/> Export Ledger
                        </button>
                        <button onClick={() => setIsLedgerOpen(false)} className="p-4 hover:bg-slate-200 rounded-full transition-all text-slate-300 hover:text-rose-500"><X size={36}/></button>
                    </div>
                </div>
                
                <div className="flex-1 overflow-x-auto overflow-y-auto p-10 no-scrollbar">
                    <table className="w-full text-left border-separate border-spacing-0 min-w-[800px]">
                        <thead className="bg-slate-100 text-slate-400 font-black uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-6 rounded-l-2xl">Date</th>
                                <th className="p-6">Registry Entry</th>
                                <th className="p-6">Reference ID</th>
                                <th className="p-6 text-right">Debit (Debt)</th>
                                <th className="p-6 text-right">Credit (Paid)</th>
                                <th className="p-6 text-right">Running Net</th>
                                <th className="p-6 text-center rounded-r-2xl pr-10">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 font-bold uppercase text-[10px]">
                            {(() => {
                                let running = 0;
                                const processed = [...supplierHistory].reverse().map(t => {
                                    if (t.type === 'PURCHASE_CREDIT') running += t.amount;
                                    else running -= t.amount;
                                    return { ...t, running };
                                }).reverse();

                                return processed.map(tx => (
                                    <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-6 text-slate-400 font-mono">{new Date(tx.date).toLocaleDateString()}</td>
                                        <td className="p-6">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-3">
                                                    {tx.type === 'PURCHASE_CREDIT' ? <ArrowUpRight className="text-rose-500" size={16}/> : <ArrowDownLeft className="text-emerald-500" size={16}/>}
                                                    <p className="text-slate-800 tracking-tight">{tx.type.replace('_', ' ')}</p>
                                                </div>
                                                {tx.type === 'PURCHASE_CREDIT' && (
                                                    <div className="space-y-1">
                                                        <div className={`w-fit px-2 py-0.5 rounded text-[8px] tracking-widest font-black ${
                                                            tx.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                                                            tx.status === 'PARTIAL' ? 'bg-amber-100 text-amber-700' :
                                                            'bg-rose-100 text-rose-700'
                                                        }`}>
                                                            {tx.status || 'UNPAID'} ({tx.paidAmount || 0} PAID)
                                                        </div>
                                                        {/* Reference match marker and discrepancy remarks */}
                                                        {(() => {
                                                            const matchedPayments = processed.filter(p => 
                                                                p.type === 'PAYMENT' && 
                                                                (p.linkedCreditId === tx.id || 
                                                                 (p.reference && tx.reference && p.reference.trim().toUpperCase() === tx.reference.trim().toUpperCase()))
                                                            );
                                                            
                                                            if (matchedPayments.length === 0) return null;
                                                            
                                                            const totalPaid = matchedPayments.reduce((sum, p) => sum + p.amount, 0);
                                                            const diff = totalPaid - tx.amount;
                                                            
                                                            return (
                                                                <div className="mt-2 space-y-1 pt-1.5 border-t border-slate-100">
                                                                    <div className="text-[8px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                                                                        <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                                                                        <span>Settle Matched payments:</span>
                                                                    </div>
                                                                    {matchedPayments.map(p => (
                                                                        <div key={p.id} className="text-[8px] font-bold text-slate-500 normal-case">
                                                                            • {new Date(p.date).toLocaleDateString()} - Paid: <span className="text-emerald-600 font-black">{p.amount.toFixed(2)}</span> (Ref: <span className="font-mono bg-slate-100 px-1 rounded">{p.reference}</span>)
                                                                        </div>
                                                                    ))}
                                                                    
                                                                    {diff !== 0 ? (
                                                                        <div className="mt-1 px-2.5 py-1.5 bg-amber-50 border border-amber-100 rounded-xl text-[8.5px] font-bold text-amber-800 normal-case leading-relaxed">
                                                                            <span className="font-black uppercase tracking-wider text-rose-600 block text-[7.5px] mb-0.5">⚠️ Amount Difference Remark</span>
                                                                            {diff < 0 
                                                                                ? `Shortfall of ${Math.abs(diff).toFixed(2)}: Invoice total was ${tx.amount.toFixed(2)}, total payment received equals ${totalPaid.toFixed(2)}.`
                                                                                : `Overpayment of ${Math.abs(diff).toFixed(2)}: Invoice total was ${tx.amount.toFixed(2)}, total payment received equals ${totalPaid.toFixed(2)}.`
                                                                            }
                                                                        </div>
                                                                    ) : (
                                                                        <div className="mt-1 text-[7.5px] font-black tracking-wider text-teal-600 uppercase">
                                                                            ✓ Fully Settle matched (No Difference)
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                                {tx.type === 'PAYMENT' && tx.linkedCreditId && (
                                                    <div className="w-fit px-2 py-0.5 rounded text-[8px] tracking-widest font-black bg-slate-200 text-slate-600">
                                                        LINKED PAYMENT
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-black text-slate-700 tracking-tight font-mono">{tx.reference || 'SYSTEM_LOG'}</span>
                                                {tx.type === 'PURCHASE_CREDIT' && (() => {
                                                    const hasPayments = processed.some(p => 
                                                        p.type === 'PAYMENT' && 
                                                        (p.linkedCreditId === tx.id || 
                                                         (p.reference && tx.reference && p.reference.trim().toUpperCase() === tx.reference.trim().toUpperCase()))
                                                    );
                                                    if (hasPayments) {
                                                        return (
                                                            <span className="text-[7px] w-fit font-black tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-100 rounded px-1 py-0.5">
                                                                ✓ PAID BY REF
                                                            </span>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                        </td>
                                        <td className="p-6 text-right font-black text-rose-600">{tx.type === 'PURCHASE_CREDIT' ? `${tx.amount.toFixed(2)}` : '-'}</td>
                                        <td className="p-6 text-right font-black text-emerald-600">{tx.type === 'PAYMENT' ? `${tx.amount.toFixed(2)}` : '-'}</td>
                                        <td className="p-6 text-right font-black text-slate-900 font-mono text-xs tracking-tighter">{tx.running.toFixed(2)}</td>
                                        <td className="p-6 text-center pr-10">
                                            <button 
                                                onClick={() => {
                                                    setEditingTxId(tx.id);
                                                    setTxType(tx.type);
                                                    setTxData({
                                                        amount: tx.amount,
                                                        date: tx.date,
                                                        reference: tx.reference || '',
                                                        notes: tx.notes || '',
                                                        dueDate: tx.dueDate || '',
                                                        linkedCreditId: tx.linkedCreditId || ''
                                                    });
                                                    setIsTxModalOpen(true);
                                                }}
                                                className="p-2 bg-slate-100 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                                            >
                                                <Edit size={14}/>
                                            </button>
                                        </td>
                                    </tr>
                                ));
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
