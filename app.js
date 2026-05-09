/**
 * app.js
 * Final Integration Layer
 *
 * ------------------------------------------------------------
 * UPDATED:
 * ------------------------------------------------------------
 * Added:
 * - ProceduralRainSynth
 * - Continuous stochastic rain generation
 * - Real-time rain morphing
 * - Rain intensity → audio synthesis mapping
 *
 * NO MP3 FILES USED FOR RAIN.
 */

import {
  WorldState,
  AtomicScheduler,
  ENTITY_TYPES,
  ENCLOSURE_TYPES,
} from "./world_state_engine.js";

import {
  AcousticEnvironment,
  SampleBank,
  EcologicalAudioBehavior,
} from "./spatial_audio_router.js";

/* ============================================================
 * DOM
 * ========================================================== */

const overlay =
  document.getElementById("overlay");

const initButton =
  document.getElementById("initButton");

const rainSlider =
  document.getElementById("rainSlider");

const rainValue =
  document.getElementById("rainValue");

const enclosureSelect =
  document.getElementById(
    "enclosureSelect"
  );

const worldStateText =
  document.getElementById(
    "worldStateText"
  );

const worldMini =
  document.getElementById(
    "worldMini"
  );

const schedulerText =
  document.getElementById(
    "schedulerText"
  );

const schedulerMini =
  document.getElementById(
    "schedulerMini"
  );

/* ============================================================
 * Runtime
 * ========================================================== */

let environment = null;
let sampleBank = null;
let scheduler = null;

/**
 * NEW:
 * Procedural rain synthesizer.
 */
let rainSynth = null;

let initialized = false;

/* ============================================================
 * Utility Helpers
 * ========================================================== */

/**
 * Clamp helper.
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
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/* ============================================================
 * ProceduralRainSynth
 * ========================================================== */

/**
 * Continuous procedural rain generator.
 *
 * ------------------------------------------------------------
 * AUDIO MODEL
 * ------------------------------------------------------------
 *
 * White/Pink-ish stochastic noise
 *        ↓
 * Lowpass Filter
 *        ↓
 * Gain
 *        ↓
 * AcousticEnvironment
 *
 * ------------------------------------------------------------
 * BEHAVIOR
 * ------------------------------------------------------------
 *
 * intensity = 0
 *   → silent
 *
 * intensity = 1
 *   → louder
 *   → brighter
 *   → sharper transient texture
 *
 * ------------------------------------------------------------
 * WHY BUFFER LOOP?
 * ------------------------------------------------------------
 *
 * - extremely CPU efficient
 * - seamless
 * - stable on mobile
 * - render-thread safe
 */
class ProceduralRainSynth {

  /**
   * @param {AcousticEnvironment} environment
   */
  constructor(environment) {

    this.environment =
      environment;

    this.context =
      environment.context;

    /**
     * Runtime nodes
     */
    this.source = null;
    this.filter = null;
    this.gain = null;

    /**
     * Internal intensity state
     */
    this.intensity = 0;

    /**
     * Initialize graph.
     */
    this._build();
  }

  /* ============================================================
   * Graph Construction
   * ========================================================== */

