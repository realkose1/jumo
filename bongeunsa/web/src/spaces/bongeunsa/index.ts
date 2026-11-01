// 봉은사: 서울 강남 빌딩 숲 한가운데의 천년 고찰을 함께 거니는 공간.
// 진여문으로 들어와 법왕루 아래를 지나 연등이 걸린 앞마당, 삼층석탑, 대웅전에 이른다. 서쪽에는 미륵대불, 동쪽에는 범종각.
// 하늘은 서울의 실제 낮과 밤을 따르고, 정시마다 범종이 울린다. 동작은 합장(인사), 목탁, 연등 띄우기.
// 정원, 이름 단어, 자리 id, 동작 id는 shared/spaces/bongeunsa.ts가 원본이고, 여기에는 3D 배치와 이름표, 몸짓, 색만 둔다.
import * as THREE from 'three';
import { bongeunsa as shared } from '@shared/spaces/bongeunsa';
import { registerOutfit } from '../../engine/avatar';
import type { ActionDef, SpaceDefinition } from '../../engine/types';
import { buildSeats } from './layout';
import { BONGEUNSA_OUTFIT } from './outfit';
import { createBongeunsaScene, type BongeunsaStage } from './scene';

registerOutfit(BONGEUNSA_OUTFIT);

const svg = (body: string): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`)}`;

/** 목탁: 둥근 나무 몸통과 가로로 난 입, 손잡이 */
const MOKTAK_ICON = svg(
  '<path d="M36 13 q6 -4 8 -1" stroke="#7a4f2c" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="22" cy="27" rx="17" ry="14" fill="#c98a4b"/>' +
    '<ellipse cx="18" cy="22" rx="8" ry="4" fill="#e3b07a" opacity="0.7"/>' +
    '<path d="M8 30 q14 6 28 0" stroke="#5e3b1f" stroke-width="3" fill="none" stroke-linecap="round"/>',
);
/** 연등: 분홍 연꽃잎 등과 아래 술 */
const LANTERN_ICON = svg(
  '<line x1="24" y1="3" x2="24" y2="10" stroke="#6b5444" stroke-width="2"/>' +
    '<ellipse cx="24" cy="24" rx="15" ry="13" fill="#f06a8a"/>' +
    '<path d="M24 11 q-6 13 0 26 M24 11 q6 13 0 26 M12 18 q12 8 24 0 M11 28 q13 7 26 0" stroke="#fbd0db" stroke-width="2" fill="none"/>' +
    '<rect x="21" y="37" width="6" height="8" rx="2" fill="#f7c531"/>',
);

// 동작 id와 인사 여부는 shared가 원본이다. 이름표, 몸짓, 그림만 여기에 둔다.
const ACTION_VISUALS: Record<string, Omit<ActionDef, 'id'>> = {
  hapjang: { label: { ko: '합장' }, notice: { ko: '합장하며 인사했어요' }, motion: 'bow', icon: '🙏' },
  moktak: { label: { ko: '목탁' }, motion: 'tap', icon: MOKTAK_ICON },
  // 연등: 누를 때마다 색(v)이 정해져 방 모두가 같은 색 등이 하늘로 오르는 것을 본다
  lantern: { label: { ko: '연등' }, motion: 'offer', icon: LANTERN_ICON, variants: 6, cooldownMs: 4500 },
};

function buildActions(): SpaceDefinition['actions'] {
  const list = shared.actions.map((a): ActionDef => {
    const visual = ACTION_VISUALS[a.id];
    if (!visual) throw new Error(`bongeunsa: 동작 ${a.id}의 이름표와 몸짓이 없어요`);
    return { id: a.id, ...visual };
  });
  if (list.length !== 3) throw new Error('bongeunsa: 동작은 정확히 세 개여야 해요');
  return list as SpaceDefinition['actions'];
}

const space: SpaceDefinition = {
  id: shared.id,
  title: { ko: '봉은사', en: 'Bongeunsa Temple' },
  capacityPerRoom: shared.capacityPerRoom,
  initialRoomCount: shared.initialRoomCount,
  nameWords: shared.nameWords,
  avatarOutfit: BONGEUNSA_OUTFIT.id,
  seats: buildSeats(),
  actions: buildActions(),
  greetingActionId: shared.greetingActionId,
  // 소리는 모두 WebAudio로 만든다. 환경음(솔바람, 풍경, 산새)과 범종, 효과음은 켜 두고 음악은 낮게 깐다
  sound: {
    music: { synth: true, defaultOn: true, defaultVolume: 0.3 },
    ambient: { synth: true, defaultOn: true, defaultVolume: 0.55 },
    shared: { synth: true, defaultOn: true, defaultVolume: 0.85 },
    effects: { synth: true, defaultOn: true, defaultVolume: 0.8 },
  },
  schedule: [
    { id: 'bell-hourly', trigger: { type: 'minute-of-hour', minute: 0 }, label: { ko: '정시 범종' } },
    { id: 'bell-dawn', trigger: { type: 'time-of-day', hour: 4, minute: 0 }, label: { ko: '새벽 예불 범종' } },
    { id: 'bell-evening', trigger: { type: 'time-of-day', hour: 18, minute: 0 }, label: { ko: '저녁 예불 범종' } },
  ],
  personalCounters: [],
  loadingToy: { id: 'bubbles', label: { ko: '연등 톡톡' } },
  // 한지 같은 크림색 면에 단청의 붉은 주칠을 강조색으로
  theme: {
    accent: '#a83a26',
    accentInk: '#ffffff',
    surface: 'rgba(250, 245, 234, 0.86)',
    surfaceSolid: 'rgba(250, 245, 234, 0.97)',
    surfaceStrong: 'rgba(252, 248, 240, 0.98)',
    ink: '#2b2520',
    inkSoft: '#6b6157',
    line: 'rgba(60, 45, 30, 0.14)',
    radius: '16px',
    blur: '12px',
    loadingBg: 'rgba(247, 241, 228, 0.96)',
  },
  loadScene: async (ctx) => createBongeunsaScene(ctx),
  attach({ engine }) {
    const at = new THREE.Vector3();
    const stage = (): BongeunsaStage | null => engine.getSceneApi<BongeunsaStage>();
    const offs = [
      engine.on('action', (e) => {
        const s = stage();
        if (s && engine.getHeadAnchor('self', at)) s.actionEffect(e.actionId, at, e.variant, 'self');
      }),
      engine.on('peer-act', (p) => {
        const s = stage();
        if (s && engine.getHeadAnchor(p.id, at)) s.actionEffect(p.act, at, p.v, 'peer');
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  },
};

export default space;
