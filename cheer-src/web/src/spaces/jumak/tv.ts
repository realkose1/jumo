// 주막 TV: 캔버스(1024x576)에 경기 피드를 그려 장면의 화면 도형에 입힌다.
// 바뀐 것이 있을 때만 다시 그린다(초당 8번 이하). 글자는 시스템 한글 서체를 쓴다.
import * as THREE from 'three';
import type { TvMatchView, TvPlayerLine, TvView } from '../../cheer/feed';
import type { TallySnapshot } from '../../cheer/tally';
import { ACTION_EMOJI } from './layout';

export const TV_W = 1024;
export const TV_H = 576;

const FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const COLOR = {
  bg0: '#0a0d13',
  bg1: '#161d2b',
  ink: '#ffffff',
  soft: '#b4bccb',
  dim: '#7a8496',
  accent: '#f5c400',
  accentInk: '#1a1400',
  live: '#ff4b4b',
  card: 'rgba(255,255,255,0.055)',
  line: 'rgba(255,255,255,0.12)',
} as const;

/** 다시 그리는 사이의 최소 간격(ms) */
const MIN_REDRAW_MS = 120;

export interface TvBannerState {
  text: string;
  tone: 'goal' | 'info';
  /** performance.now() 기준 끝나는 때 */
  until: number;
}

interface TextOptions {
  size: number;
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  maxWidth?: number;
  minSize?: number;
}

