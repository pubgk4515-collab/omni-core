/**
 * app.js
 * Procedural Acoustic World Simulator
 * Studio Integration Layer
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * - UI ↔ DSP bridge
 * - Layer management
 * - Just-In-Time audio initialization
 * - Runtime ecology control
 * - Mobile-first interaction safety
 *
 * ------------------------------------------------------------
 * CRITICAL FIX
 * ------------------------------------------------------------
 *
 * Prevents race condition:
 *
 * User clicks:
 *   Add Layer -> Rain
 * BEFORE:
 *   Initialize Audio
 *
 * Previously:
 *   environment === null
 *
 * Now:
 * - automatic async initialization
 * - safe re-entry guard
 * - singleton runtime creation
 */

import {
  WorldState,
  AtomicScheduler,
  ENTITY_TYPES,
  ENCLOSURE_TYPES,
} from "./world_brain.js";

import {
  AcousticEnvironment,
  SampleBank,
  ParticleRainSynth,
  EcologicalAudioBehavior,
} from "./acoustic_core.js";

/* ============================================================
 * DOM
 * ========================================================== */

const initBtn =
  document.getElementById(
    "initBtn"
  );

const addLayerBtn =
  document.getElementById(
    "addLayerBtn"
  );

const layerModal =
  document.getElementById(
    "layerModal"
  );

const layerContainer =
  document.getElementById(
    "layerContainer"
  );

/* ============================================================
 * Runtime
 * ========================================================== */

let environment = null;

let sampleBank = null;

let scheduler = null;

/**
 * Prevent duplicate initialization.
 */
let initialized = false;

/**
 * Prevent parallel async init race.
 */
let initializing = false;

/**
 * Active runtime layers.
 */
const layers = [];

/* ============================================================
 * Initialization
 * ========================================================== */

/**
 * Initializes:
 * - AudioContext
 * - DSP Environment
 * - SampleBank
 * - Scheduler
 *
 * SAFE:
 * - idempotent
 * - re-entrant protected
 * - race-safe
 */
async function initialize() {

  /**
   * Already initialized.
   */
  if (initialized) {

    /**
     * Mobile browsers may suspend context.
     */
    if (
      environment?.context?.state ===
      "suspended"
    ) {

      await environment.context
        .resume();
    }

    return;
  }

  /**
   * Prevent concurrent init calls.
   */
  if (initializing) {

    /**
     * Wait until initialized.
     */
    await waitForInitialization();

    return;
  }

  initializing = true;

  try {

    /**
     * ========================================================
     * Acoustic Environment
     * ========================================================
     */

    environment =
      new AcousticEnvironment();

    /**
     * Explicit resume required
     * on mobile browsers.
     */

    await environment.context
      .resume();

    /**
     * ========================================================
     * SampleBank
     * ========================================================
     */

    sampleBank =
      new SampleBank(
        environment.context
      );

    /**
     * ========================================================
     * Scheduler
     * ========================================================
     */

    scheduler =
      new AtomicScheduler();

    scheduler.start();

    /**
     * ========================================================
     * Runtime State
     * ========================================================
     */

    initialized = true;

    /**
     * UI Feedback
     */

    initBtn.textContent =
      "Audio Active";

    initBtn.disabled = true;

  } catch (err) {

    console.error(
      "[App] Initialization failed:",
      err
    );

    initialized = false;

  } finally {

    initializing = false;
  }
}

/* ============================================================
 * Initialization Wait Helper
 * ========================================================== */

/**
 * Waits for async init completion.
 *
 * Prevents:
 * - duplicate contexts
 * - parallel init race
 */
async function waitForInitialization() {

  while (
    initializing &&
    !initialized
  ) {

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 16)
    );
  }
}

/* ============================================================
 * Layer Builders
 * ========================================================== */

/**
 * Adds procedural rain layer.
 *
 * CRITICAL:
 * Auto-initializes audio safely.
 */
async function addRainLayer() {

  /**
   * --------------------------------------------------------
   * JIT Initialization
   * --------------------------------------------------------
   */

  if (!initialized) {
    await initialize();
  }

  /**
   * Safety fallback.
   */

  if (!environment) {

    console.warn(
      "[App] Environment unavailable."
    );

    return;
  }

  /**
   * ========================================================
   * DSP Layer
   * ========================================================
   */

  const rain =
    new ParticleRainSynth(
      environment
    );

  layers.push(rain);

  /**
   * ========================================================
   * UI Card
   * ========================================================
   */

  const card =
    document.createElement("div");

  card.className =
    "layer-card glass";

  card.innerHTML = `
    <div class="layer-top">
      <div>
        <div class="layer-title">
          Rain
        </div>

        <div class="layer-sub">
          Procedural DSP · Forest
        </div>
      </div>
    </div>

    <div class="slider-wrap">
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value="0"
      />
    </div>
  `;

  /**
   * ========================================================
   * Slider
   * ========================================================
   */

  const slider =
    card.querySelector("input");

  slider.addEventListener(
    "input",
    (e) => {

      const value =
        Number(e.target.value);

      /**
       * DSP update.
       */

      rain.update(value);

      /**
       * World state update.
       */

      WorldState
        .setRainIntensity(value);
    }
  );

  /**
   * ========================================================
   * Mount
   * ========================================================
   */

  layerContainer.appendChild(
    card
  );
}