  /**
   * Creates:
   * - stochastic noise buffer
   * - lowpass
   * - gain
   */
  _build() {

    /**
     * --------------------------------------------------------
     * Create long stochastic noise buffer
     * --------------------------------------------------------
     */

    const bufferLength =
      this.context.sampleRate * 4;

    const buffer =
      this.context.createBuffer(
        1,
        bufferLength,
        this.context.sampleRate
      );

    const channel =
      buffer.getChannelData(0);

    /**
     * --------------------------------------------------------
     * Pink-ish noise generation
     * --------------------------------------------------------
     *
     * Uses weighted random smoothing
     * to avoid harsh white-noise hiss.
     */

    let last = 0;

    for (let i = 0; i < bufferLength; i++) {

      const white =
        Math.random() * 2 - 1;

      /**
       * Crude pink-ish filter.
       */
      last =
        (0.985 * last) +
        (0.015 * white);

      /**
       * Add micro stochastic splatter.
       */
      const droplets =
        (Math.random() ** 8) *
        (Math.random() > 0.985 ? 1 : 0);

      channel[i] =
        (last * 0.85) +
        (droplets * 0.3);
    }

    /**
     * --------------------------------------------------------
     * Source
     * --------------------------------------------------------
     */

    this.source =
      this.context.createBufferSource();

    this.source.buffer =
      buffer;

    this.source.loop = true;

    /**
     * --------------------------------------------------------
     * Filter
     * --------------------------------------------------------
     */

    this.filter =
      this.context.createBiquadFilter();

    this.filter.type =
      "lowpass";

    this.filter.frequency.value =
      400;

    this.filter.Q.value =
      0.4;

    /**
     * --------------------------------------------------------
     * Gain
     * --------------------------------------------------------
     */

    this.gain =
      this.context.createGain();

    this.gain.gain.value = 0;

    /**
     * --------------------------------------------------------
     * Routing
     * --------------------------------------------------------
     */

    this.source.connect(
      this.filter
    );

    this.filter.connect(
      this.gain
    );

    this.gain.connect(
      this.environment.getInputBus()
    );

    /**
     * --------------------------------------------------------
     * Start continuous render
     * --------------------------------------------------------
     */

    this.source.start();
  }

  /* ============================================================
   * Real-Time Morphing
   * ========================================================== */

  /**
   * Morphs rain texture continuously.
   *
   * @param {number} intensity
   */
  update(intensity) {

    intensity =
      clamp(intensity, 0, 1);

    this.intensity =
      intensity;

    const now =
      this.context.currentTime;

    /**
     * --------------------------------------------------------
     * Gain Mapping
     * --------------------------------------------------------
     *
     * Exponential-ish loudness curve.
     */

    const targetGain =
      Math.pow(intensity, 1.35) * 0.65;

    /**
     * --------------------------------------------------------
     * Filter Mapping
     * --------------------------------------------------------
     *
     * Light rain:
     *   muffled low frequencies
     *
     * Heavy rain:
     *   brighter crisp droplets
     */

    const targetCutoff =
      lerp(
        400,
        3500,
        intensity
      );

    /**
     * --------------------------------------------------------
     * Smooth Morphing
     * --------------------------------------------------------
     */

    this.gain.gain.setTargetAtTime(
      targetGain,
      now,
      0.08
    );

    this.filter.frequency.setTargetAtTime(
      targetCutoff,
      now,
      0.08
    );
  }
}

/* ============================================================
 * Initialization
 * ========================================================== */

/**
 * Creates full simulation runtime.
 */
async function initializeSimulation() {

  if (initialized) {
    return;
  }

  try {

    /**
     * --------------------------------------------------------
     * Acoustic Environment
     * --------------------------------------------------------
     */

    environment =
      new AcousticEnvironment();

    await environment.init();

    await environment.resume();

    /**
     * --------------------------------------------------------
     * NEW:
     * Procedural Rain Synth
     * --------------------------------------------------------
     */

    rainSynth =
      new ProceduralRainSynth(
        environment
      );

    /**
     * --------------------------------------------------------
     * Sample Bank
     * --------------------------------------------------------
     */

    sampleBank =
      new SampleBank(
        environment.context
      );

    /**
     * --------------------------------------------------------
     * Scheduler
     * --------------------------------------------------------
     */

    scheduler =
      new AtomicScheduler({
        tickMs: 120,
      });

    /**
     * --------------------------------------------------------
     * Bird Behavior
     * --------------------------------------------------------
     */

    const birdBehavior =
      new EcologicalAudioBehavior({

        id: "bird-entity",

        entityType:
          ENTITY_TYPES.BIRDS,

        baseRate: 0.18,

        sampleUrls: [
          "./chirp1.mp3",
          "./chirp2.mp3",
        ],

        environment,
        sampleBank,

        baseVolume: 0.22,

        pitchRange: [0.92, 1.08],

        panRange: [-1, 1],
      });

    /**
     * --------------------------------------------------------
     * Thunder Behavior
     * --------------------------------------------------------
     */

    const thunderBehavior =
      new EcologicalAudioBehavior({

        id: "thunder-entity",

        entityType:
          ENTITY_TYPES.THUNDER,

        baseRate: 0.025,

        sampleUrls: [
          "./thunder.mp3",
        ],

        environment,
        sampleBank,

        baseVolume: 0.55,

        pitchRange: [0.96, 1.02],

        panRange: [-0.7, 0.7],
      });

    /**
     * --------------------------------------------------------
     * Register Behaviors
     * --------------------------------------------------------
     */

    scheduler.registerBehavior(
      birdBehavior
    );

    scheduler.registerBehavior(
      thunderBehavior
    );

    /**
     * --------------------------------------------------------
     * Optional preload
     * --------------------------------------------------------
     */

    sampleBank.preload([
      "./chirp1.mp3",
      "./chirp2.mp3",
      "./thunder.mp3",
    ]).catch(() => {

      console.warn(
        "[App] Preload skipped."
      );
    });

    /**
     * --------------------------------------------------------
     * Start Scheduler
     * --------------------------------------------------------
     */

    scheduler.start();

    /**
     * --------------------------------------------------------
     * Initial Acoustics
     * --------------------------------------------------------
     */

    environment.updateEnvironmentalAcoustics(
      WorldState.snapshot()
    );

    initialized = true;

    overlay.classList.add(
      "hidden"
    );

    startVisualLoop();

  } catch (err) {

    console.error(
      "[App] Initialization failed:",
      err
    );
  }
}

