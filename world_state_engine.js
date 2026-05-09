/**
 * world_state_engine.js
 * Procedural Acoustic World Simulator
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 * This module acts as the high-level simulation brain
 * for a procedural acoustic ecosystem.
 *
 * It does NOT generate sound.
 * It does NOT perform DSP.
 * It does NOT contain UI.
 *
 * Instead, it provides:
 *
 * 1. Global World State
 * 2. Ecological Coherence Rules
 * 3. Behavioral Evaluation
 * 4. Stochastic Atomic Scheduling
 * 5. Emergent Simulation Timing
 *
 * ------------------------------------------------------------
 * ARCHITECTURAL PHILOSOPHY
 * ------------------------------------------------------------
 *
 * OLD MODEL:
 *   setInterval(() => playBird(), 5000)
 *
 * NEW MODEL:
 *   "Bird entities decide probabilistically whether
 *    to vocalize based on weather, enclosure,
 *    time-of-day, and local ecological pressure."
 *
 * ------------------------------------------------------------
 * SYSTEM LAYERS
 * ------------------------------------------------------------
 *
 * WorldState (Singleton)
 *        ↓
 * BehavioralRules
 *        ↓
 * AtomicScheduler
 *        ↓
 * AtomicBehaviors
 *
 * ------------------------------------------------------------
 * CORE CONCEPTS
 * ------------------------------------------------------------
 *
 * Atomic Behavior:
 * - Smallest ecological action.
 * - Examples:
 *    BirdCall
 *    Footstep
 *    BranchCreak
 *    InsectBurst
 *    ThunderStrike
 *
 * Poisson Timing:
 * - Real-world random events rarely happen
 *   at fixed intervals.
 *
 * - We model events using stochastic arrival
 *   distributions instead of loops.
 *
 * Ecological Coherence:
 * - Rain suppresses birds
 * - Wind masks insects
 * - Umbrellas dampen highs
 * - Indoors reduce environmental exposure
 *
 * ------------------------------------------------------------
 * NO AUDIO CODE
 * ------------------------------------------------------------
 * This module ONLY outputs:
 * - probabilities
 * - multipliers
 * - timing decisions
 * - environment mappings
 *
 * Integration with audio systems occurs elsewhere.
 */

/* ============================================================
 * Utility Helpers
 * ========================================================== */

/**
 * Clamp numeric value.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Random float.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Exponential distribution sampling.
 *
 * Used for Poisson event arrival timing.
 *
 * λ = events per second
 *
 * Returns:
 * time until next event
 *
 * @param {number} lambda
 * @returns {number}
 */
function sampleExponential(lambda) {
  if (lambda <= 0) {
    return Infinity;
  }

  return -Math.log(1 - Math.random()) / lambda;
}

/**
 * Normalize 24-hour clock.
 * @param {number} hour
 * @returns {number}
 */
function normalizeHour(hour) {
  let h = hour % 24;

  if (h < 0) {
    h += 24;
  }

  return h;
}

/* ============================================================
 * Enumerations
 * ========================================================== */

/**
 * Listener enclosure contexts.
 */
export const ENCLOSURE_TYPES = Object.freeze({
  OPEN: "Open",
  UMBRELLA: "Umbrella",
  INDOOR: "Indoor",
  VEHICLE: "Vehicle",
  TUNNEL: "Tunnel",
});

/**
 * Canonical ecological entity types.
 */
export const ENTITY_TYPES = Object.freeze({
  BIRDS: "Birds",
  INSECTS: "Insects",
  WIND: "Wind",
  THUNDER: "Thunder",
  FOOTSTEP: "Footstep",
  BRANCH: "Branch",
});

/* ============================================================
 * WorldState Singleton
 * ========================================================== */

/**
 * Centralized real-time world state.
 *
 * Single source of truth for:
 * - weather
 * - listener context
 * - time
 * - environmental conditions
 *
 * IMPORTANT:
 * This is intentionally mutable in real-time.
 */
class WorldStateSingleton {
  constructor() {
    if (WorldStateSingleton._instance) {
      return WorldStateSingleton._instance;
    }

    /**
     * Weather simulation.
     */
    this.weather = {
      /**
       * 0.0 → 1.0
       */
      rainIntensity: 0.0,

      /**
       * 0.0 → 1.0
       */
      windTurbulence: 0.2,

      /**
       * Optional future extensions:
       * humidity
       * pressure
       * fog density
       * temperature
       */
    };

    /**
     * Listener / player POV context.
     */
    this.listener = {
      /**
       * Approximate POV elevation in meters.
       */
      povHeight: 1.7,

      /**
       * Acoustic enclosure.
       */
      enclosure: ENCLOSURE_TYPES.OPEN,
    };

    /**
     * Time-of-day system.
     *
     * 0 → 24
     */
    this.time = {
      hour: 12.0,
    };

    /**
     * Global simulation clock.
     */
    this.simulation = {
      timeScale: 1.0,
      paused: false,
    };

    WorldStateSingleton._instance = this;
  }

