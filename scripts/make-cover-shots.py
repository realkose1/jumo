#!/usr/bin/env python3
"""App Store 미리보기 맨 앞에 놓는 '커버' 2장을 만든다.

앱 화면만 6장 나열하면 스크롤 중에 눈에 안 걸린다. 첫 두 장은 큰 카피 +
기울인 기기 목업으로 '무슨 앱인지'를 3초에 전달하는 역할만 한다.

입력: ~/Desktop/jumo-appstore-screenshots/*.png (시뮬레이터 원본)
출력: 같은 폴더의 framed/0a-cover.png, 0b-cover.png (1242x2688)

주의: 카피에 선수 실명·구단·리그명을 쓰지 않는다(4.1(a) 반려 이력).
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = os.path.expanduser('~/Desktop/jumo-appstore-screenshots')
OUT = os.path.join(SRC, 'framed')
W, H = 1242, 2688

ACCENT = (245, 196, 0)
WHITE = (255, 255, 255)
DIM = (150, 150, 160)

FDIR = os.path.expanduser('~/Library/Fonts')
F_BLACK = os.path.join(FDIR, 'Pretendard-Black.otf')
F_BOLD = os.path.join(FDIR, 'Pretendard-Bold.otf')
F_MED = os.path.join(FDIR, 'Pretendard-Medium.otf')


def bg():
    """세로 그라데이션 + 좌상단 옐로 글로우 + 옅은 대각 스트라이프."""
    top, bot = (17, 17, 21), (7, 7, 9)
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))

    # 옐로 글로우 — 작은 캔버스에 그려서 확대(블러보다 싸고 부드럽다)
    gs = 64
    g = Image.new('L', (gs, gs), 0)
    gd = ImageDraw.Draw(g)
    for r in range(gs // 2, 0, -1):
        gd.ellipse([gs / 2 - r, gs / 2 - r, gs / 2 + r, gs / 2 + r],
                   fill=int(70 * (1 - r / (gs / 2)) ** 1.6))
    g = g.resize((1500, 1500), Image.BICUBIC)
    glow = Image.new('RGB', (1500, 1500), ACCENT)
    img.paste(glow, (-420, -380), g)

    # 대각 스트라이프
    st = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(st)
    for x in range(-H, W, 120):
        sd.line([(x, H), (x + H, 0)], fill=(255, 255, 255, 6), width=34)
    return Image.alpha_composite(img.convert('RGBA'), st).convert('RGB')


def phone(name, width, angle):
    """스크린샷을 기기 목업으로 만들어 기울인다. 반환: RGBA(그림자 포함)."""
    shot = Image.open(os.path.join(SRC, name)).convert('RGB')
    h = round(shot.height * width / shot.width)
    shot = shot.resize((width, h), Image.LANCZOS)

    r = round(width * 0.085)
    mask = Image.new('L', (width, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, h - 1], radius=r, fill=255)
    screen = shot.convert('RGBA')
    screen.putalpha(mask)

    # 베젤
    bez = round(width * 0.022)
    fw, fh = width + bez * 2, h + bez * 2
    frame = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fd.rounded_rectangle([0, 0, fw - 1, fh - 1], radius=r + bez, fill=(28, 28, 32, 255))
    fd.rounded_rectangle([0, 0, fw - 1, fh - 1], radius=r + bez,
                         outline=(120, 120, 130, 255), width=3)
    frame.paste(screen, (bez, bez), screen)

    rot = frame.rotate(angle, resample=Image.BICUBIC, expand=True)

    pad = 90
    canvas = Image.new('RGBA', (rot.width + pad * 2, rot.height + pad * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    sh.paste((0, 0, 0, 190), (pad, pad + 26), rot.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(38))
    canvas = Image.alpha_composite(canvas, sh)
    canvas.paste(rot, (pad, pad), rot)
    return canvas


def tracked(d, xy, text, font, fill, track=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + track
    return x - xy[0]


def tw(d, text, font, track=0):
    return sum(d.textlength(c, font=font) for c in text) + track * max(0, len(text) - 1)


def badge(canvas, xy, text, font, accent=False):
    # 반투명 알약은 별도 레이어에 그려 합성한다 — RGBA 캔버스에 직접 그리면
    # 알파가 블렌딩되지 않고 불투명하게 덮인다(흰 알약에 흰 글씨가 됐다).
    layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pad_x, pad_y = 30, 18
    w = d.textlength(text, font=font)
    asc, desc = font.getmetrics()
    h = asc + desc
    x, y = xy
    box = [x, y, x + w + pad_x * 2, y + h + pad_y * 2]
    if accent:
        d.rounded_rectangle(box, radius=(h + pad_y * 2) // 2, fill=ACCENT)
        d.text((x + pad_x, y + pad_y), text, font=font, fill=(0, 0, 0))
    else:
        d.rounded_rectangle(box, radius=(h + pad_y * 2) // 2,
                            fill=(255, 255, 255, 30), outline=(255, 255, 255, 85), width=2)
        d.text((x + pad_x, y + pad_y), text, font=font, fill=WHITE)
    canvas.alpha_composite(layer)
    return box[2] - box[0]


def notif_card(width, title, body, when, angle):
    """iOS 알림 배너 모양 카드. 앱이 실제로 보내는 문구를 그대로 쓴다."""
    f_t = ImageFont.truetype(F_BOLD, 38)
    f_b = ImageFont.truetype(F_MED, 36)
    f_w = ImageFont.truetype(F_MED, 30)
    pad, icon = 32, 72
    lines = []
    line = ''
    probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    avail = width - pad * 2 - icon - 22
    for ch in body:
        if probe.textlength(line + ch, font=f_b) > avail and line:
            lines.append(line)
            line = ch
        else:
            line += ch
    lines.append(line)
    lines = lines[:2]

    h = pad * 2 + 46 + len(lines) * 46
    card = Image.new('RGBA', (width, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, width - 1, h - 1], radius=40, fill=(46, 46, 52, 244),
                        outline=(255, 255, 255, 34), width=2)

    ic = Image.open(os.path.join(os.path.dirname(__file__), '..', 'www', 'image',
                                 'branding', 'AppIcon-1024.png')).convert('RGBA')
    ic = ic.resize((icon, icon), Image.LANCZOS)
    m = Image.new('L', (icon, icon), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, icon - 1, icon - 1], radius=18, fill=255)
    card.paste(ic, (pad, pad), m)

    tx = pad + icon + 22
    d.text((tx, pad - 2), title, font=f_t, fill=WHITE)
    d.text((width - pad - d.textlength(when, font=f_w), pad + 4), when, font=f_w,
           fill=(170, 170, 178))
    y = pad + 48
    for ln in lines:
        d.text((tx, y), ln, font=f_b, fill=(214, 214, 222))
        y += 46

    rot = card.rotate(angle, resample=Image.BICUBIC, expand=True)
    p = 70
    out = Image.new('RGBA', (rot.width + p * 2, rot.height + p * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', out.size, (0, 0, 0, 0))
    sh.paste((0, 0, 0, 165), (p, p + 18), rot.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    out = Image.alpha_composite(out, sh)
    out.paste(rot, (p, p), rot)
    return out


def cover_a():
    c = bg().convert('RGBA')
    d = ImageDraw.Draw(c)

    f_kick = ImageFont.truetype(F_BOLD, 46)
    f_mid = ImageFont.truetype(F_BOLD, 84)
    f_big = ImageFont.truetype(F_BLACK, 158)
    f_badge = ImageFont.truetype(F_BOLD, 38)

    x = 92
    d.rounded_rectangle([x, 196, x + 104, 206], radius=5, fill=ACCENT)
    tracked(d, (x, 244), 'JUMO · 주모', f_kick, ACCENT, 2)

    y = 336
    d.text((x, y), '해외에서 뛰는', font=f_mid, fill=DIM)
    y += 126
    tracked(d, (x, y), '우리 선수', f_big, WHITE, -6)
    y += 186
    tracked(d, (x, y), '전부 여기에', f_big, ACCENT, -6)

    ph = phone('1-home.png', 860, -9)
    c.alpha_composite(ph, (W - ph.width + 210, 1080))

    bx = x
    bx += badge(c, (bx, 1044), '축구 · 야구', f_badge, accent=True) + 16
    badge(c, (bx, 1044), '한국 선수만 모아서', f_badge)

    return c.convert('RGB')


def cover_b():
    c = bg().convert('RGBA')
    d = ImageDraw.Draw(c)

    f_mid = ImageFont.truetype(F_BOLD, 84)
    f_big = ImageFont.truetype(F_BLACK, 158)
    f_sub = ImageFont.truetype(F_MED, 44)
    f_badge = ImageFont.truetype(F_BOLD, 38)

    x = 92
    d.rounded_rectangle([x, 196, x + 104, 206], radius=5, fill=ACCENT)

    y = 254
    tracked(d, (x, y), '골 넣으면', f_big, WHITE, -6)
    y += 186
    tracked(d, (x, y), '바로 알림', f_big, ACCENT, -6)
    y += 196
    d.text((x, y), '출전하는 날만, 잠금화면에서 실시간으로', font=f_sub, fill=DIM)

    bx = x
    bx += badge(c, (bx, 800), '라인업 · 킥오프', f_badge, accent=True) + 16
    badge(c, (bx, 800), '골 · 도움 · 종료', f_badge)

    # 피치 화면이 배경, 그 위로 실제 푸시 문구를 띄운 배너 세 장(알림이 쌓이는 모습).
    # 한 선수만 나오지 않게 두 선수를 섞는다.
    ph = phone('2-lineup.png', 800, -7)
    c.alpha_composite(ph, (W - ph.width + 150, 1700))

    cards = [
        ('라인업 발표', 'LA 골든스 vs 솔트레이크 FC — 손흥민이 선발로 나섭니다.', (10, 950)),
        ('손흥민 골!', "LA 골든스 vs 솔트레이크 FC 경기 23', 손흥민이 골을 터뜨렸습니다!", (80, 1245)),
        ('황희찬 도움!', "겔젠키르헨 FC vs 베를린 SC 경기 67', 황희찬이 도움을 기록했습니다!", (150, 1540)),
    ]
    for title, body, pos in cards:
        c.alpha_composite(notif_card(900, title, body, '지금', -4), pos)

    return c.convert('RGB')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (('0a-cover.png', cover_a), ('0b-cover.png', cover_b)):
        img = fn()
        assert img.size == (W, H), img.size
        p = os.path.join(OUT, name)
        img.save(p, 'PNG')
        print(f'  {name}  {img.size[0]}x{img.size[1]}  {os.path.getsize(p)//1024}KB')


if __name__ == '__main__':
    main()
