/**
 * app.js
 * Procedural Acoustic World Simulator
 *
 * ------------------------------------------------------------
 * UPDATED ARCHITECTURE
 * ------------------------------------------------------------
 *
 * FIX #1:
 * Replaced primitive rain noise with:
 * Multi-Band Stochastic Rain Engine
 *
 * Layers:
 * - Distant Rumble
 * - Mid Splatter
 * - High Hiss
 *
 * Rain intensity now changes:
 * - droplet density
 * - modulation speed
 * - spectral balance
 * - stochastic activity
 *
 * NOT just volume.
 *
 * ------------------------------------------------------------
 * FIX #2:
 * Added Just-In-Time Probability Gate
 *
 * EcologicalAudioBehavior is patched at runtime:
 * BEFORE playback starts:
 * - re-evaluate BehavioralRulesEngine
 * - abort playback instantly if probability = 0
 *
 * This prevents:
 * - birds chirping during heavy rain
 * - stale scheduled ecological events
 */

import {
  WorldState,
  AtomicScheduler,
  ENTITY_TYPES,
  ENCLOSURE_TYPES,
  BehavioralRulesEngine,
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
let rainSynth = null;

let initialized = false;

/* ============================================================
 * Utility
 * ========================================================== */

function clamp(v, min, max) {
  return Math.min(
    max,
    Math.max(min, v)
  );
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/* ============================================================
 * Multi-Band Stochastic Rain Engine
 * ========================================================== */

/**
 * Advanced procedural rain synthesizer.
 *
 * ------------------------------------------------------------
 * LAYERS
 * ------------------------------------------------------------
 *
 * 1. Distant Rumble
 *    - low-frequency body
 *    - atmospheric mass
 *
 * 2. Mid Splatter
 *    - stochastic droplet impacts
 *    - amplitude-modulated turbulence
 *
 * 3. High Hiss
 *    - fine mist
 *    - air texture
 *
 * ------------------------------------------------------------
 * INTENSITY MODEL
 * ------------------------------------------------------------
 *
 * LOW:
 * - sparse impacts
 * - muffled texture
 * - low modulation rate
 *
 * HIGH:
 * - rapid modulation
 * - wider spectrum
 * - aggressive splatter
 * - dense rainfall field
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
     * Master rain bus.
     */
    this.output =
      this.context.createGain();

    this.output.gain.value = 0;

    /**
     * --------------------------------------------------------
     * Shared Noise Buffer
     * --------------------------------------------------------
     */

    const noiseBuffer =
      this._createNoiseBuffer();

    /**
     * ========================================================
     * LAYER 1 — DISTANT RUMBLE
     * ========================================================
     */

    this.lowSource =
      this.context.createBufferSource();

    this.lowFilter =
      this.context.createBiquadFilter();

    this.lowGain =
      this.context.createGain();

    this.lowSource.buffer =
      noiseBuffer;

    this.lowSource.loop = true;

    this.lowFilter.type =
      "lowpass";

    this.lowFilter.frequency.value =
      500;

    this.lowGain.gain.value =
      0;

    /**
     * ========================================================
     * LAYER 2 — MID SPLATTER
     * ========================================================
     */

    this.midSource =
      this.context.createBufferSource();

    this.midBandpass =
      this.context.createBiquadFilter();

    this.midAMGain =
      this.context.createGain();

    this.midGain =
      this.context.createGain();

    this.midSource.buffer =
      noiseBuffer;

    this.midSource.loop = true;

    this.midBandpass.type =
      "bandpass";

    this.midBandpass.frequency.value =
      1200;

    this.midBandpass.Q.value =
      0.8;

    /**
     * ========================================================
     * Stochastic Droplet Modulation
     * ========================================================
     */

    this.modOsc =
      this.context.createOscillator();

    this.modDepth =
      this.context.createGain();

    this.modOsc.type =
      "triangle";

    this.modOsc.frequency.value =
      2;

    this.modDepth.gain.value =
      0.4;

    /**
     * ========================================================
     * LAYER 3 — HIGH HISS
     * ========================================================
     */

    this.highSource =
      this.context.createBufferSource();

    this.highHighpass =
      this.context.createBiquadFilter();

    this.highGain =
      this.context.createGain();

    this.highSource.buffer =
      noiseBuffer;

    this.highSource.loop = true;

    this.highHighpass.type =
      "highpass";

    this.highHighpass.frequency.value =
      5000;

    this.highGain.gain.value =
      0;

    /**
     * ========================================================
     * ROUTING
     * ========================================================
     */

    /**
     * Low layer
     */
    this.lowSource.connect(
      this.lowFilter
    );

    this.lowFilter.connect(
      this.lowGain
    );

    this.lowGain.connect(
      this.output
    );

    /**
     * Mid layer
     */
    this.midSource.connect(
      this.midBandpass
    );

    this.midBandpass.connect(
      this.midAMGain
    );

    this.midAMGain.connect(
      this.midGain
    );

    this.midGain.connect(
      this.output
    );

    /**
     * AM modulation
     */
    this.modOsc.connect(
      this.modDepth
    );

    this.modDepth.connect(
      this.midAMGain.gain
    );

    /**
     * High layer
     */
    this.highSource.connect(
      this.highHighpass
    );

    this.highHighpass.connect(
      this.highGain
    );

    this.highGain.connect(
      this.output
    );

    /**
     * Output
     */
    this.output.connect(
      environment.getInputBus()
    );

    /**
     * Start persistent render graph.
     */
    this.lowSource.start();
    this.midSource.start();
    this.highSource.start();
    this.modOsc.start();
  }

  /* ============================================================
   * Noise Generation
   * ========================================================== */

  /**
   * Creates long stochastic noise field.
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

    for (let i = 0; i < length; i++) {

      const white =
        Math.random() * 2 - 1;

      /**
       * Pink-ish smoothing.
       */
      last =
        (0.985 * last) +
        (0.015 * white);

      /**
       * Rare sharp droplets.
       */
      const transient =
        Math.random() > 0.992
          ? Math.random() * 1.4
          : 0;

      data[i] =
        (last * 0.85) +
        transient;
    }

    return buffer;
  }

  /* ============================================================
   * Real-Time Rain Morphing
   * ========================================================== */

  /**
   * Morphs rain ecosystem continuously.
   *
   * @param {number} intensity
   */
  update(intensity) {

    intensity =
      clamp(intensity, 0, 1);

    const now =
      this.context.currentTime;

    /**
     * ========================================================
     * MASTER DENSITY
     * ========================================================
     */

    const masterGain =
      Math.pow(
        intensity,
        1.2
      ) * 0.9;

    this.output.gain
      .setTargetAtTime(
        masterGain,
        now,
        0.08
      );

    /**
     * ========================================================
     * DISTANT RUMBLE
     * ========================================================
     */

    const lowGain =
      lerp(
        0.02,
        0.45,
        intensity
      );

    const lowCutoff =
      lerp(
        250,
        900,
        intensity
      );

    this.lowGain.gain
      .setTargetAtTime(
        lowGain,
        now,
        0.12
      );

    this.lowFilter.frequency
      .setTargetAtTime(
        lowCutoff,
        now,
        0.12
      );

    /**
     * ========================================================
     * MID SPLATTER
     * ========================================================
     *
     * Core realism layer.
     */

    const midGain =
      lerp(
        0.01,
        0.85,
        intensity
      );

    /**
     * Higher rain:
     * faster droplet impacts.
     */
    const modulationRate =
      lerp(
        1.5,
        28,
        intensity
      );

    /**
     * Heavy rain broadens
     * droplet spectrum.
     */
    const bandCenter =
      lerp(
        700,
        3200,
        intensity
      );

    /**
     * Decreasing Q widens
     * chaotic rainfall texture.
     */
    const bandQ =
      lerp(
        2.2,
        0.45,
        intensity
      );

    /**
     * More intense splatter motion.
     */
    const modDepth =
      lerp(
        0.08,
        0.95,
        intensity
      );

    this.midGain.gain
      .setTargetAtTime(
        midGain,
        now,
        0.08
      );

    this.modOsc.frequency
      .setTargetAtTime(
        modulationRate,
        now,
        0.08
      );

    this.modDepth.gain
      .setTargetAtTime(
        modDepth,
        now,
        0.08
      );

    this.midBandpass.frequency
      .setTargetAtTime(
        bandCenter,
        now,
        0.08
      );

    this.midBandpass.Q
      .setTargetAtTime(
        bandQ,
        now,
        0.08
      );

    /**
     * ========================================================
     * HIGH HISS
     * ========================================================
     */

    const highGain =
      lerp(
        0,
        0.38,
        intensity
      );

    const highCut =
      lerp(
        7000,
        2500,
        intensity
      );

    this.highGain.gain
      .setTargetAtTime(
        highGain,
        now,
        0.08
      );

    this.highHighpass.frequency
      .setTargetAtTime(
        highCut,
        now,
        0.08
      );
  }
}

