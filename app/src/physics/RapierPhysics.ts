import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AssemblyJoint, MechanicalProject, StudioPart, Vec3 } from '../model/mechanical';
import { WORLD_PER_MM } from '../model/mechanical';

export interface CollisionHit { partId: string; partName: string; timeOfImpact?: number; reason?: 'collision' | 'joint-limit'; jointId?: string }
export interface Pose { positionMm: Vec3; rotationDeg: Vec3 }
interface ColliderPiece { shape: RAPIER.Shape; descriptor: () => RAPIER.ColliderDesc; localCenter: Vec3 }

const identity = { x: 0, y: 0, z: 0, w: 1 };
const asWorld = (v: Vec3) => ({ x: v.x * WORLD_PER_MM, y: v.y * WORLD_PER_MM, z: v.z * WORLD_PER_MM });
const eulerQuaternion = (angles: Vec3) => new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(angles.x), THREE.MathUtils.degToRad(angles.y), THREE.MathUtils.degToRad(angles.z), 'XYZ'));
const quaternionObject = (q: THREE.Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const pairKey = (a: string, b: string) => [a, b].sort().join('::');

export class RapierPhysics {
  private world: RAPIER.World | null = null;
  private bodies = new Map<string, RAPIER.RigidBody>();
  private collidersByHandle = new Map<number, string>();
  private parts = new Map<string, StudioPart>();
  private joints: AssemblyJoint[] = [];
  private allowedPairs = new Set<string>();
  private ready = false;
  private versionText = 'تحميل Rapier/WASM…';

  async initialize(project: MechanicalProject): Promise<void> {
    await RAPIER.init();
    this.ready = true;
    this.versionText = `Rapier ${RAPIER.version()} · WASM`;
    this.rebuild(project);
  }

  isReady(): boolean { return this.ready && Boolean(this.world); }
  get status(): string { return this.isReady() ? `${this.versionText} · ${this.collidersByHandle.size} مصادم` : this.versionText; }

  rebuild(project: MechanicalProject): void {
    if (!this.ready) return;
    this.world?.free();
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.bodies.clear();
    this.collidersByHandle.clear();
    this.parts = new Map(project.parts.map((part) => [part.id, part]));
    this.joints = [...project.joints];
    this.allowedPairs = new Set(project.joints.map((joint) => pairKey(joint.parentId, joint.childId)));

    for (const part of project.parts) {
      if (!part.visible) continue;
      const position = asWorld(part.positionMm);
      const rotation = quaternionObject(eulerQuaternion(part.rotationDeg));
      const bodyDesc = part.fixed
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.dynamic().setGravityScale(0).setAdditionalMass(1);
      bodyDesc.setTranslation(position.x, position.y, position.z).setRotation(rotation);
      const body = this.world.createRigidBody(bodyDesc);
      this.bodies.set(part.id, body);
      for (const piece of colliderPieces(part)) {
        const center = asWorld(piece.localCenter);
        const descriptor = piece.descriptor().setTranslation(center.x, center.y, center.z).setFriction(0.55).setRestitution(0).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const collider = this.world.createCollider(descriptor, body);
        this.collidersByHandle.set(collider.handle, part.id);
      }
    }

    for (const joint of project.joints) this.createJoint(joint, project);
    this.world.step();
  }

  checkPose(part: StudioPart, from: Pose, to: Pose): CollisionHit | null {
    if (!this.world || !this.ready || !part.visible) return null;
    const jointHit = this.checkJointLimit(part, from, to);
    if (jointHit) return jointHit;
    const body = this.bodies.get(part.id);
    const previous = asWorld(from.positionMm);
    const next = asWorld(to.positionMm);
    const velocity = { x: next.x - previous.x, y: next.y - previous.y, z: next.z - previous.z };
    const startRotation = eulerQuaternion(from.rotationDeg);
    const rotation = eulerQuaternion(to.rotationDeg);
    const quaternion = quaternionObject(rotation);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(startRotation.dot(rotation))));
    const travel = Math.hypot(velocity.x, velocity.y, velocity.z);
    const radius = Math.hypot(part.sizeMm.x, part.sizeMm.y, part.sizeMm.z) * WORLD_PER_MM / 2;
    const smallestFeature = Math.min(part.sizeMm.x, part.sizeMm.y, part.sizeMm.z) * WORLD_PER_MM;
    const maxSampleDistance = Math.max(0.001, Math.min(0.008, smallestFeature / 2));
    const sampleCount = Math.min(256, Math.max(1, Math.ceil((travel + angle * radius) / maxSampleDistance)));
    let collision: CollisionHit | null = null;
    for (const piece of colliderPieces(part)) {
      const local = new THREE.Vector3(piece.localCenter.x * WORLD_PER_MM, piece.localCenter.y * WORLD_PER_MM, piece.localCenter.z * WORLD_PER_MM).applyQuaternion(rotation);
      const start = { x: previous.x + local.x, y: previous.y + local.y, z: previous.z + local.z };
      const end = { x: next.x + local.x, y: next.y + local.y, z: next.z + local.z };
      const filter = (collider: RAPIER.Collider) => {
        const otherId = this.collidersByHandle.get(collider.handle);
        return Boolean(otherId && otherId !== part.id && !this.isAllowed(part.id, otherId));
      };
      if (angle < 1e-4 && travel > 1e-5) {
        const hit = this.world.castShape(start, quaternion, velocity, piece.shape, 0, 1, false, undefined, undefined, undefined, body, filter);
        if (hit) {
          collision = this.toHit(hit.collider.handle, hit.time_of_impact);
          if (collision) break;
        }
      }
      const queryAt = (position: RAPIER.Vector, rotationAt: THREE.Quaternion) => this.world!.intersectionsWithShape(position, quaternionObject(rotationAt), piece.shape, (other) => {
        const otherId = this.collidersByHandle.get(other.handle);
        if (otherId && otherId !== part.id && !this.isAllowed(part.id, otherId)) {
          collision = this.toHit(other.handle);
          return false;
        }
        return true;
      }, undefined, undefined, undefined, body, filter);
      if (angle >= 1e-4) {
        for (let sample = 1; sample <= sampleCount; sample += 1) {
          const t = sample / sampleCount;
          const sampledRotation = startRotation.clone().slerp(rotation, t);
          const base = new THREE.Vector3(previous.x, previous.y, previous.z).lerp(new THREE.Vector3(next.x, next.y, next.z), t);
          const center = new THREE.Vector3(piece.localCenter.x * WORLD_PER_MM, piece.localCenter.y * WORLD_PER_MM, piece.localCenter.z * WORLD_PER_MM).applyQuaternion(sampledRotation);
          base.add(center);
          queryAt({ x: base.x, y: base.y, z: base.z }, sampledRotation);
          if (collision) break;
        }
      } else {
        queryAt(end, rotation);
      }
      if (collision) break;
    }
    return collision;
  }

  moveBody(partId: string, pose: Pose): Pose | null {
    const body = this.bodies.get(partId);
    if (!body || !this.world) return null;
    const position = asWorld(pose.positionMm);
    body.setTranslation(position, true);
    body.setRotation(quaternionObject(eulerQuaternion(pose.rotationDeg)), true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.world.step();
    return this.partPose(partId);
  }

  partPose(partId: string): Pose | null {
    const body = this.bodies.get(partId);
    if (!body) return null;
    const p = body.translation();
    const q = body.rotation();
    const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), 'XYZ');
    return { positionMm: { x: p.x / WORLD_PER_MM, y: p.y / WORLD_PER_MM, z: p.z / WORLD_PER_MM }, rotationDeg: { x: THREE.MathUtils.radToDeg(euler.x), y: THREE.MathUtils.radToDeg(euler.y), z: THREE.MathUtils.radToDeg(euler.z) } };
  }

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.bodies.clear();
    this.collidersByHandle.clear();
    this.ready = false;
  }

  private isAllowed(a: string, b: string): boolean {
    if (this.allowedPairs.has(pairKey(a, b))) return true;
    const first = this.parts.get(a);
    const second = this.parts.get(b);
    if (!first || !second) return false;
    const kinds = new Set([first.kind, second.kind]);
    const roles = new Set([first.motionRole, second.motionRole]);
    if (kinds.has('cap') && kinds.has('u-channel')) return true;
    if (kinds.has('tube') && roles.has('washer-slide')) return true;
    if (roles.has('cap-pusher') && roles.has('cap')) return true;
    if (roles.has('washer-slide') && roles.has('washer')) return true;
    if (roles.has('washer') && kinds.has('cap')) return true;
    if (roles.has('press-head') && (roles.has('washer') || roles.has('cap'))) return true;
    if (roles.has('glue-gate') && roles.has('cap')) return true;
    return false;
  }

  private toHit(handle: number, timeOfImpact?: number): CollisionHit | null {
    const partId = this.collidersByHandle.get(handle);
    if (!partId) return null;
    return { partId, partName: this.parts.get(partId)?.name ?? partId, timeOfImpact, reason: 'collision' };
  }

  private checkJointLimit(part: StudioPart, from: Pose, to: Pose): CollisionHit | null {
    const toleranceMm = 2;
    const angleToleranceDeg = 2;
    const vector = (value: Vec3) => new THREE.Vector3(value.x, value.y, value.z);
    const offsetAxis = (joint: AssemblyJoint, parent: StudioPart) => {
      const parentRotation = eulerQuaternion(parent.rotationDeg);
      const restOffset = vector(joint.referenceOffsetMm).applyQuaternion(parentRotation);
      const axis = vector(joint.axis);
      if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
      axis.normalize().applyQuaternion(parentRotation);
      return { restOffset, axis };
    };
    const angleDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180;
    for (const joint of this.projectJoints()) {
      const parent = this.parts.get(joint.parentId);
      const child = this.parts.get(joint.childId);
      if (!parent || !child) continue;
      if (joint.parentId === part.id) {
        const moving = Math.hypot(to.positionMm.x - from.positionMm.x, to.positionMm.y - from.positionMm.y, to.positionMm.z - from.positionMm.z) > toleranceMm
          || Math.hypot(to.rotationDeg.x - from.rotationDeg.x, to.rotationDeg.y - from.rotationDeg.y, to.rotationDeg.z - from.rotationDeg.z) > angleToleranceDeg;
        if (moving) return { partId: child.id, partName: child.name, reason: 'joint-limit', jointId: joint.id };
        continue;
      }
      if (joint.childId !== part.id) continue;
      const { restOffset, axis } = offsetAxis(joint, parent);
      const parentPosition = vector(parent.positionMm);
      const expectedPosition = parentPosition.clone().add(restOffset);
      const restRotation = joint.referenceRotationDeg;
      const translationFrom = vector(from.positionMm).sub(expectedPosition);
      const translationTo = vector(to.positionMm).sub(expectedPosition);
      const relativeRotation = {
        x: angleDelta(to.rotationDeg.x - parent.rotationDeg.x, restRotation.x),
        y: angleDelta(to.rotationDeg.y - parent.rotationDeg.y, restRotation.y),
        z: angleDelta(to.rotationDeg.z - parent.rotationDeg.z, restRotation.z),
      };
      let violation = false;
      if (joint.kind === 'fixed') {
        violation = translationTo.length() > toleranceMm || Math.max(Math.abs(relativeRotation.x), Math.abs(relativeRotation.y), Math.abs(relativeRotation.z)) > angleToleranceDeg;
      } else if (joint.kind === 'slider') {
        const along = translationTo.dot(axis);
        const across = translationTo.clone().addScaledVector(axis, -along).length();
        const rotationError = Math.max(Math.abs(relativeRotation.x), Math.abs(relativeRotation.y), Math.abs(relativeRotation.z));
        violation = across > toleranceMm || along < joint.min - toleranceMm || along > joint.max + toleranceMm || rotationError > angleToleranceDeg;
      } else {
        const along = new THREE.Vector3(relativeRotation.x, relativeRotation.y, relativeRotation.z).dot(axis);
        const across = new THREE.Vector3(relativeRotation.x, relativeRotation.y, relativeRotation.z).addScaledVector(axis, -along).length();
        violation = translationTo.length() > toleranceMm || along < joint.min - angleToleranceDeg || along > joint.max + angleToleranceDeg || across > angleToleranceDeg;
      }
      if (violation) return { partId: parent.id, partName: parent.name, reason: 'joint-limit', jointId: joint.id };
    }
    return null;
  }

  private projectJoints(): AssemblyJoint[] {
    return this.joints;
  }

  private createJoint(joint: AssemblyJoint, project: MechanicalProject): void {
    if (!this.world) return;
    const parentBody = this.bodies.get(joint.parentId);
    const childBody = this.bodies.get(joint.childId);
    const parent = project.parts.find((part) => part.id === joint.parentId);
    const child = project.parts.find((part) => part.id === joint.childId);
    if (!parentBody || !childBody || !parent || !child || (parent.fixed && child.fixed)) return;
    const offset = new THREE.Vector3(joint.referenceOffsetMm.x * WORLD_PER_MM, joint.referenceOffsetMm.y * WORLD_PER_MM, joint.referenceOffsetMm.z * WORLD_PER_MM);
    const anchor1 = { x: offset.x, y: offset.y, z: offset.z };
    const anchor2 = { x: 0, y: 0, z: 0 };
    const axis = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
    axis.normalize();
    const axisVector = { x: axis.x, y: axis.y, z: axis.z };
    let data: RAPIER.JointData;
    if (joint.kind === 'fixed') data = RAPIER.JointData.fixed(anchor1, identity, anchor2, quaternionObject(eulerQuaternion(joint.referenceRotationDeg)));
    else if (joint.kind === 'revolute') data = RAPIER.JointData.revolute(anchor1, anchor2, axisVector);
    else data = RAPIER.JointData.prismatic(anchor1, anchor2, axisVector);
    const impulseJoint = this.world.createImpulseJoint(data, parentBody, childBody, true);
    if (joint.kind === 'slider') (impulseJoint as RAPIER.PrismaticImpulseJoint).setLimits(joint.min * WORLD_PER_MM, joint.max * WORLD_PER_MM);
    if (joint.kind === 'revolute') (impulseJoint as RAPIER.RevoluteImpulseJoint).setLimits(THREE.MathUtils.degToRad(joint.min), THREE.MathUtils.degToRad(joint.max));
  }
}

