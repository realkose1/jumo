// 주막 TV의 '중계' 화면들: 실제 중계처럼 장면이 바뀐다.
//   1) 경기장: 위에서 비스듬히 본 잔디 위로 22명이 움직이고 공이 오간다(가상 중계, 실제 위치 자료가 아니다)
//   2) 선수 카드: 족자에 우리 선수 이름(세로 붓글씨)과 오늘 기록. 사진은 쓰지 않는다
//   3) 점수판: 여러 경기 점수(tv.ts의 기존 화면)
// 장면 순서와 경기장 움직임은 three.js를 모르는 계산이라 시험하기 쉽다. 그리기는 캔버스 2D.
import { benchedOnly, type TvMatchView, type TvPlayerLine } from '../../cheer/feed';
import { PAPER, SERIF, drawPaper, drawSeal, oldClock } from './joseon';

// ---------------------------------------------------------------------------
// 장면 순서
// ---------------------------------------------------------------------------

/** match는 TV에 올린 경기 목록(view.matches)의 몇 번째 경기인가 */
export type BroadcastScene =
  | { kind: 'pitch'; match: number }
  | { kind: 'player'; match: number; index: number }
  | { kind: 'scores' };

/** 진행 중 축구 경기의 경기장 화면, 선수 카드 한 장, 점수판 */
const PITCH_MS = 20_000;
const CARD_MS = 7_000;
const SCORES_MS = 7_000;
/** 경기장 화면이 하나도 없으면(시작 전·야구·끝) 점수판을 더 길게 */
const CALM_SCORES_MS = 12_000;

/** 우리 선수 목록 (골 많은 순) */
export function ourPlayers(m: TvMatchView): Array<TvPlayerLine & { side: 'home' | 'away' }> {
  return [
    ...m.homePlayers.map((p) => ({ ...p, side: 'home' as const })),
    ...m.awayPlayers.map((p) => ({ ...p, side: 'away' as const })),
  ].sort((a, b) => b.goals - a.goals);
}

/** 지금 그라운드에 있는(또는 있는지 모르는) 선수인가. 벤치에서 기다리거나 교체돼 나간 선수는 아니다 */
export function onPitch(p: TvPlayerLine): boolean {
  return p.role !== 'bench' && p.role !== 'off';
}

/**
 * 선수 카드 머리말과, 골이 없을 때 기록 칸에 적는 말. 벤치 선수를 '출전 중'으로 적지 않는다(제보: 벤치 대기인 배준호).
 * 출전 정보를 모르면 예전처럼 적는다.
 */
export function playerCardText(state: TvMatchView['state'], role: TvPlayerLine['role'], unit: string): { head: string; idle: string } {
  if (role === 'bench' && state !== 'final') return { head: '待機 · 벤치 대기', idle: '교체 투입 대기' };
  if (state === 'live') {
    if (role === 'off') return { head: '交替 · 교체 아웃', idle: '교체되어 쉬는 중' };
    return { head: role === 'in' ? '出戰 · 교체 출전 중' : '出戰 · 출전 중', idle: `${unit}을 기다리는 중` };
  }
  if (state === 'pre') return { head: role === 'start' ? '先發 · 선발 출전' : '오늘의 출전', idle: '출전 대기' };
  return { head: '오늘의 겨룸', idle: `${unit}을 기다리는 중` };
}

/**
 * 한 바퀴의 장면 순서. 경기가 겹치면 주막을 나누지 않고 한 TV가 경기마다 돌아가며 보여 준다:
 *   경기마다 (진행 중 축구면 경기장 화면) -> 그 경기 우리 선수 카드들, 마지막에 모든 경기 점수판.
 * 우리 선수가 모두 벤치에 있거나 교체돼 나간 경기는 경기장 화면을 건너뛰어, 우리 선수가 뛰는 경기에 TV를 몰아준다.
 */
