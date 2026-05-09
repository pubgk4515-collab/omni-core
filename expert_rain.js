/**
 * expert_rain.js
 * Compact MoE Acoustic World Model
 *
 * ------------------------------------------------------------
 * RAIN EXPERT
 * ------------------------------------------------------------
 *
 * Specialized procedural rainfall module.
 *
 * This expert is:
 * - self-contained
 * - runtime injectable
 * - state reactive
 * - MoE-compatible
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * - procedural droplet synthesis
 * - stochastic rainfall timing
 * - stereo spatial scatter
 * - low-Q non-resonant impacts
 * - UI card generation
 * - WorldState responsiveness
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * NO background hiss.
 *
 * Only:
 * - distinct micro impacts
 * - scattered acoustic particles
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
 * Clamp value.
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
 * Safe disconnect helper.
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
     * DSP references.
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
     * 0.0 → calm
     * 1.0 → storm
     */

    this.pressure = 0;

    /**
     * Additional UI density multiplier.
     */

    this.userDensity = 1;

    /**
     * Scheduler interval.
     */

    this.dropInterval =
      240;

    /**
     * Master expert output.
     */

    this.output =
      this.context.createGain();

    this.output.gain.value =
      0.55;

    /**
     * Route into global bus.
     */

    this.output.connect(
      this.masterInputBus
    );

    /**
     * Begin stochastic loop.
     */

    this._loop();
  }

  /* ============================================================
   * World State
   * ========================================================== */

  /**
   * Receives state from MoERouter.
   *
   * @param {object} worldState
   */
  onStateUpdate(
    worldState
  ) {

    /**
     * Atmospheric pressure drives:
     * - density
     * - energy
     * - burst count
     */

    this.pressure =
      clamp(
        worldState
          .atmosphericPressure,
        0,
        1
      );

    /**
     * Dense storms:
     * faster droplets.
     */

    const targetInterval =
      260 -
      (
        this.pressure *
        230 *
        this.userDensity
      );

    this.dropInterval =
      clamp(
        targetInterval,
        14,
        260
      );
  }

  /* ============================================================
   * UI Card
   * ========================================================== */

  /**
   * Returns expert-specific UI.
   *
   * @returns {string}
   */
  getUICard() {

    return `
      <article
        class="expert-card glass"
        data-expert-id="${this.id}"
      >

        <div class="expert-top">

          <div>

            <div class="expert-name">
              Rain Expert
            </div>

            <div class="expert-type">
              Procedural Atmosphere Module
            </div>

          </div>

          <div class="badge">
            Active
          </div>

        </div>

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
            min="0.2"
            max="2"
            step="0.01"
            value="1"
            class="density-slider"
          />

        </div>

      </article>
    `;
  }

  /* ============================================================
   * UI Wiring
   * ========================================================== */

  /**
   * Binds card controls.
   *
   * @param {HTMLElement} element
   */
  bindUI(element) {

    const slider =
      element.querySelector(
        ".density-slider"
      );

    const value =
      element.querySelector(
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

        this.userDensity = v;

        value.textContent =
          v.toFixed(2);
      }
    );
  }

  /* ============================================================
   * Droplet Synthesis
   * ========================================================== */

  /**
   * Spawns one procedural droplet.
   *
   * IMPORTANT:
   * - random stereo pan
   * - LOW Q
   * - broad spectrum
   *
   * Prevents:
   * - resonant peeing sound
   * - tonal ringing
   */
  _spawnDrop() {

    if (
      this.pressure <= 0.001
    ) {
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
          random(20, 55)
        );
    }

    /**
     * ========================================================
     * Source
     * ========================================================
     */

    const src =
      this.context
        .createBufferSource();

    src.buffer =
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
     * Wide material spectrum.
     */

    filter.frequency.value =
      random(
        300,
        6000
      );

    /**
     * CRITICAL:
     * LOW resonance.
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
     * Heavy storms:
     * individual drops soften.
     */

    const amp =
      0.08 -
      (
        this.pressure *
        0.04
      );

    const attack =
      random(
        0.001,
        0.003
      );

    const decay =
      random(
        0.02,
        0.09
      );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.linearRampToValueAtTime(
      amp,
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

    src.connect(filter);

    filter.connect(panner);

    panner.connect(gain);

    gain.connect(
      this.output
    );

    /**
     * ========================================================
     * Playback
     * ========================================================
     */

    src.start(now);

    src.stop(
      now + decay + 0.03
    );

    /**
     * ========================================================
     * Cleanup
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
   * Scheduler
   * ========================================================== */

  /**
   * Stochastic droplet loop.
   */
  _loop() {

    if (!this.running) {
      return;
    }

    /**
     * Burst count scales
     * with storm intensity.
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

      if (
        Math.random() <
        (
          0.22 +
          this.pressure
        )
      ) {

        this._spawnDrop();
      }
    }

    setTimeout(
      () => this._loop(),
      this.dropInterval
    );
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  destroy() {

    this.running = false;

    safeDisconnect(
      this.output
    );
  }
}
