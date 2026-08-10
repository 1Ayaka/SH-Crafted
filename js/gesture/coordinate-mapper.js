// 坐标映射管线：镜像 → 裁切修正 → 校准 → 视口坐标 → NDC
// 处理自拍摄像头、object-fit cover、页面滚动、Three.js 非全屏画布
export function createCoordinateMapper(options = {}) {
  let viewportWidth = options.viewportWidth || (typeof window !== 'undefined' ? window.innerWidth : 1920);
  let viewportHeight = options.viewportHeight || (typeof window !== 'undefined' ? window.innerHeight : 1080);
  let calibration = options.calibration || null; // { centerX, centerY, rangeX, rangeY } | null
  let videoWidth = options.videoWidth || 640;
  let videoHeight = options.videoHeight || 480;
  let mirrored = options.mirrored !== undefined ? options.mirrored : true;
  let edgeInsetX = Math.max(0, Math.min(0.24, Number(options.edgeInsetX ?? 0.10)));
  let edgeInsetY = Math.max(0, Math.min(0.24, Number(options.edgeInsetY ?? 0.10)));
  let screenOffsetXRatio = Math.max(-0.12, Math.min(0.12, Number(options.screenOffsetXRatio ?? 0)));
  let screenOffsetYRatio = Math.max(-0.12, Math.min(0.12, Number(options.screenOffsetYRatio ?? 0)));

  const api = {
    // 更新视口尺寸（resize 时调用）
    setViewport(width, height) {
      viewportWidth = width || viewportWidth;
      viewportHeight = height || viewportHeight;
    },

    // 更新视频源尺寸
    setVideoSize(width, height) {
      videoWidth = width || videoWidth;
      videoHeight = height || videoHeight;
    },

    // 设置镜像
    setMirrored(value) {
      mirrored = Boolean(value);
    },

    setEdgeInsets(x, y = x) {
      edgeInsetX = Math.max(0, Math.min(0.24, Number(x ?? edgeInsetX)));
      edgeInsetY = Math.max(0, Math.min(0.24, Number(y ?? edgeInsetY)));
    },

    setScreenOffset(xRatio, yRatio = xRatio) {
      screenOffsetXRatio = Math.max(-0.12, Math.min(0.12, Number(xRatio ?? screenOffsetXRatio)));
      screenOffsetYRatio = Math.max(-0.12, Math.min(0.12, Number(yRatio ?? screenOffsetYRatio)));
    },

    // 设置/清除校准数据
    setCalibration(cal) {
      calibration = cal || null;
    },

    // 主映射：MediaPipe 归一化坐标 [0,1] → 网页坐标
    // landmarkX, landmarkY: 0–1 (MediaPipe 归一化图像坐标)
    // containerRect: DOMRect of the active Three.js canvas (null for full-viewport)
    landmarkToScreen(landmarkX, landmarkY, containerRect = null) {
      let x = landmarkX;
      let y = landmarkY;

      // 1. 镜像（自拍直觉）
      if (mirrored) x = 1 - x;

      // 2. object-fit cover 裁切修正
      // 视频在隐藏的 <video> 元素中不放缩，不涉及 CSS cover。
      // 但如果视频宽高比与视口不同，需要计算裁切偏移。
      const viewportAspect = viewportWidth / viewportHeight;
      const videoAspect = videoWidth / videoHeight;

      if (videoAspect > viewportAspect) {
        // 视频更宽：横向裁切
        const scale = viewportHeight / videoHeight;
        const renderedWidth = videoWidth * scale;
        const cropX = (renderedWidth - viewportWidth) / 2;
        x = x * renderedWidth - cropX;
        y = y * viewportHeight;
      } else {
        // 视频更高：纵向裁切
        const scale = viewportWidth / videoWidth;
        const renderedHeight = videoHeight * scale;
        const cropY = (renderedHeight - viewportHeight) / 2;
        x = x * viewportWidth;
        y = y * renderedHeight - cropY;
      }

      // 3. 校准映射
      if (calibration) {
        const calX = calibration.centerX ?? 0.5;
        const calY = calibration.centerY ?? 0.5;
        const rangeX = calibration.rangeX || 0.35;
        const rangeY = calibration.rangeY || 0.35;

        // 将舒适范围映射到整个视口
        const normX = (x / viewportWidth);
        const normY = (y / viewportHeight);

        const mappedX = ((normX - (calX - rangeX)) / (rangeX * 2)) * viewportWidth;
        const mappedY = ((normY - (calY - rangeY)) / (rangeY * 2)) * viewportHeight;

        x = Math.max(0, Math.min(viewportWidth, mappedX));
        y = Math.max(0, Math.min(viewportHeight, mappedY));
      }

      // 安全区映射：把摄像头画面的 [inset, 1-inset] 拉伸到完整屏幕。
      // 中心区域保持近似 1:1，手靠近摄像头边缘前就能触达页面边缘。
      if (edgeInsetX > 0 && viewportWidth > 0) {
        const usable = Math.max(0.02, 1 - edgeInsetX * 2);
        x = ((x / viewportWidth - edgeInsetX) / usable) * viewportWidth;
      }
      if (edgeInsetY > 0 && viewportHeight > 0) {
        const usable = Math.max(0.02, 1 - edgeInsetY * 2);
        y = ((y / viewportHeight - edgeInsetY) / usable) * viewportHeight;
      }

      // 最终视觉锚点微调使用视口比例，保证不同分辨率下体感一致。
      x += viewportWidth * screenOffsetXRatio;
      y += viewportHeight * screenOffsetYRatio;

      // Clamp
      x = Math.max(0, Math.min(viewportWidth, x));
      y = Math.max(0, Math.min(viewportHeight, y));

      return { x, y };
    },

    // 视口坐标 → NDC（用于 Three.js raycaster）
    screenToNDC(screenX, screenY, containerRect = null) {
      if (containerRect) {
        const canvasX = screenX - containerRect.left;
        const canvasY = screenY - containerRect.top;
        return {
          x: (canvasX / containerRect.width) * 2 - 1,
          y: -(canvasY / containerRect.height) * 2 + 1,
        };
      }
      return {
        x: (screenX / viewportWidth) * 2 - 1,
        y: -(screenY / viewportHeight) * 2 + 1,
      };
    },

    // 一步到位：landmark → NDC
    landmarkToNDC(landmarkX, landmarkY, containerRect = null) {
      const screen = api.landmarkToScreen(landmarkX, landmarkY, containerRect);
      return api.screenToNDC(screen.x, screen.y, containerRect);
    },

    // 获取当前配置（调试用）
    _debug() {
      return {
        viewportWidth, viewportHeight, videoWidth, videoHeight, mirrored, calibration,
        edgeInsetX, edgeInsetY, screenOffsetXRatio, screenOffsetYRatio,
      };
    },
  };

  return api;
}
