/**
 * acoustic_core.js
 * DSP + Routing Core
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

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function safeDisconnect(node) {
  try {
    node.disconnect();
  } catch (_) {}
}

/* ============================================================
 * SampleBank
 * ========================================================== */

export class SampleBank {

  constructor(context) {

    this.context =
      context;

    this.cache =
      new Map();

    this.pending =
      new Map();
  }

  async get(url) {

    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    if (this.pending.has(url)) {
      return this.pending.get(url);
    }

    const promise =
      this._load(url);

    this.pending.set(
      url,
      promise
    );

    const buffer =
      await promise;

    this.cache.set(
      url,
      buffer
    );

    this.pending.delete(url);

    return buffer;
  }

  async _load(url) {

    const res =
      await fetch(url);

    const arr =
      await res.arrayBuffer();

    return await this.context
      .decodeAudioData(arr);
  }
}

/* ============================================================
 * AcousticEnvironment
 * ========================================================== */

export class AcousticEnvironment {

  static shared = null;

  constructor() {

    if (
      !AcousticEnvironment.shared
    ) {

      AcousticEnvironment.shared =
        new (
          window.AudioContext ||
          window.webkitAudioContext
        )();
    }

    this.context =
      AcousticEnvironment.shared;

    this.master =
      this.context.createGain();

    this.lowpass =
      this.context.createBiquadFilter();

    this.lowpass.type =
      "lowpass";

    this.lowpass.frequency.value =
      20000;

    this.reverb =
      this.context.createConvolver();

    this.limiter =
      this.context
        .createDynamicsCompressor();

    this.masterGain =
      this.context.createGain();

    this.reverb.buffer =
      this.generateIR(
        2.5,
        2
      );

    this.master.connect(
      this.lowpass
    );

    this.lowpass.connect(
      this.limiter
    );

    this.master.connect(
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
  }

  generateIR(duration, decay) {

    const sr =
      this.context.sampleRate;

    const len =
      sr * duration;

    const ir =
      this.context.createBuffer(
        2,
        len,
        sr
      );

    for (let ch = 0; ch < 2; ch++) {

      const data =
        ir.getChannelData(ch);

      for (let i = 0; i < len; i++) {

        data[i] =
          (
            Math.random() * 2 - 1
          ) *
          Math.pow(
            1 - i / len,
            decay
          );
      }
    }

    return ir;
  }

  updateAcoustics() {

    const enclosure =
      WorldState.snapshot()
        .listener.enclosure;

    const cutoff =
      enclosure ===
      ENCLOSURE_TYPES.UMBRELLA
        ? 3000
        : 20000;

    this.lowpass.frequency
      .setTargetAtTime(
        cutoff,
        this.context.currentTime,
        0.08
      );
  }

  getInputBus() {
    return this.master;
  }
}

/* ============================================================
 * ParticleRainSynth
 * ========================================================== */

/**
 * AAA-grade procedural rain synthesizer.
 *
 * ------------------------------------------------------------
 * DESIGN GOALS
 * ------------------------------------------------------------
 *
 * OLD PROBLEM:
 * - center-panned droplets
 * - ultra-resonant filters
 * - "liquid peeing into mic" artifact
 *
 * NEW MODEL:
 * - wide stereo scatter
 * - broad low-Q impacts
 * - layered atmospheric hiss bed
 * - stochastic surface diversity
 * - intensity-dependent density morphing
 *
 * ------------------------------------------------------------
 * ARCHITECTURE
 * ------------------------------------------------------------
 *
 * Layer A:
 * Continuous atmospheric rain bed
 * (filtered noise)
 *
 * Layer B:
 * Procedural transient droplets
 * (one-shot particles)
 *
 * ------------------------------------------------------------
 * INTENSITY MODEL
 * ------------------------------------------------------------
 *
 * Low intensity:
 * - sparse droplets
 * - almost no hiss
 * - isolated impacts
 *
 * High intensity:
 * - dense atmospheric wash
 * - softer individual particles
 * - broad-spectrum storm texture
 */
export class ParticleRainSynth {

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

    this.output.gain.value = 0;

    this.output.connect(
      environment.getInputBus()
    );

    /**
     * Runtime state.
     */
    this.intensity = 0;
    this.running = true;

    /**
     * Dynamic density state.
     */
    this.currentDensityMs = 800;

