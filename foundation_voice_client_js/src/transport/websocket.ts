import {
  RTVIClientOptions,
  RTVIMessage,
  RTVIEvent,
} from "@pipecat-ai/client-js";
import { Transport, TransportState, Tracks } from "@pipecat-ai/client-js";
import * as protobuf from "protobufjs";

// Simplified interfaces for what we expect AFTER protobuf decoding
interface DecodedAudioFrame {
  audio: Uint8Array | number[];
  sampleRate: number;
  numChannels: number;
  pts?: number;
}

interface DecodedTextFrame {
  text: string;
}

interface DecodedTranscriptionFrame {
  text: string;
  user_id?: string;
  timestamp?: string;
}

// Add interruption frame interfaces
interface DecodedStartInterruptionFrame {
  // Empty object, used as a signal
}

interface DecodedStopInterruptionFrame {
  // Empty object, used as a signal
}

interface ParsedPipecatFrame {
  audio?: DecodedAudioFrame;
  text?: DecodedTextFrame;
  transcription?: DecodedTranscriptionFrame;
  startInterruption?: DecodedStartInterruptionFrame;
  stopInterruption?: DecodedStopInterruptionFrame;
}

interface RTVIMessageData {
  text?: string;
  content?: string;
}

  export interface WebsocketTransportParams {
  url: string;
  parameters?: Record<string, string>;
  onDecode?: (frame: Uint8Array) => void;
}

// Add new interfaces for RTVI messages
interface RTVIUserStartedSpeakingMessage {
  type: "rtvi:user:started_speaking";
}

interface RTVIUserStoppedSpeakingMessage {
  type: "rtvi:user:stopped_speaking";
}

interface RTVIBotStartedSpeakingMessage {
  type: "rtvi:bot:started_speaking";
}

interface RTVIBotStoppedSpeakingMessage {
  type: "rtvi:bot:stopped_speaking";
}

// Update TransportCallbacks interface
interface TransportCallbacks {
  // Existing callbacks
  onGenericMessage?: (data: unknown) => void;
  onMessageError?: (message: RTVIMessage) => void;
  onError?: (message: RTVIMessage) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onUserStartedSpeaking?: () => void;
  onUserStoppedSpeaking?: () => void;
  onBotStartedSpeaking?: () => void;
  onBotStoppedSpeaking?: () => void;
  onServerMessage?: (data: any) => void;
  onTransportStateChanged?: (state: TransportState) => void;

  // New VAD callbacks
  onVADStateChanged?: (state: "SPEAKING" | "QUIET") => void;
  onEnergyLevelChanged?: (level: number) => void;
}

export class WebsocketTransport extends Transport {
  private _websocket: WebSocket | null = null;
  private _audioContext: AudioContext | null = null;
  private _frameRef: protobuf.Type | null = null;

  // Microphone handling
  private _mediaStream: MediaStream | null = null;
  private _audioWorkletNode: AudioWorkletNode | null = null;
  private _audioSource: MediaStreamAudioSourceNode | null = null;

  // Audio Playback
  private _playTime: number = 0;
  private _lastMessageTime: number = 0;
  private readonly PLAY_TIME_RESET_THRESHOLD_MS: number = 1.0;

  // Server connection
  private readonly _serverUrl: string;
  private readonly SAMPLE_RATE = 16000;
  private readonly NUM_CHANNELS = 1;

  // Reconnection logic
  private _reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly BASE_RECONNECT_DELAY_MS = 1000;

  // Callback and options management
  protected _callbacks: NonNullable<RTVIClientOptions["callbacks"]> = {};
  protected declare _options: RTVIClientOptions;
  protected declare _onMessage: (ev: RTVIMessage) => void;
  private _internalState: TransportState = "disconnected";

  // Internal flags for mic/cam/screen state
  private _isMicEnabledInternal: boolean = false;
  private _isCamEnabledInternal: boolean = false;
  private _isScreenShareEnabledInternal: boolean = false;

  // Speech detection
  private _userIsSpeaking: boolean = false;
  private _botIsSpeaking: boolean = false;

