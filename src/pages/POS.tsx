import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import { db } from '../services/db';
import { Product, CartItem, Sale, Customer, UserRole } from '../types';
import { useAppContext } from '../App';
import { 
  Search, ShoppingCart, Plus, Minus, Trash2, X, 
  Check, User, Hash, Download, FileText, Loader2,
  PauseCircle, PlayCircle, CreditCard, Tag, Percent,
  Wallet, Landmark, Smartphone, Calendar, Package, Settings2, Eraser,
  Layers,
  History
} from 'lucide-react';
import { LOYALTY_CONFIG } from '../constants';
import { ReceiptTemplate } from '../components/ReceiptTemplate';
import { generateReceiptPDF, generateA4AttachmentPDF } from '../services/pdfService';
import { cashDrawerService } from '../services/cashDrawer';

type PaymentMethod = 'CASH' | 'CBE' | 'BOA' | 'AWASH' | 'DASHEN' | 'TELEBIRR' | 'CREDIT' | 'OTHER' | 'SPLIT';

interface HeldCart {
    id: string;
    patientName: string;
    items: CartItem[];
    timestamp: string;
}

export default function POS() {
  const { user, pharmacyInfo, globalBranch } = useAppContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerTin, setCustomerTin] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [selectedBank, setSelectedBank] = useState<'CBE' | 'BOA' | 'AWASH' | 'DASHEN' | 'OTHER'>('CBE');
  const [creditDueDate, setCreditDueDate] = useState('');
  const [vatPercent, setVatPercent] = useState(0);
  const [splitPayments, setSplitPayments] = useState<{method: 'CASH' | 'CBE' | 'BOA' | 'AWASH' | 'DASHEN' | 'TELEBIRR' | 'OTHER', amount: number}[]>([
      { method: 'CASH', amount: 0 },
      { method: 'TELEBIRR', amount: 0 }
  ]);

  
  // Settings - FIFO enabled by default but UI toggle removed per request
  const [isFifo] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>(() => {
      const saved = localStorage.getItem('pharma_held_carts');
      return saved ? JSON.parse(saved) : [];
  });
  const [showHolds, setShowHolds] = useState(false);
  const [showReceipt, setShowReceipt] = useState<Sale | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [lastInteractedId, setLastInteractedId] = useState<string | null>(null);
  
  const [drawerConnected, setDrawerConnected] = useState(cashDrawerService.isConnected);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [newExpense, setNewExpense] = useState({ amount: 0, category: 'Utilities', description: '', date: new Date().toISOString().split('T')[0] });

  const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);

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
      branch: user?.branch || undefined 
    });
    setShowExpenseModal(false);
    setNewExpense({ amount: 0, category: 'Utilities', description: '', date: new Date().toISOString().split('T')[0] });
  };


  const toggleDrawerConnection = async () => {
      if (drawerConnected) {
          await cashDrawerService.disconnect();
          setDrawerConnected(false);
      } else {
          const connected = await cashDrawerService.connect();
          if (connected) setDrawerConnected(true);
      }
  };

  const manualDrawerKick = async () => {
      await cashDrawerService.openDrawer();
  };

  const [terminalWidth, setTerminalWidth] = useState(() => {
    const saved = localStorage.getItem('pharma_pos_w');
    const width = saved ? parseInt(saved) : 750;
    return Math.min(width, window.innerWidth - 100);
  });
  
  const isResizing = useRef(false);

  useEffect(() => {
      const handleResize = () => {
          setTerminalWidth(prev => Math.min(prev, window.innerWidth - 100));
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cartInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const loadData = useCallback(async () => {
    const [p, c] = await Promise.all([db.getProducts(), db.getCustomers()]);
    const productsArr = Array.isArray(p) ? p : [];
    const customersArr = Array.isArray(c) ? c : [];
    setProducts(productsArr.filter((item: Product) => {
      const active = !item.isDeleted && item.quantity > 0;
      if (!active) return false;
      if (user?.role === 'ADMIN') {
         if (globalBranch) {
             if (globalBranch === 'MAIN') return !item.branch;
             return item.branch === globalBranch;
         }
         return true;
      }
      return !item.branch || item.branch === user?.branch;
    }));
    setCustomers(customersArr);
  }, [user, globalBranch]);

    useEffect(() => {
    loadData();
    localStorage.setItem('pharma_held_carts', JSON.stringify(heldCarts));
    searchInputRef.current?.focus();
    
    // Web Serial requestPort requires user gesture, cannot auto-connect securely on load
    const handleMM = (e: MouseEvent) => { 
        if (!isResizing.current) return; 
        const w = window.innerWidth - e.clientX; 
        setTerminalWidth(Math.max(300, Math.min(w, window.innerWidth - 100)));
    };
    const handleMU = () => {
        if (isResizing.current) {
            isResizing.current = false;
            localStorage.setItem('pharma_pos_w', terminalWidth.toString());
        }
    };
    const handleLocalUpdate = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail || detail.key === 'pharma_products' || detail.key === 'pharma_customers_db' || detail.key === 'all') {
            loadData();
        }
    };

    window.addEventListener('local-data-update', handleLocalUpdate);
    window.addEventListener('mousemove', handleMM);
    window.addEventListener('mouseup', handleMU);
    return () => {
        window.removeEventListener('local-data-update', handleLocalUpdate);
        window.removeEventListener('mousemove', handleMM);
        window.removeEventListener('mouseup', handleMU);
    };
  }, [loadData, heldCarts, terminalWidth]);

  const deferredSearch = useDeferredValue(search);
  
  const groupedProducts = useMemo(() => {
    const map = new Map<string, any>();
    products.forEach((p: any) => {
        const key = p.name.toLowerCase().trim();
        if (!map.has(key)) map.set(key, { name: p.name, totalQuantity: 0, batches: [], maxPrice: 0 });
        const entry = map.get(key);
        entry.totalQuantity += p.quantity;
        entry.maxPrice = Math.max(entry.maxPrice, p.sellingPrice);
        entry.batches.push(p);
    });
    
    // Sort batches by expiry for FIFO
    map.forEach((item: any) => {
        item.batches.sort((a: any, b: any) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const catalogProducts = useMemo(() => {
    const lowerSearch = deferredSearch.toLowerCase();
    if (!lowerSearch) return groupedProducts;
    return groupedProducts.filter(p => p.name.toLowerCase().includes(lowerSearch));
  }, [groupedProducts, deferredSearch]);

  const addToCart = (p: any, specificBatch?: Product) => {
    setCart(prev => {
        const updatedCart = [...prev];

        if (specificBatch) {
            // Manual selection
            const existing = updatedCart.find(i => i.id === specificBatch.id);
            if (existing) {
                if (existing.cartQty < specificBatch.quantity) {
                    existing.cartQty += 1;
                }
            } else {
                updatedCart.push({ ...specificBatch, cartQty: 1, discount: 0 });
            }
            setLastInteractedId(specificBatch.id);
        } else if (isFifo) {
            // FIFO Allocation
            let needed = 1;
            for (const batch of p.batches) {
                if (needed <= 0) break;
                
                const existing = updatedCart.find(i => i.id === batch.id);
                const currentQtyInCart = existing ? existing.cartQty : 0;
                const availableInBatch = batch.quantity - currentQtyInCart;

                if (availableInBatch > 0) {
                    const toAdd = Math.min(needed, availableInBatch);
                    if (existing) {
                        existing.cartQty += toAdd;
                    } else {
                        updatedCart.push({ ...batch, cartQty: toAdd, discount: 0 });
                    }
                    needed -= toAdd;
                    setLastInteractedId(batch.id);
                }
            }
        }

        return updatedCart;
    });
  };

  const removeItem = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
    if (activeEditorId === id) setActiveEditorId(null);
    if (lastInteractedId === id) setLastInteractedId(null);
  };

  const updateQty = (id: string, qty: number) => {
    setCart(prev => prev.map(i => {
      if (i.id === id) {
        const batch = products.find((p: any) => p.id === id);
        if (!batch) return i;
        const finalQty = Math.max(1, Math.min(qty, batch.quantity));
        return { ...i, cartQty: finalQty };
      }
      return i;
    }));
    setLastInteractedId(id);
  };

  const updatePriceOverride = (id: string, price: number) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, sellingPrice: Math.max(0, price) } : i));
  };

  const updateDiscount = (id: string, amount: number) => {
    setCart(prev => prev.map(i => {
        if (i.id === id) {
            const maxTotal = i.sellingPrice * i.cartQty;
            return { ...i, discount: Math.max(0, Math.min(amount, maxTotal)) };
        }
        return i;
    }));
  };

  const handleHold = () => {
      if (cart.length === 0) return;
      const newHold: HeldCart = {
          id: generateId(),
          patientName: customerSearch || 'Unnamed Patient',
          items: [...cart],
          timestamp: new Date().toISOString()
      };
      setHeldCarts([newHold, ...heldCarts]);
      setCart([]); setCustomerSearch(''); setCustomerTin(''); setLastInteractedId(null);
  };

  const resumeHold = (h: HeldCart) => {
      if (cart.length > 0 && !window.confirm("Overwrite current cart with held transaction?")) return;
      setCart(h.items);
      setCustomerSearch(h.patientName);
      setHeldCarts(heldCarts.filter((x: any) => x.id !== h.id));
      setShowHolds(false);
      if (h.items.length > 0) setLastInteractedId(h.items[h.items.length - 1].id);
  };

  const executeSale = async () => {
    if (cart.length === 0 || isProcessing) return;
    if (paymentMethod === 'CREDIT' && !creditDueDate) { alert("Please select a settlement date for credit."); return; }
    
    setIsProcessing(true);
    try {
        const subTotal = cart.reduce((s, i) => s + (i.sellingPrice * i.cartQty) - (i.discount || 0), 0);
        const vatAmount = subTotal * (vatPercent / 100);
        const grandTotal = subTotal + vatAmount;
        if (paymentMethod === 'SPLIT') {
            const totalSplit = splitPayments.reduce((s, sp) => s + (Number(sp.amount) || 0), 0);
            if (Math.abs(totalSplit - grandTotal) > 0.01) {
                alert(`Split amounts (${totalSplit.toFixed(2)}) must equal grand total (${grandTotal.toFixed(2)}).`);
                setIsProcessing(false);
                return;
            }
        }

        
        const matchedCustomer = customers.find(c => 
            c.name.toLowerCase().trim() === customerSearch.toLowerCase().trim()
        );

        const pointsEarned = matchedCustomer 
            ? Math.floor(subTotal / LOYALTY_CONFIG.SPEND_PER_POINT) 
            : 0;

        const sale: Sale = {
            id: generateId(),
            receiptNumber: await db.getNextReceiptNumber(),
            branch: (globalBranch === 'MAIN' ? undefined : globalBranch) || user?.branch || undefined,
            items: [...cart],
            subTotal: subTotal, 
            vatPercent: vatPercent, 
            vatAmount: vatAmount, 
            grandTotal: grandTotal,
            customerId: matchedCustomer?.id,
            customerName: customerSearch || 'Walk-in',
            customerTin: customerTin,
            soldBy: user?.username || 'admin',
            date: new Date().toISOString(),
            status: paymentMethod === 'CREDIT' ? 'ON_CREDIT' : 'COMPLETED',
            pointsEarned: pointsEarned,
            paymentMethods: paymentMethod === 'SPLIT' ? splitPayments.filter(sp => sp.amount > 0).map(sp => ({ method: sp.method as any, amount: sp.amount })) : [{ method: paymentMethod as any, amount: grandTotal, dueDate: creditDueDate }],
            changeGiven: 0,
            creditDetails: paymentMethod === 'CREDIT' ? { dueDate: creditDueDate } : undefined
        };

        await db.addSale(sale);
        
        if ((paymentMethod === 'CASH') && drawerConnected) {
            cashDrawerService.openDrawer();
        }

        setShowReceipt(sale); setCart([]); setCustomerSearch(''); setCustomerTin(''); setCreditDueDate('');
        setLastInteractedId(null);
        setIsCartOpen(false);
        await loadData();
    } catch (e: any) {
        console.error("Sale failed:", e);
        alert("Dispense failed: " + (e.message || "Unknown error"));
    } finally { setIsProcessing(false); }
  };

  const cartSubtotal = cart.reduce((s, i) => s + (i.sellingPrice * i.cartQty), 0);
  const totalDiscounts = cart.reduce((s, i) => s + (i.discount || 0), 0);
  const netSubtotal = cartSubtotal - totalDiscounts;
  const cartVatAmount = netSubtotal * (vatPercent / 100);
  const cartGrandTotal = netSubtotal + cartVatAmount;

  const toggleExpand = (name: string) => {
    const next = new Set(expandedItems);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedItems(next);
  };

  const executeSaleRef = useRef(executeSale);
  const showReceiptRef = useRef(showReceipt);
  const pharmacyInfoRef = useRef(pharmacyInfo);

  useEffect(() => {
    executeSaleRef.current = executeSale;
    showReceiptRef.current = showReceipt;
    pharmacyInfoRef.current = pharmacyInfo;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        executeSaleRef.current();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        if (showReceiptRef.current) {
          e.preventDefault();
          generateReceiptPDF(showReceiptRef.current, pharmacyInfoRef.current);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

return (
    <div className="flex h-[calc(100vh-80px)] gap-0 overflow-hidden animate-in fade-in duration-300 bg-white font-sans">
      
          {/* Mobile Cart Toggle */}
          <button 
              onClick={() => setIsCartOpen(!isCartOpen)} 
              className="md:hidden fixed bottom-6 right-6 z-[100] p-4 bg-teal-600 text-white rounded-full shadow-[0_10px_40px_rgba(13,148,136,0.4)] flex items-center justify-center animate-bounce-in"
          >
              <ShoppingCart size={24} />
              {cart.length > 0 && <span className="absolute 0 top-0 right-0 bg-rose-500 text-white text-[10px] font-black w-6 h-6 flex items-center justify-center rounded-full border-2 border-white">{cart.length}</span>}
          </button>

      {/* LEFT: Item Selection List */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30">
        {user?.role === UserRole.CASHIER ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-80">
                <ShoppingCart size={80} className="mb-6 text-slate-300" strokeWidth={1}/>
                <h2 className="text-2xl font-black text-slate-400 uppercase tracking-widest mb-2">Cashier Mode</h2>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest max-w-md">You are restricted to processing suspended transactions only.</p>
                <button onClick={() => setShowHolds(true)} className="mt-8 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-3 active:scale-95">
                    <PauseCircle size={18}/> View Suspended Carts ({heldCarts.length})
                </button>
            </div>
        ) : (
            <>
                <div className="p-4 flex gap-4 border-b bg-white items-center shadow-sm z-10">
                   <div className="relative flex-1">
                     <Search className="absolute left-5 top-4 text-slate-300" size={24} />
                     <input ref={searchInputRef} className="w-full pl-14 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold focus:bg-white focus:ring-2 focus:ring-teal-500 transition-all text-xl resize-x overflow-auto min-w-[200px]" placeholder="Lookup medication..." value={search} onChange={e => setSearch(e.target.value)} />
                   </div>
                   
                   <div className="flex gap-2 items-center flex-shrink-0">
                       <button onClick={() => setShowHolds(true)} title={`${heldCarts.length} Suspended`} className="relative p-3 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100 flex items-center justify-center hover:bg-indigo-100 transition-all">
                            <PauseCircle size={20}/>
                            {heldCarts.length > 0 && <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">{heldCarts.length}</span>}
                       </button>
                       
                       <div className="flex gap-2 border-l pl-2 ml-1">
                           <button onClick={toggleDrawerConnection} title={drawerConnected ? 'Drawer Ready' : 'Connect Drawer'} className={`p-3 rounded-xl border flex items-center justify-center transition-all ${drawerConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                               <Package size={20}/>
                           </button>
                           {drawerConnected && (
                               <button onClick={manualDrawerKick} title="Open Drawer" className="p-3 bg-slate-800 text-white rounded-xl flex items-center justify-center hover:bg-slate-900 transition-all">
                                   <Layers size={20}/>
                               </button>
                           )}
                       </div>
                   </div>
                </div>

                {/* LIST HEADER */}
                <div className="bg-white text-slate-400 font-black uppercase text-[10px] tracking-widest flex items-center p-4 pl-6 border-b shadow-sm sticky top-0 z-10">
                    <div className="flex-1">Medication Details</div>
                    <div className="w-24 text-right">Pooled Stock</div>
                    <div className="w-24 text-right pr-2">Max Rate</div>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar">
                    <div className="divide-y divide-slate-100">
                        {catalogProducts.map(p => {
                            const isExpanded = expandedItems.has(p.name);
                            const topBatch = p.batches[0];
                            return (
                            <React.Fragment key={p.name}>
                                <div 
                                    className="hover:bg-teal-50/50 cursor-pointer transition-colors group flex items-start p-4 pl-6 gap-4"
                                    onClick={() => addToCart(p)}
                                >
                                    <div className="flex-1 flex gap-3">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); toggleExpand(p.name); }}
                                            className="p-1.5 hover:bg-teal-100 rounded-lg text-slate-400 group-hover:text-teal-600 transition-colors mt-0.5"
                                            title="View Batches"
                                        >
                                            <Layers size={14}/>
                                        </button>
                                        <div className="flex-1">
                                            {/* Name constrained to max 2 lines as requested */}
                                            <div className="font-black text-slate-700 uppercase tracking-tight group-hover:text-teal-700 transition-colors leading-tight line-clamp-2">
                                                {p.name}
                                            </div>
                                            <div className="text-[9px] text-slate-400 font-bold uppercase mt-1">
                                                {topBatch?.unit || 'Units'} • {p.batches.length} Batches
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="w-24 text-right shrink-0">
                                        <div className="flex flex-col">
                                            <span className={`font-black text-sm ${p.totalQuantity < 10 ? 'text-rose-500' : 'text-slate-600'}`}>{p.totalQuantity}</span>
                                            <span className="text-[8px] text-slate-300 uppercase font-black tracking-widest">Available</span>
                                        </div>
                                    </div>
                                    
                                    <div className="w-24 text-right shrink-0 pr-2">
                                        <span className="font-black text-teal-800 font-mono text-lg leading-none">{p.maxPrice.toFixed(2)}</span>
                                    </div>
                                </div>

                                {isExpanded && p.batches.map((batch: Product) => (
                                    <div 
                                        key={batch.id} 
                                        className="bg-indigo-50/30 animate-in slide-in-from-top-1 duration-200 hover:bg-indigo-50 cursor-pointer border-l-4 border-indigo-200 flex items-center justify-between p-3 pl-14"
                                        onClick={() => addToCart(p, batch)}
                                    >
                                        <div className="flex-1 flex items-center gap-3">
                                            <Package size={12} className="text-indigo-400"/>
                                            <div>
                                                <span className="font-bold text-slate-600 uppercase text-[10px]">Batch: {batch.batchNumber || 'N/A'}</span>
                                                <div className="text-[9px] text-indigo-400 font-black uppercase tracking-tighter">Exp: {batch.expiryDate}</div>
                                            </div>
                                        </div>
                                        <div className="text-right flex items-center gap-6">
                                            <div>
                                                <span className="text-xs font-black text-indigo-800">{batch.quantity}</span>
                                                <span className="text-[8px] text-slate-400 ml-1 uppercase font-bold">Qty</span>
                                            </div>
                                            <button className="bg-indigo-600 text-white p-1.5 rounded-lg shadow-sm active:scale-95 transition-all">
                                                <Plus size={12}/>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </React.Fragment>
                        )})}
                    </div>
                    {catalogProducts.length === 0 && (
                        <div className="py-40 text-center flex flex-col items-center opacity-10">
                            <History size={80} strokeWidth={1}/>
                            <p className="text-[9px] font-black uppercase tracking-[0.5em] mt-4 italic">No matching stock</p>
                        </div>
                    )}
                </div>
            </>
        )}
      </div>

      {/* Resize Handle */}
      <div className="hidden md:block w-1.5 cursor-col-resize hover:bg-teal-500 bg-slate-100 transition-colors z-50" onMouseDown={() => isResizing.current = true}></div>

      {/* RIGHT: High-Density Vertical Cart Panel */}
      <div 
        className={`${isCartOpen ? 'fixed inset-0 z-[90]' : 'hidden'} md:relative md:flex flex-col border-l border-slate-200 bg-white shadow-2xl shrink-0 overflow-hidden md:w-auto`} 
        style={{ width: isCartOpen ? '100%' : `${terminalWidth}px` }}
      >
        
        {/* COMPACT HEADER */}
        <div className="p-2.5 bg-slate-50 border-b flex items-center gap-2 shrink-0 shadow-sm pt-4 md:pt-2.5">
            <button className="md:hidden p-2 text-slate-500 hover:text-slate-800" onClick={() => setIsCartOpen(false)}>
                <X size={20} />
            </button>
            <div className="flex-[2] flex items-center gap-2 bg-white rounded-xl px-3 border border-slate-100 shadow-inner">
                <User size={12} className="text-teal-600"/>
                <input 
                  className="flex-1 bg-transparent py-2.5 text-[10px] font-black text-slate-800 outline-none placeholder-slate-400 uppercase" 
                  placeholder="Patient Name" 
                  value={customerSearch} 
                  onChange={e => setCustomerSearch(e.target.value)}
                />
            </div>
            <div className="flex-1 flex items-center gap-2 bg-white rounded-xl px-3 border border-slate-100 shadow-inner">
                <Hash size={12} className="text-indigo-600"/>
                <input 
                  className="w-full bg-transparent py-2.5 text-[10px] font-black text-slate-800 outline-none placeholder-slate-400 uppercase" 
                  placeholder="Tax TIN" 
                  value={customerTin} 
                  onChange={e => setCustomerTin(e.target.value)}
                />
            </div>
            <button 
                onClick={() => { if (cart.length > 0 && window.confirm("Flush Station?")) { setCart([]); setLastInteractedId(null); } }}
                className="p-2.5 text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                title="Flush Station"
            >
                <Eraser size={16}/>
            </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5 no-scrollbar bg-slate-50/10">
           {cart.map((i, idx) => {
             const isEditing = activeEditorId === i.id;
             const isLastInteracted = lastInteractedId === i.id;
             return (
             <div key={`${i.id}-${idx}`} 
                onClick={() => setLastInteractedId(i.id)}
                className={`flex flex-col p-2.5 bg-white border rounded-2xl shadow-sm transition-all duration-300 relative ${isLastInteracted ? 'ring-2 ring-teal-500 border-teal-100' : 'border-slate-100 hover:border-slate-200'}`}
             >
                <div className="flex justify-between items-center">
                    <div className="flex-1 pr-3 truncate">
                        <div className="text-[11px] font-black text-slate-800 uppercase leading-none truncate">{i.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Batch: {i.batchNumber}</span>
                            <span className="text-[8px] text-slate-300 font-bold uppercase">Rate: {i.sellingPrice.toFixed(2)}</span>
                            {(i.discount || 0) > 0 && <span className="text-rose-600 text-[8px] font-black uppercase italic">-{i.discount?.toFixed(2)}</span>}
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="font-black text-teal-800 font-mono text-sm tracking-tighter block">{((i.sellingPrice * i.cartQty) - (i.discount || 0)).toFixed(2)}</span>
                    </div>
                </div>
                
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                    <div className="flex items-center gap-1.5">
                        <div className="flex items-center bg-slate-50 rounded-lg p-0.5 border border-slate-200 shadow-sm">
                            <button onClick={() => updateQty(i.id, i.cartQty - 1)} disabled={user?.role === UserRole.CASHIER} className="p-1.5 hover:bg-white rounded text-slate-400 active:scale-90 disabled:opacity-30"><Minus size={12}/></button>
                            <input 
                                ref={el => { if(el) cartInputRefs.current.set(i.id, el); }}
                                type="number" 
                                className="w-14 bg-white border border-slate-100 rounded text-center text-sm font-black outline-none text-teal-700 shadow-inner disabled:opacity-50" 
                                value={i.cartQty || ''} 
                                disabled={user?.role === UserRole.CASHIER}
                                onFocus={(e) => { e.target.select(); setLastInteractedId(i.id); }}
                                onChange={e => updateQty(i.id, parseInt(e.target.value) || 0)} 
                            />
                            <button onClick={() => updateQty(i.id, i.cartQty + 1)} disabled={user?.role === UserRole.CASHIER} className="p-1.5 hover:bg-white rounded text-slate-400 active:scale-90 disabled:opacity-30"><Plus size={12}/></button>
                        </div>
                        {user?.role !== UserRole.CASHIER && (
                            <button 
                                onClick={() => setActiveEditorId(isEditing ? null : i.id)}
                                className={`p-1.5 rounded-lg border transition-all ${isEditing ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400'}`}
                            >
                                <Settings2 size={12}/>
                            </button>
                        )}
                    </div>
                    
                    <button 
                        onClick={() => removeItem(i.id)} 
                        disabled={user?.role === UserRole.CASHIER}
                        className="p-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg border border-rose-100 transition-all active:scale-95 disabled:opacity-30"
                    >
                        <Trash2 size={12}/>
                    </button>
                </div>

                {isEditing && (
                    <div className="mt-2 pt-2 border-t border-slate-50 space-y-2 animate-in slide-in-from-top-1 duration-200">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest block ml-1">Override Rate</label>
                                <div className="relative">
                                    <div className="absolute left-2 top-2 text-slate-300 text-[8px] font-mono"></div>
                                    <input 
                                        type="number" 
                                        className="w-full pl-5 pr-2 py-1.5 bg-indigo-50/50 border border-indigo-100 rounded-lg text-[10px] font-black outline-none" 
                                        value={i.sellingPrice} 
                                        onChange={e => updatePriceOverride(i.id, parseFloat(e.target.value) || 0)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest block ml-1">Direct Discount</label>
                                <div className="relative">
                                    <Tag className="absolute left-2 top-2 text-slate-300" size={10}/>
                                    <input 
                                        type="number" 
                                        className="w-full pl-6 pr-2 py-1.5 bg-rose-50/30 border border-rose-100 rounded-lg text-[10px] font-black outline-none" 
                                        placeholder="Flat" 
                                        value={i.discount || ''} 
                                        onChange={e => updateDiscount(i.id, parseFloat(e.target.value) || 0)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
             </div>
           );
          })}
           {cart.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center opacity-10 pt-40">
                   <ShoppingCart size={60} strokeWidth={1} />
                   <p className="text-[9px] font-black uppercase tracking-[0.5em] mt-4 italic">Station Empty</p>
               </div>
           )}
        </div>

        {/* BOTTOM CONTROL BAR */}
        <div className="p-3 border-t border-slate-100 space-y-2 bg-white shadow-[0_-15px_40px_rgba(0,0,0,0.04)] shrink-0">
           <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-slate-50 rounded-xl px-3 border border-slate-100">
                    <Percent size={10} className="text-slate-400"/>
                    <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Global Tax%</span>
                    <input 
                        type="number" 
                        className="w-10 bg-transparent py-2 text-[10px] font-black text-slate-800 outline-none" 
                        value={vatPercent} 
                        onChange={e => setVatPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                    />
                </div>
                {paymentMethod === 'CREDIT' && (
                  <div className="flex-1 animate-in slide-in-from-right-1">
                      <input type="date" className="w-full p-1.5 bg-rose-50 border border-rose-100 rounded-xl font-black text-rose-700 text-[10px] outline-none" value={creditDueDate} onChange={e => setCreditDueDate(e.target.value)}/>
                  </div>
                )}
                <button onClick={handleHold} disabled={cart.length === 0} className="p-2.5 bg-slate-50 text-slate-400 hover:text-indigo-600 border border-slate-200 rounded-xl transition-all disabled:opacity-20 shadow-sm"><PauseCircle size={14}/></button>
           </div>

           <div className="grid grid-cols-5 gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                {[
                    { id: 'CASH', icon: <Wallet size={12}/>, label: 'CASH' },
                    { id: 'TELEBIRR', icon: <Smartphone size={12}/>, label: 'TELEBIRR' },
                    { id: 'BANK', icon: <Landmark size={12}/>, label: 'BANK' },
                    { id: 'CREDIT', icon: <CreditCard size={12}/>, label: 'CREDIT' },
                    { id: 'SPLIT', icon: <Percent size={12}/>, label: 'SPLIT' }
                ].map(m => {
                    const isBankActive = ['CBE', 'BOA', 'AWASH', 'DASHEN', 'OTHER'].includes(paymentMethod);
                    const isActive = m.id === 'BANK' ? isBankActive : paymentMethod === m.id;
                    return (
                        <button 
                          key={m.id} 
                          onClick={() => {
                              if (m.id === 'BANK') {
                                  setPaymentMethod(selectedBank);
                              } else {
                                  setPaymentMethod(m.id as any);
                              }
                          }} 
                          className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-lg border transition-all ${isActive ? 'bg-teal-600 border-teal-600 text-white shadow-md scale-[1.02]' : 'bg-white border-slate-100 text-slate-400 hover:bg-slate-50'}`}
                        >
                            {m.icon}
                            <span className="text-[6.5px] font-black uppercase tracking-widest">{m.id === 'BANK' && isBankActive ? `${paymentMethod}` : m.label}</span>
                        </button>
                    );
                })}
           </div>

           {paymentMethod === 'SPLIT' && (
               <div className="space-y-2 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100/50 animate-in fade-in slide-in-from-top-1">
                   {splitPayments.map((sp, idx) => (
                       <div key={idx} className="flex gap-2 items-center">
                           <select 
                               className="flex-1 bg-white border border-indigo-100 font-bold text-[9px] uppercase p-2 rounded-lg outline-none text-indigo-900"
                               value={sp.method}
                               onChange={e => {
                                   const newSp = [...splitPayments];
                                   newSp[idx].method = e.target.value as any;
                                   setSplitPayments(newSp);
                               }}
                           >
                               <option value="CASH">CASH</option>
                               <option value="TELEBIRR">TELEBIRR</option>
                               <option value="CBE">CBE</option>
                               <option value="BOA">BOA</option>
                               <option value="AWASH">AWASH</option>
                               <option value="DASHEN">DASHEN</option>
                               <option value="OTHER">OTHER BANK</option>
                           </select>
                           <input 
                               type="number"
                               className="w-24 bg-white border border-indigo-100 font-black text-right text-xs p-2 rounded-lg outline-none text-indigo-900"
                               value={sp.amount || ''}
                               onChange={e => {
                                   const newSp = [...splitPayments];
                                   newSp[idx].amount = parseFloat(e.target.value) || 0;
                                   setSplitPayments(newSp);
                               }}
                               placeholder="0.00"
                           />
                       </div>
                   ))}
                   <div className="flex justify-between items-center px-1">
                       <span className="text-[8px] font-black uppercase tracking-widest text-indigo-400">Total: {splitPayments.reduce((s, sp) => s + (sp.amount || 0), 0).toFixed(2)}</span>
                       <span className="text-[8px] font-black uppercase tracking-widest text-indigo-400">Target: {cartGrandTotal.toFixed(2)}</span>
                   </div>
               </div>
           )}

           {['CBE', 'BOA', 'AWASH', 'DASHEN', 'OTHER'].includes(paymentMethod) && (
                <div className="grid grid-cols-5 gap-1 bg-teal-50/50 p-1 rounded-xl border border-teal-100/70 mt-1 animate-in fade-in slide-in-from-top-1">
                     {[
                         { id: 'CBE', label: 'CBE' },
                         { id: 'BOA', label: 'BOA' },
                         { id: 'AWASH', label: 'AWASH' },
                         { id: 'DASHEN', label: 'DASHEN' },
                         { id: 'OTHER', label: 'OTHER' }
                     ].map(b => (
                         <button
                           key={b.id}
                           onClick={() => {
                               setSelectedBank(b.id as any);
                               setPaymentMethod(b.id as any);
                           }}
                           className={`py-1 rounded-lg text-[6.5px] font-black uppercase tracking-wider transition-all border ${paymentMethod === b.id ? 'bg-teal-700 text-white border-teal-700 shadow-sm' : 'bg-white text-teal-700 border-teal-100 hover:bg-teal-50'}`}
                         >
                             {b.label}
                         </button>
                     ))}
                </div>
           )}

           <div className="flex items-center justify-between px-1 py-1">
                <div className="flex flex-col">
                    <p className="text-[7px] font-black text-slate-300 uppercase tracking-widest leading-none">Net Liabilities</p>
                    {totalDiscounts > 0 && <span className="text-[8px] font-black text-rose-500 uppercase italic mt-1">-{totalDiscounts.toFixed(2)} savings</span>}
                </div>
                <p className="text-3xl font-black text-teal-800 font-mono tracking-tighter leading-none">{cartGrandTotal.toFixed(2)}</p>
           </div>
           
           <button 
             onClick={executeSale} 
             disabled={cart.length === 0 || isProcessing} 
             className="w-full bg-teal-600 text-white h-12 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] hover:bg-teal-700 shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-30"
           >
               {isProcessing ? <Loader2 className="animate-spin" size={14}/> : <Check size={14}/>}
               {isProcessing ? 'AUTHORIZING DISBURSEMENT...' : 'COMMIT DISPENSE'}
           </button>
        </div>
      </div>

      {/* Held Carts Modal */}
      {showHolds && (
          <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[2100] p-4 backdrop-blur-md animate-in fade-in">
              <div className="bg-white rounded-[2.5rem] shadow-3xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden border border-white/20">
                  <div className="p-6 border-b flex justify-between items-center bg-indigo-50/50">
                      <div className="flex items-center gap-3"><PauseCircle className="text-indigo-600" size={20}/><h2 className="text-lg font-black text-indigo-800 uppercase tracking-tighter">Suspended Node States</h2></div>
                      <button onClick={() => setShowHolds(false)} className="p-2 hover:bg-indigo-100 rounded-full transition-colors"><X size={24}/></button>
                  </div>
                  <div className="flex-1 p-6 overflow-y-auto space-y-3 no-scrollbar">
                      {heldCarts.map(h => (
                          <div key={h.id} className="p-5 bg-slate-50 border border-slate-200 rounded-[1.5rem] flex justify-between items-center group hover:border-indigo-400 hover:bg-white transition-all shadow-sm">
                              <div>
                                  <h4 className="font-black text-slate-800 uppercase text-xs mb-1">{h.patientName}</h4>
                                  <p className="text-[8px] text-slate-400 font-bold uppercase italic">Stashed: {new Date(h.timestamp).toLocaleString()}</p>
                              </div>
                              <div className="flex gap-2">
                                  <button onClick={() => resumeHold(h)} className="p-3 bg-indigo-600 text-white rounded-xl shadow-lg active:scale-90 transition-all hover:bg-indigo-700"><PlayCircle size={16}/></button>
                                  <button onClick={() => setHeldCarts(heldCarts.filter((x: any) => x.id !== h.id))} className="p-3 bg-white border border-rose-100 text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={16}/></button>
                              </div>
                          </div>
                      ))}
                      {heldCarts.length === 0 && <div className="text-center py-20 text-slate-300 font-black uppercase text-[10px] tracking-widest">No stashed transactions.</div>}
                  </div>
              </div>
          </div>
      )}

      {/* Receipt Modal */}
      {showReceipt && (
          <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-3xl flex items-center justify-center z-[2000] p-4 animate-in fade-in duration-300">
              <div className="max-w-4xl w-full flex flex-col h-full items-center">
                  <div className="w-full flex justify-between items-center mb-8 px-6 text-white shrink-0">
                    <h2 className="font-black uppercase text-base tracking-[0.2em] flex items-center gap-4">
                        <div className="p-2 bg-emerald-500 rounded-xl shadow-lg shadow-emerald-500/20"><Check size={20}/></div>
                        Ledger Update Successful
                    </h2>
                    <button onClick={() => setShowReceipt(null)} className="p-4 bg-white/5 hover:bg-white/10 rounded-full transition-all"><X size={32}/></button>
                  </div>
                  <div className="flex-1 w-full overflow-y-auto no-scrollbar flex flex-col items-center pb-20">
                    <div className="shadow-4xl bg-white origin-top rounded-lg p-1">
                        <ReceiptTemplate sale={showReceipt} info={pharmacyInfo} />
                    </div>
                    <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-xl">
                        <button onClick={() => generateReceiptPDF(showReceipt, pharmacyInfo)} className="bg-teal-600 text-white py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-3 shadow-2xl shadow-teal-500/20 hover:bg-teal-700 transition-all"><Download size={18}/> Thermal Print (PDF)</button>
                        <button onClick={() => generateA4AttachmentPDF(showReceipt, pharmacyInfo)} className="bg-indigo-600 text-white py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-3 shadow-2xl shadow-indigo-500/20 hover:bg-indigo-700 transition-all"><FileText size={18}/> A4 Dispense Doc</button>
                    </div>
                    <button onClick={() => setShowReceipt(null)} className="mt-8 text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] hover:text-white transition-colors">Terminate View & Clear Station</button>
                  </div>
              </div>
          </div>
      )}

      {/* Expense Registration Modal */}
      {showExpenseModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[2000] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden relative">
            <button onClick={() => setShowExpenseModal(false)} className="absolute top-10 right-10 text-slate-400 hover:text-slate-800 transition-colors"><X size={24} /></button>
            <div className="p-10">
              <div><h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Post Loss / Expense</h2><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Register Operational Overhead</p></div>
              <form onSubmit={handleAddExpense} className="space-y-6 mt-8">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Disbursement Amount ()</label>
                  <div className="relative">
                  <span className="absolute left-5 top-4 font-mono font-black text-slate-400 text-xl"></span>
                  <input type="number" step="0.01" required value={newExpense.amount || ''} onChange={e => setNewExpense({...newExpense, amount: parseFloat(e.target.value) || 0})} className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 font-mono font-black text-xl text-slate-800 focus:ring-4 focus:ring-rose-500/20" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Classification</label>
                  <select value={newExpense.category} onChange={e => setNewExpense({...newExpense, category: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-rose-500/20">
                    <option value="Utilities">Utilities</option><option value="Payroll">Payroll</option><option value="Inventory Loss">Inventory Loss / Expiry</option><option value="Repairs">Repairs & Maintenance</option><option value="Marketing">Marketing</option><option value="Miscellaneous">Miscellaneous</option>
                  </select>
                  </div>
                  <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Date Frame</label>
                  <input type="date" required value={newExpense.date} onChange={e => setNewExpense({...newExpense, date: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 font-mono font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-rose-500/20" />
                  </div>
                </div>
                <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Line-Item Description</label>
                <textarea required value={newExpense.description} onChange={e => setNewExpense({...newExpense, description: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-rose-500/20" rows={3} placeholder="Justification..." />
                </div>
              <button type="submit" className="w-full bg-rose-600 text-white rounded-2xl py-4 font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-xl shadow-rose-600/20 active:scale-95">Commit Expense to Ledger</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
