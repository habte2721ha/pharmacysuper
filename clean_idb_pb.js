const fs = require('fs');
let code = fs.readFileSync('src/services/idbSync.ts', 'utf8');

// remove pocketbase block from flushIndexedDBQueue
code = code.replace(/        if \(apiUrl === 'pocketbase'\) \{[\s\S]*?            return;\n        \}\n/g, "");

fs.writeFileSync('src/services/idbSync.ts', code);
