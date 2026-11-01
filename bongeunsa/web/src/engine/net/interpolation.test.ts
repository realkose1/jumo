import { describe, expect, it } from 'vitest';
import { PeerTrack, TELEPORT_DISTANCE } from './interpolation';

describe('PeerTrack', () => {
  it('두 점 사이를 이어서 그린다', () => {
    const track = new PeerTrack();
    track.push(0, 0, 0, 1000);
    track.push(1, 2, 0, 1100);
    expect(track.at(1050)).toEqual({ x: 0.5, z: 1, r: 0 });
  });

  it('마지막 위치를 지나면 거기에 머문다 (멋대로 더 가지 않는다)', () => {
    const track = new PeerTrack();
    track.push(0, 0, 0, 1000);
    track.push(1, 0, 0, 1100);
    expect(track.at(5000)).toEqual({ x: 1, z: 0, r: 0 });
  });

  it('첫 위치보다 이른 시점은 첫 위치', () => {
    const track = new PeerTrack();
    track.push(3, 4, 0, 1000);
    expect(track.at(0)).toEqual({ x: 3, z: 4, r: 0 });
  });

  it('모은 게 없으면 null', () => {
    expect(new PeerTrack().at(1)).toBeNull();
  });

  it('방향은 가까운 쪽으로 돈다 (π 근처를 넘어갈 때 한 바퀴 돌지 않는다)', () => {
    const track = new PeerTrack();
    track.push(0, 0, Math.PI - 0.1, 0);
    track.push(0, 0, -Math.PI + 0.1, 100);
    const mid = track.at(50)!;
    expect(Math.abs(Math.cos(mid.r) + 1)).toBeLessThan(0.01); // 거의 ±π
  });

  it('멀리 떨어진 두 점은 이어 그리지 않고 건너뛴다', () => {
    const track = new PeerTrack();
    track.push(0, 0, 0, 1000);
    track.push(TELEPORT_DISTANCE + 1, 0, 0, 1100);
    expect(track.at(1050)).toEqual({ x: 0, z: 0, r: 0 });
    expect(track.at(1100)).toEqual({ x: TELEPORT_DISTANCE + 1, z: 0, r: 0 });
  });

  it('reset하면 새 위치에서 다시 시작한다', () => {
    const track = new PeerTrack();
    track.push(0, 0, 0, 1000);
    track.push(1, 0, 0, 1100);
    track.reset(5, 5, 1, 1200);
    expect(track.size).toBe(1);
    expect(track.at(1150)).toEqual({ x: 5, z: 5, r: 1 });
  });

  it('같은 시각에 두 번 와도 시간이 거꾸로 가지 않는다', () => {
    const track = new PeerTrack();
    track.push(0, 0, 0, 1000);
    track.push(1, 0, 0, 1000);
    const a = track.at(1000)!;
    expect(Number.isFinite(a.x)).toBe(true);
  });

  it('오래된 위치는 버린다', () => {
    const track = new PeerTrack(3);
    for (let i = 0; i < 10; i++) track.push(i, 0, 0, i * 100);
    expect(track.size).toBe(3);
  });
});