  // Speech detection parameters
  private readonly SPEECH_THRESHOLD = -25; // dB threshold for speech detection
  private readonly SPEECH_END_THRESHOLD = -35; // dB threshold for speech end
  private readonly MIN_SPEECH_SAMPLES = 5; // Minimum samples to confirm speech
  private _consecutiveSpeechSamples: number = 0;
  private _consecutiveSilenceSamples: number = 0;
  private readonly SPEECH_DETECTION_TIMEOUT_MS = 1000;
  private _lastSpeechEndTime = 0;
  private _lastBotSpeechEndTime = 0;
  private _botSpeechEndTimeout: ReturnType<typeof setTimeout> | null = null;

  // Bot speaking detection
  private botSpeakingTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastAudioReceived: number = 0;
  private isBotCurrentlySpeaking: boolean = false;
  private BOT_SPEECH_TIMEOUT_MS = 300; // Consider bot stopped speaking after 300ms of no audio

  // Add new properties
  private isUserSpeaking: boolean = false;
  private userSpeakingTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly VAD_SILENCE_THRESHOLD = 300; // ms

  // FIXED: Constructor now accepts proper options
  constructor(options: WebsocketTransportParams | string) {
    super();
    
    // Handle both string URL and options object for backward compatibility
    if (typeof options === 'string') {
      this._serverUrl = options;
    } else {
      this._serverUrl = options.url;
    }
    
    if (!this._serverUrl) {
      throw new Error("WebSocket server URL must be provided");
    }
  }

  // State getter and setter
  get state(): TransportState {
    return this._internalState;
  }

  set state(newState: TransportState) {
    if (this._internalState !== newState) {
      const oldState = this._internalState;
      this._internalState = newState;
      console.log(`[Transport] State changed from ${oldState} to: ${newState}`);
      if (this._callbacks.onTransportStateChanged) {
        this._callbacks.onTransportStateChanged(newState);
      }

      // Clean up when disconnecting/erroring
      if (
        (newState === "disconnected" || newState === "error") &&
        this._isMicEnabledInternal
      ) {
        this.enableMic(false).catch((err) =>
          console.error(
            "[Transport] Error stopping mic on disconnect/error state:",
            err,
          ),
        );
      }
    }
  }

