/**
 * world_brain.js
 * Global State + Ecological Intelligence
 */

/* ============================================================
 * Utility
 * ========================================================== */

function clamp(v, min, max) {
  return Math.min(
    max,
    Math.max(min, v)
  );
}

function poisson(lambda) {
  return -Math.log(
    1 - Math.random()
  ) / lambda;
}

/* ============================================================
 * Enums
 * ========================================================== */

export const ENCLOSURE_TYPES =
  Object.freeze({
    OPEN: "Open",
    UMBRELLA: "Umbrella",
    INDOOR: "Indoor",
  });

export const ENTITY_TYPES =
  Object.freeze({
    BIRDS: "Birds",
    TRAFFIC: "Traffic",
    INSECTS: "Insects",
    TYPING: "Typing",
  });

/* ============================================================
 * WorldState
 * ========================================================== */

class WorldStateClass {

  constructor() {

    this.weather = {
      rainIntensity: 0,
      windTurbulence: 0,
    };

    this.listener = {
      enclosure:
        ENCLOSURE_TYPES.OPEN,
    };

    this.time = {
      hour: 12,
    };
  }

  setRainIntensity(v) {
    this.weather.rainIntensity =
      clamp(v, 0, 1);
  }

  setEnclosure(type) {
    this.listener.enclosure =
      type;
  }

  snapshot() {
    return structuredClone({
      weather: this.weather,
      listener: this.listener,
      time: this.time,
    });
  }
}

export const WorldState =
  new WorldStateClass();

/* ============================================================
 * Behavioral Rules
 * ========================================================== */

export class BehavioralRulesEngine {

  static evaluate(
    entityType,
    state
  ) {

    const rain =
      state.weather.rainIntensity;

    const out = {
      probabilityMultiplier: 1,
      activityMultiplier: 1,
    };

    switch (entityType) {

      case ENTITY_TYPES.BIRDS:

        if (rain > 0.7) {
          out.probabilityMultiplier = 0;
        }

        out.activityMultiplier =
          1 - rain;

        break;
    }

    return out;
  }
}

/* ============================================================
 * AtomicBehavior
 * ========================================================== */

export class AtomicBehavior {

  constructor(config = {}) {

    this.id =
      config.id ||
      crypto.randomUUID();

    this.entityType =
      config.entityType;

    this.baseRate =
      config.baseRate || 0.1;
  }

  async onExecute() {}
}

/* ============================================================
 * AtomicScheduler
 * ========================================================== */

export class AtomicScheduler {

  constructor() {

    this.behaviors =
      new Map();

    this.running = false;
  }

  registerBehavior(behavior) {

    this.behaviors.set(
      behavior.id,
      behavior
    );

    this._schedule(behavior);
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  _schedule(behavior) {

    const lambda =
      behavior.baseRate;

    const nextTime =
      poisson(lambda) * 1000;

    setTimeout(
      async () => {

        if (!this.running) {
          return;
        }

        /**
         * JIT ecological gate
         * EXACTLY before playback.
         */

        const rules =
          BehavioralRulesEngine
            .evaluate(
              behavior.entityType,
              WorldState.snapshot()
            );

        if (
          rules
            .probabilityMultiplier <= 0
        ) {

          this._schedule(
            behavior
          );

          return;
        }

        await behavior.onExecute({
          rules,
        });

        this._schedule(
          behavior
        );

      },
      Math.max(1, nextTime)
    );
  }

  getState() {

    return {
      behaviorCount:
        this.behaviors.size,
    };
  }
}