    /**
     * ========================================================
     * CONTINUOUS RAIN BED
     * ========================================================
     *
     * This is the atmospheric glue.
     * Without this, rain sounds fake.
     */

    this.noiseSource =
      this.context.createBufferSource();

    this.noiseFilter =
      this.context.createBiquadFilter();

    this.noiseGain =
      this.context.createGain();

    /**
     * Create long noise buffer.
     */
    this.noiseSource.buffer =
      this._createNoiseBuffer();

    this.noiseSource.loop = true;

    /**
     * Lowpass:
     * opens up as rain intensifies.
     */

    this.noiseFilter.type =
      "lowpass";

    this.noiseFilter.frequency.value =
      700;

    this.noiseFilter.Q.value =
      0.2;

    /**
     * Quiet atmospheric bed.
     */

    this.noiseGain.gain.value =
      0;

    /**
     * Routing.
     */

    this.noiseSource.connect(
      this.noiseFilter
    );

    this.noiseFilter.connect(
      this.noiseGain
    );

    this.noiseGain.connect(
      this.output
    );

    /**
     * Start persistent bed.
     */

    this.noiseSource.start();

    /**
     * Start droplet engine.
     */

    this._loop();
  }

  /* ============================================================
   * Noise Buffer
   * ========================================================== */

  /**
   * Creates soft pink-ish noise.
   *
   * IMPORTANT:
   * Smooth spectrum avoids harsh static.
   */
  _createNoiseBuffer() {

    const length =
      this.context.sampleRate * 5;

    const buffer =
      this.context.createBuffer(
        1,
        length,
        this.context.sampleRate
      );

    const data =
      buffer.getChannelData(0);

    let last = 0;

    for (let i = 0; i < length; i++) {

      const white =
        Math.random() * 2 - 1;

      /**
       * Pink-ish smoothing.
       */

      last =
        (0.985 * last) +
        (0.015 * white);

      data[i] =
        last * 0.9;
    }

    return buffer;
  }

  /* ============================================================
   * Intensity Morphing
   * ========================================================== */

  /**
   * Real-time rain morphing.
   *
   * @param {number} intensity
   */
  update(intensity) {

    this.intensity =
      Math.max(
        0,
        Math.min(1, intensity)
      );

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * BACKGROUND HISS BED
     * ========================================================
     */

    /**
     * Louder atmospheric wash.
     */

    const hissGain =
      Math.pow(
        this.intensity,
        1.4
      ) * 0.32;

    /**
     * More intense rain =
     * brighter spectrum.
     */

    const hissCutoff =
      700 +
      (this.intensity * 5500);

    this.noiseGain.gain
      .setTargetAtTime(
        hissGain,
        now,
        0.12
      );

    this.noiseFilter.frequency
      .setTargetAtTime(
        hissCutoff,
        now,
        0.12
      );

    /**
     * ========================================================
     * DROPLET DENSITY
     * ========================================================
     *
     * Heavy rain:
     * rapid transient spawning.
     */

    this.currentDensityMs =
      Math.max(
        18,
        850 -
        (this.intensity * 820)
      );
  }

  /* ============================================================
   * Droplet Synthesis
   * ========================================================== */