/** 글자를 그린다. maxWidth가 있으면 그 안에 들어갈 때까지 글자 크기를 줄이고, 그래도 넘치면 말줄임표 */
function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOptions): number {
  let size = o.size;
  const weight = o.weight ?? 700;
  const set = (s: number): void => {
    ctx.font = `${weight} ${s}px ${FONT}`;
  };
  set(size);
  if (o.maxWidth) {
    const min = o.minSize ?? Math.max(18, Math.round(o.size * 0.5));
    while (size > min && ctx.measureText(text).width > o.maxWidth) {
      size -= 2;
      set(size);
    }
    if (ctx.measureText(text).width > o.maxWidth) {
      let t = text;
      while (t.length > 1 && ctx.measureText(`${t}…`).width > o.maxWidth) t = t.slice(0, -1);
      text = `${t}…`;
    }
  }
  ctx.fillStyle = o.color ?? COLOR.ink;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = o.baseline ?? 'middle';
  ctx.fillText(text, x, y);
  return size;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pill(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, o: { size: number; bg: string; fg: string; dot?: string; padX?: number }): void {
  ctx.font = `800 ${o.size}px ${FONT}`;
  const padX = o.padX ?? o.size * 0.7;
  const dotW = o.dot ? o.size * 0.9 : 0;
  const tw = ctx.measureText(label).width;
  const w = tw + padX * 2 + dotW;
  const h = o.size * 1.55;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = o.bg;
  ctx.fill();
  let x = cx - w / 2 + padX;
  if (o.dot) {
    ctx.beginPath();
    ctx.arc(x + o.size * 0.24, cy, o.size * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = o.dot;
    ctx.fill();
    x += dotW;
  }
  ctx.fillStyle = o.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, cy + 1);
}

function playerText(p: TvPlayerLine): string {
  return p.badge ? `${p.name} ${p.badge}` : p.name;
}

/** 우리 쪽 이름은 강조색 */
function teamColor(m: TvMatchView, side: 'home' | 'away'): string {
  return m.ours === side || m.ours === 'both' ? COLOR.accent : COLOR.ink;
}

function clockPill(ctx: CanvasRenderingContext2D, m: TvMatchView, cx: number, cy: number, size: number): void {
  if (m.state === 'live') pill(ctx, cx, cy, m.clock || '진행 중', { size, bg: 'rgba(255,75,75,0.2)', fg: COLOR.ink, dot: COLOR.live });
  else if (m.state === 'pre') pill(ctx, cx, cy, m.clock || '곧 시작', { size, bg: 'rgba(255,255,255,0.1)', fg: COLOR.soft });
  else pill(ctx, cx, cy, m.clock || '종료', { size, bg: 'rgba(255,255,255,0.1)', fg: COLOR.soft });
}

function drawScore(ctx: CanvasRenderingContext2D, m: TvMatchView, cx: number, cy: number, size: number): void {
  if (m.state === 'pre') {
    drawText(ctx, 'vs', cx, cy, { size: size * 0.55, weight: 800, color: COLOR.soft });
    return;
  }
  drawText(ctx, m.homeScore, cx - size * 0.42, cy, { size, weight: 800, align: 'right' });
  drawText(ctx, ':', cx, cy - size * 0.04, { size: size * 0.8, weight: 700, color: COLOR.dim });
  drawText(ctx, m.awayScore, cx + size * 0.42, cy, { size, weight: 800, align: 'left' });
}

/** 큰 칸: 첫 경기. compact면 줄여서 아래에 다른 경기를 둘 자리를 남긴다 */
function drawHero(ctx: CanvasRenderingContext2D, m: TvMatchView, top: number, bottom: number, compact: boolean): void {
  const h = bottom - top;
  roundRect(ctx, 24, top, TV_W - 48, h, 26);
  ctx.fillStyle = COLOR.card;
  ctx.fill();
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  const nameSize = compact ? 52 : 60;
  const scoreSize = compact ? 108 : 150;
  const maxPlayers = compact ? 2 : 4;
  const playerSize = compact ? 34 : 40;

  let rowY: number;
  if (compact) {
    // 대회와 시계를 한 줄에
    drawText(ctx, m.comp, 512 - 120, top + 40, { size: 32, weight: 600, color: COLOR.soft, align: 'right', maxWidth: 420 });
    clockPill(ctx, m, 512 + 40 + 78, top + 40, 30);
    rowY = top + h * 0.52;
  } else {
    drawText(ctx, m.comp, 512, top + 46, { size: 36, weight: 600, color: COLOR.soft, maxWidth: 860 });
    clockPill(ctx, m, 512, top + 112, 38);
    rowY = top + h * 0.5 + 22;
  }
  drawScore(ctx, m, 512, rowY, scoreSize);
  drawText(ctx, m.homeName, 178, rowY, { size: nameSize, weight: 800, color: teamColor(m, 'home'), maxWidth: 320, minSize: 28 });
  drawText(ctx, m.awayName, TV_W - 178, rowY, { size: nameSize, weight: 800, color: teamColor(m, 'away'), maxWidth: 320, minSize: 28 });

  // 우리 선수들
  const listTop = rowY + (compact ? nameSize * 0.8 : 100);
  const lines = (list: TvPlayerLine[]): TvPlayerLine[] => [...list].sort((a, b) => b.goals - a.goals).slice(0, maxPlayers);
  for (const [side, cx] of [
    ['home', 178],
    ['away', TV_W - 178],
  ] as const) {
    const list = lines(side === 'home' ? m.homePlayers : m.awayPlayers);
    list.forEach((p, i) => {
      drawText(ctx, playerText(p), cx, listTop + i * (playerSize + 12), {
        size: playerSize,
        weight: p.goals > 0 ? 800 : 600,
        color: p.goals > 0 ? COLOR.ink : COLOR.soft,
        maxWidth: 330,
        minSize: 24,
      });
    });
  }
}

/** 작은 칸: 둘째, 셋째 경기 */
function drawRow(ctx: CanvasRenderingContext2D, m: TvMatchView, top: number, h: number): void {
  roundRect(ctx, 24, top, TV_W - 48, h, 20);
  ctx.fillStyle = COLOR.card;
  ctx.fill();
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  const cy = top + h * 0.5;
  drawText(ctx, m.homeName, 400, cy, { size: 42, weight: 800, color: teamColor(m, 'home'), align: 'right', maxWidth: 300, minSize: 24 });
  drawText(ctx, m.awayName, 624, cy, { size: 42, weight: 800, color: teamColor(m, 'away'), align: 'left', maxWidth: 300, minSize: 24 });
  if (m.state === 'pre') drawText(ctx, 'vs', 512, cy, { size: 38, weight: 800, color: COLOR.soft });
  else {
    drawText(ctx, m.homeScore, 484, cy, { size: 64, weight: 800, align: 'right' });
    drawText(ctx, ':', 512, cy - 3, { size: 52, weight: 700, color: COLOR.dim });
    drawText(ctx, m.awayScore, 540, cy, { size: 64, weight: 800, align: 'left' });
  }
  const scorers = [...m.homePlayers, ...m.awayPlayers].filter((p) => p.goals > 0).map(playerText);
  drawText(ctx, m.comp, 52, top + 26, { size: 26, weight: 600, color: COLOR.dim, align: 'left', maxWidth: 220 });
  if (scorers.length > 0) drawText(ctx, scorers.join('  '), 52, top + h - 26, { size: 28, weight: 700, color: COLOR.soft, align: 'left', maxWidth: 560 });
  clockPill(ctx, m, 910, cy, 28);
}

/** 경기 소식이 한동안 안 올 때: 차분한 주막 이름 카드 */
function drawQuiet(ctx: CanvasRenderingContext2D, view: Extract<TvView, { kind: 'quiet' }>): void {
  drawText(ctx, '🏮', 512, 170, { size: 110 });
  drawText(ctx, view.name, 512, 312, { size: 72, weight: 800, maxWidth: 900, minSize: 36 });
  drawText(ctx, '경기가 시작되면 여기 점수가 떠요', 512, 410, { size: 40, weight: 600, color: COLOR.soft, maxWidth: 900 });
}

function drawIdle(ctx: CanvasRenderingContext2D, view: Extract<TvView, { kind: 'idle' }>): void {
  const next = view.next;
  if (!next) {
    drawText(ctx, '🍶', 512, 170, { size: 110 });
    drawText(ctx, '오늘은 쉬는 날이에요', 512, 310, { size: 70, weight: 800, maxWidth: 900 });
    drawText(ctx, '다음 경기가 정해지면 여기에 나와요', 512, 392, { size: 38, weight: 600, color: COLOR.soft, maxWidth: 900 });
    drawText(ctx, view.name, 512, 480, { size: 36, weight: 700, color: COLOR.dim, maxWidth: 860, minSize: 24 });
    return;
  }
  drawText(ctx, view.name, 512, 44, { size: 30, weight: 700, color: COLOR.dim, maxWidth: 860, minSize: 22 });
  pill(ctx, 512, 130, '다음 경기', { size: 36, bg: COLOR.accent, fg: COLOR.accentInk });
  drawText(ctx, next.comp, 512, 208, { size: 38, weight: 600, color: COLOR.soft, maxWidth: 880 });
  drawText(ctx, next.home, 512, 292, { size: 66, weight: 800, maxWidth: 900, minSize: 34 });
  drawText(ctx, 'vs', 512, 360, { size: 40, weight: 700, color: COLOR.dim });
  drawText(ctx, next.away, 512, 428, { size: 66, weight: 800, maxWidth: 900, minSize: 34 });
  drawText(ctx, `${next.when} 킥오프`, 512, 506, { size: 48, weight: 800, color: COLOR.accent, maxWidth: 900 });
}

function drawBanner(ctx: CanvasRenderingContext2D, b: TvBannerState, pulse: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, TV_W, TV_H);
  const top = 168;
  const h = 240;
  const goal = b.tone === 'goal';
  const g = ctx.createLinearGradient(0, top, TV_W, top);
  if (goal) {
    g.addColorStop(0, '#ffd83a');
    g.addColorStop(0.5, '#f5c400');
    g.addColorStop(1, '#ffd83a');
  } else {
    g.addColorStop(0, '#e9eef8');
    g.addColorStop(1, '#c8d2e6');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, top, TV_W, h);
  ctx.fillStyle = goal ? 'rgba(26,20,0,0.5)' : 'rgba(16,19,26,0.4)';
  ctx.fillRect(0, top, TV_W, 8);
  ctx.fillRect(0, top + h - 8, TV_W, 8);
  const ink = goal ? COLOR.accentInk : '#10131a';
  const bounce = 1 + 0.04 * Math.sin(pulse * Math.PI * 2);
  if (goal) {
    drawText(ctx, '⚽', 74, top + h / 2 + 4, { size: 84 * bounce });
    drawText(ctx, '⚽', TV_W - 74, top + h / 2 + 4, { size: 84 * bounce });
  }
  const maxW = goal ? 770 : 900;
  // 한 줄에 못 들어가면 두 줄로
  ctx.font = `900 76px ${FONT}`;
  if (ctx.measureText(b.text).width > maxW && b.text.includes(' ')) {
    const words = b.text.split(' ');
    const mid = Math.ceil(words.length / 2);
    drawText(ctx, words.slice(0, mid).join(' '), 512, top + h / 2 - 40, { size: 84, weight: 900, color: ink, maxWidth: maxW, minSize: 40 });
    drawText(ctx, words.slice(mid).join(' '), 512, top + h / 2 + 52, { size: 84, weight: 900, color: ink, maxWidth: maxW, minSize: 40 });
  } else {
    drawText(ctx, b.text, 512, top + h / 2 + 4, { size: 124, weight: 900, color: ink, maxWidth: maxW, minSize: 44 });
  }
}

