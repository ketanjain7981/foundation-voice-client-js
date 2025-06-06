/**
 * Logging utility for Pipecat WebSocket client
 * 
 * Provides standardized logging for connection, event, and debugging information.
 */

// Log levels
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  };
  
  // Configure the current log level
  const CURRENT_LOG_LEVEL = LOG_LEVELS.INFO;
  
  // Log colors
  const LOG_COLORS: Record<string, string> = {
    connection: '#4a9eda',
    event: '#24b365',
    ui: '#8e44ad',
    audio: '#1abc9c',
    error: '#e74c3c',
    warn: '#f39c12',
    debug: '#7f8c8d',
    rtvi: '#2ecc71',
    conversation: '#e67e22'
  };
  
  // Helper function to get timestamp
  const getTimestamp = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false });
  };
  
  // Base logger function
  const createLogger = (category: string, level: number) => {
    return (message: string, data?: any) => {
      if (level < CURRENT_LOG_LEVEL) return;
      
      const color = category === 'error' ? LOG_COLORS.error : 
                    category === 'warn' ? LOG_COLORS.warn :
                    LOG_COLORS[category] || '#666';
                    
      const prefix = `[${getTimestamp()}] [${category.toUpperCase()}]`;
      
      if (data !== undefined) {
        console.log(`%c${prefix} ${message}`, `color: ${color}`, data);
      } else {
        console.log(`%c${prefix} ${message}`, `color: ${color}`);
      }
    };
  };
  
  // RTVI-specific logger for important protocol events
  const rtviLogger = {
    // Connection events
    connected: createLogger('rtvi', LOG_LEVELS.INFO),
    disconnected: createLogger('rtvi', LOG_LEVELS.INFO),
    ready: createLogger('rtvi', LOG_LEVELS.INFO),
    
    // Speaking events
    userStartedSpeaking: createLogger('rtvi', LOG_LEVELS.INFO),
    userStoppedSpeaking: createLogger('rtvi', LOG_LEVELS.INFO),
    botStartedSpeaking: createLogger('rtvi', LOG_LEVELS.INFO),
    botStoppedSpeaking: createLogger('rtvi', LOG_LEVELS.INFO),
    
    // Transcription events
    transcript: createLogger('rtvi', LOG_LEVELS.INFO)
  };
  
  // General purpose loggers
  export const log = {
    // Connection-related logs
    connection: {
      debug: createLogger('connection', LOG_LEVELS.DEBUG),
      info: createLogger('connection', LOG_LEVELS.INFO),
      warn: createLogger('connection', LOG_LEVELS.WARN),
      error: createLogger('connection', LOG_LEVELS.ERROR)
    },
    
    // Event-related logs (VAD, user actions, etc.)
    event: {
      debug: createLogger('event', LOG_LEVELS.DEBUG),
      info: createLogger('event', LOG_LEVELS.INFO),
      warn: createLogger('event', LOG_LEVELS.WARN),
      error: createLogger('event', LOG_LEVELS.ERROR)
    },
    
    // UI-related logs
    ui: {
      debug: createLogger('ui', LOG_LEVELS.DEBUG),
      info: createLogger('ui', LOG_LEVELS.INFO),
      warn: createLogger('ui', LOG_LEVELS.WARN),
      error: createLogger('ui', LOG_LEVELS.ERROR)
    },
    
    // Audio-related logs
    audio: {
      debug: createLogger('audio', LOG_LEVELS.DEBUG),
      info: createLogger('audio', LOG_LEVELS.INFO),
      warn: createLogger('audio', LOG_LEVELS.WARN),
      error: createLogger('audio', LOG_LEVELS.ERROR)
    },
  
    // Conversation-related logs
    conversation: {
      debug: createLogger('conversation', LOG_LEVELS.DEBUG),
      info: createLogger('conversation', LOG_LEVELS.INFO),
      warn: createLogger('conversation', LOG_LEVELS.WARN),
      error: createLogger('conversation', LOG_LEVELS.ERROR)
    },
    
    // RTVI-specific logs
    rtvi: rtviLogger
  }; 