  /* ============================================================
   * Weather
   * ========================================================== */

  /**
   * @param {number} intensity
   */
  setRainIntensity(intensity) {
    this.weather.rainIntensity =
      clamp(intensity, 0, 1);
  }

  /**
   * @param {number} turbulence
   */
  setWindTurbulence(turbulence) {
    this.weather.windTurbulence =
      clamp(turbulence, 0, 1);
  }

  /* ============================================================
   * Listener
   * ========================================================== */

  /**
   * @param {number} meters
   */
  setPOVHeight(meters) {
    this.listener.povHeight =
      Math.max(0, meters);
  }

  /**
   * @param {string} enclosure
   */
  setEnclosure(enclosure) {
    this.listener.enclosure =
      enclosure;
  }

  /* ============================================================
   * Time
   * ========================================================== */

  /**
   * @param {number} hour
   */
  setTimeOfDay(hour) {
    this.time.hour =
      normalizeHour(hour);
  }

  /**
   * Advances simulation time.
   * @param {number} deltaHours
   */
  advanceTime(deltaHours) {
    this.time.hour =
      normalizeHour(
        this.time.hour + deltaHours
      );
  }

  /* ============================================================
   * Snapshot
   * ========================================================== */

  /**
   * Immutable snapshot.
   * @returns {object}
   */
  snapshot() {
    return structuredClone({
      weather: this.weather,
      listener: this.listener,
      time: this.time,
      simulation: this.simulation,
    });
  }
}

/**
 * Global singleton export.
 */
export const WorldState =
  new WorldStateSingleton();

/* ============================================================
 * Behavioral Rules Engine
 * ========================================================== */

/**
 * The ecological coherence evaluator.
 *
 * Converts:
 *   WorldState
 * into:
 *   behavioral multipliers
 *   acoustic mappings
 *   simulation modifiers
 *
 * This acts like:
 *   "Environmental AI"
 */
export class BehavioralRulesEngine {