function drawTally(ctx: CanvasRenderingContext2D, t: TallySnapshot, actionIds: readonly string[]): void {
  const top = 486;
  const h = 72;
  roundRect(ctx, 40, top, TV_W - 80, h, h / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fill();
  ctx.strokeStyle = t.phase === 'live' ? COLOR.accent : COLOR.line;
  ctx.lineWidth = 3;
  ctx.stroke();
  drawText(ctx, t.phase === 'live' ? '지금 방의 응원' : '이번 응원 합계', 80, top + h / 2, { size: 30, weight: 700, color: COLOR.soft, align: 'left', maxWidth: 340, minSize: 22 });
  actionIds.forEach((id, i) => {
    const x = 520 + i * 156;
    drawText(ctx, ACTION_EMOJI[id] ?? '', x, top + h / 2 + 2, { size: 40, align: 'left' });
    drawText(ctx, String(t.counts[id] ?? 0), x + 56, top + h / 2 + 2, { size: 46, weight: 800, color: COLOR.ink, align: 'left' });
  });
}

/** 장면 전체를 그린다 (테스트하기 쉽게 캔버스와 분리) */
export function drawTv(
  ctx: CanvasRenderingContext2D,
  view: TvView,
  banner: TvBannerState | null,
  tally: TallySnapshot | null,
  actionIds: readonly string[],
  pulse = 0,
): void {
  // 바탕
  const bg = ctx.createLinearGradient(0, 0, 0, TV_H);
  bg.addColorStop(0, COLOR.bg1);
  bg.addColorStop(1, COLOR.bg0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TV_W, TV_H);

  const tallyOn = tally !== null && tally.phase !== 'off';
  const bottom = tallyOn ? 470 : 560;

  if (view.kind === 'waiting') {
    drawText(ctx, '경기 소식을 불러오는 중이에요', 512, 290, { size: 52, weight: 700, color: COLOR.soft, maxWidth: 900 });
  } else if (view.kind === 'quiet') {
    drawQuiet(ctx, view);
  } else if (view.kind === 'idle') {
    drawIdle(ctx, view);
  } else {
    const list = view.matches;
    if (list.length === 1) {
      drawHero(ctx, list[0]!, 18, bottom, false);
    } else {
      const rows = list.length - 1;
      const rowH = rows === 1 ? 140 : 118;
      const gap = 12;
      const heroBottom = bottom - rows * (rowH + gap);
      drawHero(ctx, list[0]!, 18, heroBottom, true);
      list.slice(1).forEach((m, i) => drawRow(ctx, m, heroBottom + gap + i * (rowH + gap), rowH));
    }
  }

  if (tallyOn && tally) drawTally(ctx, tally, actionIds);

  // 아주 옅은 주사선: TV 같은 느낌
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let y = 0; y < TV_H; y += 4) ctx.fillRect(0, y, TV_W, 1);

  if (banner) drawBanner(ctx, banner, pulse);
}

