import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  Avatar,
  PoseState,
  WALK_SPEED,
  createGait,
  disposeAvatarResources,
  getOutfit,
  motionArms,
  motionOffset,
  registerOutfit,
  walkGait,
} from './avatar';
import type { ActionMotion } from './types';

afterAll(() => disposeAvatarResources());

const vertexCount = (a: Avatar) =>
  a.getMeshes().reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);

describe('Avatar', () => {
  it('기본 캐릭터는 그리기 호출 8번(몸통, 머리, 발 두 짝, 팔 두 짝, 손 두 짝)', () => {
    expect(new Avatar({ detail: 'peer' }).getMeshes()).toHaveLength(8);
  });

  it('내 캐릭터가 남의 캐릭터보다 분할 수가 많다', () => {
    expect(vertexCount(new Avatar({ detail: 'self' }))).toBeGreaterThan(vertexCount(new Avatar({ detail: 'peer' })) * 3);
  });

  it('같은 해상도끼리는 geometry와 material을 공유한다', () => {
    const a = new Avatar({ detail: 'peer' });
    const b = new Avatar({ detail: 'peer' });
    expect(a.getMeshes()[0]!.geometry).toBe(b.getMeshes()[0]!.geometry);
    expect(a.getMeshes()[1]!.material).toBe(b.getMeshes()[1]!.material);
  });

  it('왼발과 오른발은 같은 geometry와 몸통 재질을 나눠 쓴다', () => {
    const a = new Avatar({ detail: 'peer' });
    const b = new Avatar({ detail: 'peer' });
    const [body, , footL, footR] = a.getMeshes();
    expect(footL!.geometry).toBe(footR!.geometry);
    expect(footL!.geometry).toBe(b.getMeshes()[2]!.geometry);
    expect(footL!.geometry).not.toBe(body!.geometry);
    expect(footL!.material).toBe(body!.material);
    expect(footR!.material).toBe(body!.material);
  });

  it('분할 수를 직접 지정할 수 있다', () => {
    const custom = new Avatar({
      detail: { headWidthSegments: 6, headHeightSegments: 4, bodyRadialSegments: 6, bodyCapSegments: 1, eyeSegments: 3 },
    });
    expect(vertexCount(custom)).toBeLessThan(vertexCount(new Avatar({ detail: 'peer' })));
  });

  it('옷을 바꾸면 색과 소품이 바뀐다', () => {
    registerOutfit({
      id: 'test-hat',
      bodyColor: 0x336699,
      skinColor: 0xffddcc,
      accessories: [
        {
          key: 'hat',
          attach: 'head',
          create: () => new THREE.ConeGeometry(0.1, 0.2, 6),
          color: 0xaa3333,
          position: [0, 0.3, 0],
        },
      ],
    });
    const a = new Avatar({ detail: 'peer' });
    expect(a.getMeshes()).toHaveLength(8);
    a.setOutfit('test-hat');
    expect(a.getMeshes()).toHaveLength(9);
    const body = a.getMeshes()[0]!.material as THREE.MeshLambertMaterial;
    expect(body.color.getHex()).toBe(0x336699);
    // 발도 몸통 옷 색을 따라간다
    expect((a.getMeshes()[2]!.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0x336699);
    a.setOutfit('plain');
    expect(a.getMeshes()).toHaveLength(8);
  });

  it('모르는 옷 id는 기본형으로', () => {
    expect(getOutfit('없는옷').id).toBe('plain');
  });

  it('앉으면 낮아지고 일어나면 돌아온다', () => {
    const a = new Avatar({ detail: 'peer', reducedMotion: true });
    a.setSeated(true, 0.42);
    for (let i = 0; i < 30; i++) a.update(1 / 30);
    expect(a.root.position.y).toBeCloseTo(0.42, 3);
    a.setSeated(false);
    for (let i = 0; i < 30; i++) a.update(1 / 30);
    expect(a.root.position.y).toBeCloseTo(0, 3);
  });
});

describe('motionOffset', () => {
  it('시작과 끝은 바닥, 가운데는 꼭대기', () => {
    expect(motionOffset('hop', 0, false).y).toBeCloseTo(0);
    expect(motionOffset('hop', 0.25, false).y).toBeCloseTo(0.3);
    expect(motionOffset('hop', 0.5, false)).toMatchObject({ done: true });
    expect(motionOffset('hop', 0.5, false).y).toBeCloseTo(0, 5);
  });

  it('두 번 뛰기는 가운데에서 한 번 바닥에 닿는다', () => {
    expect(motionOffset('hop-double', 0.4, false).y).toBeCloseTo(0, 5);
    expect(motionOffset('hop-double', 0.2, false).y).toBeCloseTo(0.2);
  });

  it('움직임 줄이기: 낮게 뛰고 돌지 않는다', () => {
    const normal = motionOffset('hop-spin', 0.375, false);
    const reduced = motionOffset('hop-spin', 0.375, true);
    expect(normal.spin).toBeGreaterThan(0);
    expect(reduced.spin).toBe(0);
    expect(reduced.y).toBeLessThan(normal.y * 0.5);
  });
});

describe('응원 몸짓 (박수, 건배, 함성, 같이 신남)', () => {
  const all: ActionMotion[] = ['clap', 'toast', 'roar', 'celebrate'];

  it('끝나면 바닥으로 돌아오고 기울임도 0이다', () => {
    const dur: Record<string, number> = { clap: 0.7, toast: 0.9, roar: 1.0, celebrate: 1.6 };
    for (const m of all) {
      const end = motionOffset(m, dur[m]!, false);
      expect(end.done).toBe(true);
      expect(end.y).toBeCloseTo(0, 5);
      expect(Math.abs(end.roll)).toBeLessThan(1e-9);
      expect(Math.abs(end.pitch)).toBeLessThan(1e-9);
      expect(motionOffset(m, 0, false).done).toBe(false);
    }
  });

  it('캐릭터에 팔이 없으니 몸을 쓴다: 함성은 뒤로 젖히며 늘어나고, 건배는 기울고, 박수는 잔 뜀박질', () => {
    const roar = motionOffset('roar', 0.5, false);
    expect(roar.pitch).toBeLessThan(-0.3);
    expect(roar.squash).toBeGreaterThan(0.1);
    expect(Math.abs(motionOffset('toast', 0.45, false).roll)).toBeGreaterThan(0.2);
    // 박수는 0.7초에 다섯 번 뛴다: 바닥에 닿는 순간이 다섯 번(0.14초마다)
    const feet = [0, 0.14, 0.28, 0.42, 0.56, 0.7].map((t) => motionOffset('clap', t, false).y);
    for (const y of feet) expect(y).toBeCloseTo(0, 5);
    expect(motionOffset('clap', 0.07, false).y).toBeGreaterThan(0.05);
  });

  it('같이 신남은 크게 세 번 뛴다', () => {
    const peak = Math.max(...Array.from({ length: 160 }, (_, i) => motionOffset('celebrate', (i / 160) * 1.6, false).y));
    expect(peak).toBeCloseTo(0.3, 1);
    expect(motionOffset('celebrate', 1.6 / 3, false).y).toBeCloseTo(0, 5); // 뛰기 사이에 바닥을 친다
  });

  it('움직임 줄이기: 낮게 뛰고, 늘어나지 않고, 덜 기운다', () => {
    for (const m of all) {
      const t = 0.3;
      const normal = motionOffset(m, t, false);
      const reduced = motionOffset(m, t, true);
      expect(reduced.y).toBeLessThanOrEqual(normal.y * 0.36 + 1e-9);
      expect(reduced.squash).toBe(0);
      expect(Math.abs(reduced.roll)).toBeLessThanOrEqual(Math.abs(normal.roll) * 0.31 + 1e-9);
      expect(Math.abs(reduced.pitch)).toBeLessThanOrEqual(Math.abs(normal.pitch) * 0.31 + 1e-9);
    }
  });
});

describe('PoseState 시작 지연과 바닥 높이', () => {
  it('지연이 있으면 그 뒤에 시작한다', () => {
    const s = new PoseState(false);
    s.playMotion('celebrate', 0.2);
    s.update(0.1);
    expect(s.compute().poseY).toBe(0);
    for (let i = 0; i < 4; i++) s.update(0.1);
    expect(s.compute().poseY).toBeGreaterThan(0);
  });

  it('몸짓의 기울임이 자세에 실린다', () => {
    const s = new PoseState(false);
    s.playMotion('roar');
    for (let i = 0; i < 5; i++) s.update(0.1);
    expect(s.compute().pitch).toBeLessThan(-0.3);
  });

  it('평상 위로 올라가면 높이가 부드럽게 따라가고, 앉으면 앉는 면 높이가 된다', () => {
    const s = new PoseState(true);
    s.groundY = 0.3;
    s.update(1 / 60);
    const first = s.compute().rootY;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.3);
    for (let i = 0; i < 60; i++) s.update(1 / 30);
    expect(s.compute().rootY).toBeCloseTo(0.3, 2);
    s.seated = true;
    s.seatY = 0.39;
    for (let i = 0; i < 30; i++) s.update(1 / 30);
    expect(s.compute().rootY).toBeCloseTo(0.39, 2);
  });

  it('snapGround는 바로 간다', () => {
    const s = new PoseState(true);
    s.snapGround(0.3);
    expect(s.compute().rootY).toBeCloseTo(0.3);
  });
});