  /**
   * Evaluates ecological behavior.
   *
   * @param {string} entityType
   * @param {object} worldState
   * @returns {object}
   */
  static evaluate(
    entityType,
    worldState = WorldState.snapshot()
  ) {

    const rain =
      worldState.weather.rainIntensity;

    const wind =
      worldState.weather.windTurbulence;

    const hour =
      worldState.time.hour;

    const enclosure =
      worldState.listener.enclosure;

    /**
     * Final outputs.
     */
    const result = {
      /**
       * Final probability multiplier.
       */
      probabilityMultiplier: 1.0,

      /**
       * Timing density multiplier.
       * Higher = more frequent events.
       */
      activityMultiplier: 1.0,

      /**
       * Acoustic mapping hints.
       */
      acousticProfile: {
        lowPassCutoff: 20000,
        wetness: 0.0,
        occlusion: 0.0,
      },
    };

    /* ========================================================
     * Enclosure Rules
     * ====================================================== */

    switch (enclosure) {

      case ENCLOSURE_TYPES.UMBRELLA:

        result.acousticProfile.lowPassCutoff =
          3000;

        result.acousticProfile.occlusion =
          0.4;

        break;

      case ENCLOSURE_TYPES.INDOOR:

        result.acousticProfile.lowPassCutoff =
          1800;

        result.acousticProfile.occlusion =
          0.75;

        result.activityMultiplier *= 0.35;

        break;

      case ENCLOSURE_TYPES.VEHICLE:

        result.acousticProfile.lowPassCutoff =
          1200;

        result.acousticProfile.occlusion =
          0.85;

        result.activityMultiplier *= 0.2;

        break;

      case ENCLOSURE_TYPES.TUNNEL:

        result.acousticProfile.wetness =
          0.7;

        result.acousticProfile.lowPassCutoff =
          4500;

        break;
    }

    /* ========================================================
     * Entity-Specific Ecological Rules
     * ====================================================== */

    switch (entityType) {

      /* ------------------------------------------------------
       * Birds
       * ---------------------------------------------------- */

      case ENTITY_TYPES.BIRDS: {

        /**
         * Heavy rain suppresses birds entirely.
         */
        if (rain > 0.7) {
          result.probabilityMultiplier = 0;
          break;
        }

        /**
         * Dawn chorus boost.
         */
        if (hour >= 5 && hour <= 8) {
          result.activityMultiplier *= 2.5;
        }

        /**
         * Night silence.
         */
        if (hour >= 21 || hour <= 4) {
          result.activityMultiplier *= 0.1;
        }

        /**
         * Wind suppresses precision calls.
         */
        result.activityMultiplier *=
          lerp(1.0, 0.35, wind);

        /**
         * Rain progressively suppresses activity.
         */
        result.probabilityMultiplier *=
          lerp(1.0, 0.1, rain);

        break;
      }

      /* ------------------------------------------------------
       * Insects
       * ---------------------------------------------------- */

      case ENTITY_TYPES.INSECTS: {

        /**
         * Strong nighttime boost.
         */
        if (hour >= 19 || hour <= 5) {
          result.activityMultiplier *= 2.2;
        }

        /**
         * Wind heavily suppresses insects.
         */
        result.activityMultiplier *=
          lerp(1.0, 0.2, wind);

        /**
         * Moderate rain suppression.
         */
        result.probabilityMultiplier *=
          lerp(1.0, 0.3, rain);

        break;
      }

      /* ------------------------------------------------------
       * Thunder
       * ---------------------------------------------------- */

      case ENTITY_TYPES.THUNDER: {

        /**
         * Thunder only emerges under rain pressure.
         */
        result.activityMultiplier *=
          lerp(0.0, 2.5, rain);

        result.probabilityMultiplier *=
          rain;

        break;
      }

      /* ------------------------------------------------------
       * Wind
       * ---------------------------------------------------- */

      case ENTITY_TYPES.WIND: {

        result.activityMultiplier *=
          lerp(0.2, 3.0, wind);

        break;
      }

      /* ------------------------------------------------------
       * Footsteps
       * ---------------------------------------------------- */

      case ENTITY_TYPES.FOOTSTEP: {

        /**
         * Rain changes material feel.
         */
        result.acousticProfile.wetness =
          rain;

        break;
      }

      /* ------------------------------------------------------
       * Branches
       * ---------------------------------------------------- */

      case ENTITY_TYPES.BRANCH: {

        /**
         * Wind increases branch stress.
         */
        result.activityMultiplier *=
          lerp(0.1, 4.0, wind);

        break;
      }
    }

    /**
     * Final safety clamp.
     */
    result.probabilityMultiplier =
      clamp(
        result.probabilityMultiplier,
        0,
        10
      );

    result.activityMultiplier =
      clamp(
        result.activityMultiplier,
        0,
        10
      );

    return result;
  }
}

/* ============================================================
 * Atomic Behavior
 * ========================================================== */

/**
 * Base ecological entity behavior.
 *
 * Examples:
 * - BirdCall
 * - Footstep
 * - InsectBurst
 * - BranchSnap
 */
export class AtomicBehavior {

  /**
   * @param {object} config
   */
  constructor(config = {}) {

    /**
     * Unique behavior id.
     */
    this.id =
      config.id ||
      crypto.randomUUID();

    /**
     * Entity classification.
     */
    this.entityType =
      config.entityType ||
      ENTITY_TYPES.BIRDS;

    /**
     * Base Poisson rate λ.
     *
     * Events per second.
     */
    this.baseRate =
      Math.max(
        0.0001,
        config.baseRate ?? 0.1
      );

    /**
     * Optional behavior metadata.
     */
    this.meta =
      config.meta || {};

    /**
     * Runtime state.
     */
    this.runtime = {
      nextEventTime: 0,
      active: true,
      totalEvents: 0,
    };
  }

  /**
   * Override point.
   *
   * Called when scheduler triggers event.
   *
   * @param {object} context
   */
  onExecute(context) {
    // Intended for subclass override.
  }
}

/* ============================================================
 * Atomic Scheduler
 * ========================================================== */

/**
 * Stochastic ecological scheduler.
 *
 * ------------------------------------------------------------
 * KEY DIFFERENCE
 * ------------------------------------------------------------
 *
 * Traditional scheduler:
 *   fixed intervals
 *
 * AtomicScheduler:
 *   emergent stochastic timing
 *
 * ------------------------------------------------------------
 * MODEL
 * ------------------------------------------------------------
 *
 * Each behavior:
 * - has a base event rate λ
 * - gets modified by ecological rules
 * - samples next event via Poisson process
 *
 * This creates:
 * - natural clustering
 * - organic silence gaps
 * - emergent realism
 */
export class AtomicScheduler {