/**
 * Adds bird ecology layer.
 *
 * CRITICAL:
 * Auto-initializes audio safely.
 */
async function addBirdLayer() {

  /**
   * --------------------------------------------------------
   * JIT Initialization
   * --------------------------------------------------------
   */

  if (!initialized) {
    await initialize();
  }

  /**
   * Safety fallback.
   */

  if (
    !environment ||
    !sampleBank ||
    !scheduler
  ) {

    console.warn(
      "[App] Runtime unavailable."
    );

    return;
  }

  /**
   * ========================================================
   * Ecology Layer
   * ========================================================
   */

  const birds =
    new EcologicalAudioBehavior({

      entityType:
        ENTITY_TYPES.BIRDS,

      baseRate: 0.2,

      sampleUrls: [
        "./chirp.mp3",
      ],

      environment,
      sampleBank,

      baseVolume: 0.3,
    });

  scheduler.registerBehavior(
    birds
  );

  layers.push(birds);

  /**
   * ========================================================
   * UI Card
   * ========================================================
   */

  const card =
    document.createElement("div");

  card.className =
    "layer-card glass";

  card.innerHTML = `
    <div class="layer-top">
      <div>
        <div class="layer-title">
          Birds
        </div>

        <div class="layer-sub">
          Ecology · Sparrows
        </div>
      </div>
    </div>

    <div class="slider-wrap">
      <input
        type="range"
        min="0.05"
        max="1"
        step="0.01"
        value="0.2"
      />
    </div>
  `;

  /**
   * ========================================================
   * Slider
   * ========================================================
   */

  const slider =
    card.querySelector("input");

  slider.addEventListener(
    "input",
    (e) => {

      birds.baseRate =
        Number(e.target.value);
    }
  );

  /**
   * ========================================================
   * Mount
   * ========================================================
   */

  layerContainer.appendChild(
    card
  );
}

/* ============================================================
 * Modal Logic
 * ========================================================== */

/**
 * Open modal.
 */
addLayerBtn.addEventListener(
  "click",
  () => {

    layerModal.classList.add(
      "open"
    );
  }
);

/**
 * Close modal on backdrop.
 */
layerModal.addEventListener(
  "click",
  (e) => {

    if (
      e.target === layerModal
    ) {

      layerModal.classList.remove(
        "open"
      );
    }
  }
);

/* ============================================================
 * Layer Selection
 * ========================================================== */

document
  .querySelectorAll("[data-layer]")
  .forEach((btn) => {

    btn.addEventListener(
      "click",
      async () => {

        const type =
          btn.dataset.layer;

        /**
         * ----------------------------------------------------
         * Async layer creation.
         * ----------------------------------------------------
         */

        switch (type) {

          case "rain":

            await addRainLayer();

            break;

          case "birds":

            await addBirdLayer();

            break;

          case "typing":

            /**
             * Reserved future layer.
             */

            console.log(
              "[App] Typing layer not implemented yet."
            );

            break;
        }

        /**
         * Close modal.
         */

        layerModal.classList.remove(
          "open"
        );
      }
    );
  });

/* ============================================================
 * Manual Initialize Button
 * ========================================================== */

initBtn.addEventListener(
  "click",
  async () => {

    try {

      await initialize();

    } catch (err) {

      console.error(
        "[App] Init button failed:",
        err
      );
    }
  }
);

/* ============================================================
 * Acoustics Frame Loop
 * ========================================================== */

/**
 * Continuous acoustics update loop.
 *
 * Handles:
 * - enclosure filtering
 * - future environmental morphing
 * - global DSP state
 */
function frame() {

  if (environment) {

    environment
      .updateAcoustics();
  }

  requestAnimationFrame(
    frame
  );
}

/**
 * Start loop immediately.
 */
frame();

/* ============================================================
 * Default World State
 * ========================================================== */

WorldState.setRainIntensity(0);

WorldState.setEnclosure(
  ENCLOSURE_TYPES.OPEN
);
