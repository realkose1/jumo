import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { PeerInfo } from '@shared/protocol';
import { DETAIL_PRESETS, disposeAvatarResources, getAvatarGeometries, type OutfitSpec } from './avatar';
import { RemotePeers } from './RemotePeers';
import { SeatManager } from './seats';
import type { SeatDef } from './types';

afterAll(() => disposeAvatarResources());

const seatDefs: SeatDef[] = [
  { id: 'a1', x: 2, z: 0, facing: 0 },
  { id: 'a2', x: 4, z: 0, facing: Math.PI / 2, y: 0.5 },
];

function setup(opts: { reduced?: boolean; outfit?: string | OutfitSpec; capacity?: number } = {}) {
  const scene = new THREE.Scene();
  const seats = new SeatManager(scene, seatDefs);
  let t = 0;
  const peers = new RemotePeers(scene, {
    seats,
    outfit: opts.outfit ?? 'plain',
    reducedMotion: opts.reduced ?? false,
    capacity: opts.capacity ?? 4,
    now: () => t,
  });
  const info = (id: number, x = 0, z = 0): PeerInfo => ({ id, name: { ko: `사람${id}` }, x, z, r: 0 });
  const tick = (ms: number, step = 16) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t += step;
      peers.update(step / 1000);
    }
  };
  const posOf = (mesh: THREE.InstancedMesh, i: number) => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  const drawCalls = () => peers.getMeshes().filter((m) => m.visible && m.count > 0).length;
  return { scene, peers, seats, info, tick, posOf, drawCalls, setNow: (v: number) => (t = v) };
}

