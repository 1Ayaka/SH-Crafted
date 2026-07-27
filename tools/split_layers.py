# 一次性预处理：把背景画按亮度拆成 RGBA 图层 + 生成 manifest（供页面分层背景与调色采样）
# 用法:
#   python tools/split_layers.py                          # 默认处理 assets/t01.jpg → assets/bg/
#   python tools/split_layers.py assets/t02.jpg --out assets/bg2   # 地图页背景
# 不修改原图；输出 layer-*.webp + manifest.json
import argparse
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
TARGET_W = 1280  # ≤1600px 宽
QUALITY = 82

# 图层定义（顺序 = 后→前）：role 决定 JS 行为，数值写入 manifest，JS 不硬编码
LAYER_DEFS = [
    {'file': 'layer-wash.webp', 'role': 'wash', 'parallax': 0.22, 'drift': 7, 'speed': 0.00011},
    {'file': 'layer-mid.webp',  'role': 'mid',  'parallax': 0.45, 'drift': 5, 'speed': 0.00016},
    {'file': 'layer-dark.webp', 'role': 'dark', 'parallax': 0.75, 'drift': 0, 'speed': 0},
    {'file': 'layer-gold.webp', 'role': 'gold', 'parallax': 1.0,  'drift': 0, 'speed': 0},
]
# 粒子采样源（前排有墨/有色的图层，形成“重影”）
PARTICLE_SOURCES = ['dark', 'gold']


def smooth(x):
    """0..1 平滑阶跃"""
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def alphas(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return {
        # 暗部墨团：L≤60 全显，L≥140 消失
        'dark': smooth((140 - lum) / 80),
        # 中间调：90→140 渐入，170→220 渐出
        'mid': smooth((lum - 90) / 50) * smooth((220 - lum) / 50),
        # 浅色纸洗：150→190 渐入，230→250 渐出；整体压低保持轻盈
        'wash': smooth((lum - 150) / 40) * smooth((250 - lum) / 30) * 0.6,
        # 金箔点缀：暖色（R>G>B，R-B 差大）且不太浅
        'gold': smooth(np.clip((r - b - 18) / 40, 0, 1) * np.clip((r - g + 12) / 30, 0, 1))
                * smooth((235 - lum) / 60),
    }


def main():
    ap = argparse.ArgumentParser(description='按亮度拆分背景画为 RGBA 图层并生成 manifest')
    ap.add_argument('src', nargs='?', default='assets/t01.jpg', help='源图片路径（默认 assets/t01.jpg）')
    ap.add_argument('--out', default='assets/bg', help='输出目录（默认 assets/bg）')
    args = ap.parse_args()

    src = (ROOT / args.src).resolve()
    out = (ROOT / args.out).resolve()
    if not src.exists():
        raise SystemExit(f'源图片不存在: {src}')
    out.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert('RGB')
    if img.width > TARGET_W:
        h = round(img.height * TARGET_W / img.width)
        img = img.resize((TARGET_W, h), Image.LANCZOS)

    a = np.asarray(img).astype(np.float32)
    bands = alphas(a)

    for spec in LAYER_DEFS:
        role = spec['role']
        al = Image.fromarray((np.clip(bands[role], 0, 1) * 255).astype(np.uint8))
        al = al.filter(ImageFilter.GaussianBlur(1.2))
        rgba = img.copy().convert('RGBA')
        if role == 'gold':  # 金箔略微增艳
            arr = np.asarray(rgba).astype(np.float32)
            arr[..., :3] = np.clip(arr[..., :3] * 1.12, 0, 255)
            rgba = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        rgba.putalpha(al)
        path = out / spec['file']
        rgba.save(path, 'WEBP', quality=QUALITY, method=6)
        cov = (np.asarray(al) > 24).mean() * 100
        print(f"{spec['file']}: {rgba.size} {path.stat().st_size // 1024}KB coverage={cov:.1f}%")

    # 合成校验：图层依次叠在砂色底上应与原图大致接近
    base = Image.new('RGBA', img.size, (232, 220, 199, 255))
    for spec in LAYER_DEFS:
        base.alpha_composite(Image.open(out / spec['file']))
    diff = np.abs(np.asarray(base.convert('RGB')).astype(np.int16)
                  - np.asarray(img).astype(np.int16)).mean()
    print(f'composite mean abs diff vs source: {diff:.1f} / 255')

    manifest = {
        'source': str(Path(args.src).as_posix()),
        'generated_at': datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds'),
        'width': img.width,
        'height': img.height,
        'layers': [
            {k: v for k, v in spec.items()} for spec in LAYER_DEFS
        ],
        'particle_sources': PARTICLE_SOURCES,
    }
    mpath = out / 'manifest.json'
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'manifest.json written: {mpath}')


if __name__ == '__main__':
    main()
