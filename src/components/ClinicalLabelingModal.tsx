import React, { useState } from 'react';
import { 
  X, Stethoscope, Info, Languages, Loader2, Sparkles, 
  Printer, FileText, Check, Pill
} from 'lucide-react';
import { LABEL_OPTIONS } from '../constants';
import { generateClinicalInstruction } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialDrugName: string;
  initialStrength: string;
}

export const ClinicalLabelingModal: React.FC<Props> = ({ 
  isOpen, 
  onClose, 
  initialDrugName, 
  initialStrength 
}) => {
  const [isLabelLoading, setIsLabelLoading] = useState(false);
  const [labelResult, setLabelResult] = useState('');
  const [params, setParams] = useState({
    drugName: initialDrugName,
    strength: initialStrength,
    dosageForm: LABEL_OPTIONS.DOSAGE_FORMS[0],
    indication: '',
    ageGroup: 'Adult',
    conditions: '',
    route: LABEL_OPTIONS.ROUTES[0],
    frequency: LABEL_OPTIONS.FREQUENCIES[0],
    duration: LABEL_OPTIONS.DURATIONS[0],
    food: LABEL_OPTIONS.FOOD_INSTRUCTIONS[1],
    precautions: LABEL_OPTIONS.PREPARATIONS[7],
    targetLanguage: 'English'
  });

  const handleGenerate = async () => {
    setIsLabelLoading(true);
    try {
      const res = await generateClinicalInstruction(params);
      setLabelResult(res);
    } finally {
      setIsLabelLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 z-[3000] flex items-center justify-center p-4 backdrop-blur-2xl animate-in fade-in duration-300">
      <div className="bg-white rounded-[3.5rem] shadow-3xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-10 border-b flex justify-between items-center bg-teal-50/50">
          <div className="flex items-center gap-5">
            <div className="p-4 bg-teal-600 text-white rounded-2xl shadow-xl shadow-teal-200"><Stethoscope size={32}/></div>
            <div>
              <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tighter leading-none mb-2">Forensic Dosing Engine</h2>
              <p className="text-[10px] font-black text-teal-600 uppercase tracking-widest">Regulatory-Compliant AI Labeling Node</p>
            </div>
          </div>
          <button onClick={onClose} className="p-4 hover:bg-slate-200 rounded-full transition-all text-slate-300 hover:text-rose-500"><X size={36}/></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-10 flex flex-col lg:flex-row gap-10 no-scrollbar">
          {/* LEFT: Regimen Construction */}
          <div className="lg:w-1/3 space-y-6">
            <div className="space-y-4">
              <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] flex items-center gap-2"><Info size={14}/> Sig Parameters</h4>
              <div className="space-y-4 bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-inner">
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-1">Active Substance</label>
                  <input className="w-full p-3 bg-white border border-slate-100 rounded-xl font-black text-xs uppercase" value={params.drugName} onChange={e => setParams({...params, drugName: e.target.value})}/>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-1">Strength</label>
                    <input className="w-full p-3 bg-white border border-slate-100 rounded-xl font-black text-xs uppercase" value={params.strength} onChange={e => setParams({...params, strength: e.target.value})}/>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-1">Form</label>
                    <select className="w-full p-3 bg-white border border-slate-100 rounded-xl font-black text-[10px] uppercase appearance-none" value={params.dosageForm} onChange={e => setParams({...params, dosageForm: e.target.value})}>
                      {LABEL_OPTIONS.DOSAGE_FORMS.map(x => <option key={x}>{x}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Route & Frequency</label>
                  <div className="flex gap-2">
                    <select className="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-[10px] uppercase" value={params.route} onChange={e => setParams({...params, route: e.target.value})}>{LABEL_OPTIONS.ROUTES.map(x => <option key={x}>{x}</option>)}</select>
                    <select className="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-[10px] uppercase" value={params.frequency} onChange={e => setParams({...params, frequency: e.target.value})}>{LABEL_OPTIONS.FREQUENCIES.map(x => <option key={x}>{x}</option>)}</select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Duration & Context</label>
                  <div className="flex gap-2">
                    <select className="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-[10px] uppercase" value={params.duration} onChange={e => setParams({...params, duration: e.target.value})}>{LABEL_OPTIONS.DURATIONS.map(x => <option key={x}>{x}</option>)}</select>
                    <select className="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-[10px] uppercase" value={params.food} onChange={e => setParams({...params, food: e.target.value})}>{LABEL_OPTIONS.FOOD_INSTRUCTIONS.map(x => <option key={x}>{x}</option>)}</select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Translation Node</label>
                  <div className="flex items-center gap-2 bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                    <Languages size={14} className="text-indigo-600"/>
                    <select className="flex-1 bg-transparent font-black text-[10px] uppercase text-indigo-700 outline-none" value={params.targetLanguage} onChange={e => setParams({...params, targetLanguage: e.target.value})}>
                      <option>English</option><option>Spanish</option><option>French</option><option>Arabic</option><option>Amharic</option><option>Swahili</option><option>Hindi</option><option>Mandarin</option><option>Portuguese</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <button onClick={handleGenerate} disabled={isLabelLoading || !params.drugName} className="w-full py-6 bg-teal-600 text-white rounded-3xl font-black uppercase text-xs tracking-[0.2em] shadow-2xl shadow-teal-600/30 hover:bg-teal-700 transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50">
              {isLabelLoading ? <Loader2 className="animate-spin" size={20}/> : <Sparkles size={20}/>}
              {isLabelLoading ? "Synthesizing..." : "Generate Clinical Sig"}
            </button>
          </div>

          {/* RIGHT: Intelligence View */}
          <div className="flex-1 h-full min-h-[400px]">
            <div className="bg-slate-900 rounded-[3rem] h-full flex flex-col shadow-2xl border border-white/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-10 opacity-5 rotate-12"><Pill size={200} className="text-teal-400"/></div>
              <div className="p-8 border-b border-white/10 flex justify-between items-center bg-white/5 backdrop-blur-md relative z-20">
                <div className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div><h3 className="text-white font-black uppercase tracking-widest text-[10px]">AI Analytical Manifest</h3></div>
                {labelResult && <button onClick={() => window.print()} className="p-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all"><Printer size={18}/></button>}
              </div>
              <div className="flex-1 p-12 overflow-y-auto no-scrollbar relative z-10">
                {isLabelLoading ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-30 grayscale">
                    <Loader2 className="animate-spin text-teal-400 mb-6" size={80}/>
                    <p className="text-white font-black uppercase tracking-[0.5em] text-[10px]">Engaging Pharmacological models...</p>
                  </div>
                ) : labelResult ? (
                  <div className="space-y-10 animate-in fade-in duration-1000">
                    <div className="prose prose-invert max-w-none prose-headings:text-teal-400 prose-p:text-slate-300 prose-strong:text-white">
                      <ReactMarkdown>{labelResult}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-700">
                    <FileText size={100} className="opacity-5 mb-6"/>
                    <p className="font-black uppercase tracking-[0.4em] text-xs">Waiting for clinical input</p>
                  </div>
                )}
              </div>
              {labelResult && (
                <div className="p-8 bg-emerald-500/10 border-t border-emerald-500/20 flex items-center justify-center gap-3">
                  <Check size={20} className="text-emerald-400"/>
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 italic underline underline-offset-4">Clinically verified by AI node</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};