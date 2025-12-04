
import React, { useState, useEffect, useRef } from 'react';
import { processBatch } from '../services/adminService';
import { LANGUAGES } from '../constants';

interface AdminPanelProps {
  onBack: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ onBack }) => {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  const [serviceKey, setServiceKey] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  
  const [targetLang, setTargetLang] = useState('en'); // Default to English
  const [wordInput, setWordInput] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-fill env vars if available (except service key usually)
  useEffect(() => {
    // @ts-ignore
    const envUrl = import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    // @ts-ignore
    const envApi = import.meta.env.VITE_GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    
    if (envUrl) setSupabaseUrl(envUrl);
    if (envApi) setApiKey(envApi);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleLogin = () => {
    if (password === 'JLAPP2025@&') {
      setIsAuthenticated(true);
    } else {
      alert('Wrong Password');
    }
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg]);
  };

  const handleStart = async () => {
    if (!serviceKey) {
      alert("Please enter the Supabase Service Role Key");
      return;
    }
    const words = wordInput.split('\n').filter(w => w.trim().length > 0);
    if (words.length === 0) {
      alert("Please enter at least one word");
      return;
    }

    setIsProcessing(true);
    setLogs([`Started batch process for language: ${targetLang}...`]);
    
    await processBatch(words, serviceKey, apiKey, supabaseUrl, targetLang, addLog);
    
    setIsProcessing(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
          <h1 className="text-2xl font-black text-center mb-6">Admin Access</h1>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-3 mb-4"
          />
          <div className="flex gap-2">
            <button onClick={onBack} className="w-1/2 py-3 rounded-lg text-gray-500 font-bold">Back</button>
            <button onClick={handleLogin} className="w-1/2 bg-pop-purple text-white py-3 rounded-lg font-bold">Login</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-black text-gray-800">Database Factory 🏭</h1>
          <button onClick={onBack} className="px-4 py-2 bg-white rounded-lg shadow-sm font-bold text-gray-600">Exit</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Config & Input */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm">
              <h2 className="font-bold mb-4 text-gray-700">1. Credentials</h2>
              <div className="space-y-3">
                 <div>
                   <label className="text-xs font-bold text-gray-400">Supabase URL</label>
                   <input value={supabaseUrl} onChange={e => setSupabaseUrl(e.target.value)} className="w-full bg-gray-50 border p-2 rounded text-sm font-mono" />
                 </div>
                 <div>
                   <label className="text-xs font-bold text-gray-400">Gemini API Key</label>
                   <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full bg-gray-50 border p-2 rounded text-sm font-mono" />
                 </div>
                 <div>
                   <label className="text-xs font-bold text-red-400">Supabase Service Role Key (Required for writing)</label>
                   <input 
                     type="password" 
                     value={serviceKey} 
                     onChange={e => setServiceKey(e.target.value)} 
                     placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                     className="w-full bg-red-50 border border-red-100 p-2 rounded text-sm font-mono focus:border-red-400 outline-none" 
                   />
                 </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm">
              <h2 className="font-bold mb-4 text-gray-700">2. Configuration</h2>
              <div className="mb-4">
                 <label className="text-xs font-bold text-gray-400 block mb-1">Generate for Language (Target)</label>
                 <select 
                    value={targetLang} 
                    onChange={e => setTargetLang(e.target.value)}
                    className="w-full bg-gray-50 border p-2 rounded text-sm font-bold text-pop-purple"
                 >
                    {LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.name} {l.flag}</option>
                    ))}
                 </select>
              </div>

              <h2 className="font-bold mb-2 text-gray-700">3. Word List</h2>
              <textarea 
                value={wordInput}
                onChange={e => setWordInput(e.target.value)}
                placeholder="Paste words here, one per line...&#10;huis&#10;fiets&#10;kaas"
                className="w-full h-40 bg-gray-50 border p-3 rounded-lg font-mono text-sm resize-none focus:border-pop-purple outline-none"
              />
              <div className="mt-4 flex justify-between items-center">
                 <span className="text-xs text-gray-400">
                   {wordInput.split('\n').filter(w => w.trim()).length} words to process
                 </span>
                 <button 
                   onClick={handleStart}
                   disabled={isProcessing}
                   className={`px-6 py-3 rounded-xl font-bold text-white shadow-lg transition-transform ${isProcessing ? 'bg-gray-400 cursor-wait' : 'bg-pop-teal hover:scale-105'}`}
                 >
                   {isProcessing ? 'Processing...' : 'Start Factory'}
                 </button>
              </div>
            </div>
          </div>

          {/* Logs */}
          <div className="bg-gray-900 rounded-2xl p-6 shadow-xl flex flex-col h-[600px]">
            <h2 className="font-bold mb-4 text-gray-400 text-sm uppercase tracking-widest">Operation Log</h2>
            <div className="flex-1 overflow-y-auto font-mono text-xs text-green-400 space-y-1 p-2 bg-black/30 rounded-lg">
               {logs.length === 0 && <span className="opacity-30">Waiting to start...</span>}
               {logs.map((log, i) => (
                 <div key={i} className="break-all whitespace-pre-wrap">{log}</div>
               ))}
               <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
