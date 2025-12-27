import { CartesiaVoice } from "../types";

export async function fetchCartesiaVoices(apiKey: string): Promise<CartesiaVoice[]> {
  const response = await fetch("https://api.cartesia.ai/voices", {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voices: ${response.statusText}`);
  }

  const data = await response.json();
  return data as CartesiaVoice[];
}

export class CartesiaClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private voiceId: string;
  private onAudioCallback: (audioData: Float32Array) => void;
  private contextId: string;
  private isConnected: boolean = false;
  private isFlushing: boolean = false;

  constructor(apiKey: string, voiceId: string, onAudioCallback: (data: Float32Array) => void) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.onAudioCallback = onAudioCallback;
    this.contextId = this.generateContextId();
  }

  private generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Using the Cartesia WebSocket URL
      this.ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?api_key=${this.apiKey}&cartesia_version=2024-06-10`);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.isConnected = true;
        resolve();
      };

      this.ws.onerror = (err) => {
        console.error("Cartesia WS Error", err);
        reject(err);
      };

      this.ws.onmessage = (event) => {
        const data = event.data;
        if (typeof data === 'string') {
          const json = JSON.parse(data);
          if (json.audio) {
            // Determine encoding and convert
            // Usually Cartesia sends raw base64 in the JSON for 'audio' field
            // But if we requested raw bytes, it might come differently.
            // Let's assume standard JSON response for now based on docs.
            const binaryString = atob(json.audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            // Convert raw PCM bytes (assuming f32le) to Float32Array
            const float32 = new Float32Array(bytes.buffer);
            this.onAudioCallback(float32);
          }
        }
      };
    });
  }

  send(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.isFlushing) return; // Don't send while flushing

    const payload = {
      model_id: "sonic-english",
      transcript: text,
      voice: {
        mode: "id",
        id: this.voiceId
      },
      output_format: {
        container: "raw",
        encoding: "pcm_f32le",
        sample_rate: 44100 // Requesting high quality
      },
      context_id: this.contextId,
      continue: true // Streaming mode
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Flush/cancel current TTS generation.
   * This is called when the user interrupts the AI mid-speech.
   * We reset the context_id to start fresh for the next response.
   */
  flush() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.isFlushing = true;

    // Send cancel command for current context
    const cancelPayload = {
      context_id: this.contextId,
      cancel: true
    };

    try {
      this.ws.send(JSON.stringify(cancelPayload));
    } catch (e) {
      console.error("Failed to send cancel to Cartesia:", e);
    }

    // Generate new context for next generation
    this.contextId = this.generateContextId();

    // Allow sending again after a brief delay
    setTimeout(() => {
      this.isFlushing = false;
    }, 50);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isFlushing = false;
  }
}