// MediaPipe Hand Landmarker Web Worker
// 加载 WASM + 模型 → 接收 ImageBitmap → 返回 21 个手部关键点
// 采用 latest-frame-wins 策略：只处理最新帧，丢弃旧帧

let handLandmarker = null;
let running = false;
let currentGeneration = 0;
let FilesetResolver = null;
let HandLandmarker = null;

// 动态导入 MediaPipe vision bundle
async function loadMediaPipeBundle(bundlePath) {
  // Classic Workers allow MediaPipe's internal importScripts() WASM loader.
  // Dynamic import remains available for loading the ESM vision bundle.
  const bundleUrl = new URL(bundlePath || '/vendor/mediapipe/vision_bundle.js', self.location.href).href;
  try {
    const module = await import(bundleUrl);
    FilesetResolver = module.FilesetResolver;
    HandLandmarker = module.HandLandmarker;
  } catch (err) {
    // 备用：尝试从指定的 wasmPath 加载
    throw new Error(`mediapipe_bundle_load_failed:${err.message}`);
  }
}

async function initializeHandLandmarker(wasmPath, modelPath) {
  if (!FilesetResolver || !HandLandmarker) {
    throw new Error('mediapipe_bundle_not_loaded');
  }

  // 解析 WASM 文件路径
  const wasmBase = new URL(wasmPath || '/vendor/mediapipe/', self.location.href).href;
  const modelUrl = new URL(modelPath || '/vendor/mediapipe/hand_landmarker.task', self.location.href).href;

  // 初始化 FilesetResolver
  const vision = await FilesetResolver.forVisionTasks(wasmBase);

  const options = {
    baseOptions: { modelAssetPath: modelUrl },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.65,
    minHandPresenceConfidence: 0.65,
    minTrackingConfidence: 0.6,
  };

  // MediaPipe 不保证 GPU 初始化失败后自动回退。虚拟机、旧显卡或
  // 浏览器限制硬件加速时显式重试 CPU，避免摄像头刚开启就被释放。
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'GPU' },
    });
  } catch (gpuError) {
    try { handLandmarker?.close?.(); } catch {}
    handLandmarker = await HandLandmarker.createFromOptions(vision, options);
    self.postMessage({
      type: 'notice',
      message: `gpu_fallback_to_cpu:${gpuError?.message || 'unavailable'}`,
    });
  }

  return handLandmarker;
}

self.onmessage = async (event) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      try {
        await loadMediaPipeBundle(msg.bundlePath);
        await initializeHandLandmarker(msg.wasmPath, msg.modelPath);
        running = true;
        self.postMessage({ type: 'ready' });
      } catch (error) {
        self.postMessage({
          type: 'error',
          message: `init_failed:${error.message || 'unknown'}`,
        });
      }
      break;
    }

    case 'frame': {
      if (!running || !handLandmarker) {
        // Worker 尚未就绪，忽略帧
        msg.bitmap?.close?.();
        self.postMessage({
          type: 'error',
          message: 'worker_not_ready',
          generation: msg.generation,
        });
        break;
      }

      // 最新帧策略：如果新帧到达，更新当前 generation
      if (msg.generation > currentGeneration) {
        currentGeneration = msg.generation;
      }

      const bitmap = msg.bitmap;
      if (!bitmap) break;

      try {
        const inferenceStart = performance.now();

        // 运行手部关键点检测
        const result = handLandmarker.detectForVideo(bitmap, performance.now());

        const inferenceEnd = performance.now();

        // 提取关键点
        let landmarks = null;
        if (result.landmarks && result.landmarks.length > 0) {
          // 取第一只手（我们只追踪一只手）
          const hand = result.landmarks[0];
          landmarks = new Float32Array(hand.length * 3); // x, y, z for each landmark
          for (let i = 0; i < hand.length; i++) {
            landmarks[i * 3] = hand[i].x;
            landmarks[i * 3 + 1] = hand[i].y;
            landmarks[i * 3 + 2] = hand[i].z;
          }
        }

        // 返回结果（仅在 generation 匹配时）
        self.postMessage({
          type: 'landmarks',
          landmarks,
          handCount: result.landmarks?.length || 0,
          handedness: result.handedness?.[0] || null,
          generation: msg.generation,
          timing: {
            cameraFrameTimestamp: msg.cameraFrameTimestamp || 0,
            inferenceStart,
            inferenceEnd,
            inferenceDuration: inferenceEnd - inferenceStart,
          },
        });

        // 丢弃过期帧
        if (msg.generation < currentGeneration) {
          // 这一帧已经被更新的帧取代了
        }
      } catch (error) {
        self.postMessage({
          type: 'error',
          message: `inference_failed:${error.message || 'unknown'}`,
          generation: msg.generation,
        });
      } finally {
        // 关闭 ImageBitmap 释放内存
        bitmap.close?.();
      }
      break;
    }

    case 'stop': {
      running = false;
      if (handLandmarker) {
        try { handLandmarker.close(); } catch {}
        handLandmarker = null;
      }
      break;
    }

    default:
      break;
  }
};

// Worker 关闭时清理
self.onclose = () => {
  if (handLandmarker) {
    try { handLandmarker.close(); } catch {}
    handLandmarker = null;
  }
  running = false;
};
