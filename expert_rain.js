/**
 * expert_rain.js
 * Symbiote Engine
 * Compact MoE Acoustic World Model
 *
 * ------------------------------------------------------------
 * RAIN EXPERT
 * ------------------------------------------------------------
 *
 * This module represents:
 *
 * - a dynamically injectable MoE expert
 * - procedural droplet synthesis
 * - stochastic rainfall particle generation
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * NO background hiss.
 *
 * ONLY:
 * - distinct impact particles
 * - randomized stereo placement
 * - randomized impact frequencies
 *
 * ------------------------------------------------------------
 * DESIGN GOALS
 * ------------------------------------------------------------
 *
 * Avoid:
 * - resonant liquid tone
 * - "peeing into microphone"
 * - center-panned fatigue
 *
 * Achieved via:
 * - low-Q filters
 * - wide stereo scatter
 * - broadband impacts
 * - randomized envelopes
 */

/* ============================================================
 * Utility
 * ========================================================== */

/**
 * Random float.
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function random(min, max) {

  return (
    Math.random() *
    (max - min)
  ) + min;
}

/**
 * Clamp helper.
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

/**
 * Safe disconnect.
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
 * RainExpert
 * ========================================================== */

export default class RainExpert {

  /**
   * @param {AudioContext} audioContext
   * @param {AudioNode} masterDestination
   */
  constructor(
    audioContext,
    masterDestination
  ) {

    if (!audioContext) {

      throw new Error(
        "[RainExpert] Missing AudioContext."
      );
    }

    if (!masterDestination) {

      throw new Error(
        "[RainExpert] Missing destination."
      );
    }

    /**
     * Stable runtime ID.
     */
    this.id =
      crypto.randomUUID();

    /**
     * Expert name.
     */
    this.name =
      "Rain Expert";

    /**
     * Audio routing.
     */
    this.context =
      audioContext;

    this.destination =
      masterDestination;

    /**
     * Runtime state.
     */
    this.running =
      true;

    /**
     * Global atmospheric intensity.
     */
    this.pressure =
      0;

    /**
     * Local density multiplier.
     */
    this.localDensity =
      1;

    /**
     * Internal timing.
     */
    this.spawnInterval =
      180;

    /**
     * Output bus.
     */
    this.output =
      this.context.createGain();

    this.output.gain.value =
      0.75;

    this.output.connect(
      this.destination
    );

    /**
     * Begin stochastic scheduler.
     */
    this._loop();
  }

  /* ============================================================
   * World State
   * ========================================================== */

  /**
   * Receives global world state.
   *
   * @param {object} worldState
   */
  onStateUpdate(
    worldState
  ) {

    /**
     * Global atmospheric pressure.
     */

    const pressure =
      clamp(
        worldState
          ?.atmosphericPressure ?? 0,
        0,
        1
      );

    this.pressure =
      pressure;

    /**
     * Density morphing.
     *
     * Heavy pressure:
     * faster droplet activity.
     */

    this.spawnInterval =
      240 -
      (
        pressure *
        220 *
        this.localDensity
      );

    /**
     * Safety clamp.
     */

    this.spawnInterval =
      clamp(
        this.spawnInterval,
        12,
        260
      );
  }

  /* ============================================================
   * Local Parameters
   * ========================================================== */

  /**
   * Expert-local controls.
   *
   * @param {string} param
   * @param {number} value
   */
  setLocalParameter(
    param,
    value
  ) {

    switch (param) {

      case "density":

        this.localDensity =
          clamp(
            value,
            0.1,
            2
          );

        break;

      case "volume":

        this.output.gain
          .setTargetAtTime(
            clamp(value, 0, 1),
            this.context.currentTime,
            0.08
          );

        break;
    }
  }

  /* ============================================================
   * Droplet Synthesis
   * ========================================================== */

  /**
   * Synthesizes one stochastic rain impact.
   */
  _spawnDrop() {

    /**
     * Silent if pressure too low.
     */

    if (
      this.pressure <= 0.01
    ) {
      return;
    }

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * Burst Buffer
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
     * Short broadband impact.
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
          -i /
          random(24, 48)
        );
    }

    /**
     * ========================================================
     * Source
     * ========================================================
     */

    const source =
      this.context
        .createBufferSource();

    source.buffer =
      buffer;

    /**
     * ========================================================
     * Filter
     * ========================================================
     *
     * LOW Q prevents:
     * - liquid whistle
     * - resonant peeing sound
     */

    const filter =
      this.context
        .createBiquadFilter();

    filter.type =
      "bandpass";

    /**
     * Surface diversity:
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
     * VERY LOW Q.
     */

    filter.Q.value =
      random(
        0.1,
        1.2
      );

    /**
     * ========================================================
     * Stereo Scatter
     * ========================================================
     */

    const panner =
      this.context
        .createStereoPanner();

    panner.pan.value =
      random(
        -1,
        1
      );

    /**
     * ========================================================
     * Envelope
     * ========================================================
     */

    const gain =
      this.context
        .createGain();

    /**
     * Heavy rain:
     * softer impacts
     * more blended field.
     */

    const volume =
      0.04 -
      (
        this.pressure * 0.018
      );

    const attack =
      random(
        0.001,
        0.003
      );

    const decay =
      random(
        0.025,
        0.09
      );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.linearRampToValueAtTime(
      volume,
      now + attack
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + decay
    );

    /**
     * ========================================================
     * Routing
     * ========================================================
     */

    source.connect(
      filter
    );

    filter.connect(
      panner
    );

    panner.connect(
      gain
    );

    gain.connect(
      this.output
    );

    /**
     * ========================================================
     * Playback
     * ========================================================
     */

    source.start(now);

    source.stop(
      now + decay + 0.04
    );

    /**
     * ========================================================
     * Cleanup
     * ========================================================
     */

    source.onended = () => {

      safeDisconnect(source);
      safeDisconnect(filter);
      safeDisconnect(panner);
      safeDisconnect(gain);
    };
  }

  /* ============================================================
   * Scheduler
   * ========================================================== */

  /**
   * Stochastic scheduling loop.
   */
  _loop() {

    if (!this.running) {
      return;
    }

    /**
     * Burst count rises
     * with pressure.
     */

    const burstCount =
      Math.floor(
        1 +
        (
          this.pressure * 4
        )
      );

    for (
      let i = 0;
      i < burstCount;
      i++
    ) {

      /**
       * Sparse stochastic gaps.
       */

      if (
        Math.random() <
        (
          0.25 +
          this.pressure
        )
      ) {

        this._spawnDrop();
      }
    }

    setTimeout(
      () => this._loop(),
      this.spawnInterval
    );
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  /**
   * Expert teardown.
   */
  destroy() {

    this.running =
      false;

    safeDisconnect(
      this.output
    );
  }
}
