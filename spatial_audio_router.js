/**
 * spatial_audio_router.js
 * Procedural Acoustic World Simulator
 * Phase — Spatial Audio Execution Layer
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 * This module is the REAL-TIME AUDIO EXECUTION LAYER
 * sitting beneath:
 *
 *   WorldState
 *   BehavioralRulesEngine
 *   AtomicScheduler
 *
 * and above:
 *
 *   Web Audio API
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * 1. SampleBank
 *    - async sample loading
 *    - decode caching
 *    - memory-efficient asset reuse
 *
 * 2. AcousticEnvironment
 *    - global audio graph
 *    - enclosure acoustics
 *    - environmental filtering
 *    - master dynamics protection
 *
 * 3. EcologicalAudioBehavior
 *    - bridges AtomicBehavior → audible events
 *    - converts ecological actions into sound playback
 *
 * ------------------------------------------------------------
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 *
 * Behavioral systems decide:
 *   "WHAT should happen"
 *
 * Audio systems decide:
 *   "HOW it sounds spatially"
 *
 * ------------------------------------------------------------
 * MEMORY SAFETY
 * ------------------------------------------------------------
 *
 * One-shot nodes:
 * - are disconnected after playback
 * - release references immediately
 * - allow browser garbage collection
 *
 * ------------------------------------------------------------
 * THREADING
 * ------------------------------------------------------------
 *
 * Audio loading:
 * - async
 * - non-blocking
 * - Promise-based
 *
 * Playback:
 * - Web Audio render thread
 *
 * ------------------------------------------------------------
 * DEPENDENCIES
 * ------------------------------------------------------------
 *
 * Assumes ES6 module imports work.
 */

import {
  AtomicBehavior,
  ENCLOSURE_TYPES,
} from "./world_state_engine.js";

/* ============================================================
 * Utility Helpers
 * ========================================================== */

/**
 * Safely disconnects a node.
 * @param {AudioNode|null|undefined} node
 */
function safeDisconnect(node) {
  if (!node) return;

  try {
    node.disconnect();
  } catch (_) {}
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
 * Random array item.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function randomChoice(arr) {
  return arr[
    Math.floor(Math.random() * arr.length)
  ];
}

/**
 * Browser-safe decodeAudioData.
 * @param {BaseAudioContext} context
 * @param {ArrayBuffer} buffer
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioData(
  context,
  buffer
) {

  const decoded =
    context.decodeAudioData(buffer);

  /**
   * Modern Promise browsers.
   */
  if (
    decoded &&
    typeof decoded.then === "function"
  ) {
    return await decoded;
  }

  /**
   * Legacy Safari fallback.
   */
  return await new Promise(
    (resolve, reject) => {
      context.decodeAudioData(
        buffer,
        resolve,
        reject
      );
    }
  );
}

/* ============================================================
 * SampleBank
 * ========================================================== */

/**
 * Centralized tiny-sample asset manager.
 *
 * Handles:
 * - async fetch
 * - decode
 * - caching
 * - deduplicated requests
 *
 * Ideal for:
 * - chirps
 * - footsteps
 * - snaps
 * - micro-events
 */
export class SampleBank {

  /**
   * @param {BaseAudioContext} context
   */
  constructor(context) {

    if (!context) {
      throw new Error(
        "SampleBank requires AudioContext."
      );
    }

    this._context = context;

    /**
     * Cached decoded buffers.
     * Map<string, AudioBuffer>
     */
    this._buffers = new Map();

    /**
     * Prevent duplicate concurrent loads.
     * Map<string, Promise<AudioBuffer>>
     */
    this._pending = new Map();
  }

  /* ============================================================
   * Public API
   * ========================================================== */

  /**
   * Returns whether sample already cached.
   * @param {string} url
   * @returns {boolean}
   */
  has(url) {
    return this._buffers.has(url);
  }

  /**
   * Retrieves sample buffer.
   *
   * Guarantees:
   * - one network fetch
   * - one decode operation
   *
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async get(url) {

    /**
     * Cached immediately.
     */
    if (this._buffers.has(url)) {
      return this._buffers.get(url);
    }

    /**
     * Existing async load.
     */
    if (this._pending.has(url)) {
      return await this._pending.get(url);
    }

    const loadPromise = this._load(url);

    this._pending.set(
      url,
      loadPromise
    );

