
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/db';
import { subscribeToChanges, unsubscribeFromChanges } from '../services/socket';
import { Customer, Sale, LoyaltyTier } from '../types';
import { DB_KEYS, LOYALTY_CONFIG } from '../constants';
import { Search, Users, Phone, FileText, Plus, Crown, Star, Gift, X, Save, Loader2, Edit } from 'lucide-react';

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', tin: '' });

  const loadData = useCallback(async () => {
    try {
      const [loadedCustomers, loadedSales] = await Promise.all([
        db.getCustomers(),
        db.getSales()
      ]);
      setCustomers(loadedCustomers);
      setSales(loadedSales);
      // Update selected customer object if it's currently open
      if (selectedCustomer) {
        const updated = loadedCustomers.find((c: any) => c.id === selectedCustomer.id);
        if (updated) setSelectedCustomer(updated);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedCustomer]);

  useEffect(() => {
    loadData();
    const handleSocketUpdate = (data: { key: string }) => {
        if (data.key === DB_KEYS.CUSTOMERS || data.key === DB_KEYS.SALES || data.key === 'all') loadData();
    };
    subscribeToChanges(handleSocketUpdate);

    const handleLocalUpdate = (e: any) => {
        const key = e.detail?.key;
        if (key && (key === DB_KEYS.CUSTOMERS || key === DB_KEYS.SALES || key === 'all')) loadData();
    };
    window.addEventListener('local-data-update', handleLocalUpdate);

    return () => {
        unsubscribeFromChanges(handleSocketUpdate);
        window.removeEventListener('local-data-update', handleLocalUpdate);
    };
  }, [loadData]);

  const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      const existing = customers.find((c: any) => c.id === editingId);
      if (existing) {
        await db.updateCustomer({
          ...existing,
          ...newCustomer
        });
      }
    } else {
      const customer: Customer = {
        id: generateId(),
        ...newCustomer,
        joinedDate: new Date().toISOString(),
        totalPointsEarned: 0,
        currentPoints: 0,
        tier: LoyaltyTier.BRONZE
      };
      await db.addCustomer(customer);
    }
    setIsModalOpen(false);
    setEditingId(null);
    setNewCustomer({ name: '', phone: '', tin: '' });
    loadData();
  };

  const handleEdit = (customer: Customer) => {
    setNewCustomer({ name: customer.name, phone: customer.phone, tin: customer.tin || '' });
    setEditingId(customer.id);
    setIsModalOpen(true);
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.phone.includes(searchTerm)
  );

  const getCustomerSales = (customerId: string) => {
    return sales.filter(s => s.customerId === customerId).sort((a,b) => ((b.date || '') > (a.date || '') ? 1 : (b.date || '') < (a.date || '') ? -1 : 0));
  };

  const getTierColor = (tier: LoyaltyTier) => {
    return LOYALTY_CONFIG.TIERS[tier].color;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Users className="text-teal-600" /> Customer Directory & Loyalty
        </h1>
        <button onClick={() => { setEditingId(null); setNewCustomer({ name: '', phone: '', tin: '' }); setIsModalOpen(true); }} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-bold shadow-md"><Plus size={18} /> Add Customer</button>
      </div>

      <div className="flex gap-6 h-[calc(100vh-160px)]">
        <div className="w-1/3 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
           <div className="p-4 border-b bg-gray-50">
             <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input type="text" placeholder="Search by name/phone..." className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 font-bold text-sm outline-none" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
             </div>
           </div>
           
           <div className="flex-1 overflow-y-auto no-scrollbar">
             {loading ? <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-teal-600" size={32}/></div> : filteredCustomers.map((c) => (
               <div key={c.id} onClick={() => setSelectedCustomer(c)} className={`p-4 border-b cursor-pointer hover:bg-teal-50 transition-colors ${selectedCustomer?.id === c.id ? 'bg-teal-50 border-l-4 border-l-teal-600' : 'border-gray-50'}`}>
                 <div className="flex justify-between items-center"><h3 className="font-black text-gray-800 uppercase text-xs tracking-tight">{c.name}</h3>{c.tier !== LoyaltyTier.BRONZE && (<Crown size={16} fill={getTierColor(c.tier)} className="text-transparent" />)}</div>
                 <div className="flex items-center gap-2 text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1"><Phone size={12} /><span>{c.phone}</span></div>
                 <div className="mt-2 flex items-center gap-1"><span className="text-[10px] bg-white border border-teal-100 text-teal-600 px-2 py-0.5 rounded-full flex items-center gap-1 font-black shadow-sm"><Star size={10} fill="currentColor"/> {c.currentPoints} pts</span></div>
               </div>
             ))}
             {filteredCustomers.length === 0 && !loading && (<div className="p-8 text-center text-gray-300 font-bold uppercase text-[10px] tracking-widest">No matching records.</div>)}
           </div>
        </div>

        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 p-8 overflow-y-auto no-scrollbar">
          {selectedCustomer ? (
            <div className="space-y-8 animate-in slide-in-from-right-2 duration-300">
              <div className="flex justify-between items-start border-b pb-8 border-slate-100">
                <div>
                   <h2 className="text-4xl font-black text-slate-800 uppercase tracking-tighter leading-none mb-4">{selectedCustomer.name}</h2>
                   <div className="flex gap-6 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                      <span className="flex items-center gap-1.5"><Phone size={14}/> {selectedCustomer.phone}</span>
                      <span className="flex items-center gap-1.5"><FileText size={14}/> TIN: {selectedCustomer.tin || 'N/A'}</span>
                   </div>
                </div>
                <button onClick={() => handleEdit(selectedCustomer)} className="p-3 bg-slate-50 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-2xl border border-slate-100 transition-all shadow-sm">
                    <Edit size={20}/>
                </button>
              </div>

              <div className="bg-slate-900 text-white rounded-[2rem] p-8 shadow-2xl relative overflow-hidden">
                 <div className="absolute -top-10 -right-10 opacity-5 rotate-12"><Crown size={200} /></div>
                 <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-3"><Crown size={24} fill={getTierColor(selectedCustomer.tier)} className="text-transparent" /><span className="font-black text-2xl tracking-[0.2em] uppercase">{selectedCustomer.tier}</span></div>
                    <div className="text-right">
                       <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">Available Loyalty</div>
                       <div className="text-4xl font-black flex items-center justify-end gap-3 tracking-tighter"><Star fill="#facc15" className="text-yellow-400" size={32}/> {selectedCustomer.currentPoints} <span className="text-xs text-slate-500 font-normal">pts</span></div>
                    </div>
                 </div>
                 <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-2"><div className="h-full bg-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.5)]" style={{ width: `${Math.min(100, (selectedCustomer.totalPointsEarned / (selectedCustomer.tier === LoyaltyTier.GOLD ? selectedCustomer.totalPointsEarned : (selectedCustomer.tier === LoyaltyTier.SILVER ? LOYALTY_CONFIG.TIERS.GOLD.min : LOYALTY_CONFIG.TIERS.SILVER.min))) * 100)}%` }}></div></div>
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Lifetime Points Earned: {selectedCustomer.totalPointsEarned}</p>
              </div>

              <div className="space-y-6">
                <h3 className="font-black text-xs uppercase tracking-[0.3em] text-slate-400 border-b pb-2 flex items-center gap-2"><Gift size={16} className="text-indigo-500"/> Account Ledger</h3>
                <div className="space-y-3">
                  {getCustomerSales(selectedCustomer.id).map(sale => (
                    <div key={sale.id} className="border-2 border-slate-50 rounded-2xl p-4 hover:border-teal-500 hover:bg-teal-50/10 transition-all group">
                      <div className="flex justify-between mb-2"><span className="font-black text-xs text-slate-400 uppercase tracking-tight">Receipt #{sale.receiptNumber} • {new Date(sale.date).toLocaleDateString()}</span><span className="font-black text-slate-800 font-mono tracking-tighter">{sale.grandTotal.toFixed(2)}</span></div>
                      <div className="flex justify-between items-center"><span className="text-[10px] font-bold text-slate-400">{sale.items.length} Medicines</span><div className="flex gap-4">{(sale.pointsEarned || 0) > 0 && <span className="text-emerald-600 font-black text-[10px] flex items-center gap-1">+{sale.pointsEarned} PTS</span>}{(sale.pointsRedeemed || 0) > 0 && <span className="text-rose-600 font-black text-[10px] flex items-center gap-1">-{sale.pointsRedeemed} PTS</span>}</div></div>
                    </div>
                  ))}
                  {getCustomerSales(selectedCustomer.id).length === 0 && <div className="text-center py-12 text-slate-300 font-black uppercase text-[10px] tracking-widest">No activity recorded for this patient.</div>}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-200"><Users size={80} className="mb-6 opacity-5" /><p className="font-black uppercase tracking-[0.4em] text-xs">Awaiting Selection</p></div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[100] backdrop-blur-md p-4">
           <div className="bg-white p-10 rounded-[2.5rem] w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-10"><h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">{editingId ? 'Modify Record' : 'Registration'}</h2><button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={24}/></button></div>
              <form onSubmit={handleAddCustomer} className="space-y-6">
                 <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Legal Full Name</label><input required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} /></div>
                 <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Mobile Contact</label><input required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} /></div>
                 <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tax ID / TIN</label><input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" value={newCustomer.tin} onChange={e => setNewCustomer({...newCustomer, tin: e.target.value})} /></div>
                 <button type="submit" className="w-full bg-teal-600 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-600/20 active:scale-95 transition-all flex justify-center items-center gap-2"><Save size={18}/> {editingId ? 'Commit Changes' : 'Authorize Registration'}</button>
              </form>
           </div>
        </div>
      )}
    </div>
  );
}
