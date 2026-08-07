class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const channel = input?.[0];
    if (channel?.length) this.port.postMessage(new Float32Array(channel));
    const output = outputs[0];
    if (output?.[0]) output[0].fill(0);
    return true;
  }
}

registerProcessor('sh-crafted-pcm-capture', PcmCaptureProcessor);