/* ============================================================
 * JIT Ecological Gate Patch
 * ========================================================== */

/**
 * CRITICAL FIX:
 *
 * Prevent stale scheduled ecological events.
 *
 * Before playback:
 * - re-query world state
 * - re-evaluate ecological rules
 * - abort instantly if probability = 0
 *
 * Example:
 * - Bird scheduled 5 sec ago
 * - Rain suddenly becomes heavy
 * - Playback prevented at final moment
 */

function patchEcologicalBehavior() {

  const originalExecute =
    EcologicalAudioBehavior
      .prototype
      .onExecute;

  EcologicalAudioBehavior
    .prototype
    .onExecute =
      async function(context) {

        /**
         * ----------------------------------------------------
         * Real-time ecological re-evaluation
         * ----------------------------------------------------
         */

        const liveRules =
          BehavioralRulesEngine.evaluate(
            this.entityType,
            WorldState.snapshot()
          );

        /**
         * HARD GATE
         */
        if (
          liveRules
            ?.probabilityMultiplier <= 0
        ) {
          return;
        }

        /**
         * Continue playback.
         */
        return await originalExecute.call(
          this,
          {
            ...context,
            rules: liveRules,
          }
        );
      };
}

/* ============================================================
 * Initialization
 * ========================================================== */

