#!/usr/bin/env python3
"""App Store 스크린샷에 마케팅 문구를 얹어 합성한다.

입력: ~/Desktop/jumo-appstore-screenshots/*.png (시뮬레이터 원본, 1242x2688)
출력: 같은 폴더의 framed/ (동일 규격 1242x2688, 상단 문구 + 라운드 처리된 화면)

앱과 같은 다크 톤·브랜드 옐로를 쓰고, 큰 제목은 자간을 좁혀(-0.02em 상당)
크기가 커질수록 글자가 벌어져 보이는 현상을 보정한다.
"""
import os
from PIL import Image, ImageDraw, ImageFont

SRC = os.path.expanduser('~/Desktop/jumo-appstore-screenshots')
OUT = os.path.join(SRC, 'framed')
W, H = 1242, 2688

BG_TOP = (14, 14, 17)
BG_BOTTOM = (8, 8, 10)
ACCENT = (245, 196, 0)
TITLE_C = (255, 255, 255)
SUB_C = (255, 255, 255, 150)

FONT = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
BOLD, MEDIUM = 6, 2

# 화면별 문구: (제목 2줄, 부제)
CAPTIONS = {
    '1-home.png':          (['해외 한국 선수 경기,', '한 화면에'],   '오늘 누가 뛰는지 바로 확인'),
    '2-schedule.png':      (['지난 결과부터', '다음 경기까지'],      '날짜별로 한국 선수 일정만 모아서'),
    '3-players.png':       (['내 선수만 골라', '한눈에 비교'],       '골 · 도움 · 경기 · 평점'),
    '4-player-detail.png': (['선수 기록을', '더 깊이'],             '최근 폼과 경기별 활약까지'),
    '5-match-detail.png':  (['경기 흐름과', '실제 라인업까지'],      '이벤트 · 통계 · 라인업'),
}


def gradient_bg():
    bg = Image.new('RGB', (W, H), BG_TOP)
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(
            int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)))
    return bg


def draw_tracked(draw, xy, text, font, fill, tracking=0):
    """자간(tracking, px)을 적용해 한 줄을 그린다. 반환: 그린 폭."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x - xy[0] - (tracking if text else 0)


def tracked_width(draw, text, font, tracking=0):
    w = sum(draw.textlength(c, font=font) for c in text)
    return w + tracking * max(0, len(text) - 1)


def rounded_top(img, radius):
    """상단만 라운드. 화면이 캔버스 하단까지 자연스럽게 이어지게 한다."""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    md.rectangle([0, h - radius - 1, w - 1, h - 1], fill=255)   # 하단 코너는 직각으로
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def compose(name):
    shot = Image.open(os.path.join(SRC, name)).convert('RGB')
    lines, sub = CAPTIONS[name]

    canvas = gradient_bg()
    d = ImageDraw.Draw(canvas)

    f_title = ImageFont.truetype(FONT, 92, index=BOLD)
    f_sub = ImageFont.truetype(FONT, 44, index=MEDIUM)
    TRACK = -2.0                     # 큰 제목은 자간을 좁힌다

    # 상단 액센트 바
    bar_y = 150
    d.rounded_rectangle([84, bar_y, 84 + 96, bar_y + 10], radius=5, fill=ACCENT)

    # 제목 (2줄, 타이트한 행간)
    y = bar_y + 58
    for ln in lines:
        draw_tracked(d, (84, y), ln, f_title, TITLE_C, TRACK)
        y += 108

    # 부제 (본문 톤이라 자간은 기본값 유지)
    y += 16
    d.text((86, y), sub, font=f_sub, fill=(168, 168, 176))

    # 앱 화면: 폭 980, 상단만 라운드 — 하단은 캔버스 끝까지 이어지게 배치해
    # 어중간하게 잘린 느낌 없이 콘텐츠를 최대한 크게 보여준다.
    sw = 980
    sh = round(shot.height * sw / shot.width)
    sx, sy = (W - sw) // 2, H - sh          # 바닥에 딱 맞춤
    small = rounded_top(shot.resize((sw, sh), Image.LANCZOS), 44)

    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [sx + 4, sy + 12, sx + sw + 4, H - 1], radius=44, fill=(0, 0, 0, 165))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), shadow).convert('RGB')

    canvas.paste(small, (sx, sy), small)

    # 화면 상단·측면에 은은한 밝은 테두리(재료에 빛이 닿는 느낌)
    d2 = ImageDraw.Draw(canvas, 'RGBA')
    d2.rounded_rectangle([sx, sy, sx + sw, H + 44], radius=44,
                         outline=(255, 255, 255, 40), width=2)

    assert canvas.size == (W, H), canvas.size
    return canvas


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in sorted(CAPTIONS):
        path = os.path.join(SRC, name)
        if not os.path.exists(path):
            print(f'  건너뜀(원본 없음): {name}')
            continue
        img = compose(name)
        dest = os.path.join(OUT, name)
        img.save(dest, 'PNG')
        print(f'  {name}  ->  framed/{name}  {img.size[0]}x{img.size[1]}  '
              f'{os.path.getsize(dest)//1024}KB')


if __name__ == '__main__':
    main()