describe('Avatar 바닥 높이', () => {
  it('setGround가 캐릭터를 올린다', () => {
    const a = new Avatar({ detail: 'peer', reducedMotion: true });
    a.setGround(0.3);
    for (let i = 0; i < 60; i++) a.update(1 / 30);
    expect(a.root.position.y).toBeCloseTo(0.3, 2);
  });
});

describe('walkGait (걷기 한 걸음)', () => {
  const sample = (amount: number, reduced = false, n = 64) =>
    Array.from({ length: n }, (_, i) => walkGait((i / n) * Math.PI * 2, amount, reduced));

  it('멈춰 있으면(amount 0) 모든 값이 0이다', () => {
    for (const g of sample(0)) expect(Object.values(g).every((v) => v === 0)).toBe(true);
    expect(Object.values(walkGait(1.23, 0, true)).every((v) => v === 0)).toBe(true);
  });

  it('두 발은 번갈아 앞으로 나온다: 한 쪽이 앞이면 다른 쪽은 뒤', () => {
    const gs = sample(1);
    for (const g of gs) expect(g.stepL).toBeCloseTo(-g.stepR, 9);
    expect(gs.some((g) => g.stepL > 0.1 && g.stepR < -0.1)).toBe(true);
    expect(gs.some((g) => g.stepL < -0.1 && g.stepR > 0.1)).toBe(true);
  });

  it('발은 앞으로 나올 때만 들리고, 두 발이 동시에 들리지는 않는다', () => {
    const n = 360;
    let liftedSeen = 0;
    for (let i = 0; i < n; i++) {
      const p = (i / n) * Math.PI * 2;
      const g = walkGait(p, 1, false);
      const ahead = walkGait(p + 1e-4, 1, false);
      if (g.liftL > 1e-6) {
        expect(ahead.stepL).toBeGreaterThan(g.stepL); // 왼발이 앞으로 가는 중
        liftedSeen += 1;
      }
      if (g.liftR > 1e-6) expect(ahead.stepR).toBeGreaterThan(g.stepR);
      expect(g.liftL * g.liftR).toBe(0);
    }
    expect(liftedSeen).toBeGreaterThan(n / 3);
    // 가장 높이 들었을 때가 발 높이
    expect(Math.max(...sample(1).map((g) => Math.max(g.liftL, g.liftR)))).toBeCloseTo(0.06, 2);
  });

  it('걸음 폭은 속도에 비례하고, 한 바퀴 뒤에는 처음으로 돌아온다', () => {
    const full = Math.max(...sample(1).map((g) => g.stepL));
    const half = Math.max(...sample(0.5).map((g) => g.stepL));
    expect(full).toBeCloseTo(0.13, 2);
    expect(half).toBeCloseTo(full / 2, 3);
    const a = walkGait(0.7, 0.8, false);
    const b = walkGait(0.7 + Math.PI * 2, 0.8, false);
    for (const k of Object.keys(a) as Array<keyof typeof a>) expect(b[k]).toBeCloseTo(a[k], 9);
  });

  it('몸은 두 발이 엇갈릴 때 가장 높고 한 걸음마다 한 번 튄다 (걷는 속도에서 1초에 두 번)', () => {
    expect(walkGait(0, 1, false).bob).toBeCloseTo(0.035, 5);
    expect(walkGait(Math.PI, 1, false).bob).toBeCloseTo(0.035, 5);
    expect(walkGait(Math.PI / 2, 1, false).bob).toBeCloseTo(0, 5);
    expect(walkGait(Math.PI * 1.5, 1, false).bob).toBeCloseTo(0, 5);
    expect(Math.min(...sample(1).map((g) => g.bob))).toBeGreaterThanOrEqual(0);
  });

  it('딛고 선 발 쪽으로 몸이 기울고 살짝 앞으로 숙인다', () => {
    const gs = sample(1);
    expect(gs.some((g) => g.sway > 0.05) && gs.some((g) => g.sway < -0.05)).toBe(true);
    expect(Math.max(...gs.map((g) => Math.abs(g.sway)))).toBeLessThan(0.08);
    for (const g of gs) expect(g.lean).toBeCloseTo(0.06, 9);
    // 왼발(x<0)이 딛고 선 순간(뒤로 가는 중, 위상 π) 머리는 -x 쪽: z축 회전이 +
    expect(walkGait(Math.PI, 1, false).sway).toBeGreaterThan(0.05);
  });

  it('움직임 줄이기: 폭, 높이, 통통 튐이 훨씬 작고 기울임과 숙임이 없다', () => {
    const normal = sample(1, false);
    const reduced = sample(1, true);
    const maxOf = (gs: ReturnType<typeof sample>, k: 'stepL' | 'liftL' | 'bob') => Math.max(...gs.map((g) => g[k]));
    expect(maxOf(reduced, 'stepL')).toBeLessThanOrEqual(maxOf(normal, 'stepL') * 0.41);
    expect(maxOf(reduced, 'stepL')).toBeGreaterThan(0.03); // 그래도 걷는 건 보인다
    expect(maxOf(reduced, 'liftL')).toBeLessThanOrEqual(maxOf(normal, 'liftL') * 0.41);
    expect(maxOf(reduced, 'bob')).toBeLessThanOrEqual(maxOf(normal, 'bob') * 0.26);
    expect(maxOf(reduced, 'bob')).toBeLessThan(0.01);
    for (const g of reduced) {
      expect(g.sway).toBe(0);
      expect(g.lean).toBe(0);
    }
  });

  it('넘겨 준 객체를 재사용한다 (프레임마다 새로 만들지 않는다)', () => {
    const out = createGait();
    expect(walkGait(1, 1, false, out)).toBe(out);
  });
});

