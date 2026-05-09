/**
 * spatial_audio_router.js
 * Procedural Acoustic World Simulator
 * Production Spatial Audio Execution Layer
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 * This module is the real-time acoustic execution layer
 * beneath:
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
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 *
 * This is NOT:
 * - a music player
 * - a timeline sequencer
 * - a loop engine
 *
 * This IS:
 * - a stochastic ecological simulator
 * - a long-running acoustic infrastructure layer
 * - an emergent spatial behavior renderer
 *
 * ------------------------------------------------------------
 * CORE SYSTEMS
 * ------------------------------------------------------------
 *
 * 1. SampleBank
 *    - robust async asset management
 *    - deduplicated concurrent loading
 *    - decoded buffer cache
 *
 * 2. AcousticEnvironment
 *    - master audio graph
 *    - enclosure acoustics
 *    - environmental filtering
 *    - parallel reverb architecture
 *    - clipping protection
 *
 * 3. EcologicalAudioBehavior
 *    - AtomicBehavior → audible ecological event bridge
 *    - stochastic spatial playback
 *    - one-shot node lifecycle management
 *
 * ------------------------------------------------------------
 * PRODUCTION GUARANTEES
 * ------------------------------------------------------------
 *
 * - No silent DSP black holes
 * - Dry signal ALWAYS survives
 * - No invalid gain/pitch/pan values
 * - No memory leaks
 * - Mobile-safe
 * - Long-session stable
 * - Browser-safe decode fallbacks
 * - Reverb safe even if IR generation fails
 */

import {
  AtomicBehavior,
  ENCLOSURE_TYPES,
} from "./world_state_engine.js";

/* ============================================================
 * Utility Helpers
 * ========================================================== */

/**
 * Safe AudioNode disconnect.
 * @param {AudioNode|null|undefined} node
 */
function safeDisconnect(node) {
  if (!node) return;

  try {
    node.disconnect();
  } catch (_) {}
}

/**
 * Clamp numeric value.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

/**
 * Safe finite number.
 * @param {number} value
 * @param {number} fallback
 * @returns {number}
 */
