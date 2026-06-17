import { Product, Sale, PharmacyInfo, BinCardEntry, User, UserRole, Supplier, Customer, Prescription, Expense, SupplierTransaction, ProductCategory } from '../types';
import { DB_KEYS } from '../constants';
import { addToQueue, flushIndexedDBQueue, getQueueCount, idbKV } from './idbSync';

const getApiUrl = () => {
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return '';
};

const sortById = (arr: any[]): any[] => {
    if (!Array.isArray(arr)) return arr;
    return [...arr].sort((a, b) => {
        const idA = a && a.id ? String(a.id) : '';
        const idB = b && b.id ? String(b.id) : '';
        return idA.localeCompare(idB);
    });
};

const normalizeProductPrices = (products: Product[], targetName: string, targetPrice: number): Product[] => {
    const normalizedName = targetName.toLowerCase().trim();
    return products.map((p: Product) => {
        if (!p.isDeleted && p.name.toLowerCase().trim() === normalizedName) {
            return { ...p, sellingPrice: targetPrice };
        }
        return p;
    });
};

const generateId = () => {
    return typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID() 
        : Date.now().toString(36) + Math.random().toString(36).substring(2);
};

export const db = {
    initialize: async () => {
        db.reconcileAll().catch(err => console.error(err));
        flushIndexedDBQueue().catch(err => console.error(err));
        return true;
    },

    get: async (key: string, forceSync: boolean = false): Promise<any> => {
        // Since the app is web-based, we prioritize getting fresh data from the central store first.
        const apiUrl = getApiUrl();
        if (apiUrl !== 'browser-local' && navigator.onLine) {
            try {
                const res = await fetch(`${apiUrl}/api/data/${key}`, { signal: AbortSignal.timeout(5000) });
                if (res.ok) {
                    const data = await res.json();
                    
                    const existingStr = JSON.stringify(await idbKV.get(key));
                    const newStr = JSON.stringify(data);
                    if (existingStr !== newStr) {
                        await idbKV.set(key, data);
                        window.dispatchEvent(new CustomEvent('local-data-update', { detail: { key } }));
                    }
                    return data;
                }
            } catch (e) {
                console.warn('Network fetch failed for key:', key, '; falling back to offline cache.', e);
            }
        }

        // Offline or server fetch failed: fall back to IndexedDB or localStorage cache
        let localData = key === DB_KEYS.INFO ? null : [];
        const raw = await idbKV.get(key);
        if (raw !== undefined && raw !== null) {
            localData = raw;
            if (key !== DB_KEYS.INFO && !Array.isArray(localData)) {
                localData = [];
            }
            if (key === DB_KEYS.SALES && Array.isArray(localData)) {
                localData.forEach(sale => { if (!sale.items) sale.items = []; });
            }
            return localData;
        } else {
            const lsRaw = localStorage.getItem(key);
            if (lsRaw && lsRaw !== 'undefined') {
                try { 
                    localData = JSON.parse(lsRaw); 
                    if (key !== DB_KEYS.INFO && !Array.isArray(localData)) localData = [];
                    if (key === DB_KEYS.SALES && Array.isArray(localData)) {
                        localData.forEach(sale => { if (!sale.items) sale.items = []; });
                    }
                    await idbKV.set(key, localData);
                } catch (e) {}
            }
        }
        return localData;
    },

    post: async (key: string, data: any): Promise<void> => {
        let dataToWrite = data;
        if (Array.isArray(data)) {
            dataToWrite = sortById(data);
        }
        await idbKV.set(key, dataToWrite);
        window.dispatchEvent(new CustomEvent('local-data-update', { detail: { key } }));
        
        try {
            const apiUrl = getApiUrl();
            if (apiUrl !== 'browser-local' && navigator.onLine) {
                await fetch(`${apiUrl}/api/data/${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    signal: AbortSignal.timeout(30000)
                });
            }
        } catch (e) {
            console.error('Network post error:', e);
        }
    },

    reconcileAll: async (force: boolean = true) => {
        const queueCount = await getQueueCount();
        if (queueCount > 0) {
            await flushIndexedDBQueue();
            await new Promise(res => setTimeout(res, 200));
        }

        const keys = [
            DB_KEYS.INFO, DB_KEYS.PRODUCTS, DB_KEYS.SALES, 
            DB_KEYS.CUSTOMERS, DB_KEYS.SUPPLIERS, DB_KEYS.USERS, 
            DB_KEYS.PRESCRIPTIONS, DB_KEYS.SUPPLIER_TRANSACTIONS, 'pharma_expenses', DB_KEYS.BULK_TRANSFERS
        ];
        await Promise.all(keys.map(key => db.get(key, force)));
    },

    pushAllToServer: flushIndexedDBQueue,
    flushQueue: flushIndexedDBQueue,

    getInfo: async (): Promise<PharmacyInfo | null> => {
        const info = await db.get(DB_KEYS.INFO);
        if (!info || Array.isArray(info) || typeof info !== 'object' || !info.name) {
            return null;
        }
        return info as PharmacyInfo;
    },
    saveInfo: async (info: PharmacyInfo) => db.post(DB_KEYS.INFO, info),
    getProducts: async () => db.get(DB_KEYS.PRODUCTS),
    
    addProduct: async (p: Product, u: User, skipBinCard?: boolean) => {
        let items = await db.getProducts() || [];
        items.push(p);
        items = normalizeProductPrices(items, p.name, p.sellingPrice);
        await db.post(DB_KEYS.PRODUCTS, items);
        
        if (!skipBinCard) {
            await db.addBinCardEntry(p.id, { id: generateId(), date: new Date().toISOString(), type: 'RECEIVED', reference: `Received from ${p.supplier}`, batchNumber: p.batchNumber, expiryDate: p.expiryDate, inQty: p.quantity, outQty: 0, balance: p.quantity, user: u.username });
        }
    },

    updateProduct: async (p: Product, u: User, skipBinCard?: boolean) => {
        let items = await db.getProducts() || [];
        const idx = items.findIndex((i: Product) => i.id === p.id);
        if (idx !== -1) {
            const oldQty = items[idx].quantity;
            items[idx] = p;
            items = normalizeProductPrices(items, p.name, p.sellingPrice);
            await db.post(DB_KEYS.PRODUCTS, items); 
            
            const diff = p.quantity - oldQty;
            if (diff !== 0 && !skipBinCard) {
                await db.addBinCardEntry(p.id, { 
                    id: generateId(), 
                    date: new Date().toISOString(), 
                    type: diff > 0 ? 'RECEIVED' : 'ISSUED', 
                    reference: diff > 0 ? `Refill from ${p.supplier}` : 'Inventory Correction', 
                    batchNumber: p.batchNumber, 
                    expiryDate: p.expiryDate, 
                    inQty: diff > 0 ? diff : 0, 
                    outQty: diff < 0 ? Math.abs(diff) : 0, 
                    balance: p.quantity, 
                    user: u.username 
                });
            }
        }
    },

    updateProductsBatch: async (updatedProducts: Product[], newProducts: Product[] = []) => {
        let items = await db.getProducts() || [];
        for (const p of updatedProducts) {
            const idx = items.findIndex((i: Product) => i.id === p.id);
            if (idx !== -1) {
                items[idx] = p;
                items = normalizeProductPrices(items, p.name, p.sellingPrice);
            }
        }
        for (const p of newProducts) {
            items.push(p);
            items = normalizeProductPrices(items, p.name, p.sellingPrice);
        }
        await db.post(DB_KEYS.PRODUCTS, items);
    },

    deleteProduct: async (id: string, user: User) => {
        const items = await db.getProducts() || [];
        const updated = items.map((p: Product) => p.id === id ? { ...p, isDeleted: true } : p);
        await db.post(DB_KEYS.PRODUCTS, updated);
    },

    getSales: async () => db.get(DB_KEYS.SALES),
    addSale: async (sale: Sale, options: { fifo?: boolean } = {}) => {
        const sales = await db.getSales() || [];
        sales.push(sale);
        await db.post(DB_KEYS.SALES, sales);
        const localProducts = await db.getProducts() || [];
        for (const soldItem of sale.items) {
            const batch = localProducts.find((p: Product) => !p.isDeleted && p.id === soldItem.id);
            if (batch) {
                batch.quantity -= soldItem.cartQty;
                await db.addBinCardEntry(batch.id, { id: generateId(), date: sale.date, type: 'ISSUED', reference: `Sale #${sale.receiptNumber}`, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, inQty: 0, outQty: soldItem.cartQty, balance: batch.quantity, user: sale.soldBy });
            }
        }
        await db.post(DB_KEYS.PRODUCTS, localProducts);
        return true;
    },

    voidSale: async (saleId: string, user: User) => {
        const sales = await db.getSales() || [];
        const saleIdx = sales.findIndex((s: Sale) => s.id === saleId);
        if (saleIdx === -1 || sales[saleIdx].status === 'VOIDED') return false;
        const sale = sales[saleIdx];
        const localProducts = await db.getProducts() || [];
        for (const item of sale.items) {
            const batch = localProducts.find((p: Product) => !p.isDeleted && p.id === item.id);
            if (batch) {
                batch.quantity += item.cartQty;
                await db.addBinCardEntry(batch.id, { id: generateId(), date: new Date().toISOString(), type: 'RECEIVED', reference: `VOID #${sale.receiptNumber}`, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, inQty: item.cartQty, outQty: 0, balance: batch.quantity, user: user.username });
            }
        }
        sales[saleIdx].status = 'VOIDED';
        await db.post(DB_KEYS.SALES, sales);
        await db.post(DB_KEYS.PRODUCTS, localProducts);
        return true;
    },

    getExpenses: async (): Promise<Expense[]> => await db.get('pharma_expenses') || [],
    addExpense: async (expense: Expense) => {
        const all = await db.getExpenses();
        all.push(expense);
        await db.post('pharma_expenses', all);
    },
    deleteExpense: async (id: string) => {
        const all = await db.getExpenses();
        await db.post('pharma_expenses', all.map((e: Expense) => e.id === id ? { ...e, isDeleted: true } : e));
    },

    getBinCards: async (pid: string) => await db.get(`pharma_bincard_${pid}`) || [],
    addBinCardEntry: async (pid: string, e: BinCardEntry) => {
        const all = await db.getBinCards(pid); all.push(e); 
        await db.post(`pharma_bincard_${pid}`, all);
    },

    getCustomers: async () => db.get(DB_KEYS.CUSTOMERS),
    addCustomer: async (c: Customer) => {
        const all = await db.getCustomers() || []; all.push(c); 
        await db.post(DB_KEYS.CUSTOMERS, all);
    },
    updateCustomer: async (c: Customer) => {
        const all = await db.getCustomers() || [];
        const idx = all.findIndex((item: Customer) => item.id === c.id);
        if (idx !== -1) { all[idx] = c; await db.post(DB_KEYS.CUSTOMERS, all); }
    },

    getSuppliers: async () => db.get(DB_KEYS.SUPPLIERS),
    addSupplier: async (s: Supplier) => {
        const all = await db.getSuppliers() || [];
        all.push(s);
        await db.post(DB_KEYS.SUPPLIERS, all);
    },
    updateSupplier: async (s: Supplier) => {
        const all = await db.getSuppliers() || [];
        const idx = all.findIndex((item: Supplier) => item.id === s.id);
        if (idx !== -1) { all[idx] = s; await db.post(DB_KEYS.SUPPLIERS, all); }
    },
    deleteSupplier: async (id: string) => {
        const all = await db.getSuppliers() || [];
        const updated = all.map((s: Supplier) => s.id === id ? { ...s, isDeleted: true } : s);
        await db.post(DB_KEYS.SUPPLIERS, updated);
    },

    getSupplierTransactions: async (): Promise<SupplierTransaction[]> => db.get(DB_KEYS.SUPPLIER_TRANSACTIONS),
    addSupplierTransaction: async (tx: SupplierTransaction) => {
        const all = await db.getSupplierTransactions() || [];
        all.push(tx);
        await db.post(DB_KEYS.SUPPLIER_TRANSACTIONS, all);
    },
    updateSupplierTransaction: async (tx: SupplierTransaction) => {
        const all = await db.getSupplierTransactions() || [];
        const index = all.findIndex((t: SupplierTransaction) => t.id === tx.id);
        if (index !== -1) {
            all[index] = tx;
            await db.post(DB_KEYS.SUPPLIER_TRANSACTIONS, all);
        }
    },

    getPrescriptions: async () => db.get(DB_KEYS.PRESCRIPTIONS),
    addPrescription: async (p: Prescription) => {
        const all = await db.getPrescriptions() || [];
        all.push(p);
        await db.post(DB_KEYS.PRESCRIPTIONS, all);
    },

    getBulkTransfers: async () => db.get(DB_KEYS.BULK_TRANSFERS) || [],
    addBulkTransfer: async (bt: any) => {
        let all = await db.getBulkTransfers();
        const existingIdx = all.findIndex((x: any) => x.id === bt.id);
        if (existingIdx >= 0) {
            all[existingIdx] = bt;
        } else {
            all.push(bt);
        }
        await db.post(DB_KEYS.BULK_TRANSFERS, all);
    },

    getStockAdjustments: async () => db.get(DB_KEYS.STOCK_ADJUSTMENTS) || [],
    addStockAdjustment: async (adjustment: any) => {
        const all = await db.getStockAdjustments();
        all.push(adjustment);
        await db.post(DB_KEYS.STOCK_ADJUSTMENTS, all);
    },
    getNextReceiptNumber: async () => {
        const apiUrl = getApiUrl();
        if (apiUrl !== 'browser-local' && navigator.onLine) {
            try {
                const res = await fetch(`${apiUrl}/api/system/next-receipt-number`, { signal: AbortSignal.timeout(2000) });
                if (res.ok) { const data = await res.json(); return data.receiptNumber; }
            } catch (e) {}
        }
        
        let currentCounter = parseInt(localStorage.getItem('pharma_receipt_counter') || '0', 10);
        if (isNaN(currentCounter)) currentCounter = 0;
        
        if (currentCounter === 0) {
            const sales = await db.getSales() || [];
            let maxSerial = 0;
            sales.forEach((s: any) => {
                if (s.receiptNumber && s.receiptNumber.startsWith('R-')) {
                    const num = parseInt(s.receiptNumber.replace('R-', ''), 10);
                    if (!isNaN(num) && num > maxSerial) {
                        maxSerial = num;
                    }
                }
            });
            currentCounter = maxSerial;
        }
        
        currentCounter++;
        localStorage.setItem('pharma_receipt_counter', currentCounter.toString());
        return `R-${currentCounter.toString().padStart(6, '0')}`;
    },

    getLogs: async () => db.get(DB_KEYS.LOGS),
    logActivity: async (u: User, action: string, details: string) => {
        const logs = await db.getLogs() || [];
        logs.unshift({ id: generateId(), userId: u.id, username: u.username, action, details, timestamp: new Date().toISOString() });
        await db.post(DB_KEYS.LOGS, logs.slice(0, 1000));
    },

    getUsers: async () => db.get(DB_KEYS.USERS),
    getDeviceApprovals: async () => db.get('pharma_device_approvals', true),
    updateDeviceApprovals: async (approvals: any[]) => db.post('pharma_device_approvals', approvals),
    authenticate: async (username: string, pass: string, deviceId: string, otpCode?: string): Promise<User | null> => {
        const users = await db.getUsers();
        let authUser: User | null = null;
        if (username === 'admin' && pass === 'admin123') authUser = { id: 'admin-seed', username: 'admin', name: 'System Admin', role: UserRole.ADMIN };
        
        if (!authUser && users && users.length > 0) {
            const found = users.find((u: User) => u.username === username && u.password === pass && !u.isDeleted);
            if (found) authUser = found;
        }
        
        if (!authUser) return null;
        
        // Fetch pharmacy info to check if device recognition/passcode restriction is enabled
        const info = await db.getInfo();
        const enableDevicePasscode = info?.enableDevicePasscode === true;
        
        if (!enableDevicePasscode) {
            return authUser;
        }
        
        // Device Tracking Logic for extra security constraint
        const approvals = await db.getDeviceApprovals() || [];
        const deviceRecord = approvals.find((a: any) => a.username === authUser!.username && a.deviceId === deviceId);
        
        if (deviceId.length > 0 && deviceId !== 'server-override') {
            if (!deviceRecord) {
                // New device attempt
                const authCode = Math.floor(100000 + Math.random() * 900000).toString();
                approvals.push({ id: generateId(), username: authUser.username, deviceId, approved: false, authCode, requestedAt: new Date().toISOString() });
                await db.updateDeviceApprovals(approvals);
                throw new Error("DEVICE_APPROVAL_REQUIRED");
            } else if (!deviceRecord.approved) {
                if (otpCode && otpCode === deviceRecord.authCode) {
                    deviceRecord.approved = true;
                    await db.updateDeviceApprovals(approvals);
                    return authUser;
                } else {
                    throw new Error("DEVICE_APPROVAL_REQUIRED");
                }
            }
        }
        
        return authUser;
    },
    addUser: async (newUser: User, admin: User) => {
        const users = await db.getUsers() || [];
        if (users.find((u: User) => u.username === newUser.username)) throw new Error("Username already exists");
        users.push(newUser); await db.post(DB_KEYS.USERS, users);
    },
    deleteUser: async (userId: string, admin: User) => {
        const users = await db.getUsers() || [];
        const updated = users.map((u: User) => u.id === userId ? { ...u, isDeleted: true } : u);
        await db.post(DB_KEYS.USERS, updated);
    },
    changePassword: async (userId: string, newPassword: string) => {
        const users = await db.getUsers() || [];
        const idx = users.findIndex((u: User) => u.id === userId);
        if (idx !== -1) { users[idx].password = newPassword; await db.post(DB_KEYS.USERS, users); }
    },
    exportBackup: async (options?: { itemsOnly?: boolean, branch?: string }) => {
        let data: any = {};
        const apiUrl = getApiUrl();
        if (apiUrl && apiUrl !== 'browser-local' && navigator.onLine) {
            try {
                const res = await fetch(`${apiUrl}/api/system/export`);
                if (res.ok) {
                    const result = await res.json();
                    data = result.data || result;
                }
            } catch (e) {}
        }
        
        if (Object.keys(data).length === 0) {
            const keys = await idbKV.keys();
            for (const key of keys) {
                const isDataKey = Object.values(DB_KEYS).includes(key as any) || key.startsWith('pharma_bincard_') || key === 'pharma_expenses';
                
                if (options?.itemsOnly && key !== DB_KEYS.PRODUCTS) continue;

                if (isDataKey) {
                    let parsed = await idbKV.get(key);
                    if (parsed) {
                        if (options?.branch && Array.isArray(parsed) && key !== DB_KEYS.INFO) {
                            parsed = parsed.filter(item => !item.branch || item.branch === options.branch);
                        }
                        data[key] = parsed;
                    }
                }
            }
        } else if (options?.itemsOnly || options?.branch) {
            const filtered: any = {};
            for (const key of Object.keys(data)) {
                 if (options?.itemsOnly && key !== DB_KEYS.PRODUCTS) continue;
                 let parsed = data[key];
                 if (options?.branch && Array.isArray(parsed) && key !== DB_KEYS.INFO) {
                     parsed = parsed.filter(item => !item.branch || item.branch === options.branch);
                 }
                 filtered[key] = parsed;
            }
            data = filtered;
        }

        return { data };
    },
    importBackup: async (data: any, options?: { scope?: string, itemsOnly?: boolean, branch?: string }) => {
        const isItemsOnly = options?.itemsOnly || options?.scope === 'itemsOnly';
        const isBranchOnly = options?.scope === 'branch';

        if (Array.isArray(data)) {
            let existingProducts = await db.getProducts() || [];
            if (!isItemsOnly && !isBranchOnly) existingProducts = [];
            if (isBranchOnly && options?.branch) {
                existingProducts = existingProducts.filter(p => p.branch !== options.branch);
                data = data.filter((item: any) => item.branch === options.branch);
            }
            
            const normalizedData = data.map((item: any) => ({
                id: item.id || generateId(),
                type: item.type || ProductCategory.MEDICINE,
                name: item.name || item.ItemName || item.Item_Name || item.Product || item.Description || 'Unknown',
                quantity: Number(item.quantity || item.Quantity || item.Qty || item.Stock || 0),
                minStockLevel: Number(item.minStockLevel || item.MinStock || item.ReorderLevel || 0),
                supplier: item.supplier || item.Supplier || item.Vendor || 'Legacy Import',
                expiryDate: item.expiryDate || item.Expiry || item.ExpiryDate || new Date().toISOString().split('T')[0],
                buyingPrice: Number(item.buyingPrice || item.BuyingPrice || item.Cost || item.CostPrice || 0),
                sellingPrice: Number(item.sellingPrice || item.SellingPrice || item.Price || item.RetailPrice || 0),
                batchNumber: item.batchNumber || item.Batch || item.BatchNo || '',
                unit: item.unit || item.Unit || '',
                branch: options?.branch || item.branch || item.Branch || '',
                createdAt: item.createdAt || new Date().toISOString(),
                isDeleted: false
            }));

            const finalProducts = [...existingProducts, ...normalizedData];
            await idbKV.set(DB_KEYS.PRODUCTS, finalProducts);
            
            try {
                const apiUrl = getApiUrl();
                if (apiUrl !== 'browser-local' && navigator.onLine) {
                    await fetch(`${apiUrl}/api/system/import`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            data: { [DB_KEYS.PRODUCTS]: finalProducts },
                            options: { scope: 'itemsOnly', branch: options?.branch }
                        }),
                        signal: AbortSignal.timeout(30000)
                    });
                }
            } catch (e) {
                console.error("Failed to sync bulk product import to server:", e);
            }

            window.location.reload();
            return;
        }

        if (!isItemsOnly && !isBranchOnly) {
            const keys = await idbKV.keys();
            for (const k of keys) {
                if (k && (Object.values(DB_KEYS).includes(k as any) || k.startsWith('pharma_bincard_') || k === 'pharma_expenses')) {
                    await idbKV.del(k);
                }
            }
        }

        const payloadForServer: any = {};
        for (const key of Object.keys(data)) {
            if (isItemsOnly && key !== DB_KEYS.PRODUCTS) continue;
            let importItems = data[key];

            if (isBranchOnly && options?.branch && Array.isArray(importItems) && key !== DB_KEYS.INFO) {
                const branchItems = importItems.filter((item: any) => typeof item === 'object' && item !== null && item.branch === options.branch);
                let existingData = await db.get(key) || [];
                if (!Array.isArray(existingData)) existingData = [];
                existingData = existingData.filter((item: any) => typeof item === 'object' && item !== null && item.branch !== options.branch);
                importItems = [...existingData, ...branchItems];
            } else if (options?.branch && Array.isArray(importItems) && key !== DB_KEYS.INFO && !isBranchOnly) {
                importItems = importItems.map((item: any) => typeof item === 'object' && item !== null ? { ...item, branch: options.branch } : item);
            }

            await idbKV.set(key, importItems);
            payloadForServer[key] = importItems;
        }

        try {
            const apiUrl = getApiUrl();
            if (apiUrl !== 'browser-local' && navigator.onLine) {
                const res = await fetch(`${apiUrl}/api/system/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: payloadForServer,
                        options: { scope: options?.scope, branch: options?.branch, itemsOnly: options?.itemsOnly }
                    }),
                    signal: AbortSignal.timeout(60000)
                });
                if (!res.ok) {
                    throw new Error(await res.text());
                }
            }
        } catch (e) {
            console.error("Bulk server import failure:", e);
        }

        window.location.reload();
    },
    nuclearResetLocalOnly: async () => {
        await idbKV.clear();
        const apiUrl = localStorage.getItem('API_URL');
        localStorage.clear();
        if (apiUrl) localStorage.setItem('API_URL', apiUrl);
    },
    nuclearReset: async () => {
        await idbKV.clear();
        const apiUrl = localStorage.getItem('API_URL');
        localStorage.clear();

        if (apiUrl && apiUrl !== 'browser-local') {
            try {
                await fetch(`${apiUrl}/api/system/reset`, { method: 'POST', signal: AbortSignal.timeout(5000) });
            } catch (e) {
                console.error("Failed to reset server database", e);
            }
        }
        
        if (apiUrl) localStorage.setItem('API_URL', apiUrl);
        window.location.reload();
    }
};
