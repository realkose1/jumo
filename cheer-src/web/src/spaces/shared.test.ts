// 서버(shared/spaces)와 화면(src/spaces)이 같은 id를 쓰는지 확인한다.
// 어긋나면 서버가 'bad-request'로 버려서, 앉기나 동작이 말없이 안 되는 문제가 생긴다.
import { describe, expect, it } from 'vitest';
import { getSharedSpace } from '@shared/spaces';
import { SPACE_LABELS, listSharedSpaceIds, listSpaceIds, loadSpace } from './index';

describe('화면의 공간과 shared/spaces', () => {
  it('화면에 있는 공간은 모두 shared에도 있다', () => {
    for (const id of listSpaceIds()) expect(getSharedSpace(id), id).toBeDefined();
  });

  it('공간 이름표는 shared의 공간과 같은 목록이다', () => {
    expect(Object.keys(SPACE_LABELS).sort()).toEqual(listSharedSpaceIds().sort());
  });

  for (const id of listSpaceIds()) {
    describe(id, () => {
      it('정원, 방 개수, 이름 단어가 같다', async () => {
        const space = (await loadSpace(id))!;
        const shared = getSharedSpace(id)!;
        expect(space.id).toBe(shared.id);
        expect(space.capacityPerRoom).toBe(shared.capacityPerRoom);
        expect(space.initialRoomCount).toBe(shared.initialRoomCount);
        expect(space.nameWords.ko).toEqual(shared.nameWords.ko);
        expect(space.nameWords.en).toEqual(shared.nameWords.en);
      });

      it('자리 id가 서버의 자리 id와 같다 (겹침 없이)', async () => {
        const space = (await loadSpace(id))!;
        const shared = getSharedSpace(id)!;
        const ids = space.seats.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual([...shared.seatIds].sort());
      });

      it('동작의 변형 개수가 서버와 같고, 화면의 다시 하기 간격이 서버보다 조금 길다', async () => {
        const space = (await loadSpace(id))!;
        const shared = getSharedSpace(id)!;
        shared.actions.forEach((sa, i) => {
          const a = space.actions[i]!;
          expect(a.variants, `${sa.id} variants`).toBe(sa.variants);
          if (sa.cooldownMs !== undefined) {
            // 서버가 먼저 거절하지 않도록 화면이 같거나 조금 더 길게(최대 1.5초)
            expect(a.cooldownMs ?? 0).toBeGreaterThanOrEqual(sa.cooldownMs);
            expect((a.cooldownMs ?? 0) - sa.cooldownMs).toBeLessThanOrEqual(1500);
          }
        });
      });

      it('동작 id와 순서, 인사 동작이 서버와 같다', async () => {
        const space = (await loadSpace(id))!;
        const shared = getSharedSpace(id)!;
        expect(space.actions.map((a) => a.id)).toEqual(shared.actions.map((a) => a.id));
        expect(space.greetingActionId).toBe(shared.greetingActionId);
        const greeting = shared.actions.find((a) => a.greeting);
        expect(greeting?.id).toBe(space.greetingActionId);
      });
    });
  }
});
