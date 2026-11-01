// 주막의 낮과 밤: 서울 하늘에 해가 얼마나 떠 있는지로 정한다(한국 시각, 기기 시계는 ctx.clock 으로 보정).
// 주막은 남향이다 — TV 벽(-z)이 남쪽, 왼쪽 트인 쪽(-x)이 동쪽, 뒤(+z)가 북쪽. 그래서 해는 왼쪽 산 너머에서
// 떠오르고, 한낮에는 TV 위 남쪽 하늘에 있다가, 오른쪽(서쪽)으로 진다. 밤에는 지금처럼 보름달이 TV 위에 뜬다.
// 여기에는 화면 없이 시험할 수 있는 계산만 둔다. 장면에 입히는 것은 stage.ts 와 scenery.ts 다.
import * as THREE from 'three';

/** 서울 시청 언저리 */
export const SEOUL = { lat: 37.5665, lon: 126.978 } as const;

const RAD = Math.PI / 180;

/**
 * 해의 고도(지평선 위 각도)와 방위(북 0, 동 π/2, 남 π, 서 3π/2), 라디안.
 * 천문연감의 짧은 식으로 0.5도 안팎 — 하늘 색과 해 위치를 정하기에 충분하다(대기 굴절은 넣지 않는다).
 */
export function solarPosition(epochMs: number, latDeg: number = SEOUL.lat, lonDeg: number = SEOUL.lon): { elevation: number; azimuth: number } {
  const d = epochMs / 86_400_000 - 10_957.5; // J2000.0(2000-01-01 12:00 UTC)부터 지난 날
  const g = (357.529 + 0.98560028 * d) * RAD; // 평균 근점 이각
  const q = 280.459 + 0.98564736 * d; // 평균 황경(도)
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // 황경
  const eps = (23.439 - 0.00000036 * d) * RAD; // 황도 경사
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstHours = 18.697374558 + 24.06570982441908 * d;
  const hourAngle = (gmstHours * 15 + lonDeg) * RAD - ra;
  const lat = latDeg * RAD;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle));
  return { elevation, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) };
}

/** 고도·방위 → 장면 속 해 쪽 단위 벡터 (북 +z, 동 -x, 남 -z, 서 +x) */
export function sunDirection(elevation: number, azimuth: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const flat = Math.cos(elevation);
  return out.set(-Math.sin(azimuth) * flat, Math.sin(elevation), Math.cos(azimuth) * flat);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 낮의 정도 0(밤)~1(낮). 해가 지평선 6도 아래(박명이 시작될 때)에서 8도 위로 오르는 동안 밝아진다 */
export function daylightLevel(elevation: number): number {
  return smoothstep(-6 * RAD, 8 * RAD, elevation);
}

/** 해돋이·해넘이 노을의 세기 0~1. 해가 지평선 언저리(-8도~14도)에 있을 때만, 1도 언저리에서 가장 세다 */
export function twilightLevel(elevation: number): number {
  const deg = elevation / RAD;
  if (deg <= -8 || deg >= 14) return 0;
  const t = deg < 1 ? (deg + 8) / 9 : (14 - deg) / 13;
  return t * t * (3 - 2 * t);
}
