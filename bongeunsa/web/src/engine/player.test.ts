import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Avatar, disposeAvatarResources } from './avatar';
import { Player } from './player';
import { LocalSeatArbiter, SeatManager, type SeatArbiter } from './seats';
import type { SeatDef } from './types';

afterAll(() => disposeAvatarResources());

const seat: SeatDef = { id: 's1', x: 0, z: -2, facing: 0 };
const NO_KEYS = { x: 0, y: 0 };

function setup(arbiter: SeatArbiter = new LocalSeatArbiter(), seats: SeatDef[] = [seat]) {
  const scene = new THREE.Scene();
  const manager = new SeatManager(scene, seats);
  const changes: Array<string | null> = [];
  const denied: string[] = [];
  const reasons: string[] = [];
  const player = new Player(new Avatar({ detail: 'peer' }), manager, arbiter, scene, {
    onSeatChange: (id) => changes.push(id),
    onSeatDenied: (id, reason) => {
      denied.push(id);
      reasons.push(reason);
    },
  });
  player.setWalkArea({ minX: -6, maxX: 6, minZ: -6, maxZ: 6 });
  player.teleport(0, 4, Math.PI);
  /** 프레임을 seconds만큼 돌린다. Promise가 풀릴 틈도 준다 */
  const run = async (seconds: number, input = NO_KEYS, cameraYaw = 0) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      player.update(1 / 60, input, cameraYaw);
      await Promise.resolve();
    }
  };
  return { player, manager, scene, changes, denied, reasons, run };
}

