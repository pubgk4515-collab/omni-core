/**
 * factory_ui.js
 * Phase 4 — Auto-Director UI Logic
 *
 * ------------------------------------------------------------
 * Responsibilities
 * ------------------------------------------------------------
 * - Initialize AtmosphereEngine
 * - Create core layers
 * - Initialize EcologyController
 * - Initialize WasmLayerAdapter
 * - Drive generative environment mutations
 * - Connect UI controls to audio graph
 *
 * No UI framework.
 * Pure ES6 orchestration layer.
 */

import AtmosphereEngine from "./atmosphere_core.js";
import EcologyController from "./ecology_controller.js";
import WasmLayerAdapter from "./wasm_adapter.js";

/* ============================================================
 * DOM References
 * ========================================================== */

const generateBtn = document.getElementById("generateBtn");

const scaleText = document.getElementById("scaleText");
const ecologyText = document.getElementById("ecologyText");

const masterSlider = document.getElementById("masterSlider");
const reverbSlider = document.getElementById("reverbSlider");

const masterValue = document.getElementById("masterValue");
const reverbValue = document.getElementById("reverbValue");

/* ============================================================
 * Global Runtime
 * ========================================================== */

let engine = null;
let ecology = null;
let wasmAdapter = null;

let initialized = false;

/**
 * Main ecological spawner.
 */
let eventSpawner = null;

/**
 * Human-readable scales.
 */
const SCALE_NAMES = [
  "Aeolian Drift",
  "Submerged Minor",
  "Solar Hymnal",
];

/* ============================================================
 * Utility Helpers
 * ========================================================== */

/**
 * Random float.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Random integer.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

/**
 * Random array item.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function randomChoice(arr) {
  return arr[
    Math.floor(Math.random() * arr.length)
  ];
}

/* ============================================================
 * Initialization
 * ========================================================== */

/**
 * Initializes full audio ecosystem.
 *
 * IMPORTANT:
 * Must be called from user interaction.
 */
async function initializeFactory() {

  if (initialized) {
    return;
  }

  try {

    /**
     * --------------------------------------------------------
     * Engine
     * --------------------------------------------------------
     */
    engine = new AtmosphereEngine({
      masterGain: 0.8,
    });

    await engine.init();

    /**
     * --------------------------------------------------------
     * Core Layers
     * --------------------------------------------------------
     */
    const droneLayer = engine.createLayer(
      "drone_layer",
      "procedural_drone",
      {
        volume: 0.55,
        pan: 0,
        filterFreq: 1200,
        reverbSend: 0.4,
      }
    );

    const windLayer = engine.createLayer(
      "wind_layer",
      "wind",
      {
        volume: 0.35,
        pan: 0,
        filterFreq: 4000,
        reverbSend: 0.55,
      }
    );

    const eventLayer = engine.createLayer(
      "event_layer",
      "ecology_events",
      {
        volume: 0.8,
        pan: 0,
        filterFreq: 18000,
        reverbSend: 0.7,
      }
    );

    /**
     * --------------------------------------------------------
     * Ecology Controller
     * --------------------------------------------------------
     */
    ecology = new EcologyController(engine, {
      tickRateMs: 1200,
    });

    /**
     * Placeholder ecological event spawner.
     *
     * Assumes local files exist:
     * - thunder.mp3
     * - bird.mp3
     */
    eventSpawner = ecology.registerSpawner({
      layerId: "event_layer",

      sampleUrls: [
        "./bird.mp3",
        "./thunder.mp3",
      ],

      probability: 0.18,

      minDelay: 3,
      maxDelay: 10,

      volumeRange: [0.35, 1.0],

      panRange: [-0.9, 0.9],

      pitchRange: [0.85, 1.15],
    });

    /**
     * Optional preload.
     */
    ecology.preloadAll().catch(() => {
      console.warn(
        "[FactoryUI] Sample preload skipped."
      );
    });

    /**
     * --------------------------------------------------------
     * Wasm Adapter
     * --------------------------------------------------------
     */
    wasmAdapter = new WasmLayerAdapter(
      engine,
      "drone_layer",
      {
        wasmUrl: "./dsp_engine.wasm",
      }
    );

    await wasmAdapter.init();

    /**
     * Initial DSP params.
     */
    wasmAdapter.setWasmParam(0, 0.08);
    wasmAdapter.setWasmParam(5, 0.04);

    /**
     * --------------------------------------------------------
     * Start Ecology
     * --------------------------------------------------------
     */
    ecology.start();

    /**
     * --------------------------------------------------------
     * Wind Layer Placeholder
     * --------------------------------------------------------
     *
     * Future:
     * - noise worklet
     * - granular texture
     * - filtered procedural air
     */
    windLayer.setVolume(0.25);

    initialized = true;

    ecologyText.textContent = "Evolving";

  } catch (err) {

    console.error(
      "[FactoryUI] Initialization failed:",
      err
    );

    ecologyText.textContent = "Initialization Error";
  }
}

/* ============================================================
 * Environment Generator
 * ========================================================== */

/**
 * Creates a brand-new ecosystem state.
 *
 * This is the "Auto Director".
 */
