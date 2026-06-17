
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/db';
import { Prescription, Product } from '../types';
import { useAppContext } from '../App';
import { 
  FilePlus, Camera, Upload, Trash2, CheckCircle, Search, 
  User, Calendar, Stethoscope, X, PlusCircle, Eye, AlertCircle, ShoppingCart
} from 'lucide-react';

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

export default function Prescriptions() {
  const { user } = useAppContext();
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'DISPENSED'>('PENDING');
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const initialFormState: Partial<Prescription> = {
    patientName: '', patientAge: '', doctorName: '', hospitalName: '',
    date: new Date().toISOString().split('T')[0], items: [], notes: '', status: 'PENDING'
  };
  const [formData, setFormData] = useState<Partial<Prescription>>(initialFormState);
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);

  const loadData = useCallback(async () => {
    const [pData] = await Promise.all([db.getPrescriptions()]);
    setPrescriptions(pData.sort((a: Prescription, b: Prescription) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Camera access denied.");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((track: any) => track.stop());
      setIsCameraActive(false);
    }
  };

  const captureImage = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setCapturedImage(dataUrl);
        setFormData(prev => ({ ...prev, imageUrl: dataUrl }));
        stopCamera();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setCapturedImage(dataUrl);
        setFormData(prev => ({ ...prev, imageUrl: dataUrl }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const newPrescription: Prescription = { id: generateId(), ...formData as any, registeredBy: user.username, items: formData.items || [] };
    await db.addPrescription(newPrescription);
    await loadData();
    closeModal();
  };

  const closeModal = () => { setIsModalOpen(false); setCapturedImage(null); setFormData(initialFormState); stopCamera(); };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter">
          <FilePlus className="text-teal-600" size={32}/> Clinical Registry
        </h1>
        <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 px-8 py-3 bg-teal-600 text-white rounded-2xl hover:bg-teal-700 shadow-xl shadow-teal-600/20 font-black uppercase text-[10px] tracking-widest transition-all active:scale-95"><PlusCircle size={20}/> New Rx Intake</button>
      </div>

      <div className="flex gap-4 border-b border-slate-200">
        <button onClick={() => setActiveTab('PENDING')} className={`pb-3 px-6 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${activeTab === 'PENDING' ? 'text-teal-600 border-b-4 border-teal-600' : 'text-slate-400 hover:text-slate-600'}`}>Queue</button>
        <button onClick={() => setActiveTab('DISPENSED')} className={`pb-3 px-6 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${activeTab === 'DISPENSED' ? 'text-teal-600 border-b-4 border-teal-600' : 'text-slate-400 hover:text-slate-600'}`}>Fulfilled</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {prescriptions.filter(p => p.status === activeTab).map(p => (
          <div key={p.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 hover:shadow-xl transition-all group">
             <div className="flex justify-between items-start mb-4">
               <div>
                 <h3 className="font-black text-slate-800 uppercase tracking-tight">{p.patientName}</h3>
                 <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Reference: {p.id.slice(0,8)}</p>
               </div>
               <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${p.status === 'PENDING' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>{p.status}</span>
             </div>
             <div className="space-y-2 mb-6">
               <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Stethoscope size={14} className="text-teal-500"/> {p.doctorName}</div>
               <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Calendar size={14} className="text-teal-500"/> {p.date}</div>
             </div>
             <button onClick={() => setSelectedPrescription(p)} className="w-full py-3 bg-slate-50 text-slate-600 rounded-xl font-black uppercase text-[10px] tracking-widest group-hover:bg-teal-600 group-hover:text-white transition-all flex items-center justify-center gap-2"><Eye size={16}/> Inspect Record</button>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-8 border-b flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-teal-600 text-white rounded-xl shadow-lg"><FilePlus size={24}/></div>
                 <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Clinical Intake</h2>
              </div>
              <button onClick={closeModal}><X size={32} className="text-slate-300 hover:text-rose-500 transition-colors"/></button>
            </div>

            <div className="flex-1 overflow-y-auto p-10 flex flex-col lg:flex-row gap-10 no-scrollbar">
              <div className="lg:w-1/3 space-y-6">
                 <div className="bg-slate-50 rounded-[2.5rem] h-80 flex flex-col items-center justify-center relative overflow-hidden border-2 border-dashed border-slate-200">
                    {capturedImage ? (
                      <img src={capturedImage} alt="Rx" className="w-full h-full object-contain" />
                    ) : isCameraActive ? (
                      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center text-slate-300 flex flex-col items-center gap-4">
                        <Camera size={64} className="opacity-10"/>
                        <p className="text-[10px] font-black uppercase tracking-widest">Capture Source Image</p>
                      </div>
                    )}
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                    <button onClick={isCameraActive ? captureImage : startCamera} className="bg-white border-2 border-slate-100 text-slate-600 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest flex justify-center items-center gap-2 hover:border-teal-500 hover:text-teal-600 transition-all">{isCameraActive ? <CheckCircle size={18}/> : <Camera size={18}/>} {isCameraActive ? 'Capture' : 'Lens'}</button>
                    <label className="bg-white border-2 border-slate-100 text-slate-600 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest flex justify-center items-center gap-2 hover:border-indigo-500 hover:text-indigo-600 transition-all cursor-pointer"><Upload size={18}/> Files<input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} /></label>
                 </div>
              </div>

              <div className="flex-1 space-y-8">
                 <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Patient Identity</label><input required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black outline-none focus:ring-2 focus:ring-teal-500 uppercase transition-all" value={formData.patientName} onChange={e => setFormData({...formData, patientName: e.target.value})} /></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Age Ref</label><input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black outline-none focus:ring-2 focus:ring-teal-500" value={formData.patientAge} onChange={e => setFormData({...formData, patientAge: e.target.value})} /></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Doctor / prescriber</label><input required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black outline-none focus:ring-2 focus:ring-teal-500 uppercase" value={formData.doctorName} onChange={e => setFormData({...formData, doctorName: e.target.value})} /></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Intake Date</label><input type="date" required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black outline-none focus:ring-2 focus:ring-teal-500" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></div>
                 </div>
                 <div className="space-y-4">
                    <div className="flex justify-between items-center"><h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">Prescribed Regimen</h3><button type="button" onClick={() => setFormData({...formData, items: [...(formData.items || []), {medicineName:'', dosage:'', frequency:'', duration:''}]})} className="text-teal-600 font-black uppercase text-[10px] tracking-widest flex items-center gap-1 hover:underline"><PlusCircle size={14}/> Add Row</button></div>
                    <div className="space-y-3">
                       {formData.items?.map((item, idx) => (
                         <div key={idx} className="flex gap-4 items-center bg-slate-50/50 p-4 rounded-2xl border border-slate-100 animate-in slide-in-from-left-2 transition-all">
                            <input placeholder="Medicine..." className="flex-[3] p-3 bg-white border border-slate-100 rounded-xl font-black text-xs uppercase outline-none focus:ring-2 focus:ring-teal-500" value={item.medicineName} onChange={e => { const items = [...(formData.items||[])]; items[idx].medicineName = e.target.value; setFormData({...formData, items}); }} />
                            <input placeholder="Dosage..." className="flex-1 p-3 bg-white border border-slate-100 rounded-xl font-bold text-xs outline-none focus:ring-2 focus:ring-teal-500" value={item.dosage} onChange={e => { const items = [...(formData.items||[])]; items[idx].dosage = e.target.value; setFormData({...formData, items}); }} />
                            <button type="button" onClick={() => { const items = [...(formData.items||[])]; items.splice(idx,1); setFormData({...formData, items}); }} className="p-2 text-rose-300 hover:text-rose-600 hover:bg-white rounded-lg transition-all"><Trash2 size={18}/></button>
                         </div>
                       ))}
                    </div>
                 </div>
              </div>
            </div>
            <div className="p-8 border-t bg-slate-50 flex justify-end gap-4">
               <button onClick={closeModal} className="px-8 py-4 text-slate-400 font-black uppercase tracking-widest text-[10px]">Discard</button>
               <button onClick={handleSave} className="px-12 py-4 bg-teal-600 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl shadow-teal-600/20 hover:bg-teal-700 transition-all active:scale-95 flex items-center gap-3"><CheckCircle size={18}/> Commit to Ledger</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