    try {

      const buffer =
        await loadPromise;

      this._buffers.set(
        url,
        buffer
      );

      return buffer;

    } finally {

      this._pending.delete(url);
    }
  }

  /**
   * Preload multiple samples.
   * @param {string[]} urls
   */
  async preload(urls = []) {

    await Promise.all(
      urls.map((url) => this.get(url))
    );
  }

  /**
   * Clear cache.
   */
  clear() {

    this._buffers.clear();
    this._pending.clear();
  }

  /* ============================================================
   * Internal
   * ========================================================== */

  /**
   * Fetch + decode.
   * @private
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async _load(url) {

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch sample: ${url}`
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    return await decodeAudioData(
      this._context,
      arrayBuffer
    );
  }
}

/* ============================================================
 * AcousticEnvironment
 * ========================================================== */

/**
 * Global acoustic graph manager.
 *
 * ------------------------------------------------------------
 * MASTER GRAPH
 * ------------------------------------------------------------
 *
 * Source Events
 *      ↓
 * MasterInputBus
 *      ↓
 * Global LowPass (Enclosure)
 *      ↓
 * Convolver Reverb
 *      ↓
 * Limiter
 *      ↓
 * Destination
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Simulates:
 * - umbrellas
 * - indoor occlusion
 * - tunnels
 * - environmental coloration
 */
export class AcousticEnvironment {

  /**
   * @param {object} [options={}]
   */
  constructor(options = {}) {

    /**
     * Context
     */
    this.context =
      options.context ||
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

    /**
     * Runtime state
     */
    this.initialized = false;

    /**
     * Master buses
     */
    this.masterInput = null;
    this.globalLowPass = null;
    this.reverb = null;
    this.limiter = null;
    this.masterGain = null;
  }

  /* ============================================================
   * Initialization
   * ========================================================== */

  /**
   * Initializes graph.
   */
  async init() {

    if (this.initialized) {
      return this;
    }

    /**
     * --------------------------------------------------------
     * Nodes
     * --------------------------------------------------------
     */

    this.masterInput =
      this.context.createGain();

    this.globalLowPass =
      this.context.createBiquadFilter();

    this.reverb =
      this.context.createConvolver();

    this.limiter =
      this.context.createDynamicsCompressor();

    this.masterGain =
      this.context.createGain();

    /**
     * --------------------------------------------------------
     * Low-pass defaults
     * --------------------------------------------------------
     */

    this.globalLowPass.type =
      "lowpass";

    this.globalLowPass.frequency.value =
      20000;

    this.globalLowPass.Q.value =
      0.707;

    /**
     * --------------------------------------------------------
     * Limiter settings
     * --------------------------------------------------------
     */

    this.limiter.threshold.value =
      -10;

    this.limiter.knee.value =
      12;

    this.limiter.ratio.value =
      20;

    this.limiter.attack.value =
      0.003;

    this.limiter.release.value =
      0.25;

    /**
     * --------------------------------------------------------
     * Master gain
     * --------------------------------------------------------
     */

    this.masterGain.gain.value =
      0.9;

    /**
     * --------------------------------------------------------
     * Routing
     * --------------------------------------------------------
     */

    this.masterInput.connect(
      this.globalLowPass
    );

    this.globalLowPass.connect(
      this.reverb
    );

    this.reverb.connect(
      this.limiter
    );

    this.limiter.connect(
      this.masterGain
    );

    this.masterGain.connect(
      this.context.destination
    );

    this.initialized = true;

    return this;
  }

  /* ============================================================
   * Environmental Acoustics
   * ========================================================== */

  /**
   * Reads WorldState.listener.enclosure
   * and morphs environmental acoustics.
   *
   * IMPORTANT:
   * Uses setTargetAtTime for smoothness.
   *
   * @param {object} worldState
   */
  updateEnvironmentalAcoustics(
    worldState
  ) {

    if (!this.initialized) {
      return;
    }

    const enclosure =
      worldState.listener.enclosure;

    let targetCutoff = 20000;

    switch (enclosure) {

      case ENCLOSURE_TYPES.UMBRELLA:
        targetCutoff = 3000;
        break;

      case ENCLOSURE_TYPES.INDOOR:
        targetCutoff = 1800;
        break;

      case ENCLOSURE_TYPES.VEHICLE:
        targetCutoff = 1200;
        break;

      case ENCLOSURE_TYPES.TUNNEL:
        targetCutoff = 5000;
        break;

      case ENCLOSURE_TYPES.OPEN:
      default:
        targetCutoff = 20000;
        break;
    }

    /**
     * Smooth environmental transition.
     */
    this.globalLowPass.frequency.setTargetAtTime(
      targetCutoff,
      this.context.currentTime,
      0.08
    );
  }

  /* ============================================================
   * Playback Routing
   * ========================================================== */

