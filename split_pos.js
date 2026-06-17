const fs = require('fs');
let code = fs.readFileSync('src/pages/POS.tsx', 'utf8');

// Add SPLIT to PaymentMethod
code = code.replace(/type PaymentMethod = 'CASH' \| 'CBE' \| 'BOA' \| 'AWASH' \| 'DASHEN' \| 'TELEBIRR' \| 'CREDIT' \| 'OTHER';/, 
"type PaymentMethod = 'CASH' | 'CBE' | 'BOA' | 'AWASH' | 'DASHEN' | 'TELEBIRR' | 'CREDIT' | 'OTHER' | 'SPLIT';");

// Add state
const stateAdd = `
  const [splitPayments, setSplitPayments] = useState<{method: 'CASH' | 'CBE' | 'BOA' | 'AWASH' | 'DASHEN' | 'TELEBIRR' | 'OTHER', amount: number}[]>([
      { method: 'CASH', amount: 0 },
      { method: 'TELEBIRR', amount: 0 }
  ]);
`;
code = code.replace(/const \[vatPercent, setVatPercent\] = useState\(0\);/, "const [vatPercent, setVatPercent] = useState(0);" + stateAdd);

// Modify ExecuteSale
code = code.replace(/            status: paymentMethod === 'CREDIT' \? 'ON_CREDIT' : 'COMPLETED',\n            pointsEarned: pointsEarned,\n            paymentMethods: \[\{ method: paymentMethod as any, amount: grandTotal, dueDate: creditDueDate \}\],/g,
`            status: paymentMethod === 'CREDIT' ? 'ON_CREDIT' : 'COMPLETED',
            pointsEarned: pointsEarned,
            paymentMethods: paymentMethod === 'SPLIT' ? splitPayments.filter(sp => sp.amount > 0).map(sp => ({ method: sp.method as any, amount: sp.amount })) : [{ method: paymentMethod as any, amount: grandTotal, dueDate: creditDueDate }],`);

// Modify checkout validation
const validateAdd = `
        if (paymentMethod === 'SPLIT') {
            const totalSplit = splitPayments.reduce((s, sp) => s + (Number(sp.amount) || 0), 0);
            if (Math.abs(totalSplit - grandTotal) > 0.01) {
                alert(\`Split amounts (\${totalSplit.toFixed(2)}) must equal grand total (\${grandTotal.toFixed(2)}).\`);
                setIsProcessing(false);
                return;
            }
        }
`;
code = code.replace(/    if \(paymentMethod === 'CREDIT' \&\& !creditDueDate\) \{ alert\("Please select a settlement date for credit\."\); return; \}\n    \n    setIsProcessing\(true\);\n    try \{\n        const subTotal = cart\.reduce\(\(s, i\) => s \+ \(i\.sellingPrice \* i\.cartQty\) - \(i.discount \|\| 0\), 0\);\n        const vatAmount = subTotal \* \(vatPercent \/ 100\);\n        const grandTotal = subTotal \+ vatAmount;/g,
`    if (paymentMethod === 'CREDIT' && !creditDueDate) { alert("Please select a settlement date for credit."); return; }
    
    setIsProcessing(true);
    try {
        const subTotal = cart.reduce((s, i) => s + (i.sellingPrice * i.cartQty) - (i.discount || 0), 0);
        const vatAmount = subTotal * (vatPercent / 100);
        const grandTotal = subTotal + vatAmount;${validateAdd}`);

// Replace the layout grids to include SPLIT
const bottomBarReplace = `           <div className="grid grid-cols-5 gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
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
                          className={\`flex flex-col items-center justify-center gap-1 py-1.5 rounded-lg border transition-all \${isActive ? 'bg-teal-600 border-teal-600 text-white shadow-md scale-[1.02]' : 'bg-white border-slate-100 text-slate-400 hover:bg-slate-50'}\`}
                        >
                            {m.icon}
                            <span className="text-[6.5px] font-black uppercase tracking-widest">{m.id === 'BANK' && isBankActive ? \`\${paymentMethod}\` : m.label}</span>
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
           )}`;
           
const targetUIString = `           <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                {[
                    { id: 'CASH', icon: <Wallet size={12}/>, label: 'CASH' },
                    { id: 'TELEBIRR', icon: <Smartphone size={12}/>, label: 'TELEBIRR' },
                    { id: 'BANK', icon: <Landmark size={12}/>, label: 'BANK' },
                    { id: 'CREDIT', icon: <CreditCard size={12}/>, label: 'CREDIT' }
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
                          className={\`flex flex-col items-center justify-center gap-1 py-1.5 rounded-lg border transition-all \${isActive ? 'bg-teal-600 border-teal-600 text-white shadow-md scale-[1.02]' : 'bg-white border-slate-100 text-slate-400 hover:bg-slate-50'}\`}
                        >
                            {m.icon}
                            <span className="text-[7px] font-black uppercase tracking-widest">{m.id === 'BANK' && isBankActive ? \`\${paymentMethod}\` : m.label}</span>
                        </button>
                    );
                })}
           </div>`;
           
code = code.replace(targetUIString, bottomBarReplace);
fs.writeFileSync('src/pages/POS.tsx', code);
