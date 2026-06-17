import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/db';
import { useAppContext } from '../App';
import { PharmacyInfo } from '../types';
import { 
  ChevronRight, 
  Loader2, 
  Activity, 
  ShieldCheck, 
  History, 
  Globe, 
  Zap, 
  UploadCloud,
  Mail,
  CheckCircle2,
  AlertCircle,
  Info,
  RefreshCw,
  Trash2
} from 'lucide-react';

export default function Setup() {
  const navigate = useNavigate();
  const { refreshInfo } = useAppContext();
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState<PharmacyInfo>({
    name: '', 
    address: '', 
    tin: '', 
    phone: '', 
    email: '', 
    notificationEmail: '',
    enableDevicePasscode: false,
    branches: []
  });

  const [checkingExisting, setCheckingExisting] = useState(true);
  const [existingInfo, setExistingInfo] = useState<PharmacyInfo | null>(null);
  const [errorConnecting, setErrorConnecting] = useState<string | null>(null);

  // SMTP Status and Validation states
  const [smtpStatus, setSmtpStatus] = useState<{
    host: string | null;
    port: string | null;
    user: string | null;
    hasPass: boolean;
    from: string | null;
    isFullyConfigured: boolean;
  } | null>(null);
  const [loadingSmtp, setLoadingSmtp] = useState(true);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpResult, setSmtpResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testEmailRecipient, setTestEmailRecipient] = useState('sonanpharmacy@gmail.com');

  const fetchSmtpStatus = async () => {
    try {
      setLoadingSmtp(true);
      const res = await fetch('/api/system/smtp-status');
      if (res.ok) {
        const data = await res.json();
        setSmtpStatus(data);
      }
    } catch (err) {
      console.error("Failed to load SMTP status:", err);
    } finally {
      setLoadingSmtp(false);
    }
  };

  useEffect(() => {
    let active = true;
    const checkCentral = async () => {
      try {
        if (active) {
          setCheckingExisting(true);
          setErrorConnecting(null);
        }
        
        const apiUrl = window.location.origin;
        const res = await fetch(`${apiUrl}/api/data/pharma_info`, { 
          signal: AbortSignal.timeout(4000) 
        });
        
        if (res.ok) {
          const info = await res.json();
          // Verify that we received a valid PharmacyInfo object rather than an empty array/null
          if (info && !Array.isArray(info) && typeof info === 'object' && info.name) {
            localStorage.setItem('API_URL', apiUrl);
            localStorage.setItem('PC_ROLE', 'STAFF');
            await refreshInfo();
            if (active) {
              navigate('/login');
            }
            return;
          }
        }
      } catch (err: any) {
        console.warn("Snappy central check bypassed or failed:", err.message || err);
      } finally {
        if (active) {
          setCheckingExisting(false);
        }
      }
    };
    checkCentral();
    fetchSmtpStatus();
    
    return () => {
      active = false;
    };
  }, [navigate, refreshInfo]);

  const handleTestSmtp = async () => {
    setTestingSmtp(true);
    setSmtpResult(null);
    try {
      const res = await fetch('/api/system/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testEmail: testEmailRecipient })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSmtpResult({
          success: true,
          message: data.message
        });
        fetchSmtpStatus();
      } else {
        setSmtpResult({
          success: false,
          message: data.error || 'SMTP Connection Handshake Failed. Verify SMTP_HOST and authentication credentials.'
        });
      }
    } catch (err: any) {
      setSmtpResult({
        success: false,
        message: err.message || 'Handshake failed. Check your local computer firewall / port configurations.'
      });
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleBackupUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            setIsRestoring(true);
            const json = JSON.parse(event.target?.result as string);
            const ledgerData = json.data || json;
            if (ledgerData) {
                localStorage.setItem('API_URL', window.location.origin);
                localStorage.setItem('PC_ROLE', 'MAIN');
                await db.importBackup(ledgerData);
            } else { 
                alert("Invalid backup format."); 
            }
        } catch (err: any) { 
             console.error("Backup Setup import error:", err);
             alert("Restoration failed: " + (err.message || "Unknown error")); 
        } finally { 
          setIsRestoring(false); 
        }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRestoring(true);
    try {
      localStorage.setItem('API_URL', window.location.origin);
      localStorage.setItem('PC_ROLE', 'MAIN');
      
      // Let's completely purge any old tables/remnants of previous pharmacy setups
      try {
        const resetRes = await fetch(`${window.location.origin}/api/system/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(45000)
        });
        if (resetRes.ok) {
           console.log("Central server database successfully reset.");
        }
      } catch (resetErr) {
         console.warn("Server reset step bypassed:", resetErr);
      }

      // Fast check out: clear local client cache to ensure no overlap/residuals
      try {
        await db.nuclearResetLocalOnly();
      } catch (cacheErr) {
        console.warn("Client cache clean bypassed:", cacheErr);
      }
      
      await db.saveInfo(formData);
      await refreshInfo();
      navigate('/login');
    } catch (err: any) {
      alert("Failed to save profile: " + (err.message || err));
    } finally {
      setIsRestoring(false);
    }
  };

  if (errorConnecting) {
      return (
        <div className="min-h-screen bg-teal-950 flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-6 sm:p-10 text-center flex flex-col items-center gap-6 my-8 sm:my-12 py-8">
                <div className="p-4 bg-orange-50 text-orange-600 rounded-2xl shadow-md">
                    <AlertCircle size={36} className="text-orange-500 animate-pulse" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tight italic">Database Connection Check</h2>
                    <p className="text-slate-500 text-xs font-bold leading-relaxed px-4">
                        {errorConnecting}
                    </p>
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl text-[10px] text-slate-500 font-semibold text-left space-y-2 mt-4">
                      <p className="text-slate-700 font-black uppercase tracking-wider text-[8px] text-teal-600">Ethio Telecom Plesk Setup Guide:</p>
                      <p>1. Open <code className="bg-slate-200 px-1 rounded font-mono text-[9px]">public/api.php</code> in your downloaded folder.</p>
                      <p>2. Put your database server details and credentials at the top of that file.</p>
                      <p>3. Upload <code className="bg-slate-200 px-1 rounded font-mono text-[9px]">api.php</code> and the application files to your Plesk hosting manager.</p>
                    </div>
                </div>

                <div className="w-full space-y-2.5">
                    <button 
                        onClick={() => {
                            window.location.reload();
                        }} 
                        className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl font-black uppercase text-xs tracking-[0.15em] shadow-xl transition-all flex items-center justify-center gap-2 active:scale-95 duration-150"
                    >
                        <RefreshCw size={14} /> Retry Connection Check
                    </button>

                    <button 
                        onClick={() => {
                            setErrorConnecting(null);
                            setCheckingExisting(false);
                        }} 
                        className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 active:scale-95 duration-150"
                    >
                        Skip & Create Profile Anyway
                    </button>

                    <button 
                        onClick={async () => {
                            localStorage.setItem('API_URL', 'browser-local');
                            localStorage.setItem('PC_ROLE', 'MAIN');
                            await refreshInfo();
                            window.location.reload();
                        }} 
                        className="w-full py-3 bg-white text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 rounded-2xl font-black uppercase text-[9px] tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                        Enable browser-offline mode (Local-cache)
                    </button>
                </div>
            </div>
        </div>
      );
  }

  if (checkingExisting) {
      return (
        <div className="min-h-screen bg-teal-950 flex items-center justify-center p-4">
            <div className="flex flex-col items-center gap-4 text-center">
                <Loader2 className="animate-spin text-teal-400" size={48} />
                <p className="text-xs font-black uppercase tracking-widest text-teal-500">Connecting Shared Registry...</p>
            </div>
        </div>
      );
  }

  // Fallback to show clean confirmation if profile already existed / was detected
  if (existingInfo) {
      return (
        <div className="min-h-screen w-full bg-teal-950 flex flex-col justify-start items-center p-4 sm:p-6 overflow-y-auto pb-12">
            <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-6 sm:p-10 text-center flex flex-col items-center gap-6 my-8 sm:my-12 py-8 animate-in zoom-in-95 duration-200">
                <div className="p-4 bg-teal-50 text-teal-600 rounded-2xl shadow-md">
                    <Globe size={36} className="animate-pulse" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter italic">Active Profile Detected</h1>
                    <p className="text-teal-600 text-xs font-black uppercase mt-1 tracking-widest">Shared Web Network Connected</p>
                </div>
                
                <div className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-left space-y-3">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">Central Profile Details</div>
                    <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Pharmacy Name</div>
                        <div className="text-base font-black text-slate-800 uppercase leading-snug">{existingInfo.name}</div>
                    </div>
                    {existingInfo.branches && existingInfo.branches.length > 0 && (
                        <div>
                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Registered Branches</div>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {existingInfo.branches.map(b => (
                                    <span key={b} className="text-[9px] font-black uppercase text-indigo-600 px-2.1 py-0.5 bg-indigo-50 border border-indigo-100 rounded-full">{b}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Location & Contact</div>
                        <div className="text-xs font-bold text-slate-600">{existingInfo.address} | {existingInfo.phone}</div>
                    </div>
                </div>

                <button 
                    onClick={async () => {
                        localStorage.setItem('API_URL', window.location.origin);
                        localStorage.setItem('PC_ROLE', 'STAFF');
                        await refreshInfo();
                        navigate('/login');
                    }} 
                    className="w-full py-4 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl font-black uppercase text-xs tracking-[0.15em] shadow-xl transition-all flex items-center justify-center gap-2 active:scale-95 duration-150"
                >
                    <Zap size={16} /> Enter Web Terminal
                </button>

                <button 
                    onClick={() => {
                        setExistingInfo(null);
                    }} 
                    className="text-[10px] font-black text-slate-400 hover:text-teal-600 uppercase tracking-widest mt-2 border-b border-transparent hover:border-teal-600/20 transition-all inline-block"
                >
                    Create New Organization Profile
                </button>

                <div className="w-full border-t border-slate-100 pt-5 mt-4">
                    <p className="text-[9px] font-black uppercase text-slate-400 mb-2.5 tracking-wider">Troubleshooting & Purge Zone</p>
                    <button 
                        onClick={async () => {
                            if (window.confirm("WARNING: Are you sure you want to permanently delete ALL previous pharmacy data, sales, logs, products, and branches from the server database? This action CANNOT be undone.")) {
                                try {
                                    setIsRestoring(true);
                                    const resetRes = await fetch(`${window.location.origin}/api/system/reset`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' }
                                    });
                                    if (resetRes.ok) {
                                        await db.nuclearResetLocalOnly();
                                        await refreshInfo();
                                        setExistingInfo(null);
                                        alert("Success! Server database registry has been completely wiped. You can now configure a fresh installation.");
                                        window.location.reload();
                                    } else {
                                        alert("Failed to wipe server database. Check network status.");
                                    }
                                } catch (e: any) {
                                    alert("Error clearing database data: " + e.message);
                                } finally {
                                    setIsRestoring(false);
                                }
                            }
                        }} 
                        className="text-[9px] font-black text-rose-500 hover:text-white uppercase tracking-widest transition-all px-4 py-2 bg-rose-50 hover:bg-rose-600 rounded-xl border border-rose-200/50 inline-flex items-center gap-1.5 active:scale-95 duration-150"
                    >
                        <Trash2 size={12} /> Delete All Previous Pharmacy Data
                    </button>
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen w-full bg-teal-950 flex flex-col justify-start items-center p-4 sm:p-6 md:p-10 overflow-y-auto pb-16">
      <div className="max-w-xl w-full bg-white rounded-[2.5rem] shadow-2xl p-6 sm:p-10 my-8 sm:my-12 py-8 animate-in fade-in zoom-in-95 duration-300">
        
        {/* Top Header & Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-teal-50 text-teal-600 rounded-2xl mb-4 shadow-sm">
            <Activity size={32} className="text-teal-600" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-800 uppercase tracking-tight italic">
            Initialize Institution
          </h1>
          <p className="text-teal-600 text-[10px] font-black uppercase tracking-wider mt-1">
            Web-Based Pharmacy Control Node Setup
          </p>
        </div>

        {/* Setup Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Pharmacy Master Name
            </label>
            <input 
              required 
              type="text"
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-teal-500 outline-none font-black uppercase text-sm sm:text-base shadow-inner transition-colors" 
              placeholder="E.G. SONAN PHARMACY GROUP" 
              value={formData.name} 
              onChange={e => setFormData({...formData, name: e.target.value})} 
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                Primary Profile Email (For Security Verification)
              </label>
              <input 
                required 
                type="email"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none shadow-inner focus:border-teal-500 transition-colors" 
                placeholder="info@pharmacy.com" 
                value={formData.email} 
                onChange={e => {
                  setFormData({...formData, email: e.target.value});
                  if (e.target.value.includes('@')) {
                    setTestEmailRecipient(e.target.value);
                  }
                }} 
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                Security Passcode Backup Email (Alternative)
              </label>
              <input 
                type="email"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none shadow-inner focus:border-teal-500 transition-colors" 
                placeholder="backup-admin@pharmacy.com" 
                value={formData.notificationEmail || ''} 
                onChange={e => setFormData({...formData, notificationEmail: e.target.value})} 
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Headquarters Address
            </label>
            <input 
              required 
              type="text"
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none shadow-inner focus:border-teal-500 transition-colors" 
              placeholder="e.g. Addis Ababa, Bole, Block 12"
              value={formData.address} 
              onChange={e => setFormData({...formData, address: e.target.value})} 
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Branches (Comma separated)
            </label>
            <input 
              type="text"
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none shadow-inner focus:border-teal-500 transition-colors" 
              placeholder="E.g. Main, Branch A, Branch B" 
              value={formData.branches?.join(', ')} 
              onChange={e => setFormData({...formData, branches: e.target.value.split(',').map(b => b.trim()).filter(Boolean)})} 
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                TIN / REGISTER ID
              </label>
              <input 
                maxLength={40}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none shadow-inner focus:border-teal-500 transition-colors" 
                placeholder="E.g. TIN-9012480"
                value={formData.tin} 
                onChange={e => setFormData({...formData, tin: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                Hotline Phone Number
              </label>
              <input 
                required 
                type="text"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none shadow-inner focus:border-teal-500 transition-colors" 
                placeholder="E.g. +251 911 000 000"
                value={formData.phone} 
                onChange={e => setFormData({...formData, phone: e.target.value})} 
              />
            </div>
          </div>

          <div className="flex items-center gap-4 p-4.5 bg-slate-50 border-2 border-slate-100 rounded-2xl select-none">
            <div className="flex-1 text-left">
              <p className="font-extrabold text-xs text-slate-800 uppercase tracking-tight">Enable Device Security Passcodes</p>
              <p className="text-[9px] uppercase font-bold text-slate-400 mt-1 leading-normal">Require an email verification OTP passcode for any logins on unrecognized devices</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={formData.enableDevicePasscode || false} 
                onChange={e => setFormData({ ...formData, enableDevicePasscode: e.target.checked })} 
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
          </div>

          <button 
            type="submit" 
            disabled={isRestoring}
            className="w-full bg-teal-600 text-white py-4.5 rounded-2xl font-black uppercase text-xs tracking-[0.2em] mt-6 shadow-xl shadow-teal-500/10 hover:bg-teal-700 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
          >
            {isRestoring ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Establishing...
              </>
            ) : (
              <>
                Establish Pharmacy Node <ChevronRight size={16}/>
              </>
            )}
          </button>
        </form>

        {/* SMTP Status & Validator */}
        <div className="mt-8 pt-6 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-3.5">
            <Mail className="text-teal-600" size={18} />
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">
              SMTP Mail Infrastructure Check
            </h2>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-4">
            <p className="text-[10px] text-slate-500 font-semibold leading-relaxed">
              APSMS sends critical unrecognized login passcodes and operational intelligence reports to your admin profile email. Ensure the server SMTP variables are correctly declared.
            </p>

            {loadingSmtp ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="animate-spin text-teal-600" size={14} />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scanning Mail Environment...</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {/* Configuration Variables Panel */}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-slate-400 font-black uppercase text-[8px] block tracking-wider">SMTP Host</span>
                      <code className="font-mono font-bold text-slate-700 block truncate max-w-[120px]">{smtpStatus?.host || 'NOT CONFIGURED'}</code>
                    </div>
                    {smtpStatus?.host ? (
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle size={14} className="text-amber-500 shrink-0" />
                    )}
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-slate-400 font-black uppercase text-[8px] block tracking-wider">SMTP Port</span>
                      <code className="font-mono font-bold text-slate-700 block">{smtpStatus?.port || '587 (Default)'}</code>
                    </div>
                    {smtpStatus?.port ? (
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    ) : (
                      <Info size={14} className="text-slate-400 shrink-0" />
                    )}
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-slate-400 font-black uppercase text-[8px] block tracking-wider">SMTP User</span>
                      <code className="font-mono font-bold text-slate-700 block truncate max-w-[120px]">{smtpStatus?.user || 'NOT CONFIGURED'}</code>
                    </div>
                    {smtpStatus?.user ? (
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle size={14} className="text-amber-500 shrink-0" />
                    )}
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-slate-400 font-black uppercase text-[8px] block tracking-wider">SMTP Secret Key</span>
                      <code className="font-mono font-bold text-slate-700 block">{smtpStatus?.hasPass ? '••••••••' : 'MISSING'}</code>
                    </div>
                    {smtpStatus?.hasPass ? (
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle size={14} className="text-amber-500 shrink-0" />
                    )}
                  </div>
                </div>

                {/* Env definition hint */}
                {!smtpStatus?.isFullyConfigured && (
                  <div className="bg-amber-50/50 border border-amber-200/50 p-3 rounded-xl space-y-1.5 text-[10px]">
                    <div className="font-black text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertCircle size={12} /> Sandbox Relay Fallback Active
                    </div>
                    <p className="text-amber-700 font-medium leading-relaxed">
                      SMTP environment variables are not fully configured. The application is running using a <strong>FormSubmit.co cloud-relay backup</strong>, which dispatches genuine passcodes directly to <span className="font-bold underline">{formData.email || 'sonanpharmacy@gmail.com'}</span>. For enterprise-grade reliability, configure the environment variables under server settings.
                    </p>
                  </div>
                )}

                {/* Test Interface */}
                <div className="border-t border-slate-100 pt-3.5 space-y-2.5">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">
                    SMTP Handshake Checklist & Validator
                  </div>

                  <div className="flex gap-2">
                    <input 
                      type="email"
                      value={testEmailRecipient}
                      onChange={e => setTestEmailRecipient(e.target.value)}
                      placeholder="e.g. your-email@gmail.com"
                      className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-[11px] font-bold outline-none focus:border-teal-500 shadow-sm"
                    />
                    <button
                      type="button"
                      disabled={testingSmtp}
                      onClick={handleTestSmtp}
                      className="px-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-55 text-white text-[10px] uppercase font-black tracking-widest rounded-xl transition-all flex items-center gap-1.5 shadow-md active:scale-95"
                    >
                      {testingSmtp ? (
                        <>
                          <RefreshCw className="animate-spin" size={12} /> Connecting...
                        </>
                      ) : (
                        <>Verify Integration</>
                      )}
                    </button>
                  </div>

                  {smtpResult && (
                    <div className={`p-3 rounded-xl border text-[10px] leading-relaxed transition-all duration-200 ${
                      smtpResult.success 
                        ? 'bg-emerald-50 border-emerald-100 text-emerald-800 font-bold' 
                        : 'bg-rose-50 border-rose-100 text-rose-800'
                    }`}>
                      <div className="flex gap-2">
                        {smtpResult.success ? (
                          <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle size={14} className="text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <strong className="block uppercase tracking-wider text-[9px] mb-0.5">
                            {smtpResult.success ? 'TEST HANDSHAKE PASSED' : 'CONNECTION DIAGNOSTICS REPORT'}
                          </strong>
                          <span>{smtpResult.message}</span>
                          {!smtpResult.success && (
                            <div className="mt-1.5 pt-1.5 border-t border-rose-100 text-[9px] font-medium text-rose-700 space-y-1">
                              <div>• Double check if your server hosting config limits port 465/587 outbound to SMTP Host.</div>
                              <div>• Gmail configurations require an "App Password" rather than your standard account secret.</div>
                              <div>• When SMTP variables are missing, our premium web-relay backup continues forwarding device passcode triggers to {formData.email || 'sonanpharmacy@gmail.com'}.</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Security badges & uploader */}
        <div className="mt-8 pt-6 border-t border-slate-100 text-center space-y-4">
          <div className="flex items-center justify-center gap-6">
            <div className="flex items-center gap-1.5 text-slate-500 text-[9px] font-black uppercase tracking-wider">
              <ShieldCheck size={14} className="text-teal-500" />
              Encrypted SSL Channel
            </div>
            <div className="flex items-center gap-1.5 text-slate-500 text-[9px] font-black uppercase tracking-wider">
              <History size={14} className="text-indigo-500" />
              Automated Cloud Registry
            </div>
          </div>

          <div className="bg-slate-50/50 rounded-2xl p-3 border border-dashed border-slate-200">
            <input type="file" ref={fileInputRef} onChange={handleBackupUpload} accept=".json" className="hidden" />
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isRestoring}
              className="text-[9px] font-black text-slate-500 hover:text-teal-600 uppercase tracking-widest flex items-center justify-center gap-1.5 mx-auto transition-colors"
            >
              <UploadCloud size={14} /> Check-in from Ledger Backup (.json)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