export function broadcastPlaylist(matches: readonly TvMatchView[]): Array<{ scene: BroadcastScene; ms: number }> {
  const list: Array<{ scene: BroadcastScene; ms: number }> = [];
  let pitches = 0;
  matches.forEach((m, i) => {
    if (m.state === 'live' && m.sport === 'soccer' && !benchedOnly(ourPlayers(m))) {
      list.push({ scene: { kind: 'pitch', match: i }, ms: PITCH_MS });
      pitches++;
    }
    ourPlayers(m).forEach((_, j) => list.push({ scene: { kind: 'player', match: i, index: j }, ms: CARD_MS }));
  });
  list.push({ scene: { kind: 'scores' }, ms: pitches > 0 ? SCORES_MS : CALM_SCORES_MS });
  return list;
}

/**
 * 지금 보여줄 장면. t는 벽시계(Date.now()) 기준이라 같은 방 사람들은 거의 같은 순간에 같은 장면을 본다.
 * 점수판부터 시작하지 않도록 한 바퀴의 처음은 첫 경기다.
 */
export function sceneAt(matches: readonly TvMatchView[], t: number): BroadcastScene {
  const list = broadcastPlaylist(matches);
  const cycle = list.reduce((n, s) => n + s.ms, 0);
  let p = ((t % cycle) + cycle) % cycle;
  for (const s of list) {
    if (p < s.ms) return s.scene;
    p -= s.ms;
  }
  return { kind: 'scores' };
}

/** 같은 장면인가 (바뀌었으면 다시 그린다) */
export function sameScene(a: BroadcastScene, b: BroadcastScene): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'scores') return true;
  if (a.kind === 'pitch') return a.match === (b as { match: number }).match;
  const bb = b as { match: number; index: number };
  return a.match === bb.match && a.index === bb.index;
}

/** 경기 id에서 경기장 움직임의 씨앗 (같은 경기는 누구 화면에서나 같은 출발) */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

// ---------------------------------------------------------------------------
// 경기장 움직임 (가상)
// ---------------------------------------------------------------------------
// 좌표: x 0(홈 골문)~1(원정 골문), y 0~1(경기장 폭). 홈은 +x로 공격한다.

interface SimPlayer {
  team: 0 | 1; // 0 홈, 1 원정
  role: number; // 0 골키퍼, 1 수비, 2 미드필더, 3 공격
  bx: number;
  by: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wob: number;
}

/** 4-3-3. [x, y, 역할] (홈 기준, 원정은 x를 뒤집는다) */
const FORMATION: Array<[number, number, number]> = [
  [0.04, 0.5, 0],
  [0.2, 0.14, 1],
  [0.18, 0.38, 1],
  [0.18, 0.62, 1],
  [0.2, 0.86, 1],
  [0.36, 0.26, 2],
  [0.34, 0.5, 2],
  [0.36, 0.74, 2],
  [0.5, 0.18, 3],
  [0.52, 0.5, 3],
  [0.5, 0.82, 3],
];

