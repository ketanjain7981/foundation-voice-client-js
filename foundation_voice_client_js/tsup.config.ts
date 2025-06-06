import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'browser',
  noExternal: [
    '@pipecat-ai/client-js',
    '@pipecat-ai/daily-transport',
    '@pipecat-ai/small-webrtc-transport',
    '@pipecat-ai/gemini-live-websocket-transport',
    '@pipecat-ai/openai-realtime-webrtc-transport',
    'protobufjs'
  ],
  esbuildOptions(options) {
    options.define = {
      ...options.define,
      'process.env.NODE_ENV': JSON.stringify('production'),
    };
  },
});