  async initialize(
    options: RTVIClientOptions,
    messageHandler: (message: RTVIMessage) => void,
  ): Promise<void> {
    this._options = options;
    this._callbacks = options.callbacks || {};
    this._onMessage = messageHandler;
    this.state = "initializing";

    // Initialize internal flags from options
    this._isMicEnabledInternal = !!options.enableMic;
    this._isCamEnabledInternal = !!options.enableCam;

    try {
      if (typeof window === "undefined") {
        this.state = "error";
        throw new Error(
          "Transport initialization requires browser environment",
        );
      }

      try {
        // Load protobuf definitions directly as a string
        const protoDefinition = `
          syntax = "proto3";
          package pipecat;
          
          message TextFrame {
            uint64 id = 1;
            string name = 2;
            string text = 3;
          }
          
          message AudioRawFrame {
            uint64 id = 1;
            string name = 2;
            bytes audio = 3;
            uint32 sample_rate = 4;
            uint32 num_channels = 5;
            optional uint64 pts = 6;
          }
          
          message TranscriptionFrame {
            uint64 id = 1;
            string name = 2;
            string text = 3;
            string user_id = 4;
            string timestamp = 5;
          }
          
          message Frame {
            oneof frame {
              TextFrame text = 1;
              AudioRawFrame audio = 2;
              TranscriptionFrame transcription = 3;
            }
          }`;

        const root = protobuf.parse(protoDefinition).root;
        this._frameRef = root.lookupType("pipecat.Frame");
        console.log(
          "[Transport] Protobuf definitions loaded successfully for pipecat.Frame.",
        );
      } catch (protoError) {
        this.state = "error";
        console.error(
          "[Transport] Fatal: Error loading protobuf definitions:",
          protoError,
        );
        console.error(
          "[Transport] Make sure frames.proto is properly bundled with the SDK",
        );
        throw protoError;
      }

      try {
        this._audioContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)({
          latencyHint: "interactive",
          sampleRate: this.SAMPLE_RATE,
        });
        console.log(
          "[Transport] AudioContext initialized with sample rate:",
          this._audioContext.sampleRate,
        );

        // Load the audio worklet if we're in a browser context
        if (
          typeof window !== "undefined" &&
          "audioWorklet" in this._audioContext
        ) {
          try {
            await this._audioContext.audioWorklet.addModule(
              "/audio-processor.js",
            );
            console.log("[Transport] Audio worklet module loaded successfully");
          } catch (workletError) {
            console.warn(
              "[Transport] Failed to load audio worklet, will fallback to script processor:",
              workletError,
            );
          }
        }
      } catch (audioContextError) {
        this.state = "error";
        console.error(
          "[Transport] Error initializing AudioContext:",
          audioContextError,
        );
        throw audioContextError;
      }

      this.state = "initialized";
      console.log("[Transport] Initialization complete.");
    } catch (error) {
      this.state = "error";
      console.error(
        "[Transport] Error during transport initialization:",
        error,
      );
      throw error;
    }
  }

  async connect(
    authBundle: Record<string, unknown> | undefined,
    abortController: AbortController,
  ): Promise<void> {
    if (
      this.state === "connecting" ||
      this.state === "connected" ||
      this.state === "ready"
    ) {
      console.log(
        `[Transport] Already in state: ${this.state}, no need to reconnect.`,
      );
      return;
    }

    console.log("[Transport] Connecting to WebSocket server:", this._serverUrl);
    this.state = "connecting";
    this._reconnectAttempts = 0;

    try {
      if (this._audioContext && this._audioContext.state === "suspended") {
        console.log("[Transport] Resuming AudioContext...");
        await this._audioContext.resume();
        console.log("[Transport] AudioContext resumed.");
      }

      this._websocket = new WebSocket(this._serverUrl);
      this._websocket.binaryType = "arraybuffer";

      abortController.signal.addEventListener("abort", () => {
        console.log("[Transport] Connection attempt aborted by controller.");
        if (
          this._websocket &&
          (this._websocket.readyState === WebSocket.CONNECTING ||
            this._websocket.readyState === WebSocket.OPEN)
        ) {
          this._websocket.close(1000, "Connection aborted by client");
        }
        this.state = "disconnected";
      });

      this._websocket.onopen = () => {
        console.log("[Transport] WebSocket connection established.");
        this._reconnectAttempts = 0;
        this.state = "connected";
        this.sendReadyMessage();
        
        // FIXED: Call onConnected callback
        if (this._callbacks.onConnected) {
          this._callbacks.onConnected();
        }
      };

      this._websocket.onmessage = (event: MessageEvent) => {
        this.handleWebSocketMessage(event);
      };

      this._websocket.onclose = (event: CloseEvent) => {
        console.log(
          `[Transport] WebSocket connection closed. Code: ${event.code}, Reason: "${event.reason}", WasClean: ${event.wasClean}`,
        );
        this.state = "disconnected";

        if (this._callbacks.onDisconnected) {
          this._callbacks.onDisconnected();
        }

        // Attempt to reconnect if not a clean closure
        if (
          !event.wasClean &&
          this._reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS
        ) {
          const delay = this.calculateReconnectDelay();
          console.log(
            `[Transport] Attempting to reconnect in ${delay}ms (attempt ${this._reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`,
          );
          setTimeout(() => {
            this.connect(authBundle, new AbortController());
          }, delay);
          this._reconnectAttempts++;
        }
      };

      this._websocket.onerror = (event: Event) => {
        console.error("[Transport] WebSocket error:", event);
        this.state = "error";
        if (this._callbacks.onError)
          this._callbacks.onError(
            RTVIMessage.error("WebSocket connection error"),
          );
      };
    } catch (error) {
      console.error("[Transport] Error during connect sequence:", error);
      this.state = "error";
      if (this._callbacks.onError)
        this._callbacks.onError(
          RTVIMessage.error(
            `Connection setup failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      throw error;
    }
  }

  private calculateReconnectDelay(): number {
    // Exponential backoff with jitter
    const baseDelay =
      this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts);
    const maxDelay = 30000; // 30 seconds max
    const jitter = Math.random() * 0.3 + 0.85; // Random value between 0.85 and 1.15
    return Math.min(baseDelay * jitter, maxDelay);
  }

  async disconnect(): Promise<void> {
    console.log("[Transport] Disconnecting...");
    this.state = "disconnecting";

    if (this._isMicEnabledInternal) {
      await this.enableMic(false);
    }

    if (this._websocket) {
      if (
        this._websocket.readyState === WebSocket.OPEN ||
        this._websocket.readyState === WebSocket.CONNECTING
      ) {
        this._websocket.close(1000, "Client initiated disconnect");
      }
      this._websocket = null;
    }

    if (this._audioContext && this._audioContext.state === "running") {
      console.log("[Transport] Suspending AudioContext.");
      try {
        await this._audioContext.suspend();
      } catch (suspendError) {
        console.error(
          "[Transport] Error suspending AudioContext:",
          suspendError,
        );
      }
    }

    this.state = "disconnected";
    console.log("[Transport] Disconnected.");
  }

  private handleWebSocketMessage(event: MessageEvent): void {
    this._lastMessageTime = Date.now();

    // Handle binary messages (audio frames)
    if (event.data instanceof ArrayBuffer) {
      try {
        if (!this._frameRef) {
          console.error(
            "[Transport] Frame reference not initialized, cannot decode binary message",
          );
          return;
        }

        const decodedMessage = this._frameRef.decode(
          new Uint8Array(event.data),
        );
        const frame = this.decodeFrame(decodedMessage);

        // Handle audio frames for playback
        if (frame && frame.audio) {
          const audioData = new Uint8Array(frame.audio.audio as number[]);

          // Reset play time if there's been a significant gap
          const currentTime = this._audioContext!.currentTime;
          if (currentTime - this._playTime > 0.5) {
            this._playTime = currentTime;
          }

          this._audioContext!.decodeAudioData(
            audioData.buffer,
            (buffer) => {
              // Create and configure source node
              const source = this._audioContext!.createBufferSource();
              source.buffer = buffer;

              // Add a small delay to ensure proper sequencing
              const scheduledTime = Math.max(
                this._playTime,
                currentTime + 0.05,
              );

              // Create a gain node for smooth transitions
              const gainNode = this._audioContext!.createGain();
              gainNode.gain.setValueAtTime(1, scheduledTime);

              // Connect nodes
              source.connect(gainNode);
              gainNode.connect(this._audioContext!.destination);

              // Start playback
              source.start(scheduledTime);
              this._playTime = scheduledTime + buffer.duration;

              // Update bot speaking state
              this._botIsSpeaking = true;
              window.dispatchEvent(
                new CustomEvent("bot-speaking-state-changed", {
                  detail: { isSpeaking: true },
                }),
              );

              // Set timeout to mark end of speech
              source.onended = () => {
                this._botIsSpeaking = false;
                window.dispatchEvent(
                  new CustomEvent("bot-speaking-state-changed", {
                    detail: { isSpeaking: false },
                  }),
                );
              };
            },
            (error) => {
              console.error("[Transport] Error decoding audio data:", error);
            },
          );
        }
      } catch (error) {
        console.error("[Transport] Error processing binary message:", error);
      }
      return;
    }

    // Handle text messages
    if (typeof event.data === "string") {
      try {
        const jsonData = JSON.parse(event.data);

        // Handle transcript updates and regular messages consistently
        if (
          jsonData.type === "transcript" ||
          jsonData.type === "transcript_update"
        ) {
          window.dispatchEvent(
            new CustomEvent("chat-message", {
              detail: {
                id: crypto.randomUUID(),
                content: jsonData.content,
                role: jsonData.role || "assistant",
                timestamp: new Date(jsonData.timestamp || Date.now()),
              },
            }),
          );
        }

        // FIXED: Handle RTVI messages properly
        if (jsonData.type && jsonData.type.startsWith('rtvi:')) {
          this.handleRTVIMessage(jsonData);
        }

        // Pass the message to client callbacks
        if (this._onMessage) {
          this._onMessage({
            type: jsonData.type || "text",
            data: jsonData,
            id: crypto.randomUUID(),
            label: "server_message",
          } as RTVIMessage);
        }
      } catch (jsonError) {
        console.warn("[Transport] Non-JSON text message:", event.data);
      }
    }
  }

  // FIXED: Proper sendMessage implementation
  public sendMessage(message: RTVIMessage): void {
    if (!this._websocket || this._websocket.readyState !== WebSocket.OPEN) {
      console.error("[Transport.sendMessage] WebSocket not connected");
      if (this._callbacks.onError) {
        this._callbacks.onError(RTVIMessage.error("WebSocket not connected"));
      }
      return;
    }

    try {
      // Handle different message types
      if (message.type === "client-audio") {
        // Handle audio messages through protobuf
        this.send(message).catch(error => {
          console.error("[Transport.sendMessage] Error sending audio message:", error);
        });
      } else {
        // Handle text and other messages
        const messageData = message.data as RTVIMessageData;
        
        const outgoingMessage = {
          type: message.type,
          text: messageData.text || messageData.content || "",
          timestamp: new Date().toISOString(),
        };

        this._websocket.send(JSON.stringify(outgoingMessage));
        console.log("[Transport.sendMessage] Message sent:", message.type);
      }
    } catch (error) {
      console.error("[Transport.sendMessage] Error sending message:", error);
      if (this._callbacks.onError) {
        this._callbacks.onError(RTVIMessage.error("Failed to send message"));
      }
    }
  }

  public sendReadyMessage(): void {
    console.log("[Transport.sendReadyMessage] Called.");
    if (this.state === "connected") {
      this.state = "ready";
      console.log(
        "[Transport] sendReadyMessage: Transitioned internal state to ready.",
      );
    } else {
      console.warn(
        "[Transport.sendReadyMessage] Called when not connected. State:",
        this.state,
      );
    }
  }

  public async send(message: RTVIMessage): Promise<void> {
    if (!this._websocket || this._websocket.readyState !== WebSocket.OPEN) {
      console.warn(
        "[Transport.send] WebSocket not connected or not open. State:",
        this._websocket?.readyState,
      );
      return Promise.reject(
        new Error("WebSocket not connected or not open. Cannot send message."),
      );
    }
    if (!this._frameRef) {
      console.warn("[Transport.send] Protobuf _frameRef not initialized.");
      return Promise.reject(
        new Error("Protobuf _frameRef not initialized. Cannot send message."),
      );
    }

    try {
      const messageType = message.type;
      const messageData = (message as any).data;

      if (messageType === "text" && typeof messageData === "string") {
        this.sendTextMessageProto(messageData);
      } else if (
        messageType === "text" &&
        typeof messageData?.text === "string"
      ) {
        this.sendTextMessageProto(messageData.text);
      } else {
        console.warn(
          `[Transport.send] Unhandled message type '${messageType}' or unexpected data structure.`,
        );
        return Promise.reject(
          new Error(`Unhandled message type: ${messageType}`),
        );
      }
      return Promise.resolve();
    } catch (error) {
      console.error(
        "[Transport.send] Error processing/sending message:",
        error,
      );
      return Promise.reject(error);
    }
  }

  private sendTextMessageProto(text: string): void {
    const textFrameData = { text: text };
    const frameToSend = this._frameRef!.create({ text: textFrameData });
    const encodedFrame = new Uint8Array(
      this._frameRef!.encode(frameToSend).finish(),
    );
    this._websocket!.send(encodedFrame);
    console.log(`[Transport] Sent text message: "${text}"`);
  }

  private convertFloat32ToS16PCM(float32Data: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const val = Math.max(-1, Math.min(1, float32Data[i]));
      int16Array[i] = val < 0 ? val * 32768 : val * 32767;
    }
    return int16Array;
  }

  public async enableMic(enable: boolean): Promise<void> {
    console.log(`[Transport] ${enable ? "Enabling" : "Disabling"} microphone.`);

    if (enable) {
      if (!this._audioContext) {
        console.error(
          "[Transport] AudioContext not available. Cannot enable mic.",
        );
        throw new Error("AudioContext not available.");
      }

      if (this._isMicEnabledInternal && this._mediaStream) {
        console.log("[Transport] Microphone already enabled.");
        return;
      }

      try {
        // Ensure AudioContext is running
        if (this._audioContext.state === "suspended") {
          await this._audioContext.resume();
        }

        // Request microphone access
        this._mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: this.SAMPLE_RATE,
            channelCount: this.NUM_CHANNELS,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        // Create audio source from microphone stream
        this._audioSource = this._audioContext.createMediaStreamSource(
          this._mediaStream,
        );


        this._isMicEnabledInternal = true;
        console.log("[Transport] Microphone enabled successfully.");
      } catch (err) {
        console.error("[Transport] Error enabling microphone:", err);
        this._isMicEnabledInternal = false;
        this.cleanupAudioResources();
        throw err;
      }
    } else {
      // Disable microphone
      this.cleanupAudioResources();
      this._isMicEnabledInternal = false;
      console.log("[Transport] Microphone disabled.");
    }
  }

  private setupScriptProcessor() {
    console.log(
      "[Transport] Falling back to ScriptProcessorNode for audio processing",
    );

    if (!this._audioContext || !this._audioSource) {
      console.error(
        "[Transport] Cannot setup ScriptProcessor: missing AudioContext or AudioSource",
      );
      return;
    }

    // NOTE: ScriptProcessorNode is deprecated, but we use it as a fallback
    const scriptProcessor = this._audioContext.createScriptProcessor(512, 1, 1);

    // Connect the audio pipeline
    this._audioSource.connect(scriptProcessor);
    scriptProcessor.connect(this._audioContext.destination);

    // Process audio data when available
    scriptProcessor.onaudioprocess = (event) => {
      const audioData = event.inputBuffer.getChannelData(0);
      this.processAudioData(audioData);
    };
  }

  private processAudioData(audioData: Float32Array): void {
    if (
      !this._websocket ||
      this._websocket.readyState !== WebSocket.OPEN ||
      !this._frameRef
    ) {
      return;
    }

    // Send the audio data to the server
    const pcmS16ArrayForSending = this.convertFloat32ToS16PCM(audioData);
    const pcmByteArrayForSending = new Uint8Array(pcmS16ArrayForSending.buffer);
    const frame = this._frameRef.create({
      audio: {
        audio: Array.from(pcmByteArrayForSending),
        sampleRate: this.SAMPLE_RATE,
        numChannels: this.NUM_CHANNELS,
      },
    });

    const encodedFrame = new Uint8Array(this._frameRef.encode(frame).finish());
    this._websocket.send(encodedFrame);
  }

  private cleanupAudioResources(): void {
    // Disconnect and clean up AudioWorkletNode if it exists
    if (this._audioWorkletNode) {
      try {
        this._audioWorkletNode.disconnect();
      } catch (e) {}
      this._audioWorkletNode = null;
    }

    // Disconnect and clean up AudioSourceNode
    if (this._audioSource) {
      try {
        this._audioSource.disconnect();
      } catch (e) {}
      this._audioSource = null;
    }

    // Stop media stream tracks
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((track) => track.stop());
      this._mediaStream = null;
    }
  }

  get isMicEnabled(): boolean {
    return this._isMicEnabledInternal;
  }

  get isCamEnabled(): boolean {
    return this._isCamEnabledInternal;
  }

  get isSharingScreen(): boolean {
    return this._isScreenShareEnabledInternal;
  }

  // Add getters for speech detection
  get userIsSpeaking(): boolean {
    return this._userIsSpeaking;
  }

  get botIsSpeaking(): boolean {
    return this._botIsSpeaking;
  }

  // Required interface implementations for Transport
  async initDevices(): Promise<void> {
    console.log(
      "[Transport] initDevices called. (No-op in this simplified transport)",
    );
  }

  tracks(): Tracks {
    return { local: {}, bot: {} };
  }

  async enableCam(enable: boolean): Promise<void> {
    console.log(`[Transport] enableCam: ${enable} (No-op)`);
    this._isCamEnabledInternal = enable;
  }

  async enableScreenShare(enable: boolean): Promise<void> {
    console.log(`[Transport] enableScreenShare: ${enable} (No-op)`);
    this._isScreenShareEnabledInternal = enable;
  }

  async getAllMics(): Promise<MediaDeviceInfo[]> {
    return [];
  }
  async getAllCams(): Promise<MediaDeviceInfo[]> {
    return [];
  }
  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    return [];
  }
  updateMic(micId: string): void {
      console.log("[Transport] updateMic:", micId);
    }
    updateCam(camId: string): void {
      console.log("[Transport] updateCam:", camId);
    }
    updateSpeaker(speakerId: string): void {
      console.log("[Transport] updateSpeaker:", speakerId);
    }
    get selectedMic() {
      return {};
    }
    get selectedCam() {
      return {};
    }
    get selectedSpeaker() {
      return {};
    }
  
    // Method to calculate volume level
    private calculateVolumeLevel(audioData: Float32Array): number {
      // Skip processing if the array is empty
      if (audioData.length === 0) return -100; // Return very low volume if no data
  
      // Calculate RMS (Root Mean Square) volume
      let sumOfSquares = 0;
      for (let i = 0; i < audioData.length; i++) {
        sumOfSquares += audioData[i] * audioData[i];
      }
      const rms = Math.sqrt(sumOfSquares / audioData.length);
  
      // Apply logarithmic scaling to make the volume level more human-like
      // Adding a small epsilon to avoid log(0)
      const epsilon = 0.0000001;
      return 20 * Math.log10(Math.max(rms, epsilon));
    }
  
    // Add this method after handleWebSocketMessage
    private decodeFrame(decodedMessage: any): ParsedPipecatFrame {
      const frame: ParsedPipecatFrame = {};
  
      if (!decodedMessage) return frame;
  
      try {
        // Convert from protobuf object to our simplified frame
        const frameObj = this._frameRef!.toObject(decodedMessage, {
          defaults: true,
        }) as any;
  
        // Map different frame types
        if (frameObj.audio && frameObj.audio.audio) {
          frame.audio = {
            audio: frameObj.audio.audio,
            sampleRate: frameObj.audio.sampleRate || this.SAMPLE_RATE,
            numChannels: frameObj.audio.numChannels || this.NUM_CHANNELS,
            pts: frameObj.audio.pts,
          };
        }
  
        if (frameObj.text && frameObj.text.text) {
          frame.text = {
            text: frameObj.text.text,
          };
        }
  
        if (frameObj.transcription && frameObj.transcription.text) {
          frame.transcription = {
            text: frameObj.transcription.text,
            user_id: frameObj.transcription.user_id,
            timestamp: frameObj.transcription.timestamp,
          };
        }
  
        if (frameObj.startInterruption) {
          frame.startInterruption = {};
        }
  
        if (frameObj.stopInterruption) {
          frame.stopInterruption = {};
        }
      } catch (error) {
        console.error("[Transport] Error converting frame:", error);
      }
  
      return frame;
    }
  
    private monitorAudioQuality(audioData: Float32Array): void {
      // Calculate audio metrics
      let peakLevel = 0;
      let noiseFloor = Infinity;
      let zeroCrossings = 0;
  
      for (let i = 1; i < audioData.length; i++) {
        // Track peak level
        peakLevel = Math.max(peakLevel, Math.abs(audioData[i]));
  
        // Track noise floor
        if (Math.abs(audioData[i]) > 0.0001) {
          noiseFloor = Math.min(noiseFloor, Math.abs(audioData[i]));
        }
  
        // Count zero crossings (high values indicate noise)
        if (Math.sign(audioData[i]) !== Math.sign(audioData[i - 1])) {
          zeroCrossings++;
        }
      }
  
      // Calculate zero crossing rate
      const zeroCrossingRate = zeroCrossings / audioData.length;
  
      // Log warnings if audio quality issues detected
      if (zeroCrossingRate > 0.3) {
        console.warn("[Transport] High frequency noise detected");
      }
  
      if (peakLevel > 0.9) {
        console.warn("[Transport] Audio clipping detected");
      }
  
      if (noiseFloor < 0.01 && peakLevel > 0.1) {
        console.warn("[Transport] High noise floor detected");
      }
    }
  
    private handleRTVIMessage(message: any): void {
      if (!this._onMessage) {
        console.warn(
          "[Transport] Received RTVI message but no message handler registered",
        );
        return;
      }
  
      // Pass message through to registered message handler
      this._onMessage(message);
  
      // Special handling for speaking state messages
      if (message.type === "rtvi:user:started_speaking") {
        console.log("[Transport] Received RTVI user started speaking message");
        this.handleUserSpeakingState(true);
      } else if (message.type === "rtvi:user:stopped_speaking") {
        console.log("[Transport] Received RTVI user stopped speaking message");
        this.handleUserSpeakingState(false);
      } else if (message.type === "rtvi:bot:started_speaking") {
        console.log("[Transport] Received RTVI bot started speaking message");
        this._botIsSpeaking = true;
  
        // Clear any existing bot speech timeout
        if (this.botSpeakingTimeout) {
          clearTimeout(this.botSpeakingTimeout);
          this.botSpeakingTimeout = null;
        }
  
        if (this._callbacks.onBotStartedSpeaking) {
          this._callbacks.onBotStartedSpeaking();
        }
      } else if (message.type === "rtvi:bot:stopped_speaking") {
        console.log("[Transport] Received RTVI bot stopped speaking message");
        this._botIsSpeaking = false;
  
        if (this._callbacks.onBotStoppedSpeaking) {
          this._callbacks.onBotStoppedSpeaking();
        }
      }
    }
  
    private handleUserSpeakingState(isSpeaking: boolean) {
      if (this._userIsSpeaking !== isSpeaking) {
        this._userIsSpeaking = isSpeaking;
  
        if (isSpeaking) {
          console.log("[Transport] User started speaking");
          // Now RTVIEvent will be properly recognized
          window.dispatchEvent(new CustomEvent(RTVIEvent.UserStartedSpeaking));
  
          // Clear any existing silence timeout
          if (this.userSpeakingTimeout) {
            clearTimeout(this.userSpeakingTimeout);
            this.userSpeakingTimeout = null;
          }
  
          // Notify callback
          if (this._callbacks.onUserStartedSpeaking) {
            this._callbacks.onUserStartedSpeaking();
          }
        } else {
          console.log("[Transport] User stopped speaking");
  
          // Dispatch RTVI event
          window.dispatchEvent(new CustomEvent(RTVIEvent.UserStoppedSpeaking));
  
          // Notify callback
          if (this._callbacks.onUserStoppedSpeaking) {
            this._callbacks.onUserStoppedSpeaking();
          }
        }
      }
    }
  
    public getAudioContext(): AudioContext {
      if (!this._audioContext) {
        throw new Error("AudioContext not initialized");
      }
      return this._audioContext;
    }
  
    public async sendTextMessage(text: string): Promise<void> {
      if (!this._websocket || this._websocket.readyState !== WebSocket.OPEN) {
        console.error("[Transport] Cannot send text: WebSocket not connected");
        return;
      }
  
      try {
        // Create message payload
        const messagePayload = {
          type: "text",
          content: text,
          timestamp: new Date().toISOString(),
          role: "user",
        };
  
        // Send as JSON string
        this._websocket.send(JSON.stringify(messagePayload));
        console.log("[Transport] Text message sent:", text);
      } catch (error) {
        console.error("[Transport] Error sending text message:", error);
      }
    }
  }
  