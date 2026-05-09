/**
 * app.js
 * Symbiote Engine
 * Main Integration Layer
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * - Engine bootstrap
 * - Dynamic runtime injection
 * - UI ↔ WorldState synchronization
 * - Expert registration
 * - MoE Router orchestration
 *
 * ------------------------------------------------------------
 * CRITICAL FEATURE
 * ------------------------------------------------------------
 *
 * Dynamic Runtime Injection:
 *
 * User pastes ES6 module code
 * ↓
 * Blob created
 * ↓
 * Runtime import()
 * ↓
 * Expert instantiated
 * ↓
 * Expert registered
 * ↓
 * UI card appended
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * Audio engine safely initializes
 * on FIRST user interaction.
 *
 * Prevents:
 * - null context
 * - suspended mobile audio
 * - race conditions
 */

import {
  WorldState,
  MoERouter,
  ENCLOSURE_TYPES,
} from "./world_brain.js";

import {
  MasterAcousticBus,
} from "./acoustic_bus.js";

/* ============================================================
 * DOM
 * ========================================================== */

const enclosureSelect =
  document.querySelector(
    "select"
  );

const pressureSlider =
  document.getElementById(
    "pressureSlider"
  );

const pressureValue =
  document.getElementById(
    "pressureValue"
  );

const addExpertBtn =
  document.getElementById(
    "addExpertBtn"
  );

const sheetOverlay =
  document.getElementById(
    "sheetOverlay"
  );

const layersContainer =
  document.querySelector(
    ".rack"
  );

/* ============================================================
 * Runtime
 * ========================================================== */

let bus = null;

let router = null;

let initialized =
  false;

let initializing =
  false;

/**
 * Active experts.
 */
const experts = [];

/* ============================================================
 * Engine Initialization
 * ========================================================== */

/**
 * Safe bootstrap.
 *
 * Triggered by:
 * - sliders
 * - add expert
 * - any user gesture
 */
async function initEngine() {

  /**
   * Already initialized.
   */

  if (initialized) {

    /**
     * Mobile browsers
     * may suspend context.
     */

    if (
      bus?.context?.state ===
      "suspended"
    ) {

      await bus.context
        .resume();
    }

    return;
  }

  /**
   * Prevent parallel init.
   */

  if (initializing) {

    await waitForInit();

    return;
  }

  initializing = true;

  try {

    /**
     * ========================================================
     * Master Bus
     * ========================================================
     */

    bus =
      new MasterAcousticBus();

    await bus.init();

    /**
     * ========================================================
     * Router
     * ========================================================
     */

    router =
      new MoERouter();

    /**
     * ========================================================
     * Initial State Broadcast
     * ========================================================
     */

    router.broadcastState(
      WorldState.snapshot()
    );

    initialized = true;

    console.log(
      "[App] Symbiote Engine initialized."
    );

  } catch (err) {

    console.error(
      "[App] Engine init failed:",
      err
    );

  } finally {

    initializing = false;
  }
}

/* ============================================================
 * Init Wait Helper
 * ========================================================== */

