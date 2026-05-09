/**
 * acoustic_core.js
 * Procedural Acoustic World Simulator
 * DSP + Routing Core
 *
 * ------------------------------------------------------------
 * ARCHITECTURE
 * ------------------------------------------------------------
 *
 * 1. SampleBank
 *    - async micro-sample loader/cache
 *
 * 2. AcousticEnvironment
 *    - global routing
 *    - lowpass enclosure simulation
 *    - procedural convolution reverb
 *    - limiter protection
 *
 * 3. ParticleRainSynth
 *    - AAA-grade procedural rain engine
 *    - stereo stochastic droplet simulation
 *    - atmospheric rain bed
 *    - dynamic density morphing
 *
 * 4. EcologicalAudioBehavior
 *    - stochastic ecological sample playback
 *    - JIT ecological coherence gate
 *
 * ------------------------------------------------------------
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 *
 * This is NOT:
 * - a music player
 * - a looping ambience mp3 engine
 *
 * This IS:
 * - procedural acoustic simulation
 * - stochastic ecology infrastructure
 * - long-session world rendering
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

function clamp(v, min, max) {
  return Math.min(
    max,
    Math.max(min, v)
  );
}

function safeDisconnect(node) {

  if (!node) return;

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

    /**
     * Decoded AudioBuffers
     */
    this.cache =
      new Map();

    /**
     * Deduplicated pending requests
     */
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

  async _load(url) {

    const res =
      await fetch(url);

    if (!res.ok) {

      throw new Error(
        `Failed loading sample: ${url}`
      );
    }

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

    /**
     * Shared singleton AudioContext
     */

    if (
      !AcousticEnvironment.shared
    ) {

      AcousticEnvironment.shared =
        new (
          window.AudioContext ||
          window.webkitAudioContext
        )({
          latencyHint:
            "interactive",
        });
    }

    this.context =
      AcousticEnvironment.shared;

    /**
     * ========================================================
     * MASTER GRAPH
     * ========================================================
     */

    this.master =
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
     * ========================================================
     * FILTER
     * ========================================================
     */

    this.lowpass.type =
      "lowpass";

    this.lowpass.frequency.value =
      20000;

    this.lowpass.Q.value =
      0.707;

    /**
     * ========================================================
     * REVERB
     * ========================================================
     */

    this.reverb.buffer =
      this.generateIR(
        2.5,
        2.4
      );

    this.reverbSend.gain.value =
      0.18;

    this.reverbGain.gain.value =
      0.22;

    /**
     * ========================================================
     * LIMITER
     * ========================================================
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
     * ========================================================
     * MASTER
     * ========================================================
     */

    this.masterGain.gain.value =
      0.92;

    /**
     * ========================================================
     * DRY PATH
     * ========================================================
     */

    this.master.connect(
      this.lowpass
    );

    this.lowpass.connect(
      this.limiter
    );

    /**
     * ========================================================
     * PARALLEL REVERB SEND
     * ========================================================
     */

    this.master.connect(
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
   * Procedural Impulse Response
   * ========================================================== */

  generateIR(duration, decay) {

    const sr =
      this.context.sampleRate;

    const len =
      Math.floor(sr * duration);

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

        const t =
          i / len;

        data[i] =
          (
            Math.random() * 2 - 1
          ) *
          Math.pow(
            1 - t,
            decay
          );
      }
    }

    return ir;
  }

  /* ============================================================
   * Environmental Acoustics
   * ========================================================== */

  updateAcoustics() {

    const enclosure =
      WorldState.snapshot()
        .listener.enclosure;

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

  getInputBus() {
    return this.master;
  }
}

/* ============================================================
 * ParticleRainSynth
 * ========================================================== */

/**
 * AAA-grade procedural rain engine.
 *
 * ------------------------------------------------------------
 * COMPONENTS
 * ------------------------------------------------------------
 *
 * 1. Atmospheric Rain Bed
 *    - filtered pink-ish noise
 *
 * 2. Stochastic Droplet Particles
 *    - stereo scattered
 *    - low resonance
 *    - varied surface spectra
 *
 * ------------------------------------------------------------
 * IMPORTANT FIXES
 * ------------------------------------------------------------
 *
 * FIXED:
 * - "peeing into microphone" resonance
 * - mono center collapse
 * - harsh resonant ringing
 *
 * ADDED:
 * - wide stereo field
 * - low-Q droplets
 * - surface diversity
 * - atmospheric wash layer
 */