describe('Player', () => {
  it('바닥을 누르면 그곳까지 걸어가 멈춘다', async () => {
    const { player, run } = setup();
    player.walkTo(2, 1);
    await run(3);
    expect(player.position.x).toBeCloseTo(2, 1);
    expect(player.position.z).toBeCloseTo(1, 1);
  });

  it('방 밖을 누르면 벽 안쪽까지만 간다', async () => {
    const { player, run } = setup();
    player.walkTo(100, 100);
    await run(6);
    expect(player.position.x).toBeLessThanOrEqual(6);
    expect(player.position.z).toBeLessThanOrEqual(6);
    expect(player.position.x).toBeGreaterThan(5);
  });

  it('방향키는 카메라가 보는 쪽이 앞이다', async () => {
    const { player, run } = setup();
    // 카메라 yaw 0이면 카메라는 +z에서 -z를 본다: 앞(y=+1)은 -z
    await run(0.5, { x: 0, y: 1 }, 0);
    expect(player.position.z).toBeLessThan(4 - 1);
    expect(Math.abs(player.position.x)).toBeLessThan(0.01);
    // 오른쪽(x=+1)은 +x
    const before = player.position.x;
    await run(0.5, { x: 1, y: 0 }, 0);
    expect(player.position.x).toBeGreaterThan(before + 1);
  });

  it('이동 벡터의 길이가 곧 빠르기다 (화면 조이스틱: 절반만 끌면 절반 속도)', async () => {
    const full = setup();
    await full.run(0.5, { x: 0, y: 1 }, 0);
    const half = setup();
    await half.run(0.5, { x: 0, y: 0.5 }, 0);
    const fullDist = 4 - full.player.position.z;
    const halfDist = 4 - half.player.position.z;
    expect(fullDist).toBeGreaterThan(1);
    expect(halfDist / fullDist).toBeCloseTo(0.5, 2);
    // 카메라를 돌려도 길이는 그대로다 (카메라 기준 방향만 바뀐다)
    const turned = setup();
    await turned.run(0.5, { x: 0, y: 0.5 }, Math.PI / 3);
    expect(Math.hypot(turned.player.position.x, 4 - turned.player.position.z)).toBeCloseTo(halfDist, 2);
  });

  it('자리를 누르면 걸어가서 앉고, 이동하면 일어난다', async () => {
    const { player, run, changes } = setup();
    player.sitAt(seat);
    await run(4);
    expect(player.seatId).toBe('s1');
    expect(player.position.x).toBeCloseTo(0, 2);
    expect(player.position.z).toBeCloseTo(-2, 2);
    expect(player.avatar.isSeated()).toBe(true);
    expect(changes).toEqual(['s1']);

    await run(0.3, { x: 0, y: -1 }); // 뒤로 걷기 = 일어나기
    expect(player.seatId).toBeNull();
    expect(player.avatar.isSeated()).toBe(false);
    expect(changes).toEqual(['s1', null]);
  });

  it('앉아 있다가 바닥을 누르면 일어나서 걸어간다', async () => {
    const { player, run, changes } = setup();
    player.sitAt(seat);
    await run(4);
    player.walkTo(3, 3);
    await run(5);
    expect(changes).toEqual(['s1', null]);
    expect(player.position.x).toBeCloseTo(3, 1);
  });

  it('다른 사람이 앉은 자리는 앉지 못한다', async () => {
    const arbiter = new LocalSeatArbiter();
    arbiter.setOthersOccupied(['s1']);
    const { player, run, denied, changes } = setup(arbiter);
    player.sitAt(seat);
    await run(1);
    expect(denied).toEqual(['s1']);
    expect(changes).toEqual([]);
    expect(player.position.z).toBe(4); // 움직이지도 않는다
  });

  it('도착해서 물어보는 사이에 남이 앉았으면 앉지 못한다 (서버 판정 모양)', async () => {
    const arbiter: SeatArbiter = {
      requestSit: async () => false,
      release: () => undefined,
      isOccupiedByOther: () => false,
    };
    const { player, run, denied } = setup(arbiter);
    player.sitAt(seat);
    await run(4);
    expect(denied).toEqual(['s1']);
    expect(player.seatId).toBeNull();
  });

  it('답을 기다리는 사이 다른 데로 가면 받은 자리를 돌려준다', async () => {
    let resolve!: (ok: boolean) => void;
    const released: string[] = [];
    const arbiter: SeatArbiter = {
      requestSit: () => new Promise<boolean>((r) => (resolve = r)),
      release: (id) => void released.push(id),
      isOccupiedByOther: () => false,
    };
    const { player, run, changes } = setup(arbiter);
    player.sitAt(seat);
    await run(3); // 도착해서 응답 대기 중
    player.walkTo(3, 3);
    resolve(true);
    await run(0.1);
    expect(released).toEqual(['s1']);
    expect(changes).toEqual([]);
    expect(player.seatId).toBeNull();
  });

  it('못 앉은 이유를 알린다: 눌렀을 때 이미 앉아 있으면 occupied, 서버가 거절하면 arbiter가 알려준 이유', async () => {
    const mine = new LocalSeatArbiter();
    mine.setOthersOccupied(['s1']);
    const a = setup(mine);
    a.player.sitAt(seat);
    expect(a.reasons).toEqual(['occupied']);

    const arbiter: SeatArbiter = {
      requestSit: async () => false,
      release: () => undefined,
      isOccupiedByOther: () => false,
      denialReason: () => 'failed',
    };
    const b = setup(arbiter);
    b.player.sitAt(seat);
    await b.run(4);
    expect(b.reasons).toEqual(['failed']);
  });

  it('걸어가는 사이 그 자리에 남이 앉으면 걸음을 멈춘다', async () => {
    const { player, run, reasons } = setup();
    player.sitAt(seat);
    await run(0.5); // 아직 가는 중
    const z = player.position.z;
    expect(z).toBeLessThan(4);
    player.abortSeatIntent('s1');
    await run(2);
    expect(player.position.z).toBeCloseTo(z, 1); // 더 가지 않는다
    expect(player.seatId).toBeNull();
    expect(reasons).toEqual(['taken']);
  });

  it('다른 자리로 가던 중이면 abortSeatIntent는 아무 일도 하지 않는다', async () => {
    const { player, run, reasons } = setup();
    player.sitAt(seat);
    await run(0.3);
    player.abortSeatIntent('다른자리');
    await run(4);
    expect(player.seatId).toBe('s1');
    expect(reasons).toEqual([]);
  });

  it('상자에는 들어가지 못한다', async () => {
    const { player, run } = setup();
    player.setWalkArea({ minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, [{ minX: -1, maxX: 1, minZ: 0, maxZ: 2 }]);
    player.walkTo(0, 1); // 상자 한가운데
    await run(4);
    const { x, z } = player.position;
    const inside = x > -1 && x < 1 && z > 0 && z < 2;
    expect(inside).toBe(false);
  });
});

describe('SeatManager', () => {
  it('의자는 그리기 호출 1번(인스턴스)', () => {
    const { scene } = setup(undefined, [seat, { id: 's2', x: 2, z: -2, facing: 0 }, { id: 's3', x: -2, z: -2, facing: 0 }]);
    const instanced = scene.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh);
    expect(instanced).toHaveLength(1);
    expect((instanced[0] as THREE.InstancedMesh).count).toBe(3);
  });

  it('누른 방향이 자리 근처를 지나면 그 자리를 고른다', () => {
    const { manager } = setup();
    const ray = new THREE.Ray(new THREE.Vector3(0, 3, 3), new THREE.Vector3(0, -2.4, -5).normalize());
    expect(manager.pick(ray)?.id).toBe('s1');
    const away = new THREE.Ray(new THREE.Vector3(4, 3, 3), new THREE.Vector3(0, -2.4, -5).normalize());
    expect(manager.pick(away)).toBeNull();
  });

  it('걸어가 멈출 자리는 바라보는 쪽 앞', () => {
    const { manager } = setup();
    const a = manager.approachPoint(seat);
    expect(a.x).toBeCloseTo(0);
    expect(a.z).toBeCloseTo(-2 + 0.75);
  });
});
