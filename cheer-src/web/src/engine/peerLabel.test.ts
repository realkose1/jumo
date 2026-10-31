import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PeerLabeler, TAP_LABEL_MS, type LabelState } from './peerLabel';

function setup() {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const people = new Map([
    [1, { name: { ko: '조용한 구름' }, at: new THREE.Vector3(0, 1.2, 0) }],
    [2, { name: { ko: '졸린 오리' }, at: new THREE.Vector3(0, 1.2, 20) }], // 카메라 뒤
  ]);
  const shown: Array<LabelState | null> = [];
  const labeler = new PeerLabeler(
    {
      labelAnchor: (id, out) => (people.has(id) ? out.copy(people.get(id)!.at) : null),
      nameOf: (id) => people.get(id)?.name ?? null,
    },
    (l) => shown.push(l),
  );
  const rect = { left: 0, top: 0, width: 1000, height: 500 };
  return { camera, labeler, shown, rect };
}

describe('PeerLabeler', () => {
  it('아무도 가리키지 않으면 아무것도 띄우지 않는다', () => {
    const { camera, labeler, shown, rect } = setup();
    for (let i = 0; i < 10; i++) labeler.update(camera, rect, i * 16);
    expect(shown).toEqual([]);
  });

  it('마우스를 올리면 머리 위 화면 위치에 이름을 띄우고, 벗어나면 지운다', () => {
    const { camera, labeler, shown, rect } = setup();
    labeler.setHover(1);
    labeler.update(camera, rect, 0);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.name).toEqual({ ko: '조용한 구름' });
    expect(shown[0]!.x).toBeGreaterThan(450);
    expect(shown[0]!.x).toBeLessThan(550);
    labeler.update(camera, rect, 16); // 그대로면 다시 알리지 않는다
    expect(shown).toHaveLength(1);
    labeler.setHover(null);
    labeler.update(camera, rect, 32);
    expect(shown.at(-1)).toBeNull();
  });

  it('누르면 잠깐 보였다가 저절로 사라진다', () => {
    const { camera, labeler, shown, rect } = setup();
    labeler.tap(1, 1000);
    labeler.update(camera, rect, 1000);
    expect(shown.at(-1)).not.toBeNull();
    labeler.update(camera, rect, 1000 + TAP_LABEL_MS - 1);
    expect(shown.at(-1)).not.toBeNull();
    labeler.update(camera, rect, 1000 + TAP_LABEL_MS);
    expect(shown.at(-1)).toBeNull();
  });

  it('마우스를 올린 사람이 눌러서 보인 사람보다 먼저', () => {
    const { camera, labeler, shown, rect } = setup();
    labeler.tap(1, 0);
    labeler.setHover(null);
    labeler.update(camera, rect, 10);
    expect(shown.at(-1)!.name.ko).toBe('조용한 구름');
  });

  it('카메라 뒤에 있거나 방에서 나간 사람은 띄우지 않는다', () => {
    const { camera, labeler, shown, rect } = setup();
    labeler.setHover(2);
    labeler.update(camera, rect, 0);
    labeler.setHover(99);
    labeler.update(camera, rect, 16);
    expect(shown).toEqual([]);
  });
});
