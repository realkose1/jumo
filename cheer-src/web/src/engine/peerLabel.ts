// 다른 사람 이름표: 평소에는 아무것도 띄우지 않는다(조용한 공간이라 화면이 시끄러우면 안 된다).
// 마우스를 올려 두었거나, 눌렀을 때(휴대폰은 눌렀을 때만) 그 사람 머리 위에 이름이 잠깐 보인다.
// 여기서는 '누구의 이름을, 화면 어디에' 띄울지만 정하고, 그리는 건 UI(ui/peerLabel.ts)다.
import * as THREE from 'three';
import type { LocalizedName, PeerId } from '@shared/protocol';

/** 눌렀을 때 이름이 머무는 시간 */
export const TAP_LABEL_MS = 2500;

export interface LabelPeers {
  labelAnchor(id: PeerId, out: THREE.Vector3): THREE.Vector3 | null;
  nameOf(id: PeerId): LocalizedName | null;
}

export interface LabelState {
  name: LocalizedName;
  /** 화면(뷰포트) 픽셀. 이름표의 아래 가운데 */
  x: number;
  y: number;
}

export class PeerLabeler {
  private hoverId: PeerId | null = null;
  private tapId: PeerId | null = null;
  private tapUntil = 0;
  private last: { id: PeerId; x: number; y: number } | null = null;
  private readonly anchor = new THREE.Vector3();

  constructor(
    private readonly peers: LabelPeers,
    private readonly emit: (label: LabelState | null) => void,
  ) {}

  /** 보여줄 이름이 있거나 방금까지 보여주고 있었다 (그럴 때만 프레임마다 위치를 계산한다) */
  isActive(): boolean {
    return this.hoverId !== null || this.tapId !== null || this.last !== null;
  }

  setHover(id: PeerId | null): void {
    this.hoverId = id;
  }

  tap(id: PeerId, nowMs: number): void {
    this.tapId = id;
    this.tapUntil = nowMs + TAP_LABEL_MS;
  }

  /** 프레임마다. rect는 캔버스의 화면 위치와 크기 */
  update(camera: THREE.Camera, rect: { left: number; top: number; width: number; height: number }, nowMs: number): void {
    if (this.tapId !== null && nowMs >= this.tapUntil) this.tapId = null;
    const id = this.hoverId ?? this.tapId;
    if (id === null) return this.hide();

    const anchor = this.peers.labelAnchor(id, this.anchor);
    const name = this.peers.nameOf(id);
    if (!anchor || !name) return this.hide();
    anchor.project(camera);
    if (anchor.z > 1 || anchor.z < -1) return this.hide(); // 카메라 뒤
    const x = Math.round(rect.left + (anchor.x * 0.5 + 0.5) * rect.width);
    const y = Math.round(rect.top + (-anchor.y * 0.5 + 0.5) * rect.height);
    const last = this.last;
    if (last && last.id === id && last.x === x && last.y === y) return;
    this.last = { id, x, y };
    this.emit({ name, x, y });
  }

  private hide(): void {
    if (this.last === null) return;
    this.last = null;
    this.emit(null);
  }
}