describe('RemotePeers 그리기 호출', () => {
  it('사람이 없으면 그리지 않는다', () => {
    const { peers, drawCalls } = setup();
    peers.update(0.016);
    expect(drawCalls()).toBe(0);
  });

  it('1명이든 50명이든 그리기 호출은 같다 (머리 1 + 몸통 1 + 발 1 + 팔 1 + 손 1)', () => {
    const one = setup({ capacity: 60 });
    one.peers.reset([one.info(1)], {});
    one.tick(50);
    const many = setup({ capacity: 60 });
    many.peers.reset(Array.from({ length: 50 }, (_, i) => many.info(i + 1, i * 0.5, 0)), {});
    many.tick(50);
    expect(one.drawCalls()).toBe(5);
    expect(many.drawCalls()).toBe(5);
    expect(many.peers.getMeshes()).toHaveLength(one.peers.getMeshes().length);
    expect(many.peers.getMeshes()[0]!.count).toBe(50);
    expect(many.peers.getMeshes()[2]!.count).toBe(100); // 발은 한 사람에 인스턴스 2개
  });

  it('정원보다 많이 들어와도 알아서 늘려서 계속 한 번에 그린다', () => {
    const { peers, info, tick, drawCalls } = setup({ capacity: 2 });
    for (let i = 1; i <= 7; i++) peers.add(info(i, i, 0));
    tick(500);
    expect(peers.getMeshes()[0]!.count).toBe(7);
    expect(peers.getMeshes()[2]!.count).toBe(14);
    expect(peers.getMeshes().at(-1)!.count).toBe(14); // 손도 사람당 2개
    expect(drawCalls()).toBe(5);
  });

  it('발 자리도 정원과 같이 늘어난다 (사람당 2개)', () => {
    const { peers, info } = setup({ capacity: 2 });
    const cap = (m: THREE.InstancedMesh) => m.instanceMatrix.count;
    const [head, , feet] = peers.getMeshes();
    expect(cap(head!)).toBe(2);
    expect(cap(feet!)).toBe(4);
    for (let i = 1; i <= 5; i++) peers.add(info(i, i, 0));
    const [head2, , feet2] = peers.getMeshes();
    expect(cap(feet2!)).toBe(cap(head2!) * 2);
    expect(cap(head2!)).toBeGreaterThanOrEqual(5);
  });

  it('옷 소품은 소품 종류마다 한 번씩만 더 그린다', () => {
    const outfit: OutfitSpec = {
      id: 'glasses',
      bodyColor: 0x336699,
      skinColor: 0xffddcc,
      accessories: [
        { key: 'glasses', attach: 'head', create: () => new THREE.TorusGeometry(0.05, 0.01, 4, 8), color: 0x222222, position: [0, 0.03, 0.25] },
      ],
    };
    const { peers, info, tick, drawCalls } = setup({ outfit, capacity: 10 });
    peers.reset(Array.from({ length: 8 }, (_, i) => info(i + 1)), {});
    tick(50);
    expect(drawCalls()).toBe(6);
  });

  it('옷이 몸통·팔·발을 직접 만들면 인스턴스도 그것으로 그리고, 그리기 호출은 그대로다', () => {
    const outfit: OutfitSpec = {
      id: 'robe-peers',
      bodyColor: 0xffffff,
      skinColor: 0xffddcc,
      body: () => new THREE.CylinderGeometry(0.2, 0.25, 0.6, 8).translate(0, 0.3, 0),
      arm: () => new THREE.BoxGeometry(0.1, 0.2, 0.1).translate(0, -0.1, 0),
      foot: () => new THREE.BoxGeometry(0.1, 0.05, 0.15),
    };
    const { peers, info, tick, drawCalls } = setup({ outfit, capacity: 4 });
    peers.reset([info(1), info(2, 1, 0)], {});
    tick(50);
    const custom = getAvatarGeometries(DETAIL_PRESETS.peer, outfit);
    const meshes = peers.getMeshes();
    expect(meshes[1]!.geometry).toBe(custom.body);
    expect(meshes[1]!.geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect(meshes[2]!.geometry).toBe(custom.foot);
    expect(meshes.at(-2)!.geometry).toBe(custom.arm);
    expect(drawCalls()).toBe(5);

    // 몸 부위를 만들지 않는 옷은 기본 캡슐
    const plain = setup();
    expect(plain.peers.getMeshes()[1]!.geometry).toBe(getAvatarGeometries(DETAIL_PRESETS.peer).body);
    expect(plain.peers.getMeshes()[1]!.geometry).toBeInstanceOf(THREE.CapsuleGeometry);
  });

  it('차림마다 다른 소품은 그 차림인 사람만 그리고, 아무도 안 쓴 소품은 그리지 않는다', () => {
    const hat = (key: string, looks: number[]) => ({
      key,
      attach: 'head' as const,
      create: () => new THREE.ConeGeometry(0.1, 0.2, 6),
      color: 0x222222,
      position: [0, 0.3, 0] as [number, number, number],
      looks,
    });
    const outfit: OutfitSpec = { id: 'hats', bodyColor: 0x336699, skinColor: 0xffddcc, looks: 3, accessories: [hat('hat-0', [0]), hat('hat-2', [2])] };
    const { peers, info, tick, drawCalls, posOf } = setup({ outfit, capacity: 8, reduced: true });
    // 번호 3, 6은 차림 0이고 4는 차림 1이다. 차림 2는 아무도 없다
    peers.reset([info(3, 0, 0), info(4, 2, 0), info(6, 4, 0)], {});
    tick(50);
    const [hat0, hat2] = peers.getMeshes().slice(3, 5);
    expect(hat0!.count).toBe(2);
    expect(posOf(hat0!, 0).x).toBeCloseTo(0, 3);
    expect(posOf(hat0!, 1).x).toBeCloseTo(4, 3); // 차림 1인 사람(x=2)은 건너뛴다
    expect(hat2!.count).toBe(0);
    expect(hat2!.visible).toBe(false);
    expect(drawCalls()).toBe(6);
    peers.remove(3);
    tick(32);
    expect(hat0!.count).toBe(1);
    expect(posOf(hat0!, 0).x).toBeCloseTo(4, 3);
    peers.clear();
    peers.update(0.016);
    expect(drawCalls()).toBe(0);
  });
});

describe('RemotePeers 들어오고 나가기', () => {
  it('들어오면 발끝에서 커지고, 움직임 줄이기면 바로 보인다', () => {
    const a = setup();
    a.peers.add(a.info(1, 1, 1));
    a.tick(16);
    const small = new THREE.Matrix4();
    a.peers.getMeshes()[1]!.getMatrixAt(0, small); // 몸통
    const early = new THREE.Vector3().setFromMatrixScale(small).y;
    a.tick(600);
    a.peers.getMeshes()[1]!.getMatrixAt(0, small);
    const full = new THREE.Vector3().setFromMatrixScale(small).y;
    expect(early).toBeLessThan(0.3);
    expect(full).toBeGreaterThan(0.9);

    const b = setup({ reduced: true });
    b.peers.add(b.info(1, 1, 1));
    b.tick(16);
    const m = new THREE.Matrix4();
    b.peers.getMeshes()[1]!.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).y).toBeGreaterThan(0.9);
  });

  it('나가면 작아지다가 사라지고, 움직임 줄이기면 바로 사라진다', () => {
    const a = setup();
    a.peers.reset([a.info(1), a.info(2)], {});
    a.tick(32);
    a.peers.remove(1);
    expect(a.peers.has(1)).toBe(false);
    expect(a.peers.count).toBe(2); // 아직 작아지는 중
    a.tick(600);
    expect(a.peers.count).toBe(1);

    const b = setup({ reduced: true });
    b.peers.reset([b.info(1), b.info(2)], {});
    b.peers.remove(1);
    expect(b.peers.count).toBe(1);
  });

  it('나가는 중인 사람은 누를 수 없다', () => {
    const { peers, info, tick } = setup();
    peers.reset([info(1, 0, 0)], {});
    tick(50);
    const ray = new THREE.Ray(new THREE.Vector3(0, 0.5, 5), new THREE.Vector3(0, 0, -1));
    expect(peers.pick(ray)).toBe(1);
    peers.remove(1);
    expect(peers.pick(ray)).toBeNull();
  });

  it('연결이 끊기면 모두 바로 지운다', () => {
    const { peers, info, tick } = setup();
    peers.reset([info(1), info(2)], { a1: 2 });
    tick(50);
    peers.clear();
    expect(peers.count).toBe(0);
    expect(peers.seatOwner('a1')).toBeNull();
  });
});

