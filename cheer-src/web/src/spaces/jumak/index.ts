// 응원 주막: 밤의 한옥 주막에서 큰 TV로 우리 선수들의 경기를 같이 보며 응원하는 공간.
// 모두가 이 공간 하나에 들어오고, 방이 차면 서버가 다음 방으로 나눈다(정원 24).
// 정원, 이름 단어, 자리 id, 동작 id는 shared/spaces/jumak.ts가 원본이고, 여기에는 3D 배치와 이름표, 몸짓, 색만 둔다.
import { jumak as shared } from '@shared/spaces/jumak';
import { registerOutfit } from '../../engine/avatar';
import type { ActionDef, SpaceDefinition } from '../../engine/types';
import { ACTION_EMOJI, ACTION_PICTURE, buildSeats } from './layout';
import { JUMAK_OUTFIT } from './outfit';
import { createJumakScene } from './stage';

// 옷: 흰 저고리에 쪽빛 깃과 붉은 옷고름, 바지와 대님. 갓 쓴 선비는 도포와 세조대, 상투 튼 장정은 조끼 (outfit.ts)
registerOutfit(JUMAK_OUTFIT);

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
  title: { ko: '해외 축구 응원 주막' },
  capacityPerRoom: shared.capacityPerRoom,
  initialRoomCount: shared.initialRoomCount,
  nameWords: shared.nameWords,
  avatarOutfit: 'jumak',
  seats: buildSeats(),
  actions: buildActions(),
  greetingActionId: shared.greetingActionId,
  // 소리는 모두 WebAudio로 직접 만든다. 효과음과 공동 소리는 켜 두고, 배경 음악과 환경음(부엌 소리)은 낮게 깔린다.
  // 음악과 부엌 소리는 한 층에 섞여 있다가 따로 켜고 끌 수 있게 나뉘었다(같은 크기라 둘을 합친 소리는 전과 같다)
  sound: {
    music: { synth: true, defaultOn: true, defaultVolume: 0.4 },
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