async function generateUniqueEnvironment() {

  /**
   * Ensure first interaction unlocks audio.
   */
  if (!initialized) {
    await initializeFactory();
  }

  if (!engine || !ecology || !wasmAdapter) {
    return;
  }

  const droneLayer =
    engine.getLayer("drone_layer");

  const windLayer =
    engine.getLayer("wind_layer");

  const eventLayer =
    engine.getLayer("event_layer");

  /**
   * --------------------------------------------------------
   * SCALE RANDOMIZATION
   * --------------------------------------------------------
   */
  const scaleId = randomInt(0, 2);

  wasmAdapter.setDroneScale(scaleId);

  scaleText.textContent =
    SCALE_NAMES[scaleId];

  /**
   * --------------------------------------------------------
   * DRONE MOOD
   * --------------------------------------------------------
   */
  const droneHeavy =
    Math.random() > 0.5;

  if (droneHeavy) {

    droneLayer.setVolume(
      randomRange(0.55, 0.95),
      1.5
    );

    droneLayer.setFilter(
      randomRange(250, 900),
      randomRange(0.5, 4.0)
    );

    wasmAdapter.setWasmParam(
      0,
      randomRange(0.06, 0.12)
    );

  } else {

    droneLayer.setVolume(
      randomRange(0.15, 0.4),
      1.5
    );

    droneLayer.setFilter(
      randomRange(1800, 7000),
      randomRange(0.3, 1.5)
    );

    wasmAdapter.setWasmParam(
      0,
      randomRange(0.02, 0.06)
    );
  }

  /**
   * --------------------------------------------------------
   * WIND CHARACTER
   * --------------------------------------------------------
   */
  const windDominant =
    Math.random() > 0.5;

  if (windDominant) {

    windLayer.setVolume(
      randomRange(0.4, 0.8),
      2.0
    );

    windLayer.setFilter(
      randomRange(2500, 9000),
      randomRange(0.2, 1.5)
    );

  } else {

    windLayer.setVolume(
      randomRange(0.08, 0.28),
      2.0
    );

    windLayer.setFilter(
      randomRange(700, 2400),
      randomRange(1.0, 5.0)
    );
  }

  /**
   * --------------------------------------------------------
   * ECOLOGICAL CHAOS PROFILE
   * --------------------------------------------------------
   */
  const ecologyModes = [

    {
      label: "Sparse Wilderness",

      probability: 0.05,
      minDelay: 8,
      maxDelay: 20,
    },

    {
      label: "Active Biosphere",

      probability: 0.18,
      minDelay: 2,
      maxDelay: 8,
    },

    {
      label: "Stormfront",

      probability: 0.32,
      minDelay: 1,
      maxDelay: 4,
    },

  ];

  const ecologyProfile =
    randomChoice(ecologyModes);

  eventSpawner.probability =
    ecologyProfile.probability;

  eventSpawner.minDelay =
    ecologyProfile.minDelay;

  eventSpawner.maxDelay =
    ecologyProfile.maxDelay;

  ecologyText.textContent =
    ecologyProfile.label;

  /**
   * --------------------------------------------------------
   * EVENT LAYER TEXTURE
   * --------------------------------------------------------
   */
  eventLayer.setVolume(
    randomRange(0.35, 1.0),
    1.0
  );

  eventLayer.setFilter(
    randomRange(1200, 18000),
    randomRange(0.3, 2.0)
  );

  /**
   * --------------------------------------------------------
   * GLOBAL REVERB FEEL
   * --------------------------------------------------------
   */
  const globalWet =
    randomRange(0.2, 0.85);

  reverbSlider.value = globalWet;
  updateReverb(globalWet);
}

/* ============================================================
 * UI Bindings
 * ========================================================== */

/**
 * Master Volume
 */
function updateMasterVolume(value) {

  if (!engine) return;

  const numeric = Number(value);

  engine.setMasterGain(numeric, 0.05);

  masterValue.textContent =
    `${Math.round(numeric * 100)}%`;
}

/**
 * Reverb Wetness
 */
function updateReverb(value) {

  if (!engine) return;

  const numeric = Number(value);

  const drone =
    engine.getLayer("drone_layer");

  const wind =
    engine.getLayer("wind_layer");

  const event =
    engine.getLayer("event_layer");

  drone?.setReverbSend(
    numeric * 0.6,
    0.3
  );

  wind?.setReverbSend(
    numeric * 0.9,
    0.3
  );

  event?.setReverbSend(
    numeric,
    0.3
  );

  reverbValue.textContent =
    `${Math.round(numeric * 100)}%`;
}

/* ============================================================
 * Event Listeners
 * ========================================================== */

generateBtn.addEventListener(
  "click",
  async () => {

    generateBtn.disabled = true;

    try {

      await generateUniqueEnvironment();

    } finally {

      setTimeout(() => {
        generateBtn.disabled = false;
      }, 250);
    }
  }
);

masterSlider.addEventListener(
  "input",
  (e) => {
    updateMasterVolume(e.target.value);
  }
);

reverbSlider.addEventListener(
  "input",
  (e) => {
    updateReverb(e.target.value);
  }
);

/* ============================================================
 * Initial UI State
 * ========================================================== */

masterValue.textContent =
  `${Math.round(
    Number(masterSlider.value) * 100
  )}%`;

reverbValue.textContent =
  `${Math.round(
    Number(reverbSlider.value) * 100
  )}%`;