/** 우리 선수로 보여 줄 자리(공격형 미드필더 쪽) */
export const OUR_SLOT = 6;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export class PitchSim {
  readonly players: SimPlayer[] = [];
  ball = { x: 0.5, y: 0.5, z: 0 };
  private carrier = 9;
  private target = -1;
  private flight = 0; // 0~1, 공이 날아가는 중
  private flightTime = 1;
  private from = { x: 0.5, y: 0.5 };
  private to = { x: 0.5, y: 0.5 };
  private hold = 1;
  private shot = false;
  private readonly rand: () => number;
  /** 화면이 따라가는 곳 (공을 부드럽게 따라간다) */
  camX = 0.5;

  constructor(seed = 1) {
    this.rand = rng(seed);
    for (const team of [0, 1] as const) {
      for (const [fx, fy, role] of FORMATION) {
        const bx = team === 0 ? fx : 1 - fx;
        const by = team === 0 ? fy : 1 - fy;
        this.players.push({ team, role, bx, by, x: bx, y: by, vx: 0, vy: 0, wob: this.rand() * 10 });
      }
    }
    const c = this.players[this.carrier]!;
    this.ball.x = c.x;
    this.ball.y = c.y;
  }

  get possession(): 0 | 1 {
    return this.players[this.carrier]!.team;
  }

  /** 우리 선수의 번호(배열 자리). side는 우리 팀이 홈이냐 원정이냐 */
  ourIndex(side: 'home' | 'away'): number {
    return (side === 'home' ? 0 : 11) + OUR_SLOT;
  }

  private pickNext(): void {
    const me = this.players[this.carrier]!;
    const dir = me.team === 0 ? 1 : -1;
    const attackDepth = me.team === 0 ? me.x : 1 - me.x;
    const r = this.rand();
    // 상대 골문 가까이면 슈팅
    if (attackDepth > 0.72 && r < 0.35) {
      this.shot = true;
      this.from = { x: this.ball.x, y: this.ball.y };
      const gx = me.team === 0 ? 1.0 : 0.0;
      this.to = { x: gx, y: 0.5 + (this.rand() - 0.5) * 0.12 };
      this.flightTime = 0.7;
      this.flight = 0;
      // 골키퍼가 막는다
      this.target = me.team === 0 ? 11 : 0;
      return;
    }
    // 빼앗김
    if (r < 0.5 && this.rand() < 0.22) {
      let best = -1;
      let bestD = Infinity;
      this.players.forEach((p, i) => {
        if (p.team === me.team || p.role === 0) return;
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      this.passTo(best, 0.5);
      return;
    }
    // 같은 편에게 패스 (앞쪽을 더 좋아한다)
    let best = -1;
    let bestScore = -Infinity;
    this.players.forEach((p, i) => {
      if (p.team !== me.team || i === this.carrier || p.role === 0) return;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d > 0.42) return;
      const forward = (p.x - me.x) * dir;
      const score = forward * 1.4 - Math.abs(d - 0.18) + this.rand() * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) best = me.team === 0 ? 6 : 17;
    this.passTo(best, 0.6 + this.rand() * 0.5);
  }

  private passTo(i: number, time: number): void {
    const p = this.players[i]!;
    this.target = i;
    this.shot = false;
    this.from = { x: this.ball.x, y: this.ball.y };
    // 받는 사람이 갈 곳을 조금 앞서 노린다
    this.to = { x: p.x + p.vx * time * 0.6, y: p.y + p.vy * time * 0.6 };
    this.flightTime = time;
    this.flight = 0;
  }

  /** dt초만큼 움직인다 */
  step(dt: number): void {
    dt = Math.min(dt, 0.1);
    const carrier = this.players[this.carrier]!;
    // 공
    if (this.target >= 0) {
      this.flight += dt / this.flightTime;
      const k = Math.min(1, this.flight);
      this.ball.x = this.from.x + (this.to.x - this.from.x) * k;
      this.ball.y = this.from.y + (this.to.y - this.from.y) * k;
      this.ball.z = (this.shot ? 0.04 : 0.025) * Math.sin(Math.PI * k) * (this.flightTime > 0.8 ? 1.6 : 1);
      if (k >= 1) {
        this.carrier = this.target;
        this.target = -1;
        this.ball.z = 0;
        this.hold = 0.5 + this.rand() * 1.3;
        if (this.shot) this.hold = 1.2; // 골키퍼가 잡고 잠깐 쉰다
        this.shot = false;
      }
    } else {
      // 몰고 간다
      const dir = carrier.team === 0 ? 1 : -1;
      this.ball.x = carrier.x + dir * 0.012;
      this.ball.y = carrier.y;
      this.hold -= dt;
      if (this.hold <= 0) this.pickNext();
    }
    // 사람들: 자기 자리 + 공 쪽으로 쏠림
    const poss = this.possession;
    const ballX = this.ball.x;
    const ballY = this.ball.y;
    this.players.forEach((p, i) => {
      let tx: number;
      let ty: number;
      if (i === this.carrier && this.target < 0) {
        const dir = p.team === 0 ? 1 : -1;
        tx = p.x + dir * 0.05;
        ty = p.y + Math.sin(p.wob * 3) * 0.02;
      } else if (i === this.target) {
        tx = this.to.x;
        ty = this.to.y;
      } else {
        const attacking = p.team === poss;
        const shift = p.role === 0 ? 0.08 : 0.42;
        const push = attacking ? (p.team === 0 ? 0.08 : -0.08) : p.team === 0 ? -0.05 : 0.05;
        tx = p.bx + (ballX - 0.5) * shift + push * (p.role === 0 ? 0 : 1);
        ty = p.by + (ballY - p.by) * (p.role === 0 ? 0.25 : 0.18);
        // 수비 쪽 가장 가까운 사람은 공에 붙는다
        if (!attacking && p.role !== 0 && Math.hypot(p.x - ballX, p.y - ballY) < 0.1) {
          tx = ballX;
          ty = ballY;
        }
        p.wob += dt * 0.7;
        tx += Math.sin(p.wob) * 0.012;
        ty += Math.cos(p.wob * 1.3) * 0.012;
      }
      tx = Math.min(0.99, Math.max(0.01, tx));
      ty = Math.min(0.98, Math.max(0.02, ty));
      const speed = 0.16;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const want = Math.min(speed, d * 3);
      const ax = d > 1e-4 ? (dx / d) * want : 0;
      const ay = d > 1e-4 ? (dy / d) * want : 0;
      const k = 1 - Math.exp(-6 * dt);
      p.vx += (ax - p.vx) * k;
      p.vy += (ay - p.vy) * k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    });
    this.camX += (Math.min(0.64, Math.max(0.36, this.ball.x)) - this.camX) * (1 - Math.exp(-1.6 * dt));
  }
}

// ---------------------------------------------------------------------------
// 그리기
// ---------------------------------------------------------------------------

// 글꼴은 조선풍 명조. 경기장 그림은 그대로 두고 점수 패, 선수 카드만 한지와 먹, 낙관으로
const FONT = SERIF;

/** 화면에서 경기장이 차지하는 곳 */
interface View {
  top: number;
  bottom: number;
  /** 위(먼 쪽)와 아래(가까운 쪽) 가장자리에서 보이는 경기장 길이의 폭(px) */
  wFar: number;
  wNear: number;
  /** 화면 가로에 보이는 경기장 길이(0~1 중 얼마만큼) */
  span: number;
  camX: number;
}

function project(v: View, x: number, y: number, z = 0): { sx: number; sy: number; s: number } {
  // y: 0(먼 쪽 터치라인) ~ 1(가까운 쪽)
  const d = Math.pow(y, 1.12);
  const sy = v.top + (v.bottom - v.top) * d;
  const w = v.wFar + (v.wNear - v.wFar) * d;
  const sx = 512 + ((x - v.camX) / v.span) * w;
  const s = w / v.wNear;
  return { sx, sy: sy - z * 900 * s, s };
}

const KIT = { home: '#f4f4f4', homeTrim: '#2b3a55', away: '#e2433b', awayTrim: '#ffffff' };

export interface PitchDrawInfo {
  match: TvMatchView;
  /** 우리 선수 이름(경기장에서 이름표를 단다). 없으면 이름표 없음 */
  ourName: string | null;
  ourSide: 'home' | 'away' | null;
  bottom: number;
}

export function drawPitch(ctx: CanvasRenderingContext2D, sim: PitchSim, info: PitchDrawInfo): void {
  const v: View = { top: 118, bottom: info.bottom + 30, wFar: 860, wNear: 1180, span: 0.78, camX: sim.camX };
  // 하늘(관중석)
  const sky = ctx.createLinearGradient(0, 0, 0, v.top + 10);
  sky.addColorStop(0, '#0b1020');
  sky.addColorStop(1, '#1f2a3d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, v.top + 10);
  // 관중석 점들 (화면이 움직이면 같이 흐른다)
  const crowdShift = ((-sim.camX * 1600) % 24 + 24) % 24;
  for (let row = 0; row < 5; row++) {
    for (let x = -24 + crowdShift + (row % 2) * 12; x < 1048; x += 24) {
      const shade = ((x * 7 + row * 13) % 5) / 5;
      ctx.fillStyle = `rgba(${150 + shade * 80},${140 + shade * 60},${150 + shade * 40},0.35)`;
      ctx.fillRect(x, v.top - 18 - row * 16, 9, 8);
    }
  }
  // 광고판
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, v.top - 14, 1024, 14);
  ctx.fillStyle = '#f5c400';
  for (let x = ((-sim.camX * 1400) % 260) - 260; x < 1024; x += 260) {
    ctx.font = `800 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('주모 · 응원 주막 · 酒幕', x + 20, v.top - 7);
  }

  // 잔디 (줄무늬)
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    const x0 = i / stripes;
    const x1 = (i + 1) / stripes;
    const a = project(v, x0, 0);
    const b = project(v, x1, 0);
    const c = project(v, x1, 1.08);
    const d = project(v, x0, 1.08);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.lineTo(c.sx, c.sy);
    ctx.lineTo(d.sx, d.sy);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? '#2f8a3a' : '#2a7d34';
    ctx.fill();
  }
  // 경기장 밖 잔디
  const left = project(v, 0, 0);
  const leftN = project(v, 0, 1.08);
  ctx.fillStyle = '#286f30';
  ctx.beginPath();
  ctx.moveTo(-50, v.top);
  ctx.lineTo(left.sx, left.sy);
  ctx.lineTo(leftN.sx, leftN.sy);
  ctx.lineTo(-50, leftN.sy);
  ctx.fill();
  const right = project(v, 1, 0);
  const rightN = project(v, 1, 1.08);
  ctx.beginPath();
  ctx.moveTo(1074, v.top);
  ctx.lineTo(right.sx, right.sy);
  ctx.lineTo(rightN.sx, rightN.sy);
  ctx.lineTo(1074, rightN.sy);
  ctx.fill();

  // 선
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  const line = (pts: Array<[number, number]>, close = false): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const p = project(v, x, y);
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    });
    if (close) ctx.closePath();
    ctx.stroke();
  };
  line([[0, 0], [1, 0], [1, 1], [0, 1]], true);
  line([[0.5, 0], [0.5, 1]]);
  const circle: Array<[number, number]> = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    circle.push([0.5 + Math.cos(a) * 0.087, 0.5 + Math.sin(a) * 0.135]);
  }
  line(circle);
  for (const side of [0, 1]) {
    const dx = side === 0 ? 1 : -1;
    const g = side === 0 ? 0 : 1;
    line([[g, 0.2], [g + dx * 0.157, 0.2], [g + dx * 0.157, 0.8], [g, 0.8]]);
    line([[g, 0.37], [g + dx * 0.052, 0.37], [g + dx * 0.052, 0.63], [g, 0.63]]);
    // 골대
    const p1 = project(v, g, 0.45);
    const p2 = project(v, g, 0.55);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(p1.sx, p1.sy - 30 * p1.s);
    ctx.lineTo(p2.sx, p2.sy - 30 * p2.s);
    ctx.lineTo(p2.sx, p2.sy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
  }

  // 사람들 (먼 쪽부터)
  const ourIdx = info.ourSide ? sim.ourIndex(info.ourSide) : -1;
  const order = sim.players.map((_, i) => i).sort((a, b) => sim.players[a]!.y - sim.players[b]!.y);
  for (const i of order) {
    const p = sim.players[i]!;
    const at = project(v, p.x, p.y);
    if (at.sx < -40 || at.sx > 1064) continue;
    const r = 13 * at.s;
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(at.sx + 3 * at.s, at.sy + 1, r * 1.1, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    const home = p.team === 0;
    const kit = p.role === 0 ? (home ? '#2dbb6d' : '#f0b429') : home ? KIT.home : KIT.away;
    const trim = home ? KIT.homeTrim : KIT.awayTrim;
    // 다리(뛰는 모양)
    const run = Math.hypot(p.vx, p.vy) > 0.02 ? Math.sin(p.wob * 18) * 3 * at.s : 0;
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 3 * at.s;
    ctx.beginPath();
    ctx.moveTo(at.sx - 3 * at.s, at.sy - r * 0.9);
    ctx.lineTo(at.sx - 3 * at.s + run, at.sy);
    ctx.moveTo(at.sx + 3 * at.s, at.sy - r * 0.9);
    ctx.lineTo(at.sx + 3 * at.s - run, at.sy);
    ctx.stroke();
    // 몸통
    ctx.fillStyle = kit;
    ctx.strokeStyle = trim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(at.sx, at.sy - r * 1.6, r * 0.75, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 머리
    ctx.fillStyle = '#e9c39f';
    ctx.beginPath();
    ctx.arc(at.sx, at.sy - r * 2.85, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    if (i === ourIdx) {
      // 우리 선수: 노란 고리와 이름표
      ctx.strokeStyle = '#f5c400';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(at.sx, at.sy, r * 1.7, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (info.ourName) {
        ctx.font = `800 ${Math.round(20 * at.s + 4)}px ${FONT}`;
        const tw = ctx.measureText(info.ourName).width;
        const ty = at.sy - r * 3.8 - 14;
        ctx.fillStyle = 'rgba(245,196,0,0.95)';
        ctx.beginPath();
        rrect(ctx, at.sx - tw / 2 - 8, ty - 13, tw + 16, 26, 8);
        ctx.fill();
        ctx.fillStyle = '#1a1400';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(info.ourName, at.sx, ty + 1);
      }
    }
  }
  // 공
  const b = project(v, sim.ball.x, sim.ball.y, sim.ball.z);
  const bg = project(v, sim.ball.x, sim.ball.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(bg.sx, bg.sy, 6 * bg.s, 2.4 * bg.s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(b.sx, b.sy - 5 * b.s, 5.5 * b.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  drawScoreBug(ctx, info.match);
  // 가상 중계임을 밝힌다
  ctx.font = `600 16px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('가상 중계 화면 · 점수는 실제', 1006, 24);
}

/** 왼쪽 위 점수 막대: 대회 | 홈 1 - 0 원정 | 67' */
export function drawScoreBug(ctx: CanvasRenderingContext2D, m: TvMatchView): void {
  const x = 20;
  const y = 16;
  const h = 46;
  ctx.font = `800 24px ${FONT}`;
  const hn = clip(ctx, m.homeName, 170);
  const an = clip(ctx, m.awayName, 170);
  const hw = ctx.measureText(hn).width;
  const aw = ctx.measureText(an).width;
  const score = m.state === 'pre' ? '對' : `${m.homeScore} : ${m.awayScore}`;
  ctx.font = `900 26px ${FONT}`;
  const sw = ctx.measureText(score).width;
  ctx.font = `800 22px ${FONT}`;
  const clock = oldClock(m.state, m.clock);
  const cw = ctx.measureText(clock).width;
  const w = 16 + hw + 18 + sw + 28 + 18 + aw + 16 + cw + 34;
  // 한지 패(牌): 먹선 두른 종이
  ctx.fillStyle = 'rgba(236,220,182,0.95)';
  ctx.beginPath();
  rrect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,24,10,0.8)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // 점수 칸
  let cx = x + 16;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 24px ${FONT}`;
  ctx.fillStyle = m.ours === 'home' || m.ours === 'both' ? PAPER.red : PAPER.ink;
  ctx.fillText(hn, cx, y + h / 2 + 1);
  cx += hw + 18;
  ctx.fillStyle = PAPER.red;
  ctx.beginPath();
  rrect(ctx, cx - 8, y + 6, sw + 16 + 12, h - 12, 3);
  ctx.fill();
  ctx.fillStyle = PAPER.redInk;
  ctx.font = `900 26px ${FONT}`;
  ctx.fillText(score, cx + 6, y + h / 2 + 1);
  cx += sw + 28 + 18;
  ctx.font = `800 24px ${FONT}`;
  ctx.fillStyle = m.ours === 'away' || m.ours === 'both' ? PAPER.red : PAPER.ink;
  ctx.fillText(an, cx, y + h / 2 + 1);
  cx += aw + 16;
  // 시계
  if (m.state === 'live') {
    ctx.fillStyle = PAPER.red;
    ctx.beginPath();
    ctx.arc(cx + 6, y + h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `800 22px ${FONT}`;
  ctx.fillStyle = PAPER.soft;
  ctx.fillText(clock, cx + 16, y + h / 2 + 1);
}

/** 둥근 네모 경로 (옛 iOS 사파리에는 ctx.roundRect가 없다). beginPath는 부르는 쪽이 한다 */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * 선수 카드: 왼쪽 족자에 선수 이름을 세로 붓글씨로, 오른쪽에 소속과 오늘 기록. 사진은 쓰지 않는다.
 * 같은 말을 두 번 적지 않는다(제보: 이름·팀이 겹쳐 보였다) — 이름은 족자에만, 팀·대회는 오른쪽에 한 번,
 * 상대 팀과 시각·점수는 함께 그리는 점수 띠(drawScoreBug)에 맡긴다.
 */
export function drawPlayerCard(
  ctx: CanvasRenderingContext2D,
  m: TvMatchView,
  player: TvPlayerLine & { side: 'home' | 'away' },
  bottom: number,
): void {
  const team = player.side === 'home' ? m.homeName : m.awayName;
  // 바탕: 한지와 광곽. 왼쪽에 족자를 걸고 옆에 행장(行狀)을 적는다
  drawPaper(ctx);

  // 족자: 밝은 비단 바탕에 이름을 위에서 아래로 크게
  const px = 60;
  const py = 78;
  const pw = 360;
  const ph = Math.min(450, bottom - py - 12);
  ctx.save();
  ctx.beginPath();
  rrect(ctx, px, py, pw, ph, 24);
  ctx.clip();
  const silk = ctx.createLinearGradient(0, py, 0, py + ph);
  silk.addColorStop(0, '#f3e7c9');
  silk.addColorStop(1, '#e2cf9f');
  ctx.fillStyle = silk;
  ctx.fillRect(px, py, pw, ph);
  // 위아래 쪽빛 비단 띠(족자의 천두·천지)
  ctx.fillStyle = '#34507a';
  ctx.fillRect(px, py, pw, 34);
  ctx.fillRect(px, py + ph - 34, pw, 34);
  const chars = [...player.name.replace(/\s+/g, '')];
  const room = ph - 34 * 2 - 40;
  const fs = Math.min(116, Math.floor(room / Math.max(1, chars.length) / 1.08));
  ctx.fillStyle = PAPER.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fs}px ${FONT}`;
  const top = py + 34 + 20 + (room - fs * 1.08 * chars.length) / 2 + fs * 0.54;
  chars.forEach((ch, i) => ctx.fillText(ch, px + pw / 2, top + i * fs * 1.08));
  ctx.restore();
  // 족자 테두리: 짙은 비단 띠
  ctx.strokeStyle = '#3b2412';
  ctx.lineWidth = 8;
  ctx.beginPath();
  rrect(ctx, px, py, pw, ph, 24);
  ctx.stroke();
  // 족자 귀퉁이에 이름 낙관 (성씨 한 글자)
  drawSeal(ctx, px + pw - 40, py + ph - 40, [...player.name][0] ?? '', 58);

  // 글자
  const tx = 470;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PAPER.red;
  const unit = m.sport === 'baseball' ? '홈런' : '득점';
  const text = playerCardText(m.state, player.role, unit);
  ctx.font = `800 28px ${FONT}`;
  ctx.fillText(text.head, tx, 92);
  ctx.fillStyle = PAPER.ink;
  ctx.font = `900 56px ${FONT}`;
  ctx.fillText(clip(ctx, team, 500), tx, 168);
  ctx.fillStyle = PAPER.dim;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(clip(ctx, `〔${m.comp}〕`, 500), tx, 238);

  // 오늘 기록
  ctx.fillStyle = 'rgba(247,236,210,0.7)';
  ctx.beginPath();
  rrect(ctx, tx, 324, 480, 108, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,38,16,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const goals = player.goals;
  ctx.fillStyle = goals > 0 ? PAPER.red : PAPER.ink;
  ctx.font = `900 56px ${FONT}`;
  ctx.fillText(goals > 0 ? `${unit} ${goals}` : text.idle, tx + 28, 380);
  if (goals > 0) drawSeal(ctx, tx + 430, 378, '慶', 70);
}
