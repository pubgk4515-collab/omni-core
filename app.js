/**
 * app.js
 * Symbiote Acoustic MoE World Simulator
 *
 * ------------------------------------------------------------
 * PRINCIPAL SYSTEMS INTEGRATION LAYER
 * ------------------------------------------------------------
 *
 * Responsibilities:
 * - Engine bootstrap
 * - AudioContext unlock
 * - Acoustic graph initialization
 * - Runtime expert injection
 * - Dynamic ES6 loading
 * - WorldState synchronization
 * - Modal orchestration
 * - Expert lifecycle cleanup
 *
 * ------------------------------------------------------------
 * CRITICAL FIXES
 * ------------------------------------------------------------
 *
 * ✓ Explicit modal logic
 * ✓ Fixed silent injection failure
 * ✓ Fixed DOM insertion pipeline
 * ✓ Fixed expert card mounting
 * ✓ Fixed remove delegation
 * ✓ Fixed router cleanup
 * ✓ Added hard fail alerts
 */

/* ============================================================
 * Imports
 * ========================================================== */

import {
  WorldState,
  MoERouter,
} from "./world_brain.js";

import {
  MasterAcousticBus,
} from "./acoustic_bus.js";

/* ============================================================
 * DOM
 * ========================================================== */

const expertRack =
  document.getElementById(
    "expertRack"
  );

const layerModal =
  document.getElementById(
    "layerModal"
  );