function boxPiece(sizeMm: Vec3, center: Vec3): ColliderPiece {
  const half = (value: number) => Math.max(0.003, value * WORLD_PER_MM / 2);
  const hx = half(sizeMm.x); const hy = half(sizeMm.y); const hz = half(sizeMm.z);
  return { shape: new RAPIER.Cuboid(hx, hy, hz), descriptor: () => RAPIER.ColliderDesc.cuboid(hx, hy, hz), localCenter: center };
}

function cylinderPiece(sizeMm: Vec3): ColliderPiece {
  const halfHeight = Math.max(0.003, sizeMm.y * WORLD_PER_MM / 2);
  const radius = Math.max(0.003, Math.min(sizeMm.x, sizeMm.z) * WORLD_PER_MM / 2);
  return { shape: new RAPIER.Cylinder(halfHeight, radius), descriptor: () => RAPIER.ColliderDesc.cylinder(halfHeight, radius), localCenter: { x: 0, y: 0, z: 0 } };
}

function colliderPieces(part: StudioPart): ColliderPiece[] {
  const { x, y, z } = part.sizeMm;
  if (part.kind === 'u-channel') {
    const thicknessMm = Math.min(12, Math.max(3, Math.min(y, z) * 0.12));
    const wallHeight = Math.max(1, y - thicknessMm);
    return [
      boxPiece({ x, y: thicknessMm, z }, { x: 0, y: -y / 2 + thicknessMm / 2, z: 0 }),
      boxPiece({ x, y: wallHeight, z: thicknessMm }, { x: 0, y: thicknessMm / 2, z: z / 2 - thicknessMm / 2 }),
      boxPiece({ x, y: wallHeight, z: thicknessMm }, { x: 0, y: thicknessMm / 2, z: -z / 2 + thicknessMm / 2 }),
    ];
  }
  if (part.kind === 'tube') {
    const wall = Math.max(2, Math.min(x, z) * 0.1);
    return [
      boxPiece({ x: wall, y, z }, { x: -x / 2 + wall / 2, y: 0, z: 0 }),
      boxPiece({ x: wall, y, z }, { x: x / 2 - wall / 2, y: 0, z: 0 }),
      boxPiece({ x: x - 2 * wall, y, z: wall }, { x: 0, y: 0, z: z / 2 - wall / 2 }),
    ];
  }
  if (['shaft', 'cylinder', 'cap', 'washer', 'gear-blank'].includes(part.kind)) return [cylinderPiece(part.sizeMm)];
  return [boxPiece(part.sizeMm, { x: 0, y: 0, z: 0 })];
}
