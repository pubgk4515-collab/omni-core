/**
 * app.js
 * Final Integration Layer
 *
 * ------------------------------------------------------------
 * Responsibilities
 * ------------------------------------------------------------
 * - Initialize acoustic environment
 * - Initialize sample bank
 * - Register ecological behaviors
 * - Start stochastic scheduler
 * - Bind real-time UI controls
 * - Reflect live simulation state
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

let initialized = false;

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
     * Optional Preload
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

    /**
     * --------------------------------------------------------
     * Finalize
     * --------------------------------------------------------
     */

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
     * Update global world state.
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

    /**
     * Update world state.
     */
    WorldState.setEnclosure(
      enclosure
    );

    /**
     * Update environmental acoustics.
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
 * Initialize overlay button.
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
 * Reflects:
 * - WorldState
 * - scheduler stats
 * - ecological runtime
 */
function startVisualLoop() {

  function frame() {

    if (initialized) {

      /**
       * ------------------------------------------------------
       * World State
       * ----------------------------------------------------
       */

      const state =
        WorldState.snapshot();

      const rain =
        state.weather.rainIntensity;

      const enclosure =
        state.listener.enclosure;

      worldStateText.textContent =
        `${enclosure}`;

      worldMini.textContent =
        `Rain: ${rain.toFixed(2)} · Hour: ${state.time.hour.toFixed(1)}`;

      /**
       * ------------------------------------------------------
       * Scheduler
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
  Number(rainSlider.value)
    .toFixed(2);
