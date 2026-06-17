import React, { useState, useEffect, useMemo } from 'react';
import { Bell, AlertTriangle, Calendar, X, ExternalLink } from 'lucide-react';
import { db } from '../services/db';
import { Supplier, SupplierTransaction } from '../types';
import { DB_KEYS } from '../constants';
import { Link } from 'react-router-dom';

export const NotificationsPanel: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);

    const loadData = async () => {
        const [s, t] = await Promise.all([
            db.getSuppliers(),
            db.getSupplierTransactions()
        ]);
        setSuppliers(s.filter((x: any) => !x.isDeleted));
        setTransactions(t || []);
    };

    useEffect(() => {
        loadData();
        const handleUpdate = (e: any) => {
            if (e.detail && [DB_KEYS.SUPPLIERS, DB_KEYS.SUPPLIER_TRANSACTIONS, 'all'].includes(e.detail.key)) loadData();
        };
        window.addEventListener('local-data-update', handleUpdate);
        return () => window.removeEventListener('local-data-update', handleUpdate);
    }, []);

    const duePayments = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const due: { supplier: Supplier, tx: SupplierTransaction, daysOverdue: number, remainingAmount: number }[] = [];

        suppliers.forEach((supplier: any) => {
            // Get all transactions for this supplier, sorted chronologically
            const supplierTxs = transactions
                .filter(t => t.supplierId === supplier.id)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            // Calculate total payments made to this supplier
            let totalPayments = supplierTxs
                .filter(t => t.type === 'PAYMENT')
                .reduce((sum, t) => sum + t.amount, 0);

            // Iterate over purchase credits in chronological order
            supplierTxs.filter(t => t.type === 'PURCHASE_CREDIT').forEach((t: any) => {
                let remainingForThisTx = t.amount;
                
                // Allocate payments to this invoice
                if (totalPayments >= remainingForThisTx) {
                    totalPayments -= remainingForThisTx;
                    remainingForThisTx = 0;
                } else {
                    remainingForThisTx -= totalPayments;
                    totalPayments = 0;
                }

                // If invoice is not fully paid and has a due date in the past
                if (remainingForThisTx > 0.01 && t.dueDate) {
                    const dueDate = new Date(t.dueDate);
                    dueDate.setHours(0, 0, 0, 0);
                    
                    if (dueDate <= today) {
                        const diffTime = Math.abs(today.getTime() - dueDate.getTime());
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        due.push({ 
                            supplier, 
                            tx: t, 
                            daysOverdue: dueDate < today ? diffDays : 0,
                            remainingAmount: remainingForThisTx
                        });
                    }
                }
            });
        });

        // Sort by most overdue
        return due.sort((a, b) => b.daysOverdue - a.daysOverdue);
    }, [suppliers, transactions]);

    return (
        <div className="relative z-50">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-3 bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all text-slate-500 hover:text-teal-600"
            >
                <Bell size={20} />
                {duePayments.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white shadow-sm ring-2 ring-white animate-in zoom-in">
                        {duePayments.length}
                    </span>
                )}
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute -right-2 md:right-0 mt-4 w-[calc(100vw-2rem)] max-w-sm md:w-96 bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden z-50 animate-in slide-in-from-top-4 fade-in duration-200">
                        <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-teal-100 text-teal-600 rounded-xl"><Bell size={16}/></div>
                                <h3 className="font-black text-slate-800 uppercase tracking-tighter">Notifications</h3>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{duePayments.length} Alerts</span>
                        </div>
                        
                        <div className="max-h-[60vh] overflow-y-auto p-2 no-scrollbar">
                            {duePayments.length === 0 ? (
                                <div className="p-8 text-center text-slate-400">
                                    <Bell size={32} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">All caught up!</p>
                                </div>
                            ) : (
                                duePayments.map((item, idx) => (
                                    <div key={`${item.tx.id}-${idx}`} className="p-4 m-2 rounded-2xl bg-rose-50 border border-rose-100 hover:bg-rose-100 transition-colors">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2 text-rose-600">
                                                <AlertTriangle size={14} />
                                                <span className="text-[10px] font-black uppercase tracking-widest">Payment Due</span>
                                            </div>
                                            <span className="text-[9px] font-bold text-rose-400 uppercase">{item.daysOverdue > 0 ? `${item.daysOverdue} Days Overdue` : 'Due Today'}</span>
                                        </div>
                                        <h4 className="font-black text-slate-800 tracking-tight mb-1">{item.supplier.name}</h4>
                                        <div className="flex justify-between items-end mt-3">
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><Calendar size={10}/> {new Date(item.tx.dueDate!).toLocaleDateString()}</p>
                                                <p className="text-[10px] font-bold text-slate-500 mt-0.5">Ref: {item.tx.reference || 'N/A'}</p>
                                            </div>
                                            <p className="font-black font-mono text-rose-600 tracking-tighter" title={`Original Invoice: ${item.tx.amount.toFixed(2)}`}>{item.remainingAmount.toFixed(2)}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        
                        {duePayments.length > 0 && (
                            <div className="p-4 border-t border-slate-50 bg-slate-50/50">
                                <Link to="/suppliers" onClick={() => setIsOpen(false)} className="w-full py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-slate-100 transition-all flex items-center justify-center gap-2">
                                    Go to Credit Ledger <ExternalLink size={12}/>
                                </Link>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
