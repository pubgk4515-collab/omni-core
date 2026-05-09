/**
 * world_brain.js
 * Compact MoE Acoustic World Model
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This module acts as:
 *
 * 1. Global World State Store
 * 2. MoE (Mixture of Experts) Router
 * 3. Runtime Expert Registry
 *
 * ------------------------------------------------------------
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 *
 * The system is intentionally:
 *
 * - decoupled
 * - injection-friendly
 * - runtime extensible
 * - event-driven
 *
 * Experts SHOULD NOT:
 * - know about each other
 * - directly communicate
 *
 * Instead:
 * - WorldState becomes the shared truth
 * - MoERouter broadcasts state changes
 *
 * ------------------------------------------------------------
 * FUTURE EXPANSION
 * ------------------------------------------------------------
 *
 * This architecture supports:
 *
 * - procedural DSP experts
 * - ecological experts
 * - foley experts
 * - WASM experts
 * - runtime-loaded modules
 * - AI-driven autonomous agents
 */

/* ============================================================
 * Utility
 * ========================================================== */

/**
 * Clamps numeric value.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(
  value,
  min,
  max
) {

  return Math.min(
    max,
    Math.max(min, value)
  );
}

/* ============================================================
 * Enclosure Types
 * ========================================================== */

/**
 * Global enclosure presets.
 */
export const ENCLOSURE_TYPES =
  Object.freeze({

    OPEN:
      "Open",

    UMBRELLA:
      "Umbrella",

    INDOOR:
      "Indoor",
  });

/* ============================================================
 * WorldState Singleton
 * ========================================================== */

/**
 * Global simulation state.
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * Holds:
 * - atmospheric pressure
 * - enclosure state
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * Experts NEVER mutate each other.
 *
 * They ONLY:
 * - read snapshots
 * - react independently
 */
class WorldStateStore {

  constructor() {

    /**
     * Internal mutable state.
     */
    this._state = {

      /**
       * 0.0 → calm
       * 1.0 → violent storm
       */
      atmosphericPressure: 0,

      /**
       * Environmental enclosure.
       */
      enclosure:
        ENCLOSURE_TYPES.OPEN,
    };

    /**
     * Lightweight subscriptions.
     */
    this._listeners =
      new Set();
  }

  /* ============================================================
   * Atmospheric Pressure
   * ========================================================== */

  /**
   * Sets atmospheric pressure.
   *
   * @param {number} value
   */
  setAtmosphericPressure(
    value
  ) {

    this._state
      .atmosphericPressure =
        clamp(value, 0, 1);

    this._emit();
  }

  /**
   * Returns atmospheric pressure.
   *
   * @returns {number}
   */
  getAtmosphericPressure() {

    return this._state
      .atmosphericPressure;
  }

  /* ============================================================
   * Enclosure
   * ========================================================== */

  /**
   * Sets enclosure type.
   *
   * @param {string} enclosure
   */
  setEnclosure(
    enclosure
  ) {

    if (
      !Object.values(
        ENCLOSURE_TYPES
      ).includes(enclosure)
    ) {

      console.warn(
        "[WorldState] Invalid enclosure:",
        enclosure
      );

      return;
    }

    this._state.enclosure =
      enclosure;

    this._emit();
  }

  /**
   * Returns enclosure.
   *
   * @returns {string}
   */
  getEnclosure() {

    return this._state
      .enclosure;
  }

  /* ============================================================
   * Snapshot API
   * ========================================================== */

  /**
   * Immutable snapshot.
   *
   * Prevents accidental mutation.
   *
   * @returns {object}
   */
  snapshot() {

    return structuredClone(
      this._state
    );
  }

  /* ============================================================
   * Subscriptions
   * ========================================================== */

  /**
   * Subscribe to state changes.
   *
   * @param {Function} callback
   * @returns {Function}
   */
  subscribe(callback) {

    if (
      typeof callback !==
      "function"
    ) {

      throw new Error(
        "[WorldState] subscribe() requires function."
      );
    }

    this._listeners.add(
      callback
    );

    /**
     * Unsubscribe helper.
     */

    return () => {

      this._listeners.delete(
        callback
      );
    };
  }

