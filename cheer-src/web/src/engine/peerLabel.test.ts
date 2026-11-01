import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FAR_OPACITY, MAX_LABELS, PeerLabeler, TAP_LABEL_MS, type LabelState } from './peerLabel';

type Person = { name: { ko: string }; at: THREE.Vector3 };

function setup(extra: Array<[number, Person]> = []) {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const people = new Map<number, Person>([
    [1, { name: { ko: '조용한 구름' }, at: new THREE.Vector3(0, 1.2, 0) }], // 카메라에서 약 6m
    [2, { name: { ko: '졸린 오리' }, at: new THREE.Vector3(0, 1.2, 20) }], // 카메라 뒤
    ...extra,
  ]);
  const shown: Array<readonly LabelState[]> = [];
  const labeler = new PeerLabeler(
    {
      ids: () => people.keys(),
      labelAnchor: (id, out) => (people.has(id) ? out.copy(people.get(id)!.at) : null),
      nameOf: (id) => people.get(id)?.name ?? null,
    },
    (l) => shown.push(l),
  );
  const rect = { left: 0, top: 0, width: 1000, height: 500 };
  return { camera, labeler, shown, rect, people };
}

const names = (labels: readonly LabelState[] | undefined) => (labels ?? []).map((l) => l.name.ko);

describe('PeerLabeler', () => {
  it('누르지 않아도 다른 사람 머리 위에 이름을 띄운다 (카메라 뒤는 빼고)', () => {
    const { camera, labeler, shown, rect } = setup();
    labeler.update(camera, rect, 0);
    expect(names(shown.at(-1))).toEqual(['조용한 구름']);
    const l = shown.at(-1)![0]!;
    expect(l.x).toBeGreaterThan(450);
    expect(l.x).toBeLessThan(550);
    expect(l.opacity).toBe(1);
    expect(l.focus).toBe(false);
    labeler.update(camera, rect, 16); // 그대로면 다시 알리지 않는다
    expect(shown).toHaveLength(1);
  });

  it('먼 사람은 흐리게, 아주 멀면 띄우지 않는다', () => {
    const { camera, labeler, shown, rect } = setup([
      [3, { name: { ko: '먼 손님' }, at: new THREE.Vector3(0, 1.2, -8) }], // 약 14m
      [4, { name: { ko: '아주 먼 손님' }, at: new THREE.Vector3(0, 1.2, -20) }], // 약 26m
    ]);
    labeler.update(camera, rect, 0);
    const labels = shown.at(-1)!;
    expect(names(labels)).toEqual(['조용한 구름', '먼 손님']);
    expect(labels[1]!.opacity).toBeLessThan(1);
    expect(labels[1]!.opacity).toBeGreaterThanOrEqual(FAR_OPACITY);
  });

  it('가까운 순으로 정해진 수까지만, 마우스를 올린 사람은 멀어도 맨 앞에 또렷하게', () => {
    const crowd: Array<[number, Person]> = [];
    for (let i = 0; i < MAX_LABELS + 3; i++) crowd.push([10 + i, { name: { ko: `손님${i}` }, at: new THREE.Vector3((i % 5) - 2, 1.2, -i * 0.5) }]);
    crowd.push([99, { name: { ko: '아주 먼 손님' }, at: new THREE.Vector3(0, 1.2, -20) }]);
    const { camera, labeler, shown, rect } = setup(crowd);
    labeler.update(camera, rect, 0);
    expect(shown.at(-1)).toHaveLength(MAX_LABELS);
    expect(names(shown.at(-1))).not.toContain('아주 먼 손님');
    labeler.setHover(99);
    labeler.update(camera, rect, 16);
    const labels = shown.at(-1)!;
    expect(labels).toHaveLength(MAX_LABELS);
    expect(labels[0]).toMatchObject({ id: 99, focus: true, opacity: 1 });
  });

  it('누르면 잠깐 또렷하다가 돌아온다', () => {
    const { camera, labeler, shown, rect } = setup();
    labeler.tap(1, 1000);
    labeler.update(camera, rect, 1000);
    expect(shown.at(-1)![0]!.focus).toBe(true);
    labeler.update(camera, rect, 1000 + TAP_LABEL_MS - 1);
    expect(shown.at(-1)![0]!.focus).toBe(true);
    labeler.update(camera, rect, 1000 + TAP_LABEL_MS);
    expect(shown.at(-1)![0]!.focus).toBe(false);
  });

  it('모두 나가면 걷고, 아무도 없으면 계산하지 않는다', () => {
    const { camera, labeler, shown, rect, people } = setup();
    expect(labeler.isActive()).toBe(true);
    labeler.update(camera, rect, 0);
    people.clear();
    labeler.update(camera, rect, 16);
    expect(shown.at(-1)).toEqual([]);
    expect(labeler.isActive()).toBe(false);
  });

  it('clear 하면 띄운 이름표를 모두 걷는다', () => {
    const { camera, labeler, shown, rect } = setup();
    labeler.update(camera, rect, 0);
    labeler.clear();
    expect(shown.at(-1)).toEqual([]);
    labeler.clear(); // 이미 비었으면 다시 알리지 않는다
    expect(shown).toHaveLength(2);
  });
});
