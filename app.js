/**
 * app.js
 * Compact MoE Acoustic World Model
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * - UI ↔ Engine bridge
 * - Modal lifecycle
 * - Runtime expert injection
 * - Dynamic ES6 module loading
 * - WorldState propagation
 * - Failsafe audio initialization
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

const addExpertBtn =
  document.getElementById(
    "addExpertBtn"
  );

const layerModal =
  document.getElementById(
    "layerModal"
  );

const layerContainer =
  document.getElementById(
    "layerContainer"
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
  document.getElementById(
    "enclosureSelect"
  );

const injectCodeBtn =
  document.getElementById(
    "injectCodeBtn"
  );

/* ============================================================
 * Runtime
 * ========================================================== */

let acousticBus = null;

let router = null;

let initialized = false;

let initializing = false;

/**
 * Runtime expert instances.
 */
const experts = [];

/* ============================================================
 * Modal
 * ========================================================== */

function openModal() {

  layerModal.classList.add(
    "open"
  );
}

function closeModal() {

  layerModal.classList.remove(
    "open"
  );
}

/* ============================================================
 * Engine Bootstrap
 * ========================================================== */

/**
 * Failsafe engine initializer.
 *
 * Prevents:
 * - null AudioContext
 * - duplicate contexts
 * - race conditions
 */
async function ensureEngine() {

  /**
   * Existing runtime.
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
     * Router
     * ========================================================
     */

    router =
      new MoERouter();

    /**
     * ========================================================
     * Initial Acoustics
     * ========================================================
     */

    acousticBus
      .updateAcoustics(
        WorldState.snapshot()
      );

    initialized = true;

    console.log(
      "[Engine] Ready."
    );

  } catch (err) {

    console.error(
      "[Engine] Bootstrap failed:",
      err
    );

  } finally {

    initializing = false;
  }
}

/* ============================================================
 * State Broadcast
 * ========================================================== */

function pushState() {

  if (!router) {
    return;
  }

  const snapshot =
    WorldState.snapshot();

  router.broadcastState(
    snapshot
  );

  acousticBus
    ?.updateAcoustics(
      snapshot
    );
}

/* ============================================================
 * UI Controls
 * ========================================================== */

/**
 * Pressure Slider
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

      pushState();
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

      pushState();
    }
  );

/* ============================================================
 * Modal Controls
 * ========================================================== */

/**
 * Open
 */

addExpertBtn
  ?.addEventListener(
    "click",
    openModal
  );

/**
 * Close on overlay click
 */

layerModal
  ?.addEventListener(
    "click",
    (e) => {

      /**
       * Overlay only.
       */

      if (
        e.target ===
        layerModal
      ) {

        closeModal();
      }
    }
  );

/**
 * Close on ANY modal button.
 */

document
  .querySelectorAll(
    ".sheet-btn"
  )
  .forEach((btn) => {

    btn.addEventListener(
      "click",
      () => {

        closeModal();
      }
    );
  });

/* ============================================================
 * Rain Expert Injection
 * ========================================================== */

const rainButton =
  document.querySelector(
    '[data-layer="rain"]'
  );

rainButton
  ?.addEventListener(
    "click",
    async () => {

      await ensureEngine();

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
         * Create expert.
         */

        const expert =
          new RainExpert(
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
         * Build UI.
         */

        const wrapper =
          document
            .createElement(
              "div"
            );

        wrapper.innerHTML =
          expert.getUICard();

        const card =
          wrapper
            .firstElementChild;

        /**
         * Mount.
         */

        layerContainer
          ?.appendChild(
            card
          );

        /**
         * Bind card UI.
         */

        if (
          typeof expert.bindUI ===
          "function"
        ) {

          expert.bindUI(
            card
          );
        }

        /**
         * Hydrate.
         */

        expert.onStateUpdate(
          WorldState.snapshot()
        );

        console.log(
          "[Engine] Rain expert injected."
        );

      } catch (err) {

        console.error(
          "[Engine] Rain injection failed:",
          err
        );
      }
    }
  );

/* ============================================================
 * Runtime Code Injection
 * ========================================================== */

injectCodeBtn
  ?.addEventListener(
    "click",
    async () => {

      await ensureEngine();

      const code =
        prompt(
          "Paste ES6 Expert Code:"
        );

      if (!code) {
        return;
      }

      try {

        /**
         * Runtime module blob.
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
            "Default export class missing."
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
         * Dummy UI fallback.
         */

        const card =
          document
            .createElement(
              "article"
            );

        card.className =
          "expert-card glass";

        card.innerHTML = `
          <div class="expert-top">

            <div>

              <div class="expert-name">
                Runtime Expert
              </div>

              <div class="expert-type">
                Dynamic ES6 Injection
              </div>

            </div>

            <div class="badge">
              Active
            </div>

          </div>
        `;

        layerContainer
          ?.appendChild(
            card
          );

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

        console.log(
          "[Engine] Runtime expert injected."
        );

      } catch (err) {

        console.error(
          "[Engine] Injection failed:",
          err
        );

        alert(
          "Failed to inject expert module."
        );
      }
    }
  );

/* ============================================================
 * Initial World State
 * ========================================================== */

WorldState.setAtmosphericPressure(
  Number(
    pressureSlider.value
  )
);

WorldState.setEnclosure(
  enclosureSelect.value ||
  ENCLOSURE_TYPES.OPEN
);
