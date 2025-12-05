
import React, { useState, useEffect, useRef } from 'react';
import { processBatch, BatchConfig } from '../services/adminService';
import { LANGUAGES } from '../constants';
import { ImageStyle } from '../types';

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

  // New Configuration States
  const [tasks, setTasks] = useState({
    text: true,
    image: true,
    audioWord: true,
    audioEx1: true,
    audioEx2: true
  });
  const [selectedStyle, setSelectedStyle] = useState<ImageStyle>('ghibli');

  const styles: ImageStyle[] = ['flat', 'cartoon', 'ghibli', 'watercolor', 'pixel', 'realistic'];

  // Auto-fill env vars
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
    
    // Check if any task is selected
    const anyAudio = tasks.audioWord || tasks.audioEx1 || tasks.audioEx2;
    if (!tasks.text && !tasks.image && !anyAudio) {
      alert("Please select at least one task.");
      return;
    }

    setIsProcessing(true);
    setLogs([`🚀 Started batch process for ${words.length} words...`]);
    
    const config: BatchConfig = {
      tasks,
      imageStyle: selectedStyle
    };

    await processBatch(words, serviceKey, apiKey, supabaseUrl, targetLang, config, addLog);
    
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
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-black text-gray-800">Database Factory 🏭</h1>
          <button onClick={onBack} className="px-4 py-2 bg-white rounded-lg shadow-sm font-bold text-gray-600">Exit</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Config Column */}
          <div className="space-y-6">
            
            {/* 1. Credentials */}
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
                   <label className="text-xs font-bold text-red-400">Supabase Service Role Key (Required)</label>
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

            {/* 2. Task Configuration */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border-2 border-pop-purple/10">
              <h2 className="font-bold mb-4 text-gray-700">2. Task Configuration</h2>
              
              <div className="mb-6">
                 <label className="text-xs font-bold text-gray-400 block mb-2">Target Language (Definitions)</label>
                 <select 
                    value={targetLang} 
                    onChange={e => setTargetLang(e.target.value)}
                    className="w-full bg-gray-50 border p-2 rounded-lg text-sm font-bold text-pop-purple"
                 >
                    {LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.name} {l.flag}</option>
                    ))}
                 </select>
              </div>

              <div className="space-y-4 mb-6">
                <label className="text-xs font-bold text-gray-400 block">Select Operations:</label>
                
                <label className="flex items-center p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={tasks.text} 
                    onChange={e => setTasks(p => ({...p, text: e.target.checked}))}
                    className="w-5 h-5 text-pop-purple rounded focus:ring-pop-purple mr-3"
                  />
                  <div>
                    <span className="font-bold text-gray-700 block">A. Text Content</span>
                    <span className="text-xs text-gray-400">Definition, Grammar, Examples (Gemini 2.5 Flash)</span>
                  </div>
                </label>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <label className="flex items-center cursor-pointer mb-3">
                    <input 
                      type="checkbox" 
                      checked={tasks.image} 
                      onChange={e => setTasks(p => ({...p, image: e.target.checked}))}
                      className="w-5 h-5 text-pop-purple rounded focus:ring-pop-purple mr-3"
                    />
                    <div>
                      <span className="font-bold text-gray-700 block">B. Images</span>
                      <span className="text-xs text-gray-400">Gemini 3 Pro Image</span>
                    </div>
                  </label>
                  
                  {tasks.image && (
                    <div className="ml-8 mt-2 animate-fade-in">
                       <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Image Style</label>
                       <select 
                          value={selectedStyle} 
                          onChange={e => setSelectedStyle(e.target.value as ImageStyle)}
                          className="w-full text-sm border-gray-200 rounded-lg p-2"
                       >
                         {styles.map(s => (
                           <option key={s} value={s}>
                             {s === 'ghibli' ? 'Healing Anime' : s.charAt(0).toUpperCase() + s.slice(1)}
                           </option>
                         ))}
                       </select>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="mb-2">
                    <span className="font-bold text-gray-700 block">C. Audio (TTS)</span>
                    <span className="text-xs text-gray-400">Select which parts to generate:</span>
                  </div>
                  
                  <div className="pl-2 space-y-2">
                     <label className="flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={tasks.audioWord} 
                          onChange={e => setTasks(p => ({...p, audioWord: e.target.checked}))}
                          className="w-4 h-4 text-pop-teal rounded focus:ring-pop-teal mr-2"
                        />
                        <span className="text-sm text-gray-600">Word Pronunciation</span>
                     </label>
                     <label className="flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={tasks.audioEx1} 
                          onChange={e => setTasks(p => ({...p, audioEx1: e.target.checked}))}
                          className="w-4 h-4 text-pop-teal rounded focus:ring-pop-teal mr-2"
                        />
                        <span className="text-sm text-gray-600">Example 1</span>
                     </label>
                     <label className="flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={tasks.audioEx2} 
                          onChange={e => setTasks(p => ({...p, audioEx2: e.target.checked}))}
                          className="w-4 h-4 text-pop-teal rounded focus:ring-pop-teal mr-2"
                        />
                        <span className="text-sm text-gray-600">Example 2</span>
                     </label>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Word List & Action */}
            <div className="bg-white p-6 rounded-2xl shadow-sm">
              <h2 className="font-bold mb-2 text-gray-700">3. Word List</h2>
              <textarea 
                value={wordInput}
                onChange={e => setWordInput(e.target.value)}
                placeholder="Paste words here, one per line...&#10;huis&#10;fiets&#10;kaas"
                className="w-full h-40 bg-gray-50 border p-3 rounded-lg font-mono text-sm resize-none focus:border-pop-purple outline-none"
              />
              <div className="mt-4 flex justify-between items-center">
                 <span className="text-xs text-gray-400">
                   {wordInput.split('\n').filter(w => w.trim()).length} words
                 </span>
                 <button 
                   onClick={handleStart}
                   disabled={isProcessing}
                   className={`px-6 py-3 rounded-xl font-bold text-white shadow-lg transition-transform ${isProcessing ? 'bg-gray-400 cursor-wait' : 'bg-pop-teal hover:scale-105'}`}
                 >
                   {isProcessing ? 'Processing...' : 'Start Batch'}
                 </button>
              </div>
            </div>
          </div>

          {/* Logs Column */}
          <div className="bg-gray-900 rounded-2xl p-6 shadow-xl flex flex-col h-[600px] lg:h-auto lg:min-h-full">
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