describe('PoseState 걷기', () => {
  const FOOT_Z = 0.08;
  const FOOT_Y = 0.035;
  const DT = 1 / 60;

  /** 목표 속도를 주고 seconds만큼 돌리며 프레임마다 자세를 모은다 */
  function run(s: PoseState, seconds: number, speed?: number) {
    if (speed !== undefined) s.speedTarget = speed;
    const frames: ReturnType<PoseState['compute']>[] = [];
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      s.update(DT);
      frames.push(s.compute());
    }
    return frames;
  }
  // 숨쉬기로 몸통 비율이 조금씩 변하니, 기본 자리도 그 비율을 따른다
  const stepL = (f: { footLZ: number; bodyScaleXZ: number }) => f.footLZ - FOOT_Z * f.bodyScaleXZ;
  const stepR = (f: { footRZ: number; bodyScaleXZ: number }) => f.footRZ - FOOT_Z * f.bodyScaleXZ;

  it('가만히 서 있으면 발은 기본 자리에 있고 몸은 튀지 않는다', () => {
    const s = new PoseState(true);
    for (const f of run(s, 1)) {
      expect(f.footX).toBeCloseTo(0.09, 9);
      expect(f.footLZ).toBeCloseTo(FOOT_Z, 9);
      expect(f.footRZ).toBeCloseTo(FOOT_Z, 9);
      expect(f.footLY).toBeCloseTo(FOOT_Y, 9);
      expect(f.footRY).toBeCloseTo(FOOT_Y, 9);
      expect(f.poseY).toBe(0);
      expect(f.roll).toBe(0);
      expect(f.pitch).toBe(0);
    }
  });

  it('걸으면 두 발이 번갈아 앞뒤로 움직이고, 한 발씩 든다', () => {
    const s = new PoseState(false);
    const frames = run(s, 3, 1).slice(60); // 걷기가 자리잡은 뒤
    for (const f of frames) expect(stepL(f)).toBeCloseTo(-stepR(f), 6);
    expect(frames.some((f) => stepL(f) > 0.1 && stepR(f) < -0.1)).toBe(true);
    expect(frames.some((f) => stepL(f) < -0.1 && stepR(f) > 0.1)).toBe(true);
    const liftL = Math.max(...frames.map((f) => f.footLY - FOOT_Y + f.poseY - f.footLZ * f.pitch - f.footX * f.roll));
    expect(liftL).toBeGreaterThan(0.04);
    // 한 발이 땅에 있는 동안 반대 발이 든다
    for (const f of frames) {
      const worldL = f.footLY + f.poseY - f.footLZ * f.pitch - f.footX * f.roll - FOOT_Y;
      const worldR = f.footRY + f.poseY - f.footRZ * f.pitch + f.footX * f.roll - FOOT_Y;
      expect(Math.min(worldL, worldR)).toBeLessThan(0.002);
    }
  });

  it('걷는 속도에서 한 바퀴(왼발 한 걸음 + 오른발 한 걸음)가 약 1초', () => {
    const s = new PoseState(false);
    const frames = run(s, 6, 1).slice(60); // 5초
    let rising = 0;
    for (let i = 1; i < frames.length; i++) if (stepL(frames[i - 1]!) < 0 && stepL(frames[i]!) >= 0) rising += 1;
    // 5초에 약 5바퀴
    expect(rising).toBeGreaterThanOrEqual(4);
    expect(rising).toBeLessThanOrEqual(6);
  });

  it('천천히 걸으면 폭이 작고 걸음도 느리다. 그래도 자연스러운 걸음보다 빨라지지는 않는다', () => {
    // 시작 위상이 제각각이라 바퀴 수는 ±1 어긋날 수 있다: 10초 동안 센다
    const cross = (speed: number) => {
      const s = new PoseState(false);
      const fr = run(s, 11, speed).slice(60);
      let n = 0;
      for (let i = 1; i < fr.length; i++) if (stepL(fr[i - 1]!) < 0 && stepL(fr[i]!) >= 0) n += 1;
      return { n, amp: Math.max(...fr.map(stepL)) };
    };
    const full = cross(1); // 10초에 약 10바퀴
    const half = cross(0.5); // 0.75Hz라 약 7.5바퀴
    expect(full.n).toBeGreaterThanOrEqual(9);
    expect(full.n).toBeLessThanOrEqual(11);
    expect(half.amp).toBeCloseTo(full.amp * 0.5, 1);
    expect(half.n).toBeLessThan(full.n - 1);
    expect(half.n).toBeGreaterThanOrEqual(6);
    const over = cross(2); // 1을 넘는 목표는 1로 본다
    expect(Math.abs(over.n - full.n)).toBeLessThanOrEqual(1);
    expect(over.amp).toBeCloseTo(full.amp, 2);
  });

  it('속도가 거의 0이면 움직이지 않는다', () => {
    const s = new PoseState(false);
    for (const f of run(s, 1, 0.01)) {
      expect(Math.abs(stepL(f))).toBeLessThan(0.002);
      expect(f.poseY).toBeLessThan(0.002);
    }
  });

  it('앉아 있으면 걷는 신호가 와도 발은 가만히 있는다', () => {
    const s = new PoseState(false);
    s.snapSeated(true);
    const frames = run(s, 1, 1);
    for (const f of frames) {
      // 앉으면 발은 양반다리처럼 앞 양옆(0.15, 0.17)에 가만히 있다
      expect(f.footLZ).toBeCloseTo(0.17 * f.bodyScaleXZ, 9);
      expect(f.footRZ).toBeCloseTo(0.17 * f.bodyScaleXZ, 9);
      expect(f.footLY - FOOT_Y * f.bodyScaleY).toBeCloseTo(0, 9);
      expect(f.roll).toBeCloseTo(0, 9);
    }
  });

  it('걷다 앉으면 앉는 동안 걸음이 사그라든다', () => {
    const s = new PoseState(false);
    run(s, 1, 1);
    s.seated = true;
    s.speedTarget = 0;
    const frames = run(s, 1);
    // 두 발이 엇갈린 폭의 반 (앉으면 발 기본 자리가 옮겨 가므로 두 발의 차이로 잰다)
    const amp = (fs: typeof frames) => Math.max(...fs.map((f) => Math.abs(f.footLZ - f.footRZ) / 2));
    expect(amp(frames.slice(0, 5))).toBeGreaterThan(amp(frames.slice(-10)));
    expect(amp(frames.slice(-10))).toBeLessThan(1e-6);
  });

  it('멈추면 서 있는 자세로 부드럽게 돌아온다', () => {
    const s = new PoseState(false);
    run(s, 1, 1);
    const frames = run(s, 1, 0);
    expect(Math.abs(stepL(frames.at(-1)!))).toBeLessThan(1e-3);
    expect(frames.at(-1)!.footLY).toBeCloseTo(FOOT_Y, 2);
    // 갑자기 튀지 않는다 (프레임마다 최대 폭의 18%씩 줄어 2~3cm 이내)
    const steps = frames.slice(1).map((f, i) => Math.abs(stepL(f) - stepL(frames[i]!)));
    expect(Math.max(...steps)).toBeLessThan(0.03);
  });

  it('걷고 멈추고 다시 걸어도 발이 순간이동하지 않는다 (위상이 이어진다)', () => {
    const s = new PoseState(false);
    const all = [...run(s, 1.3, 1), ...run(s, 0.7, 0), ...run(s, 1.1, 0.6), ...run(s, 0.5, 0), ...run(s, 1, 1)];
    const jumps = all.slice(1).map((f, i) => Math.abs(stepL(f) - stepL(all[i]!)));
    // 걷는 중 최대 변화 = 폭 0.13 x 2π x 1Hz / 60프레임 = 약 0.0136. 멈추는 첫 프레임에는 폭이 18% 줄며 최대 0.13 x 0.18 = 0.023
    expect(Math.max(...jumps)).toBeLessThan(0.03);
    const lifts = all.slice(1).map((f, i) => Math.abs(f.footLY - all[i]!.footLY));
    expect(Math.max(...lifts)).toBeLessThan(0.03);
  });

  it('움직임 줄이기: 발은 조금 움직이지만 몸은 거의 튀거나 기울지 않는다', () => {
    const normal = run(new PoseState(false), 3, 1).slice(60);
    const reduced = run(new PoseState(true), 3, 1).slice(60);
    const ampL = (fs: typeof normal) => Math.max(...fs.map(stepL));
    expect(ampL(reduced)).toBeGreaterThan(0.03);
    expect(ampL(reduced)).toBeLessThan(ampL(normal) * 0.45);
    expect(Math.max(...reduced.map((f) => f.poseY))).toBeLessThan(0.01);
    for (const f of reduced) {
      expect(f.roll).toBe(0);
      expect(f.pitch).toBe(0);
    }
  });

  it('걸으면 몸이 앞으로 살짝 숙고 좌우로 흔들린다', () => {
    const frames = run(new PoseState(false), 3, 1).slice(60);
    for (const f of frames) expect(f.pitch).toBeGreaterThan(0.04);
    expect(frames.some((f) => f.roll > 0.04) && frames.some((f) => f.roll < -0.04)).toBe(true);
  });

  it('딛고 선 발은 몸이 튀고 숙고 기울어도 땅에 붙어 있다', () => {
    const frames = run(new PoseState(false), 3, 1).slice(60);
    for (const f of frames) {
      // pose 그룹의 회전(숙임 pitch, 기울임 roll)까지 감안한 발의 실제 높이 (작은 각 근사)
      const worldY = (y: number, x: number, z: number) => y + f.poseY - z * f.pitch + x * f.roll;
      const planted = Math.min(worldY(f.footLY, -f.footX, f.footLZ), worldY(f.footRY, f.footX, f.footRZ));
      expect(Math.abs(planted - FOOT_Y)).toBeLessThan(0.0015);
    }
  });

  it('동작 몸짓은 걷는 중에도 겹쳐서 보인다', () => {
    const s = new PoseState(false);
    run(s, 0.5, 1);
    s.playMotion('hop');
    const frames = run(s, 0.25);
    expect(Math.max(...frames.map((f) => f.poseY))).toBeGreaterThan(0.2);
    // 뛰어오르면 발도 같이 뜬다
    expect(Math.max(...frames.map((f) => f.footLY + f.poseY))).toBeGreaterThan(0.2);
  });

  it('앉는 동안 앞으로 숙이며 폴짝 올랐다가, 다 앉으면 꾹 눌리고 살짝 뒤로 기댄다', () => {
    const s = new PoseState(false);
    s.seated = true;
    const frames = run(s, 1.2);
    const mid = frames.slice(0, 30);
    expect(Math.max(...mid.map((f) => f.pitch))).toBeGreaterThan(0.2);
    expect(Math.max(...mid.map((f) => f.poseY))).toBeGreaterThan(0.05);
    // 다 앉은 직후 한 번 아래로 눌린다
    expect(Math.min(...frames.map((f) => f.poseY))).toBeLessThan(-0.02);
    const last = frames.at(-1)!;
    expect(last.pitch).toBeLessThan(0);
    expect(last.poseY).toBeCloseTo(0, 6);
  });

  it('몸통이 눌리면(앉기) 발도 같은 비율로 눌린다', () => {
    const s = new PoseState(true);
    s.snapSeated(true);
    const f = s.compute();
    expect(f.footX).toBeCloseTo(0.15 * f.bodyScaleXZ, 9);
    expect(f.footLY).toBeCloseTo(FOOT_Y * f.bodyScaleY, 9);
  });
});

