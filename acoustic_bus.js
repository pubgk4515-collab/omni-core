/**
 * acoustic_bus.js
 * Compact MoE Acoustic World Model
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This module provides:
 *
 * - shared AudioContext
 * - master routing graph
 * - environmental acoustics
 * - reverb infrastructure
 * - limiter protection
 *
 * ------------------------------------------------------------
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 *
 * Experts NEVER connect directly
 * to AudioDestinationNode.
 *
 * ALL experts route through:
 *
 * MasterAcousticBus
 *
 * This guarantees:
 *
 * - consistent acoustics
 * - centralized control
 * - DSP safety
 * - clipping prevention
 * - enclosure simulation
 *
 * ------------------------------------------------------------
 * ROUTING
 * ------------------------------------------------------------
 *
 * DRY:
 *
 * Input
 *  -> GlobalLowPass
 *  -> Limiter
 *  -> MasterGain
 *  -> Destination
 *
 * WET:
 *
 * Input
 *  -> ReverbSend
 *  -> Convolver
 *  -> ReverbGain
 *  -> Limiter
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * Dry signal ALWAYS survives.
 *
 * Even if reverb fails,
 * audio still passes safely.
 */

import {
  ENCLOSURE_TYPES,
} from "./world_brain.js";

/* ============================================================
 * Utility
 * ========================================================== */

/**
 * Safe node disconnect.
 *
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

/* ============================================================
 * MasterAcousticBus
 * ========================================================== */

export class MasterAcousticBus {

  /**
   * Shared singleton context.
   *
   * @type {AudioContext|null}
   */
  static sharedContext = null;

  constructor() {

    /**
     * --------------------------------------------------------
     * One Context ONLY
     * --------------------------------------------------------
     */

    if (
      !MasterAcousticBus
        .sharedContext
    ) {

      const AudioContextClass =
        window.AudioContext ||
        window.webkitAudioContext;

      MasterAcousticBus
        .sharedContext =
          new AudioContextClass({

            latencyHint:
              "interactive",
          });
    }

    /**
     * Shared AudioContext.
     */

    this.context =
      MasterAcousticBus
        .sharedContext;

    /**
     * Lifecycle.
     */

    this.initialized =
      false;

    /**
     * Core buses.
     */

    this.inputBus = null;

    this.globalLowPass =
      null;

    this.reverbSend =
      null;

    this.convolver =
      null;

    this.reverbGain =
      null;

    this.limiter =
      null;

    this.masterGain =
      null;
  }

  /* ============================================================
   * Initialization
   * ========================================================== */

  /**
   * Initializes master graph.
   */
  async init() {

    if (this.initialized) {

      return this;
    }

    /**
     * ========================================================
     * Nodes
     * ========================================================
     */

    this.inputBus =
      this.context.createGain();

    this.globalLowPass =
      this.context
        .createBiquadFilter();

    this.reverbSend =
      this.context.createGain();

    this.convolver =
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
     * LowPass
     * ========================================================
     */

    this.globalLowPass.type =
      "lowpass";

    this.globalLowPass.frequency.value =
      20000;

    this.globalLowPass.Q.value =
      0.707;

    /**
     * ========================================================
     * Reverb
     * ========================================================
     */

    this.convolver.buffer =
      this.generateImpulseResponse(
        2.6,
        2.2
      );

    this.reverbSend.gain.value =
      0.18;

    this.reverbGain.gain.value =
      0.24;

    /**
     * ========================================================
     * Limiter
     * ========================================================
     */

    this.limiter.threshold.value =
      -10;

    this.limiter.knee.value =
      10;

    this.limiter.ratio.value =
      20;

    this.limiter.attack.value =
      0.003;

    this.limiter.release.value =
      0.25;

    /**
     * ========================================================
     * Master
     * ========================================================
     */

    this.masterGain.gain.value =
      0.92;

    /**
     * ========================================================
     * DRY ROUTE
     * ========================================================
     */

    this.inputBus.connect(
      this.globalLowPass
    );

    this.globalLowPass.connect(
      this.limiter
    );

    /**
     * ========================================================
     * WET ROUTE
     * ========================================================
     */

    this.inputBus.connect(
      this.reverbSend
    );

    this.reverbSend.connect(
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
     * OUTPUT
     * ========================================================
     */

    this.limiter.connect(
      this.masterGain
    );

    this.masterGain.connect(
      this.context.destination
    );

    /**
     * ========================================================
     * Mobile Safety
     * ========================================================
     */

    if (
      this.context.state ===
      "suspended"
    ) {

      await this.context
        .resume();
    }

    this.initialized = true;

    return this;
  }

  /* ============================================================
   * Impulse Response
   * ========================================================== */

  /**
   * Procedural stereo IR.
   *
   * @param {number} duration
   * @param {number} decay
   * @returns {AudioBuffer}
   */
  generateImpulseResponse(
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

    for (
      let channel = 0;
      channel < 2;
      channel++
    ) {

      const data =
        buffer.getChannelData(
          channel
        );

      for (
        let i = 0;
        i < length;
        i++
      ) {

        const envelope =
          Math.pow(
            1 - (i / length),
            decay
          );

        data[i] =
          (
            Math.random() * 2 - 1
          ) * envelope;
      }
    }

    return buffer;
  }

  /* ============================================================
   * Environmental Acoustics
   * ========================================================== */

  /**
   * Morphs enclosure acoustics.
   *
   * @param {object} worldState
   */
  updateAcoustics(
    worldState
  ) {

    if (
      !this.initialized
    ) {
      return;
    }

    const enclosure =
      worldState.enclosure;

    let cutoff = 20000;

    switch (enclosure) {

      case ENCLOSURE_TYPES.UMBRELLA:

        cutoff = 3000;

        break;

      case ENCLOSURE_TYPES.INDOOR:

        cutoff = 1800;

        break;

      case ENCLOSURE_TYPES.OPEN:
      default:

        cutoff = 20000;

        break;
    }

    /**
     * Smooth morphing.
     */

    this.globalLowPass.frequency
      .setTargetAtTime(
        cutoff,
        this.context.currentTime,
        0.08
      );
  }

  /* ============================================================
   * Input API
   * ========================================================== */

  /**
   * Shared expert input bus.
   *
   * @returns {GainNode}
   */
  getInputBus() {

    return this.inputBus;
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  /**
   * Suspends context safely.
   */
  async suspend() {

    if (
      this.context &&
      this.context.state !==
      "closed"
    ) {

      await this.context
        .suspend();
    }
  }

  /**
   * Resumes context safely.
   */
  async resume() {

    if (
      this.context &&
      this.context.state !==
      "closed"
    ) {

      await this.context
        .resume();
    }
  }

  /**
   * Full teardown.
   */
  async destroy() {

    safeDisconnect(
      this.inputBus
    );

    safeDisconnect(
      this.globalLowPass
    );

    safeDisconnect(
      this.reverbSend
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

    /**
     * Shared context intentionally
     * remains alive for runtime
     * injection architecture.
     */

    this.initialized =
      false;
  }
}
