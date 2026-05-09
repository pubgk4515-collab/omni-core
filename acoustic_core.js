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

export class ParticleRainSynth {

  constructor(environment) {

    this.environment =
      environment;

    this.context =
      environment.context;

    this.output =
      this.context.createGain();

    this.output.gain.value = 0;

    this.output.connect(
      environment.getInputBus()
    );

    this.intensity = 0;

    this.running = true;

    this._loop();
  }

  update(intensity) {

    this.intensity =
      intensity;

    this.output.gain
      .setTargetAtTime(
        intensity,
        this.context.currentTime,
        0.08
      );
  }

  _spawnDrop() {

    const now =
      this.context.currentTime;

    /**
     * Tiny noise burst.
     */

    const buffer =
      this.context.createBuffer(
        1,
        256,
        this.context.sampleRate
      );

    const data =
      buffer.getChannelData(0);

    for (let i = 0; i < 256; i++) {
      data[i] =
        (Math.random() * 2 - 1) *
        Math.exp(-i / 40);
    }

    const src =
      this.context
        .createBufferSource();

    src.buffer = buffer;

    const filter =
      this.context
        .createBiquadFilter();

    filter.type =
      "bandpass";

    filter.frequency.value =
      random(
        900,
        4500
      );

    filter.Q.value =
      random(
        2,
        12
      );

    const gain =
      this.context
        .createGain();

    /**
     * Real droplet envelope.
     */

    gain.gain.setValueAtTime(
      0,
      now
    );

    gain.gain.linearRampToValueAtTime(
      random(0.04, 0.12),
      now + 0.002
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + random(0.03, 0.12)
    );

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);

    src.start(now);

    src.stop(now + 0.2);

    src.onended = () => {

      safeDisconnect(src);
      safeDisconnect(filter);
      safeDisconnect(gain);
    };
  }

  _loop() {

    if (!this.running) {
      return;
    }

    /**
     * Higher intensity =
     * faster droplet density.
     */

    const density =
      Math.max(
        40,
        1000 -
        (this.intensity * 940)
      );

    this._spawnDrop();

    setTimeout(
      () => this._loop(),
      density
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
