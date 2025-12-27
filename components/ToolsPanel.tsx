import React from 'react';
import { Type } from '@google/genai';
import { ToolDefinition } from '../types';

interface ToolsPanelProps {
  tools: ToolDefinition[];
  addTool: (tool: ToolDefinition) => void;
}

export const ToolsPanel: React.FC<ToolsPanelProps> = ({ tools, addTool }) => {
  const addExampleTool = () => {
    const newTool: ToolDefinition = {
      declaration: {
        name: `custom_alert_${Math.floor(Math.random() * 1000)}`,
        description: "Shows an alert to the user on their screen.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            message: {
              type: Type.STRING,
              description: "The message to display in the alert."
            }
          },
          required: ["message"]
        }
      },
      execute: (args: { message: string }) => {
        alert(`AI Says: ${args.message}`);
        return { success: true };
      }
    };
    addTool(newTool);
  };

  return (
    <div className="p-4 bg-dark-panel rounded-xl border border-white/10 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Active Tools</h3>
        <button 
          onClick={addExampleTool}
          className="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-gemini-blue transition-colors"
        >
          + Add Demo Tool
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-2">
        {tools.map((tool, idx) => (
          <div key={idx} className="p-3 bg-black/40 rounded-lg border border-white/5 group hover:border-gemini-blue/30 transition-all">
            <div className="flex justify-between items-start">
              <span className="font-mono text-sm text-gemini-purple">{tool.declaration.name}</span>
              <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-gray-400">FUNC</span>
            </div>
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{tool.declaration.description}</p>
          </div>
        ))}
        {tools.length === 0 && (
          <div className="text-center text-gray-600 text-xs italic mt-10">
            No tools registered. <br/> The AI can't do anything yet.
          </div>
        )}
      </div>
    </div>
  );
};