describe('RemotePeers 움직임', () => {
  it('받은 위치를 조금 늦춰서 부드럽게 이어 그린다', () => {
    const { peers, info, tick, posOf, setNow } = setup();
    setNow(1000);
    peers.reset([info(1, 0, 0)], {});
    tick(300);
    // 0.12초마다 0.3m씩 오른쪽으로 가는 위치가 온다 (초당 약 2.5m)
    const xs: number[] = [];
    for (let i = 1; i <= 8; i++) {
      peers.applyMoves([[1, i * 0.3, 0, 0]]);
      for (let k = 0; k < 6; k++) {
        tick(20, 20); // 120ms마다 새 위치, 그 사이 50fps로 그린다
        xs.push(posOf(peers.getMeshes()[1]!, 0).x);
      }
    }
    // 프레임마다 거의 일정하게 늘고, 뚝 끊기지 않는다 (초당 2.5m = 프레임당 0.05m)
    // (보간이 320ms 늦춰 그리니 처음 16프레임은 따라잡는 구간이라 뺀다)
    const steps = xs.slice(16).map((x, i) => x - xs[15 + i]!);
    expect(steps.every((d) => d >= -1e-6)).toBe(true);
    expect(Math.max(...steps)).toBeLessThan(0.07);
    expect(Math.min(...steps.slice(0, -6))).toBeGreaterThan(0.03);
    expect(xs.at(-1)!).toBeGreaterThan(1.2);
  });

  it('모르는 사람의 위치는 무시한다', () => {
    const { peers } = setup();
    expect(() => peers.applyMoves([[99, 1, 1, 0]])).not.toThrow();
  });
});

