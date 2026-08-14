// MediaPipe Worker client: transferable ImageBitmap frames with latest-frame-wins.
export function createWorkerClient({ onLandmarks, onReady, onNotice, onError } = {}) {
  let worker = null;
  let generation = 0;
  let pendingFrame = false;
  let ready = false;
  let destroyed = false;
  let initPromise = null;
  let initResolve = null;
  let initReject = null;
  let initTimer = 0;

  function settleInit(error) {
    clearTimeout(initTimer);
    initTimer = 0;
    const resolve = initResolve;
    const reject = initReject;
    initResolve = null;
    initReject = null;
    initPromise = null;
    if (error) reject?.(error);
    else resolve?.();
  }

  function handleMessage(event) {
    if (destroyed) return;
    const msg = event.data || {};
    switch (msg.type) {
      case 'ready':
        ready = true;
        onReady?.();
        settleInit();
        break;
      case 'landmarks':
        pendingFrame = false;
        if (msg.generation !== generation) return;
        onLandmarks?.(msg.landmarks, msg.timing, msg.generation);
        break;
      case 'notice':
        onNotice?.(msg.message || 'worker_notice');
        break;
      case 'error': {
        pendingFrame = false;
        const error = new Error(msg.message || 'worker_inference_error');
        if (initReject) settleInit(error);
        else onError?.(error.message);
        break;
      }
      default:
        break;
    }
  }

  function createWorker() {
    const workerUrl = new URL('./worker/mediapipe.worker.js', import.meta.url);
    // MediaPipe's WASM loader uses importScripts(), which is forbidden inside
    // a module Worker. A classic Worker can still use dynamic import() for the
    // ESM vision bundle and remains compatible with the WASM bootstrap.
    const nextWorker = new Worker(workerUrl);
    nextWorker.onmessage = handleMessage;
    nextWorker.onerror = (event) => {
      pendingFrame = false;
      const error = new Error(`worker_error:${event.message || 'unknown'}`);
      if (initReject) settleInit(error);
      else onError?.(error.message);
    };
    return nextWorker;
  }

  async function init(wasmPath, modelPath) {
    if (destroyed) throw new Error('worker_client_destroyed');
    if (ready) return;
    if (initPromise) return initPromise;
    if (!worker) worker = createWorker();

    initPromise = new Promise((resolve, reject) => {
      initResolve = resolve;
      initReject = reject;
      // The self-hosted WASM and hand model total about 17 MB. Production
      // bandwidth can legitimately need close to a minute on a cold cache.
      initTimer = setTimeout(() => settleInit(new Error('worker_init_timeout')), 90000);
      worker.postMessage({
        type: 'init',
        bundlePath: '/vendor/mediapipe/vision_bundle.js',
        wasmPath: wasmPath || '/vendor/mediapipe/',
        modelPath: modelPath || '/vendor/mediapipe/hand_landmarker.task',
      });
    });
    return initPromise;
  }

  function sendFrame(bitmap, cameraFrameTimestamp = 0) {
    if (destroyed || !ready || !worker || pendingFrame) {
      bitmap?.close?.();
      return;
    }
    pendingFrame = true;
    try {
      worker.postMessage({ type: 'frame', bitmap, generation, cameraFrameTimestamp }, [bitmap]);
    } catch (error) {
      pendingFrame = false;
      bitmap?.close?.();
      onError?.(`frame_post_error:${error.message}`);
    }
  }

  function cancelPending() {
    generation += 1;
    pendingFrame = false;
  }

  function stop() {
    if (initReject) settleInit(new Error('worker_init_canceled'));
    cancelPending();
    ready = false;
    worker?.postMessage({ type: 'stop' });
  }

  function destroy() {
    destroyed = true;
    stop();
    worker?.terminate();
    worker = null;
    generation = 0;
  }

  return {
    init,
    sendFrame,
    cancelPending,
    stop,
    destroy,
    isReady: () => ready && !destroyed,
    isBusy: () => pendingFrame,
    generation: () => generation,
  };
}
