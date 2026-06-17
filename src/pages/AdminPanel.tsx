import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/db';
import { ActivityLog, User, UserRole, PharmacyInfo, AVAILABLE_PERMISSIONS } from '../types';
import { useAppContext } from '../App';
import * as XLSX from 'xlsx';
import { 
  Shield, History, Search, Users, UserPlus, Trash2, X, 
  Building2, Save, Database, Download, RefreshCw, 
  FileText, Loader2, CheckCircle2, Edit2, CheckSquare, Square,
  ShieldAlert, Globe, Server, Wifi, Zap, Cpu, Network, Printer, Layers, MapPin, Lock
} from 'lucide-react';
import { cashDrawerService } from '../services/cashDrawer';

import { getSocket } from '../services/socket';

type AdminTab = 'PHARMACY' | 'BRANCHES' | 'STAFF' | 'SECURITY' | 'MAINTENANCE' | 'LOGS' | 'ACTIVE_USERS';

export default function AdminPanel() {
  const { user, pharmacyInfo, refreshInfo, logout } = useAppContext();
  const [activeTab, setActiveTab] = useState<AdminTab>('PHARMACY');
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [activeSockets, setActiveSockets] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [serverHealth, setServerHealth] = useState<any>(null);
  
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  const [infoForm, setInfoForm] = useState<PharmacyInfo>({
    name: '', address: '', tin: '', phone: '', email: '', branches: [],
    notificationEmail: '', notificationPhone: '',
    enableDailyEmailReport: false, enableDailySmsReport: false,
    enableStockAlerts: false, enableDevicePasscode: false, reportTime: '20:00'
  });

  const [securityForm, setSecurityForm] = useState({ current: '', new: '', confirm: '' });
  const [securityMsg, setSecurityMsg] = useState({ type: '', text: '' });

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [newUser, setNewUser] = useState<{id?: string, username: string, name: string, password?: string, role: UserRole, branch: string, permissions?: string[]}>({ username: '', name: '', password: '', role: UserRole.PHARMACIST, branch: '', permissions: AVAILABLE_PERMISSIONS.map(p => p.id) });
  const [userMsg, setUserMsg] = useState('');
  const [deviceApprovals, setDeviceApprovals] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    const [loadedLogs, loadedUsers, loadedApprovals] = await Promise.all([db.getLogs(), db.getUsers(), db.getDeviceApprovals()]);
    const logsArr = Array.isArray(loadedLogs) ? loadedLogs : [];
    const usersArr = Array.isArray(loadedUsers) ? loadedUsers : [];
    const appArr = Array.isArray(loadedApprovals) ? loadedApprovals : [];
    setLogs(logsArr);
    setUsers(usersArr.filter((u: any) => !u.isDeleted));
    setDeviceApprovals(appArr.filter((a: any) => !a.approved));
    
    const apiUrl = localStorage.getItem('API_URL');
    if (apiUrl && apiUrl !== 'browser-local') {
        try {
            const h = await fetch(`${apiUrl}/api/health`);
            if (h.ok) setServerHealth(await h.json());
        } catch (e) {
            setServerHealth({ status: 'offline', error: 'Communication breakdown' });
        }
    }
  }, []);

  useEffect(() => {
    loadData();
    if (pharmacyInfo) setInfoForm({ ...infoForm, ...pharmacyInfo });
    
    const socket = getSocket();
    if (socket) {
        // Emit login again just in case we missed it on reconnect
        if (user) socket.emit('user_login', user);
        
        const handler = (data: any[]) => {
            setActiveSockets(data);
        };
        socket.on('active_users_update', handler);
        return () => {
            socket.off('active_users_update', handler);
        };
    }
  }, [pharmacyInfo, loadData, user]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await db.saveInfo(infoForm);
      await refreshInfo();
      window.alert("Configuration synchronized across all nodes.");
    } catch (err) { alert("Error saving settings."); }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (newUser.id) {
        // Editing existing user
        const oldUser = users.find(u => u.id === newUser.id);
        if (!oldUser) throw new Error("User not found");
        
        const updatedUser = { 
          ...oldUser,
          name: newUser.name,
          username: newUser.username,
          role: newUser.role,
          branch: newUser.branch,
          permissions: newUser.permissions
        };
        // Add password if provided during edit
        if (newUser.password && newUser.password.trim() !== '') {
          updatedUser.password = newUser.password;
        }
        await db.addUser(updatedUser, user!);
      } else {
        // Creating new user
        const newId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + Math.random().toString(36).substring(2);
        await db.addUser({ id: newId, ...newUser }, user!);
      }
      setIsUserModalOpen(false);
      setNewUser({ username: '', name: '', password: '', role: UserRole.PHARMACIST, branch: '', permissions: AVAILABLE_PERMISSIONS.map(p => p.id) });
      setUserMsg('');
      await loadData();
    } catch (err: any) { setUserMsg(err.message); }
  };

  const handleDeleteUser = async (targetId: string) => {
    if (!user || targetId === user.id) {
        alert("You cannot delete your own account.");
        return;
    }
    if (window.confirm("Confirm account deactivation? This user will lose all access.")) {
      await db.deleteUser(targetId, user);
      await loadData();
    }
  };

  const [backupBranch, setBackupBranch] = useState<string>('');
  const [automaticBackups, setAutomaticBackups] = useState<{filename: string, date: string}[]>([]);

  useEffect(() => {
    if (activeTab === 'MAINTENANCE') {
       fetch('/api/system/backups')
        .then(res => res.json())
        .then(data => setAutomaticBackups(data || []))
        .catch(console.error);
    }
  }, [activeTab]);
  const [restoreBranch, setRestoreBranch] = useState<string>('');
  const restoreScopeRef = useRef<'all' | 'itemsOnly' | 'branch'>('all');

  const handleExportBackup = async (itemsOnly: boolean = false) => {
    setIsProcessing(true);
    try {
      const backup = await db.exportBackup({ itemsOnly, branch: backupBranch || undefined });
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PharmaVault_${backupBranch ? backupBranch + '_' : ''}${itemsOnly ? 'Items_' : ''}${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally { setIsProcessing(false); }
  };

  const handleFileRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
                              const warningMsg = restoreScopeRef.current === 'itemsOnly' 
          ? "This will process the selected file and merge/overwrite product catalog. Proceed?"
          : restoreScopeRef.current === 'branch'
          ? "This will merge/overwrite data specifically for the selected branch. Proceed?"
          : "CRITICAL: This will overwrite ALL data on this machine. Proceed?";
      if (!window.confirm(warningMsg)) return;
      setIsProcessing(true);
      
      try {
          if (file.name.toLowerCase().endsWith('.json')) {
              const reader = new FileReader();
              reader.onload = async (event) => {
                  try {
                      const json = JSON.parse(event.target?.result as string);
                      const dataToImport = json.data || json;
                      if (dataToImport) {
                          await db.importBackup(dataToImport, { scope: restoreScopeRef.current, branch: restoreBranch || undefined });
                      } else {
                          alert("Invalid backup format. Empty file or missing data.");
                      }
                  } catch (err: any) { 
                      console.error("Backup import error:", err);
                      alert("Error reading file: " + (err.message || "Unknown error")); 
                  } finally { setIsProcessing(false); }
              };
              reader.readAsText(file);
          } else if (file.name.toLowerCase().match(/\.(csv|xls|xlsx)$/)) {
              const reader = new FileReader();
              reader.onload = async (event) => {
                  try {
                      const ab = event.target?.result as ArrayBuffer;
                      const wb = XLSX.read(ab, { type: 'array' });
                      const wsname = wb.SheetNames[0];
                      const dataToImport = XLSX.utils.sheet_to_json(wb.Sheets[wsname]);
                      if (dataToImport && dataToImport.length > 0) {
                          await db.importBackup(dataToImport, { scope: restoreScopeRef.current, branch: restoreBranch || undefined });
                      } else alert("Invalid or empty spreadsheet format.");
                  } catch (err: any) {
                      alert("Error reading spreadsheet: " + (err.message || "Unknown error"));
                  } finally { setIsProcessing(false); }
              }
              reader.readAsArrayBuffer(file);
          } else {
              alert("Unsupported file format. Please upload .json, .csv, .xls, or .xlsx");
              setIsProcessing(false);
          }
      } catch (err) {
          setIsProcessing(false);
      }
  };

  const filteredLogs = logs.filter(l => 
    l.username.toLowerCase().includes(searchTerm.toLowerCase()) || 
    l.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.details.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAdmin = user?.role === UserRole.ADMIN;
  const perms = user?.permissions || [];
  const canManageUsers = isAdmin || perms.includes('manage_users');
  const canManageSettings = isAdmin || perms.includes('manage_settings');
  
  const availableTabs = [
    ...(canManageSettings ? [
       { id: 'PHARMACY', icon: <Building2 size={14}/> },
       { id: 'BRANCHES', icon: <MapPin size={14}/> }
    ] : []),
    ...(canManageUsers ? [
       { id: 'STAFF', icon: <Users size={14}/> }
    ] : []),
    ...(canManageSettings ? [
       { id: 'SECURITY', icon: <ShieldAlert size={14}/> },
       { id: 'MAINTENANCE', icon: <Server size={14}/> },
       { id: 'LOGS', icon: <History size={14}/> },
       { id: 'ACTIVE_USERS', icon: <Wifi size={14}/> }
    ] : [])
  ];

  // Make sure current tab is allowed, otherwise pick first allowed
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.some(t => t.id === activeTab)) {
      setActiveTab(availableTabs[0].id as AdminTab);
    }
  }, [availableTabs, activeTab]);

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-center gap-6">
        <div>
            <h1 className="text-4xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic">
                <Shield className="text-teal-600" size={40} /> Admin Panel
            </h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1 ml-1">Central Hub & Multi-PC Governance</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-200/50 p-1.5 rounded-2xl border border-slate-200 shadow-inner overflow-x-auto">
           {availableTabs.map(tab => (
             <button 
                key={tab.id} 
                onClick={() => setActiveTab(tab.id as AdminTab)} 
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-teal-700 shadow-md ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
             >
                {tab.icon} {tab.id}
             </button>
           ))}
        </div>
      </div>

      <div className="bg-white rounded-[3.5rem] shadow-2xl border border-slate-100 overflow-hidden min-h-[650px] flex flex-col transition-all">
        
        {activeTab === 'PHARMACY' && (
          <div className="p-12 animate-in fade-in duration-500">
             <div className="flex items-center gap-4 mb-12">
                <div className="p-4 bg-teal-50 text-teal-600 rounded-3xl shadow-sm border border-teal-100"><Building2 size={28}/></div>
                <div><h3 className="text-2xl font-black uppercase tracking-tighter text-slate-800">Pharmacy Profile</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Branding & Metadata</p></div>
             </div>
             <form onSubmit={handleSaveConfig} className="max-w-4xl space-y-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-1.5 md:col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Pharmacy Logo</label>
                        <div className="flex items-center gap-6">
                            {infoForm.logo ? (
                                <img src={infoForm.logo} alt="Logo preview" className="w-24 h-24 object-contain bg-white border-2 border-slate-200 rounded-2xl p-2" />
                            ) : (
                                <div className="w-24 h-24 flex items-center justify-center bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                                    <Building2 size={24} />
                                </div>
                            )}
                            <input 
                                type="file" 
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        const reader = new FileReader();
                                        reader.onloadend = () => {
                                            setInfoForm({ ...infoForm, logo: reader.result as string });
                                        };
                                        reader.readAsDataURL(file);
                                    }
                                }} 
                                className="text-sm font-bold text-slate-500 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:tracking-widest file:bg-slate-800 file:text-white hover:file:bg-black transition-all cursor-pointer"
                            />
                            {infoForm.logo && (
                                <button type="button" onClick={() => setInfoForm({ ...infoForm, logo: undefined })} className="p-3 text-rose-500 hover:text-white bg-rose-50 hover:bg-rose-500 rounded-xl transition-colors"><Trash2 size={16} /></button>
                            )}
                        </div>
                    </div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Entity Name</label><input required className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-lg outline-none focus:border-teal-500 transition-all uppercase" value={infoForm.name} onChange={e => setInfoForm({...infoForm, name: e.target.value})}/></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Regulatory TIN</label><input className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={infoForm.tin} onChange={e => setInfoForm({...infoForm, tin: e.target.value})}/></div>
                    <div className="space-y-1.5 md:col-span-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Street Address</label><input required className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={infoForm.address} onChange={e => setInfoForm({...infoForm, address: e.target.value})}/></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Public Hotline</label><input required className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={infoForm.phone} onChange={e => setInfoForm({...infoForm, phone: e.target.value})}/></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Primary Email</label><input required type="email" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={infoForm.email} onChange={e => setInfoForm({...infoForm, email: e.target.value})}/></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
                    <div className="flex items-center gap-4 p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl">
                         <div className="p-3 bg-teal-100 text-teal-600 rounded-xl"><Server size={20}/></div>
                         <div className="flex-1">
                             <p className="font-bold text-sm text-slate-800">Automatic Weekly Backup</p>
                             <p className="text-[10px] uppercase font-bold text-slate-500">Save server data every 7 days</p>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" className="sr-only peer" checked={infoForm.enableWeeklyBackup || false} onChange={e => setInfoForm({...infoForm, enableWeeklyBackup: e.target.checked})} />
                           <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                         </label>
                    </div>

                    <div className="flex items-center gap-4 p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl">
                         <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl"><Lock size={20}/></div>
                         <div className="flex-1">
                             <p className="font-bold text-sm text-slate-800">Device Security Passcode</p>
                             <p className="text-[10px] uppercase font-bold text-slate-500">Require email passcode for unrecognized login devices</p>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" className="sr-only peer" checked={infoForm.enableDevicePasscode || false} onChange={e => setInfoForm({...infoForm, enableDevicePasscode: e.target.checked})} />
                           <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                         </label>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Notification Email</label><input type="email" placeholder="admin@pharmacy.com" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={infoForm.notificationEmail || ''} onChange={e => setInfoForm({...infoForm, notificationEmail: e.target.value})}/></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Notification Phone (SMS)</label><input type="text" placeholder="+251..." className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={infoForm.notificationPhone || ''} onChange={e => setInfoForm({...infoForm, notificationPhone: e.target.value})}/></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
                    <div className="flex items-center gap-4 p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl">
                         <div className="p-3 bg-amber-100 text-amber-600 rounded-xl"><FileText size={20}/></div>
                         <div className="flex-1">
                             <p className="font-bold text-sm text-slate-800">Daily Report Email</p>
                             <p className="text-[10px] uppercase font-bold text-slate-500">Send summary per day</p>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" className="sr-only peer" checked={infoForm.enableDailyEmailReport || false} onChange={e => setInfoForm({...infoForm, enableDailyEmailReport: e.target.checked})} />
                           <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                         </label>
                    </div>

                    <div className="flex items-center gap-4 p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl">
                         <div className="p-3 bg-amber-100 text-amber-600 rounded-xl"><Globe size={20}/></div>
                         <div className="flex-1">
                             <p className="font-bold text-sm text-slate-800">Daily Report SMS</p>
                             <p className="text-[10px] uppercase font-bold text-slate-500">Send summary via SMS</p>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" className="sr-only peer" checked={infoForm.enableDailySmsReport || false} onChange={e => setInfoForm({...infoForm, enableDailySmsReport: e.target.checked})} />
                           <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                         </label>
                    </div>

                    <div className="flex items-center gap-4 p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl">
                         <div className="p-3 bg-rose-100 text-rose-600 rounded-xl"><Layers size={20}/></div>
                         <div className="flex-1">
                             <p className="font-bold text-sm text-slate-800">Monthly Expiry Email</p>
                             <p className="text-[10px] uppercase font-bold text-slate-500">Monthly near-expiry products</p>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" className="sr-only peer" checked={infoForm.enableMonthlyExpiryEmail || false} onChange={e => setInfoForm({...infoForm, enableMonthlyExpiryEmail: e.target.checked})} />
                           <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                         </label>
                    </div>

                    <div className="flex items-center gap-4 p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl">
                         <div className="p-3 bg-rose-100 text-rose-600 rounded-xl"><Globe size={20}/></div>
                         <div className="flex-1">
                             <p className="font-bold text-sm text-slate-800">Monthly Expiry SMS</p>
                             <p className="text-[10px] uppercase font-bold text-slate-500">Monthly near-expiry alert</p>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" className="sr-only peer" checked={infoForm.enableMonthlyExpirySms || false} onChange={e => setInfoForm({...infoForm, enableMonthlyExpirySms: e.target.checked})} />
                           <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                         </label>
                    </div>
                </div>

                <div className="pt-8 border-t border-slate-50 flex justify-end"><button type="submit" className="px-12 py-5 bg-teal-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-teal-600/20 hover:bg-teal-700 transition-all flex items-center gap-3 active:scale-95"><Save size={18}/> Commit Global Identity</button></div>
             </form>
          </div>
        )}

        {activeTab === 'BRANCHES' && (
          <div className="p-12 animate-in fade-in duration-500">
             <div className="flex items-center gap-4 mb-12">
                <div className="p-4 bg-indigo-50 text-indigo-600 rounded-3xl shadow-sm border border-indigo-100"><MapPin size={28}/></div>
                <div><h3 className="text-2xl font-black uppercase tracking-tighter text-slate-800">Branch Management</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Multi-Branch Locations & Workspaces</p></div>
             </div>
             
             <div className="max-w-4xl space-y-8">
                 <div className="bg-slate-50 border border-slate-100 rounded-3xl p-8">
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-800 mb-6">Current Branches</h4>
                    {(!infoForm.branches || infoForm.branches.length === 0) ? (
                        <div className="text-center p-8 text-slate-400 font-bold border-2 border-dashed border-slate-200 rounded-2xl">No branches defined. Only Global mode is active.</div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {infoForm.branches.map((b, idx) => (
                                <div key={idx} className="bg-white border border-slate-200 p-4 rounded-2xl flex items-center justify-between shadow-sm flex-wrap gap-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600"><MapPin size={14}/></div>
                                        <span className="font-bold text-slate-700 uppercase">{b}</span>
                                    </div>
                                    <button 
                                      onClick={async () => {
                                        if (window.confirm(`Are you sure you want to remove ${b}?`)) {
                                            const newBranches = infoForm.branches!.filter(abranch => abranch !== b);
                                            const newInfo = { ...infoForm, branches: newBranches };
                                            setInfoForm(newInfo);
                                            await db.saveInfo(newInfo);
                                            await refreshInfo();
                                        }
                                      }}
                                      className="text-rose-400 hover:text-white p-2 hover:bg-rose-500 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={14}/>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                 </div>

                 <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl shadow-slate-200/40">
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-800 mb-6">Add New Branch</h4>
                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.target as HTMLFormElement;
                        const input = form.elements.namedItem('branchName') as HTMLInputElement;
                        const branchName = input.value.trim();
                        if (branchName && !infoForm.branches?.includes(branchName)) {
                            const newBranches = [...(infoForm.branches || []), branchName];
                            const newInfo = { ...infoForm, branches: newBranches };
                            setInfoForm(newInfo);
                            await db.saveInfo(newInfo);
                            await refreshInfo();
                            input.value = '';
                        } else if (infoForm.branches?.includes(branchName)) {
                            alert("Branch already exists");
                        }
                    }} className="flex items-end gap-4">
                        <div className="flex-1 space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Branch Identity / Name</label>
                            <input name="branchName" required className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-indigo-500 uppercase" placeholder="e.g. City Center Branch" />
                        </div>
                        <button type="submit" className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/30 hover:bg-indigo-700 transition-colors flex items-center gap-2"><MapPin size={16}/> Add Branch</button>
                    </form>
                 </div>
             </div>
          </div>
        )}

        {activeTab === 'STAFF' && (
          <div className="p-12 animate-in fade-in duration-500 flex flex-col h-full">
            <div className="flex justify-between items-center mb-10">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-teal-50 text-teal-600 rounded-3xl shadow-sm border border-teal-100"><Users size={28}/></div>
                <div><h3 className="text-2xl font-black uppercase tracking-tighter text-slate-800">User Management</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Access Control & Credentials</p></div>
              </div>
              <button 
                onClick={() => {
                  setNewUser({ username: '', name: '', password: '', role: UserRole.PHARMACIST, branch: '', permissions: AVAILABLE_PERMISSIONS.map(p => p.id) });
                  setIsUserModalOpen(true);
                }}
                className="px-8 py-4 bg-teal-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-teal-700 transition-all flex items-center gap-3 active:scale-95"
              >
                <UserPlus size={18}/> Create New Account
              </button>
            </div>

            <div className="flex-1 overflow-auto border rounded-[2rem] shadow-inner bg-slate-50/50">
              <table className="w-full text-left">
                <thead className="bg-slate-100 text-slate-500 font-black uppercase text-[9px] tracking-widest sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-6 pl-10">Full Name</th>
                    <th className="p-6">Username</th>
                    <th className="p-6">Role</th>
                    <th className="p-6">Branch</th>
                    <th className="p-6 pr-10 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold uppercase text-[11px]">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-white transition-colors group">
                      <td className="p-6 pl-10 text-slate-800">{u.name}</td>
                      <td className="p-6 text-teal-600">@{u.username}</td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-slate-200 text-slate-600'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-6 text-slate-500">{u.branch || 'Global'}</td>
                      <td className="p-6 pr-10 text-right flex justify-end items-center gap-2">
                        <button 
                          onClick={() => {
                             setNewUser({ 
                               id: u.id, 
                               username: u.username, 
                               name: u.name, 
                               role: u.role, 
                               branch: u.branch || '', 
                               permissions: u.permissions || AVAILABLE_PERMISSIONS.map(p => p.id),
                               password: ''
                             });
                             setIsUserModalOpen(true);
                          }}
                          className="p-3 rounded-xl transition-all text-teal-400 hover:bg-teal-50 hover:text-teal-600"
                        >
                          <Edit2 size={20}/>
                        </button>
                        <button 
                          onClick={() => handleDeleteUser(u.id)}
                          className={`p-3 rounded-xl transition-all ${u.id === user?.id ? 'opacity-20 cursor-not-allowed' : 'text-rose-400 hover:bg-rose-50 hover:text-rose-600'}`}
                          disabled={u.id === user?.id}
                        >
                          <Trash2 size={20}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'SECURITY' && (
          <div className="p-12 animate-in fade-in duration-500">
             <div className="flex items-center gap-4 mb-12">
                <div className="p-4 bg-rose-50 text-rose-600 rounded-3xl shadow-sm border border-rose-100"><ShieldAlert size={28}/></div>
                <div><h3 className="text-2xl font-black uppercase tracking-tighter text-slate-800">Security Protocols</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Authentication & Cryptography</p></div>
             </div>
             <form onSubmit={async (e) => {
                 e.preventDefault();
                 if (securityForm.new !== securityForm.confirm) {
                     setSecurityMsg({ type: 'error', text: 'Passkeys do not match.' });
                     return;
                 }
                 try {
                     await db.changePassword(user!.id, securityForm.new);
                     setSecurityMsg({ type: 'success', text: 'Cryptographic key updated successfully.' });
                     setSecurityForm({ current: '', new: '', confirm: '' });
                 } catch (err: any) {
                     setSecurityMsg({ type: 'error', text: err.message });
                 }
             }} className="max-w-md space-y-6">
                {securityMsg.text && <div className={`p-4 text-xs font-bold rounded-2xl border ${securityMsg.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-teal-50 text-teal-700 border-teal-100'}`}>{securityMsg.text}</div>}
                <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Current Passkey</label><input required type="password" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-rose-500 transition-all" value={securityForm.current} onChange={e => setSecurityForm({...securityForm, current: e.target.value})}/></div>
                <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">New Passkey</label><input required type="password" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-rose-500 transition-all" value={securityForm.new} onChange={e => setSecurityForm({...securityForm, new: e.target.value})}/></div>
                <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Verify New Passkey</label><input required type="password" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-rose-500 transition-all" value={securityForm.confirm} onChange={e => setSecurityForm({...securityForm, confirm: e.target.value})}/></div>
                <div className="pt-4"><button type="submit" className="w-full py-5 bg-rose-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-rose-600/20 hover:bg-rose-700 transition-all flex items-center justify-center gap-3 active:scale-95"><Shield size={18}/> Rotate Cryptographic Key</button></div>
             </form>
             
             {canManageUsers && deviceApprovals.length > 0 && (
                <div className="mt-16 animate-in fade-in slide-in-from-bottom-8">
                    <div className="flex items-center gap-4 mb-8">
                         <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl"><Wifi size={24}/></div>
                         <div><h3 className="text-xl font-black uppercase tracking-tight text-slate-800">Pending Device Approvals</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">New Node Verification Requests</p></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {deviceApprovals.map(app => (
                            <div key={app.id} className="bg-white p-6 rounded-[2rem] border-2 border-amber-100 shadow-xl shadow-amber-100/50 flex flex-col gap-4">
                                <div className="flex justify-between items-center">
                                    <span className="px-3 py-1 bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest rounded-lg flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></div> Pending</span>
                                    <span className="text-[8px] font-bold text-slate-400 font-mono tracking-widest">{new Date(app.requestedAt).toLocaleTimeString()}</span>
                                </div>
                                <div>
                                    <h4 className="text-lg font-black text-slate-800 tracking-tighter uppercase leading-none">@{app.username}</h4>
                                    <p className="text-[10px] font-black text-slate-500 font-mono flex items-center gap-2 mt-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                                        <Lock size={12}/> OTP: <span className="text-teal-600 text-sm tracking-[0.2em]">{app.authCode}</span>
                                    </p>
                                </div>
                                <div className="pt-2 border-t border-slate-100 flex gap-2">
                                     <button 
                                         onClick={() => navigator.clipboard.writeText(app.authCode)}
                                         className="flex-1 py-3 bg-white text-slate-600 border-2 border-slate-200 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 transition-all active:scale-95"
                                     >Copy OTP</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
             )}
          </div>
        )}

        {activeTab === 'MAINTENANCE' && (
            <div className="p-12 animate-in fade-in duration-500 h-full flex flex-col gap-12">
                <div className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden border border-white/5">
                    <div className="absolute top-0 right-0 p-10 opacity-5 rotate-12"><Server size={250}/></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-5 mb-10">
                            <div className="p-4 bg-white/10 rounded-[1.5rem] backdrop-blur-md shadow-inner border border-white/10"><Network size={32} className="text-teal-400"/></div>
                            <div>
                                <h3 className="text-3xl font-black uppercase tracking-tighter italic">Network Nerve Center</h3>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Multi-PC Shared Database Configuration</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                            <div className="space-y-6">
                                <div className="p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <p className="text-xs font-bold text-slate-400 mb-4 uppercase tracking-widest">Client Connection URL</p>
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex-1 bg-black/40 p-4 rounded-2xl font-mono text-sm font-black tracking-widest text-teal-400 border border-teal-500/20 shadow-inner group relative truncate">
                                            {window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                                                ? (serverHealth?.ip ? `http://${serverHealth.ip}:3000` : `http://localhost:3000`)
                                                : window.location.origin}
                                            <div className="absolute inset-0 bg-teal-400/5 blur-xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        </div>
                                        <button 
                                            onClick={() => {
                                                const linkToCopy = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                                                    ? (serverHealth?.ip ? `http://${serverHealth.ip}:3000` : `http://localhost:3000`)
                                                    : window.location.origin;
                                                navigator.clipboard.writeText(linkToCopy);
                                            }}
                                            className="p-4 bg-teal-600 hover:bg-teal-700 rounded-2xl transition-all shadow-lg active:scale-90"
                                        >
                                            <Zap size={20}/>
                                        </button>
                                    </div>
                                    <p className="text-[9px] font-black uppercase text-slate-500 mt-4 leading-relaxed">
                                        Enter this address on staff computers in the Setup screen to link them to this database.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-6 bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center text-center gap-3 group hover:bg-white/10 transition-all">
                                    <div className={`p-3 rounded-2xl ${serverHealth?.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400 animate-pulse'}`}><Wifi size={24}/></div>
                                    <div><p className="text-[8px] font-black uppercase text-slate-500 mb-1">Link Status</p><p className="font-black uppercase text-xs">{serverHealth?.status === 'online' ? 'Global Node Active' : 'Offline'}</p></div>
                                </div>
                                <div className="p-6 bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center text-center gap-3 group hover:bg-white/10 transition-all">
                                    <div className="p-3 bg-indigo-500/20 text-indigo-400"><Cpu size={24}/></div>
                                    <div><p className="text-[8px] font-black uppercase text-slate-500 mb-1">Architecture</p><p className="font-black uppercase text-xs">Shared Registry</p></div>
                                </div>
                                <div className="p-6 bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center text-center gap-3 col-span-2 hover:bg-white/10 transition-all cursor-pointer" onClick={loadData}>
                                    <RefreshCw size={20} className="text-teal-400"/>
                                    <p className="font-black uppercase text-[10px] tracking-widest">Refresh Network Metrics</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-10 bg-indigo-50 border border-indigo-200 rounded-[3rem] flex flex-col group hover:shadow-xl hover:bg-white transition-all relative overflow-hidden">
                        <div className="relative z-10 flex-1">
                            <div className="flex items-center gap-3 mb-6"><div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-lg"><Printer size={24}/></div><h4 className="font-black uppercase tracking-widest text-sm text-slate-800">Hardware Diagnostics</h4></div>
                            <p className="text-xs text-slate-500 leading-relaxed mb-6 font-bold uppercase tracking-tighter">Test serial connection to POS printer and cash drawer.</p>
                        </div>
                        <div className="flex flex-col gap-3">
                            <button onClick={async () => {
                                const connected = await cashDrawerService.connect();
                                if(connected) alert("Serial port connected successfully.");
                            }} className="w-full py-4 bg-white border border-indigo-200 text-indigo-700 rounded-2xl font-black uppercase text-[10px] tracking-[0.1em] hover:bg-indigo-50 transition-all flex items-center justify-center gap-3 shadow-sm active:scale-95">
                                <Zap size={18}/> 1. Connect Serial Port
                            </button>
                            <button onClick={async () => {
                                await cashDrawerService.testPrinter();
                            }} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.1em] hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 shadow-sm active:scale-95">
                                <Printer size={18}/> 2. Print Diagnostic Slip
                            </button>
                            <button onClick={async () => {
                                await cashDrawerService.openDrawer();
                            }} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.1em] hover:bg-black transition-all flex items-center justify-center gap-3 shadow-sm active:scale-95">
                                <Layers size={18}/> 3. Kick Cash Drawer
                            </button>
                        </div>
                    </div>

                    <div className="p-10 bg-slate-50 border border-slate-200 rounded-[3rem] flex flex-col group hover:shadow-2xl hover:bg-white transition-all relative overflow-hidden">
                        <div className="relative z-10 flex-1">
                            <div className="flex items-center gap-3 mb-6"><div className="p-3 bg-teal-600 text-white rounded-2xl shadow-lg"><Download size={24}/></div><h4 className="font-black uppercase tracking-widest text-sm text-slate-800">Export Ledger Snapshot</h4></div>
                            <p className="text-xs text-slate-400 leading-relaxed mb-6 font-bold uppercase tracking-tighter">Generate a standalone archive of your records.</p>
                            {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
                                <div className="mb-4">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Target Branch (Optional)</label>
                                    <select className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold focus:border-teal-500 outline-none appearance-none mt-1 shadow-sm" value={backupBranch} onChange={(e) => setBackupBranch(e.target.value)}>
                                        <option value="">All Branches & Global Data</option>
                                        {pharmacyInfo.branches.map(b => (
                                            <option key={b} value={b}>{b}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => handleExportBackup(false)} disabled={isProcessing} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-black transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95 disabled:opacity-50">
                                {isProcessing ? <Loader2 className="animate-spin" size={18}/> : <FileText size={18}/>} Download Vault (All Data)
                            </button>
                            <button onClick={() => handleExportBackup(true)} disabled={isProcessing} className="w-full py-4 bg-white border border-slate-200 text-slate-700 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-slate-50 transition-all flex items-center justify-center gap-3 shadow-sm active:scale-95 disabled:opacity-50">
                                {isProcessing ? <Loader2 className="animate-spin" size={18}/> : <FileText size={18}/>} Export Items Only
                            </button>
                        </div>
                        {automaticBackups.length > 0 && (
                            <div className="mt-6 pt-6 border-t border-slate-200 w-full flex-1 min-h-[100px]">
                                <h4 className="font-black uppercase tracking-widest text-[10px] text-slate-400 mb-4">Available Weekly Backups</h4>
                                <div className="space-y-2 max-h-32 overflow-y-auto pr-2 no-scrollbar">
                                    {automaticBackups.map((bkp, i) => (
                                        <div key={i} className="flex justify-between items-center p-3 bg-white rounded-xl shadow-sm border border-slate-100">
                                            <span className="text-xs font-bold text-slate-700">{bkp.date}</span>
                                            <button 
                                                onClick={() => window.open(`/api/system/backups/${bkp.filename}`)}
                                                className="p-2 text-teal-600 hover:bg-teal-50 rounded-lg transition-all"
                                                title={`Download ${bkp.filename}`}
                                            ><Download size={14}/></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-10 bg-rose-50/50 border-2 border-rose-100 border-dashed rounded-[3rem] flex flex-col group hover:bg-white hover:border-rose-400 transition-all md:col-span-2">
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-6"><div className="p-3 bg-rose-600 text-white rounded-2xl shadow-lg"><RefreshCw size={24}/></div><h4 className="font-black uppercase tracking-widest text-sm text-rose-700">Restore Archive</h4></div>
                            <p className="text-xs text-rose-400 leading-relaxed mb-6 font-bold uppercase tracking-tighter">Replace current node state with an external backup file. Action is destructive.</p>
                            
                            {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
                                <div className="mb-6">
                                    <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest px-1">Target Branch (Optional)</label>
                                    <select className="w-full p-4 bg-white border border-rose-200 rounded-2xl font-bold focus:border-rose-500 outline-none appearance-none mt-1 shadow-sm text-rose-700" value={restoreBranch} onChange={(e) => setRestoreBranch(e.target.value)}>
                                        <option value="">Restore as Global Data / Preserve Existing Origins</option>
                                        {pharmacyInfo.branches.map(b => (
                                            <option key={b} value={b}>Restore forcefully into: {b}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                        <input type="file" ref={restoreFileInputRef} onClick={(e) => (e.target as HTMLInputElement).value = ''} onChange={handleFileRestore} accept=".json,.xls,.xlsx,.csv" className="hidden"/>
                        <div className="flex flex-col gap-3 mb-4">
                            <button onClick={() => { restoreScopeRef.current = 'all'; setTimeout(() => restoreFileInputRef.current?.click(), 0); }} disabled={isProcessing} className="w-full py-4 bg-white border-2 border-rose-600 text-rose-600 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-rose-50 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50">
                                <ShieldAlert size={18}/> Restore All Data
                            </button>
                            <button onClick={() => { restoreScopeRef.current = 'itemsOnly'; setTimeout(() => restoreFileInputRef.current?.click(), 0); }} disabled={isProcessing} className="w-full py-4 bg-white border-2 border-rose-600 text-rose-600 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-rose-50 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50">
                                <ShieldAlert size={18}/> Restore Items Only
                            </button>
                            {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
                            <button onClick={() => { 
                                if (!restoreBranch) { alert("Please select a target branch from the dropdown above first."); return; }
                                restoreScopeRef.current = 'branch'; setTimeout(() => restoreFileInputRef.current?.click(), 0); 
                                }} disabled={isProcessing} className="w-full py-4 bg-white border-2 border-rose-600 text-rose-600 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-rose-50 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50">
                                <ShieldAlert size={18}/> Restore Target Branch Data Only
                            </button>
                            )}
                        </div>
                        <button onClick={async () => {
                            if (window.confirm("WARNING: This will permanently delete ALL data (inventory, sales, users) across all connected PCs. Are you absolutely sure?")) {
                                setIsProcessing(true);
                                await db.nuclearReset();
                            }
                        }} disabled={isProcessing} className="w-full py-4 bg-rose-600 border-2 border-rose-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-rose-700 transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50">
                            <Trash2 size={18}/> Factory Reset (Wipe All Data)
                        </button>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'LOGS' && (
          <div className="p-12 flex flex-col h-full animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-8">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-slate-100 text-slate-600 rounded-2xl"><History size={24}/></div>
                  <div><h3 className="text-xl font-black uppercase tracking-tight text-slate-800">Security Audit Logs</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Node Activity Tracking</p></div>
               </div>
               <div className="relative w-80">
                  <Search size={16} className="absolute left-4 top-3.5 text-slate-300"/>
                  <input className="w-full pl-12 pr-4 py-3 bg-slate-50 border-2 border-transparent focus:border-teal-500 rounded-2xl outline-none font-bold text-sm transition-all" placeholder="Search events..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
               </div>
            </div>
            <div className="flex-1 overflow-auto border rounded-[2rem] shadow-inner bg-slate-50/50">
               <table className="w-full text-left">
                 <thead className="bg-slate-100 text-slate-500 font-black uppercase text-[9px] tracking-widest sticky top-0 z-10 shadow-sm">
                   <tr><th className="p-6 pl-10">Time Vector</th><th className="p-6">Auth Entity</th><th className="p-6">Action Class</th><th className="p-6 pr-10">Forensic Details</th></tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 font-bold uppercase text-[10px]">
                   {filteredLogs.map(log => (
                     <tr key={log.id} className="hover:bg-white transition-colors">
                       <td className="p-6 pl-10 text-slate-400 font-mono text-[9px]">{new Date(log.timestamp).toLocaleString()}</td>
                       <td className="p-6 text-teal-700 font-black tracking-tight">@{log.username}</td>
                       <td className="p-6"><span className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-[8px] font-black">{log.action}</span></td>
                       <td className="p-6 pr-10 text-slate-500 italic tracking-tighter truncate max-w-xs">{log.details}</td>
                     </tr>
                   ))}
                   {!filteredLogs.length && <tr><td colSpan={4} className="p-20 text-center opacity-20"><Zap size={48} className="mx-auto mb-4"/><p className="font-black uppercase tracking-widest">No matching security events</p></td></tr>}
                 </tbody>
               </table>
            </div>
          </div>
        )}

        {activeTab === 'ACTIVE_USERS' && (
          <div className="p-12 flex flex-col h-full animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-8">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-slate-100 text-teal-600 rounded-2xl"><Wifi size={24}/></div>
                  <div><h3 className="text-xl font-black uppercase tracking-tight text-slate-800">Active Connections</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Real-time Node Telemetry</p></div>
               </div>
            </div>
            <div className="flex-1 border rounded-[2rem] shadow-inner bg-slate-50/50 p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 h-fit max-h-[80vh] overflow-auto">
                {activeSockets.length > 0 ? activeSockets.map((sock, i) => (
                    <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase tracking-widest rounded-lg flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></div> Online</span>
                            <span className="text-[8px] font-bold text-slate-400 font-mono tracking-widest">{sock.ip}</span>
                        </div>
                        <div>
                            <h4 className="text-lg font-black text-slate-800 tracking-tighter uppercase leading-none">@{sock.username}</h4>
                            <p className="text-[10px] font-black text-teal-600 uppercase tracking-widest mt-1">{sock.role}</p>
                        </div>
                        <div className="pt-4 border-t border-slate-100/50">
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Session Started</p>
                            <p className="text-xs font-mono font-bold text-slate-600">{new Date(sock.loginTime).toLocaleString()}</p>
                        </div>
                    </div>
                )) : (
                    <div className="col-span-full py-20 text-center opacity-40">
                        <Wifi size={48} className="mx-auto mb-4"/>
                        <p className="font-black uppercase tracking-widest text-slate-500">Waiting for active connections...</p>
                    </div>
                )}
            </div>
          </div>
        )}

      </div>

      {isUserModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[1000] backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white p-10 rounded-[3rem] w-full max-w-md max-h-[90vh] overflow-y-auto shadow-3xl animate-in zoom-in-95 duration-200 no-scrollbar">
             <div className="flex justify-between items-center mb-10"><h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter italic">Issue Access</h2><button onClick={() => setIsUserModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={24}/></button></div>
             {userMsg && <div className="p-4 mb-6 bg-rose-50 text-rose-700 text-xs font-bold rounded-2xl border border-rose-100">{userMsg}</div>}
             <form onSubmit={handleCreateUser} className="space-y-6">
                <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Full Identity</label><input required className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} /></div>
                <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Username (Handle)</label><input required className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} /></div>
                <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">{newUser.id ? 'Update Passkey (Leave blank to keep current)' : 'Temporary Passkey'}</label><input required={!newUser.id} type="password" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} /></div>
                <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Role Classification</label><select className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500 appearance-none" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}><option value={UserRole.PHARMACIST}>Pharmacist</option><option value={UserRole.CASHIER}>Cashier</option><option value={UserRole.ADMIN}>Administrator</option></select></div>
                {infoForm.branches && infoForm.branches.length > 0 && (
                  <div className="space-y-1.5"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Branch</label><select className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-teal-500 appearance-none" value={newUser.branch} onChange={e => setNewUser({...newUser, branch: e.target.value})}><option value="">All Branches</option>{infoForm.branches.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                )}
                
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Permissions & Tasks</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                    {AVAILABLE_PERMISSIONS.map(p => (
                      <label key={p.id} className="flex items-center gap-3 p-3 border-2 border-slate-100 rounded-2xl cursor-pointer hover:bg-slate-50 transition-colors">
                        <input 
                          type="checkbox" 
                          checked={newUser.permissions?.includes(p.id) ?? false}
                          onChange={(e) => {
                            const curr = newUser.permissions || [];
                            if (e.target.checked) {
                              setNewUser({...newUser, permissions: [...curr, p.id]});
                            } else {
                              setNewUser({...newUser, permissions: curr.filter(x => x !== p.id)});
                            }
                          }}
                          className="hidden"
                        />
                        {newUser.permissions?.includes(p.id) ? <CheckSquare className="text-teal-500" size={18}/> : <Square className="text-slate-300" size={18}/>}
                        <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button type="submit" className="w-full bg-teal-600 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-teal-600/20 hover:bg-teal-700 transition-all flex justify-center items-center gap-3 active:scale-95">
                   {newUser.id ? <Save size={18}/> : <UserPlus size={18}/>} 
                   <span className="ml-2">{newUser.id ? 'Save Updates' : 'Authorize Access'}</span>
                </button>
             </form>
          </div>
        </div>
      )}
    </div>
  );
}