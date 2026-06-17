const fs = require('fs');
let content = fs.readFileSync('src/pages/Setup.tsx', 'utf8');

// remove step 3 (pocketbase block)
content = content.replace(/                    <button \n                        onClick=\{\(\) => setStep\(3\)\}[\s\S]*?Link your PocketHost instance directly<\/p>\n                        <\/div>\n                    <\/button>\n                    \n/g, "");

content = content.replace(/  if \(step === 3\) \{[\s\S]*?  \/\/ Step 4 = Entity Identity \(Registration\)/, "  // Step 4 = Entity Identity (Registration)");

fs.writeFileSync('src/pages/Setup.tsx', content);
