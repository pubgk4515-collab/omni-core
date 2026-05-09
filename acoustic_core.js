/**
 * acoustic_core.js
 * Procedural Acoustic World Simulator
 * DSP + Spatial Routing Core
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * 1. SampleBank
 *    - async loading
 *    - decoded buffer caching
 *    - deduplicated requests
 *
 * 2. AcousticEnvironment
 *    - master routing graph
 *    - environmental acoustics
 *    - reverb + limiter
 *
 * 3. ParticleRainSynth
 *    - procedural stochastic rain synthesis
 *    - spatialized droplet particles
 *    - continuous atmospheric rain bed
 *
 * 4. EcologicalAudioBehavior
 *    - stochastic ecological playback
 *    - JIT ecological gating
 *    - one-shot cleanup safety
 */

import {
  AtomicBehavior,
  ENCLOSURE_TYPES,
  BehavioralRulesEngine,
  WorldState,
} from "./world_brain.js";

/* ============================================================
 * Utility
 * ========================================================== */

/**
 * Random float.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function random(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Clamp value.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(v, min, max) {
  return Math.min(
    max,
    Math.max(min, v)
  );
}

/**
 * Safe disconnect helper.
 * @param {AudioNode} node
 */
function safeDisconnect(node) {

  if (!node) {
    return;
  }

  try {
    node.disconnect();
  } catch (_) {}
}

/**
 * Random array item.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function randomChoice(arr) {
  return arr[
    Math.floor(
      Math.random() * arr.length
    )
  ];
}

/* ============================================================
 * SampleBank
 * ========================================================== */

/**
 * Async decoded sample manager.
 *
 * Designed for:
 * - birds
 * - insects
 * - traffic
 * - typing
 * - micro-events
 */
export class SampleBank {

  /**
   * @param {BaseAudioContext} context
   */
  constructor(context) {

    this.context =
      context;

    /**
     * URL -> AudioBuffer
     */
    this.cache =
      new Map();

    /**
     * URL -> Promise<AudioBuffer>
     */
    this.pending =
      new Map();
  }

  /* ============================================================
   * Public API
   * ========================================================== */

  /**
   * Retrieves decoded AudioBuffer.
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
     * Cached.
     */
    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    /**
     * Already loading.
     */
    if (this.pending.has(url)) {
      return await this.pending.get(url);
    }

    const promise =
      this._load(url);

    this.pending.set(
      url,
      promise
    );

    try {

      const buffer =
        await promise;

      this.cache.set(
        url,
        buffer
      );

      return buffer;

    } finally {

      this.pending.delete(url);
    }
  }

  /**
   * Preloads collection.
   * @param {string[]} urls
   */
  async preload(urls = []) {

    await Promise.allSettled(
      urls.map((u) => this.get(u))
    );
  }

  /**
   * Clears memory cache.
   */
  clear() {

    this.cache.clear();
    this.pending.clear();
  }

  /* ============================================================
   * Internal
   * ========================================================== */

  /**
   * Fetch + decode.
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
          `HTTP ${response.status}`
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();

      return await this.context
        .decodeAudioData(
          arrayBuffer
        );

    } catch (err) {

      console.warn(
        "[SampleBank] Failed loading:",
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
 * Global acoustic routing graph.
 *
 * ------------------------------------------------------------
 * ROUTING
 * ------------------------------------------------------------
 *
 * DRY:
 *
 * Input
 *  -> LowPass
 *  -> Limiter
 *  -> Master
 *  -> Destination
 *
 * WET:
 *
 * Input
 *  -> ReverbSend
 *  -> Convolver
 *  -> ReverbGain
 *  -> Limiter
 */
export class AcousticEnvironment {

  /**
   * Shared singleton context.
   * @type {AudioContext|null}
   */
  static sharedContext = null;

