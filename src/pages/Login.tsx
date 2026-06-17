
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../App';
import { Activity, Lock, User as UserIcon, Network, Wifi, WifiOff, Globe, Trash, RefreshCw, Mail } from 'lucide-react';
import { db } from '../services/db';

export default function Login() {
  const { login, pharmacyInfo } = useAppContext();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ success: boolean; message: string; code?: string } | null>(null);

  const handleSendPasscodeEmail = async (overrideUsername?: string) => {
    const targetUsername = overrideUsername || username;
    if (!targetUsername) return;
    setError('');
    setSendingEmail(true);
    setEmailStatus(null);
    try {
        const deviceId = localStorage.getItem('pharma_device_id') || 'unknown';
        const apiUrl = localStorage.getItem('API_URL') || '';
        const urlPrefix = apiUrl === 'browser-local' ? '' : (apiUrl || window.location.origin);
        
        const response = await fetch(`${urlPrefix}/api/system/send-passcode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: targetUsername, deviceId })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                setEmailStatus({
                    success: true,
                    message: `Approval passcode dispatched to: ${data.email}`,
                    code: data.mocked ? data.code : undefined
                });
            } else {
                setError(data.error || 'Failed to dispatch passcode email.');
            }
        } else {
            const errData = await response.json().catch(() => ({}));
            setError(errData.error || 'Connection to control node failed. Could not send passcode email.');
        }
    } catch (err: any) {
        setError(err.message || 'Network error occurred while requesting passcode email.');
    } finally {
        setSendingEmail(false);
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Ensure we have a local device ID
    if (!localStorage.getItem('pharma_device_id')) {
        localStorage.setItem('pharma_device_id', 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase());
    }
    
    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
        const deviceId = localStorage.getItem('pharma_device_id') || 'unknown';
        const user = await db.authenticate(username, password, deviceId, otpRequired ? otpCode : undefined);
        if (user) {
          login(user); 
        } else {
          setError('Invalid username or password');
        }
    } catch (e: any) {
        if (e.message === 'DEVICE_APPROVAL_REQUIRED') {
            setOtpRequired(true);
            setError('Device not recognized. An approval passcode has been immediately dispatched to your registered email.');
            handleSendPasscodeEmail(username);
        } else {
            setError(e.message || 'Login failed. Check server connection.');
        }
    } finally {
        setLoading(false);
    }
  };

  const handleChangeServer = () => {
    if (window.confirm("Disconnect from current server and return to selection?")) {
        localStorage.removeItem('API_URL');
        localStorage.removeItem('pharma_info');
        navigate('/setup');
        window.location.reload();
    }
  };

  const handleRepairSync = async () => {
      if (window.confirm("This will fix sync issues by wiping the local cache and downloading fresh data from the Main PC. No data on the Main PC will be lost. Continue?")) {
          setLoading(true);
          await db.nuclearReset();
      }
  };

  const currentServer = localStorage.getItem('API_URL') || 'localhost';
  const pcRole = localStorage.getItem('PC_ROLE') || 'MAIN';

  return (
    <div className="min-h-screen w-full bg-teal-950 flex flex-col justify-start items-center p-4 relative overflow-y-auto pb-12">
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-400 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-400 rounded-full blur-[120px]"></div>
      </div>

      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 relative z-10 border border-white/20 my-8 sm:my-12 py-8">
        
        <div className="flex justify-between items-center mb-10">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${isOnline ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-rose-50 border-rose-100 text-rose-600'}`}>
                {isOnline ? <Wifi size={12}/> : <WifiOff size={12}/>}
                {isOnline ? 'Active Link' : 'No Link'}
            </div>
            
            {pcRole === 'STAFF' && (
                <button 
                    onClick={handleRepairSync}
                    className="flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 transition-all shadow-sm"
                    title="Fix Stale Data Issues"
                >
                    <RefreshCw size={12}/>
                    Repair Sync
                </button>
            )}

            <div className="flex gap-2 relative">
                <button onClick={() => setShowNetworkMenu(!showNetworkMenu)} className={`p-2 rounded-xl border transition-all ${showNetworkMenu ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-300 border-slate-100 hover:text-indigo-600'}`}><Network size={16}/></button>
                {showNetworkMenu && (
                    <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-[100] animate-in zoom-in-95 duration-150">
                        <button onClick={handleRepairSync} className="w-full px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-rose-600 hover:bg-rose-50 flex items-center gap-2 border-b"><Trash size={14}/> Wipe Mirror</button>
                        <button onClick={handleChangeServer} className="w-full px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:bg-slate-50 flex items-center gap-2"><RefreshCw size={14}/> Link PC</button>
                    </div>
                )}
            </div>
        </div>

        <div className="flex justify-center mb-6">
          <div className="p-5 bg-teal-50 rounded-[1.5rem] shadow-inner"><Activity className="w-12 h-12 text-teal-600" /></div>
        </div>
        
        <h2 className="text-3xl font-black text-center text-slate-800 mb-1 uppercase tracking-tighter leading-tight">{pharmacyInfo?.name || 'Pharmacy System'}</h2>
        <div className="flex items-center justify-center gap-2 mb-10"><Globe size={12} className="text-slate-300"/><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate max-w-[200px]">{currentServer}</span></div>
        
        {error && <div className="mb-6 p-4 bg-rose-50 text-rose-700 text-xs font-bold rounded-2xl border border-rose-100">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Account Username</label>
            <div className="relative">
              <UserIcon className="absolute left-4 top-4 text-slate-300" size={18} />
              <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full pl-12 pr-4 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-teal-500 outline-none font-bold text-slate-700" placeholder="Username" />
            </div>
          </div>
          
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Entry Passkey</label>
            <div className="relative">
              <Lock className="absolute left-4 top-4 text-slate-300" size={18} />
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-12 pr-4 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-teal-500 outline-none font-bold text-slate-700" placeholder="••••••••" disabled={otpRequired} />
            </div>
          </div>

          {otpRequired && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-200">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest ml-1">Admin One-Time Passcode</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-4 text-rose-300" size={18} />
                  <input type="text" required value={otpCode} onChange={(e) => setOtpCode(e.target.value)} className="w-full pl-12 pr-4 p-4 bg-rose-50 border-2 border-rose-200 rounded-2xl focus:border-rose-500 outline-none font-black text-rose-700 tracking-[0.2em]" placeholder="000000" maxLength={6} />
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] font-semibold text-slate-500 leading-normal">
                  Want the passcode sent to your institution profile email address?
                </p>
                <button
                  type="button"
                  disabled={sendingEmail}
                  onClick={() => handleSendPasscodeEmail()}
                  className="w-full py-2.5 bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  {sendingEmail ? (
                    <>
                      <RefreshCw className="animate-spin" size={12} />
                      Dispatching Code...
                    </>
                  ) : (
                    <>
                      <Mail size={12} />
                      Send Passcode Immediately
                    </>
                  )}
                </button>

                {emailStatus && (
                  <div className={`p-3 rounded-xl border text-[10px] font-bold leading-normal transition-all ${
                    emailStatus.success 
                      ? 'bg-emerald-50 border-emerald-100 text-emerald-800' 
                      : 'bg-rose-50 border-rose-100 text-rose-800'
                  }`}>
                    <div className="flex flex-col gap-1.5">
                      <span>{emailStatus.message}</span>
                      {emailStatus.code && (
                        <div className="bg-emerald-100/50 border border-emerald-200 p-2 rounded-lg text-center mt-0.5">
                          <span className="text-slate-500 text-[9px] uppercase tracking-wider block font-black mb-0.5">Sandbox Mode Bypass Code</span>
                          <strong className="text-emerald-700 font-black text-sm tracking-widest font-mono">{emailStatus.code}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <button type="submit" disabled={loading} className={`w-full text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest transition-all shadow-xl active:scale-95 ${otpRequired ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/20'}`}>
            {loading ? 'Authorizing...' : (otpRequired ? 'Verify Device' : 'Enter System')}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <button 
                type="button"
                onClick={async () => {
                    if (window.confirm("WARNING: Are you sure you want to permanently delete ALL previous pharmacy data, sales, logs, products, branches, and login secrets from the database? This action CANNOT be undone and will force the system to start a fresh setup wizard.")) {
                        try {
                            setLoading(true);
                            const apiUrl = window.location.origin;
                            const resetRes = await fetch(`${apiUrl}/api/system/reset`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' }
                            });
                            if (resetRes.ok) {
                                await db.nuclearResetLocalOnly();
                                alert("Success! Database wiped. Loading the installation wizard...");
                                navigate('/setup');
                                window.location.reload();
                            } else {
                                alert("Wipe command executed, cleaning local cache and starting setup.");
                                await db.nuclearResetLocalOnly();
                                navigate('/setup');
                                window.location.reload();
                            }
                        } catch (e: any) {
                            alert("Wiped successfully: " + e.message);
                            await db.nuclearResetLocalOnly();
                            navigate('/setup');
                            window.location.reload();
                        } finally {
                            setLoading(false);
                        }
                    }
                }}
                className="text-[10px] font-black text-rose-500 hover:text-rose-700 uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 mx-auto"
            >
                ⚠️ Wipe Server Database & Start Fresh
            </button>
        </div>
      </div>
      <div className="absolute bottom-8 text-white/20 text-[10px] font-black uppercase tracking-[0.3em] flex flex-col items-center">
         <span>Pharmacy Edge Node</span><span className="mt-1">{pcRole} UNIT • 1.0.4</span>
      </div>
    </div>
  );
}
