import { openDB, DBSchema, IDBPDatabase } from 'idb';

export function checkQuotaError(err: any): boolean {
    return false;
}

interface SyncDB extends DBSchema {
    'sync-queue': {
        key: number;
        value: {
            id?: number;
            type: 'set' | 'delete';
            collection: string;
            docId: string;
            data?: any;
            timestamp: number;
        };
    };
    'kv-store': {
        key: string;
        value: any;
    };
}

const DB_NAME = 'pharma-offline-queue';
const STORE_NAME = 'sync-queue';
const KV_STORE_NAME = 'kv-store';

let dbPromise: Promise<IDBPDatabase<SyncDB>> | null = null;

export const initQueueDB = () => {
    if (!dbPromise) {
        dbPromise = openDB<SyncDB>(DB_NAME, 2, {
            upgrade(db, oldVersion) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(KV_STORE_NAME)) {
                    db.createObjectStore(KV_STORE_NAME);
                }
            }
        });
    }
    return dbPromise;
};

export const idbKV = {
    async get(key: string) {
        const db = await initQueueDB();
        return db.get(KV_STORE_NAME, key);
    },
    async set(key: string, val: any) {
        const db = await initQueueDB();
        return db.put(KV_STORE_NAME, val, key);
    },
    async del(key: string) {
        const db = await initQueueDB();
        return db.delete(KV_STORE_NAME, key);
    },
    async clear() {
        const db = await initQueueDB();
        const tx = db.transaction([KV_STORE_NAME, STORE_NAME], 'readwrite');
        await tx.objectStore(KV_STORE_NAME).clear();
        await tx.objectStore(STORE_NAME).clear();
        await tx.done;
    },
    async keys() {
        const db = await initQueueDB();
        return db.getAllKeys(KV_STORE_NAME);
    }
};

export const addToQueue = async (operation: Omit<SyncDB['sync-queue']['value'], 'id' | 'timestamp'>) => {
    try {
        const db = await initQueueDB();
        await db.add(STORE_NAME, { ...operation, timestamp: Date.now() });
        flushIndexedDBQueue().catch(err => { if (!checkQuotaError(err)) console.error(err); });
    } catch (e) {
        console.error('Failed to add to IndexedDB queue:', e);
    }
};

export const getQueueCount = async (): Promise<number> => {
    try {
        const db = await initQueueDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const count = await store.count();
        return count;
    } catch {
        return 0;
    }
};

export const getPendingDocIds = async (collection: string): Promise<Set<string>> => {
    try {
        const db = await initQueueDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const items = await store.getAll();
        const pending = new Set<string>();
        for (const item of items) {
            if (item.collection === collection && item.docId) {
                pending.add(String(item.docId));
            }
        }
        return pending;
    } catch {
        return new Set<string>();
    }
};

let isFlushing = false;

export const flushIndexedDBQueue = async () => {
    if (!navigator.onLine || isFlushing) return;
    isFlushing = true;

    try {
        const apiUrl = localStorage.getItem('API_URL');

        // Without PB, we just flush the queue. Note: if you have another cloud fallback, insert it here.
        const db = await initQueueDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        await tx.objectStore(STORE_NAME).clear();
        isFlushing = false;
        return;
    } catch (err) {
        console.error('Error during database queue flush:', err);
    } finally {
        isFlushing = false;
    }
};

window.addEventListener('online', flushIndexedDBQueue);
