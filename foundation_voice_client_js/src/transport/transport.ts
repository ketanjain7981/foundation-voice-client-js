import {
    Transport,
    TransportState,
    RTVIMessage,
    RTVIClientOptions,
    Tracks,
} from "@pipecat-ai/client-js";
import { WebsocketTransport } from "./websocket";
import { DailyTransport } from "@pipecat-ai/daily-transport";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { GeminiLiveWebsocketTransport, GeminiLLMServiceOptions } from '@pipecat-ai/gemini-live-websocket-transport';
import { OpenAIRealTimeWebRTCTransport, OpenAIServiceOptions } from '@pipecat-ai/openai-realtime-webrtc-transport';

export type TransportType = 
    | "websocket" 
    | "daily" 
    | "webrtc" 
    | "gemini"
    | "openai";

export interface TransportConfig {
    websocket: string; 
    daily: any; 
    webrtc: any; 
    gemini: GeminiLLMServiceOptions;
    openai: OpenAIServiceOptions;
}


export class TransportFactory {
    static create<T extends TransportType>(
        transportType: T, 
        options: TransportConfig[T]
    ): Transport {
        switch (transportType) {
            case "websocket":
                return new WebsocketTransport(options as string);
                
            case "daily":
                return new DailyTransport(options);
                
            case "webrtc":
                return new SmallWebRTCTransport(options);
                
            case "gemini":
                return new GeminiLiveWebsocketTransport(options as GeminiLLMServiceOptions);
                
            case "openai":
                return new OpenAIRealTimeWebRTCTransport(options as OpenAIServiceOptions);
                
            default:
                throw new Error(`Unsupported transport type: ${transportType}`);
        }
    }

    static getAvailableTransports(): TransportType[] {
        return ["websocket", "daily", "webrtc", "gemini", "openai"];
    }
}

export class TransportManager {
    private transport: Transport;
    private transportType: TransportType;

    constructor(
        transportType: TransportType, 
        options: TransportConfig[TransportType]
    ) {
        this.transportType = transportType;
        this.transport = TransportFactory.create(transportType, options);
    }
    
    async initialize(options: RTVIClientOptions, messageHandler: (message: RTVIMessage) => void): Promise<void> {
        return this.transport.initialize(options, messageHandler);
    }

    async connect(authBundle: Record<string, unknown>, abortController: AbortController): Promise<void> {
        return this.transport.connect(authBundle, abortController);
    }

    async disconnect(): Promise<void> {
        return this.transport.disconnect();
    }

    get instance(): Transport {
        return this.transport;
    }

    get state(): TransportState {
        return this.transport.state;
    }

    tracks(): Tracks {
        return this.transport.tracks();
    }

    async enableMic(enable: boolean): Promise<void> {
        await this.transport.enableMic(enable);
    }

    async enableCam(enable: boolean): Promise<void> {
        await this.transport.enableCam(enable);
    }

    enableScreenShare(enable: boolean): void {
        this.transport.enableScreenShare(enable);
    }

    get isSharingScreen(): boolean {
        return this.transport.isSharingScreen;
    }

    get isCamEnabled(): boolean {
        return this.transport.isCamEnabled;
    }

    get isMicEnabled(): boolean {
        return this.transport.isMicEnabled;
    }

    sendMessage(message: RTVIMessage): void {
        this.transport.sendMessage(message);
    }
}

export {
    WebsocketTransport,
    DailyTransport,
    SmallWebRTCTransport,
    GeminiLiveWebsocketTransport,
    OpenAIRealTimeWebRTCTransport
};

export type {
    GeminiLLMServiceOptions,
    OpenAIServiceOptions
};