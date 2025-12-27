import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array, PCM_SAMPLE_RATE } from '../utils/audioUtils';
import { LogEntry, ToolDefinition, StreamConfig, VideoSourceType } from '../types';
import { getPersona } from '../utils/personas';
import { CartesiaClient } from '../utils/cartesiaClient';

interface UseLiveSessionProps {
  config: StreamConfig;
  tools: ToolDefinition[];
  onLog: (entry: LogEntry) => void;
  videoElementRef: React.RefObject<HTMLVideoElement>;
}

export const useLiveSession = ({ config, tools, onLog, videoElementRef }: UseLiveSessionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isOutputMuted, setIsOutputMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isScreenAudioShared, setIsScreenAudioShared] = useState(false);
  const [isScreenAudioMuted, setIsScreenAudioMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [screenVolume, setScreenVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0); // Volume for AI Speech
  const [currentVideoSource, setCurrentVideoSource] = useState<VideoSourceType>(VideoSourceType.NONE);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentAudioDeviceId, setCurrentAudioDeviceId] = useState<string>("");
  
  // Refs for audio context and processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null); // Controls Mic Volume/Mute
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  // Screen Audio Refs
  const screenAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const screenAnalyserRef = useRef<AnalyserNode | null>(null);
  const screenMuteGainNodeRef = useRef<GainNode | null>(null); // Controls manual screen mute
  const screenFadeGainNodeRef = useRef<GainNode | null>(null); // Controls ducking

  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null); // Analyser for AI output

  const nextStartTimeRef = useRef<number>(0);
  // Track all currently playing nodes so we can stop them on interruption
  const activeAudioNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const sessionRef = useRef<LiveSession | null>(null);
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const volumeIntervalRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null); // For Audio Input
  const videoStreamRef = useRef<MediaStream | null>(null); // For Video Input (Camera/Screen)
  
  // Cartesia Ref
  const cartesiaClientRef = useRef<CartesiaClient | null>(null);

  // Track active AI audio sources to manage ducking
  const activeAiSourcesRef = useRef<number>(0);
  const duckingTimeoutRef = useRef<number | null>(null);
  const isDuckingRef = useRef<boolean>(false);
  
  // Accumulate transcription text
  const modelTranscriptionRef = useRef<string>("");
  const userTranscriptionRef = useRef<string>("");
  const turnStartTimeRef = useRef<Date | null>(null);

  // Keep track of config to allow real-time toggles (like ducking)
  const configRef = useRef(config);
  
  // Ref for screen mute state to access in callbacks
  const isScreenAudioMutedRef = useRef(isScreenAudioMuted);
  
  // Ref for tracking AI speaking state inside interval
  const isAiSpeakingRef = useRef(false);

  useEffect(() => {
    isScreenAudioMutedRef.current = isScreenAudioMuted;
  }, [isScreenAudioMuted]);
  
  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
  }, [isAiSpeaking]);

  // Initialize Audio Contexts
  const initAudioContexts = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: PCM_SAMPLE_RATE,
      });
    }
    if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
    }

    if (!outputContextRef.current) {
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000, 
      });
      outputGainRef.current = outputContextRef.current.createGain();
      
      // Setup Output Analyser
      const analyser = outputContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      outputAnalyserRef.current = analyser;

      outputGainRef.current.connect(analyser);
      analyser.connect(outputContextRef.current.destination);
    }
  };

  // Manage Ducking: Lowers screen audio when AI is speaking
  const updateDucking = useCallback(() => {
    const isSpeaking = activeAiSourcesRef.current > 0;
    
    // Clear any pending unduck timer
    if (duckingTimeoutRef.current) {
        clearTimeout(duckingTimeoutRef.current);
        duckingTimeoutRef.current = null;
    }

    const applyDucking = (shouldDuck: boolean) => {
         if (!screenFadeGainNodeRef.current || !audioContextRef.current) return;
         
         const ctx = audioContextRef.current;
         const enabled = configRef.current.enableDucking ?? true;
         // Target gain: 0.05 when ducking, 1.0 normally.
         const targetGain = (shouldDuck && enabled) ? 0.05 : 1.0; 
         
         screenFadeGainNodeRef.current.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.2);
         
         setIsAiSpeaking(shouldDuck);
         
         // Log state change for debugging
         if (shouldDuck !== isDuckingRef.current) {
             isDuckingRef.current = shouldDuck;
             if (enabled && isScreenAudioShared) {
                 onLog({ 
                     timestamp: new Date(), 
                     type: 'system', 
                     message: shouldDuck ? 'Audio Ducking Active (Screen Lowered)' : 'Audio Ducking Inactive' 
                 });
             }
         }
    };

    if (isSpeaking) {
        // Immediate Duck
        applyDucking(true);
    } else {
        // Delayed Unduck (Hold time) to prevent pumping
        // 600ms hold time
        duckingTimeoutRef.current = setTimeout(() => {
            applyDucking(false);
        }, 600);
    }

  }, [isScreenAudioShared, onLog]); // Dependencies

  // Update config ref and apply ducking change immediately when config changes
  useEffect(() => {
    configRef.current = config;
    // Force update ducking state based on new config
    updateDucking();
  }, [config, updateDucking]);

  // Safer Text Injection Logic
  const sendText = useCallback((text: string) => {
      if (sessionRef.current) {
          const session = sessionRef.current as any;
          
          if (typeof session.send === 'function') {
              try {
                  session.send({
                      clientContent: {
                          turns: [{
                              role: 'user',
                              parts: [{ text }]
                          }],
                          turnComplete: true
                      }
                  });
                  onLog({ timestamp: new Date(), type: 'user', message: `(Text Command): ${text}` });
              } catch(e: any) {
                  onLog({ timestamp: new Date(), type: 'system', message: `Failed to send text: ${e.message}` });
              }
          } else {
              onLog({ timestamp: new Date(), type: 'system', message: `Session does not support text input (send() method missing).` });
          }
      }
  }, [onLog]);
  
  // Automatic Commentary Interval (Auto-Poke)
  useEffect(() => {
    if (!isConnected || currentVideoSource === VideoSourceType.NONE) return;
    
    const intervalSeconds = config.commentaryInterval || 30;
    
    const intervalId = setInterval(() => {
        // Don't interrupt if the AI is already speaking
        if (isAiSpeakingRef.current) return;
        
        sendText("[AUTO-POKE] Periodic Commentary Trigger. Look at the screen and comment.");
        
    }, intervalSeconds * 1000);
    
    return () => clearInterval(intervalId);
  }, [isConnected, currentVideoSource, config.commentaryInterval, sendText]);

  const loadAudioDevices = async () => {
      try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const mics = devices.filter(d => d.kind === 'audioinput');
          setAudioDevices(mics);
          // Set default if not set and devices exist
          if (mics.length > 0 && !currentAudioDeviceId) {
              const defaultMic = mics.find(d => d.deviceId === 'default') || mics[0];
              setCurrentAudioDeviceId(defaultMic.deviceId);
          }
      } catch (e) {
          console.error("Error loading audio devices:", e);
      }
  };

  useEffect(() => {
      loadAudioDevices();
      navigator.mediaDevices.addEventListener('devicechange', loadAudioDevices);
      return () => {
          navigator.mediaDevices.removeEventListener('devicechange', loadAudioDevices);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeAudioDevice = async (deviceId: string) => {
      setCurrentAudioDeviceId(deviceId);
      
      if (isConnected && audioContextRef.current && processorRef.current && analyserRef.current) {
          // Re-connect audio stream with new device
          try {
              // Stop old tracks
              if (mediaStreamRef.current) {
                  mediaStreamRef.current.getTracks().forEach(t => t.stop());
              }
              // Disconnect old source
              if (inputSourceRef.current) {
                  inputSourceRef.current.disconnect();
              }

              const stream = await navigator.mediaDevices.getUserMedia({
                  audio: { deviceId: { exact: deviceId } }
              });
              mediaStreamRef.current = stream;

              // Connect new source to existing analyser (via gain)
              const source = audioContextRef.current.createMediaStreamSource(stream);
              
              if (micGainNodeRef.current) {
                  source.connect(micGainNodeRef.current);
              }

              inputSourceRef.current = source;
              
              const deviceLabel = audioDevices.find(d => d.deviceId === deviceId)?.label || deviceId;
              onLog({timestamp: new Date(), type: 'system', message: `Switched mic to: ${deviceLabel}`});

          } catch(e: any) {
              onLog({timestamp: new Date(), type: 'system', message: `Error switching mic: ${e.message}`});
          }
      }
  };

  const stopAudioProcessing = useCallback(() => {
    if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
    }
    
    // Stop all active nodes
    activeAudioNodesRef.current.forEach(node => {
        try { node.stop(); node.disconnect(); } catch(e){}
    });
    activeAudioNodesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
    }
    if (micGainNodeRef.current) {
        micGainNodeRef.current.disconnect();
        micGainNodeRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    // Clean up screen audio
    if (screenAudioSourceRef.current) {
        screenAudioSourceRef.current.disconnect();
        screenAudioSourceRef.current = null;
    }
    if (screenAnalyserRef.current) {
        screenAnalyserRef.current.disconnect();
        screenAnalyserRef.current = null;
    }
    if (screenFadeGainNodeRef.current) {
        screenFadeGainNodeRef.current.disconnect();
        screenFadeGainNodeRef.current = null;
    }
    if (screenMuteGainNodeRef.current) {
        screenMuteGainNodeRef.current.disconnect();
        screenMuteGainNodeRef.current = null;
    }
    
    setVolume(0);
    setScreenVolume(0);
    setAiVolume(0);
    setIsScreenAudioShared(false);
    activeAiSourcesRef.current = 0;
    setIsAiSpeaking(false);
    isDuckingRef.current = false;
    turnStartTimeRef.current = null;
  }, []);

  const startVideoProcessing = useCallback((stream: MediaStream) => {
     if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);

     const videoEl = videoElementRef.current;
     if(!videoEl) return;

     videoEl.srcObject = stream;
     videoEl.play().catch(e => console.error("Error playing video:", e));

     const canvas = document.createElement('canvas');
     const ctx = canvas.getContext('2d');
     
     // Increase to 5 FPS (200ms) for better reactivity to jump scares/fast action
     videoIntervalRef.current = window.setInterval(async () => {
        if (!sessionPromiseRef.current || !ctx || !videoEl) return;
        
        if(videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
            canvas.width = videoEl.videoWidth * 0.5; // Downscale for performance
            canvas.height = videoEl.videoHeight * 0.5;
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
            
            const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
            
            sessionPromiseRef.current.then(session => {
                session.sendRealtimeInput({
                    media: {
                        mimeType: 'image/jpeg',
                        data: base64Data
                    }
                });
            }).catch(() => {});
        }
     }, 200); 

  }, [videoElementRef]);

  const stopVideoProcessing = useCallback(() => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (videoElementRef.current) {
        videoElementRef.current.srcObject = null;
    }
    if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => {
            // Remove listener to prevent loops if stop() triggers onended
            track.onended = null;
            track.stop();
        });
        videoStreamRef.current = null;
    }
    
    // Cleanup Audio Nodes for Screen
    if (screenAudioSourceRef.current) {
        screenAudioSourceRef.current.disconnect();
        screenAudioSourceRef.current = null;
    }
    if (screenAnalyserRef.current) {
        screenAnalyserRef.current.disconnect();
        screenAnalyserRef.current = null;
    }
    if (screenFadeGainNodeRef.current) {
        screenFadeGainNodeRef.current.disconnect();
        screenFadeGainNodeRef.current = null;
    }
    if (screenMuteGainNodeRef.current) {
        screenMuteGainNodeRef.current.disconnect();
        screenMuteGainNodeRef.current = null;
    }
    setScreenVolume(0);
    setIsScreenAudioShared(false);
  }, [videoElementRef]);

  // Handle Cartesia Audio Playback
  const handleCartesiaAudio = async (float32Data: Float32Array) => {
     if (!outputContextRef.current) return;
     const ctx = outputContextRef.current;
     
     // Cartesia sends raw float32 at 44100Hz (requested in client)
     const buffer = ctx.createBuffer(1, float32Data.length, 44100);
     buffer.copyToChannel(float32Data, 0);
     
     const source = ctx.createBufferSource();
     source.buffer = buffer;
     
     if (outputGainRef.current) {
         source.connect(outputGainRef.current);
     } else {
         source.connect(ctx.destination);
     }
     
     source.onended = () => {
         activeAiSourcesRef.current = Math.max(0, activeAiSourcesRef.current - 1);
         updateDucking();
     };
     
     const currentTime = ctx.currentTime;
     if (nextStartTimeRef.current < currentTime) {
         nextStartTimeRef.current = currentTime;
     }
     
     source.start(nextStartTimeRef.current);
     nextStartTimeRef.current += buffer.duration;
     
     activeAiSourcesRef.current++;
     updateDucking();
  };

  const connect = async () => {
    try {
      if (!process.env.API_KEY) {
        alert("API Key not found in environment.");
        return;
      }

      modelTranscriptionRef.current = "";
      userTranscriptionRef.current = "";
      turnStartTimeRef.current = null;
      initAudioContexts();
      
      // Initialize Cartesia if enabled
      if (config.useCartesia && config.cartesiaApiKey && config.cartesiaVoiceId) {
          cartesiaClientRef.current = new CartesiaClient(
              config.cartesiaApiKey,
              config.cartesiaVoiceId,
              handleCartesiaAudio
          );
          try {
              await cartesiaClientRef.current.connect();
              const modeDesc = config.useTextMode
                  ? 'TEXT mode (44% cheaper - $2/1M tokens)'
                  : 'AUDIO mode with transcription';
              onLog({ timestamp: new Date(), type: 'system', message: `Connected to Cartesia TTS (Sonic) - Using ${modeDesc}` });
          } catch (e) {
              onLog({ timestamp: new Date(), type: 'system', message: 'Failed to connect to Cartesia.' });
          }
      }
      
      // Sync output gain
      if (outputGainRef.current) {
          outputGainRef.current.gain.value = isOutputMuted ? 0 : 1;
      }

      onLog({ timestamp: new Date(), type: 'system', message: 'Connecting to Gemini Live...' });

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const functionDeclarations = tools.map(t => t.declaration);

      // --- Persona Logic ---
      const selectedPersona = getPersona(config.persona);
      const baseInstruction = selectedPersona.instruction;

      // Append user-defined overrides if any
      let finalSystemInstruction = baseInstruction;
      if (config.systemInstruction) {
          finalSystemInstruction += `\n\nAdditional User Instructions: ${config.systemInstruction}`;
      }

      // Append first greeting instruction if enabled
      if (config.useFirstGreeting && config.firstGreeting) {
          finalSystemInstruction += `\n\nIMPORTANT: You must start the conversation by saying exactly this sentence: "${config.firstGreeting}". Do not wait for the user to speak first.`;
      }

      // Cost Optimization: Use TEXT mode when Cartesia TTS is enabled with useTextMode
      // TEXT mode costs $2/1M tokens vs AUDIO mode at $12/1M tokens (44% cheaper overall)
      const useTextOutput = config.useCartesia && config.useTextMode;

      const sessionPromise = ai.live.connect({
        model: config.model,
        config: {
          responseModalities: [useTextOutput ? Modality.TEXT : Modality.AUDIO],
          // Only include speech config when using native audio output
          ...(useTextOutput ? {} : {
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } },
            },
          }),
          // Fixed: Moved config out of deprecated generationConfig
          temperature: 0.9,
          topP: 0.95,
          topK: 40,
          
          systemInstruction: finalSystemInstruction,
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
          outputAudioTranscription: {},
          inputAudioTranscription: {}, // Enable input transcription
        },
        callbacks: {
          onopen: async () => {
            setIsConnected(true);
            onLog({ timestamp: new Date(), type: 'system', message: 'Session Connected.' });
            
            // Debug: Log session capabilities
            sessionPromise.then(session => {
                onLog({ timestamp: new Date(), type: 'system', message: `Session capabilities: ${Object.keys(session).join(', ')}` });
                // Sending 500ms of silence to establish media flow
                session.sendRealtimeInput({ media: createPcmBlob(new Float32Array(8000)) }); 
            });
            
            // Start Microphone Stream
            try {
                // Use selected device or default
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: currentAudioDeviceId ? { deviceId: { exact: currentAudioDeviceId } } : true 
                });
                
                mediaStreamRef.current = stream;
                
                // Refresh devices now that we have permissions (to get labels)
                loadAudioDevices();

                if (audioContextRef.current) {
                    const ctx = audioContextRef.current;
                    
                    // Setup Audio Chain: Source -> MicGain -> Analyser -> Processor -> Destination
                    const source = ctx.createMediaStreamSource(stream);
                    const micGain = ctx.createGain();
                    micGain.gain.value = isMuted ? 0 : 1; // Initialize with current mute state

                    const analyser = ctx.createAnalyser();
                    analyser.fftSize = 256;
                    
                    const processor = ctx.createScriptProcessor(4096, 1, 1);
                    
                    processor.onaudioprocess = (e) => {
                        // Mix inputs
                        // The inputs are mixed at the input of the processor automatically because we connect multiple nodes to it.
                        // We NO LONGER return early if isMuted, because we want system audio to pass through even if mic is muted.
                        // Mic mute is handled by micGain node.
                        
                        const inputData = e.inputBuffer.getChannelData(0);
                        const pcmBlob = createPcmBlob(inputData);
                        sessionPromise.then(session => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };

                    source.connect(micGain);
                    micGain.connect(analyser);
                    analyser.connect(processor);
                    processor.connect(ctx.destination);
                    
                    inputSourceRef.current = source;
                    micGainNodeRef.current = micGain;
                    analyserRef.current = analyser;
                    processorRef.current = processor;
                    
                    // Setup Screen Audio if exists (e.g. user started screenshare before connecting)
                    if (videoStreamRef.current) {
                        const audioTracks = videoStreamRef.current.getAudioTracks();
                        if (audioTracks.length > 0) {
                             const screenStream = new MediaStream(audioTracks);
                             const screenSource = ctx.createMediaStreamSource(screenStream);
                             const screenAnalyser = ctx.createAnalyser();
                             screenAnalyser.fftSize = 256;
                             
                             // Mute Node for manual screen mute
                             const screenMuteGain = ctx.createGain();
                             screenMuteGain.gain.value = isScreenAudioMutedRef.current ? 0 : 1;

                             // Fade Gain Node for Ducking
                             const screenFadeGain = ctx.createGain();
                             // Use 0.5 (50%) by default to ensure mic is dominant and reduce bad transcription of video audio
                             screenFadeGain.gain.value = 0.5;

                             // Connect: Source -> Analyser -> MuteGain -> FadeGain -> Processor
                             screenSource.connect(screenAnalyser);
                             screenAnalyser.connect(screenMuteGain);
                             screenMuteGain.connect(screenFadeGain); 
                             screenFadeGain.connect(processor); 
                             
                             screenAudioSourceRef.current = screenSource;
                             screenAnalyserRef.current = screenAnalyser;
                             screenMuteGainNodeRef.current = screenMuteGain;
                             screenFadeGainNodeRef.current = screenFadeGain;
                             setIsScreenAudioShared(true);
                             
                             onLog({ timestamp: new Date(), type: 'system', message: 'System audio sharing active (Mix Level: 50%, with auto-ducking).' });
                        }
                    }

                    // Start Volume Monitor
                    if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
                    volumeIntervalRef.current = window.setInterval(() => {
                        // Mic Volume
                        if (analyserRef.current) {
                            const data = new Uint8Array(analyserRef.current.frequencyBinCount);
                            analyserRef.current.getByteTimeDomainData(data);
                            let sum = 0;
                            for(let i=0; i<data.length; i++) {
                                const v = (data[i] - 128) / 128;
                                sum += v * v;
                            }
                            const rms = Math.sqrt(sum / data.length);
                            setVolume(rms);
                        }
                        
                        // Screen Volume
                        if (screenAnalyserRef.current) {
                            const data = new Uint8Array(screenAnalyserRef.current.frequencyBinCount);
                            screenAnalyserRef.current.getByteTimeDomainData(data);
                            let sum = 0;
                            for(let i=0; i<data.length; i++) {
                                const v = (data[i] - 128) / 128;
                                sum += v * v;
                            }
                            const rms = Math.sqrt(sum / data.length);
                            setScreenVolume(rms);
                        } else {
                            setScreenVolume(0);
                        }

                        // AI Output Volume
                        if (outputAnalyserRef.current) {
                            const data = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
                            outputAnalyserRef.current.getByteTimeDomainData(data);
                            let sum = 0;
                            for(let i=0; i<data.length; i++) {
                                const v = (data[i] - 128) / 128;
                                sum += v * v;
                            }
                            const rms = Math.sqrt(sum / data.length);
                            setAiVolume(rms);
                        } else {
                            setAiVolume(0);
                        }
                    }, 100);
                }
            } catch (err) {
                onLog({ timestamp: new Date(), type: 'system', message: `Mic Error: ${err}` });
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Check if this is the start of a new model turn (audio or text) to capture start time
            const isModelResponse = msg.serverContent?.modelTurn || msg.serverContent?.outputTranscription;
            if (isModelResponse && !turnStartTimeRef.current) {
                turnStartTimeRef.current = new Date();
            }

            // Handle TEXT mode responses (when using Cartesia + TEXT mode for cost optimization)
            // In TEXT mode, Gemini sends text directly in modelTurn.parts instead of audio
            const textPart = msg.serverContent?.modelTurn?.parts?.[0]?.text;
            if (textPart && useTextOutput) {
                modelTranscriptionRef.current += textPart;
                // Pipe text to Cartesia for TTS
                if (cartesiaClientRef.current) {
                    cartesiaClientRef.current.send(textPart);
                }
            }

            // Handle Output Transcription (when using AUDIO mode + Cartesia for voice replacement)
            // In this mode, Gemini outputs audio but we use transcription to feed Cartesia
            const outputTranscript = msg.serverContent?.outputTranscription;
            if (outputTranscript?.text && !useTextOutput) {
                modelTranscriptionRef.current += outputTranscript.text;
                // If using Cartesia (but not TEXT mode), pipe the transcription to it
                if (cartesiaClientRef.current) {
                    cartesiaClientRef.current.send(outputTranscript.text);
                }
            }

            // Handle Audio from Gemini (Native Gemini voice output)
            // If Cartesia is enabled OR we're in TEXT mode, we IGNORE audio chunks
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputContextRef.current && !config.useCartesia) {
                const ctx = outputContextRef.current;
                const audioBuffer = await decodeAudioData(base64ToUint8Array(audioData), ctx);
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                
                // Connect via gain node for mute control
                if (outputGainRef.current) {
                    source.connect(outputGainRef.current);
                } else {
                    source.connect(ctx.destination);
                }
                
                // Add to active set
                activeAudioNodesRef.current.add(source);
                
                // Track start/end for ducking
                source.onended = () => {
                    activeAiSourcesRef.current = Math.max(0, activeAiSourcesRef.current - 1);
                    updateDucking();
                    
                    // Cleanup
                    source.disconnect();
                    activeAudioNodesRef.current.delete(source);
                };
                
                // Gapless playback logic
                const currentTime = ctx.currentTime;
                // Add 50ms lookahead if we reset the cursor to current time, prevents start clipping
                if (nextStartTimeRef.current < currentTime) {
                    nextStartTimeRef.current = currentTime + 0.05;
                }
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                
                // Increment active sources and update ducking state immediately
                activeAiSourcesRef.current++;
                updateDucking();
            }

            // Handle Input Transcription
            const inputTranscript = msg.serverContent?.inputTranscription;
            if (inputTranscript?.text) {
                userTranscriptionRef.current += inputTranscript.text;
            }

            // Handle Turn Complete
            if (msg.serverContent?.turnComplete) {
                 // Log Model Output
                 let modelText = modelTranscriptionRef.current.trim();
                 
                 // Extract Sentiment Tag if present
                 let sentiment: LogEntry['sentiment'] = undefined;
                 const sentimentMatch = modelText.match(/\[S:(POSITIVE|NEGATIVE|SURPRISED|NEUTRAL|EXCITED)\]/i);
                 if (sentimentMatch) {
                     sentiment = sentimentMatch[1].toLowerCase() as LogEntry['sentiment'];
                     // Remove tag from display text
                     modelText = modelText.replace(/\[S:(POSITIVE|NEGATIVE|SURPRISED|NEUTRAL|EXCITED)\]/i, '').trim();
                 }

                 if (modelText) {
                     // Use the captured start time to reflect reaction speed, or fallback to now
                     const logTime = turnStartTimeRef.current || new Date();
                     onLog({ timestamp: logTime, type: 'model', message: modelText, sentiment });
                     modelTranscriptionRef.current = "";
                     turnStartTimeRef.current = null;
                 }

                 // Log User Input
                 const userText = userTranscriptionRef.current.trim();
                 if (userText) {
                     onLog({ timestamp: new Date(), type: 'user', message: userText });
                     userTranscriptionRef.current = "";
                 }
            }

            // Handle Interrupted
            if (msg.serverContent?.interrupted) {
                 modelTranscriptionRef.current = "";
                 turnStartTimeRef.current = null;

                 // Stop all currently playing audio immediately
                 activeAudioNodesRef.current.forEach(node => {
                     try { node.stop(); node.disconnect(); } catch(e){}
                 });
                 activeAudioNodesRef.current.clear();
                 activeAiSourcesRef.current = 0;
                 // Reset cursor to current time so next response starts fresh
                 if(outputContextRef.current) {
                     nextStartTimeRef.current = outputContextRef.current.currentTime;
                 }
                 updateDucking();

                 // Stop Cartesia TTS immediately when interrupted
                 if (cartesiaClientRef.current) {
                     cartesiaClientRef.current.flush();
                 }
            }

            // Handle Tools
            if (msg.toolCall) {
                onLog({ timestamp: new Date(), type: 'model', message: 'Calling Tools...', data: msg.toolCall });
                
                const functionResponses = await Promise.all(msg.toolCall.functionCalls.map(async (call) => {
                    const tool = tools.find(t => t.declaration.name === call.name);
                    let result = { error: `Tool ${call.name} not found` };
                    
                    if (tool) {
                        try {
                            const output = await tool.execute(call.args);
                            result = output;
                            onLog({ timestamp: new Date(), type: 'tool', message: `Executed ${call.name}`, data: output });
                        } catch (e: any) {
                            result = { error: e.message };
                        }
                    }

                    return {
                        id: call.id,
                        name: call.name,
                        response: { result }
                    };
                }));

                sessionPromise.then(session => {
                    session.sendToolResponse({ functionResponses });
                });
            }
          },
          onclose: () => {
            setIsConnected(false);
            onLog({ timestamp: new Date(), type: 'system', message: 'Session Closed' });
          },
          onerror: (err) => {
            onLog({ timestamp: new Date(), type: 'system', message: `Error: ${err.message}` });
          }
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      sessionRef.current = await sessionPromise;

    } catch (e: any) {
      onLog({ timestamp: new Date(), type: 'system', message: `Connection Failed: ${e.message}` });
      setIsConnected(false);
    }
  };

  const disconnect = async () => {
    stopAudioProcessing();
    stopVideoProcessing();
    
    // Disconnect Cartesia
    if (cartesiaClientRef.current) {
        cartesiaClientRef.current.disconnect();
        cartesiaClientRef.current = null;
    }
    
    if (sessionRef.current) {
        try {
            (sessionRef.current as any).close();
        } catch (e) { console.error(e); }
    }
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    setIsConnected(false);
    setCurrentVideoSource(VideoSourceType.NONE);
    onLog({ timestamp: new Date(), type: 'system', message: 'Disconnected' });
  };

  const setVideoSource = useCallback(async (type: VideoSourceType) => {
      // Always cleanup first
      stopVideoProcessing();
      
      if (type === VideoSourceType.NONE) {
          setCurrentVideoSource(VideoSourceType.NONE);
          return;
      }

      try {
          // Check audio context state
          if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
              await audioContextRef.current.resume();
          }

          let stream: MediaStream;
          if (type === VideoSourceType.CAMERA) {
              stream = await navigator.mediaDevices.getUserMedia({ video: true });
          } else {
              // Request Audio for Screen Share
              stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          }
          
          videoStreamRef.current = stream;
          startVideoProcessing(stream);
          setCurrentVideoSource(type);
          
          // Connect Audio if we are already connected to Gemini
          if (isConnected && audioContextRef.current && processorRef.current) {
             const audioTracks = stream.getAudioTracks();
             if (audioTracks.length > 0) {
                 const ctx = audioContextRef.current;
                 const screenStream = new MediaStream(audioTracks);
                 const screenSource = ctx.createMediaStreamSource(screenStream);
                 const screenAnalyser = ctx.createAnalyser();
                 screenAnalyser.fftSize = 256;

                 // Mute Node for manual screen mute
                 const screenMuteGain = ctx.createGain();
                 screenMuteGain.gain.value = isScreenAudioMutedRef.current ? 0 : 1;

                 // Fade Gain Node for Ducking
                 const screenFadeGain = ctx.createGain();
                 // Use 0.5 (50%) by default to ensure mic is dominant
                 screenFadeGain.gain.value = 0.5;

                 // Connect: Source -> Analyser -> MuteGain -> FadeGain -> Processor
                 screenSource.connect(screenAnalyser);
                 screenAnalyser.connect(screenMuteGain);
                 screenMuteGain.connect(screenFadeGain); 
                 screenFadeGain.connect(processorRef.current); 

                 screenAudioSourceRef.current = screenSource;
                 screenAnalyserRef.current = screenAnalyser;
                 screenMuteGainNodeRef.current = screenMuteGain;
                 screenFadeGainNodeRef.current = screenFadeGain;
                 setIsScreenAudioShared(true);
                 
                 onLog({ timestamp: new Date(), type: 'system', message: 'System audio sharing active (Mix Level: 50%, with auto-ducking).' });
             } else if (type === VideoSourceType.SCREEN) {
                 setIsScreenAudioShared(false);
                 onLog({ timestamp: new Date(), type: 'system', message: 'Screen shared without audio.' });
                 
                 // Inject context message to inform model about the visual stream
                 sendText("[CONTEXT] User started sharing their screen (Video Only). You can see the visual content.");
             }
          } else if (type === VideoSourceType.SCREEN && isConnected) {
              // Even if audio not ready or connected, try to notify
               sendText("[CONTEXT] User started sharing their screen (Video Only).");
          }
          
          // Handle stream stop (user clicks "Stop Sharing" in browser UI)
          stream.getVideoTracks()[0].onended = () => {
              // Only stop if this is still the active stream
              if (videoStreamRef.current?.id === stream.id) {
                  setVideoSource(VideoSourceType.NONE);
              }
          };

      } catch (e: any) {
          onLog({ timestamp: new Date(), type: 'system', message: `Video Error: ${e.message}` });
          setCurrentVideoSource(VideoSourceType.NONE);
      }
  }, [isConnected, stopVideoProcessing, startVideoProcessing, onLog, sendText]);

  const toggleMute = () => {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      if (micGainNodeRef.current && audioContextRef.current) {
          micGainNodeRef.current.gain.setTargetAtTime(newMuted ? 0 : 1, audioContextRef.current.currentTime, 0.1);
      }
  };

  const toggleScreenAudio = () => {
      const newMuted = !isScreenAudioMuted;
      setIsScreenAudioMuted(newMuted);
      if (screenMuteGainNodeRef.current) {
          screenMuteGainNodeRef.current.gain.value = newMuted ? 0 : 1;
      }
  };

  const toggleOutputMute = () => {
      const newMuted = !isOutputMuted;
      setIsOutputMuted(newMuted);
      if (outputGainRef.current) {
          outputGainRef.current.gain.value = newMuted ? 0 : 1;
      }
  };

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          disconnect();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isConnected,
    isMuted,
    isOutputMuted,
    isAiSpeaking, 
    isScreenAudioShared,
    isScreenAudioMuted,
    volume,
    screenVolume,
    aiVolume, // Exposed AI volume
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
    sendText // Exported here
  };
};