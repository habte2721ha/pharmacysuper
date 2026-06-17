import React, { useEffect, useState, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { db } from '../services/db';
import { Product, ProductCategory, UserRole, Supplier, Sale, StockAdjustment } from '../types';
import { MED_CATEGORIES, UNITS, DB_KEYS } from '../constants';
import { useAppContext } from '../App';
import { 
  Edit, Search, ArrowUp, ArrowDown, Trash2, Package, 
  Loader2, X, Beaker, Sparkles, 
  ChevronDown, ChevronRight as ChevronRightIcon,
  Settings2, Scale, ArrowRight, Save, PlusCircle, Layers, FileSpreadsheet, Filter, AlertCircle,
  Stethoscope, Truck, FileUp, CloudUpload, History, ClipboardPaste
} from 'lucide-react';
import { ClinicalLabelingModal } from '../components/ClinicalLabelingModal';

const ITEMS_PER_PAGE = 50;

interface GroupedProduct {
    name: string;
    type: ProductCategory;
    medCategory?: string;
    unit?: string;
    totalQuantity: number;
    totalStoreQuantity: number;
    minStockLevel: number;
    batches: Product[];
    status: 'FAST' | 'SLOW' | 'NON-MOVING';
    maxSellingPrice: number;
    minBuyingPrice: number;
}

const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);

