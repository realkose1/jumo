import { describe, expect, it } from 'vitest';
import { daylightLevel, solarPosition, sunDirection, twilightLevel } from './daylight';

const DEG = Math.PI / 180;
/** 한국 시각으로 그날 그 시각(분 단위)의 epoch ms */
const kst = (y: number, m: number, d: number, h: number, min = 0): number => Date.UTC(y, m - 1, d, h - 9, min);

/** 서울에서 해가 지평선(고도 -0.83도, 굴절 포함 기준)을 지나는 한국 시각(분) */
function crossing(y: number, m: number, d: number, fromH: number, toH: number): number {
  const target = -0.833 * DEG;
  let prev = solarPosition(kst(y, m, d, fromH)).elevation - target;
  for (let t = fromH * 60 + 1; t <= toH * 60; t++) {
    const cur = solarPosition(kst(y, m, d, 0, t)).elevation - target;
    if (Math.sign(cur) !== Math.sign(prev)) return t;
    prev = cur;
  }
  return NaN;
}

describe('solarPosition (서울)', () => {
  it('2026-11-01 해돋이 06:5x, 해넘이 17:3x 무렵 (천문연 06:56, 17:35)', () => {
    expect(Math.abs(crossing(2026, 11, 1, 6, 8) - (6 * 60 + 56))).toBeLessThanOrEqual(6);
    expect(Math.abs(crossing(2026, 11, 1, 16, 19) - (17 * 60 + 35))).toBeLessThanOrEqual(6);
  });

  it('하지 해돋이는 05:1x 무렵 (천문연 2026-06-21 05:11)', () => {
    expect(Math.abs(crossing(2026, 6, 21, 4, 6) - (5 * 60 + 11))).toBeLessThanOrEqual(6);
  });

  it('11월 한낮은 남쪽 하늘 35~40도, 아침 해는 동남동, 자정에는 한참 아래', () => {
    const noon = solarPosition(kst(2026, 11, 1, 12, 16));
    expect(noon.elevation / DEG).toBeGreaterThan(35);
    expect(noon.elevation / DEG).toBeLessThan(40);
    expect(Math.abs(noon.azimuth / DEG - 180)).toBeLessThan(5);
    const morning = solarPosition(kst(2026, 11, 1, 7, 0));
    expect(morning.azimuth / DEG).toBeGreaterThan(100);
    expect(morning.azimuth / DEG).toBeLessThan(120);
    expect(solarPosition(kst(2026, 11, 1, 0, 0)).elevation / DEG).toBeLessThan(-40);
  });
});

describe('sunDirection (주막은 남향)', () => {
  it('동쪽은 왼쪽(-x), 남쪽은 TV 쪽(-z), 북쪽은 뒤(+z), 서쪽은 오른쪽(+x)', () => {
    const v = sunDirection(0, 90 * DEG);
    expect([v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000)).toEqual([-1, 0, 0]);
    expect(sunDirection(0, 180 * DEG).z).toBeCloseTo(-1);
    expect(sunDirection(0, 0).z).toBeCloseTo(1);
    expect(sunDirection(0, 270 * DEG).x).toBeCloseTo(1);
    expect(sunDirection(90 * DEG, 0).y).toBeCloseTo(1);
  });
});

describe('daylightLevel, twilightLevel', () => {
  it('밤 0, 낮 1, 그 사이는 고도가 오를수록 밝아진다', () => {
    expect(daylightLevel(-20 * DEG)).toBe(0);
    expect(daylightLevel(30 * DEG)).toBe(1);
    const a = daylightLevel(-3 * DEG);
    const b = daylightLevel(0);
    const c = daylightLevel(4 * DEG);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(1);
  });

  it('노을은 해가 지평선 언저리일 때만', () => {
    expect(twilightLevel(-20 * DEG)).toBe(0);
    expect(twilightLevel(30 * DEG)).toBe(0);
    expect(twilightLevel(1 * DEG)).toBeCloseTo(1);
    expect(twilightLevel(-4 * DEG)).toBeGreaterThan(0);
    expect(twilightLevel(8 * DEG)).toBeGreaterThan(0);
  });
});
