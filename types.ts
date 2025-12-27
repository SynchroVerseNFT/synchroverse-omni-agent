import { FunctionDeclaration, Tool } from "@google/genai";

export interface LogEntry {
  timestamp: Date;
  type: 'user' | 'model' | 'tool' | 'system';
  message: string;
  data?: any;
  sentiment?: 'positive' | 'negative' | 'neutral' | 'surprised' | 'excited';
}

export interface ToolDefinition {
  declaration: FunctionDeclaration;
  execute: (args: any) => Promise<any> | any;
}

export interface StreamConfig {
  model: string;
  systemInstruction: string;
  voiceName: string;
  persona: string;
  useFirstGreeting?: boolean;
  firstGreeting?: string;
  enableDucking?: boolean;
  commentaryInterval: number; // Interval in seconds for auto-pokes
  // Cartesia Config
  useCartesia?: boolean;
  cartesiaApiKey?: string;
  cartesiaVoiceId?: string;
  // Cost Optimization: Use TEXT mode output instead of AUDIO
  // When enabled with Cartesia, Gemini outputs text ($2/1M) instead of audio ($12/1M)
  // This is 44% cheaper overall but adds ~100-200ms latency
  useTextMode?: boolean;
}

export interface CartesiaVoice {
  id: string;
  name: string;
  description: string;
  is_public: boolean;
  language: string;
}

export enum VideoSourceType {
  NONE = 'none',
  CAMERA = 'camera',
  SCREEN = 'screen'
}