  /**
   * Returns master input bus.
   * Audio behaviors connect here.
   *
   * @returns {GainNode}
   */
  getInputBus() {
    return this.masterInput;
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  /**
   * Suspend context.
   */
  async suspend() {

    if (
      this.context &&
      this.context.state !== "closed"
    ) {
      await this.context.suspend();
    }
  }

  /**
   * Resume context.
   */
  async resume() {

    if (
      this.context &&
      this.context.state !== "closed"
    ) {
      await this.context.resume();
    }
  }

  /**
   * Full teardown.
   */
  async destroy() {

    safeDisconnect(this.masterInput);
    safeDisconnect(this.globalLowPass);
    safeDisconnect(this.reverb);
    safeDisconnect(this.limiter);
    safeDisconnect(this.masterGain);

    if (
      this.context &&
      this.context.state !== "closed"
    ) {
      await this.context.close();
    }

    this.initialized = false;
  }
}

/* ============================================================
 * EcologicalAudioBehavior
 * ========================================================== */

/**
 * Bridge:
 *
 * AtomicBehavior
 *        ↓
 * audible spatial playback
 *
 * ------------------------------------------------------------
 * FLOW
 * ------------------------------------------------------------
 *
 * Scheduler triggers behavior
 *        ↓
 * Pick sample
 *        ↓
 * Retrieve from SampleBank
 *        ↓
 * Create one-shot nodes
 *        ↓
 * Randomize spatial placement
 *        ↓
 * Play through AcousticEnvironment
 */
export class EcologicalAudioBehavior
  extends AtomicBehavior {

  /**
   * @param {object} config
   */
  constructor(config = {}) {

    super(config);

    /**
     * Tiny atomic samples.
     */
    this.sampleUrls =
      config.sampleUrls || [];

    /**
     * Reference:
     * AcousticEnvironment
     */
    this.environment =
      config.environment;

    /**
     * Reference:
     * SampleBank
     */
    this.sampleBank =
      config.sampleBank;

    /**
     * Base volume
     */
    this.baseVolume =
      config.baseVolume ?? 0.5;

    /**
     * Pitch variation.
     */
    this.pitchRange =
      config.pitchRange || [0.95, 1.05];

    /**
     * Stereo spread.
     */
    this.panRange =
      config.panRange || [-1, 1];

    if (
      !this.environment ||
      !this.sampleBank
    ) {
      throw new Error(
        "EcologicalAudioBehavior requires environment and sampleBank."
      );
    }
  }

  /* ============================================================
   * Atomic Execution
   * ========================================================== */

  /**
   * Triggered by AtomicScheduler.
   *
   * @param {object} context
   */
  async onExecute(context) {

    try {

      /**
       * --------------------------------------------------------
       * Sample Selection
       * --------------------------------------------------------
       */

      const sampleUrl =
        randomChoice(
          this.sampleUrls
        );

      /**
       * --------------------------------------------------------
       * Retrieve Decoded Buffer
       * --------------------------------------------------------
       */

      const buffer =
        await this.sampleBank.get(
          sampleUrl
        );

      /**
       * --------------------------------------------------------
       * Create One-Shot Nodes
       * --------------------------------------------------------
       */

      const audioContext =
        this.environment.context;

      const source =
        audioContext.createBufferSource();

      const panner =
        audioContext.createStereoPanner();

      const gain =
        audioContext.createGain();

      /**
       * --------------------------------------------------------
       * Configure Source
       * --------------------------------------------------------
       */

      source.buffer = buffer;

      source.playbackRate.value =
        randomRange(
          this.pitchRange[0],
          this.pitchRange[1]
        );

      /**
       * --------------------------------------------------------
       * Spatialization
       * --------------------------------------------------------
       */

      panner.pan.value =
        randomRange(
          this.panRange[0],
          this.panRange[1]
        );

      /**
       * --------------------------------------------------------
       * Final Volume Calculation
       * --------------------------------------------------------
       *
       * requested:
       * baseVolume × activityMultiplier
       */

      const finalVolume =
        this.baseVolume *
        context.rules.activityMultiplier;

      gain.gain.value =
        Math.max(0, finalVolume);

      /**
       * --------------------------------------------------------
       * Routing
       * --------------------------------------------------------
       */

      source.connect(panner);

      panner.connect(gain);

      gain.connect(
        this.environment.getInputBus()
      );

      /**
       * --------------------------------------------------------
       * Cleanup
       * --------------------------------------------------------
       */

      source.onended = () => {

        safeDisconnect(source);
        safeDisconnect(panner);
        safeDisconnect(gain);

        source.buffer = null;
      };

      /**
       * --------------------------------------------------------
       * Playback
       * --------------------------------------------------------
       */

      source.start();

    } catch (err) {

      console.warn(
        "[EcologicalAudioBehavior] Playback failed:",
        err
      );
    }
  }
}

/* ============================================================
 * Default Export
 * ========================================================== */

export default {
  SampleBank,
  AcousticEnvironment,
  EcologicalAudioBehavior,
};
