// 手势性能与延迟测量 —— 仅内存，不上传。
// 记录端到端延迟链：cameraFrame → workerSend → inferenceStart → inferenceEnd →
// workerReceive → mappingTimestamp → renderTimestamp → actionTriggered
const MAX_SAMPLES = 60;

export function createGestureMetrics() {
  const samples = {
    inferenceLatency: [],    // inferenceEnd - inferenceStart (ms)
    transferLatency: [],     // workerReceive - workerSend (ms，往返)
    mappingLatency: [],      // mappingTimestamp - workerReceive (ms)
    e2eLatency: [],          // actionTriggered - cameraFrame (ms)
    frameInterval: [],       // 帧间隔 (ms)
  };

  let lastFrameTimestamp = 0;
  const frameHistory = [];
  const MAX_FRAME_HISTORY = 300; // 5s at 60fps

  function push(sampleArray, value) {
    sampleArray.push(value);
    if (sampleArray.length > MAX_SAMPLES) sampleArray.shift();
  }

  function percentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  return {
    // 每帧调用
    recordFrame({ cameraFrameTimestamp, workerSendTimestamp, inferenceStartTimestamp, inferenceEndTimestamp, workerReceiveTimestamp, mappingTimestamp, renderTimestamp, actionTriggeredTimestamp }) {
      const now = performance.now();

      if (inferenceEndTimestamp && inferenceStartTimestamp) {
        push(samples.inferenceLatency, inferenceEndTimestamp - inferenceStartTimestamp);
      }
      if (workerReceiveTimestamp && workerSendTimestamp) {
        push(samples.transferLatency, workerReceiveTimestamp - workerSendTimestamp);
      }
      if (mappingTimestamp && workerReceiveTimestamp) {
        push(samples.mappingLatency, mappingTimestamp - workerReceiveTimestamp);
      }
      if (actionTriggeredTimestamp && cameraFrameTimestamp) {
        push(samples.e2eLatency, actionTriggeredTimestamp - cameraFrameTimestamp);
      }
      if (lastFrameTimestamp) {
        push(samples.frameInterval, now - lastFrameTimestamp);
      }
      lastFrameTimestamp = now;

      frameHistory.push({ time: now, hasLandmarks: Boolean(cameraFrameTimestamp) });
      if (frameHistory.length > MAX_FRAME_HISTORY) frameHistory.shift();
    },

    // 丢帧率（最近 5 秒内处理帧占比）
    dropRate() {
      const cutoff = performance.now() - 5000;
      const recent = frameHistory.filter((f) => f.time >= cutoff);
      if (!recent.length) return 0;
      const withLandmarks = recent.filter((f) => f.hasLandmarks).length;
      return 1 - withLandmarks / recent.length;
    },

    // 当前推理帧率
    frameRate() {
      const recent = samples.frameInterval.slice(-30);
      if (recent.length < 2) return 0;
      return 1000 / avg(recent);
    },

    // 推理延迟百分位
    inferenceP50() { return percentile(samples.inferenceLatency, 50); },
    inferenceP95() { return percentile(samples.inferenceLatency, 95); },
    inferenceMax() { return Math.max(0, ...samples.inferenceLatency); },

    // 端到端延迟百分位
    e2eP50() { return percentile(samples.e2eLatency, 50); },
    e2eP95() { return percentile(samples.e2eLatency, 95); },
    e2eMax() { return Math.max(0, ...samples.e2eLatency); },

    // 综合摘要
    summary() {
      return {
        frameRate: this.frameRate(),
        dropRate: this.dropRate(),
        inference: { p50: this.inferenceP50(), p95: this.inferenceP95(), max: this.inferenceMax(), avg: avg(samples.inferenceLatency) },
        e2e: { p50: this.e2eP50(), p95: this.e2eP95(), max: this.e2eMax(), avg: avg(samples.e2eLatency) },
        transferAvg: avg(samples.transferLatency),
        mappingAvg: avg(samples.mappingLatency),
        sampleCount: samples.inferenceLatency.length,
      };
    },

    reset() {
      for (const key of Object.keys(samples)) samples[key].length = 0;
      lastFrameTimestamp = 0;
      frameHistory.length = 0;
    },
  };
}
