function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const length = Math.max(1, Math.round(input.length * toRate / fromRate));
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const weight = position - left;
    output[index] = (input[left] || 0) * (1 - weight) + (input[right] || 0) * weight;
  }
  return output;
}

export function floatToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = Math.max(-1, Math.min(1, Number(input[index]) || 0));
    output[index] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
  }
  return output;
}

export class PcmAudioCapture {
  constructor({ sampleRate = 16000 } = {}) {
    this.sampleRate = sampleRate;
    this.context = null;
    this.stream = null;
    this.node = null;
    this.gain = null;
    this.onChunk = null;
    this.onLevel = null;
  }

  async start({ onChunk, onLevel } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('VOICE_CAPTURE_FAILED');
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule('/js/voice/pcm-audio-worklet.js');
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'sh-crafted-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.node.port.onmessage = ({ data }) => {
      const audio = resample(data, this.context?.sampleRate || this.sampleRate, this.sampleRate);
      const pcm = floatToPcm16(audio);
      if (pcm.byteLength) this.onChunk?.(pcm.buffer);
      let energy = 0;
      for (let index = 0; index < data.length; index += 1) energy += data[index] * data[index];
      this.onLevel?.(Math.sqrt(energy / Math.max(1, data.length)));
    };
    source.connect(this.node);
    this.node.connect(this.gain);
    this.gain.connect(this.context.destination);
    await this.context.resume();
  }

  async stop() {
    this.node?.port && (this.node.port.onmessage = null);
    try { this.node?.disconnect(); this.gain?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((track) => track.stop());
    try { await this.context?.close(); } catch {}
    this.node = null; this.gain = null; this.stream = null; this.context = null;
  }
}
