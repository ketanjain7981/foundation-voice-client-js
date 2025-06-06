import { 
  RTVIClient, 
  RTVIClientOptions,
  RTVIMessage, 
  RTVIActionRequestData, 
  RTVIActionResponse, 
} from '@pipecat-ai/client-js';

// Re-export everything from the original client-js
export * from '@pipecat-ai/client-js';

// Extend the RTVIClient with custom functionality
export class Client extends RTVIClient {
  constructor(options: RTVIClientOptions) {
    super(options);
    console.log('[Client] Initialized with options:', options);
  }

  // Add custom method for sending text messages
  public async sendTextMessage(text: string): Promise<void> {
    console.log('[Client] Sending text message:', text);
    const message: RTVIMessage = {
      type: 'text',
      data: { text },
      id: crypto.randomUUID(),
      label: 'user_message'
    };
    return this.sendMessage(message);
  }

  // Add custom method for sending actions with enhanced logging
  public async sendCustomAction(action: RTVIActionRequestData): Promise<RTVIActionResponse> {
    console.log('[Client] Sending custom action:', action);
    try {
      const response = await this.action(action);
      console.log('[Client] Action response:', response);
      return response;
    } catch (error) {
      console.error('[Client] Action failed:', error);
      throw error;
    }
  }
}