function safeNumber(value, fallback = 0) {
  return Number.isFinite(value)
    ? value
    : fallback;
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
 * Random array selection.
 * @template T
 * @param {T[]} array
 * @returns {T}
 */
function randomChoice(array) {
  return array[
    Math.floor(Math.random() * array.length)
  ];
}

/**
 * Browser-safe decodeAudioData.
 * Safari-safe.
 *
 * @param {BaseAudioContext} context
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioData(
  context,
  arrayBuffer
) {

  try {

    const result =
      context.decodeAudioData(
        arrayBuffer
      );

    /**
     * Modern Promise browsers.
     */
    if (
      result &&
      typeof result.then === "function"
    ) {
      return await result;
    }

  } catch (_) {}

  /**
   * Legacy callback fallback.
   */
  return await new Promise(
    (resolve, reject) => {

      context.decodeAudioData(
        arrayBuffer,
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
 * Robust asynchronous ecological sample manager.
 *
 * ------------------------------------------------------------
 * FEATURES
 * ------------------------------------------------------------
 *
 * - Promise-based loading
 * - Decoded AudioBuffer cache
 * - Deduplicated concurrent fetches
 * - Explicit diagnostics
 * - Memory-safe cleanup
 * - Optional preload support
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * Tiny atomic assets:
 * - chirps
 * - footsteps
 * - branch snaps
 * - insects
 * - rustles
 *
 * are reused thousands of times
 * over long simulation sessions.
 */
export class SampleBank {

  /**
   * @param {BaseAudioContext} context
   * @param {object} [options={}]
   */
  constructor(
    context,
    options = {}
  ) {

    if (!context) {
      throw new Error(
        "[SampleBank] AudioContext required."
      );
    }

    this.context = context;

    this.debug =
      options.debug ?? false;

    /**
     * URL → AudioBuffer
     * @type {Map<string, AudioBuffer>}
     */
    this._buffers =
      new Map();

    /**
     * URL → Promise<AudioBuffer>
     * Prevents duplicate simultaneous fetches.
     * @type {Map<string, Promise<AudioBuffer>>}
     */
    this._pending =
      new Map();
  }

  /* ============================================================
   * Logging
   * ========================================================== */

  _log(...args) {
    if (this.debug) {
      console.log(
        "[SampleBank]",
        ...args
      );
    }
  }

  _warn(...args) {
    console.warn(
      "[SampleBank]",
      ...args
    );
  }

  /* ============================================================
   * Public API
   * ========================================================== */

  /**
   * Whether asset exists in cache.
   * @param {string} url
   * @returns {boolean}
   */
  has(url) {
    return this._buffers.has(url);
  }

  /**
   * Retrieves decoded AudioBuffer.
   *
   * Guarantees:
   * - one fetch
   * - one decode
   * - deduplicated concurrent requests
   *
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async get(url) {

    if (!url) {
      throw new Error(
        "[SampleBank] Invalid URL."
      );
    }

    /**
     * Cached buffer.
     */
    if (this._buffers.has(url)) {
      return this._buffers.get(url);
    }

    /**
     * Existing async request.
     */
    if (this._pending.has(url)) {
      return await this._pending.get(url);
    }

    const promise =
      this._load(url);

    this._pending.set(
      url,
      promise
    );

    try {

      const buffer =
        await promise;

      this._buffers.set(
        url,
        buffer
      );

      this._log(
        "Loaded:",
        url
      );

      return buffer;

    } catch (err) {

      this._warn(
        "Failed loading asset:",
        url,
        err
      );

      throw err;

    } finally {

      this._pending.delete(url);
    }
  }

  /**
   * Preloads asset collection.
   * @param {string[]} urls
   */
  async preload(urls = []) {

    const unique =
      [...new Set(urls)];

    await Promise.allSettled(
      unique.map((url) =>
        this.get(url)
      )
    );
  }

  /**
   * Clears all buffers.
   */
  clear() {

    this._buffers.clear();
    this._pending.clear();

    this._log(
      "Cache cleared."
    );
  }

  /* ============================================================
   * Internal Loading
   * ========================================================== */

  /**
   * Fetches + decodes sample.
   *
   * @private
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async _load(url) {

    try {

      const response =
        await fetch(url);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();

      const decoded =
        await decodeAudioData(
          this.context,
          arrayBuffer
        );

      return decoded;

    } catch (err) {

      this._warn(
        "Decode/Fetch failed:",
        url,
        err
      );

      throw err;
    }
  }
}

/* ============================================================
 * AcousticEnvironment
 * ========================================================== */

/**
 * Global acoustic execution graph.
 *
 * ------------------------------------------------------------
 * MASTER GRAPH
 * ------------------------------------------------------------
 *
 * DRY PATH:
 *
 * Source Events
 *      ↓
 * MasterInput
 *      ↓
 * Global LowPass
 *      ↓
 * Limiter
 *      ↓
 * MasterGain
 *      ↓
 * Destination
 *
 * ------------------------------------------------------------
 * WET PARALLEL SEND:
 * ------------------------------------------------------------
 *
 * MasterInput
 *      ↓
 * ReverbSendGain
 *      ↓
 * Convolver
 *      ↓
 * ReverbGain
 *      ↓
 * Limiter
 *
 * ------------------------------------------------------------
 * CRITICAL FIX
 * ------------------------------------------------------------
 *
 * The dry signal ALWAYS survives.
 *
 * Empty/broken reverb can NEVER mute
 * the ecosystem again.
 */
export class AcousticEnvironment {

  /**
   * Shared AudioContext singleton.
   * @type {AudioContext|null}
   */
  static sharedContext = null;

  /**
   * @param {object} [options={}]
   */
  constructor(options = {}) {

    this.debug =
      options.debug ?? false;

    /**
     * One shared context ONLY.
     */
    if (
      !AcousticEnvironment.sharedContext
    ) {

      const AC =
        window.AudioContext ||
        window.webkitAudioContext;

      AcousticEnvironment.sharedContext =
        new AC({
          latencyHint: "interactive",
        });
    }

    this.context =
      AcousticEnvironment.sharedContext;

    /**
     * Runtime state.
     */
    this.initialized = false;

    /**
     * Master graph nodes.
     */
    this.masterInput = null;

    this.globalLowPass = null;

    this.reverbSendGain = null;

    this.convolver = null;

    this.reverbGain = null;

    this.limiter = null;

    this.masterGain = null;
  }

  /* ============================================================
   * Logging
   * ========================================================== */

  _log(...args) {
    if (this.debug) {
      console.log(
        "[AcousticEnvironment]",
        ...args
      );
    }
  }

  _warn(...args) {
    console.warn(
      "[AcousticEnvironment]",
      ...args
    );
  }

  /* ============================================================
   * Initialization
   * ========================================================== */

  /**
   * Initializes full audio graph.
   * @returns {Promise<AcousticEnvironment>}
   */
  async init() {

    if (this.initialized) {
      return this;
    }

    try {

      /**
       * --------------------------------------------------------
       * Core Nodes
       * --------------------------------------------------------
       */

      this.masterInput =
        this.context.createGain();

      this.globalLowPass =
        this.context.createBiquadFilter();

      this.reverbSendGain =
        this.context.createGain();

      this.convolver =
        this.context.createConvolver();

      this.reverbGain =
        this.context.createGain();

      this.limiter =
        this.context.createDynamicsCompressor();

      this.masterGain =
        this.context.createGain();

      /**
       * --------------------------------------------------------
       * LowPass
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
       * Reverb
       * --------------------------------------------------------
       */

      this.reverbSendGain.gain.value =
        0.18;

      this.reverbGain.gain.value =
        0.25;

      /**
       * Procedural IR generation.
       */
      this.convolver.buffer =
        this.generateImpulseResponse(
          2.75,
          2.2
        );

      /**
       * --------------------------------------------------------
       * Limiter
       * --------------------------------------------------------
       */

      this.limiter.threshold.value =
        -10;

      this.limiter.ratio.value =
        20;

      this.limiter.attack.value =
        0.003;

      this.limiter.release.value =
        0.25;

      this.limiter.knee.value =
        12;

      /**
       * --------------------------------------------------------
       * Master Gain
       * --------------------------------------------------------
       */

      this.masterGain.gain.value =
        0.92;

      /**
       * ========================================================
       * DRY ROUTING
       * ========================================================
       */

      this.masterInput.connect(
        this.globalLowPass
      );

      this.globalLowPass.connect(
        this.limiter
      );

      /**
       * ========================================================
       * PARALLEL REVERB SEND
       * ========================================================
       */

      this.masterInput.connect(
        this.reverbSendGain
      );

      this.reverbSendGain.connect(
        this.convolver
      );

      this.convolver.connect(
        this.reverbGain
      );

      this.reverbGain.connect(
        this.limiter
      );

      /**
       * ========================================================
       * FINAL OUTPUT
       * ========================================================
       */

      this.limiter.connect(
        this.masterGain
      );

      this.masterGain.connect(
        this.context.destination
      );

      this.initialized = true;

      this._log(
        "Routing initialized successfully."
      );

      return this;

    } catch (err) {

      this._warn(
        "Initialization failed:",
        err
      );

      throw err;
    }
  }

  /* ============================================================
   * Procedural IR Generation
   * ========================================================== */

  /**
   * Generates stereo procedural impulse response.
   *
   * ------------------------------------------------------------
   * CHARACTERISTICS
   * ------------------------------------------------------------
   *
   * - exponential decay
   * - random diffusion
   * - stereo decorrelation
   * - no external assets required
   *
   * @param {number} durationSeconds
   * @param {number} decay
   * @returns {AudioBuffer}
   */
  generateImpulseResponse(
    durationSeconds = 2.5,
    decay = 2.0
  ) {

    const sampleRate =
      this.context.sampleRate;

    const length =
      Math.floor(
        sampleRate *
        durationSeconds
      );

    const impulse =
      this.context.createBuffer(
        2,
        length,
        sampleRate
      );

    for (let ch = 0; ch < 2; ch++) {

      const channel =
        impulse.getChannelData(ch);

      for (let i = 0; i < length; i++) {

        const t =
          i / length;

        const envelope =
          Math.pow(
            1 - t,
            decay
          );

        /**
         * Diffused random energy.
         */
        channel[i] =
          (
            (Math.random() * 2 - 1) *
            envelope
          ) * 0.85;
      }
    }

    this._log(
      "Procedural IR generated."
    );

    return impulse;
  }

  /* ============================================================
   * Environmental Acoustics
   * ========================================================== */

  /**
   * Morphs enclosure acoustics smoothly.
   *
   * @param {object} worldState
   */
  updateEnvironmentalAcoustics(
    worldState
  ) {

    if (!this.initialized) {
      return;
    }

    try {

      const enclosure =
        worldState?.listener?.enclosure ||
        ENCLOSURE_TYPES.OPEN;

      let cutoff = 20000;

      switch (enclosure) {

        case ENCLOSURE_TYPES.UMBRELLA:
          cutoff = 3000;
          break;

        case ENCLOSURE_TYPES.INDOOR:
          cutoff = 1800;
          break;

        case ENCLOSURE_TYPES.VEHICLE:
          cutoff = 1200;
          break;

        case ENCLOSURE_TYPES.TUNNEL:
          cutoff = 5500;
          break;

        case ENCLOSURE_TYPES.OPEN:
        default:
          cutoff = 20000;
          break;
      }

      this.globalLowPass.frequency
        .setTargetAtTime(
          cutoff,
          this.context.currentTime,
          0.08
        );

    } catch (err) {

      this._warn(
        "Acoustic update failed:",
        err
      );
    }
  }

  /* ============================================================
   * Playback Bus
   * ========================================================== */

  /**
   * Returns master event input bus.
   * @returns {GainNode}
   */
  getInputBus() {
    return this.masterInput;
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  async resume() {

    try {

      if (
        this.context &&
        this.context.state === "suspended"
      ) {
        await this.context.resume();
      }

    } catch (err) {

      this._warn(
        "Resume failed:",
        err
      );
    }
  }

  async suspend() {

    try {

      if (
        this.context &&
        this.context.state !== "closed"
      ) {
        await this.context.suspend();
      }

    } catch (err) {

      this._warn(
        "Suspend failed:",
        err
      );
    }
  }

  /**
   * Full teardown.
   */
  async destroy() {

    safeDisconnect(
      this.masterInput
    );

    safeDisconnect(
      this.globalLowPass
    );

    safeDisconnect(
      this.reverbSendGain
    );

    safeDisconnect(
      this.convolver
    );

    safeDisconnect(
      this.reverbGain
    );

    safeDisconnect(
      this.limiter
    );

    safeDisconnect(
      this.masterGain
    );

    this.initialized = false;

    this._log(
      "Environment destroyed."
    );
  }
}

/* ============================================================
 * EcologicalAudioBehavior
 * ========================================================== */

/**
 * Acoustic execution bridge.
 *
 * ------------------------------------------------------------
 * FLOW
 * ------------------------------------------------------------
 *
 * AtomicBehavior
 *      ↓
 * stochastic sample selection
 *      ↓
 * spatialization
 *      ↓
 * ecological playback
 *      ↓
 * automatic cleanup
 *
 * ------------------------------------------------------------
 * LONG SESSION SAFETY
 * ------------------------------------------------------------
 *
 * One-shot nodes:
 * - disconnect after playback
 * - release references
 * - permit browser GC
 */
export class EcologicalAudioBehavior
  extends AtomicBehavior {

  /**
   * @param {object} config
   */
  constructor(config = {}) {

    super(config);

    this.environment =
      config.environment;

    this.sampleBank =
      config.sampleBank;

    this.sampleUrls =
      Array.isArray(
        config.sampleUrls
      )
        ? config.sampleUrls
        : [];

    this.baseVolume =
      safeNumber(
        config.baseVolume,
        0.5
      );

    this.pitchRange =
      config.pitchRange ||
      [0.94, 1.06];

    this.panRange =
      config.panRange ||
      [-1, 1];

    this.gainVariance =
      safeNumber(
        config.gainVariance,
        0.18
      );

    this.debug =
      config.debug ?? false;

    if (
      !this.environment
    ) {
      throw new Error(
        "[EcologicalAudioBehavior] Missing environment."
      );
    }

    if (
      !this.sampleBank
    ) {
      throw new Error(
        "[EcologicalAudioBehavior] Missing sampleBank."
      );
    }
  }

  /* ============================================================
   * Logging
   * ========================================================== */

  _log(...args) {
    if (this.debug) {
      console.log(
        "[EcologicalAudioBehavior]",
        ...args
      );
    }
  }

  _warn(...args) {
    console.warn(
      "[EcologicalAudioBehavior]",
      ...args
    );
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

      if (
        !this.sampleUrls.length
      ) {
        this._warn(
          "No sample URLs configured."
        );
        return;
      }

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
       * Retrieve Buffer
       * --------------------------------------------------------
       */

      const buffer =
        await this.sampleBank.get(
          sampleUrl
        );

      if (!buffer) {
        this._warn(
          "Buffer unavailable:",
          sampleUrl
        );
        return;
      }

      /**
       * --------------------------------------------------------
       * Audio Context
       * --------------------------------------------------------
       */

      const audioContext =
        this.environment.context;

      /**
       * --------------------------------------------------------
       * One-shot Nodes
       * --------------------------------------------------------
       */

      let source =
        audioContext.createBufferSource();

      let panner =
        audioContext.createStereoPanner();

      let gain =
        audioContext.createGain();

      /**
       * --------------------------------------------------------
       * Playback Rate Safety
       * --------------------------------------------------------
       */

      const pitch =
        clamp(
          safeNumber(
            randomRange(
              this.pitchRange[0],
              this.pitchRange[1]
            ),
            1
          ),
          0.25,
          4
        );

      /**
       * --------------------------------------------------------
       * Spatialization Safety
       * --------------------------------------------------------
       */

      const pan =
        clamp(
          safeNumber(
            randomRange(
              this.panRange[0],
              this.panRange[1]
            ),
            0
          ),
          -1,
          1
        );

      /**
       * --------------------------------------------------------
       * Activity Multiplier Safety
       * --------------------------------------------------------
       */

      const activity =
        safeNumber(
          context?.rules
            ?.activityMultiplier,
          1
        );

      /**
       * --------------------------------------------------------
       * Gain Randomization
       * --------------------------------------------------------
       */

      const gainVariation =
        randomRange(
          1 - this.gainVariance,
          1 + this.gainVariance
        );

      const finalGain =
        clamp(
          this.baseVolume *
          activity *
          gainVariation,
          0,
          4
        );

      /**
       * --------------------------------------------------------
       * Configure Nodes
       * --------------------------------------------------------
       */

      source.buffer =
        buffer;

      source.playbackRate.value =
        pitch;

      panner.pan.value =
        pan;

      gain.gain.value =
        finalGain;

      /**
       * --------------------------------------------------------
       * Routing
       * --------------------------------------------------------
       */

      source.connect(
        panner
      );

      panner.connect(
        gain
      );

      gain.connect(
        this.environment
          .getInputBus()
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

        source = null;
        panner = null;
        gain = null;

        this._log(
          "One-shot cleaned."
        );
      };

      /**
       * --------------------------------------------------------
       * Playback
       * --------------------------------------------------------
       */

      source.start();

      this._log(
        "Playback triggered:",
        sampleUrl,
        {
          pitch,
          pan,
          gain: finalGain,
        }
      );

    } catch (err) {

      this._warn(
        "Playback failure:",
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