describe('RemotePeers 자리와 동작', () => {
  it('자리에 앉으면 자리 위치로 가서 앉은 자세가 된다', () => {
    const { peers, info, tick, posOf } = setup();
    peers.reset([info(1, 1.25, 0.75)], {});
    tick(50);
    peers.setSeat('a1', 1);
    expect(peers.seatOwner('a1')).toBe(1);
    tick(800);
    const p = posOf(peers.getMeshes()[1]!, 0);
    expect(p.x).toBeCloseTo(2, 1);
    expect(p.z).toBeCloseTo(0, 1);
    expect(p.y).toBeGreaterThan(0.35); // 앉는 높이만큼 올라간다 (몸통 바닥 기준)
  });

  it('처음 들어왔을 때 이미 앉아 있던 사람은 바로 앉은 모습', () => {
    const { peers, info, posOf, tick } = setup();
    peers.reset([info(3, 0, 0)], { a2: 3 });
    tick(16);
    const p = posOf(peers.getMeshes()[1]!, 0);
    expect(p.x).toBeCloseTo(4, 3);
    expect(p.y).toBeCloseTo(0.5, 2);
  });

  it('자리를 비우면 일어난 자리에서 다시 걷기 시작한다', () => {
    const { peers, info, tick, posOf } = setup();
    peers.reset([info(1, 1.25, 0.75)], { a1: 1 });
    tick(50);
    peers.setSeat('a1', null);
    expect(peers.seatOwner('a1')).toBeNull();
    tick(800);
    const p = posOf(peers.getMeshes()[1]!, 0);
    expect(p.x).toBeCloseTo(2, 1);
    expect(p.y).toBeLessThan(0.05);
  });

  it('나간 사람의 자리는 비워진다', () => {
    const { peers, info } = setup({ reduced: true });
    peers.reset([info(1)], { a1: 1 });
    peers.remove(1);
    expect(peers.seatOwner('a1')).toBeNull();
  });

  it('모르는 자리 id는 앉은 모습으로 만들지 않지만 점유는 기록한다', () => {
    const { peers, info } = setup();
    peers.reset([info(1)], {});
    peers.setSeat('zzz', 1);
    expect(peers.seatOwner('zzz')).toBe(1);
  });

  it('동작을 받으면 뛴다', () => {
    const { peers, info, tick, posOf } = setup();
    peers.reset([info(1, 0, 0)], {});
    tick(50);
    peers.playMotion(1, 'hop');
    let top = 0;
    for (let i = 0; i < 40; i++) {
      tick(16);
      top = Math.max(top, posOf(peers.getMeshes()[1]!, 0).y);
    }
    expect(top).toBeGreaterThan(0.1);
  });

  it('이름표 위치는 머리 위', () => {
    const { peers, info, tick } = setup();
    peers.reset([info(1, 3, 2)], {});
    tick(50);
    const anchor = peers.labelAnchor(1, new THREE.Vector3())!;
    expect([anchor.x, anchor.z]).toEqual([3, 2]);
    expect(anchor.y).toBeGreaterThan(1);
    expect(peers.labelAnchor(77, new THREE.Vector3())).toBeNull();
  });

  it('이름표를 띄울 사람 목록(ids)은 나가는 중인 사람을 뺀다', () => {
    const { peers, info, tick } = setup();
    peers.reset([info(1), info(2)], {});
    tick(50);
    expect([...peers.ids()].sort()).toEqual([1, 2]);
    peers.remove(1);
    expect([...peers.ids()]).toEqual([2]);
  });
});

