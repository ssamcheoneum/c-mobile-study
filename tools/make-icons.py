#!/usr/bin/env python3
"""PWA 아이콘(192/512 + maskable) 생성기.

외부 패키지 없이 표준 라이브러리(zlib, struct)만으로 PNG를 직접 인코딩한다.
아이콘을 다시 만들려면:  python tools/make-icons.py
"""

import math
import os
import struct
import zlib

ACCENT = (46, 111, 82)      # --accent  #2E6F52
INK = (230, 237, 232)       # --code-fg #E6EDE8
SS = 3                      # 안티에일리어싱용 슈퍼샘플링 배수


def write_png(path, size, sample):
    """sample(x, y) -> (r, g, b) 를 size×size 로 래스터화해 PNG로 저장한다."""
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    r, g, b, a = sample(x, y)
                    acc[0] += r; acc[1] += g; acc[2] += b; acc[3] += a
            n = SS * SS
            row += bytes(round(v / n) for v in acc)
        rows.append(bytes(row))

    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print(f'{path}  {size}x{size}  {len(png):,} bytes')


def rounded_rect_inside(x, y, size, radius):
    """둥근 사각형 내부인가."""
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return math.hypot(x - cx, y - cy) <= radius


def make_sampler(size, *, maskable):
    """딥그린 바탕에 밝은 'C' 자를 그린다."""
    corner = 0.0 if maskable else size * 0.22
    cx = cy = size / 2
    # maskable 아이콘은 바깥 20%가 잘릴 수 있으므로 글리프를 안쪽으로 줄인다.
    scale = 0.74 if maskable else 1.0
    outer = size * 0.315 * scale
    inner = size * 0.190 * scale
    # 오른쪽으로 열린 틈(±40°)이 C 모양을 만든다.
    gap = math.radians(40)

    def sample(x, y):
        if corner and not rounded_rect_inside(x, y, size, corner):
            return (0, 0, 0, 0)          # 모서리 바깥은 투명
        d = math.hypot(x - cx, y - cy)
        if inner <= d <= outer:
            ang = math.atan2(y - cy, x - cx)
            if abs(ang) > gap:           # 틈이 아닌 곳만 획으로 칠한다
                return (*INK, 255)
        return (*ACCENT, 255)

    return sample


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icons = os.path.join(here, 'icons')
    os.makedirs(icons, exist_ok=True)

    write_png(os.path.join(icons, 'icon-192.png'), 192, make_sampler(192, maskable=False))
    write_png(os.path.join(icons, 'icon-512.png'), 512, make_sampler(512, maskable=False))
    write_png(os.path.join(icons, 'icon-maskable-512.png'), 512, make_sampler(512, maskable=True))


if __name__ == '__main__':
    main()