const addLayerBtn =
  document.getElementById(
    "addLayerBtn"
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

let bus = null;

let router = null;

let initialized = false;

let initializing = false;

let visualLoopStarted = false;

/**
 * DOM/expert tracking.
 *
 * Map<string, object>
 */

const activeExperts =
  new Map();

/* ============================================================
 * Utility
 * ========================================================== */

/**
 * Async sleep.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {

  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

/**
 * Broadcast latest WorldState.
 */
function broadcastWorldState() {

  if (!router) {
    return;
  }

  router.broadcastState(
    WorldState.snapshot()
  );
}

/* ============================================================
 * Modal Logic
 * ========================================================== */

/**
 * CRITICAL FIX:
 * Explicit modal opening.
 */

addLayerBtn
  ?.addEventListener(
    "click",
    () => {

      layerModal
        ?.classList
        .add("open");
    }
  );

/**
 * Close modal on overlay click.
 */

layerModal
  ?.addEventListener(
    "click",
    (e) => {

      /**
       * Overlay click.
       */

      if (
        e.target ===
        layerModal
      ) {

        layerModal
          .classList
          .remove("open");
      }

      /**
       * Any sheet button click.
       */

      if (
        e.target.classList
          .contains(
            "sheet-btn"
          )
      ) {

        layerModal
          .classList
          .remove("open");
      }
    }
  );

/* ============================================================
 * Acoustic Loop
 * ========================================================== */

/**
 * Continuous acoustics updater.
 */

function startVisualLoop() {

  if (visualLoopStarted) {
    return;
  }

  visualLoopStarted = true;

  function frame() {

    if (
      bus &&
      typeof bus
        .updateAcoustics ===
        "function"
    ) {

      bus.updateAcoustics(
        WorldState.snapshot()
      );
    }

    requestAnimationFrame(frame);
  }

  frame();
}

/* ============================================================
 * Engine Bootstrap
 * ========================================================== */

/**
 * Browser-safe engine unlock.
 */

async function ensureEngine() {

  /**
   * Already ready.
   */

  if (initialized) {

    if (
      bus?.context?.state ===
      "suspended"
    ) {

      await bus.context.resume();
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

      await sleep(16);
    }

    return;
  }

  initializing = true;

  try {

    /**
     * ========================================================
     * Acoustic Bus
     * ========================================================
     */

    bus =
      new MasterAcousticBus();

    /**
     * CRITICAL:
     * Build graph.
     */

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
     * Unlock browser audio
     * ========================================================
     */

    if (
      bus.context.state ===
      "suspended"
    ) {

      await bus.context.resume();
    }

    /**
     * ========================================================
     * Start updates
     * ========================================================
     */

    startVisualLoop();

    initialized = true;

    console.log(
      "[Engine] Initialized."
    );

  } catch (err) {

    console.error(
      "[Engine] Initialization failed:",
      err
    );

    alert(
      "ENGINE INIT ERROR: " +
      err.message
    );

  } finally {

    initializing = false;
  }
}

/* ============================================================
 * WorldState Sync
 * ========================================================== */

/**
 * Pressure slider.
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
 * Enclosure selector.
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
 * Expert Injection
 * ========================================================== */

/**
 * Expert buttons.
 */

document
  .querySelectorAll(
    "[data-expert]"
  )
  .forEach((button) => {

    button.addEventListener(
      "click",
      async () => {

        /**
         * ====================================================
         * HARD SAFETY WRAPPER
         * ====================================================
         */

        try {

          /**
           * ==================================================
           * Engine bootstrap
           * ==================================================
           */

          await ensureEngine();

          /**
           * ==================================================
           * Determine expert type
           * ==================================================
           */

          const expertType =
            button.dataset.expert;

          let modulePath =
            null;

          switch (
            expertType
          ) {

            case "rain":
              modulePath =
                "./expert_rain.js";
              break;

            case "birds":
              modulePath =
                "./expert_birds.js";
              break;

            case "typing":
              modulePath =
                "./expert_typing.js";
              break;

            default:
              throw new Error(
                `Unknown expert: ${expertType}`
              );
          }

          /**
           * ==================================================
           * Dynamic import
           * ==================================================
           */

          const module =
            await import(
              modulePath
            );

          const ExpertClass =
            module.default;

          if (
            typeof ExpertClass !==
            "function"
          ) {

            throw new Error(
              "Expert module missing default export."
            );
          }

          /**
           * ==================================================
           * Instantiate
           * ==================================================
           */

          const expertInstance =
            new ExpertClass(
              bus.context,
              bus.getInputBus()
            );

          /**
           * Safety identity.
           */

          if (
            !expertInstance.id
          ) {

            expertInstance.id =
              crypto.randomUUID();
          }

          /**
           * ==================================================
           * Register to router
           * ==================================================
           */

          router.registerExpert(
            expertInstance
          );

          /**
           * ==================================================
           * Track locally
           * ==================================================
           */

          activeExperts.set(
            expertInstance.id,
            expertInstance
          );

          /**
           * ==================================================
           * CRITICAL DOM FIX
           * ==================================================
           */

          expertRack
            .insertAdjacentHTML(
              "beforeend",
              expertInstance
                .getUICard()
            );

          const cardElement =
            expertRack
              .lastElementChild;

          if (
            !cardElement
          ) {

            throw new Error(
              "Failed to mount expert card."
            );
          }

          /**
           * ==================================================
           * Bind local controls
           * ==================================================
           */

          if (
            typeof expertInstance
              .bindCardControls ===
            "function"
          ) {

            expertInstance
              .bindCardControls(
                cardElement
              );
          }

          /**
           * ==================================================
           * Hydrate world state
           * ==================================================
           */

          if (
            typeof expertInstance
              .onWorldStateUpdate ===
            "function"
          ) {

            expertInstance
              .onWorldStateUpdate(
                WorldState.snapshot()
              );
          }

          console.log(
            `[Engine] Injected expert: ${expertInstance.id}`
          );

        } catch (err) {

          /**
           * ==================================================
           * NO SILENT FAILURES
           * ==================================================
           */

          alert(
            "ERROR: " +
            err.message
          );

          console.error(err);
        }
      }
    );
  });

/* ============================================================
 * Runtime Code Injection
 * ========================================================== */

injectCodeBtn
  ?.addEventListener(
    "click",
    async () => {

      try {

        await ensureEngine();

        /**
         * ====================================================
         * Prompt
         * ====================================================
         */

        const code =
          prompt(
`Paste ES6 Expert Class Code:

export default class MyExpert {
  constructor(audioContext, inputBus) {}
  getUICard() {}
  bindCardControls(card) {}
  onWorldStateUpdate(state) {}
  destroy() {}
}`
          );

        if (!code) {
          return;
        }

        /**
         * ====================================================
         * Blob module
         * ====================================================
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
         * ====================================================
         * Dynamic import
         * ====================================================
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
            "Injected code missing default export."
          );
        }

        /**
         * ====================================================
         * Instantiate
         * ====================================================
         */

        const expertInstance =
          new ExpertClass(
            bus.context,
            bus.getInputBus()
          );

        /**
         * Safety ID.
         */

        if (
          !expertInstance.id
        ) {

          expertInstance.id =
            crypto.randomUUID();
        }

        /**
         * ====================================================
         * Register
         * ====================================================
         */

        router.registerExpert(
          expertInstance
        );

        activeExperts.set(
          expertInstance.id,
          expertInstance
        );

        /**
         * ====================================================
         * DOM FIX
         * ====================================================
         */

        expertRack
          .insertAdjacentHTML(
            "beforeend",
            expertInstance
              .getUICard()
          );

        const cardElement =
          expertRack
            .lastElementChild;

        if (
          !cardElement
        ) {

          throw new Error(
            "Failed to mount injected expert."
          );
        }

        /**
         * ====================================================
         * Bind controls
         * ====================================================
         */

        if (
          typeof expertInstance
            .bindCardControls ===
          "function"
        ) {

          expertInstance
            .bindCardControls(
              cardElement
            );
        }

        /**
         * Hydrate state.
         */

        if (
          typeof expertInstance
            .onWorldStateUpdate ===
          "function"
        ) {

          expertInstance
            .onWorldStateUpdate(
              WorldState.snapshot()
            );
        }

        console.log(
          "[Engine] Runtime expert injected."
        );

      } catch (err) {

        alert(
          "ERROR: " +
          err.message
        );

        console.error(err);
      }
    }
  );

/* ============================================================
 * Remove Delegation
 * ========================================================== */

/**
 * CRITICAL:
 * Delegated removal handler.
 */

expertRack
  ?.addEventListener(
    "click",
    (e) => {

      /**
       * Remove button only.
       */

      if (
        !e.target.classList
          .contains(
            "remove-btn"
          )
      ) {

        return;
      }

      /**
       * Card.
       */

      const card =
        e.target.closest(
          ".expert-card"
        );

      if (!card) {
        return;
      }

      /**
       * Expert ID.
       */

      const id =
        card.dataset.id;

      if (!id) {
        return;
      }

      /**
       * Runtime instance.
       */

      const expert =
        activeExperts.get(id);

      /**
       * Cleanup lifecycle.
       */

      if (expert) {

        try {

          if (
            typeof expert
              .destroy ===
            "function"
          ) {

            expert.destroy();
          }

        } catch (err) {

          console.warn(
            "[Engine] Destroy failed:",
            err
          );
        }
      }

      /**
       * ======================================================
       * Remove from router
       * ======================================================
       */

      if (
        router &&
        typeof router
          .unregisterExpert ===
          "function"
      ) {

        router.unregisterExpert(
          id
        );
      }

      /**
       * Remove local tracking.
       */

      activeExperts.delete(
        id
      );

      /**
       * Remove DOM.
       */

      card.remove();

      console.log(
        `[Engine] Removed expert: ${id}`
      );
    }
  );

/* ============================================================
 * Initial UI Hydration
 * ========================================================== */

pressureValue.textContent =
  Number(
    pressureSlider?.value || 0
  ).toFixed(2);

WorldState.setAtmosphericPressure(
  Number(
    pressureSlider?.value || 0
  )
);

WorldState.setEnclosure(
  enclosureSelect?.value ||
  "Open"
);

/* ============================================================
 * Gesture Unlock
 * ========================================================== */

/**
 * Helps mobile browsers.
 */

window.addEventListener(
  "pointerdown",
  () => {

    ensureEngine();

  },
  {
    once: true,
  }
);