describe('RemotePeers 응원방 기능', () => {
  it('activeCount는 나가는 중인 사람을 뺀다', () => {
    const { peers, info, tick } = setup({ capacity: 4 });
    peers.add(info(1));
    peers.add(info(2));
    tick(500);
    expect(peers.activeCount).toBe(2);
    peers.remove(1);
    expect(peers.count).toBe(2);
    expect(peers.activeCount).toBe(1);
  });

  it('playMotionAll: 지금 있는 모두가 같은 몸짓을 한다', () => {
    const { peers, info, tick, posOf } = setup({ capacity: 4 });
    peers.reset([info(1, 0, 0), info(2, 3, 0)], {});
    tick(100);
    const head = peers.getMeshes()[0]!;
    const before = [posOf(head, 0).y, posOf(head, 1).y];
    peers.playMotionAll('celebrate', 0);
    tick(250);
    expect(posOf(head, 0).y).toBeGreaterThan(before[0]! + 0.05);
    expect(posOf(head, 1).y).toBeGreaterThan(before[1]! + 0.05);
  });

  it('움직임 줄이기에서는 지연 없이 모두 낮게 뛴다', () => {
    const { peers, info, tick } = setup({ capacity: 4, reduced: true });
    peers.reset([info(1)], {});
    expect(() => {
      peers.playMotionAll('celebrate', 5);
      tick(100);
    }).not.toThrow();
  });

  it('바닥 높이 함수가 있으면 걷는 사람이 평상 높이로 올라간다', () => {
    const { peers, info, tick, posOf } = setup({ capacity: 4 });
    peers.setGroundHeight((x) => (x > 1 ? 0.3 : 0));
    peers.reset([info(1, 0, 0), info(2, 3, 0)], {});
    tick(300);
    const body = peers.getMeshes()[1]!;
    expect(posOf(body, 1).y - posOf(body, 0).y).toBeCloseTo(0.3, 1);
  });

  it('응원 몸짓이 몸통을 기울인다 (함성은 머리가 뒤로)', () => {
    const { peers, info, tick, posOf } = setup({ capacity: 4 });
    peers.reset([info(1, 0, 0)], {});
    tick(100);
    const head = peers.getMeshes()[0]!;
    const z0 = posOf(head, 0).z;
    peers.playMotion(1, 'roar');
    tick(500);
    expect(posOf(head, 0).z).toBeLessThan(z0 - 0.05);
  });
});

