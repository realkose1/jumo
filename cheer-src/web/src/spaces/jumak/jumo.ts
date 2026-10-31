// 주모(주막 주인) NPC: 쪽 찐 머리에 흰 두건, 앞치마를 두른 다정한 얼굴. 기본 도형을 한 덩어리로 합친 것이라 그리기 호출이 한 번이다.
// 원점은 발 밑 가운데, 앞은 +z. 키는 1.3m쯤(손님 캐릭터보다 조금 크다).
import * as THREE from 'three';
import { Batch } from './batch';

const SKIN = 0xf6d7b8;
const HAIR = 0x1b1511;

export function buildJumoGeometry(): THREE.BufferGeometry {
  const b = new Batch(77);
  // 치마(남색)와 앞치마(흰색), 저고리(연노랑)와 고름(붉은색)
  b.cylinder(0.2, 0.34, 0.66, 14, [0, 0.33, 0], 0x2d4a86, { jitter: 0.04 });
  b.box([0.3, 0.5, 0.03], [0, 0.34, 0.255], 0xf3efe4, { jitter: 0.03 });
  b.box([0.34, 0.035, 0.05], [0, 0.62, 0.2], 0xe2dccb);
  b.cylinder(0.17, 0.2, 0.3, 12, [0, 0.8, 0], 0xf2dc8f, { jitter: 0.03 });
  b.box([0.05, 0.14, 0.02], [-0.03, 0.78, 0.2], 0xc23b32, { rz: 0.15 });
  b.box([0.05, 0.12, 0.02], [0.05, 0.77, 0.2], 0xc23b32, { rz: -0.2 });
  // 팔: 한 손은 국자를 들고, 한 손은 앞치마 앞에
  b.cylinder(0.05, 0.045, 0.34, 8, [-0.22, 0.78, 0.05], 0xf2dc8f, { rz: 0.3, rx: -0.25 });
  b.sphere(0.045, [-0.29, 0.62, 0.13], SKIN, {}, [1, 1, 1], [8, 6]);
  b.cylinder(0.05, 0.045, 0.34, 8, [0.22, 0.8, 0.05], 0xf2dc8f, { rz: -0.9, rx: -0.5 });
  b.sphere(0.045, [0.31, 0.7, 0.2], SKIN, {}, [1, 1, 1], [8, 6]);
  // 국자
  b.cylinder(0.012, 0.012, 0.42, 6, [0.33, 0.83, 0.2], 0x8a5e36, { rz: 0.15 });
  b.sphere(0.05, [0.35, 0.6, 0.2], 0xb9b9bd, {}, [1, 0.6, 1], [8, 5]);
  // 머리: 얼굴, 쪽 찐 머리, 흰 두건
  b.sphere(0.22, [0, 1.12, 0], SKIN, {}, [1, 1.02, 0.98], [18, 12]);
  b.sphere(0.226, [0, 1.17, -0.035], HAIR, {}, [1, 0.9, 1], [16, 8]);
  b.sphere(0.095, [0, 1.17, -0.235], HAIR, {}, [1, 1, 1], [10, 7]);
  b.cylinder(0.228, 0.228, 0.075, 18, [0, 1.235, -0.01], 0xf6f2e8, {}, true);
  b.box([0.07, 0.07, 0.03], [0.05, 1.2, -0.215], 0xf6f2e8, { rz: 0.5 });
  // 눈웃음과 볼
  for (const s of [-1, 1]) {
    b.add(new THREE.TorusGeometry(0.03, 0.008, 4, 8, Math.PI), 0x2a1a14, [s * 0.075, 1.125, 0.205], { rz: 0 });
    b.sphere(0.036, [s * 0.125, 1.065, 0.185], 0xf2a79a, {}, [1, 0.7, 0.4], [8, 5]);
  }
  b.add(new THREE.TorusGeometry(0.045, 0.008, 4, 10, Math.PI), 0x9a3a32, [0, 1.065, 0.215], { rz: Math.PI });
  const g = b.build();
  if (!g) throw new Error('jumak: 주모를 만들지 못했어요');
  return g;
}

/** 주모가 서 있는 동안의 숨 쉬는 몸짓과 대답할 때의 폴짝. 매 프레임 호출 */
export class JumoMotion {
  private reply = -1;
  private time = 0;

  /** 대답한다: 폴짝 뛰며 고개를 갸웃한다 */
  react(): void {
    this.reply = 0;
  }

  update(dt: number, reduced: boolean): { y: number; roll: number; scaleY: number; yaw: number } {
    this.time += dt;
    let y = 0;
    let roll = 0;
    if (this.reply >= 0) {
      this.reply += dt;
      const p = this.reply / 0.8;
      if (p >= 1) this.reply = -1;
      else if (!reduced) {
        y = 0.06 * Math.abs(Math.sin(Math.PI * 2 * p));
        roll = 0.09 * Math.sin(Math.PI * p);
      }
    }
    const breathe = reduced ? 0 : Math.sin(this.time * 1.7) * 0.008;
    const sway = reduced ? 0 : Math.sin(this.time * 0.6) * 0.06;
    return { y, roll, scaleY: 1 + breathe, yaw: sway };
  }
}