  /**
   * Generates one stochastic droplet.
   *
   * ------------------------------------------------------------
   * FIXES:
   * ------------------------------------------------------------
 *
 * - stereo scatter
 * - broad low-Q filtering
 * - softer resonances
 * - multi-surface simulation
 */
  _spawnDrop() {

    /**
     * Skip near-silent state.
     */

    if (
      this.intensity <= 0.001
    ) {
      return;
    }

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * NOISE IMPULSE
     * ========================================================
     */

    const buffer =
      this.context.createBuffer(
        1,
        512,
        this.context.sampleRate
      );

    const data =
      buffer.getChannelData(0);

    /**
     * Short filtered burst.
     */

    for (let i = 0; i < 512; i++) {

      /**
       * Fast exponential decay.
       */

      const decay =
        Math.exp(-i / 38);

      data[i] =
        (
          Math.random() * 2 - 1
        ) * decay;
    }

    /**
     * ========================================================
     * NODES
     * ========================================================
     */

    const src =
      this.context
        .createBufferSource();

    const filter =
      this.context
        .createBiquadFilter();

    const pan =
      this.context
        .createStereoPanner();

    const gain =
      this.context
        .createGain();

    src.buffer = buffer;

    /**
     * ========================================================
     * SURFACE VARIATION
     * ========================================================
     *
     * Different droplets hit:
     * - leaves
     * - concrete
     * - puddles
     * - fabric
     * - distant surfaces
     */

    filter.type =
      "bandpass";

    /**
     * MUCH wider range.
     */

    filter.frequency.value =
      random(
        300,
        6000
      );

    /**
     * CRITICAL FIX:
     * Lower resonance.
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

    pan.pan.value =
      random(
        -1,
        1
      );

    /**
     * ========================================================
     * INTENSITY-DEPENDENT GAIN
     * ========================================================
     *
     * Heavy storms:
     * droplets soften into wash.
     */

    const dropGain =
      (
        0.05 +
        (1 - this.intensity) * 0.07
      ) *
      random(
        0.6,
        1.2
      );

    /**
     * ========================================================
     * ENVELOPE
     * ========================================================
     */

    gain.gain.setValueAtTime(
      0,
      now
    );

    /**
     * Fast attack.
     */

    gain.gain.linearRampToValueAtTime(
      dropGain,
      now + 0.002
    );

    /**
     * Natural decay.
     */

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now +
      random(
        0.025,
        0.09
      )
    );

    /**
     * ========================================================
     * ROUTING
     * ========================================================
     */

    src.connect(filter);

    filter.connect(pan);

    pan.connect(gain);

    gain.connect(
      this.output
    );

    /**
     * ========================================================
     * PLAYBACK
     * ========================================================
     */

    src.start(now);

    src.stop(now + 0.18);

    /**
     * ========================================================
     * CLEANUP
     * ========================================================
     */

    src.onended = () => {

      safeDisconnect(src);
      safeDisconnect(filter);
      safeDisconnect(pan);
      safeDisconnect(gain);
    };
  }

  /* ============================================================
   * Particle Scheduler
   * ========================================================== */

  _loop() {

    if (!this.running) {
      return;
    }

    /**
     * --------------------------------------------------------
     * Spawn count scales with intensity.
     * --------------------------------------------------------
     *
     * Heavy rain:
     * multiple simultaneous impacts.
     */

    const burstCount =
      Math.max(
        1,
        Math.floor(
          1 +
          (this.intensity * 4)
        )
      );

    for (
      let i = 0;
      i < burstCount;
      i++
    ) {

      /**
       * Tiny temporal jitter
       * prevents robotic timing.
       */

      setTimeout(
        () => this._spawnDrop(),
        Math.random() * 12
      );
    }

    /**
     * Recursive stochastic scheduling.
     */

    setTimeout(
      () => this._loop(),
      this.currentDensityMs
    );
  }

  /* ============================================================
   * Cleanup
   * ========================================================== */

  destroy() {

    this.running = false;

    safeDisconnect(
      this.noiseSource
    );

    safeDisconnect(
      this.noiseFilter
    );

    safeDisconnect(
      this.noiseGain
    );

    safeDisconnect(
      this.output
    );
  }
}
/* ============================================================
 * EcologicalAudioBehavior
 * ========================================================== */

export class EcologicalAudioBehavior
  extends AtomicBehavior {

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

  async onExecute(context) {

    /**
     * SECONDARY JIT GATE
     * right before playback.
     */

    const rules =
      BehavioralRulesEngine
        .evaluate(
          this.entityType,
          WorldState.snapshot()
        );

    if (
      rules
        .probabilityMultiplier <= 0
    ) {
      return;
    }

    const url =
      this.sampleUrls[
        Math.floor(
          Math.random() *
          this.sampleUrls.length
        )
      ];

    const buffer =
      await this.sampleBank.get(url);

    const src =
      this.environment.context
        .createBufferSource();

    const pan =
      this.environment.context
        .createStereoPanner();

    const gain =
      this.environment.context
        .createGain();

    src.buffer =
      buffer;

    src.playbackRate.value =
      random(
        0.92,
        1.08
      );

    pan.pan.value =
      random(
        -1,
        1
      );

    gain.gain.value =
      this.baseVolume *
      rules.activityMultiplier;

    src.connect(pan);
    pan.connect(gain);
    gain.connect(
      this.environment
        .getInputBus()
    );

    src.start();

    src.onended = () => {

      safeDisconnect(src);
      safeDisconnect(pan);
      safeDisconnect(gain);
    };
  }
}