  /**
   * @param {object} [options={}]
   */
  constructor(options = {}) {

    /**
     * Registered behaviors.
     */
    this._behaviors = new Map();

    /**
     * Scheduler state.
     */
    this._running = false;

    /**
     * Active timer.
     */
    this._timer = null;

    /**
     * Scheduler resolution.
     *
     * Lower = more accurate
     * Higher = more efficient
     */
    this._tickMs =
      options.tickMs ?? 100;

    /**
     * Simulation time.
     */
    this._time = 0;
  }

  /* ============================================================
   * Behavior Registration
   * ========================================================== */

  /**
   * Registers behavior.
   *
   * @param {AtomicBehavior} behavior
   */
  registerBehavior(behavior) {

    if (!(behavior instanceof AtomicBehavior)) {
      throw new Error(
        "Behavior must extend AtomicBehavior."
      );
    }

    this._behaviors.set(
      behavior.id,
      behavior
    );

    /**
     * Immediately schedule first event.
     */
    this._scheduleNextEvent(
      behavior
    );
  }

  /**
   * Removes behavior.
   *
   * @param {string} behaviorId
   */
  removeBehavior(behaviorId) {
    this._behaviors.delete(
      behaviorId
    );
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  /**
   * Starts scheduler.
   */
  start() {

    if (this._running) {
      return;
    }

    this._running = true;

    this._loop();
  }

  /**
   * Stops scheduler.
   */
  stop() {

    this._running = false;

    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Cleanup.
   */
  destroy() {
    this.stop();
    this._behaviors.clear();
  }

  /* ============================================================
   * Internal Loop
   * ========================================================== */

  /**
   * Main scheduler loop.
   */
  _loop() {

    if (!this._running) {
      return;
    }

    const now =
      performance.now() / 1000;

    this._time = now;

    for (const behavior of this._behaviors.values()) {

      if (!behavior.runtime.active) {
        continue;
      }

      /**
       * Trigger event if due.
       */
      if (
        now >=
        behavior.runtime.nextEventTime
      ) {

        this._executeBehavior(
          behavior
        );

        /**
         * Schedule subsequent event.
         */
        this._scheduleNextEvent(
          behavior
        );
      }
    }

    this._timer = setTimeout(
      () => this._loop(),
      this._tickMs
    );
  }

  /**
   * Executes ecological behavior.
   *
   * @param {AtomicBehavior} behavior
   */
  _executeBehavior(behavior) {

    const worldState =
      WorldState.snapshot();

    const rules =
      BehavioralRulesEngine.evaluate(
        behavior.entityType,
        worldState
      );

    /**
     * Probability gate.
     */
    if (
      Math.random() >
      rules.probabilityMultiplier
    ) {
      return;
    }

    behavior.runtime.totalEvents++;

    /**
     * Behavior callback.
     */
    behavior.onExecute({
      worldState,
      rules,
      schedulerTime: this._time,
    });
  }

  /**
   * Schedules next event using
   * stochastic Poisson arrival timing.
   *
   * ------------------------------------------------------------
   * λ_final =
   *    baseRate × activityMultiplier
   *
   * nextTime =
   *    exponential_sample(λ_final)
   *
   * ------------------------------------------------------------
   *
   * @param {AtomicBehavior} behavior
   */
  _scheduleNextEvent(behavior) {

    const worldState =
      WorldState.snapshot();

    const rules =
      BehavioralRulesEngine.evaluate(
        behavior.entityType,
        worldState
      );

    /**
     * Final event rate.
     */
    const lambda =
      behavior.baseRate *
      rules.activityMultiplier;

    /**
     * Sample next arrival time.
     */
    const interval =
      sampleExponential(lambda);

    behavior.runtime.nextEventTime =
      this._time + interval;
  }

  /* ============================================================
   * Diagnostics
   * ========================================================== */

  /**
   * Scheduler snapshot.
   * @returns {object}
   */
  getState() {

    return {
      running: this._running,
      behaviorCount:
        this._behaviors.size,
      schedulerTime:
        this._time,
      behaviors:
        Array.from(
          this._behaviors.values()
        ).map((b) => ({
          id: b.id,
          entityType: b.entityType,
          baseRate: b.baseRate,
          nextEventTime:
            b.runtime.nextEventTime,
          totalEvents:
            b.runtime.totalEvents,
        })),
    };
  }
}

/* ============================================================
 * Default Export
 * ========================================================== */

export default {
  WorldState,
  BehavioralRulesEngine,
  AtomicBehavior,
  AtomicScheduler,
  ENTITY_TYPES,
  ENCLOSURE_TYPES,
};
