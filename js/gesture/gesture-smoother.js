// 1 Euro Filter —— 自适应平滑滤波器
// 慢速移动时高平滑（稳定选中节点），快速移动时低平滑（低延迟跟随）
// 参考：G. Casiez, "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input"
const DEFAULT_MIN_CUTOFF = 1.0;   // Hz — 慢速时的截止频率
const DEFAULT_BETA = 0.007;       // 速度系数
const DEFAULT_DCUTOFF = 1.0;      // Hz — 速度估计的截止频率

export function createGestureSmoother(options = {}) {
  const minCutoff = options.minCutoff ?? DEFAULT_MIN_CUTOFF;
  const beta = options.beta ?? DEFAULT_BETA;
  const dcutoff = options.dcutoff ?? DEFAULT_DCUTOFF;

  // 为 x, y, pinch 分别维护状态
  const channels = {
    x: createChannel(),
    y: createChannel(),
    pinch: createChannel(),
  };

  function createChannel() {
    return {
      filtered: null,     // 上次滤波值
      derivative: null,   // 上次速度估计
      lastTimestamp: null,
    };
  }

  function alpha(cutoff, dt) {
    // 1€ Filter 核心：alpha = 1 / (1 + tau / dt)，tau = 1/(2*pi*cutoff)
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  function filterChannel(channel, raw, timestamp, deadZonePx = 0) {
    if (channel.filtered === null || channel.lastTimestamp === null) {
      // 首次输入：直接设置
      channel.filtered = raw;
      channel.derivative = 0;
      channel.lastTimestamp = timestamp;
      return raw;
    }

    const dt = (timestamp - channel.lastTimestamp) / 1000; // 秒
    if (dt <= 0) return channel.filtered;

    // 速度估计（对 dx/dt 做低通滤波）
    const dx = raw - channel.filtered;
    const rawDerivative = dx / dt;
    const alphaDeriv = alpha(dcutoff, dt);
    channel.derivative = channel.derivative === null
      ? rawDerivative
      : channel.derivative + alphaDeriv * (rawDerivative - channel.derivative);

    // 适应速度的截止频率
    const cutoff = minCutoff + beta * Math.abs(channel.derivative);

    // 对原始值做低通滤波
    const alphaFilter = alpha(cutoff, dt);
    const filtered = channel.filtered + alphaFilter * (raw - channel.filtered);

    // 死区：变化小于阈值时保持上次值
    if (deadZonePx > 0 && Math.abs(filtered - channel.filtered) < deadZonePx) {
      channel.lastTimestamp = timestamp;
      return channel.filtered;
    }

    channel.filtered = filtered;
    channel.lastTimestamp = timestamp;
    return filtered;
  }

  function clampRate(channel, value, maxJumpPx) {
    if (channel.filtered === null || maxJumpPx <= 0) return value;
    const delta = value - channel.filtered;
    if (Math.abs(delta) > maxJumpPx) {
      // 异常跳变：限制在 maxJumpPx 内
      return channel.filtered + Math.sign(delta) * maxJumpPx;
    }
    return value;
  }

  return {
    // 平滑指针坐标
    smoothPointer(rawX, rawY, timestamp, { deadZonePx = 4, maxJumpPx = 180 } = {}) {
      // 异常值剔除
      const clampedX = clampRate(channels.x, rawX, maxJumpPx);
      const clampedY = clampRate(channels.y, rawY, maxJumpPx);

      const x = filterChannel(channels.x, clampedX, timestamp, deadZonePx);
      const y = filterChannel(channels.y, clampedY, timestamp, deadZonePx);

      return {
        x,
        y,
        velocity: channels.x.derivative !== null && channels.y.derivative !== null
          ? Math.sqrt(channels.x.derivative ** 2 + channels.y.derivative ** 2)
          : 0,
      };
    },

    // 平滑捏合距离
    smoothPinch(rawDistance, timestamp) {
      return filterChannel(channels.pinch, rawDistance, timestamp, 0);
    },

    // 获取上一次滤波值（手丢失时保持）
    lastPointer() {
      if (channels.x.filtered === null || channels.y.filtered === null) return null;
      return { x: channels.x.filtered, y: channels.y.filtered };
    },

    // 插值过渡（手重新出现时使用）
    interpolateTo(rawX, rawY, timestamp, duration = 120) {
      const last = this.lastPointer();
      if (!last) {
        // 无历史，直接设置
        channels.x.filtered = rawX;
        channels.y.filtered = rawY;
        channels.x.derivative = 0;
        channels.y.derivative = 0;
        channels.x.lastTimestamp = timestamp;
        channels.y.lastTimestamp = timestamp;
        return { x: rawX, y: rawY };
      }
      // 使用快速低通作为过渡（不做线性插值，避免瞬移感）
      return this.smoothPointer(rawX, rawY, timestamp, { deadZonePx: 0, maxJumpPx: 60 });
    },

    reset() {
      for (const key of Object.keys(channels)) {
        channels[key].filtered = null;
        channels[key].derivative = null;
        channels[key].lastTimestamp = null;
      }
    },

    // 调试：获取内部状态
    _debug() {
      return {
        x: { filtered: channels.x.filtered, derivative: channels.x.derivative },
        y: { filtered: channels.y.filtered, derivative: channels.y.derivative },
        pinch: { filtered: channels.pinch.filtered, derivative: channels.pinch.derivative },
      };
    },
  };
}