async function initializeSimulation() {

  if (initialized) {
    return;
  }

  try {

    /**
     * --------------------------------------------------------
     * Environment
     * --------------------------------------------------------
     */

    environment =
      new AcousticEnvironment({
        debug: false,
      });

    await environment.init();

    await environment.resume();

    /**
     * --------------------------------------------------------
     * Rain Engine
     * --------------------------------------------------------
     */

    rainSynth =
      new ProceduralRainSynth(
        environment
      );

    /**
     * --------------------------------------------------------
     * SampleBank
     * --------------------------------------------------------
     */

    sampleBank =
      new SampleBank(
        environment.context,
        {
          debug: false,
        }
      );

    /**
     * --------------------------------------------------------
     * Patch JIT ecological gating
     * --------------------------------------------------------
     */

    patchEcologicalBehavior();

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
     * ========================================================
     * BIRDS
     * ========================================================
     */

    const birdBehavior =
      new EcologicalAudioBehavior({

        id: "bird-entity",

        entityType:
          ENTITY_TYPES.BIRDS,

        baseRate: 0.22,

        sampleUrls: [
          "./chirp1.mp3",
          "./chirp2.mp3",
        ],

        environment,
        sampleBank,

        baseVolume: 0.24,

        pitchRange: [0.92, 1.08],

        panRange: [-1, 1],

        gainVariance: 0.2,
      });

    /**
     * ========================================================
     * THUNDER
     * ========================================================
     */

    const thunderBehavior =
      new EcologicalAudioBehavior({

        id: "thunder-entity",

        entityType:
          ENTITY_TYPES.THUNDER,

        baseRate: 0.03,

        sampleUrls: [
          "./thunder.mp3",
        ],

        environment,
        sampleBank,

        baseVolume: 0.65,

        pitchRange: [0.96, 1.02],

        panRange: [-0.7, 0.7],

        gainVariance: 0.1,
      });

    /**
     * Register behaviors.
     */

    scheduler.registerBehavior(
      birdBehavior
    );

    scheduler.registerBehavior(
      thunderBehavior
    );

    /**
     * Optional preload.
     */

    sampleBank.preload([
      "./chirp1.mp3",
      "./chirp2.mp3",
      "./thunder.mp3",
    ]);

    /**
     * Start scheduler.
     */

    scheduler.start();

    /**
     * Initial acoustics.
     */

    environment
      .updateEnvironmentalAcoustics(
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

rainSlider.addEventListener(
  "input",
  (e) => {

    const value =
      Number(e.target.value);

    rainValue.textContent =
      value.toFixed(2);

    WorldState
      .setRainIntensity(value);
  }
);

enclosureSelect.addEventListener(
  "change",
  (e) => {

    const enclosure =
      e.target.value;

    WorldState
      .setEnclosure(enclosure);

    if (environment) {

      environment
        .updateEnvironmentalAcoustics(
          WorldState.snapshot()
        );
    }
  }
);

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
 * Live Simulation Loop
 * ========================================================== */

function startVisualLoop() {

  function frame() {

    if (initialized) {

      const state =
        WorldState.snapshot();

      const rain =
        state.weather
          .rainIntensity;

      /**
       * ------------------------------------------------------
       * Real-time rain synthesis
       * ----------------------------------------------------
       */

      if (rainSynth) {
        rainSynth.update(rain);
      }

      /**
       * ------------------------------------------------------
       * UI
       * ----------------------------------------------------
       */

      worldStateText.textContent =
        `${state.listener.enclosure}`;

      worldMini.textContent =
        `Rain: ${rain.toFixed(2)} · Hour: ${state.time.hour.toFixed(1)}`;

      const schedulerState =
        scheduler.getState();

      schedulerText.textContent =
        `${schedulerState.behaviorCount} Behaviors`;

      schedulerMini.textContent =
        schedulerState.behaviors
          .map((b) =>
            `${b.entityType}: ${b.totalEvents}`
          )
          .join(" · ");
    }

    requestAnimationFrame(frame);
  }

  frame();
}

/* ============================================================
 * Initial Defaults
 * ========================================================== */

WorldState.setRainIntensity(0);

WorldState.setEnclosure(
  ENCLOSURE_TYPES.OPEN
);

rainValue.textContent =
  Number(
    rainSlider.value
  ).toFixed(2);