describe('RemotePeers 걷기 (발 번갈아 내딛기)', () => {
  const FOOT_Z = 0.08;
  const FOOT_Y = 0.035;

  /** 사람 id가 x축으로 speed(m/s)로 seconds초 걷는다. 받은 위치는 0.1초마다 오고 그 사이 50fps로 그린다 */
  function walk(
    h: ReturnType<typeof setup>,
    id: number,
    speed: number,
    seconds: number,
    from: { x: number },
    onFrame: () => void,
  ) {
    for (let k = 0; k < seconds * 10; k++) {
      from.x += speed * 0.1;
      h.peers.applyMoves([[id, from.x, 0, 0]]);
      for (let j = 0; j < 5; j++) {
        h.tick(20, 20);
        onFrame();
      }
    }
  }
  /** i번째 사람의 (왼발, 오른발) 위치 */
  const feetOf = (h: ReturnType<typeof setup>, i: number) => {
    const feet = h.peers.getMeshes()[2]!;
    return { l: h.posOf(feet, i * 2), r: h.posOf(feet, i * 2 + 1) };
  };

  it('서 있는 사람의 발은 기본 자리에 나란히 있다', () => {
    const h = setup({ capacity: 4 });
    h.peers.reset([h.info(1, 2, 3)], {});
    h.tick(800);
    const { l, r } = feetOf(h, 0);
    expect(l.x).toBeCloseTo(2 - 0.09, 2);
    expect(r.x).toBeCloseTo(2 + 0.09, 2);
    expect(l.z).toBeCloseTo(3 + FOOT_Z, 2);
    expect(r.z).toBeCloseTo(3 + FOOT_Z, 2);
    expect(l.y).toBeCloseTo(FOOT_Y, 2);
    expect(r.y).toBeCloseTo(FOOT_Y, 2);
  });

  it('걷는 사람의 발은 번갈아 앞뒤로 움직이고 한 발씩 든다', () => {
    const h = setup({ capacity: 4 });
    h.setNow(1000);
    h.peers.reset([h.info(1, 0, 0)], {});
    h.tick(800);
    const from = { x: 0 };
    const diffs: number[] = [];
    let maxLift = 0;
    walk(h, 1, 2.5, 4, from, () => {
      const { l, r } = feetOf(h, 0);
      diffs.push(l.z - r.z);
      maxLift = Math.max(maxLift, l.y - FOOT_Y, r.y - FOOT_Y);
    });
    const settled = diffs.slice(100); // 걷기가 자리잡은 뒤 (2초 뒤부터)
    expect(Math.max(...settled)).toBeGreaterThan(0.15);
    expect(Math.min(...settled)).toBeLessThan(-0.15);
    expect(maxLift).toBeGreaterThan(0.03);
    // 부호가 바뀌는 횟수: 2초 동안 약 2바퀴 = 4번 안팎
    let flips = 0;
    for (let i = 1; i < settled.length; i++) if (Math.sign(settled[i]!) !== Math.sign(settled[i - 1]!)) flips += 1;
    expect(flips).toBeGreaterThanOrEqual(3);
    expect(flips).toBeLessThanOrEqual(6);
  });

  it('천천히 걷는 사람은 걸음 폭이 작다', () => {
    const stride = (speed: number) => {
      const h = setup({ capacity: 4 });
      h.setNow(1000);
      h.peers.reset([h.info(1, 0, 0)], {});
      h.tick(800);
      const from = { x: 0 };
      const diffs: number[] = [];
      walk(h, 1, speed, 4, from, () => {
        const { l, r } = feetOf(h, 0);
        diffs.push(l.z - r.z);
      });
      return Math.max(...diffs.slice(100).map(Math.abs));
    };
    const fast = stride(2.6);
    const slow = stride(1.3);
    expect(slow).toBeGreaterThan(0.05);
    expect(slow).toBeLessThan(fast * 0.7);
  });

  it('멈추면 발이 다시 나란히 선다', () => {
    const h = setup({ capacity: 4 });
    h.setNow(1000);
    h.peers.reset([h.info(1, 0, 0)], {});
    h.tick(800);
    const from = { x: 0 };
    walk(h, 1, 2.5, 2, from, () => {});
    h.tick(1500);
    const { l, r } = feetOf(h, 0);
    expect(l.z - r.z).toBeCloseTo(0, 2);
    expect(l.y).toBeCloseTo(FOOT_Y, 2);
    expect(r.y).toBeCloseTo(FOOT_Y, 2);
  });

  it('위치가 잔떨림만 있는 사람은 발이 꼼지락거리지 않는다', () => {
    const h = setup({ capacity: 4 });
    h.setNow(1000);
    h.peers.reset([h.info(1, 0, 0)], {});
    h.tick(800);
    let worst = 0;
    for (let k = 0; k < 40; k++) {
      h.peers.applyMoves([[1, (k % 2 ? 1 : -1) * 0.01, 0, 0]]);
      for (let j = 0; j < 6; j++) {
        h.tick(20, 20);
        const { l, r } = feetOf(h, 0);
        worst = Math.max(worst, Math.abs(l.z - r.z));
      }
    }
    expect(worst).toBeLessThan(0.005);
  });

  it('앉은 사람은 걷는 신호가 있어도 발이 가만히 있다', () => {
    const h = setup({ capacity: 4 });
    h.setNow(1000);
    h.peers.reset([h.info(1, 2, 0)], { a1: 1 });
    h.tick(300);
    const from = { x: 2 };
    let worst = 0;
    walk(h, 1, 2.5, 2, from, () => {
      const { l, r } = feetOf(h, 0);
      worst = Math.max(worst, Math.abs(l.z - r.z));
    });
    expect(worst).toBeLessThan(1e-4);
  });

  it('걷다가 앉으면 걸음이 멎는다', () => {
    const h = setup({ capacity: 4 });
    h.setNow(1000);
    h.peers.reset([h.info(1, 0, 0)], {});
    h.tick(800);
    const from = { x: 0 };
    walk(h, 1, 2.5, 1.5, from, () => {});
    h.peers.setSeat('a1', 1);
    h.tick(1200);
    const { l, r } = feetOf(h, 0);
    expect(Math.abs(l.z - r.z)).toBeLessThan(1e-3);
  });

  it('움직임 줄이기: 발은 조금만 움직이고 몸은 거의 튀지 않는다', () => {
    const run = (reduced: boolean) => {
      const h = setup({ capacity: 4, reduced });
      h.setNow(1000);
      h.peers.reset([h.info(1, 0, 0)], {});
      h.tick(800);
      const from = { x: 0 };
      let stride = 0;
      let bodyTop = 0;
      walk(h, 1, 2.5, 3, from, () => {
        const { l, r } = feetOf(h, 0);
        stride = Math.max(stride, Math.abs(l.z - r.z));
        bodyTop = Math.max(bodyTop, h.posOf(h.peers.getMeshes()[1]!, 0).y);
      });
      return { stride, bodyTop };
    };
    const normal = run(false);
    const reduced = run(true);
    expect(reduced.stride).toBeGreaterThan(0.03);
    expect(reduced.stride).toBeLessThan(normal.stride * 0.5);
    expect(reduced.bodyTop).toBeLessThan(0.01);
    expect(normal.bodyTop).toBeGreaterThan(0.02);
  });

  it('수십 명이 걸어도 그리기 호출은 그대로 5번이다', () => {
    const h = setup({ capacity: 60 });
    h.setNow(1000);
    h.peers.reset(Array.from({ length: 50 }, (_, i) => h.info(i + 1, 0, i * 0.5)), {});
    h.tick(800);
    const xs = new Map<number, number>();
    for (let k = 0; k < 20; k++) {
      h.peers.applyMoves(Array.from({ length: 50 }, (_, i): [number, number, number, number] => {
        const x = (xs.get(i + 1) ?? 0) + 0.25;
        xs.set(i + 1, x);
        return [i + 1, x, i * 0.5, 0];
      }));
      h.tick(100, 20);
    }
    expect(h.drawCalls()).toBe(5);
    const feet = h.peers.getMeshes()[2]!;
    expect(feet.count).toBe(100);
    expect(feet.visible).toBe(true);
    // 걷는 사람들의 발이 실제로 어긋나 있다 (사람마다 걸음이 달라도 대부분 한 발이 앞)
    let apart = 0;
    for (let i = 0; i < 50; i++) {
      const { l, r } = feetOf(h, i);
      if (Math.abs(l.z - r.z) > 0.01) apart += 1;
    }
    expect(apart).toBeGreaterThan(40);
  });
});