  constructor() {

    /**
     * One shared context ONLY.
     */
    if (
      !AcousticEnvironment
        .sharedContext
    ) {

      const AC =
        window.AudioContext ||
        window.webkitAudioContext;

      AcousticEnvironment
        .sharedContext =
          new AC({
            latencyHint:
              "interactive",
          });
    }

    this.context =
      AcousticEnvironment
        .sharedContext;

    /**
     * Master nodes.
     */
    this.input =
      this.context.createGain();

    this.lowpass =
      this.context
        .createBiquadFilter();

    this.reverbSend =
      this.context.createGain();

    this.reverb =
      this.context
        .createConvolver();

    this.reverbGain =
      this.context.createGain();

    this.limiter =
      this.context
        .createDynamicsCompressor();

    this.masterGain =
      this.context.createGain();

    /**
     * --------------------------------------------------------
     * Lowpass
     * --------------------------------------------------------
     */

    this.lowpass.type =
      "lowpass";

    this.lowpass.frequency.value =
      20000;

    this.lowpass.Q.value =
      0.707;

    /**
     * --------------------------------------------------------
     * Reverb
     * --------------------------------------------------------
     */

    this.reverb.buffer =
      this.generateIR(
        2.4,
        2.2
      );

    this.reverbSend.gain.value =
      0.18;

    this.reverbGain.gain.value =
      0.22;

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

    /**
     * --------------------------------------------------------
     * Master
     * --------------------------------------------------------
     */

    this.masterGain.gain.value =
      0.92;

    /**
     * ========================================================
     * DRY PATH
     * ========================================================
     */

    this.input.connect(
      this.lowpass
    );

    this.lowpass.connect(
      this.limiter
    );

    /**
     * ========================================================
     * REVERB SEND
     * ========================================================
     */

    this.input.connect(
      this.reverbSend
    );

    this.reverbSend.connect(
      this.reverb
    );

    this.reverb.connect(
      this.reverbGain
    );

    this.reverbGain.connect(
      this.limiter
    );

    /**
     * ========================================================
     * OUTPUT
     * ========================================================
     */

    this.limiter.connect(
      this.masterGain
    );

    this.masterGain.connect(
      this.context.destination
    );
  }

  /* ============================================================
   * Procedural IR
   * ========================================================== */

  /**
   * Procedural stereo impulse response.
   *
   * @param {number} duration
   * @param {number} decay
   * @returns {AudioBuffer}
   */
  generateIR(
    duration = 2.5,
    decay = 2
  ) {

    const sampleRate =
      this.context.sampleRate;

    const length =
      sampleRate * duration;

    const buffer =
      this.context.createBuffer(
        2,
        length,
        sampleRate
      );

    for (let ch = 0; ch < 2; ch++) {

      const data =
        buffer.getChannelData(ch);

      for (
        let i = 0;
        i < length;
        i++
      ) {

        const env =
          Math.pow(
            1 - (i / length),
            decay
          );

        data[i] =
          (
            Math.random() * 2 - 1
          ) * env;
      }
    }

    return buffer;
  }

  /* ============================================================
   * Environmental Acoustics
   * ========================================================== */

  /**
   * Updates enclosure acoustics.
   */
  updateAcoustics() {

    const state =
      WorldState.snapshot();

    const enclosure =
      state.listener.enclosure;

    let cutoff = 20000;

    switch (enclosure) {

      case ENCLOSURE_TYPES.UMBRELLA:
        cutoff = 3000;
        break;

      case ENCLOSURE_TYPES.INDOOR:
        cutoff = 1800;
        break;

      default:
        cutoff = 20000;
        break;
    }

    this.lowpass.frequency
      .setTargetAtTime(
        cutoff,
        this.context.currentTime,
        0.08
      );
  }

  /**
   * Playback input bus.
   * @returns {GainNode}
   */
  getInputBus() {
    return this.input;
  }
}

/* ============================================================
 * ParticleRainSynth
 * ========================================================== */

