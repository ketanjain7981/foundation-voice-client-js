import { 
  RTVIClientOptions
} from "@pipecat-ai/client-js";
import { Client } from "../client";
import { 
  TransportFactory
} from "../transport/transport";

/**
 * Creates and configures a new RTVIClient instance
 * @param transportType - The type of transport to use ('websocket', 'webrtc', or 'daily'). Defaults to 'websocket'
 * @param customOptions - Optional custom options to override the default options
 */
export async function createRTVIClient(
  transportType: string,
  customOptions?: Partial<RTVIClientOptions>
) {
  console.log(`Debug: Transport type chosen: ${transportType}`);
  let transport;
  switch (transportType) {
    case "websocket":
      transport = TransportFactory.create("websocket", "ws://localhost:8000/ws");
      break;
    case "webrtc":
      transport = TransportFactory.create("webrtc", {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      break;
    case "daily":
      transport = TransportFactory.create("daily", {});
      break;
    default:
      throw new Error(`Invalid transport type: ${transportType}`);
  }
  console.log(`Transport chosen: ${transportType}`);

  const defaultOptions: RTVIClientOptions = {
    transport,
    params: {
      baseUrl: "http://localhost:8000",
      endpoints: {
        connect: transportType === "webrtc" ? "/api/offer" : "/connect",
      },
      audio: {
        sampleRate: 16000,
        numChannels: 1,
        encoding: "raw",
        format: "protobuf",
        outputSampleRate: 16000,
        outputChannels: 1,
      },
      requestData: {
        transportType: transportType,
        type: "offer",
        sdp: "sdp",
      },
    },
    enableMic: true,
    enableCam: false,
    timeout: 15000,
  };

  const options: RTVIClientOptions = customOptions 
    ? {
        ...defaultOptions,
        ...customOptions,
        // Handle nested params object separately to allow partial overrides
        params: customOptions.params 
          ? { 
              ...defaultOptions.params,
              ...customOptions.params,
              // Handle nested endpoints object
              endpoints: customOptions.params.endpoints && typeof customOptions.params.endpoints === 'object'
                ? { ...(defaultOptions.params.endpoints || {}), ...customOptions.params.endpoints }
                : defaultOptions.params.endpoints,
              // Handle nested audio object
              audio: customOptions.params.audio && typeof customOptions.params.audio === 'object'
                ? { ...(defaultOptions.params.audio || {}), ...customOptions.params.audio }
                : defaultOptions.params.audio,
              // Handle nested requestData object
              requestData: customOptions.params.requestData && typeof customOptions.params.requestData === 'object'
                ? { ...(defaultOptions.params.requestData || {}), ...customOptions.params.requestData }
                : defaultOptions.params.requestData
              // Note: We don't need to spread customOptions.params again as it's already spread above
            }
          : defaultOptions.params,
        // Ensure callbacks are properly merged if provided
        callbacks: customOptions.callbacks && typeof customOptions.callbacks === 'object'
          ? { ...(defaultOptions.callbacks || {}), ...customOptions.callbacks }
          : defaultOptions.callbacks,
        // Preserve transport if provided in customOptions
        transport: customOptions.transport || defaultOptions.transport,
        // Preserve other top-level options
        timeout: customOptions.timeout !== undefined ? customOptions.timeout : defaultOptions.timeout,
        enableMic: customOptions.enableMic !== undefined ? customOptions.enableMic : defaultOptions.enableMic,
        enableCam: customOptions.enableCam !== undefined ? customOptions.enableCam : defaultOptions.enableCam,
        // Include customConnectHandler if provided
        customConnectHandler: customOptions.customConnectHandler || defaultOptions.customConnectHandler
      } 
    : defaultOptions;

  const client = new Client(options);
  return client;
}
