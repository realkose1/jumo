// 응원 주막: 밤의 한옥 주막에서 큰 TV로 우리 선수들의 경기를 같이 보며 응원하는 공간.
// 모두가 이 공간 하나에 들어오고, 방이 차면 서버가 다음 방으로 나눈다(정원 24).
// 정원, 이름 단어, 자리 id, 동작 id는 shared/spaces/jumak.ts가 원본이고, 여기에는 3D 배치와 이름표, 몸짓, 색만 둔다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jumak as shared } from '@shared/spaces/jumak';
import { registerOutfit } from '../../engine/avatar';
import type { ActionDef, SpaceDefinition } from '../../engine/types';
import { ACTION_EMOJI, ACTION_PICTURE, buildSeats } from './layout';
import { createJumakScene } from './stage';

// 옷: 흰 한복에 붉은 옷고름. 머리는 사람 번호로 네 가지 차림 중 하나다(누구 화면에서나 같다).
//   0 갓 + 콧수염 + 턱수염   1 상투 + 콧수염 + 턱수염   2 갓 + 콧수염   3 상투 + 콧수염
// 모두 망건(검은 머리띠)과 검은 머리를 하고, 갓에는 붉은 갓끈 구슬이 늘어진다.
// 머리 기준 좌표: 머리 중심이 원점, 반지름 0.27, 앞이 +z (눈은 y 0.035, z 0.248)
const HAIR = 0x221d1a;
const GAT = 0x1a1716;
const CHEER_RED = 0xc8321f;
const GAT_LOOKS = [0, 2];
const SANGTU_LOOKS = [1, 3];
const GOATEE_LOOKS = [0, 1];

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // 소품은 정점 색 없이 한 색으로 그리니 위치, 법선만 남겨 합친다
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    return n;
  });
  const merged = mergeGeometries(clean, false);
  if (!merged) throw new Error('jumak outfit merge failed');
  for (const g of clean) g.dispose();
  return merged;
}

const seg = (d: { headWidthSegments: number }, min: number): number => Math.max(min, d.headWidthSegments);

registerOutfit({
  id: 'jumak',
  bodyColor: 0xeee7d6,
  skinColor: 0xf6d7b8,
  looks: 4,
  accessories: [
    {
      // 머리카락(정수리를 덮는 반구) + 망건
      key: 'hair',
      attach: 'head',
      create: (d) =>
        mergeParts([
          new THREE.SphereGeometry(0.277, seg(d, 12), Math.max(5, d.headHeightSegments), 0, Math.PI * 2, 0, 1.12),
          new THREE.TorusGeometry(0.244, 0.024, Math.max(4, Math.round(d.eyeSegments / 2)), seg(d, 10))
            .rotateX(Math.PI / 2)
            .translate(0, 0.118, 0),
        ]),
      color: HAIR,
      position: [0, 0, 0],
    },
    {
      // 갓: 넓은 챙과 원통 모자
      key: 'gat',
      tall: true,
      attach: 'head',
      looks: GAT_LOOKS,
      create: (d) =>
        mergeParts([
          new THREE.CylinderGeometry(0.38, 0.38, 0.014, seg(d, 14)).translate(0, 0.205, 0),
          new THREE.CylinderGeometry(0.15, 0.19, 0.17, seg(d, 12)).translate(0, 0.205 + 0.085, 0),
        ]),
      color: GAT,
      position: [0, 0, 0],
      rotation: [-0.08, 0, 0],
    },
    {
      // 갓끈: 챙 양옆에서 턱 옆으로 늘어진 붉은 구슬 줄
      key: 'gatkkeun',
      tall: true,
      attach: 'head',
      looks: GAT_LOOKS,
      create: (d) => {
        const beads: THREE.BufferGeometry[] = [];
        const ws = Math.max(5, Math.round(d.eyeSegments * 0.8));
        for (const side of [-1, 1]) {
          for (let i = 0; i < 7; i++) {
            const y = 0.18 - i * 0.05;
            const x = side * (0.275 + i * 0.004);
            beads.push(new THREE.SphereGeometry(0.019, ws, Math.max(3, ws - 2)).translate(x, y, 0.07 + i * 0.012));
          }
        }
        return mergeParts(beads);
      },
      color: CHEER_RED,
      position: [0, 0, 0],
    },
    {
      // 상투: 정수리에 틀어 올린 머리와 가로지른 동곳
      key: 'sangtu',
      tall: true,
      attach: 'head',
      looks: SANGTU_LOOKS,
      create: (d) =>
        mergeParts([
          new THREE.SphereGeometry(0.075, seg(d, 10), Math.max(5, d.headHeightSegments)).scale(1, 1.25, 1).translate(0, 0.31, -0.02),
          new THREE.CylinderGeometry(0.05, 0.075, 0.06, seg(d, 8)).translate(0, 0.26, -0.02),
          new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6).rotateZ(Math.PI / 2).translate(0, 0.32, -0.02),
        ]),
      color: HAIR,
      position: [0, 0, 0],
    },
    {
      // 콧수염: 양옆으로 처진 두 가닥
      key: 'mustache',
      attach: 'head',
      create: (d) => {
        const ws = Math.max(6, d.eyeSegments);
        return mergeParts(
          [-1, 1].map((side) =>
            new THREE.SphereGeometry(1, ws, Math.max(4, ws - 2))
              .scale(0.058, 0.016, 0.022)
              .rotateZ(side * -0.38)
              .translate(side * 0.05, -0.05, 0.262),
          ),
        );
      },
      color: HAIR,
      position: [0, 0, 0],
    },
    {
      // 턱수염: 턱 아래로 뾰족하게
      key: 'goatee',
      attach: 'head',
      looks: GOATEE_LOOKS,
      create: (d) => new THREE.ConeGeometry(0.05, 0.15, Math.max(6, d.eyeSegments)).rotateX(Math.PI - 0.45).translate(0, -0.2, 0.2),
      color: HAIR,
      position: [0, 0, 0],
    },
    {
      // 옷고름: 가슴 앞 붉은 매듭과 늘어진 두 가닥
      key: 'goreum',
      attach: 'body',
      create: () =>
        mergeParts([
          new THREE.BoxGeometry(0.055, 0.035, 0.03).translate(0.05, 0.41, 0.2),
          new THREE.BoxGeometry(0.026, 0.15, 0.012).rotateZ(0.12).translate(0.04, 0.32, 0.207),
          new THREE.BoxGeometry(0.026, 0.12, 0.012).rotateZ(-0.22).translate(0.075, 0.335, 0.204),
        ]),
      color: CHEER_RED,
      position: [0, 0, 0],
    },
  ],
});

