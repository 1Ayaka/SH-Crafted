import assert from 'node:assert/strict';

class BrowserWebSocket { static OPEN = 1; }
globalThis.WebSocket = BrowserWebSocket;
globalThis.window = { WebSocket: BrowserWebSocket, AudioContext: class {}, AudioWorkletNode: class {}, setTimeout };
globalThis.location = { protocol: 'http:', host: 'localhost:7100' };

const { FunASRSpeechToTextAdapter } = await import('../js/voice/funasr-speech-to-text-adapter.js');

class MockSocket {
  static OPEN = 1;
  constructor() { this.readyState = MockSocket.OPEN; this.sent = []; }
  send(value) { this.sent.push(value); }
  close() { this.readyState = 3; }
  open() { return this.onopen?.(); }
  final(text) { this.onmessage?.({ data: JSON.stringify({ type: 'final_transcript', text }) }); }
  delayedClose() { this.readyState = 3; this.onclose?.(); }
}

const sockets = [];
const captures = [];
const adapter = new FunASRSpeechToTextAdapter({
  sessionFetcher: async () => ({ ok: true, json: async () => ({ session_id: 'session', websocket_url: '/api/voice/stream' }) }),
  socketFactory: () => { const socket = new MockSocket(); sockets.push(socket); return socket; },
  captureFactory: () => {
    const capture = {
      starts: 0, stops: 0,
      async start() { this.starts += 1; },
      async stop() { this.stops += 1; },
    };
    captures.push(capture);
    return capture;
  },
});

let previousSocket = null;
for (let index = 0; index < 10; index += 1) {
  const recognition = adapter.listen();
  await Promise.resolve();
  await Promise.resolve();
  const socket = sockets[index];
  assert.ok(socket, `round ${index + 1} should create a socket`);
  await socket.open();
  assert.equal(captures[index].starts, 1);

  // Simulate the previous network close arriving after this round has started.
  previousSocket?.delayedClose();
  assert.equal(captures[index].stops, 0, 'an earlier close must not stop the active microphone');

  await adapter.stop();
  assert.equal(captures[index].stops, 1);
  assert.match(String(socket.sent.at(-1)), /"type":"stop"/);
  socket.final(`round-${index + 1}`);
  assert.equal(await recognition, `round-${index + 1}`);
  previousSocket = socket;
}

previousSocket.delayedClose();
adapter.destroy();
assert.equal(captures.every((capture) => capture.stops >= 1), true);

// A recognizer that never sends a final result must time out and free the next turn.
const timeoutSockets = [];
const timeoutAdapter = new FunASRSpeechToTextAdapter({
  finalResponseTimeoutMs: 1000,
  sessionFetcher: async () => ({ ok: true, json: async () => ({ session_id: 'timeout-session', websocket_url: '/api/voice/stream' }) }),
  socketFactory: () => { const socket = new MockSocket(); timeoutSockets.push(socket); return socket; },
  captureFactory: () => ({ async start() {}, async stop() {} }),
});
const timedRecognition = timeoutAdapter.listen();
await Promise.resolve(); await Promise.resolve();
await timeoutSockets[0].open();
await timeoutAdapter.stop();
await assert.rejects(timedRecognition, /VOICE_FINAL_TIMEOUT/);
const recoveredRecognition = timeoutAdapter.listen();
await Promise.resolve(); await Promise.resolve();
await timeoutSockets[1].open();
await timeoutAdapter.stop();
timeoutSockets[1].final('recovered');
assert.equal(await recoveredRecognition, 'recovered');
timeoutAdapter.destroy();
console.log('voice session lifecycle tests passed (10 consecutive rounds)');
