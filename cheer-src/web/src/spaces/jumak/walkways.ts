// 단골손님이 걷는 길. 평상을 밟고 가로지르지 않고, 평상 사이 통로와 마당 가장자리로 돌아간다.
// 마당을 0.5m 칸으로 나눠 평상·부뚜막에서 떨어진 칸만 잇고(A*), 곧게 갈 수 있는 곳은 모서리를 깎아 곧게 간다.
// three.js를 모르는 순수한 계산이라 시험하기 쉽다.
import { PLATFORMS, PLATFORM_D, PLATFORM_W, SEAT_COLS, TV, WALK_BLOCKERS, JUMO, platformToWorld, seatSlot, worldToPlatform } from './layout';

export interface Pt {
  x: number;
  z: number;
}

/** 평상·부뚜막 가장자리에서 이만큼 떨어져 걷는다 (몸 반 폭 남짓) */
export const CLEAR = 0.3;
/** 단골이 걸어도 되는 마당. 사람이 걷는 곳(WALK_BOUNDS)보다 옆으로 조금 넓다 — 옆 섬돌로 드나든다 */
export const NPC_BOUNDS = { minX: -7.2, maxX: 7.2, minZ: -4.9, maxZ: 8.8 } as const;
/** 앉으러 갈 때 평상 가장자리에서 이만큼 밖에 섰다가 올라선다 */
const ENTRY_OUT = 0.45;
const STEP = 0.5;
const SAMPLE = 0.12;

/** 이 점이 평상이나 부뚜막에 너무 가깝거나 마당 밖인가 */
export function blocked(x: number, z: number, margin = CLEAR): boolean {
  if (x < NPC_BOUNDS.minX || x > NPC_BOUNDS.maxX || z < NPC_BOUNDS.minZ || z > NPC_BOUNDS.maxZ) return true;
  for (const p of PLATFORMS) {
    const l = worldToPlatform(p, x, z);
    if (Math.abs(l.x) < PLATFORM_W / 2 + margin && Math.abs(l.z) < PLATFORM_D / 2 + margin) return true;
  }
  for (const b of WALK_BLOCKERS) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return true;
  }
  return false;
}

/** a에서 b까지 곧게 가도 아무것도 밟지 않는가 */
export function segmentClear(a: Pt, b: Pt, margin = CLEAR): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / SAMPLE));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, margin)) return false;
  }
  return true;
}

// ---- 칸 (한 번만 만든다) ----
interface Grid {
  pts: Pt[];
  next: number[][];
}
let grid: Grid | null = null;

function buildGrid(): Grid {
  const cols = Math.floor((NPC_BOUNDS.maxX - NPC_BOUNDS.minX) / STEP) + 1;
  const rows = Math.floor((NPC_BOUNDS.maxZ - NPC_BOUNDS.minZ) / STEP) + 1;
  const index = new Map<number, number>();
  const pts: Pt[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = NPC_BOUNDS.minX + c * STEP;
      const z = NPC_BOUNDS.minZ + r * STEP;
      if (blocked(x, z)) continue;
      index.set(r * cols + c, pts.length);
      pts.push({ x, z });
    }
  }
  const next: number[][] = pts.map(() => []);
  for (const [key, i] of index) {
    const r = Math.floor(key / cols);
    const c = key % cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const j = index.get((r + dr) * cols + (c + dc));
        if (j === undefined || c + dc < 0 || c + dc >= cols) continue;
        if (segmentClear(pts[i]!, pts[j]!)) next[i]!.push(j);
      }
    }
  }
  return { pts, next };
}

function nearestNode(g: Grid, p: Pt): number {
  let best = -1;
  let bestD = Infinity;
  let bestClear = -1;
  let bestClearD = Infinity;
  g.pts.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    // 곧게 이어지는 칸이 있으면 그것을 고른다 (평상 반대편 칸으로 잘못 붙지 않게)
    if (d < bestClearD && d < 2.5 && segmentClear(p, q)) {
      bestClearD = d;
      bestClear = i;
    }
  });
  return bestClear >= 0 ? bestClear : best;
}

/**
 * from에서 to까지 걸어갈 점들 (from은 빼고, 마지막이 to). 평상을 가로지르지 않는다.
 * 곧게 갈 수 있으면 [to] 하나. 길을 못 찾으면 그냥 곧게 간다.
 */
