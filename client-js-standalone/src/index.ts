// Export specific items from client to avoid ambiguity
export { Client } from './client';
// Export RTVIEvent as a value, not a type
export { RTVIEvent } from '@pipecat-ai/client-js';
// Export from other modules
export * from './utils/utils';
export {
  TransportManager,
  WebsocketTransport,
  DailyTransport,
  SmallWebRTCTransport,
  GeminiLiveWebsocketTransport,
  OpenAIRealTimeWebRTCTransport,
} from './transport/transport';

export type {
    TransportType,
    TransportConfig,
    GeminiLLMServiceOptions,
    OpenAIServiceOptions
} from './transport/transport';
export { TransportFactory } from './transport/transport';

export {
  // Error classes
  RTVIError,
  ConnectionTimeoutError,
  StartBotError,
  TransportStartError,
  BotNotReadyError,
  ConfigUpdateError,
  ActionEndpointNotSetError,

  // Core types and interfaces
  RTVIClientHelpers,
  RTVIClientHelperCallbacks,
  RTVIClientHelperOptions,
  RTVIClientHelper,
  TransportState,
  Participant,
  Tracks,
  Transport,
  RTVIEvents,
  RTVIEventHandler,

  // LLM related types
  LLMFunctionCallData,
  LLMContextMessage,
  LLMContext,
  FunctionCallParams,
  FunctionCallCallback,
  LLMMessageType,
  LLMActionType,
  LLMHelperCallbacks,
  LLMHelperOptions,
  LLMHelper,

  // Logger
  LogLevel,
  logger,
  ILogger,

  // Config types
  ConfigOption,
  RTVIClientConfigOption,
  RTVIURLEndpoints,
  TransportWrapper,
  RTVIClientParams,
  RTVIClientOptions,
  RTVIEventCallbacks,

  // Main client
  RTVIClient,

  // Message related
  RTVI_MESSAGE_LABEL,
  RTVIMessageType,
  ConfigData,
  BotReadyData,
  ErrorData,
  PipecatMetricData,
  PipecatMetricsData,
  TranscriptData,
  BotLLMTextData,
  BotTTSTextData,
  StorageItemStoredData,
  LLMSearchResult,
  LLMSearchOrigin,
  BotLLMSearchResponseData,
  ServerMessageData,
  RTVIMessageActionResponse,
  RTVIMessage,
  RTVIActionRequestData,
  RTVIActionRequest,
  RTVIActionResponse,
  MessageDispatcher,
  httpActionGenerator
} from '@pipecat-ai/client-js';