/**
 * Procedural stochastic rain synthesizer.
 *
 * ------------------------------------------------------------
 * DESIGN
 * ------------------------------------------------------------
 *
 * Real rain is:
 * - countless randomized impacts
 * - spatially scattered
 * - broadband
 * - partially diffused into air hiss
 *
 * This synth therefore contains:
 *
 * 1. Continuous rain bed
 *    - filtered noise
 *    - atmospheric wash
 *
 * 2. Stochastic particle droplets
 *    - individually synthesized
 *    - randomized pan
 *    - randomized impact surfaces
 *    - randomized envelopes
 *
 * ------------------------------------------------------------
 * CRITICAL FIXES
 * ------------------------------------------------------------
 *
 * - no more center-panned impacts
 * - no more resonant "liquid" tone
 * - wide broadband spectral spread
 * - low Q diffuse droplets
 * - dense rain blends into hiss
 */
export class ParticleRainSynth {

  /**
   * @param {AcousticEnvironment} environment
   */
  constructor(environment) {

    this.environment =
      environment;

    this.context =
      environment.context;

    /**
     * Master output.
     */
    this.output =
      this.context.createGain();

    this.output.gain.value =
      0;

    /**
     * ========================================================
     * CONTINUOUS RAIN BED
     * ========================================================
     */

    const noiseBuffer =
      this._createNoiseBuffer();

    this.bedSource =
      this.context
        .createBufferSource();

    this.bedSource.buffer =
      noiseBuffer;

    this.bedSource.loop = true;

    /**
     * Bed filter.
     */
    this.bedFilter =
      this.context
        .createBiquadFilter();

    this.bedFilter.type =
      "lowpass";

    this.bedFilter.frequency.value =
      1200;

    /**
     * Bed gain.
     */
    this.bedGain =
      this.context.createGain();

    this.bedGain.gain.value =
      0;

    /**
     * Routing.
     */

    this.bedSource.connect(
      this.bedFilter
    );

    this.bedFilter.connect(
      this.bedGain
    );

    this.bedGain.connect(
      this.output
    );

    /**
     * --------------------------------------------------------
     * Master routing.
     * --------------------------------------------------------
     */

    this.output.connect(
      environment.getInputBus()
    );

    /**
     * --------------------------------------------------------
     * Runtime state.
     * --------------------------------------------------------
     */

    this.intensity = 0;

    this.running = true;

    this.dropInterval =
      260;

    /**
     * --------------------------------------------------------
     * Start persistent systems.
     * --------------------------------------------------------
     */

    this.bedSource.start();

    this._loop();
  }

  /* ============================================================
   * Noise Generation
   * ========================================================== */

  /**
   * Creates long-form pink-ish noise.
   *
   * @returns {AudioBuffer}
   */
  _createNoiseBuffer() {

    const length =
      this.context.sampleRate * 4;

    const buffer =
      this.context.createBuffer(
        1,
        length,
        this.context.sampleRate
      );

    const data =
      buffer.getChannelData(0);

    let last = 0;

    for (
      let i = 0;
      i < length;
      i++
    ) {

      const white =
        Math.random() * 2 - 1;

      /**
       * Pink-ish smoothing.
       */
      last =
        (0.985 * last) +
        (0.015 * white);

      data[i] = last;
    }

    return buffer;
  }

  /* ============================================================
   * Intensity Morphing
   * ========================================================== */

  /**
   * Morphs entire rainfall system.
   *
   * @param {number} intensity
   */
  update(intensity) {

    intensity =
      clamp(
        intensity,
        0,
        1
      );

    this.intensity =
      intensity;

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * CONTINUOUS BED
     * ========================================================
     */

    /**
     * Hiss becomes stronger
     * with heavy rain.
     */

    const bedGain =
      Math.pow(
        intensity,
        1.3
      ) * 0.22;

    /**
     * Heavy rain opens spectrum.
     */

    const bedCutoff =
      800 +
      (intensity * 6800);

    this.bedGain.gain
      .setTargetAtTime(
        bedGain,
        now,
        0.08
      );

    this.bedFilter.frequency
      .setTargetAtTime(
        bedCutoff,
        now,
        0.08
      );

    /**
     * ========================================================
     * DROPLET DENSITY
     * ========================================================
     *
     * Lower interval =
     * denser rain.
     */

    this.dropInterval =
      220 -
      (intensity * 205);

    /**
     * Safety clamp.
     */

    this.dropInterval =
      clamp(
        this.dropInterval,
        12,
        240
      );

    /**
     * ========================================================
     * MASTER OUTPUT
     * ========================================================
     */

    const outputGain =
      0.12 +
      (intensity * 0.72);

    this.output.gain
      .setTargetAtTime(
        outputGain,
        now,
        0.08
      );
  }