describe('Avatar 걷기', () => {
  const feet = (a: Avatar) => {
    const [, , l, r] = a.getMeshes();
    return { l: l!, r: r! };
  };

  it('setWalking으로 걸으면 두 발 mesh가 번갈아 앞뒤로 움직인다', () => {
    const a = new Avatar({ detail: 'peer' });
    const { l, r } = feet(a);
    expect(l.position.x).toBeLessThan(0);
    expect(r.position.x).toBeGreaterThan(0);
    const diffs: number[] = [];
    a.setWalking(1);
    for (let i = 0; i < 90; i++) {
      a.update(1 / 60);
      diffs.push(l.position.z - r.position.z);
    }
    expect(Math.max(...diffs)).toBeGreaterThan(0.15);
    expect(Math.min(...diffs)).toBeLessThan(-0.15);
  });

  it('멈추면 발이 나란히 선다', () => {
    const a = new Avatar({ detail: 'peer' });
    const { l, r } = feet(a);
    a.setWalking(1);
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    a.setWalking(0);
    for (let i = 0; i < 90; i++) a.update(1 / 60);
    expect(l.position.z).toBeCloseTo(r.position.z, 3);
    expect(l.position.y).toBeCloseTo(r.position.y, 3);
  });

  it('앉아 있으면 걷는 신호에도 발이 나란하다', () => {
    const a = new Avatar({ detail: 'peer' });
    const { l, r } = feet(a);
    a.setSeated(true, 0.42);
    a.setWalking(1);
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    expect(l.position.z).toBeCloseTo(r.position.z, 6);
  });

  it('setWalking은 0~1로 자른다 (실제 속도 / WALK_SPEED를 넣는다)', () => {
    const a = new Avatar({ detail: 'peer' });
    a.setWalking(5);
    for (let i = 0; i < 120; i++) a.update(1 / 60);
    const { l, r } = feet(a);
    expect(Math.abs(l.position.z - r.position.z)).toBeLessThanOrEqual(2 * 0.13 + 1e-6);
    expect(WALK_SPEED).toBe(2.6);
  });
});