async function waitForInit() {

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
 * Global State Controls
 * ========================================================== */

/**
 * Atmospheric Pressure
 */

pressureSlider.addEventListener(
  "input",
  async (e) => {

    /**
     * FIRST USER GESTURE
     */

    await initEngine();

    const value =
      Number(e.target.value);

    /**
     * UI feedback.
     */

    pressureValue.textContent =
      value.toFixed(2);

    /**
     * Update WorldState.
     */

    WorldState
      .setAtmosphericPressure(
        value
      );

    /**
     * Broadcast to experts.
     */

    router.broadcastState(
      WorldState.snapshot()
    );
  }
);

/**
 * Enclosure
 */

enclosureSelect.addEventListener(
  "change",
  async (e) => {

    /**
     * FIRST USER GESTURE
     */

    await initEngine();

    const enclosure =
      e.target.value;

    /**
     * Update WorldState.
     */

    WorldState.setEnclosure(
      enclosure
    );

    /**
     * Broadcast.
     */

    const snapshot =
      WorldState.snapshot();

    router.broadcastState(
      snapshot
    );

    /**
     * Update acoustics.
     */

    bus.updateAcoustics(
      snapshot
    );
  }
);

/* ============================================================
 * Add Expert
 * ========================================================== */

addExpertBtn.addEventListener(
  "click",
  async () => {

    /**
     * FIRST USER GESTURE
     */

    await initEngine();

    /**
     * Show existing sheet.
     */

    sheetOverlay.classList.add(
      "open"
    );

    /**
     * Runtime code injection.
     */

    const pastedCode =
      prompt(
        "Paste Expert Module Code (ES6)"
      );

    /**
     * User cancelled.
     */

    if (
      !pastedCode ||
      !pastedCode.trim()
    ) {

      return;
    }

    try {

      /**
       * ======================================================
       * Dynamic Blob Module
       * ======================================================
       */

      const blob =
        new Blob(
          [pastedCode],
          {
            type:
              "application/javascript",
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      /**
       * Dynamic runtime import.
       */

      const module =
        await import(url);

      /**
       * Cleanup blob URL.
       */

      URL.revokeObjectURL(
        url
      );

      /**
       * Validate default export.
       */

      if (
        typeof module.default !==
        "function"
      ) {

        throw new Error(
          "Module must export default class."
        );
      }

      /**
       * ======================================================
       * Expert Instantiation
       * ======================================================
       */

      const expert =
        new module.default(
          bus.context,
          bus.getInputBus()
        );

      /**
       * ======================================================
       * Register Expert
       * ======================================================
       */

      router.registerExpert(
        expert
      );

      experts.push(
        expert
      );

      /**
       * ======================================================
       * Hydrate immediately
       * ======================================================
       */

      if (
        typeof expert
          .onStateUpdate ===
        "function"
      ) {

        expert.onStateUpdate(
          WorldState.snapshot()
        );
      }

      /**
       * ======================================================
       * UI Card
       * ======================================================
       */

      appendExpertCard(
        expert
      );

      console.log(
        "[App] Expert injected:",
        expert.name ||
        expert.constructor.name
      );

    } catch (err) {

      console.error(
        "[App] Dynamic injection failed:",
        err
      );

      alert(
        "Failed to inject expert.\nCheck console."
      );
    }
  }
);

/* ============================================================
 * Dynamic Expert Card
 * ========================================================== */

/**
 * Appends runtime UI card.
 *
 * @param {object} expert
 */
function appendExpertCard(
  expert
) {

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "expert-card glass";

  card.innerHTML = `
    <div class="expert-top">

      <div>

        <div class="expert-name">
          ${
            expert.name ||
            "Injected Expert"
          }
        </div>

        <div class="expert-type">
          Runtime Injected Module
        </div>

      </div>

      <div class="badge">
        Active
      </div>

    </div>

    <div class="control">

      <div class="control-top">

        <div class="label">
          Local Density
        </div>

        <div class="value">
          1.00
        </div>

      </div>

      <input
        type="range"
        min="0.1"
        max="2"
        step="0.01"
        value="1"
      />

    </div>
  `;

  /**
   * Optional local parameter control.
   */

  const slider =
    card.querySelector(
      "input"
    );

  const value =
    card.querySelector(
      ".value"
    );

  slider.addEventListener(
    "input",
    (e) => {

      const v =
        Number(e.target.value);

      value.textContent =
        v.toFixed(2);

      /**
       * Route to expert.
       */

      if (
        typeof expert
          .setLocalParameter ===
        "function"
      ) {

        expert.setLocalParameter(
          "density",
          v
        );
      }
    }
  );

  layersContainer.appendChild(
    card
  );
}

/* ============================================================
 * Bottom Sheet Close
 * ========================================================== */

sheetOverlay.addEventListener(
  "click",
  (e) => {

    if (
      e.target ===
      sheetOverlay
    ) {

      sheetOverlay.classList.remove(
        "open"
      );
    }
  }
);

/* ============================================================
 * Initial Defaults
 * ========================================================== */

WorldState.setEnclosure(
  ENCLOSURE_TYPES.OPEN
);

WorldState
  .setAtmosphericPressure(
    Number(
      pressureSlider.value
    )
  );
