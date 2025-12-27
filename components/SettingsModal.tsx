import React, { useState, useEffect } from 'react';
import { StreamConfig, CartesiaVoice } from '../types';
import { PERSONAS } from '../utils/personas';
import { fetchCartesiaVoices } from '../utils/cartesiaClient';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StreamConfig;
  onSave: (newConfig: StreamConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<StreamConfig>(config);
  const [voices, setVoices] = useState<CartesiaVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLocalConfig(config);
      // Attempt to load voices if key exists and we haven't loaded them yet
      if (config.cartesiaApiKey && voices.length === 0) {
        handleFetchVoices(config.cartesiaApiKey);
      }
    }
  }, [isOpen, config]);

  const handleFetchVoices = async (apiKey: string) => {
    if (!apiKey) return;
    setIsLoadingVoices(true);
    setVoiceError(null);
    try {
      const fetchedVoices = await fetchCartesiaVoices(apiKey);
      setVoices(fetchedVoices);
    } catch (e: any) {
      setVoiceError(e.message || "Failed to load voices");
    } finally {
      setIsLoadingVoices(false);
    }
  };

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(localConfig);
    onClose();
  };

  const activePersona = PERSONAS.find(p => p.id === localConfig.persona);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-[#1e1e1e] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">Session Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-6">
          
          {/* Persona Selection */}
          <div className="space-y-3">
             <label className="text-sm font-medium text-gray-300">Agent Persona</label>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PERSONAS.map(p => (
                   <button
                     key={p.id}
                     onClick={() => setLocalConfig(prev => ({ ...prev, persona: p.id }))}
                     className={`p-3 rounded-lg border text-left transition-all ${
                        localConfig.persona === p.id 
                           ? 'bg-gemini-blue/10 border-gemini-blue text-white ring-1 ring-gemini-blue'
                           : 'bg-white/5 border-transparent hover:bg-white/10 text-gray-300'
                     }`}
                   >
                      <div className={`font-semibold text-sm ${localConfig.persona === p.id ? 'text-gemini-blue' : 'text-white'}`}>{p.name}</div>
                      <div className="text-xs text-gray-500 mt-1 leading-snug">{p.description}</div>
                   </button>
                ))}
             </div>
             
             {/* Read-only Instruction Display */}
             {activePersona && (
               <div className="mt-2 p-3 bg-black/30 rounded border border-white/5">
                 <div className="text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Active Persona Instructions</div>
                 <div className="text-xs font-mono text-gray-400 whitespace-pre-wrap leading-relaxed h-32 overflow-y-auto custom-scrollbar">
                    {activePersona.instruction}
                 </div>
               </div>
             )}
          </div>

          {/* System Instruction Override */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Additional Instructions (Append)</label>
            <textarea
              value={localConfig.systemInstruction}
              onChange={(e) => setLocalConfig(prev => ({ ...prev, systemInstruction: e.target.value }))}
              className="w-full h-20 bg-black/30 border border-white/10 rounded-lg p-4 text-sm text-white focus:border-gemini-blue focus:ring-1 focus:ring-gemini-blue outline-none resize-none font-mono leading-relaxed"
              placeholder="Enter specific instructions to append to the active persona..."
            />
          </div>
          
          {/* Text-to-Speech Settings (Cartesia) */}
          <div className="space-y-4 bg-gradient-to-r from-purple-900/20 to-blue-900/20 p-4 rounded-lg border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-bold text-white flex items-center gap-2">
                   Cartesia TTS 
                   <span className="px-1.5 py-0.5 rounded bg-purple-500 text-[10px] text-white">BETA</span>
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  Replace Gemini's voice with Cartesia's low-latency Sonic model.
                </p>
              </div>
              <button 
                onClick={() => setLocalConfig(prev => ({ ...prev, useCartesia: !prev.useCartesia }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${localConfig.useCartesia ? 'bg-purple-500' : 'bg-gray-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localConfig.useCartesia ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            
            {localConfig.useCartesia && (
              <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-top-2">
                 <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500">Cartesia API Key</label>
                    <div className="flex gap-2">
                      <input 
                        type="password"
                        value={localConfig.cartesiaApiKey || ''}
                        onChange={(e) => setLocalConfig(prev => ({ ...prev, cartesiaApiKey: e.target.value }))}
                        placeholder="sk-car-..."
                        className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-purple-500"
                      />
                      <button 
                        onClick={() => handleFetchVoices(localConfig.cartesiaApiKey || '')}
                        disabled={isLoadingVoices || !localConfig.cartesiaApiKey}
                        className="px-3 py-2 bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 rounded text-xs font-bold transition-colors disabled:opacity-50"
                      >
                         {isLoadingVoices ? 'Loading...' : 'Refresh Voices'}
                      </button>
                    </div>
                 </div>

                 {voiceError && (
                   <div className="text-[10px] text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">
                     {voiceError}
                   </div>
                 )}
                 
                 <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500">Voice Selection</label>
                    <div className="relative">
                      <select 
                        value={localConfig.cartesiaVoiceId || ''}
                        onChange={(e) => setLocalConfig(prev => ({ ...prev, cartesiaVoiceId: e.target.value }))}
                        className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-purple-500 appearance-none"
                        disabled={voices.length === 0}
                      >
                        <option value="" disabled>
                           {voices.length > 0 ? "Select a voice..." : "Enter API Key and click Refresh to load voices"}
                        </option>
                        {voices.map(voice => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name} ({voice.description || 'No description'})
                          </option>
                        ))}
                        {/* If current ID is set but not in list (e.g. custom/private voice), allow keeping it */}
                        {localConfig.cartesiaVoiceId && !voices.find(v => v.id === localConfig.cartesiaVoiceId) && (
                           <option value={localConfig.cartesiaVoiceId}>{localConfig.cartesiaVoiceId} (Custom ID)</option>
                        )}
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                      </div>
                    </div>
                 </div>

                 {/* Manual Fallback if list fails */}
                 {(!voices.length && !isLoadingVoices) && (
                   <div className="space-y-1 pt-2 border-t border-white/5">
                      <label className="text-[10px] uppercase font-bold text-gray-500">Or Enter Voice ID Manually</label>
                      <input
                        type="text"
                        value={localConfig.cartesiaVoiceId || ''}
                        onChange={(e) => setLocalConfig(prev => ({ ...prev, cartesiaVoiceId: e.target.value }))}
                        placeholder="e.g. a0e99841..."
                        className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-purple-500"
                      />
                   </div>
                 )}

                 {/* Cost Optimized Mode Toggle */}
                 <div className="pt-3 mt-3 border-t border-white/10">
                   <div className="flex items-center justify-between">
                     <div>
                       <label className="text-xs font-bold text-white flex items-center gap-2">
                         Cost Optimized Mode
                         <span className="px-1.5 py-0.5 rounded bg-green-500 text-[10px] text-white">SAVES 44%</span>
                       </label>
                       <p className="text-[10px] text-gray-400 mt-1">
                         Use Gemini TEXT output ($2/1M) instead of AUDIO ($12/1M). Adds ~100-200ms latency.
                       </p>
                     </div>
                     <button
                       onClick={() => setLocalConfig(prev => ({ ...prev, useTextMode: !prev.useTextMode }))}
                       className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${localConfig.useTextMode ? 'bg-green-500' : 'bg-gray-700'}`}
                     >
                       <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localConfig.useTextMode ? 'translate-x-6' : 'translate-x-1'}`} />
                     </button>
                   </div>
                 </div>
              </div>
            )}
          </div>

          {/* Commentary Pacing */}
          <div className="space-y-3 bg-white/5 p-4 rounded-lg border border-white/5">
             <div className="flex justify-between items-center">
               <label className="text-sm font-medium text-gray-300">Commentary Pacing</label>
               <span className="text-xs font-mono text-gemini-blue bg-gemini-blue/10 px-2 py-0.5 rounded border border-gemini-blue/20">
                  Every {localConfig.commentaryInterval}s
               </span>
             </div>
             <input 
               type="range"
               min="10"
               max="120"
               step="5"
               value={localConfig.commentaryInterval}
               onChange={(e) => setLocalConfig(prev => ({ ...prev, commentaryInterval: parseInt(e.target.value) }))}
               className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-gemini-blue"
             />
             <p className="text-[10px] text-gray-500">
               How often the agent should proactively check the visual feed and comment (only active during video/screen sharing).
             </p>
          </div>

          {/* First Greeting Settings */}
          <div className="space-y-3 bg-white/5 p-4 rounded-lg border border-white/5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-300">First Greeting</label>
              <button 
                onClick={() => setLocalConfig(prev => ({ ...prev, useFirstGreeting: !prev.useFirstGreeting }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${localConfig.useFirstGreeting ? 'bg-gemini-blue' : 'bg-gray-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localConfig.useFirstGreeting ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            
            {localConfig.useFirstGreeting && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                 <textarea
                    value={localConfig.firstGreeting || ''}
                    onChange={(e) => setLocalConfig(prev => ({ ...prev, firstGreeting: e.target.value }))}
                    className="w-full h-20 bg-black/30 border border-white/10 rounded-lg p-3 text-sm text-white focus:border-gemini-blue focus:ring-1 focus:ring-gemini-blue outline-none resize-none"
                    placeholder="E.g. Hello! I'm Omni. How can I help you today?"
                 />
                 <p className="text-xs text-gray-500 mt-1">
                   The AI will say this immediately upon connecting.
                 </p>
              </div>
            )}
          </div>
          
          {/* Audio Ducking Toggle */}
           <div className="space-y-3 bg-white/5 p-4 rounded-lg border border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-300">Audio Ducking</label>
                <p className="text-xs text-gray-500 mt-1">
                  Automatically lower screen audio volume when the AI is speaking.
                </p>
              </div>
              <button 
                onClick={() => setLocalConfig(prev => ({ ...prev, enableDucking: !prev.enableDucking }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${localConfig.enableDucking ? 'bg-gemini-blue' : 'bg-gray-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localConfig.enableDucking ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {/* Voice Selection - Hidden if Cartesia is on */}
          {!localConfig.useCartesia && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Native Gemini Voice</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map(voice => (
                  <button
                    key={voice}
                    onClick={() => setLocalConfig(prev => ({ ...prev, voiceName: voice }))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      localConfig.voiceName === voice 
                        ? 'bg-gemini-blue text-black shadow-lg shadow-gemini-blue/20' 
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {voice}
                  </button>
                ))}
              </div>
            </div>
          )}
          
        </div>

        <div className="p-6 border-t border-white/10 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="px-6 py-2 rounded-lg text-sm font-bold bg-white text-black hover:bg-gray-200 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};