export default function Inventory() {
  const { user, pharmacyInfo, globalBranch } = useAppContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [movementMap, setMovementMap] = useState<Record<string, 'FAST' | 'SLOW' | 'NON-MOVING'>>({});
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isMasterEdit, setIsMasterEdit] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionRef = useRef<HTMLDivElement>(null);

  const [adjustingGroup, setAdjustingGroup] = useState<GroupedProduct | null>(null);
  const [adjustmentValue, setAdjustmentValue] = useState<number>(0);
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>([]);
  const [viewLogsGroup, setViewLogsGroup] = useState<GroupedProduct | null>(null);
  
  const [isDirectTransferOpen, setIsDirectTransferOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pastedData, setPastedData] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvParsing, setCsvParsing] = useState(false);
  const [transferTarget, setTransferTarget] = useState<Product | null>(null);
  const [isStoreTransferOpen, setIsStoreTransferOpen] = useState(false);
  const [storeTransferTarget, setStoreTransferTarget] = useState<GroupedProduct | null>(null);
  const [storeTransferQty, setStoreTransferQty] = useState<number>(0);
  const [transferData, setTransferData] = useState<{
      destination: string, date: string, reason: string, qty: number, source: 'DISPENSARY' | 'STORE', destStore: boolean
  }>({
      destination: '', date: new Date().toISOString().split('T')[0], reason: '', qty: 0, source: 'DISPENSARY', destStore: false
  });

  const handleStoreTransfer = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user || !storeTransferTarget || storeTransferQty <= 0) return;
      if (storeTransferQty > storeTransferTarget.totalStoreQuantity) {
          alert('Not enough stock in store'); return;
      }
      try {
          let remaining = storeTransferQty;
          for (const b of storeTransferTarget.batches) {
              if (remaining <= 0) break;
              const availableInBatch = b.storeQuantity || 0;
              if (availableInBatch > 0) {
                  const toTransfer = Math.min(availableInBatch, remaining);
                  await db.updateProduct({ 
                      ...b, 
                      storeQuantity: availableInBatch - toTransfer,
                      quantity: b.quantity + toTransfer 
                  } as Product, user);
                  remaining -= toTransfer;
              }
          }
          await db.logActivity(user, 'STORE_TRANSFER', `Transferred ${storeTransferQty} ${storeTransferTarget.name} from Store to Dispensary`);
          setIsStoreTransferOpen(false);
          await loadData();
          alert('Transfer complete');
      } catch (err) {
          alert('Transfer failed');
      }
  };

  const handleDirectTransfer = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user || !transferTarget) return;
      const isSourceStore = transferData.source === 'STORE';
      const availableQty = isSourceStore ? (transferTarget.storeQuantity || 0) : transferTarget.quantity;

      if (transferData.qty <= 0 || transferData.qty > availableQty) {
          alert('Invalid transfer quantity or insufficient stock in selected source.'); return;
      }
      try {
          if (transferData.destination === 'INTERNAL') {
              // INTERNAL TRANSFER (Same Product ID)
              const updatedProduct = { ...transferTarget };
              if (isSourceStore) {
                  updatedProduct.storeQuantity = (updatedProduct.storeQuantity || 0) - transferData.qty;
                  updatedProduct.quantity = updatedProduct.quantity + transferData.qty;
              } else {
                  updatedProduct.quantity = updatedProduct.quantity - transferData.qty;
                  updatedProduct.storeQuantity = (updatedProduct.storeQuantity || 0) + transferData.qty;
              }
              await db.updateProduct(updatedProduct, user, true);

              // Add bin card entry for this internal move
              await db.addBinCardEntry(transferTarget.id, {
                  id: crypto.randomUUID(),
                  date: transferData.date + 'T' + new Date().toISOString().split('T')[1],
                  type: 'ADJUSTMENT', // Treat as internal adjustment
                  reference: `Moved from ${isSourceStore ? 'Store to Dispensary' : 'Dispensary to Store'} (${transferData.reason})`,
                  batchNumber: transferTarget.batchNumber || '',
                  expiryDate: transferTarget.expiryDate || '',
                  inQty: isSourceStore ? transferData.qty : 0, // Showing Dispensary perspective generally
                  outQty: isSourceStore ? 0 : transferData.qty,
                  balance: updatedProduct.quantity,
                  user: user.username
              });

              await db.logActivity(user, 'INVENTORY_MOVE', `Moved ${transferData.qty} of ${transferTarget.name} from ${isSourceStore ? 'Store to Dispensary' : 'Dispensary to Store'}`);
              
              setIsDirectTransferOpen(false);
              await loadData();
              alert('Internal stock moved successfully.');
              return;
          }

          // Reduce from source
          const updatedProduct = isSourceStore 
              ? { ...transferTarget, storeQuantity: (transferTarget.storeQuantity || 0) - transferData.qty }
              : { ...transferTarget, quantity: transferTarget.quantity - transferData.qty };
          await db.updateProduct(updatedProduct, user, true);

          // Add bin card for source
          await db.addBinCardEntry(transferTarget.id, {
              id: crypto.randomUUID(),
              date: transferData.date + 'T' + new Date().toISOString().split('T')[1],
              type: 'TRANSFER_OUT',
              reference: `Direct Trf to ${transferData.destination} ${transferData.destStore ? 'Store' : 'Pharmacy'} (${transferData.reason}) [From ${isSourceStore ? 'Store' : 'Dispensary'}]`,
              batchNumber: transferTarget.batchNumber,
              expiryDate: transferTarget.expiryDate,
              inQty: 0,
              outQty: transferData.qty,
              balance: isSourceStore ? updatedProduct.storeQuantity || 0 : updatedProduct.quantity,
              user: user.username
          });

          // If destination is one of the available branches, create/update item there
          if (pharmacyInfo?.branches?.includes(transferData.destination)) {
              const allProducts: Product[] = await db.getProducts() || [];
              const existingDestProduct = allProducts.find((p: Product) => 
                  p.branch === transferData.destination &&
                  p.name.toLowerCase() === transferTarget.name.toLowerCase() &&
                  p.batchNumber === transferTarget.batchNumber &&
                  !p.isDeleted
              );

              let destProductId = '';
              let newBalance = 0;

              if (existingDestProduct) {
                  const destProduct = transferData.destStore 
                      ? { ...existingDestProduct, storeQuantity: (existingDestProduct.storeQuantity || 0) + transferData.qty }
                      : { ...existingDestProduct, quantity: existingDestProduct.quantity + transferData.qty };
                  destProductId = destProduct.id;
                  newBalance = transferData.destStore ? (destProduct.storeQuantity || 0) : destProduct.quantity;
                  await db.updateProduct(destProduct, user, true);
              } else {
                  const destProduct = { 
                      ...transferTarget, 
                      id: generateId(), 
                      branch: transferData.destination, 
                      quantity: transferData.destStore ? 0 : transferData.qty,
                      storeQuantity: transferData.destStore ? transferData.qty : 0
                  };
                  destProductId = destProduct.id;
                  newBalance = transferData.qty;
                  await db.addProduct(destProduct, user, true);
              }
              
              // Add bin card for destination
              await db.addBinCardEntry(destProductId, {
                  id: crypto.randomUUID(),
                  date: transferData.date + 'T' + new Date().toISOString().split('T')[1],
                  type: 'RECEIVED',
                  reference: `Transferred from ${transferTarget.branch || 'Main Branch'} ${isSourceStore ? 'Store' : 'Dispensary'} (${transferData.reason})`,
                  batchNumber: transferTarget.batchNumber || '',
                  expiryDate: transferTarget.expiryDate || '',
                  inQty: transferData.qty,
                  outQty: 0,
                  balance: newBalance,
                  user: user.username
              });
          }

          await db.logActivity(user, 'BULK_TRANSFER', `Direct Transfer of ${transferTarget.name} to ${transferData.destination}`);
          
          setIsDirectTransferOpen(false);
          await loadData();
          alert(pharmacyInfo?.branches?.includes(transferData.destination) ? `Transfer recorded. Quantity reduced from here and added to branch: ${transferData.destination}.` : 'Transfer recorded and balance reduced.');
      } catch (err) { alert('Transfer failed'); }
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'MEDICINE' | 'COSMETIC'>('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'OUT'>('ALL');
  const [sortBy, setSortBy] = useState<'NAME' | 'STOCK' | 'PRICE'>('NAME');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
  const [currentPage, setCurrentPage] = useState(1);
  
  const initialFormState: Partial<Product> = useMemo(() => ({
    type: ProductCategory.MEDICINE,
    name: '', quantity: 0, storeQuantity: 0, minStockLevel: 10, supplier: '',
    buyingPrice: 0, sellingPrice: 0, expiryDate: '',
    medCategory: MED_CATEGORIES[0], unit: UNITS[0], batchNumber: ''
  }), []);
  const [formData, setFormData] = useState<Partial<Product>>(initialFormState);

  // --- LABELING STATE ---
  const [isLabelingOpen, setIsLabelingOpen] = useState(false);
  const [labelTarget, setLabelTarget] = useState({ drugName: '', strength: '' });

  const canEdit = useMemo(() => user?.role === UserRole.ADMIN, [user]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedProducts, sales, loadedSuppliers, loadedAdjustments] = await Promise.all([
        db.getProducts(), db.getSales(), db.getSuppliers(), db.getStockAdjustments()
      ]) as [Product[], Sale[], Supplier[], StockAdjustment[]];

      const activeProducts = loadedProducts.filter(p => {
        if (p.isDeleted) return false;
        if (user?.role === 'ADMIN') {
             if (globalBranch) {
                 if (globalBranch === 'MAIN') return !p.branch;
                 return p.branch === globalBranch;
             }
             return true;
        }
        return !p.branch || p.branch === user?.branch;
      });
      setProducts(activeProducts);
      setSuppliers(loadedSuppliers.filter(s => !s.isDeleted));
      setStockAdjustments(loadedAdjustments || []);
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentSales = sales.filter(s => new Date(s.date) >= thirtyDaysAgo);
      const salesMap: Record<string, number> = {};
      
      recentSales.forEach((sale: any) => {
        sale.items.forEach((item: any) => {
          const nameKey = item.name.toLowerCase().trim();
          salesMap[nameKey] = (salesMap[nameKey] || 0) + item.cartQty;
        });
      });
      
      const moveMap: Record<string, 'FAST' | 'SLOW' | 'NON-MOVING'> = {};
      const uniqueNames = Array.from(new Set(activeProducts.map(p => p.name.toLowerCase().trim())));
      uniqueNames.forEach((nameKey: string) => {
        const sold = salesMap[nameKey] || 0;
        const totalStock = activeProducts.filter(p => p.name.toLowerCase().trim() === nameKey).reduce((s, p) => s + p.quantity, 0);
        if (sold === 0) moveMap[nameKey] = 'NON-MOVING';
        else if (sold > (totalStock + sold) * 0.15) moveMap[nameKey] = 'FAST';
        else moveMap[nameKey] = 'SLOW';
      });
      setMovementMap(moveMap);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [user, globalBranch]);

  useEffect(() => {
    loadData();
    const handleUpdate = (e: any) => { if (e.detail?.key === DB_KEYS.PRODUCTS || e.detail?.key === 'all') loadData(); };
    window.addEventListener('local-data-update', handleUpdate);
    const handleClickOutside = (event: MouseEvent) => { 
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => { 
      window.removeEventListener('local-data-update', handleUpdate); 
      document.removeEventListener('mousedown', handleClickOutside); 
    };
  }, [loadData]);

  const deferredSearch = useDeferredValue(searchTerm);

  const baseGroupedProducts = useMemo(() => {
    const map = new Map<string, GroupedProduct>();
    products.forEach((p: any) => {
        const key = p.name.trim().toLowerCase();
        if (!map.has(key)) {
            map.set(key, { 
              name: p.name, type: p.type, medCategory: p.medCategory, unit: p.unit, 
              totalQuantity: 0, totalStoreQuantity: 0, minStockLevel: p.minStockLevel, batches: [], 
              status: movementMap[key] || 'SLOW', maxSellingPrice: 0, minBuyingPrice: Infinity 
            });
        }
        const g = map.get(key)!;
        g.totalQuantity += p.quantity;
        g.totalStoreQuantity += (p.storeQuantity || 0);
        g.minStockLevel = Math.max(g.minStockLevel, p.minStockLevel);
        g.maxSellingPrice = Math.max(g.maxSellingPrice, p.sellingPrice);
        g.minBuyingPrice = Math.min(g.minBuyingPrice, p.buyingPrice);
        g.batches.push(p);
    });
    map.forEach((g: any) => { 
        if (g.minBuyingPrice === Infinity) g.minBuyingPrice = 0; 
        g.batches.sort((a: any, b: any) => {
            const timeA = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
            const timeB = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
            return timeA - timeB;
        }); 
    });
    return Array.from(map.values());
  }, [products, movementMap]);

  const groupedProducts = useMemo(() => {
    return baseGroupedProducts.filter(g => {
        const s = deferredSearch.toLowerCase();
        const matchesSearch = g.name.toLowerCase().includes(s);
        const matchesType = typeFilter === 'ALL' ? true : g.type === typeFilter;
        let matchesStock = true;
        if (stockFilter === 'LOW') matchesStock = g.totalQuantity <= g.minStockLevel && g.totalQuantity > 0;
        if (stockFilter === 'OUT') matchesStock = g.totalQuantity === 0;
        return matchesSearch && matchesType && matchesStock;
    }).sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'NAME') cmp = a.name.localeCompare(b.name);
        if (sortBy === 'STOCK') cmp = a.totalQuantity - b.totalQuantity;
        if (sortBy === 'PRICE') cmp = a.maxSellingPrice - b.maxSellingPrice;
        return sortOrder === 'ASC' ? cmp : -cmp;
    });
  }, [baseGroupedProducts, deferredSearch, typeFilter, stockFilter, sortBy, sortOrder]);

  const totalPages = Math.ceil(groupedProducts.length / ITEMS_PER_PAGE);

  useEffect(() => {
      setCurrentPage(1);
  }, [deferredSearch, typeFilter, stockFilter, sortBy, sortOrder]);

  const uniqueProductNames = useMemo(() => Array.from(new Set(products.map(p => p.name))), [products]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData(prev => ({ ...prev, name: value }));
    
    if (!editingId && value.length >= 1) { 
        const matches = uniqueProductNames.filter(n => n.toLowerCase().startsWith(value.toLowerCase())).slice(0, 5);
        setNameSuggestions(matches);
        setShowSuggestions(matches.length > 0);
    } else {
        setShowSuggestions(false);
    }
  };

  const selectSuggestion = (name: string) => {
    const existing = products.find((p: any) => p.name.toLowerCase().trim() === name.toLowerCase().trim());
    if (existing) {
        const isCosmetic = existing.type === ProductCategory.COSMETIC;
        setFormData(prev => ({
            ...prev,
            name: existing.name,
            type: existing.type,
            medCategory: isCosmetic ? undefined : existing.medCategory,
            unit: isCosmetic ? "Each" : existing.unit,
            minStockLevel: existing.minStockLevel,
            buyingPrice: existing.buyingPrice,
            sellingPrice: existing.sellingPrice,
            supplier: existing.supplier
        }));
    } else {
        setFormData(prev => ({ ...prev, name }));
    }
    setShowSuggestions(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canEdit) return;
    setFormError(null);
    try {
      if (isMasterEdit) {
        const originalProduct = products.find((p: any) => p.id === editingId);
        if (originalProduct) {
            const batches = products.filter(p => p.name.toLowerCase().trim() === originalProduct.name.toLowerCase().trim());
            for (const b of batches) {
              const isCosmetic = (formData.type || b.type) === ProductCategory.COSMETIC;
              await db.updateProduct({ 
                ...b, 
                name: formData.name || b.name, 
                medCategory: isCosmetic ? undefined : (formData.medCategory || b.medCategory), 
                unit: isCosmetic ? "Each" : (formData.unit || b.unit), 
                type: formData.type || b.type, 
                sellingPrice: formData.sellingPrice ?? b.sellingPrice,
                minStockLevel: formData.minStockLevel ?? b.minStockLevel
              } as Product, user);
            }
        }
      } else if (editingId) {
        const existing = products.find((p: any) => p.id === editingId);
        if (existing) {
            let updatePayload = { ...existing, ...formData } as Product;
            if (updatePayload.type === ProductCategory.COSMETIC) {     
                updatePayload.unit = "Each";
                updatePayload.medCategory = undefined;
            }
            await db.updateProduct(updatePayload, user);
        }
      } else {
        let payload = { ...formData as Product, id: generateId(), createdAt: new Date().toISOString() };
        if (payload.type === ProductCategory.COSMETIC) {
            payload.unit = "Each";
            payload.medCategory = undefined;
        }
        await db.addProduct(payload, user);
      }
      setIsModalOpen(false); setEditingId(null); await loadData();
    } catch (e) { setFormError("Persistence error."); }
  };

  const handleGroupAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !adjustingGroup || !canEdit) return;
    try {
        const diff = adjustmentValue - adjustingGroup.totalQuantity;
        if (diff === 0) {
            setIsAdjustModalOpen(false);
            return;
        }
        if (diff > 0) {
            const latestBatch = adjustingGroup.batches[adjustingGroup.batches.length - 1];
            await db.updateProduct({ ...latestBatch, quantity: latestBatch.quantity + diff } as Product, user);
        } else {
            let remainingToRemove = Math.abs(diff);
            for (const b of adjustingGroup.batches) {
                if (remainingToRemove <= 0) break;
                const canRemove = Math.min(b.quantity, remainingToRemove);
                await db.updateProduct({ ...b, quantity: b.quantity - canRemove } as Product, user);
                remainingToRemove -= canRemove;
            }
        }
        
        await db.addStockAdjustment({
            id: generateId(),
            productName: adjustingGroup.name,
            date: new Date().toISOString(),
            userId: user.id || "SYS",
            username: user.username,
            previousQuantity: adjustingGroup.totalQuantity,
            newQuantity: adjustmentValue,
            difference: diff
        });

        setIsAdjustModalOpen(false);
        await loadData();
    } catch (err) {
        console.error("Reconciliation failed:", err);
        alert("Reconciliation failed.");
    }
  };
  const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
             inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
             result.push(current.trim());
             current = '';
          } else {
             current += char;
          }
      }
      result.push(current.trim().replace(/^"|"/g, ''));
      return result;
  };

  const handlePasteImport = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!pastedData || !user) return;
      
      setCsvParsing(true);
      try {
          const lines = pastedData.split(/\r?\n/).filter(line => line.trim().length > 0);
          if (lines.length < 2) {
              alert('Pasted data must contain a header row and at least one data row. Or ensure data is tab-separated (TSV) from Excel.');
              setCsvParsing(false);
              return;
          }
          
          // Split by \t (tab) since it's likely pasted from excel
          let separator = '\t';
          if (!lines[0].includes('\t') && lines[0].includes(',')) separator = ',';

          const parseLine = (line: string) => line.split(separator).map(v => v.trim());
          
          const headers = parseLine(lines[0]).map(h => h.toLowerCase());
          const nameIdx = headers.indexOf('name');
          const qtyIdx = headers.findIndex(h => h.includes('quantity') || h.includes('qty'));
          const storeQtyIdx = headers.findIndex(h => h.includes('store quantity') || h.includes('store qty'));
          const buyingPriceIdx = headers.findIndex(h => h.includes('buying price') || h.includes('cost'));
          const sellingPriceIdx = headers.findIndex(h => h.includes('selling price') || h.includes('price'));
          const typeIdx = headers.findIndex(h => h.includes('type') || h.includes('category'));
          const minStockIdx = headers.findIndex(h => h.includes('min stock') || h.includes('min'));
          const supplierIdx = headers.findIndex(h => h.includes('supplier') || h.includes('vendor'));
          const batchIdx = headers.findIndex(h => h.includes('batch'));
          const expIdx = headers.findIndex(h => h.includes('expiry') || h.includes('exp'));
          
          if (nameIdx === -1 || qtyIdx === -1 || sellingPriceIdx === -1) {
              alert('Data must at least contain "Name", "Quantity", and "Selling Price" columns. Detected headers: ' + headers.join(', '));
              setCsvParsing(false);
              return;
          }

          let addedCount = 0;

          for (let i = 1; i < lines.length; i++) {
              const row = parseLine(lines[i]);
              if (row.length < nameIdx) continue; 
              
              const name = row[nameIdx];
              if (!name) continue;

              const qty = parseInt(row[qtyIdx]) || 0;
              const sqty = storeQtyIdx !== -1 ? parseInt(row[storeQtyIdx]) || 0 : 0;
              const sp = parseFloat(row[sellingPriceIdx]) || 0;
              const bp = buyingPriceIdx !== -1 ? parseFloat(row[buyingPriceIdx]) || 0 : 0;
              let type = ProductCategory.MEDICINE;
              if (typeIdx !== -1 && row[typeIdx]) {
                  const typeStr = row[typeIdx].toUpperCase();
                  if (typeStr.includes('COSMETIC')) type = ProductCategory.COSMETIC;
              }
              const minStockLevel = minStockIdx !== -1 ? parseInt(row[minStockIdx]) || 10 : 10;
              const supplier = supplierIdx !== -1 ? row[supplierIdx] : '';
              const batchNumber = batchIdx !== -1 ? row[batchIdx] : '';
              const expiryDate = expIdx !== -1 ? row[expIdx] : '';

              const payload: Product = {
                  id: crypto.randomUUID(),
                  type,
                  name,
                  medCategory: MED_CATEGORIES[0],
                  unit: UNITS[0],
                  batchNumber,
                  quantity: qty,
                  storeQuantity: sqty,
                  minStockLevel,
                  supplier,
                  expiryDate: expiryDate || new Date().toISOString().split('T')[0],
                  buyingPrice: bp,
                  sellingPrice: sp,
                  createdAt: new Date().toISOString(),
                  isDeleted: false
              };
              
              await db.addProduct(payload, user);
              addedCount++;
          }
          
          await loadData();
          setIsPasteModalOpen(false);
          setPastedData('');
          alert(`Successfully imported ${addedCount} products.`);
      } catch (err: any) {
          alert('Error pasting data: ' + err.message);
      } finally {
          setCsvParsing(false);
      }
  };

  const handleCsvImport = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!csvFile || !user) return;
      
      setCsvParsing(true);
      try {
          const text = await csvFile.text();
          const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
          if (lines.length < 2) {
              alert('CSV must contain a header row and at least one data row.');
              setCsvParsing(false);
              return;
          }
          
          const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
          const nameIdx = headers.indexOf('name');
          const qtyIdx = headers.findIndex(h => h.includes('quantity') || h.includes('qty'));
          const buyingPriceIdx = headers.findIndex(h => h.includes('buying price') || h.includes('cost'));
          const sellingPriceIdx = headers.findIndex(h => h.includes('selling price') || h.includes('price'));
          const typeIdx = headers.findIndex(h => h.includes('type') || h.includes('category'));
          const minStockIdx = headers.findIndex(h => h.includes('min stock') || h.includes('min'));
          const supplierIdx = headers.findIndex(h => h.includes('supplier') || h.includes('vendor'));
          const batchIdx = headers.findIndex(h => h.includes('batch'));
          const expIdx = headers.findIndex(h => h.includes('expiry') || h.includes('exp'));
          
          if (nameIdx === -1 || qtyIdx === -1 || sellingPriceIdx === -1) {
              alert('CSV must at least contain "Name", "Quantity", and "Selling Price" columns.');
              setCsvParsing(false);
              return;
          }

          let addedCount = 0;

          for (let i = 1; i < lines.length; i++) {
              const row = parseCSVLine(lines[i]);
              if (row.length < headers.length) continue; 
              
              const name = row[nameIdx];
              if (!name) continue;

              const qty = parseInt(row[qtyIdx]) || 0;
              const sp = parseFloat(row[sellingPriceIdx]) || 0;
              const bp = buyingPriceIdx !== -1 ? parseFloat(row[buyingPriceIdx]) || 0 : 0;
              let type = ProductCategory.MEDICINE;
              if (typeIdx !== -1) {
                  const typeStr = row[typeIdx].toUpperCase();
                  if (typeStr.includes('COSMETIC')) type = ProductCategory.COSMETIC;
              }
              const minStockLevel = minStockIdx !== -1 ? parseInt(row[minStockIdx]) || 10 : 10;
              const supplier = supplierIdx !== -1 ? row[supplierIdx] : '';
              const batchNumber = batchIdx !== -1 ? row[batchIdx] : '';
              const expiryDate = expIdx !== -1 ? row[expIdx] : '';

              const payload: Product = {
                  id: generateId(),
                  createdAt: new Date().toISOString(),
                  name: name.replace(/^"|"/g, ''),
                  type,
                  quantity: qty,
                  buyingPrice: bp,
                  sellingPrice: sp,
                  minStockLevel,
                  unit: type === ProductCategory.COSMETIC ? 'Each' : 'Tabs/Caps',
                  supplier: supplier.replace(/^"|"/g, ''),
                  batchNumber: batchNumber.replace(/^"|"/g, ''),
                  expiryDate: expiryDate.replace(/^"|"/g, ''),
                  medCategory: type === ProductCategory.MEDICINE ? MED_CATEGORIES[0] : undefined
              };

              await db.addProduct(payload, user);
              addedCount++;
          }
          
          alert(`Successfully imported ${addedCount} products.`);
          setIsCsvModalOpen(false);
          setCsvFile(null);
          loadData();
      } catch (err) {
          console.error(err);
          alert('Failed to parse CSV file. Ensure it is formatted correctly.');
      }
      setCsvParsing(false);
  };

  const handleExportExcel = () => {
      const headers = ["Product Name", "Type", "Category", "Supplier", "Stock Status", "Current Qty", "Min Level", "Price", "Valuation"];
      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [
        headers.join(','),
        ...groupedProducts.map(g => [
          `"${g.name.replace(/"/g, '""')}"`,
          g.type,
          `"${g.type === ProductCategory.MEDICINE ? g.medCategory : 'Cosmetic'}"`,
          `"${g.batches[0]?.supplier || 'N/A'}"`,
          g.totalQuantity === 0 ? 'Stockout' : (g.totalQuantity <= g.minStockLevel ? 'Low Stock' : 'Stable'),
          g.totalQuantity,
          g.minStockLevel,
          g.maxSellingPrice.toFixed(2),
          (g.totalQuantity * g.maxSellingPrice).toFixed(2)
        ].join(','))
      ].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Inventory_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEditMaster = (group: GroupedProduct) => {
    setFormData({ ...group.batches[0] });
    setEditingId(group.batches[0].id);
    setIsMasterEdit(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenLabeling = (group: GroupedProduct) => {
    const nameParts = group.name.split(' ');
    const drugName = nameParts.slice(0, -1).join(' ') || group.name;
    const strength = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    setLabelTarget({ drugName, strength });
    setIsLabelingOpen(true);
  };

  const handleDeleteGroup = async (group: GroupedProduct) => {
    if (!user || user.role !== UserRole.ADMIN) return;
    if (window.confirm(`Permanently remove ALL ${group.batches.length} batches of "${group.name}"?`)) {
        for (const b of group.batches) await db.deleteProduct(b.id, user);
        await loadData();
    }
  };

  const paginatedGroups = useMemo(() => { 
    const start = (currentPage - 1) * ITEMS_PER_PAGE; 
    return groupedProducts.slice(start, start + ITEMS_PER_PAGE); 
  }, [groupedProducts, currentPage]);

  return (
    <div className="flex flex-col h-full overflow-hidden animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 shrink-0 gap-4">
        <div><h1 className="text-4xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic"><Package className="text-teal-600" size={40}/> Inventory</h1><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Unified Clinical & Cosmetic Assets</p></div>
        <div className="flex gap-2">
            <button onClick={handleExportExcel} className="px-6 py-3 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all active:scale-95 flex items-center gap-2 hover:bg-emerald-100"><FileSpreadsheet size={18} /> Export Ledger</button>
            {canEdit && (
                <>
                    <input type="file" id="inventory-accept-backup" className="hidden" accept=".json,.xls,.xlsx,.csv" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (!window.confirm("This will merge/import product configurations from the backup file into the inventory. Proceed?")) return;
                        try {
                            if (file.name.toLowerCase().endsWith('.json')) {
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                    setLoading(true);
                                    try {
                                        const json = JSON.parse(event.target?.result as string);
                                        const dataToImport = json.data || json;
                                        await db.importBackup(dataToImport, { itemsOnly: true });
                                        alert("Backup data accepted successfully!");
                                        loadData();
                                    } catch (err: any) { alert("Format Error: " + err.message); } finally { setLoading(false); }
                                };
                                reader.readAsText(file);
                            } else {
                                alert("Please use the Admin > Restore Archive panel for loading Excel spreadsheets. JSON preferred here.");
                            }
                        } catch (e) { console.error(e); }
                    }} />
                    <label htmlFor="inventory-accept-backup" className="px-6 py-3 cursor-pointer bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all hover:bg-indigo-100 shadow-sm flex items-center gap-2"><CloudUpload size={18}/> Accept Backup Data</label>
                    <button onClick={() => setIsCsvModalOpen(true)} className="px-6 py-3 bg-blue-50 text-blue-700 border border-blue-100 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all active:scale-95 flex items-center gap-2 hover:bg-blue-100"><FileUp size={18} /> Import CSV</button>
                    <button onClick={() => setIsPasteModalOpen(true)} className="px-6 py-3 bg-amber-50 text-amber-700 border border-amber-100 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all active:scale-95 flex items-center gap-2 hover:bg-amber-100"><ClipboardPaste size={18} /> Paste Data</button>
                </>
            )}
            {canEdit && <button onClick={() => { setIsMasterEdit(false); setFormData(initialFormState); setEditingId(null); setIsModalOpen(true); }} className="px-8 py-3 bg-teal-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl transition-all active:scale-95 flex items-center gap-2"><PlusCircle size={20} /> New Intake</button>}
        </div>
      </div>

      <div className="bg-white rounded-[3rem] shadow-sm border border-slate-100 flex flex-col flex-1 overflow-hidden">
        <div className="p-6 border-b bg-slate-50/50 flex flex-col lg:flex-row gap-4 shrink-0">
          <div className="relative flex-1"><Search className="absolute left-5 top-3 text-slate-400" size={20} /><input type="text" placeholder="Search medication pool..." className="w-full pl-14 pr-6 py-3 bg-white rounded-2xl outline-none font-bold text-sm shadow-sm transition-all" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
          <div className="flex gap-3">
             <div className="flex bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-3 bg-slate-100 text-slate-400 border-r"><Filter size={16}/></div>
                <select className="px-4 py-3 bg-white text-[10px] font-black uppercase text-slate-600 outline-none" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}><option value="ALL">All Types</option><option value="MEDICINE">Medicines</option><option value="COSMETIC">Cosmetics</option></select>
             </div>
             <div className="flex bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-3 bg-slate-100 text-slate-400 border-r"><Filter size={16}/></div>
                <select className="px-4 py-3 bg-white text-[10px] font-black uppercase text-slate-600 outline-none" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as any)}><option value="ALL">All Levels</option><option value="LOW">Critical Low</option><option value="OUT">Stockout</option></select>
             </div>
             <button onClick={() => setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC')} className="p-3 border rounded-xl bg-white text-teal-600 shadow-sm">{sortOrder === 'ASC' ? <ArrowUp size={20}/> : <ArrowDown size={20}/>}</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto no-scrollbar">
            {loading ? <div className="p-20 text-center"><Loader2 className="animate-spin text-teal-600 mb-4" size={48}/><p className="text-[10px] font-black uppercase tracking-widest">Constructing Index...</p></div> : (
            <table className="w-full text-left text-sm border-separate border-spacing-0">
                <thead className="bg-white text-slate-400 font-black uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm">
                    <tr><th className="p-6 pl-12 w-10"></th><th className="p-6">Entity Identity</th><th className="p-6">Status</th><th className="p-6 text-right">Dispensary Qty</th><th className="p-6 text-right">Store Qty</th><th className="p-6 text-right">Rate</th><th className="p-6 text-center pr-12">Registry Action</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                    {paginatedGroups.map(group => {
                        const isExpanded = expandedGroups.has(group.name);
                        const isCosmetic = group.type === ProductCategory.COSMETIC;
                        return (
                        <React.Fragment key={group.name}>
                            <tr className={`hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50/50' : ''}`}>
                                <td className="p-6 pl-12"><button onClick={() => { const next = new Set(expandedGroups); if (next.has(group.name)) next.delete(group.name); else next.add(group.name); setExpandedGroups(next); }} className="text-slate-300 hover:text-teal-600">{isExpanded ? <ChevronDown size={20}/> : <ChevronRightIcon size={20}/>}</button></td>
                                <td className="p-6">
                                    <div className="font-black text-slate-800 text-base leading-tight uppercase tracking-tight">{group.name}</div>
                                    <div className="text-[10px] text-slate-400 font-bold uppercase mt-1 flex items-center gap-2">
                                        <Layers size={10}/> {!isCosmetic ? `${group.batches.length} Unified Batches • ${group.unit}` : 'Standard FMCG Packaging'}
                                    </div>
                                </td>
                                <td className="p-6">
                                    {group.status === 'FAST' && <span className="flex items-center gap-1 text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">Hot</span>}
                                    {group.totalQuantity <= group.minStockLevel && group.totalQuantity > 0 && <span className="flex items-center gap-1 text-[9px] font-black uppercase text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">Low</span>}
                                    {group.totalQuantity === 0 && <span className="flex items-center gap-1 text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-2 py-1 rounded-lg border border-rose-100">Stockout</span>}
                                </td>
                                <td className="p-6 text-right"><div className={`text-xl font-black tracking-tighter ${group.totalQuantity <= group.minStockLevel ? 'text-rose-600' : 'text-teal-700'}`}>{group.totalQuantity}</div></td>
                                <td className="p-6 text-right"><div className="text-xl font-black tracking-tighter text-indigo-700">{group.totalStoreQuantity}</div></td>
                                <td className="p-6 text-right font-black text-slate-700 font-mono tracking-tighter">{group.maxSellingPrice.toFixed(2)}</td>
                                <td className="p-6 pr-12 text-center">
                                    <div className="flex justify-center gap-2">
                                        {group.type === ProductCategory.MEDICINE && (
                                          <button onClick={() => handleOpenLabeling(group)} className="p-2 bg-white border border-slate-100 text-teal-500 hover:bg-teal-50 rounded-xl shadow-sm" title="AI Clinical Labeling"><Stethoscope size={16}/></button>
                                        )}
                                        <button onClick={() => { 
                                          if (group.batches.length > 0) {
                                            const batch = group.batches[0];
                                            setTransferTarget(batch);
                                            setTransferData({destination: '', date: new Date().toISOString().split('T')[0], reason: '', qty: batch.quantity, source: 'DISPENSARY', destStore: false});
                                            setIsDirectTransferOpen(true);
                                          } else {
                                            alert("No batches available for transfer.");
                                          }
                                        }} className="p-2 bg-white border border-slate-100 text-indigo-500 hover:bg-indigo-50 rounded-xl shadow-sm" title="Bulk Transfer"><Truck size={16}/></button>
                                        {group.totalStoreQuantity > 0 && (
                                            <button onClick={() => { setStoreTransferTarget(group); setStoreTransferQty(group.totalStoreQuantity); setIsStoreTransferOpen(true); }} className="p-2 bg-white border border-slate-100 text-teal-600 hover:bg-teal-50 rounded-xl shadow-sm" title="Transfer Store to Dispensary"><Package size={16}/></button>
                                        )}
                                        <button onClick={() => handleEditMaster(group)} className="p-2 bg-white border border-slate-100 text-blue-500 hover:bg-blue-50 rounded-xl shadow-sm"><Edit size={16}/></button>
                                        <button onClick={() => { setAdjustingGroup(group); setAdjustmentValue(group.totalQuantity); setIsAdjustModalOpen(true); }} className="p-2 bg-white border border-slate-100 text-amber-500 hover:bg-amber-50 rounded-xl shadow-sm"><Scale size={16}/></button>
                                        <button onClick={() => setViewLogsGroup(group)} className="p-2 bg-white border border-slate-100 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl shadow-sm"><History size={16}/></button>
                                        {user?.role === UserRole.ADMIN && <button onClick={() => handleDeleteGroup(group)} className="p-2 bg-white border border-slate-100 text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl shadow-sm"><Trash2 size={16}/></button>}
                                    </div>
                                </td>
                            </tr>
                            {isExpanded && group.batches.map(batch => (
                                <tr key={batch.id} className="bg-slate-50/50 animate-in slide-in-from-top-1 duration-200">
                                    <td></td>
                                    <td className="p-4 pl-12" colSpan={2}>
                                        <div className="flex items-center gap-4 border-l-2 border-teal-500/20 pl-4">
                                            {!isCosmetic && <div className="text-xs font-black text-slate-600 uppercase">Batch: {batch.batchNumber || 'N/A'}</div>}
                                            <div className="text-[9px] text-slate-400 font-bold uppercase">Exp: {batch.expiryDate}</div>
                                            {batch.branch && <div className="text-[9px] text-indigo-500 font-black uppercase px-2 py-0.5 bg-indigo-50 rounded-full border border-indigo-100">{batch.branch}</div>}
                                        </div>
                                    </td>
                                    <td className="p-4 text-right font-bold text-slate-500">{batch.quantity} u</td>
                                    <td className="p-4 text-right font-bold text-slate-400 font-mono text-xs">{batch.sellingPrice.toFixed(2)}</td>
                                    {canEdit ? <td className="p-4 pr-12 text-center">
                                      <button onClick={() => { setTransferTarget(batch); setTransferData({destination: '', date: new Date().toISOString().split('T')[0], reason: '', qty: batch.quantity, source: 'DISPENSARY', destStore: false}); setIsDirectTransferOpen(true); }} className="p-1.5 text-slate-400 hover:text-blue-500 mr-2" title="Direct Transfer"><Truck size={14}/></button>
                                      <button onClick={() => { setFormData({...batch}); setEditingId(batch.id); setIsMasterEdit(false); setIsModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-teal-600"><Edit size={14}/></button>
                                    </td> : <td className="p-4 pr-12 text-center"></td>}
                                </tr>
                            ))}
                        </React.Fragment>
                    )})}
                </tbody>
            </table>
            )}
        </div>
        
        {/* Pagination Controls */}
        {!loading && groupedProducts.length > ITEMS_PER_PAGE && (
            <div className="p-4 border-t bg-slate-50 flex items-center justify-between shrink-0">
                <div className="text-[10px] uppercase font-black tracking-widest text-slate-500">
                    Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, groupedProducts.length)} of {groupedProducts.length} Items
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                    >
                        Previous
                    </button>
                    <div className="flex items-center px-4 font-bold text-slate-700 text-sm">
                        Page {currentPage} of {totalPages}
                    </div>
                    <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                    >
                        Next
                    </button>
                </div>
            </div>
        )}
      </div>

      <ClinicalLabelingModal 
        isOpen={isLabelingOpen} 
        onClose={() => setIsLabelingOpen(false)} 
        initialDrugName={labelTarget.drugName} 
        initialStrength={labelTarget.strength} 
      />

      {/* MODAL: Edit Product (Supports Master/Bulk edit) */}
      {isModalOpen && canEdit && (
        <div className="fixed inset-0 bg-slate-950/70 z-[100] flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b bg-slate-50 flex justify-between items-center">
               <div className="flex items-center gap-4"><div className={`p-3 rounded-2xl text-white shadow-lg ${isMasterEdit ? 'bg-indigo-600' : 'bg-teal-600'}`}><Settings2 size={24}/></div><div><h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter leading-none">{isMasterEdit ? 'Bulk Medication Sync' : (editingId ? 'Modify Batch' : 'New Intake')}</h2><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">{isMasterEdit ? 'Synchronizing across all batches' : 'Establishing clinical asset baseline'}</p></div></div>
               <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-all text-slate-300 hover:text-rose-500"><X size={32}/></button>
            </div>
            <form onSubmit={handleSave} className="p-10 space-y-8 overflow-y-auto no-scrollbar max-h-[75vh]">
                <div className="flex justify-center mb-4">
                    <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner">
                        <button type="button" onClick={() => setFormData({...formData, type: ProductCategory.MEDICINE})} className={`flex items-center gap-2 px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${formData.type === ProductCategory.MEDICINE ? 'bg-white text-teal-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400'}`}><Beaker size={14}/> Medicine</button>
                        <button type="button" onClick={() => setFormData({...formData, type: ProductCategory.COSMETIC, unit: 'Each', medCategory: undefined})} className={`flex items-center gap-2 px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${formData.type === ProductCategory.COSMETIC ? 'bg-white text-pink-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400'}`}><Sparkles size={14}/> Cosmetic</button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6" ref={suggestionRef}>
                    <div className="md:col-span-2 space-y-1.5 relative">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Item Clinical Identity</label>
                        <input required autoComplete="off" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-black outline-none focus:ring-2 focus:ring-teal-500 text-lg shadow-sm" value={formData.name} onChange={handleNameChange} placeholder="Enter item name..." />
                        
                        {showSuggestions && (
                            <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-2xl mt-2 shadow-2xl z-[110] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                {nameSuggestions.map(name => (
                                    <button key={name} type="button" onClick={() => selectSuggestion(name)} className="w-full p-4 text-left hover:bg-teal-50 transition-colors border-b last:border-0 flex items-center justify-between group">
                                        <span className="font-black text-slate-700 uppercase tracking-tight">{name}</span>
                                        <ArrowRight size={14} className="text-slate-300 group-hover:text-teal-600 transition-all"/>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {!isMasterEdit && (
                        <>
                            {formData.type !== ProductCategory.COSMETIC && (
                                <div className="space-y-1.5 animate-in fade-in"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Batch Number</label><input required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold uppercase shadow-sm" value={formData.batchNumber} onChange={e => setFormData({...formData, batchNumber: e.target.value.toUpperCase()})} /></div>
                            )}
                            <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dispensary Qty</label><input required type="number" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-black shadow-sm" value={formData.quantity} onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 0})} /></div>
                            <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Store (Warehouse) Qty</label><input required type="number" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-black shadow-sm" value={formData.storeQuantity} onChange={e => setFormData({...formData, storeQuantity: parseInt(e.target.value) || 0})} /></div>
                            <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Shelf Expiry</label><input required={formData.type !== ProductCategory.COSMETIC} type="date" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold shadow-sm" value={formData.expiryDate} onChange={e => setFormData({...formData, expiryDate: e.target.value})} /></div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Supplier Source</label>
                                <select required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold shadow-sm appearance-none outline-none" value={formData.supplier} onChange={e => setFormData({...formData, supplier: e.target.value})}>
                                    <option value="">Choose Supplier...</option>
                                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                    {!suppliers.length && <option disabled>No suppliers in database</option>}
                                </select>
                            </div>
                        </>
                    )}
                    
                    {formData.type === ProductCategory.MEDICINE && (
                        <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-200">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Medicine Class</label>
                            <select className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none shadow-sm appearance-none" value={formData.medCategory} onChange={e => setFormData({...formData, medCategory: e.target.value})}>{MED_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                        </div>
                    )}
                    
                    {formData.type !== ProductCategory.COSMETIC && (
                        <div className="space-y-1.5 animate-in fade-in">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit Specification</label>
                            <select className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none shadow-sm appearance-none" value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select>
                        </div>
                    )}

                    {!isMasterEdit && (
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Acquisition Cost</label><input required type="number" step="0.01" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-mono font-black shadow-sm" value={formData.buyingPrice} onChange={e => setFormData({...formData, buyingPrice: parseFloat(e.target.value) || 0})} /></div>
                    )}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Markup % (Auto-calc Price)</label>
                      <input type="number" step="0.1" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-mono font-black shadow-sm" placeholder="e.g. 20 for 20%" onChange={e => {
                          const pct = parseFloat(e.target.value);
                          if (!isNaN(pct) && formData.buyingPrice) {
                              setFormData(prev => ({...prev, sellingPrice: Number((prev.buyingPrice! * (1 + pct / 100)).toFixed(2))}));
                          }
                      }} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unified Selling Rate</label>
                      <input required type="number" step="0.01" className="w-full p-4 bg-teal-50 border-2 border-teal-100 rounded-2xl font-mono font-black text-teal-700 shadow-inner" value={formData.sellingPrice} onChange={e => setFormData({...formData, sellingPrice: parseFloat(e.target.value) || 0})} />
                    </div>

                    <div className="space-y-1.5 relative">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1">
                        <AlertCircle size={10} className="text-amber-500" /> Minimum Safety Stock
                      </label>
                      <input 
                        required 
                        type="number" 
                        className="w-full p-4 bg-amber-50 border-2 border-amber-100 rounded-2xl font-black text-amber-700 shadow-inner outline-none focus:ring-2 focus:ring-amber-400 transition-all" 
                        value={formData.minStockLevel} 
                        onChange={e => setFormData({...formData, minStockLevel: parseInt(e.target.value) || 0})} 
                        placeholder="Reorder point..."
                      />
                      <p className="text-[8px] font-bold text-amber-600 uppercase mt-1 px-1">Alerts dashboard when total stock drops below this value</p>
                    </div>

                    {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
                      <div className="space-y-1.5 animate-in fade-in">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Branch Allocation</label>
                          <select className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none shadow-sm appearance-none" value={formData.branch || ''} onChange={e => setFormData({...formData, branch: e.target.value})}>
                              <option value="">Main Branch</option>
                              {pharmacyInfo.branches.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                      </div>
                    )}
                </div>

                <div className="pt-8 border-t flex justify-end gap-4"><button type="submit" className="px-12 py-5 bg-teal-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-teal-700 shadow-xl transition-all flex items-center gap-3 active:scale-95"><Save size={18}/> Authorize Changes</button></div>
            </form>
          </div>
        </div>
      )}

      {isDirectTransferOpen && transferTarget && canEdit && (
        <div className="fixed inset-0 bg-slate-900/80 z-[110] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b bg-blue-50 flex justify-between items-center text-blue-800"><div className="flex items-center gap-4"><Truck size={28}/><div><h2 className="text-xl font-black uppercase tracking-tighter">Direct Bulk Transfer</h2><p className="text-[9px] font-black uppercase tracking-widest mt-1">Transfer item and reduce balance</p></div></div><button onClick={() => setIsDirectTransferOpen(false)} className="text-slate-400 hover:text-rose-500"><X size={28}/></button></div>
            <form onSubmit={handleDirectTransfer} className="p-10 space-y-6">
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl text-xs font-bold text-slate-600 mb-4 border border-slate-100">
                    <div>Product: <span className="text-slate-900">{transferTarget.name}</span></div>
                    <div>Category: <span className="text-slate-900">{transferTarget.type} {transferTarget.type === ProductCategory.MEDICINE ? `/ ${transferTarget.medCategory}` : ''}</span></div>
                    <div>Supplier: <span className="text-slate-900">{transferTarget.supplier || 'N/A'}</span></div>
                    <div>Unit & Batch: <span className="text-slate-900">{transferTarget.unit} | {transferTarget.batchNumber}</span></div>
                    <div>Expiry: <span className="text-slate-900">{transferTarget.expiryDate}</span></div>
                    <div>Stock Overview: <span className="text-teal-600 font-black">Disp: {transferTarget.quantity} | Store: {transferTarget.storeQuantity || 0}</span></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1.5 animate-in slide-in-from-top-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Source Stock Location</label>
                        <select className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:border-blue-500 outline-none appearance-none" value={transferData.source} onChange={e => setTransferData({...transferData, source: e.target.value as any})}>
                            <option value="DISPENSARY">Dispensary Stock ({transferTarget.quantity})</option>
                            <option value="STORE">Store Stock ({transferTarget.storeQuantity || 0})</option>
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Transfer Qty</label>
                        <input required type="number" min="1" max={transferData.source === 'STORE' ? (transferTarget.storeQuantity || 0) : transferTarget.quantity} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-lg focus:border-blue-500 outline-none" value={transferData.qty} onChange={e => setTransferData({...transferData, qty: parseInt(e.target.value) || 0})} />
                    </div>
                </div>
                <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</label><input required type="date" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:border-blue-500 outline-none" value={transferData.date} onChange={e => setTransferData({...transferData, date: e.target.value})} /></div>
                <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Destination</label>
                    {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 ? (
                        <div className="flex flex-col gap-2">
                           <select className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:border-blue-500 outline-none appearance-none" value={transferData.destination} onChange={e => setTransferData({...transferData, destination: e.target.value})}>
                               <option value="">Select Branch...</option>
                               <option value="INTERNAL">Internal Transfer ({transferData.source === 'STORE' ? 'To Dispensary' : 'From Dispensary to Store'})</option>
                               {pharmacyInfo.branches.map(b => (
                                   <option key={b} value={b}>{b}</option>
                               ))}
                               <option value="OTHER">Other Destination (Manual Entry)</option>
                           </select>
                           {transferData.destination === 'OTHER' && (
                               <input required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:border-blue-500 outline-none" placeholder="e.g. Branch Clinic" onChange={e => setTransferData({...transferData, destination: e.target.value})} />
                           )}
                           {(pharmacyInfo.branches.includes(transferData.destination)) && (
                               <div className="flex items-center gap-3 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-100 cursor-pointer" onClick={() => setTransferData({...transferData, destStore: !transferData.destStore})}>
                                   <div className={`w-5 h-5 rounded border flex items-center justify-center ${transferData.destStore ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300'}`}>{transferData.destStore && <Package size={12}/>}</div>
                                   <span className="text-sm font-bold text-slate-700">Receive into branch "Store" (instead of Dispensary)</span>
                               </div>
                           )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                           <select className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:border-blue-500 outline-none appearance-none" value={transferData.destination} onChange={e => setTransferData({...transferData, destination: e.target.value})}>
                               <option value="">Select Destination...</option>
                               <option value="INTERNAL">Internal Transfer ({transferData.source === 'STORE' ? 'To Dispensary' : 'From Dispensary to Store'})</option>
                               <option value="OTHER">Other Destination (Manual Entry)</option>
                           </select>
                           {transferData.destination === 'OTHER' && (
                               <input required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:border-blue-500 outline-none" placeholder="e.g. Branch Clinic" onChange={e => setTransferData({...transferData, destination: e.target.value})} />
                           )}
                        </div>
                    )}
                </div>
                <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reason / Reference</label><input required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:border-blue-500 outline-none" placeholder="e.g. Inventory Rebalance" value={transferData.reason} onChange={e => setTransferData({...transferData, reason: e.target.value})} /></div>
                <button type="submit" className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase text-xs tracking-widest active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2"><Truck size={18}/> Commit Transfer</button>
            </form>
          </div>
        </div>
      )}

      {isAdjustModalOpen && adjustingGroup && canEdit && (
        <div className="fixed inset-0 bg-slate-900/80 z-[110] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-lg animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-8 border-b bg-amber-50 flex justify-between items-center text-amber-800"><div className="flex items-center gap-4"><Scale size={28}/><div><h2 className="text-xl font-black uppercase tracking-tighter">Pool Reconciliation</h2><p className="text-[9px] font-black uppercase tracking-widest mt-1">Adjusting aggregated stock quantity</p></div></div><button onClick={() => setIsAdjustModalOpen(false)} className="text-slate-400 hover:text-rose-500"><X size={28}/></button></div>
            <form onSubmit={handleGroupAdjustment} className="p-10 space-y-8">
                <div className="flex items-center justify-between gap-6">
                    <div className="flex-1 text-center p-6 bg-slate-50 rounded-3xl border border-slate-100"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Mirror</p><p className="text-4xl font-black text-slate-300 tracking-tighter italic">{adjustingGroup.totalQuantity}</p></div>
                    <ArrowRight className="text-slate-200 shrink-0" size={32}/><div className="flex-1 text-center p-6 bg-white rounded-3xl border-4 border-teal-500/20 shadow-2xl shadow-teal-500/10"><p className="text-[9px] font-black uppercase text-teal-600 mb-1">Physical</p><input required autoFocus type="number" className="w-full text-center text-4xl font-black text-teal-700 outline-none bg-transparent" value={adjustmentValue} onChange={e => setAdjustmentValue(parseInt(e.target.value) || 0)} /></div>
                </div>
                <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest active:scale-95 transition-all shadow-xl"><Save size={18}/> Commit Full Pool Sync</button>
            </form>
          </div>
        </div>
      )}

      {viewLogsGroup && (
          <div className="fixed inset-0 bg-slate-900/80 z-[110] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
                  <div className="p-8 border-b bg-indigo-50 flex justify-between items-center text-indigo-800">
                      <div className="flex items-center gap-4">
                          <History size={28}/>
                          <div>
                              <h2 className="text-xl font-black uppercase tracking-tighter">Stock Adjustment Log</h2>
                              <p className="text-[9px] font-black uppercase tracking-widest mt-1">{viewLogsGroup.name}</p>
                          </div>
                      </div>
                      <button onClick={() => setViewLogsGroup(null)} className="text-slate-400 hover:text-rose-500"><X size={28}/></button>
                  </div>
                  <div className="p-6 overflow-y-auto flex-1">
                      {stockAdjustments.filter(a => a.productName === viewLogsGroup.name).length === 0 ? (
                          <div className="text-center p-12 text-slate-400 font-bold">No manual adjustments recorded for this item.</div>
                      ) : (
                          <div className="space-y-4">
                              {stockAdjustments.filter(a => a.productName === viewLogsGroup.name).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(adj => (
                                  <div key={adj.id} className="p-4 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                                      <div>
                                          <div className="text-xs font-black text-slate-700 uppercase tracking-tight">{adj.username}</div>
                                          <div className="text-[10px] uppercase font-bold text-slate-400">{new Date(adj.date).toLocaleString()}</div>
                                      </div>
                                      <div className="flex items-center gap-3">
                                          <div className="text-right">
                                            <div className="text-[10px] text-slate-400 font-bold uppercase">Before</div>
                                            <div className="font-mono text-sm text-slate-600">{adj.previousQuantity}</div>
                                          </div>
                                          <ArrowRight size={14} className="text-slate-300"/>
                                          <div className="text-left">
                                            <div className="text-[10px] text-slate-400 font-bold uppercase">After</div>
                                            <div className="font-mono text-sm font-black text-slate-800">{adj.newQuantity}</div>
                                          </div>
                                          <div className={`ml-4 px-3 py-1 rounded-lg text-xs font-black uppercase ${adj.difference > 0 ? 'bg-teal-100 text-teal-700' : 'bg-rose-100 text-rose-700'}`}>
                                              {adj.difference > 0 ? '+' : ''}{adj.difference}
                                          </div>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* Store Transfer Modal */}
      {isStoreTransferOpen && (
        <div className="fixed inset-0 bg-slate-950/70 z-[100] flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b bg-slate-50 flex justify-between items-center">
                 <div className="flex items-center gap-4"><div className="p-3 rounded-2xl bg-teal-600 text-white shadow-lg"><Package size={24}/></div><div><h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter leading-none">Internal Transfer</h2><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">Store → Dispensary</p></div></div>
                 <button onClick={() => setIsStoreTransferOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-all text-slate-300 hover:text-rose-500"><X size={32}/></button>
            </div>
            <form onSubmit={handleStoreTransfer} className="p-10">
                <div className="bg-teal-50 text-teal-800 p-4 rounded-2xl border border-teal-100 mb-6 font-bold text-sm">
                    Move stock for <span className="font-black underline">{storeTransferTarget?.name}</span> from the warehouse store to the active dispensary.
                </div>
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex justify-between">
                            <span>Transfer Quantity</span>
                            <span className="text-teal-600">Available in Store: {storeTransferTarget?.totalStoreQuantity}</span>
                        </label>
                        <input required type="number" min="1" max={storeTransferTarget?.totalStoreQuantity} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-black shadow-sm outline-none focus:ring-2 focus:ring-teal-500 text-lg" value={storeTransferQty} onChange={e => setStoreTransferQty(parseInt(e.target.value) || 0)} />
                    </div>
                </div>
                <div className="flex justify-end gap-4 mt-8">
                    <button type="button" onClick={() => setIsStoreTransferOpen(false)} className="px-8 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
                    <button type="submit" disabled={storeTransferQty <= 0 || !storeTransferTarget || storeTransferQty > storeTransferTarget.totalStoreQuantity} className="px-8 py-4 bg-teal-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-teal-700 transition-all shadow-xl disabled:opacity-50 flex items-center gap-2"><ArrowRight size={18}/> Process</button>
                </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {isCsvModalOpen && canEdit && (
        <div className="fixed inset-0 bg-slate-950/70 z-[100] flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b bg-blue-50 flex justify-between items-center text-blue-800">
               <div className="flex items-center gap-4"><FileUp size={28}/><div><h2 className="text-xl font-black uppercase tracking-tighter">Bulk CSV Import</h2><p className="text-[9px] font-black uppercase tracking-widest mt-1">Import products dataset</p></div></div>
               <button onClick={() => { setIsCsvModalOpen(false); setCsvFile(null); }} className="text-slate-400 hover:text-rose-500"><X size={28}/></button>
            </div>
            <form onSubmit={handleCsvImport} className="p-10 space-y-8 text-center text-slate-600">
                <div className="border-2 border-dashed border-blue-200 bg-blue-50/50 p-10 rounded-3xl hover:bg-blue-50 transition-colors flex flex-col items-center gap-4 cursor-pointer relative">
                    <input 
                        type="file" 
                        accept=".csv" 
                        required
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        onChange={e => setCsvFile(e.target.files?.[0] || null)}
                    />
                    <CloudUpload size={48} className={csvFile ? "text-blue-600" : "text-blue-300"} />
                    <div>
                        <p className="font-bold">{csvFile ? csvFile.name : `Select CSV file or drag here`}</p>
                        <p className="text-xs text-slate-500 mt-2">Required Columns: Name, Quantity, Selling Price</p>
                    </div>
                </div>
                <div className="flex justify-end gap-4 mt-6">
                    <button type="button" onClick={() => { setIsCsvModalOpen(false); setCsvFile(null); }} className="px-8 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
                    <button type="submit" disabled={!csvFile || csvParsing} className="px-8 py-4 bg-blue-600 focus:bg-blue-700 focus:outline-none text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50 shadow-xl flex items-center gap-2">
                        {csvParsing ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Import Products
                    </button>
                </div>
            </form>
          </div>
        </div>
      )}
      {/* Paste Import Modal */}
      {isPasteModalOpen && canEdit && (
        <div className="fixed inset-0 bg-slate-950/70 z-[100] flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b bg-amber-50 flex justify-between items-center text-amber-800">
               <div className="flex items-center gap-4"><ClipboardPaste size={28}/><div><h2 className="text-xl font-black uppercase tracking-tighter">Paste Raw Data</h2><p className="text-[9px] font-black uppercase tracking-widest mt-1">Paste CSV/TSV data directly</p></div></div>
               <button onClick={() => { setIsPasteModalOpen(false); setPastedData(''); }} className="text-slate-400 hover:text-rose-500"><X size={28}/></button>
            </div>
            <form onSubmit={handlePasteImport} className="p-10 space-y-6 text-slate-600">
                <div className="bg-amber-50/50 p-6 rounded-3xl border border-amber-100 flex flex-col items-stretch gap-4">
                    <p className="text-xs font-bold text-amber-700">Paste your Excel or Sheets data below. Ensure it contains headers like <span className="font-black font-mono">Name</span>, <span className="font-black font-mono">Quantity</span>, and <span className="font-black font-mono">Selling Price</span>.</p>
                    <textarea 
                        className="w-full h-64 p-4 font-mono text-xs border border-slate-200 rounded-xl bg-white resize-none outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-50 whitespace-pre"
                        placeholder={`Name\tQuantity\tSelling Price\nAspirin\t100\t5.00`}
                        value={pastedData}
                        onChange={e => setPastedData(e.target.value)}
                        required
                    />
                </div>
                <div className="flex justify-end gap-4 mt-6">
                    <button type="button" onClick={() => { setIsPasteModalOpen(false); setPastedData(''); }} className="px-8 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
                    <button type="submit" disabled={!pastedData || csvParsing} className="px-8 py-4 bg-amber-600 focus:bg-amber-700 focus:outline-none text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-amber-700 transition-all disabled:opacity-50 shadow-xl flex items-center gap-2">
                        {csvParsing ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Import Pasted Data
                    </button>
                </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
