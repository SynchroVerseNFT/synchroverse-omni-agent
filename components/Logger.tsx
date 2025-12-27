import React, { useEffect, useRef, useState } from 'react';
import { LogEntry } from '../types';

interface FilterState {
  system: boolean;
  user: boolean;
  model: boolean;
  tool: boolean;
}

const SentimentBadge: React.FC<{ sentiment?: LogEntry['sentiment'] }> = ({ sentiment }) => {
  if (!sentiment) return null;

  let colorClass = "bg-gray-700 text-gray-300";
  let label = sentiment.toUpperCase();
  let icon = "";

  switch (sentiment) {
    case 'positive':
      colorClass = "bg-green-500/20 text-green-400 border-green-500/30";
      icon = "😊";
      break;
    case 'negative':
      colorClass = "bg-red-500/20 text-red-400 border-red-500/30";
      icon = "🤬";
      break;
    case 'surprised':
      colorClass = "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      icon = "😲";
      break;
    case 'excited':
      colorClass = "bg-purple-500/20 text-purple-400 border-purple-500/30";
      icon = "🤩";
      break;
    case 'neutral':
      colorClass = "bg-gray-500/20 text-gray-400 border-gray-500/30";
      icon = "😐";
      break;
  }

  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colorClass} font-bold ml-2 flex items-center gap-1`}>
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
};

export const Logger: React.FC<{ logs: LogEntry[] }> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<FilterState>({
    system: true,
    user: true,
    model: true,
    tool: true
  });

  const toggleFilter = (key: keyof FilterState) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredLogs = logs.filter(log => filters[log.type]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length, filters]); // Scroll on new logs or filter change if appropriate

  return (
    <div className="h-full flex flex-col">
       {/* Filter Controls */}
       <div className="flex items-center gap-2 p-3 border-b border-white/10 bg-black/20 overflow-x-auto no-scrollbar">
          <span className="text-[10px] font-medium text-gray-500 uppercase mr-1">Filter:</span>
          
          <button 
             onClick={() => toggleFilter('system')}
             className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${filters.system ? 'bg-gray-700/50 text-gray-300 border-gray-600' : 'bg-transparent text-gray-600 border-gray-800 hover:border-gray-700'}`}
          >
            SYS
          </button>
          
          <button 
             onClick={() => toggleFilter('user')}
             className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${filters.user ? 'bg-green-900/30 text-green-400 border-green-800' : 'bg-transparent text-gray-600 border-gray-800 hover:border-gray-700'}`}
          >
            INPUT
          </button>
          
          <button 
             onClick={() => toggleFilter('model')}
             className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${filters.model ? 'bg-blue-900/30 text-gemini-blue border-blue-800' : 'bg-transparent text-gray-600 border-gray-800 hover:border-gray-700'}`}
          >
            AGENT
          </button>
          
          <button 
             onClick={() => toggleFilter('tool')}
             className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${filters.tool ? 'bg-amber-900/30 text-amber-400 border-amber-800' : 'bg-transparent text-gray-600 border-gray-800 hover:border-gray-700'}`}
          >
            TOOL
          </button>
       </div>

       {/* Log List */}
       <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
         {filteredLogs.map((log, i) => (
           <div key={i} className={`flex flex-col ${
             log.type === 'user' ? 'text-green-400' : 
             log.type === 'model' ? 'text-gemini-blue' : 
             log.type === 'tool' ? 'text-amber-400' : 'text-gray-500'
           }`}>
             <div className="flex items-center gap-2 opacity-70 mb-0.5">
                <span className="uppercase text-[10px] font-bold tracking-wider">
                  {log.type === 'model' ? 'AGENT' : (log.type === 'user' ? 'INPUT' : log.type)}
                </span>
                <span className="text-[10px] text-gray-600">
                  {log.timestamp.toLocaleTimeString([], { 
                    hour12: false, 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    second: '2-digit',
                    fractionalSecondDigits: 3 
                  })}
                </span>
                {/* Sentiment Badge */}
                {log.type === 'model' && log.sentiment && <SentimentBadge sentiment={log.sentiment} />}
             </div>
             <div className={`break-words p-2 rounded border ${
                log.type === 'system' ? 'bg-transparent border-transparent px-0 py-0 italic text-gray-600' : 'bg-white/5 border-white/5'
             }`}>
               {log.message}
               {log.data && (
                 <pre className="mt-2 p-2 bg-black/50 rounded overflow-x-auto text-[10px] text-gray-300">
                   {JSON.stringify(log.data, null, 2)}
                 </pre>
               )}
             </div>
           </div>
         ))}
         <div ref={endRef} />
       </div>
    </div>
  );
};