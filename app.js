/**
 * app.js
 * Compact MoE Acoustic World Model
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * - UI ↔ Engine bridge
 * - Runtime expert injection
 * - Dynamic module loading
 * - Global state propagation
 * - Safe engine initialization
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * Audio initialization is:
 * - lazy
 * - user-gesture safe
 * - race-condition protected
 */

/* ============================================================
 * Imports
 * ========================================================== */

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

const layerContainer =
  document.getElementById(
    "layerContainer"
  );

const addExpertBtn =
  document.getElementById(
    "addExpertBtn"
  );

const sheetOverlay =
  document.getElementById(
    "sheetOverlay"
  );

const pressureSlider =
  document.getElementById(
    "pressureSlider"
  );

const pressureValue =
  document.getElementById(
    "pressureValue"
  );

const enclosureSelect =
  document.querySelector(
    "select"
  );

/* ============================================================
 * Runtime
 * ========================================================== */

let acousticBus = null;

let router = null;

let initialized = false;

let initializing = false;

/**
 * Active expert instances.
 */
const experts = [];

/* ============================================================
 * Engine Initialization
 * ========================================================== */

/**
 * Safe async initialization.
 *
 * Prevents:
 * - null context race
 * - duplicate AudioContexts
 * - mobile autoplay issues
 */
async function initEngine() {

  /**
   * Already initialized.
   */

  if (initialized) {

    if (
      acousticBus?.context
        ?.state ===
      "suspended"
    ) {

      await acousticBus
        .context
        .resume();
    }

    return;
  }

  /**
   * Parallel init guard.
   */

  if (initializing) {

    while (
      initializing &&
      !initialized
    ) {

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            16
          )
      );
    }

    return;
  }

  initializing = true;

  try {

    /**
     * ========================================================
     * Master Bus
     * ========================================================
     */

    acousticBus =
      new MasterAcousticBus();

    await acousticBus.init();

    /**
     * ========================================================
     * MoE Router
     * ========================================================
     */

    router =
      new MoERouter();

    /**
     * ========================================================
     * Runtime
     * ========================================================
     */

    initialized = true;

    console.log(
      "[Engine] Initialized."
    );

  } catch (err) {

    console.error(
      "[Engine] Init failed:",
      err
    );

  } finally {

    initializing = false;
  }
}

/* ============================================================
 * World State Wiring
 * ========================================================== */

/**
 * Pushes state updates
 * through entire engine.
 */
function broadcastWorldState() {

  if (!router) {
    return;
  }

  const snapshot =
    WorldState.snapshot();

  /**
   * Broadcast to experts.
   */

  router.broadcastState(
    snapshot
  );

  /**
   * Update acoustics.
   */

  acousticBus
    ?.updateAcoustics(
      snapshot
    );
}

/* ============================================================
 * Global Controls
 * ========================================================== */

/**
 * Atmospheric Pressure
 */

pressureSlider
  ?.addEventListener(
    "input",
    () => {

      const value =
        Number(
          pressureSlider.value
        );

      pressureValue.textContent =
        value.toFixed(2);

      WorldState
        .setAtmosphericPressure(
          value
        );

      broadcastWorldState();
    }
  );

/**
 * Enclosure
 */

enclosureSelect
  ?.addEventListener(
    "change",
    () => {

      WorldState
        .setEnclosure(
          enclosureSelect.value
        );

      broadcastWorldState();
    }
  );

/* ============================================================
 * Modal Controls
 * ========================================================== */

/**
 * Open modal.
 *
 * IMPORTANT:
 * First interaction initializes audio.
 */

addExpertBtn
  ?.addEventListener(
    "click",
    async () => {

      await initEngine();

      sheetOverlay
        ?.classList
        .add("open");
    }
  );

/**
 * Close modal.
 */

sheetOverlay
  ?.addEventListener(
    "click",
    (e) => {

      if (
        e.target ===
        sheetOverlay
      ) {

        sheetOverlay
          .classList
          .remove("open");
      }
    }
  );

/* ============================================================
 * Atmosphere Injection
 * ========================================================== */

/**
 * Existing rain button.
 */

const rainButton =
  document.querySelector(
    '[data-layer="rain"]'
  );

rainButton
  ?.addEventListener(
    "click",
    async () => {

      await injectRainExpert();

      sheetOverlay
        ?.classList
        .remove("open");
    }
  );