  /* ============================================================
   * Droplet Synthesis
   * ========================================================== */

  /**
   * Synthesizes one droplet particle.
   *
   * CRITICAL FIXES:
   * - stereo scatter
   * - low resonance
   * - broad spectral diversity
   * - non-liquid texture
   */
  _spawnDrop() {

    /**
     * No droplets at silence.
     */

    if (this.intensity <= 0.001) {
      return;
    }

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * MICRO BURST BUFFER
     * ========================================================
     */

    const buffer =
      this.context.createBuffer(
        1,
        256,
        this.context.sampleRate
      );

    const data =
      buffer.getChannelData(0);

    /**
     * Tiny broadband impact.
     */

    for (
      let i = 0;
      i < 256;
      i++
    ) {

      data[i] =
        (
          Math.random() * 2 - 1
        ) *
        Math.exp(
          -i / random(28, 55)
        );
    }

    /**
     * ========================================================
     * SOURCE
     * ========================================================
     */

    const src =
      this.context
        .createBufferSource();

    src.buffer = buffer;

    /**
     * ========================================================
     * FILTER
     * ========================================================
     *
     * CRITICAL FIX:
     * Very low Q.
     *
     * Prevents:
     * - resonant pitch
     * - liquid whistle
     * - "peeing into mic"
     */

    const filter =
      this.context
        .createBiquadFilter();

    filter.type =
      "bandpass";

    /**
     * Wide impact surfaces:
     * - low roof thuds
     * - mid concrete taps
     * - high leaf clicks
     */

    filter.frequency.value =
      random(
        300,
        6000
      );

    /**
     * LOW resonance.
     */

    filter.Q.value =
      random(
        0.1,
        1.5
      );

    /**
     * ========================================================
     * STEREO SCATTER
     * ========================================================
     */

    const panner =
      this.context
        .createStereoPanner();

    /**
     * Massive stereo spread.
     */

    panner.pan.value =
      random(
        -1,
        1
      );

    /**
     * ========================================================
     * ENVELOPE
     * ========================================================
     */

    const gain =
      this.context
        .createGain();

    /**
     * Heavy rain:
     * individual drops blend more
     * into atmospheric bed.
     */

    const dropVolume =
      lerpDropVolume(
        this.intensity
      );

    const attack =
      random(
        0.001,
        0.004
      );

    const decay =
      random(
        0.025,
        0.11
      );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.linearRampToValueAtTime(
      dropVolume,
      now + attack
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + decay
    );

    /**
     * ========================================================
     * ROUTING
     * ========================================================
     */

    src.connect(filter);

    filter.connect(panner);

    panner.connect(gain);

    gain.connect(
      this.output
    );

    /**
     * ========================================================
     * PLAYBACK
     * ========================================================
     */

    src.start(now);

    src.stop(
      now + decay + 0.04
    );

    /**
     * ========================================================
     * CLEANUP
     * ========================================================
     */

    src.onended = () => {

      safeDisconnect(src);
      safeDisconnect(filter);
      safeDisconnect(panner);
      safeDisconnect(gain);
    };
  }

  /* ============================================================
   * Scheduler Loop
   * ========================================================== */