export class ParticleRainSynth {

  constructor(environment) {

    this.environment =
      environment;

    this.context =
      environment.context;

    /**
     * ========================================================
     * OUTPUT
     * ========================================================
     */

    this.output =
      this.context.createGain();

    this.output.gain.value = 0;

    this.output.connect(
      environment.getInputBus()
    );

    /**
     * ========================================================
     * STATE
     * ========================================================
     */

    this.intensity = 0;

    this.running = true;

    this.currentDensityMs =
      800;

    /**
     * ========================================================
     * ATMOSPHERIC RAIN BED
     * ========================================================
     */

    this.noiseSource =
      this.context
        .createBufferSource();

    this.noiseFilter =
      this.context
        .createBiquadFilter();

    this.noiseGain =
      this.context
        .createGain();

    this.noiseSource.buffer =
      this._createNoiseBuffer();

    this.noiseSource.loop =
      true;

    this.noiseFilter.type =
      "lowpass";

    this.noiseFilter.frequency.value =
      700;

    this.noiseFilter.Q.value =
      0.2;

    this.noiseGain.gain.value =
      0;

    /**
     * Routing
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

    this.noiseSource.start();

    /**
     * Start particle scheduler
     */

    this._loop();
  }

  /* ============================================================
   * Noise Generation
   * ========================================================== */

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
       * Pink-ish smoothing
       */

      last =
        (0.985 * last) +
        (0.015 * white);

      data[i] =
        last * 0.92;
    }

    return buffer;
  }

  /* ============================================================
   * Intensity Morphing
   * ========================================================== */

  update(intensity) {

    this.intensity =
      clamp(intensity, 0, 1);

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * ATMOSPHERIC BED
     * ========================================================
     */

    const hissGain =
      Math.pow(
        this.intensity,
        1.4
      ) * 0.34;

    const hissCutoff =
      700 +
      (this.intensity * 5600);

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
     */

    this.currentDensityMs =
      Math.max(
        16,
        850 -
        (this.intensity * 825)
      );

    /**
     * ========================================================
     * MASTER OUTPUT
     * ========================================================
     */

    const master =
      Math.pow(
        this.intensity,
        1.15
      );

    this.output.gain
      .setTargetAtTime(
        master,
        now,
        0.08
      );
  }

  /* ============================================================
   * Particle Synthesis
   * ========================================================== */

  _spawnDrop() {

    if (
      this.intensity <= 0.001
    ) {
      return;
    }

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * IMPULSE BUFFER
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

    for (let i = 0; i < 512; i++) {

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
     */

    filter.type =
      "bandpass";

    /**
     * Wide spectrum:
     * leaves / roofs / puddles / fabric
     */

    filter.frequency.value =
      random(
        300,
        6000
      );

    /**
     * LOW Q
     * removes liquid resonance
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
     * GAIN MODEL
     * ========================================================
     *
     * Heavy rain:
     * softer droplets
     * blending into hiss bed
     */

    const dropGain =
      (
        0.05 +
        ((1 - this.intensity) * 0.07)
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

    gain.gain.linearRampToValueAtTime(
      dropGain,
      now + 0.002
    );

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
     * Heavy rain:
     * multiple simultaneous impacts
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
       * Temporal jitter
       * avoids robotic timing
       */

      setTimeout(
        () => this._spawnDrop(),
        Math.random() * 12
      );
    }

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

    /**
     * Pitch variance
     */

    src.playbackRate.value =
      random(
        0.92,
        1.08
      );

    /**
     * Spatialization
     */

    pan.pan.value =
      random(
        -1,
        1
      );

    /**
     * Ecological activity scaling
     */

    gain.gain.value =
      this.baseVolume *
      rules.activityMultiplier;

    /**
     * Routing
     */

    src.connect(pan);

    pan.connect(gain);

    gain.connect(
      this.environment
        .getInputBus()
    );

    /**
     * Playback
     */

    src.start();

    /**
     * Cleanup
     */

    src.onended = () => {

      safeDisconnect(src);
      safeDisconnect(pan);
      safeDisconnect(gain);
    };
  }
}