export function planPath(from: Pt, to: Pt): Pt[] {
  if (segmentClear(from, to)) return [to];
  const g = (grid ??= buildGrid());
  const start = nearestNode(g, from);
  const goal = nearestNode(g, to);
  if (start < 0 || goal < 0) return [to];

  // A*: 칸이 수백 개뿐이라 단순한 배열로 충분하다
  const n = g.pts.length;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const open: number[] = [start];
  const h = (i: number) => Math.hypot(g.pts[i]!.x - g.pts[goal]!.x, g.pts[i]!.z - g.pts[goal]!.z);
  cost[start] = 0;
  while (open.length) {
    let k = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]!]! + h(open[i]!) < cost[open[k]!]! + h(open[k]!)) k = i;
    const cur = open.splice(k, 1)[0]!;
    if (cur === goal) break;
    if (done[cur]) continue;
    done[cur] = 1;
    for (const j of g.next[cur]!) {
      if (done[j]) continue;
      const c = cost[cur]! + Math.hypot(g.pts[j]!.x - g.pts[cur]!.x, g.pts[j]!.z - g.pts[cur]!.z);
      if (c < cost[j]!) {
        cost[j] = c;
        prev[j] = cur;
        open.push(j);
      }
    }
  }
  if (goal !== start && prev[goal] === -1) return [to];
  const nodes: Pt[] = [];
  for (let i = goal; i !== -1; i = prev[i]!) nodes.unshift(g.pts[i]!);
  nodes.push(to);

  // 모서리 깎기: 지금 점에서 곧게 닿는 가장 먼 점으로 건너뛴다
  const out: Pt[] = [];
  let at = from;
  let i = 0;
  while (i < nodes.length) {
    let far = i;
    for (let j = nodes.length - 1; j > i; j--) {
      if (segmentClear(at, nodes[j]!)) {
        far = j;
        break;
      }
    }
    at = nodes[far]!;
    out.push(at);
    i = far + 1;
  }
  return out;
}

/** 길이 (m) */
export function pathLength(from: Pt, path: readonly Pt[]): number {
  let len = 0;
  let at = from;
  for (const p of path) {
    len += Math.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return len;
}

/**
 * 그 방석에 앉으려면 서는 평상 밖의 점. 앞줄은 TV 쪽 가장자리, 뒷줄은 뒤쪽 가장자리에서 올라선다
 * (앞줄 사람 머리 위로 지나가지 않게)
 */
export function seatEntry(seatId: string): Pt | null {
  const platform = PLATFORMS.find((p) => p.id === seatId[0]);
  const index = Number(seatId.slice(1));
  if (!platform || !Number.isInteger(index) || index < 1 || index > 6) return null;
  const { row, col } = seatSlot(index);
  const lz = row === 0 ? -(PLATFORM_D / 2 + ENTRY_OUT) : PLATFORM_D / 2 + ENTRY_OUT;
  return platformToWorld(platform, SEAT_COLS[col]!, lz);
}

// ---- 서 있는 곳 ----
export interface StandSpot extends Pt {
  id: string;
  /** 바라보는 방향(yaw) */
  facing: number;
  /** 주모에게 주문하는 곳 */
  counter?: boolean;
}

const towardTv = (x: number, z: number): number => Math.atan2(TV.x - x, TV.z - z);

/**
 * 서서 응원하는 곳. 앉아 있는 사람 눈에 들어오되 TV를 가리지 않는 곳(옆 가장자리, TV 옆 모퉁이)과
 * 뒷마당, 그리고 주모 앞(주문하는 곳).
 */
export const STAND_SPOTS: readonly StandSpot[] = [
  { id: 'left-front', x: -6.3, z: -2.4, facing: towardTv(-6.3, -2.4) },
  { id: 'left-mid', x: -6.4, z: 0.2, facing: towardTv(-6.4, 0.2) },
  { id: 'right-front', x: 6.3, z: -2.4, facing: towardTv(6.3, -2.4) },
  { id: 'right-mid', x: 6.4, z: 0.2, facing: towardTv(6.4, 0.2) },
  { id: 'left-back', x: -6.3, z: 3.4, facing: towardTv(-6.3, 3.4) },
  { id: 'right-back', x: 6.3, z: 3.6, facing: towardTv(6.3, 3.6) },
  { id: 'right-corner', x: 4.9, z: -4.5, facing: towardTv(4.9, -4.5) },
  { id: 'back-left', x: -2.4, z: 6.2, facing: towardTv(-2.4, 6.2) },
  { id: 'back-right', x: 2.6, z: 6.8, facing: towardTv(2.6, 6.8) },
  { id: 'back-mid', x: 0.2, z: 5.4, facing: towardTv(0.2, 5.4) },
  // 주모 앞: 부뚜막 둘레(막힌 곳) 바로 밖에서 주모를 바라본다
  { id: 'counter', x: -5.5, z: -4.0, facing: Math.atan2(JUMO.x - -5.5, JUMO.z - -4.0), counter: true },
];

/** 드나드는 곳: 마당 양옆 섬돌 */
export const DOORS: readonly Pt[] = [
  { x: -7.1, z: 1.2 },
  { x: 7.1, z: 1.2 },
];