  /**
   * Internal broadcast.
   *
   * @private
   */
  _emit() {

    const snapshot =
      this.snapshot();

    for (
      const listener
      of this._listeners
    ) {

      try {

        listener(snapshot);

      } catch (err) {

        console.warn(
          "[WorldState] Listener failed:",
          err
        );
      }
    }
  }
}

/**
 * Singleton export.
 */
export const WorldState =
  new WorldStateStore();

/* ============================================================
 * MoERouter
 * ========================================================== */

/**
 * Mixture-of-Experts Router.
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * - Registers experts
 * - Removes experts
 * - Broadcasts global state
 * - Enables runtime module injection
 *
 * ------------------------------------------------------------
 * EXPERT CONTRACT
 * ------------------------------------------------------------
 *
 * Experts SHOULD implement:
 *
 * onWorldStateUpdate(worldState)
 *
 * Example:
 *
 * class RainExpert {
 *   onWorldStateUpdate(state) {
 *     ...
 *   }
 * }
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * Router remains agnostic.
 *
 * It does NOT care:
 * - what expert type exists
 * - whether expert is DSP
 * - whether expert is WASM
 * - whether expert is ecological
 */
export class MoERouter {

  constructor() {

    /**
     * Runtime expert registry.
     *
     * Map<string, object>
     */
    this._experts =
      new Map();

    /**
     * Auto-bind WorldState.
     */
    this._unsubscribe =
      WorldState.subscribe(
        (state) => {

          this.broadcastState(
            state
          );
        }
      );
  }

  /* ============================================================
   * Expert Registry
   * ========================================================== */

  /**
   * Registers expert instance.
   *
   * @param {object} expertInstance
   */
  registerExpert(
    expertInstance
  ) {

    if (
      !expertInstance
    ) {

      throw new Error(
        "[MoERouter] Invalid expert."
      );
    }

    /**
     * Runtime ID.
     */

    const id =
      expertInstance.id ||
      crypto.randomUUID();

    /**
     * Attach stable ID.
     */

    expertInstance.id = id;

    this._experts.set(
      id,
      expertInstance
    );

    /**
     * Immediately hydrate expert
     * with current world state.
     */

    try {

      if (
        typeof expertInstance
          .onWorldStateUpdate ===
        "function"
      ) {

        expertInstance
          .onWorldStateUpdate(
            WorldState.snapshot()
          );
      }

    } catch (err) {

      console.warn(
        "[MoERouter] Expert hydration failed:",
        err
      );
    }

    return id;
  }

  /**
   * Removes expert safely.
   *
   * @param {string} id
   */
  unregisterExpert(id) {

    const expert =
      this._experts.get(id);

    if (!expert) {
      return;
    }

    /**
     * Optional teardown hook.
     */

    try {

      if (
        typeof expert.destroy ===
        "function"
      ) {

        expert.destroy();
      }

    } catch (err) {

      console.warn(
        "[MoERouter] Expert destroy failed:",
        err
      );
    }

    this._experts.delete(id);
  }

  /* ============================================================
   * Broadcasting
   * ========================================================== */

  /**
   * Pushes WorldState updates
   * to all registered experts.
   *
   * @param {object} [state]
   */
  broadcastState(state) {

    const snapshot =
      state ||
      WorldState.snapshot();

    for (
      const expert
      of this._experts.values()
    ) {

      try {

        if (
          typeof expert
            .onWorldStateUpdate ===
          "function"
        ) {

          expert
            .onWorldStateUpdate(
              snapshot
            );
        }

      } catch (err) {

        console.warn(
          "[MoERouter] Expert update failed:",
          err
        );
      }
    }
  }

  /* ============================================================
   * Query API
   * ========================================================== */

  /**
   * Returns expert count.
   *
   * @returns {number}
   */
  getExpertCount() {

    return this._experts.size;
  }

  /**
   * Returns all experts.
   *
   * @returns {Array<object>}
   */
  getExperts() {

    return Array.from(
      this._experts.values()
    );
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  /**
   * Full teardown.
   */
  destroy() {

    for (
      const id
      of this._experts.keys()
    ) {

      this.unregisterExpert(id);
    }

    if (
      typeof this
        ._unsubscribe ===
      "function"
    ) {

      this._unsubscribe();
    }
  }
}