describe('팔', () => {
  it('서 있으면 두 팔이 살짝 벌어져 늘어지고, 앉으면 무릎 쪽 앞으로 온다', () => {
    const s = new PoseState(true);
    const stand = s.compute();
    expect(stand.armLFwd).toBeCloseTo(0, 6);
    expect(stand.armLOut).toBeGreaterThan(0.1);
    s.snapSeated(true);
    const seated = s.compute();
    expect(seated.armLFwd).toBeGreaterThan(0.5);
    expect(seated.armRFwd).toBeGreaterThan(0.5);
  });

  it('걸을 때 두 팔이 엇갈려 흔들린다', () => {
    const s = new PoseState(false);
    s.speedTarget = 1;
    const fwds: number[] = [];
    for (let i = 0; i < 90; i++) {
      s.update(1 / 60);
      const f = s.compute();
      fwds.push(f.armLFwd + f.armRFwd);
      if (i > 30) expect(Math.sign(f.armLFwd) * Math.sign(f.armRFwd)).toBeLessThanOrEqual(0);
    }
    expect(Math.max(...fwds.map(Math.abs))).toBeLessThan(1e-6);
  });

  it('동작마다 팔 모양: 박수는 앞으로 모으고, 건배·주문은 오른팔을 들고, 골은 두 팔을 든다', () => {
    const mid = (m: 'clap' | 'toast' | 'roar' | 'celebrate') => motionArms(m, 0.45, false);
    expect(mid('clap').lf).toBeGreaterThan(1);
    expect(mid('clap').lo).toBeLessThan(0);
    expect(mid('toast').rf).toBeGreaterThan(2);
    expect(mid('roar').rf).toBeGreaterThan(2);
    expect(mid('celebrate').lf).toBeGreaterThan(2.5);
    expect(mid('celebrate').rf).toBeGreaterThan(2.5);
    expect(mid('celebrate').w).toBeCloseTo(1, 3);
    // 끝나면 원래 팔로 돌아간다
    expect(motionArms('celebrate', 1.6, false).w).toBeCloseTo(0, 6);
  });
});