  /**
   * Stochastic droplet scheduler.
   */
  _loop() {

    if (!this.running) {
      return;
    }

    /**
     * Multiple droplets for
     * intense rain.
     */

    const burstCount =
      Math.floor(
        1 +
        (this.intensity * 4)
      );

    for (
      let i = 0;
      i < burstCount;
      i++
    ) {

      /**
       * Random sparse gaps.
       */

      if (
        Math.random() <
        (0.25 + this.intensity)
      ) {

        this._spawnDrop();
      }
    }

    setTimeout(
      () => this._loop(),
      this.dropInterval
    );
  }

  /**
   * Stops synth safely.
   */
  destroy() {

    this.running = false;

    safeDisconnect(
      this.bedSource
    );

    safeDisconnect(
      this.bedFilter
    );

    safeDisconnect(
      this.bedGain
    );

    safeDisconnect(
      this.output
    );
  }
}

/* ============================================================
 * Internal Volume Curve
 * ========================================================== */

/**
 * Heavy rain:
 * individual impacts soften
 * into diffuse hiss field.
 *
 * @param {number} intensity
 * @returns {number}
 */
function lerpDropVolume(
  intensity
) {

  return (
    0.055 -
    (intensity * 0.028)
  );
}

/* ============================================================
 * EcologicalAudioBehavior
 * ========================================================== */

/**
 * Atomic ecological playback.
 *
 * Features:
 * - JIT ecological gating
 * - randomized pan
 * - randomized pitch
 * - cleanup-safe one-shots
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
      config.sampleUrls || [];

    this.baseVolume =
      config.baseVolume || 0.3;
  }

  /* ============================================================
   * Playback
   * ========================================================== */

  /**
   * Executes ecological event.
   *
   * @param {object} context
   */
  async onExecute(context) {

    /**
     * ========================================================
     * SECONDARY JIT GATE
     * ========================================================
     */

    const rules =
      BehavioralRulesEngine
        .evaluate(
          this.entityType,
          WorldState.snapshot()
        );

    /**
     * Abort stale events instantly.
     */

    if (
      rules
        .probabilityMultiplier <= 0
    ) {
      return;
    }

    try {

      /**
       * ------------------------------------------------------
       * Sample selection.
       * ----------------------------------------------------
       */

      const url =
        randomChoice(
          this.sampleUrls
        );

      /**
       * ------------------------------------------------------
       * Retrieve decoded buffer.
       * ----------------------------------------------------
       */

      const buffer =
        await this.sampleBank
          .get(url);

      /**
       * ------------------------------------------------------
       * One-shot nodes.
       * ----------------------------------------------------
       */

      const src =
        this.environment
          .context
          .createBufferSource();

      const pan =
        this.environment
          .context
          .createStereoPanner();

      const gain =
        this.environment
          .context
          .createGain();

      /**
       * ------------------------------------------------------
       * Source config.
       * ----------------------------------------------------
       */

      src.buffer =
        buffer;

      src.playbackRate.value =
        random(
          0.92,
          1.08
        );

      /**
       * ------------------------------------------------------
       * Spatial spread.
       * ----------------------------------------------------
       */

      pan.pan.value =
        random(
          -1,
          1
        );

      /**
       * ------------------------------------------------------
       * Final gain.
       * ----------------------------------------------------
       */

      gain.gain.value =
        clamp(
          this.baseVolume *
          (
            rules
              .activityMultiplier ?? 1
          ),
          0,
          2
        );

      /**
       * ------------------------------------------------------
       * Routing.
       * ----------------------------------------------------
       */

      src.connect(pan);

      pan.connect(gain);

      gain.connect(
        this.environment
          .getInputBus()
      );

      /**
       * ------------------------------------------------------
       * Cleanup.
       * ----------------------------------------------------
       */

      src.onended = () => {

        safeDisconnect(src);
        safeDisconnect(pan);
        safeDisconnect(gain);
      };

      /**
       * ------------------------------------------------------
       * Playback.
       * ----------------------------------------------------
       */

      src.start();

    } catch (err) {

      console.warn(
        "[EcologicalAudioBehavior] Playback failed:",
        err
      );
    }
  }
}