/* ============================================================
 * Rain Expert Injection
 * ========================================================== */

async function injectRainExpert() {

  /**
   * Ensure engine exists.
   */

  await initEngine();

  try {

    /**
     * Dynamic import.
     */

    const module =
      await import(
        "./expert_rain.js"
      );

    const RainExpert =
      module.default;

    /**
     * Instantiate expert.
     */

    const expert =
      new RainExpert(
        acousticBus.context,
        acousticBus
          .getInputBus()
      );

    /**
     * Register to router.
     */

    router.registerExpert(
      expert
    );

    experts.push(expert);

    /**
     * Build UI.
     */

    const wrapper =
      document
        .createElement(
          "div"
        );

    wrapper.innerHTML =
      expert.getUICard();

    const element =
      wrapper.firstElementChild;

    /**
     * Mount UI.
     */

    layerContainer
      ?.appendChild(
        element
      );

    /**
     * Bind expert controls.
     */

    if (
      typeof expert.bindUI ===
      "function"
    ) {

      expert.bindUI(
        element
      );
    }

    /**
     * Hydrate with current state.
     */

    expert.onStateUpdate(
      WorldState.snapshot()
    );

    console.log(
      "[Engine] Rain expert injected."
    );

  } catch (err) {

    console.error(
      "[Engine] Failed to inject RainExpert:",
      err
    );
  }
}

/* ============================================================
 * Dynamic Runtime Injection
 * ========================================================== */

/**
 * Inject custom runtime expert button.
 */

function injectCustomCodeButton() {

  const sheet =
    document.querySelector(
      ".sheet-grid"
    );

  if (!sheet) {
    return;
  }

  /**
   * Prevent duplicates.
   */

  if (
    document.getElementById(
      "injectCodeBtn"
    )
  ) {

    return;
  }

  const button =
    document.createElement(
      "button"
    );

  button.className =
    "sheet-item";

  button.id =
    "injectCodeBtn";

  button.innerHTML = `
    <div class="sheet-item-title">
      Custom · Paste Expert Code
    </div>

    <div class="sheet-item-sub">
      Runtime ES6 module injection
    </div>
  `;

  sheet.appendChild(
    button
  );

  /**
   * Runtime injection.
   */

  button.addEventListener(
    "click",
    async () => {

      await initEngine();

      const code =
        prompt(
`Paste ES6 expert module code.

Required:
export default class Expert {
  constructor(audioContext, inputBus) {}
  onStateUpdate(state) {}
  getUICard() {}
}`
        );

      if (!code) {
        return;
      }

      try {

        /**
         * Create runtime module.
         */

        const blob =
          new Blob(
            [code],
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
         * Dynamic import.
         */

        const module =
          await import(url);

        URL.revokeObjectURL(
          url
        );

        const ExpertClass =
          module.default;

        if (
          typeof ExpertClass !==
          "function"
        ) {

          throw new Error(
            "No default export class found."
          );
        }

        /**
         * Instantiate.
         */

        const expert =
          new ExpertClass(
            acousticBus.context,
            acousticBus
              .getInputBus()
          );

        /**
         * Register.
         */

        router.registerExpert(
          expert
        );

        experts.push(expert);

        /**
         * UI.
         */

        if (
          typeof expert
            .getUICard ===
          "function"
        ) {

          const wrapper =
            document
              .createElement(
                "div"
              );

          wrapper.innerHTML =
            expert.getUICard();

          const element =
            wrapper.firstElementChild;

          layerContainer
            ?.appendChild(
              element
            );

          if (
            typeof expert
              .bindUI ===
            "function"
          ) {

            expert.bindUI(
              element
            );
          }
        }

        /**
         * Hydrate.
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
         * Close modal.
         */

        sheetOverlay
          ?.classList
          .remove("open");

        console.log(
          "[Engine] Runtime expert injected."
        );

      } catch (err) {

        console.error(
          "[Engine] Runtime injection failed:",
          err
        );

        alert(
          "Failed to inject expert module. Check console."
        );
      }
    }
  );
}

/**
 * Initialize runtime injection UI.
 */

injectCustomCodeButton();

/* ============================================================
 * Initial State
 * ========================================================== */

WorldState.setAtmosphericPressure(
  Number(
    pressureSlider?.value || 0
  )
);

WorldState.setEnclosure(
  enclosureSelect?.value ||
  ENCLOSURE_TYPES.OPEN
);
