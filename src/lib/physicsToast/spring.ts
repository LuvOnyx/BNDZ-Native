/** Spring physics engine — ported from Physics-Toast (MIT-style reference). */

export class Spring {
  current: number;
  target: number;
  velocity = 0;
  private stiffness: number;
  private damping: number;
  private mass: number;
  private precision: number;

  constructor(value: number, config: { stiffness?: number; damping?: number; mass?: number; precision?: number } = {}) {
    this.current = value;
    this.target = value;
    this.stiffness = config.stiffness ?? 170;
    this.damping = config.damping ?? 14;
    this.mass = config.mass ?? 1;
    this.precision = config.precision ?? 0.01;
  }

  set(target: number) {
    this.target = target;
  }

  tick(dt: number): boolean {
    const steps = Math.ceil(dt / 0.004);
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      const displacement = this.current - this.target;
      const acceleration = (-this.stiffness * displacement - this.damping * this.velocity) / this.mass;
      this.velocity += acceleration * sub;
      this.current += this.velocity * sub;
    }
    const settled =
      Math.abs(this.velocity) < this.precision
      && Math.abs(this.current - this.target) < this.precision;
    if (settled) {
      this.current = this.target;
      this.velocity = 0;
      return true;
    }
    return false;
  }
}

type AnimEntry = {
  springs: Record<string, Spring>;
  apply: (springs: Record<string, Spring>) => void;
  done?: () => void;
};

class SpringAnimator {
  private animations = new Map<string, AnimEntry>();
  private running = false;
  private lastTime = 0;

  add(id: string, springs: Record<string, Spring>, apply: AnimEntry['apply'], done?: () => void) {
    this.animations.set(id, { springs, apply, done });
    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now();
      this.loop();
    }
  }

  remove(id: string) {
    this.animations.delete(id);
  }

  private loop() {
    if (!this.animations.size) {
      this.running = false;
      return;
    }
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.064);
    this.lastTime = now;
    const completed: string[] = [];
    for (const [id, anim] of this.animations) {
      let allSettled = true;
      for (const spring of Object.values(anim.springs)) {
        if (!spring.tick(dt)) allSettled = false;
      }
      anim.apply(anim.springs);
      if (allSettled) {
        completed.push(id);
        anim.done?.();
      }
    }
    for (const id of completed) this.animations.delete(id);
    requestAnimationFrame(() => this.loop());
  }
}

export const physicsToastAnimator = new SpringAnimator();

export const PHYSICS_TOAST_SPRING = { stiffness: 180, damping: 15, mass: 1 };
export const PHYSICS_TOAST_SPRING_SMOOTH = { stiffness: 150, damping: 20, mass: 1 };
