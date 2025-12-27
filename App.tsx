import React, { useState, useRef, useEffect } from 'react';
import { Type } from '@google/genai';
import { useLiveSession } from './hooks/useLiveSession';
import { Visualizer } from './components/Visualizer';
import { ToolsPanel } from './components/ToolsPanel';
import { Logger } from './components/Logger';
import { SettingsModal } from './components/SettingsModal';
import { LogEntry, ToolDefinition, VideoSourceType, StreamConfig } from './types';

export default function App() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'logs' | 'tools'>('logs');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // State for Text Injection
  const [textInput, setTextInput] = useState("");
  const [inputMode, setInputMode] = useState<'chat' | 'context'>('chat');
  
  // Updated default config with 'persona'
  const [config, setConfig] = useState<StreamConfig>({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    systemInstruction: 'You are a highly capable multi-modal AI assistant named "Omni".', // Base instruction, overridden by persona logic in hook
    voiceName: 'Kore',
    persona: 'watcher', // Defaulting to 'watcher' since the user is interested in screen sharing reactions
    useFirstGreeting: true,
    firstGreeting: "Yo! I'm ready. What are we watching?",
    enableDucking: true,
    commentaryInterval: 30, // Default 30s interval
    useCartesia: false,
    cartesiaApiKey: '',
    cartesiaVoiceId: ''
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoControlRef = useRef<(type: VideoSourceType) => Promise<void>>(null);
  const sessionControlRef = useRef<{ connect: () => Promise<void>; disconnect: () => Promise<void>; isConnected: boolean }>({
     connect: async () => {},
     disconnect: async () => {},
     isConnected: false
  });

  // Default Tools
  const [tools, setTools] = useState<ToolDefinition[]>([
    {
      declaration: {
        name: 'get_time',
        description: 'Returns the current time.',
        parameters: { type: Type.OBJECT, properties: {}, },
      },
      execute: () => ({ time: new Date().toLocaleTimeString() })
    },
    {
      declaration: {
        name: 'change_background',
        description: 'Changes the application background color style.',
        parameters: {
          type: Type.OBJECT,
          properties: {
             color: { type: Type.STRING, description: "A hex color or css color name" }
          },
          required: ['color']
        },
      },
      execute: ({ color }: { color: string }) => {
        document.body.style.backgroundColor = color;
        return { success: true, color };
      }
    },
    {
      declaration: {
        name: 'start_screenshare',
        description: 'Starts sharing the user\'s screen. Use this when the user asks you to look at their screen.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      execute: async () => {
        if (videoControlRef.current) {
          try {
             await videoControlRef.current(VideoSourceType.SCREEN);
             return { result: 'Screen sharing started' };
          } catch (e: any) {
             return { error: `Failed to start screen share: ${e.message}. Note: Browser may block programmatic screen sharing without user gesture.` };
          }
        }
        return { error: 'Video control not available' };
      }
    },
    {
      declaration: {
        name: 'change_voice',
        description: 'Changes the AI voice. Available voices: Kore, Puck, Charon, Fenrir, Zephyr. The session will restart to apply the change.',
        parameters: {
          type: Type.OBJECT,
          properties: {
             voice_name: { type: Type.STRING, description: "The name of the voice to switch to (e.g. Kore, Puck, Charon)." }
          },
          required: ['voice_name']
        },
      },
      execute: ({ voice_name }: { voice_name: string }) => {
        const validVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
        // Normalize input
        const normalized = voice_name.charAt(0).toUpperCase() + voice_name.slice(1).toLowerCase();
        
        if (validVoices.includes(normalized)) {
            setConfig(prev => ({ ...prev, voiceName: normalized }));
            return { success: true, message: `Voice preference updated to ${normalized}. Restarting session...` };
        }
        return { error: `Invalid voice name. Choose from: ${validVoices.join(', ')}` };
      }
    }
  ]);

  const handleLog = (entry: LogEntry) => {
    setLogs(prev => {
        const next = [...prev, entry];
        if (next.length > 100) {
            return next.slice(next.length - 100);
        }
        return next;
    });
  };

  const {
    isConnected,
    isMuted,
    isOutputMuted,
    isAiSpeaking,
    isScreenAudioShared,
    isScreenAudioMuted,
    volume,
    screenVolume,
    aiVolume,
    currentVideoSource,
    audioDevices,
    currentAudioDeviceId,
    connect,
    disconnect,
    setVideoSource,
    toggleMute,
    toggleOutputMute,
    toggleScreenAudio,
    changeAudioDevice,
    sendText
  } = useLiveSession({
    config,
    tools,
    onLog: handleLog,
    videoElementRef: videoRef
  });

  // Keep the ref in sync with the latest setVideoSource function
  useEffect(() => {
    // @ts-ignore
    videoControlRef.current = setVideoSource;
  }, [setVideoSource]);

  // Keep session control ref in sync for tool execution
  useEffect(() => {
    sessionControlRef.current = { connect, disconnect, isConnected };
  }, [connect, disconnect, isConnected]);

  // Auto-reconnect when voice or persona changes if already connected
  const prevVoiceRef = useRef(config.voiceName);
  const prevPersonaRef = useRef(config.persona);
  
  useEffect(() => {
      const voiceChanged = config.voiceName !== prevVoiceRef.current;
      const personaChanged = config.persona !== prevPersonaRef.current;

      if (voiceChanged || personaChanged) {
          prevVoiceRef.current = config.voiceName;
          prevPersonaRef.current = config.persona;
          
          if (isConnected) {
              const reason = voiceChanged ? `Voice changed to ${config.voiceName}` : `Persona changed to ${config.persona}`;
              handleLog({ timestamp: new Date(), type: 'system', message: `${reason}. Restarting session...` });
              // Small delay to allow the tool execution to return its response before we cut the connection
              setTimeout(async () => {
                  await disconnect();
                  setTimeout(() => connect(), 500);
              }, 1000);
          }
      }
  }, [config.voiceName, config.persona, isConnected, connect, disconnect]);

  const handlePoke = () => {
    sendText("[POKE] Look at the screen and comment immediately.");
  };

  const handleSendInput = (e: React.FormEvent) => {
    e.preventDefault();
    if(!textInput.trim()) return;
    
    if (inputMode === 'context') {
        sendText(`[CONTEXT] ${textInput}`);
    } else {
        sendText(textInput);
    }
    setTextInput("");
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-white font-sans overflow-hidden">
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        config={config} 
        onSave={setConfig} 
      />

      {/* Left Panel: Media & Controls */}
      <div className="flex-1 flex flex-col relative p-4 lg:p-6 gap-4">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            
            {/* Logo / Speaking Indicator */}
            <div className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 z-10 ${
                isAiSpeaking 
                  ? 'bg-white shadow-[0_0_30px_rgba(255,255,255,0.6)] scale-110 ring-4 ring-gemini-blue/20' 
                  : 'bg-gradient-to-tr from-gemini-blue to-gemini-purple shadow-lg'
            }`}>
              {/* Ripple effect when speaking */}
              {isAiSpeaking && (
                <span className="absolute inset-0 rounded-full bg-white/50 animate-ping"></span>
              )}
              
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 transition-colors duration-300 ${isAiSpeaking ? 'text-gemini-blue' : 'text-white'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>

            <h1 className="text-xl font-bold tracking-tight">Gemini <span className="text-transparent bg-clip-text bg-gradient-to-r from-gemini-blue to-gemini-purple">Live</span> Agent</h1>
          </div>
          
          <div className="flex items-center gap-3">
             {/* Speaking Text Indicator */}
             <div className={`transition-all duration-500 overflow-hidden flex items-center ${isAiSpeaking ? 'max-w-[100px] opacity-100' : 'max-w-0 opacity-0'}`}>
                <div className="flex items-center gap-1.5 px-2 border-r border-white/10 mr-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-gemini-blue animate-pulse"></span>
                  <span className="text-xs font-bold text-gemini-blue tracking-wider">SPEAKING</span>
                </div>
             </div>

             <div className={`px-3 py-1 rounded-full text-xs font-medium border ${isConnected ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-red-500/10 border-red-500/50 text-red-400'}`}>
                {isConnected ? 'LIVE' : 'OFFLINE'}
             </div>

             {/* Settings Button */}
             <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 rounded-full bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors border border-transparent hover:border-white/10"
                title="Settings"
             >
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
               </svg>
             </button>
          </div>
        </div>

        {/* Main Visual Area */}
        <div className={`flex-1 relative bg-[#151515] rounded-2xl border overflow-hidden shadow-2xl transition-all duration-500 ${
            currentVideoSource === VideoSourceType.CAMERA ? 'border-gemini-blue/50 shadow-[0_0_30px_rgba(77,170,252,0.15)]' :
            currentVideoSource === VideoSourceType.SCREEN ? 'border-gemini-purple/50 shadow-[0_0_30px_rgba(155,138,251,0.15)]' :
            'border-white/5'
        }`}>
           
           {/* Video Layer */}
           <video 
              ref={videoRef} 
              autoPlay 
              muted 
              className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-500 ${currentVideoSource !== VideoSourceType.NONE ? 'opacity-100' : 'opacity-0'}`}
           />

           {/* Fallback Visualizer when no video */}
           {currentVideoSource === VideoSourceType.NONE && (
              <div className="absolute inset-0 flex items-center justify-center p-12">
                 <Visualizer isActive={isConnected} micVolume={volume} screenVolume={screenVolume} />
              </div>
           )}

           {/* Status Overlay */}
           {currentVideoSource !== VideoSourceType.NONE && (
             <div className={`absolute top-4 left-4 px-4 py-2 rounded-full text-sm font-medium text-white border flex items-center gap-3 shadow-lg transition-all duration-300 ${
               currentVideoSource === VideoSourceType.CAMERA 
                 ? 'bg-gemini-blue/10 border-gemini-blue/20 backdrop-blur-md' 
                 : 'bg-gemini-purple/10 border-gemini-purple/20 backdrop-blur-md'
             }`}>
                <div className="relative flex h-3 w-3">
                   <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${currentVideoSource === VideoSourceType.CAMERA ? 'bg-gemini-blue' : 'bg-gemini-purple'}`}></span>
                   <span className={`relative inline-flex rounded-full h-3 w-3 ${currentVideoSource === VideoSourceType.CAMERA ? 'bg-gemini-blue' : 'bg-gemini-purple'}`}></span>
                </div>
                <div className="flex flex-col">
                   <span className="text-[10px] uppercase opacity-70 leading-none mb-0.5">Live Feed</span>
                   <span className="leading-none font-bold">
                       {currentVideoSource === VideoSourceType.CAMERA ? 'Webcam Source' : 'Screen Share'}
                   </span>
                </div>

                {/* Ducking Indicator */}
                {currentVideoSource === VideoSourceType.SCREEN && isScreenAudioShared && isAiSpeaking && (
                   <div className="ml-2 pl-3 border-l border-white/20 flex items-center gap-2 animate-pulse text-gemini-blue">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                      </svg>
                      <span className="text-[10px] font-bold tracking-wider uppercase">Ducking</span>
                   </div>
                )}
             </div>
           )}
        </div>

        {/* Control Bar */}
        <div className="h-20 bg-[#151515] rounded-2xl border border-white/5 flex items-center justify-center gap-4 px-6 relative overflow-hidden">
            {!isConnected ? (
              <button 
                onClick={connect}
                className="group relative px-8 py-3 bg-white text-black rounded-full font-bold hover:bg-gray-200 transition-all active:scale-95 flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-gemini-blue animate-pulse-fast"></span>
                Start Conversation
              </button>
            ) : (
              <>
                 <div className="flex items-center gap-2">
                    <button 
                      onClick={toggleMute}
                      className={`relative p-4 rounded-full transition-all overflow-hidden ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                      title={isMuted ? "Unmute Mic" : "Mute Mic"}
                    >
                      {/* Volume Indicator Overlay */}
                      {!isMuted && (
                          <div className="absolute bottom-0 left-0 w-full bg-green-500/30 transition-all duration-100 ease-out pointer-events-none"
                               style={{ height: `${Math.min(100, volume * 400)}%` }}
                          />
                      )}
                      
                      <div className="relative z-10">
                          {isMuted ? (
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" /></svg>
                          ) : (
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                          )}
                      </div>
                    </button>
                    
                    {/* Mic Selection */}
                    <div className="flex flex-col">
                        <select 
                            value={currentAudioDeviceId}
                            onChange={(e) => changeAudioDevice(e.target.value)}
                            className="bg-black/20 text-white text-[10px] py-1 px-2 rounded border border-white/10 outline-none hover:border-white/30 transition-colors w-32 truncate"
                        >
                            {audioDevices.length === 0 && <option value="">Default Mic</option>}
                            {audioDevices.map((device, idx) => (
                                <option key={device.deviceId || idx} value={device.deviceId} className="bg-dark-panel">
                                    {device.label || `Microphone ${idx + 1}`}
                                </option>
                            ))}
                        </select>
                    </div>
                 </div>

                 <div className="w-px h-8 bg-white/10 mx-2"></div>
                 
                 {/* Speaker Toggle */}
                 <button 
                   onClick={toggleOutputMute}
                   className={`p-4 rounded-full transition-all ${isOutputMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                   title={isOutputMuted ? "Unmute AI" : "Mute AI"}
                 >
                   {isOutputMuted ? (
                     <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                   ) : (
                     <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        {/* Cartesia Indicator */}
                        {config.useCartesia && (
                          <span className="absolute top-2 right-2 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                          </span>
                        )}
                     </svg>
                   )}
                 </button>

                 <div className="w-px h-8 bg-white/10 mx-2"></div>

                 <button 
                   onClick={() => setVideoSource(currentVideoSource === VideoSourceType.CAMERA ? VideoSourceType.NONE : VideoSourceType.CAMERA)}
                   className={`p-4 rounded-full transition-all ${currentVideoSource === VideoSourceType.CAMERA ? 'bg-gemini-blue text-black shadow-[0_0_20px_rgba(77,170,252,0.4)]' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                   title="Toggle Webcam"
                 >
                   <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                 </button>

                 <button 
                   onClick={() => setVideoSource(currentVideoSource === VideoSourceType.SCREEN ? VideoSourceType.NONE : VideoSourceType.SCREEN)}
                   className={`relative p-4 rounded-full transition-all overflow-hidden ${currentVideoSource === VideoSourceType.SCREEN ? 'bg-gemini-purple text-black shadow-[0_0_20px_rgba(155,138,251,0.4)]' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                   title="Share Screen"
                 >
                   {/* Screen Volume Indicator Overlay */}
                   {screenVolume > 0 && currentVideoSource === VideoSourceType.SCREEN && (
                       <div className="absolute bottom-0 left-0 w-full bg-green-500/30 transition-all duration-100 ease-out pointer-events-none"
                            style={{ height: `${Math.min(100, screenVolume * 400)}%` }}
                       />
                   )}
                   <div className="relative z-10">
                       <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                   </div>
                 </button>

                 {/* Screen Audio Mute Toggle - Only shows when screen sharing has audio */}
                 {currentVideoSource === VideoSourceType.SCREEN && isScreenAudioShared && (
                   <button 
                     onClick={toggleScreenAudio}
                     className={`p-4 ml-2 rounded-full transition-all ${isScreenAudioMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                     title={isScreenAudioMuted ? "Unmute Screen Audio" : "Mute Screen Audio"}
                   >
                     {isScreenAudioMuted ? (
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                     ) : (
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                     )}
                   </button>
                 )}

                 <div className="w-px h-8 bg-white/10 mx-2"></div>

                 <button 
                   onClick={disconnect}
                   className="px-6 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-full text-sm font-semibold transition-colors border border-red-500/20"
                 >
                   Disconnect
                 </button>
              </>
            )}
        </div>
      </div>

      {/* Right Panel: Tools & Logs */}
      <div className="w-96 border-l border-white/5 bg-[#0f0f0f] flex flex-col">
        <div className="flex border-b border-white/5">
           <button 
              onClick={() => setActiveTab('logs')}
              className={`flex-1 py-4 text-sm font-medium transition-colors ${activeTab === 'logs' ? 'text-gemini-blue border-b-2 border-gemini-blue' : 'text-gray-500 hover:text-gray-300'}`}
           >
             Activity Log
           </button>
           <button 
              onClick={() => setActiveTab('tools')}
              className={`flex-1 py-4 text-sm font-medium transition-colors ${activeTab === 'tools' ? 'text-gemini-purple border-b-2 border-gemini-purple' : 'text-gray-500 hover:text-gray-300'}`}
           >
             MCP Tools
           </button>
        </div>

        <div className="flex-1 overflow-hidden relative flex flex-col">
          {activeTab === 'logs' ? (
             <div className="flex-1 flex flex-col overflow-hidden">
                 <Logger logs={logs} />
                 
                 {/* Interventions Area */}
                 {isConnected && (
                   <div className="p-4 border-t border-white/10 bg-black/20 space-y-3">
                      <div className="flex items-center justify-between">
                          <h4 className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Interactions</h4>
                          <div className="flex bg-black/40 rounded p-0.5 border border-white/5">
                             <button 
                                onClick={() => setInputMode('chat')}
                                className={`text-[10px] px-2 py-0.5 rounded transition-all ${inputMode === 'chat' ? 'bg-gemini-blue/20 text-gemini-blue font-bold shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                             >
                               Chat
                             </button>
                             <button 
                                onClick={() => setInputMode('context')}
                                className={`text-[10px] px-2 py-0.5 rounded transition-all ${inputMode === 'context' ? 'bg-white/10 text-white font-bold shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                             >
                               Context
                             </button>
                          </div>
                      </div>

                      <div className="flex gap-2">
                         <button 
                           onClick={handlePoke}
                           className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs py-2 rounded border border-white/10 transition-colors flex items-center justify-center gap-2"
                         >
                            <span className="w-1.5 h-1.5 bg-gemini-blue rounded-full"></span>
                            Poke (Force Reply)
                         </button>
                      </div>
                      <form onSubmit={handleSendInput} className="flex gap-2">
                         <input 
                           type="text" 
                           value={textInput}
                           onChange={(e) => setTextInput(e.target.value)}
                           placeholder={inputMode === 'chat' ? "Message the model..." : "Inject silent context..."}
                           className={`flex-1 bg-black/40 border rounded px-2 py-1.5 text-xs text-white outline-none transition-colors ${
                              inputMode === 'chat' ? 'border-gemini-blue/30 focus:border-gemini-blue/60' : 'border-white/10 focus:border-white/30'
                           }`}
                         />
                         <button 
                           type="submit"
                           disabled={!textInput.trim()}
                           className={`px-3 rounded border transition-all ${
                              inputMode === 'chat' 
                                ? 'bg-gemini-blue/20 hover:bg-gemini-blue/30 text-gemini-blue border-gemini-blue/30' 
                                : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                           } disabled:opacity-50`}
                         >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                            </svg>
                         </button>
                      </form>
                   </div>
                 )}
             </div>
          ) : (
             <ToolsPanel tools={tools} addTool={(t) => setTools(prev => [...prev, t])} />
          )}
        </div>
        
        {activeTab === 'logs' && (
           <div className="p-2 border-t border-white/5 text-[10px] text-gray-600 text-center font-mono">
             Gemini 2.5 Flash Native Audio Preview
           </div>
        )}
      </div>

    </div>
  );
}