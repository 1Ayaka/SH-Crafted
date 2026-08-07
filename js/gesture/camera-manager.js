// 摄像头管理器 —— getUserMedia + requestVideoFrameCallback + track 生命周期
// 参考 voice/adapters.js 的 getUserMedia 错误处理模式
export function createCameraManager({ onFrame, onError } = {}) {
  let stream = null;
  let video = null;
  let rafId = 0;
  let destroyed = false;
  let generation = 0;
  let lastFrameTime = 0;
  let targetFps = 30;
  let minFrameInterval = 1000 / targetFps;

  // 创建隐藏的 <video> 元素用于接收摄像头帧
  function createVideoElement() {
    const el = document.createElement('video');
    el.setAttribute('playsinline', '');
    el.setAttribute('muted', '');
    el.setAttribute('autoplay', '');
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    return el;
  }

  async function start(constraints = {}) {
    if (destroyed) throw new Error('camera_manager_destroyed');

    const videoConstraints = {
      video: {
        facingMode: constraints.facingMode || 'user',
        width: { ideal: constraints.width || 640 },
        height: { ideal: constraints.height || 480 },
        frameRate: { ideal: constraints.frameRate || 30, max: 30 },
      },
      audio: false,
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(videoConstraints);
    } catch (error) {
      const name = error.name || 'UnknownError';
      onError?.({ code: name, message: error.message || '摄像头访问失败', recoverable: name === 'NotAllowedError' });
      throw error;
    }

    video = createVideoElement();
    video.srcObject = stream;
    document.body.appendChild(video);

    return new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(() => {
          generation++;
          startFrameLoop();
          resolve({
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
          });
        }).catch(reject);
      };
      video.onerror = () => reject(new Error('video_element_error'));
      // 超时保护
      setTimeout(() => {
        if (video && video.readyState < 2) {
          reject(new Error('camera_start_timeout'));
        }
      }, 5000);
    });
  }

  function startFrameLoop() {
    if (destroyed || !video) return;

    const frameCallback = () => {
      if (destroyed || !video || !stream || video.readyState < 2) {
        rafId = 0;
        return;
      }

      const now = performance.now();
      // 按目标帧率节流
      if (now - lastFrameTime >= minFrameInterval) {
        lastFrameTime = now;
        const gen = generation;
        try {
          // 使用 createImageBitmap 进行零拷贝传输
          createImageBitmap(video).then((bitmap) => {
            if (destroyed || gen !== generation) {
              bitmap.close();
              return;
            }
            onFrame?.(bitmap, now);
          }).catch((err) => {
            // createImageBitmap 可能因为视频状态不可用而失败
            if (!destroyed && gen === generation) {
              onError?.({ code: 'ImageBitmapError', message: err.message, recoverable: true });
            }
          });
        } catch (err) {
          onError?.({ code: 'FrameCaptureError', message: err.message, recoverable: true });
        }
      }

      if (!destroyed) {
        // 优先使用 requestVideoFrameCallback
        if ('requestVideoFrameCallback' in video) {
          rafId = video.requestVideoFrameCallback(frameCallback);
        } else {
          rafId = requestAnimationFrame(frameCallback);
        }
      }
    };

    frameCallback();
  }

  function stop() {
    generation++; // 使任何进行中的帧回调失效
    if (rafId) {
      if (video && 'cancelVideoFrameCallback' in video) {
        try { video.cancelVideoFrameCallback(rafId); } catch {}
      } else {
        cancelAnimationFrame(rafId);
      }
      rafId = 0;
    }
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      stream = null;
    }
    if (video) {
      video.srcObject = null;
      video.remove();
      video = null;
    }
    lastFrameTime = 0;
  }

  function setTargetFps(fps) {
    targetFps = Math.max(5, Math.min(30, fps));
    minFrameInterval = 1000 / targetFps;
  }

  function destroy() {
    destroyed = true;
    stop();
  }

  function isActive() {
    return Boolean(stream && stream.active && video);
  }

  return {
    start,
    stop,
    destroy,
    setTargetFps,
    isActive,
    getVideoElement: () => video,
    getStream: () => stream,
  };
}