/* ============================================================
 * UI Controls
 * ========================================================== */

/**
 * Rain slider.
 */
rainSlider.addEventListener(
  "input",
  (e) => {

    const value =
      Number(e.target.value);

    rainValue.textContent =
      value.toFixed(2);

    /**
     * Update world state.
     */
    WorldState.setRainIntensity(
      value
    );
  }
);

/**
 * Enclosure selector.
 */
enclosureSelect.addEventListener(
  "change",
  (e) => {

    const enclosure =
      e.target.value;

    WorldState.setEnclosure(
      enclosure
    );

    /**
     * Morph environment acoustics.
     */
    if (environment) {

      environment
        .updateEnvironmentalAcoustics(
          WorldState.snapshot()
        );
    }
  }
);

/**
 * Initialize overlay.
 */
initButton.addEventListener(
  "click",
  async () => {

    initButton.disabled = true;

    try {

      await initializeSimulation();

    } finally {

      setTimeout(() => {
        initButton.disabled = false;
      }, 400);
    }
  }
);

/* ============================================================
 * Live Visualization Loop
 * ========================================================== */

/**
 * requestAnimationFrame loop.
 *
 * Synchronizes:
 * - UI
 * - world state
 * - scheduler
 * - procedural rain audio
 */
function startVisualLoop() {

  function frame() {

    if (initialized) {

      /**
       * ------------------------------------------------------
       * World Snapshot
       * ----------------------------------------------------
       */

      const state =
        WorldState.snapshot();

      const rain =
        state.weather.rainIntensity;

      const enclosure =
        state.listener.enclosure;

      /**
       * ------------------------------------------------------
       * NEW:
       * Rain Synth Synchronization
       * ----------------------------------------------------
       *
       * Real-time audio morphing.
       */

      if (rainSynth) {
        rainSynth.update(rain);
      }

      /**
       * ------------------------------------------------------
       * World UI
       * ----------------------------------------------------
       */

      worldStateText.textContent =
        `${enclosure}`;

      worldMini.textContent =
        `Rain: ${rain.toFixed(2)} · Hour: ${state.time.hour.toFixed(1)}`;

      /**
       * ------------------------------------------------------
       * Scheduler UI
       * ----------------------------------------------------
       */

      const schedulerState =
        scheduler.getState();

      schedulerText.textContent =
        `${schedulerState.behaviorCount} Behaviors`;

      const behaviorSummary =
        schedulerState.behaviors
          .map((b) => {
            return `${b.entityType}: ${b.totalEvents}`;
          })
          .join(" · ");

      schedulerMini.textContent =
        behaviorSummary || "No Events";
    }

    requestAnimationFrame(frame);
  }

  frame();
}

/* ============================================================
 * Initial World Defaults
 * ========================================================== */

WorldState.setRainIntensity(0);

WorldState.setEnclosure(
  ENCLOSURE_TYPES.OPEN
);

rainValue.textContent =
  Number(
    rainSlider.value
  ).toFixed(2);