export class TvScreen {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private view: TvView = { kind: 'waiting' };
  private banner: TvBannerState | null = null;
  private tally: TallySnapshot | null = null;
  private dirty = true;
  private lastDraw = -Infinity;
  private reduced = false;

  constructor(private readonly actionIds: readonly string[], maxAnisotropy = 4) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TV_W;
    this.canvas.height = TV_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('jumak: 캔버스를 쓸 수 없어요');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = maxAnisotropy;
    this.update(performance.now());
  }

  /** 움직임 줄이기: 띄우는 글이 뛰지 않고 한 번만 그린다 */
  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.dirty = true;
  }

  setView(view: TvView): void {
    this.view = view;
    this.dirty = true;
  }

  /** 크게 띄우는 글. ms 동안 */
  showBanner(text: string, tone: 'goal' | 'info', ms: number, now = performance.now()): void {
    this.banner = { text, tone, until: now + ms };
    this.dirty = true;
  }

  get bannerActive(): boolean {
    return this.banner !== null;
  }

  /** null이면 합계 줄을 감춘다 */
  setTally(t: TallySnapshot | null): void {
    const same =
      (t === null && this.tally === null) ||
      (t !== null && this.tally !== null && t.phase === this.tally.phase && t.total === this.tally.total && this.actionIds.every((id) => (t.counts[id] ?? 0) === (this.tally!.counts[id] ?? 0)));
    if (same) return;
    this.tally = t;
    this.dirty = true;
  }

  /** 매 프레임 부른다. 바뀐 게 있으면 다시 그리고 true */
  update(now: number): boolean {
    if (this.banner && now >= this.banner.until) {
      this.banner = null;
      this.dirty = true;
    }
    // 띄우는 글이 있는 동안은 글자가 살짝 뛰도록 조금 더 자주 그린다
    const wantAnimate = this.banner !== null && !this.reduced;
    if (!this.dirty && !wantAnimate) return false;
    if (now - this.lastDraw < MIN_REDRAW_MS) return false;
    this.lastDraw = now;
    this.dirty = false;
    const pulse = this.banner && !this.reduced ? (now % 900) / 900 : 0;
    drawTv(this.ctx, this.view, this.banner, this.tally, this.actionIds, pulse);
    this.texture.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
