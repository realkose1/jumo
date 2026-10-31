// 3인칭 뒤에서 보는 시점. 드래그로 둘러보고, 휠/두 손가락으로 확대 축소(범위 제한).
import * as THREE from 'three';

export interface CameraRigOptions {
  minDistance?: number;
  maxDistance?: number;
  initialDistance?: number;
  minPitch?: number;
  maxPitch?: number;
  initialPitch?: number;
}

const LOOK_YAW_PER_PX = 0.006;
const LOOK_PITCH_PER_PX = 0.005;

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  private minDistance: number;
  private maxDistance: number;
  private minPitch: number;
  private maxPitch: number;
  private yawAngle = 0;
  private pitch: number;
  private distance: number;
  private distanceGoal: number;
  private readonly focus = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private reduced = false;
  /** 부드럽게 돌아가는 중인 목표 방향 (사용자가 직접 돌리면 취소) */
  private yawTarget: number | null = null;

  constructor(options: CameraRigOptions = {}) {
    this.minDistance = options.minDistance ?? 2.5;
    this.maxDistance = options.maxDistance ?? 9;
    this.minPitch = options.minPitch ?? 0.15;
    this.maxPitch = options.maxPitch ?? 1.25;
    this.pitch = options.initialPitch ?? 0.55;
    this.distance = this.distanceGoal = options.initialDistance ?? 4.6;
    this.update(0);
  }

  /** 장면이 정한 기본 시점과 범위를 적용한다 (빠진 값은 그대로). 바로 그 자리로 간다 */
  configure(options: CameraRigOptions): void {
    this.minDistance = options.minDistance ?? this.minDistance;
    this.maxDistance = options.maxDistance ?? this.maxDistance;
    this.minPitch = options.minPitch ?? this.minPitch;
    this.maxPitch = options.maxPitch ?? this.maxPitch;
    if (options.initialPitch !== undefined) this.pitch = options.initialPitch;
    if (options.initialDistance !== undefined) this.distanceGoal = this.distance = options.initialDistance;
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
    this.distanceGoal = THREE.MathUtils.clamp(this.distanceGoal, this.minDistance, this.maxDistance);
  }

  /** 카메라가 땅 위에서 바라보는 방향의 각도. 이동키의 앞/뒤/좌/우 기준이 된다 */
  get yaw(): number {
    return this.yawAngle;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // 세로로 긴 화면은 시야각을 넓혀서 좌우가 잘리지 않게
    this.camera.fov = aspect < 1 ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  /** 캐릭터가 바라보는 방향의 뒤쪽에 카메라를 둔다 */
  resetBehind(facingYaw: number): void {
    this.yawAngle = facingYaw + Math.PI;
  }

  /** 따라갈 지점 (매 프레임 부른다) */
  setFollowTarget(x: number, y: number, z: number): void {
    this.goal.set(x, y, z);
  }

  snapToTarget(): void {
    this.focus.copy(this.goal);
    this.distance = this.distanceGoal;
    this.update(0);
  }

  /** 이 방향(yaw)이 보이도록 부드럽게 돌아간다. 움직임 줄이기면 바로 */
  aimYaw(yaw: number): void {
    this.yawTarget = yaw;
  }

  /** 드래그로 둘러보기 (픽셀) */
  rotate(dxPx: number, dyPx: number): void {
    this.yawTarget = null;
    this.yawAngle -= dxPx * LOOK_YAW_PER_PX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dyPx * LOOK_PITCH_PER_PX, this.minPitch, this.maxPitch);
  }

  /** 1보다 크면 멀어지고 작으면 가까워진다 */
  zoomBy(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.distanceGoal = THREE.MathUtils.clamp(this.distanceGoal * factor, this.minDistance, this.maxDistance);
  }

  update(dt: number): void {
    if (this.yawTarget !== null) {
      const delta = Math.atan2(Math.sin(this.yawTarget - this.yawAngle), Math.cos(this.yawTarget - this.yawAngle));
      if (this.reduced || dt === 0 || Math.abs(delta) < 0.003) {
        this.yawAngle += delta;
        this.yawTarget = null;
      } else {
        this.yawAngle += delta * (1 - Math.exp(-3.5 * dt));
      }
    }
    // 움직임 줄이기: 늦게 따라오며 일렁이는 느낌을 없애고 거의 바로 붙는다
    const follow = this.reduced ? 1 : 1 - Math.exp(-7 * dt);
    const zoom = this.reduced ? 1 : 1 - Math.exp(-10 * dt);
    this.focus.lerp(this.goal, dt === 0 ? 1 : follow);
    this.distance += (this.distanceGoal - this.distance) * (dt === 0 ? 1 : zoom);
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yawAngle) * horizontal,
      this.focus.y + Math.sin(this.pitch) * this.distance,
      this.focus.z + Math.cos(this.yawAngle) * horizontal,
    );
    this.camera.lookAt(this.focus);
  }
}
