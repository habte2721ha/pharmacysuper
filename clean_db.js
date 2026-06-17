import * as fs from 'fs';

let content = fs.readFileSync('src/services/db.ts', 'utf8');

// 1. Remove firebase imports
content = content.replace(/import \{ collection, doc, setDoc, getDocs, deleteDoc, getDoc, onSnapshot \} from 'firebase\/firestore';\n/, '');
content = content.replace(/import \{ db as firestoreDb \} from '\.\.\/firebase';\n/, '');

// 2. Simplify getApiUrl
content = content.replace(/const getApiUrl = \(\) => \{\n    const ls = localStorage.getItem\('API_URL'\);\n    if \(ls === 'pocketbase'\) return 'pocketbase';\n    return firestoreDb \? 'firebase' : \(ls \|\| ''\);\n\};/g, 
`const getApiUrl = () => {
    const ls = localStorage.getItem('API_URL');
    if (ls === 'pocketbase') return 'pocketbase';
    return ls || '';
};`);

// 3. In initialize, remove firestoreDb checks
content = content.replace(/        \} else if \(typeof firestoreDb !== 'undefined' \&\& firestoreDb\) \{\n            db\.setupRealtimeListeners\(\);\n            \/\/ Fire off local DB reconciliation check in the background to ensure absolute consistency\n            db\.reconcileAll\(\)\.catch\(err => \{ if \(!checkQuotaError\(err\)\) console\.error\(err\); \}\);\n        \} else \{/g,
`} else {`);
content = content.replace(/        \} else if \(firestoreDb\) \{[\s\S]*?        \} else \{/g, `        } else {`);

// 4. In setupRealtimeListeners, remove firestoreDb stuff.
const realtimeStart = content.indexOf(`        if (!firestoreDb) return;`);
const realtimeEnd = content.indexOf(`    get: async `);
if (realtimeStart !== -1 && realtimeEnd !== -1) {
    content = content.slice(0, realtimeStart) + "        return;\n    },\n\n    " + content.slice(realtimeEnd + 11);
}

// 5. Re-read and find get
content = content.replace(/            if \(firestoreDb\) \{[\s\S]*?            \/\/ Fallback to Express backend/g, `            // Fallback to Express backend`);

// 6. In revalidateKey
content = content.replace(/        if \(!navigator\.onLine \|\| !firestoreDb\) return;\n        if \(localStorage\.getItem\('FIRESTORE_QUOTA_EXCEEDED'\) === 'true'\) return;[\s\S]*?        \} catch \(e\) \{[\s\S]*?        \}/g, `        if (!navigator.onLine) return;`);

// 7. In post
content = content.replace(/            if \(firestoreDb \|\| apiUrl === 'pocketbase'\) \{[\s\S]*?                \/\/ Fallback to Express backend/g, `            if (apiUrl === 'pocketbase') {
                if (Array.isArray(data)) {
                    const oldDataArray = Array.isArray(oldData) ? oldData : [];
                    const oldMap = new Map(oldDataArray.map(item => [item.id, item]));
                    
                    const queueAdditions: any[] = [];
                    for (const item of data) {
                        if (!item.id) continue;
                        const oldItem = oldMap.get(item.id);
                        if (!oldItem || JSON.stringify(oldItem) !== JSON.stringify(item)) {
                            queueAdditions.push({ type: 'set', collection: key, docId: String(item.id), data: item });
                        }
                        oldMap.delete(item.id);
                    }
                    
                    for (const deletedId of Array.from(oldMap.keys())) {
                        queueAdditions.push({ type: 'delete', collection: key, docId: String(deletedId) });
                    }

                    if (queueAdditions.length > 0) {
                        for (let i = 0; i < queueAdditions.length; i += 50) {
                            const chunk = queueAdditions.slice(i, i + 50);
                            await Promise.all(chunk.map(op => addToQueue(op)));
                        }
                    }
                } else {
                    await addToQueue({ type: 'set', collection: key, docId: key, data: { value: data } });
                }
                
                flushIndexedDBQueue().catch(console.error);
                return;
            }

            // Fallback to Express backend`);

// 8. In nuclearReset
content = content.replace(/        \/\/ Clear all collections on the Firestore server[\s\S]*?            \} catch \(e\) \{\}\n        \}/g, ``);

fs.writeFileSync('src/services/db.ts', content);
