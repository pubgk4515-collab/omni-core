/**
 * expert_rain.js
 * Symbiote Acoustic MoE World Simulator
 *
 * ------------------------------------------------------------
 * RAIN EXPERT
 * ------------------------------------------------------------
 *
 * Specialized procedural droplet synthesis module.
 *
 * Responsibilities:
 * - procedural micro-droplet synthesis
 * - stochastic rainfall scheduling
 * - spatial stereo scatter
 * - UI generation
 * - runtime lifecycle cleanup
 *
 * ------------------------------------------------------------
 * IMPORTANT DESIGN NOTES
 * ------------------------------------------------------------
 *
 * NO continuous hiss.
 * NO looping MP3.
 *
 * Only:
 * - procedural impacts
 * - short transient droplets
 * - broad low-Q resonances
 *
 * This avoids:
 * - tonal ringing
 * - "peeing into microphone" artifacts
 * - synthetic metallic resonance
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
   * @param {AudioNode} masterInputBus
   */
  constructor(
    audioContext,
    masterInputBus
  ) {

    /**
     * Runtime identity.
     */

    this.id =
      crypto.randomUUID();

    /**
     * DSP refs.
     */

    this.context =
      audioContext;

    this.masterInputBus =
      masterInputBus;

    /**
     * Runtime state.
     */

    this.running = true;

    /**
     * Atmospheric pressure.
     *
     * 0 → calm
     * 1 → storm
     */

    this.pressure = 0.35;

    /**
     * User density multiplier.
     */

    this.density = 1;

    /**
     * Timeout tracking.
     */

    this.timeoutId = null;

    /**
     * Active nodes for cleanup.
     */

    this.activeNodes =
      new Set();

    /**
     * Expert output bus.
     */

    this.output =
      this.context.createGain();

    this.output.gain.value =
      0.72;

    this.output.connect(
      this.masterInputBus
    );

    /**
     * Begin scheduler.
     */

    this._schedule();
  }

  /* ============================================================
   * World State
   * ========================================================== */

  /**
   * Receives state updates.
   *
   * @param {object} worldState
   */
  onStateUpdate(
    worldState
  ) {

    this.pressure =
      clamp(
        worldState
          ?.atmosphericPressure ?? 0,
        0,
        1
      );
  }

  /* ============================================================
   * UI Template
   * ========================================================== */

  /**
   * Returns exact expert-card skeleton.
   *
   * IMPORTANT:
   * Includes:
   * - data-id
   * - remove button
   *
   * @returns {string}
   */
  getUICard() {

    return `
      <article
        class="expert-card glass"
        data-id="${this.id}"
      >

        <div class="expert-header">

          <div>

            <div class="expert-title">
              Rain Expert
            </div>

            <div class="expert-subtitle">
              Procedural Atmosphere Module
            </div>

          </div>

          <div class="expert-badge">
            Active
          </div>

        </div>

        <div class="expert-controls">

          <div class="control">

            <div class="control-top">

              <div class="label">
                Droplet Density
              </div>

              <div
                class="value density-value"
              >
                1.00
              </div>

            </div>

            <input
              type="range"
              class="density-slider"
              min="0.2"
              max="2"
              step="0.01"
              value="1"
            />

          </div>

        </div>

        <button
          class="remove-btn"
        >
          Remove Expert
        </button>

      </article>
    `;
  }

  /* ============================================================
   * UI Binding
   * ========================================================== */

  /**
   * Bind local UI controls.
   *
   * @param {HTMLElement} card
   */
  bindCardControls(card) {

    const slider =
      card.querySelector(
        ".density-slider"
      );

    const value =
      card.querySelector(
        ".density-value"
      );

    if (!slider) {
      return;
    }

    slider.addEventListener(
      "input",
      () => {

        const v =
          Number(slider.value);

        this.density = v;

        value.textContent =
          v.toFixed(2);
      }
    );
  }

  /* ============================================================
   * Droplet Synthesis
   * ========================================================== */

  /**
   * Creates one procedural droplet.
   *
   * DSP FLOW:
   *
   * Noise Burst
   * → Bandpass
   * → Stereo Panner
   * → Envelope
   * → Master Bus
   */
  _spawnDrop() {

    if (!this.running) {
      return;
    }

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * Tiny stochastic burst
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
     * Fast decaying noise.
     */

    for (
      let i = 0;
      i < 256;
      i++
    ) {

      const noise =
        (
          Math.random() * 2
        ) - 1;

      const envelope =
        Math.exp(
          -i /
          random(18, 42)
        );

      data[i] =
        noise * envelope;
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
     */

    const filter =
      this.context
        .createBiquadFilter();

    filter.type =
      "bandpass";

    /**
     * Broad material spectrum.
     */

    filter.frequency.value =
      random(
        300,
        6200
      );

    /**
     * CRITICAL:
     * LOW resonance.
     */

    filter.Q.value =
      random(
        0.1,
        1.5
      );

    /**
     * ========================================================
     * Spatial Scatter
     * ========================================================
     */

    const panner =
      this.context
        .createStereoPanner();

    panner.pan.value =
      random(-1, 1);

    /**
     * ========================================================
     * Envelope
     * ========================================================
     */

    const gain =
      this.context
        .createGain();

    /**
     * Storm density:
     * more droplets
     * but softer individuals.
     */

    const volume =
      0.12 -
      (
        this.pressure * 0.05
      );

    const attack =
      random(
        0.001,
        0.004
      );

    const decay =
      random(
        0.03,
        0.11
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

    source.connect(filter);

    filter.connect(panner);

    panner.connect(gain);

    gain.connect(
      this.output
    );

    /**
     * Track nodes.
     */

    this.activeNodes.add(
      source
    );

    this.activeNodes.add(
      filter
    );

    this.activeNodes.add(
      panner
    );

    this.activeNodes.add(
      gain
    );

    /**
     * ========================================================
     * Playback
     * ========================================================
     */

    source.start(now);

    source.stop(
      now + decay + 0.05
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

      this.activeNodes.delete(
        source
      );

      this.activeNodes.delete(
        filter
      );

      this.activeNodes.delete(
        panner
      );

      this.activeNodes.delete(
        gain
      );
    };
  }

  /* ============================================================
   * Scheduler
   * ========================================================== */

  /**
   * Recursive stochastic scheduler.
   */
  _schedule() {

    if (!this.running) {
      return;
    }

    /**
     * Storm intensity.
     */

    const intensity =
      this.pressure *
      this.density;

    /**
     * Burst count.
     */

    const burstCount =
      Math.floor(
        1 +
        (
          intensity * 4
        )
      );

    for (
      let i = 0;
      i < burstCount;
      i++
    ) {

      /**
       * Probabilistic spawning.
       */

      if (
        Math.random() <
        (
          0.24 +
          intensity
        )
      ) {

        this._spawnDrop();
      }
    }

    /**
     * Higher pressure:
     * faster scheduling.
     */

    const nextInterval =
      240 -
      (
        intensity * 210
      );

    this.timeoutId =
      setTimeout(
        () => this._schedule(),
        clamp(
          nextInterval,
          18,
          240
        )
      );
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  /**
   * Full teardown.
   */
  destroy() {

    this.running = false;

    /**
     * Stop scheduler.
     */

    if (this.timeoutId) {

      clearTimeout(
        this.timeoutId
      );

      this.timeoutId = null;
    }

    /**
     * Disconnect active nodes.
     */

    for (
      const node
      of this.activeNodes
    ) {

      safeDisconnect(node);
    }

    this.activeNodes.clear();

    safeDisconnect(
      this.output
    );
  }
}
