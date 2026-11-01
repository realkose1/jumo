// 사람 이름표: 손님들 머리 위에 늘 이름을 띄운다. 내 머리 위에도 내 이름(self)을 띄운다 — 단, 하늘을 보려고 시점을
// 낮춰 카메라가 내 머리 바로 뒤로 오면(내 갓을 감출 때) 화면 한가운데를 가리지 않게 감춘다(엔진이 anchor 를 null 로).
// 화면이 시끄럽지 않게 다른 손님은 가까운 사람부터 MAX_LABELS 명까지만, 먼 사람은 흐리게, LABEL_FAR 밖은 띄우지 않는다.
// 마우스를 올려 두었거나 누른 사람(휴대폰은 누른 사람만)은 거리·인원과 상관없이 또렷하게(focus) 맨 앞에 둔다.
// 여기서는 '누구의 이름을, 화면 어디에, 얼마나 또렷하게' 띄울지만 정하고, 그리기와 겹침 정리는 UI(ui/net.ts)다.
import * as THREE from 'three';
import type { LocalizedName, PeerId } from '@shared/protocol';

/** 눌렀을 때 이름이 또렷하게 머무는 시간 */
export const TAP_LABEL_MS = 2500;
/** 카메라에서 이 거리(m)까지는 또렷하게 */
export const LABEL_NEAR = 9;
/** 이보다 멀면 띄우지 않는다. NEAR~FAR 사이는 점점 흐리게 */
export const LABEL_FAR = 18;
/** 가장 흐릴 때의 불투명도 */
export const FAR_OPACITY = 0.45;
/** 한 화면에 띄우는 이름표 수 (가까운 순) */
export const MAX_LABELS = 10;

export interface LabelPeers {
  /** 지금 방에 있는 다른 사람들 (나가는 중인 사람은 빼고) */
  ids(): Iterable<PeerId>;
  labelAnchor(id: PeerId, out: THREE.Vector3): THREE.Vector3 | null;
  nameOf(id: PeerId): LocalizedName | null;
}

/** 나 (서버가 이름을 붙여 주기 전·혼자 모드면 이름이 없다) */
export interface LabelSelf {
  id(): PeerId | null;
  name(): LocalizedName | null;
  /** 내 머리 위. 지금 띄우지 않을 때(시점이 머리 뒤로 낮아졌을 때)는 null */
  anchor(out: THREE.Vector3): THREE.Vector3 | null;
}

export interface LabelState {
  id: PeerId;
  name: LocalizedName;
  /** 화면(뷰포트) 픽셀. 이름표의 아래 가운데 */
  x: number;
  y: number;
  /** 0~1. 멀수록 흐리다 */
  opacity: number;
  /** 마우스를 올렸거나 방금 누른 사람 */
  focus: boolean;
  /** 내 이름표 */
  self: boolean;
}

/** 불투명도는 0.05 단위로 — 조금 움직일 때마다 화면을 다시 그리지 않게 */
function opacityAt(dist: number): number {
  if (dist <= LABEL_NEAR) return 1;
  const t = Math.min(1, (dist - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR));
  return Math.round((1 - (1 - FAR_OPACITY) * t) * 20) / 20;
}

export class PeerLabeler {
  private hoverId: PeerId | null = null;
  private tapId: PeerId | null = null;
  private tapUntil = 0;
  private lastKey = '';
  private readonly anchor = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  constructor(
    private readonly peers: LabelPeers,
    private readonly emit: (labels: readonly LabelState[]) => void,
    private readonly self: LabelSelf | null = null,
  ) {}

  /** 내 이름이 있거나, 방에 다른 사람이 있거나, 방금까지 이름표를 띄우고 있었다 (그럴 때만 프레임마다 위치를 계산한다) */
  isActive(): boolean {
    if (this.lastKey !== '') return true;
    if (this.self?.name()) return true;
    for (const _ of this.peers.ids()) return true;
    return false;
  }

  setHover(id: PeerId | null): void {
    this.hoverId = id;
  }

  tap(id: PeerId, nowMs: number): void {
    this.tapId = id;
    this.tapUntil = nowMs + TAP_LABEL_MS;
  }

  /** 프레임마다. rect는 캔버스의 화면 위치와 크기. 바뀐 것이 있을 때만 알린다 */
  update(camera: THREE.Camera, rect: { left: number; top: number; width: number; height: number }, nowMs: number): void {
    if (this.tapId !== null && nowMs >= this.tapUntil) this.tapId = null;
    const focusId = this.hoverId ?? this.tapId;
    this.eye.setFromMatrixPosition(camera.matrixWorld);

    const toScreen = (anchor: THREE.Vector3): { x: number; y: number } | null => {
      anchor.project(camera);
      if (anchor.z > 1 || anchor.z < -1) return null; // 카메라 뒤
      if (Math.abs(anchor.x) > 1.1 || Math.abs(anchor.y) > 1.1) return null; // 화면 밖
      return {
        x: Math.round(rect.left + (anchor.x * 0.5 + 0.5) * rect.width),
        y: Math.round(rect.top + (-anchor.y * 0.5 + 0.5) * rect.height),
      };
    };

    // 내 이름표: 늘 또렷하게, 다른 손님보다 앞에 (마우스를 올린·누른 사람 다음)
    let mine: LabelState | null = null;
    const selfName = this.self?.name() ?? null;
    const selfId = this.self?.id() ?? null;
    const selfAnchor = selfName && selfId !== null ? this.self!.anchor(this.anchor) : null;
    const selfAt = selfAnchor ? toScreen(selfAnchor) : null;
    if (selfName && selfId !== null && selfAt) mine = { id: selfId, name: selfName, ...selfAt, opacity: 1, focus: false, self: true };

    const found: Array<LabelState & { dist: number }> = [];
    for (const id of this.peers.ids()) {
      const anchor = this.peers.labelAnchor(id, this.anchor);
      const name = this.peers.nameOf(id);
      if (!anchor || !name) continue;
      const dist = anchor.distanceTo(this.eye);
      const focus = id === focusId;
      if (!focus && dist > LABEL_FAR) continue;
      const at = toScreen(anchor);
      if (!at) continue;
      found.push({ id, name, ...at, opacity: focus ? 1 : opacityAt(dist), focus, self: false, dist });
    }
    // 또렷한 사람 먼저, 그다음 나, 그다음 가까운 순 — UI는 이 순서대로 자리를 잡아 겹치면 뒤의 것을 감춘다
    found.sort((a, b) => Number(b.focus) - Number(a.focus) || a.dist - b.dist);
    const others = found.slice(0, MAX_LABELS).map(({ dist: _dist, ...label }) => label);
    const focused = others.filter((l) => l.focus);
    const labels = mine ? [...focused, mine, ...others.filter((l) => !l.focus)] : others;

    const key = labels.map((l) => `${l.id}:${l.name.ko}:${l.x}:${l.y}:${l.opacity}:${l.focus ? 1 : 0}:${l.self ? 1 : 0}`).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.emit(labels);
  }

  /** 서버와 끊기거나 엔진을 닫을 때: 띄운 이름표를 모두 걷는다 */
  clear(): void {
    if (this.lastKey === '') return;
    this.lastKey = '';
    this.emit([]);
  }
}