// 동작 id와 인사 여부는 shared가 원본이다. 이름표, 몸짓, 그림만 여기에 둔다.
const ACTION_VISUALS: Record<string, Omit<ActionDef, 'id'>> = {
  clap: { label: { ko: '박수' }, motion: 'clap', icon: ACTION_EMOJI.clap },
  toast: { label: { ko: '건배' }, notice: { ko: '건배했어요' }, motion: 'toast', icon: ACTION_PICTURE.toast },
  // 주문: "주모! 여기 국밥 한 그릇 주쇼!" 하고 외치는 몸짓(뒤로 젖히며 늘어난다)을 쓴다. 메뉴는 누를 때마다 정해져 방 모두가 같은 것을 본다
  order: { label: { ko: '주문' }, motion: 'roar', icon: ACTION_EMOJI.order, variants: 8, cooldownMs: 5000 },
};

function buildActions(): SpaceDefinition['actions'] {
  const list = shared.actions.map((a): ActionDef => {
    const visual = ACTION_VISUALS[a.id];
    if (!visual) throw new Error(`jumak: 동작 ${a.id}의 이름표와 몸짓이 없어요`);
    return { id: a.id, ...visual };
  });
  if (list.length !== 3) throw new Error('jumak: 동작은 정확히 세 개여야 해요');
  return list as SpaceDefinition['actions'];
}

const space: SpaceDefinition = {
  id: shared.id,
  // 간판 이름은 경기 피드의 선수에 따라 "이강인 응원 주막"처럼 바뀐다(cheer/roomName.ts). 이건 로딩 때 쓰는 기본 이름
  title: { ko: '응원 주막' },
  capacityPerRoom: shared.capacityPerRoom,
  initialRoomCount: shared.initialRoomCount,
  nameWords: shared.nameWords,
  avatarOutfit: 'jumak',
  seats: buildSeats(),
  actions: buildActions(),
  greetingActionId: shared.greetingActionId,
  // 소리는 모두 WebAudio로 직접 만든다. 효과음과 공동 소리는 켜 두고, 환경음은 낮게 깔린다.
  sound: {
    ambient: { synth: true, defaultOn: true, defaultVolume: 0.4 },
    shared: { synth: true, defaultOn: true, defaultVolume: 0.8 },
    effects: { synth: true, defaultOn: true, defaultVolume: 0.8 },
  },
  schedule: [],
  personalCounters: [],
  loadingToy: { id: 'bubbles', label: { ko: '초롱 톡톡' } },
  // 주모 앱의 어두운 면과 노란 강조색
  theme: {
    accent: '#f5c400',
    accentInk: '#1a1400',
    surface: 'rgba(22, 22, 25, 0.88)',
    surfaceSolid: 'rgba(22, 22, 25, 0.97)',
    surfaceStrong: 'rgba(29, 29, 32, 0.97)',
    ink: '#ffffff',
    inkSoft: '#b9bac4',
    line: 'rgba(255, 255, 255, 0.14)',
    radius: '18px',
    blur: '14px',
    card: 'rgba(255, 255, 255, 0.07)',
    cardHover: 'rgba(255, 255, 255, 0.13)',
    scrim: 'rgba(0, 0, 0, 0.6)',
    loadingBg: 'rgba(11, 11, 13, 0.94)',
    shadow: '0 8px 28px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4)',
  },
  loadScene: async (ctx) => createJumakScene(ctx),
};

export default space;
