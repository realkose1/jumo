// 시험용 공간: 회색 상자로 만든 빈 방. 엔진이 제대로 도는지 보려고 만든다.
import * as THREE from 'three';
import { testRoom as shared } from '@shared/spaces/test-room';
import type { ActionDef, SceneContext, SceneHandle, SeatDef, SpaceDefinition } from '../../engine/types';

const HALF = 6; // 방 한 변의 절반 (12m x 12m)
const WALL_HEIGHT = 3;
const WALL_THICKNESS = 0.3;

// 자리 id는 shared/spaces/test-room.ts가 원본이고, 여기에는 3D 배치만 둔다.
// 의자 6개: 앞쪽(+z)을 보는 두 줄과, 왼쪽 벽 쪽에서 방 안쪽(+x)을 보는 하나
const SEAT_LAYOUT: Record<string, Omit<SeatDef, 'id'>> = {
  a1: { x: -2.5, z: -1.2, facing: 0 },
  a2: { x: 0, z: -1.2, facing: 0 },
  a3: { x: 2.5, z: -1.2, facing: 0 },
  b1: { x: -1.25, z: -4, facing: 0 },
  b2: { x: 1.25, z: -4, facing: 0 },
  c1: { x: -4.6, z: 2, facing: Math.PI / 2 },
};

const seats: SeatDef[] = shared.seatIds.map((id) => {
  const layout = SEAT_LAYOUT[id];
  if (!layout) throw new Error(`test-room: 자리 ${id}의 3D 배치가 없어요`);
  return { id, ...layout };
});

// 동작 id와 인사 여부는 shared가 원본이고, 여기에는 이름표와 몸짓만 둔다.
const ACTION_VISUALS: Record<string, Omit<ActionDef, 'id'>> = {
  'hop-small': { label: { ko: '살짝 뛰기' }, motion: 'hop' },
  'hop-twice': { label: { ko: '콩콩 뛰기' }, motion: 'hop-double' },
  'hop-greet': { label: { ko: '폴짝 인사' }, notice: { ko: '폴짝 인사했어요' }, motion: 'hop-spin' },
};

function buildActions(): SpaceDefinition['actions'] {
  const list = shared.actions.map((a): ActionDef => {
    const visual = ACTION_VISUALS[a.id];
    if (!visual) throw new Error(`test-room: 동작 ${a.id}의 이름표와 몸짓이 없어요`);
    return { id: a.id, ...visual };
  });
  if (list.length !== 3) throw new Error('test-room: 동작은 정확히 세 개여야 해요');
  return list as SpaceDefinition['actions'];
}

async function loadScene(ctx: SceneContext): Promise<SceneHandle> {
  const { scene } = ctx;
  const owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  const added: THREE.Object3D[] = [];
  const add = <T extends THREE.Object3D>(obj: T): T => {
    scene.add(obj);
    added.push(obj);
    return obj;
  };

  // 같은 재질은 하나를 나눠 쓴다
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x6f6f75 });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x909096 });
  owned.push(floorMat, wallMat);

  const floorGeo = new THREE.BoxGeometry(HALF * 2, 0.2, HALF * 2).translate(0, -0.1, 0);
  const floor = add(new THREE.Mesh(floorGeo, floorMat));
  floor.receiveShadow = true;
  owned.push(floorGeo);

  // 벽 세 면 (뒤, 왼쪽, 오른쪽). 앞(+z)은 카메라가 들어오도록 비워 둔다
  const backGeo = new THREE.BoxGeometry(HALF * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS);
  const sideGeo = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, HALF * 2);
  owned.push(backGeo, sideGeo);
  const back = add(new THREE.Mesh(backGeo, wallMat));
  back.position.set(0, WALL_HEIGHT / 2, -HALF - WALL_THICKNESS / 2);
  const left = add(new THREE.Mesh(sideGeo, wallMat));
  left.position.set(-HALF - WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0);
  const right = add(new THREE.Mesh(sideGeo, wallMat));
  right.position.set(HALF + WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0);
  for (const wall of [back, left, right]) {
    wall.castShadow = true;
    wall.receiveShadow = true;
  }

  // 은은한 조명: 하늘빛 반구광 + 따뜻한 방향광(그림자)
  add(new THREE.HemisphereLight(0xdfe6ff, 0x55505a, 1.1));
  const sun = add(new THREE.DirectionalLight(0xffe9cf, 1.6));
  sun.position.set(-4, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
  sun.shadow.camera.left = -HALF - 1;
  sun.shadow.camera.right = HALF + 1;
  sun.shadow.camera.top = HALF + 1;
  sun.shadow.camera.bottom = -HALF - 1;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;

  ctx.reportProgress(0.6);

  return {
    spawn: { x: 0, z: 4, yaw: Math.PI }, // 방 안쪽(-z)을 보고 선다
    bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF },
    dispose() {
      for (const obj of added) scene.remove(obj);
      sun.shadow.map?.dispose();
      for (const o of owned) o.dispose();
    },
  };
}

const space: SpaceDefinition = {
  id: shared.id,
  title: { ko: '시험용 방', en: 'Test Room' },
  capacityPerRoom: shared.capacityPerRoom,
  initialRoomCount: shared.initialRoomCount,
  nameWords: shared.nameWords,
  avatarOutfit: 'plain',
  seats,
  actions: buildActions(),
  greetingActionId: shared.greetingActionId,
  sound: { music: {}, ambient: {}, shared: {}, effects: {} },
  schedule: [],
  personalCounters: [{ id: 'visits', label: { ko: '다녀간 날' }, unit: { ko: '일' } }],
  loadingToy: { id: 'bubbles', label: { ko: '방울 톡톡' } },
  loadScene,
};

export default space;