describe('RemotePeers 걷기: 위치가 초당 4번만 와도 다리가 끊기지 않는다', () => {
  it('250ms마다 위치가 와도 걸음 폭이 계속 이어진다 (멈칫하는 구간이 없다)', () => {
    const h = setup({ capacity: 4 });
    h.setNow(1000);
    h.peers.reset([h.info(1, 0, 0)], {});
    h.tick(800);
    const feet = h.peers.getMeshes()[2]!;
    const stride: number[] = [];
    let x = 0;
    const speed = 1.4;
    // 8초: 250ms마다 위치 하나, 그 사이 60fps(약 16ms)로 그린다
    for (let k = 0; k < 32; k++) {
      x += speed * 0.25;
      h.peers.applyMoves([[1, x, 0, 0]]);
      for (let j = 0; j < 15; j++) {
        h.tick(16, 16);
        stride.push(Math.abs(h.posOf(feet, 0).z - h.posOf(feet, 1).z));
      }
    }
    const settled = stride.slice(180); // 3초 뒤부터
    // 0.5초(약 30프레임) 창마다 가장 큰 벌어짐이 전체 최대의 절반 이상: 한 창 내내 거의 멈춘 구간이 없다
    const peak = Math.max(...settled);
    expect(peak).toBeGreaterThan(0.1);
    for (let i = 0; i + 30 <= settled.length; i += 15) {
      expect(Math.max(...settled.slice(i, i + 30))).toBeGreaterThan(peak * 0.5);
    }
  });
});
