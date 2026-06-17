const fs = require('fs');
let code = fs.readFileSync('src/services/db.ts', 'utf8');

// remove pocketbase from getApiUrl
code = code.replace(/    if \(ls === 'pocketbase'\) return 'pocketbase';\n/g, "");

// remove pocketbase from initialize
code = code.replace(/        if \(apiUrl === 'pocketbase'\) \{[\s\S]*?\} else if/g, "        if");

// remove pocketbase from setupRealtimeListeners
code = code.replace(/        if \(apiUrl === 'pocketbase'\) \{[\s\S]*?            return;\n        \}\n/g, "");

// remove pocketbase from get string check
code = code.replace(/        if \(\(firestoreDb \|\| getApiUrl\(\) === 'pocketbase'\) \&\& queueCount > 0\) \{/g, "        if ((firestoreDb) && queueCount > 0) {");

// remove pocketbase block from get
code = code.replace(/            if \(apiUrl === 'pocketbase'\) \{[\s\S]*?            if \(firestoreDb\) \{/g, "            if (firestoreDb) {");

// remove pocketbase block from revalidateKey
code = code.replace(/        if \(apiUrl === 'pocketbase'\) \{[\s\S]*?            return;\n        \}\n/g, "");

// remove pocketbase block from post
code = code.replace(/            if \(apiUrl === 'pocketbase'\) \{[\s\S]*?                return;\n            \}\n/g, "");

fs.writeFileSync('src/services/db.ts', code);
