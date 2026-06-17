
import React, { useState } from 'react';
import { 
  ShieldAlert, Languages, Stethoscope, Loader2, 
  Zap, Pill, MessageSquare, Printer, CheckCircle, Search, Trash2, Plus
} from 'lucide-react';
import { checkDrugInteractions, generateAndTranslateLabel } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

export default function ClinicalAI() {
  const [activeTool, setActiveTool] = useState<'INTERACTION' | 'LABEL'>('INTERACTION');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');

  // Interaction State
  const [meds, setMeds] = useState<string[]>(['']);
  
  // Label State
  const [labelMed, setLabelMed] = useState('');
  const [language, setLanguage] = useState('English');

  const handleInteractionCheck = async () => {
    const filteredMeds = meds.filter(m => m.trim().length > 0);
    if (filteredMeds.length < 2) return;
    setLoading(true);
    const res = await checkDrugInteractions(filteredMeds);
    setResult(res);
    setLoading(false);
  };

  const handleLabelGen = async () => {
    if (!labelMed) return;
    setLoading(true);
    const res = await generateAndTranslateLabel(labelMed, language);
    setResult(res);
    setLoading(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic">
                <Stethoscope className="text-teal-600" size={32}/> Clinical Intelligence
            </h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">AI-Powered Forensic Diagnostics</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
            <div className="bg-white p-2 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col gap-1">
                <button 
                    onClick={() => { setActiveTool('INTERACTION'); setResult(''); }}
                    className={`flex items-center gap-4 p-6 rounded-[2rem] transition-all ${activeTool === 'INTERACTION' ? 'bg-teal-900 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                    <ShieldAlert size={24}/>
                    <div className="text-left">
                        <p className="font-black uppercase text-xs tracking-tight">Interaction Check</p>
                        <p className="text-[8px] font-bold opacity-60 uppercase tracking-widest">Multi-drug safety sweep</p>
                    </div>
                </button>
                <button 
                    onClick={() => { setActiveTool('LABEL'); setResult(''); }}
                    className={`flex items-center gap-4 p-6 rounded-[2rem] transition-all ${activeTool === 'LABEL' ? 'bg-teal-900 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                    <Languages size={24}/>
                    <div className="text-left">
                        <p className="font-black uppercase text-xs tracking-tight">Smart Labeling</p>
                        <p className="text-[8px] font-bold opacity-60 uppercase tracking-widest">Global Translation & Usage</p>
                    </div>
                </button>
            </div>

            <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
                {activeTool === 'INTERACTION' ? (
                    <div className="space-y-6">
                        <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-4">Medication List</h4>
                        {meds.map((m, i) => (
                            <div key={i} className="flex gap-2">
                                <input 
                                    className="flex-1 p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" 
                                    placeholder="Enter Drug Name..." 
                                    value={m}
                                    onChange={e => {
                                        const newMeds = [...meds];
                                        newMeds[i] = e.target.value;
                                        setMeds(newMeds);
                                    }}
                                />
                                {meds.length > 2 && (
                                    <button onClick={() => setMeds(meds.filter((_, idx) => idx !== i))} className="p-4 text-rose-300 hover:text-rose-500 transition-colors"><Trash2 size={20}/></button>
                                )}
                            </div>
                        ))}
                        <button onClick={() => setMeds([...meds, ''])} className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-black uppercase text-[10px] tracking-widest hover:border-teal-500 hover:text-teal-500 transition-all flex items-center justify-center gap-2"><Plus size={16}/> Add Medication</button>
                        <button onClick={handleInteractionCheck} disabled={loading || meds.filter(m => m.trim()).length < 2} className="w-full py-5 bg-teal-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-xl hover:bg-teal-700 transition-all active:scale-95 disabled:opacity-30">
                            {loading ? <Loader2 className="animate-spin" size={20}/> : <Zap size={20}/>}
                            {loading ? "Analyzing..." : "Execute Safety Sweep"}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                         <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Medication Identity</label>
                            <input 
                                className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500" 
                                placeholder="e.g. Metformin"
                                value={labelMed}
                                onChange={e => setLabelMed(e.target.value)}
                            />
                         </div>
                         <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Target Language</label>
                            <select 
                                className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-teal-500 appearance-none"
                                value={language}
                                onChange={e => setLanguage(e.target.value)}
                            >
                                <option>English</option>
                                <option>Spanish</option>
                                <option>French</option>
                                <option>Arabic</option>
                                <option>Hindi</option>
                                <option>Swahili</option>
                                <option>Mandarin</option>
                                <option>Portuguese</option>
                            </select>
                         </div>
                         <button onClick={handleLabelGen} disabled={loading || !labelMed} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-xl hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-30">
                            {loading ? <Loader2 className="animate-spin" size={20}/> : <Languages size={20}/>}
                            {loading ? "Translating..." : "Generate Smart Label"}
                        </button>
                    </div>
                )}
            </div>
        </div>

        <div className="lg:col-span-8">
            <div className="bg-slate-900 rounded-[3.5rem] shadow-2xl h-full flex flex-col min-h-[600px] border border-white/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5"><Zap size={200} className="text-teal-400"/></div>
                <div className="p-10 border-b border-white/10 flex justify-between items-center relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"></div>
                        <h3 className="text-white font-black uppercase tracking-widest text-[10px]">AI Analytical Output</h3>
                    </div>
                    {result && <button onClick={() => window.print()} className="p-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all"><Printer size={18}/></button>}
                </div>
                <div className="flex-1 p-12 overflow-y-auto no-scrollbar relative z-10">
                    {loading ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 grayscale">
                            <Loader2 className="animate-spin text-teal-400 mb-6" size={80}/>
                            <p className="text-white font-black uppercase tracking-[0.5em] text-[10px]">Processing Cognitive Models...</p>
                        </div>
                    ) : result ? (
                        <div className="prose prose-invert max-w-none prose-headings:text-teal-400 prose-p:text-slate-300 prose-strong:text-white animate-in fade-in duration-1000">
                            <ReactMarkdown>{result}</ReactMarkdown>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-700">
                            <MessageSquare size={100} className="opacity-5 mb-6"/>
                            <p className="font-black uppercase tracking-[0.4em] text-xs">Waiting for Input Analysis</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
