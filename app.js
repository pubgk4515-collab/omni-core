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
 * - Browser audio unlock
 * - Acoustic graph initialization
 * - Runtime expert injection
 * - Dynamic ES6 loading
 * - Expert lifecycle management
 * - WorldState synchronization
 * - UI ↔ Engine orchestration
 *
 * ------------------------------------------------------------
 * IMPORTANT FIXES
 * ------------------------------------------------------------
 *
 * ✓ FIXED:
 *   Missing await bus.init()
 *
 * ✓ FIXED:
 *   Router memory leak on removal
 *
 * ✓ FIXED:
 *   Router/DOM state desynchronization
 *
 * ✓ FIXED:
 *   Expert lifecycle cleanup
 *
 * ✓ FIXED:
 *   Dynamic module injection lifecycle
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

/**
 * Shared acoustic environment.
 */

let bus = null;

/**
 * Shared MoE router.
 */

let router = null;

/**
 * Runtime flags.
 */

let initialized = false;

let initializing = false;

/**
 * RAF loop state.
 */

let visualLoopStarted = false;

/**
 * DOM tracking ONLY.
 *
 * IMPORTANT:
 * Router is source-of-truth
 * for actual engine state.
 *
 * Map<string, {
 *   element: HTMLElement,
 *   expert: object
 * }>
 */

const activeExpertsDOM =
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
 * Safe modal close.
 */
function closeModal() {

  layerModal
    ?.classList
    .remove("open");
}

/**
 * Broadcast latest state.
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
 * Acoustic Loop
 * ========================================================== */

/**
 * Continuous acoustic updates.
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
 *
 * CRITICAL:
 * MUST call:
 * await bus.init()
 */
async function ensureEngine() {

  /**
   * Already initialized.
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
   * Parallel init protection.
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
     * ========================================================
     * CRITICAL FIX
     * ========================================================
     *
     * Build graph BEFORE usage.
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
     * Browser Audio Unlock
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
     * Start acoustic updates
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

  } finally {

    initializing = false;
  }
}

/* ============================================================
 * World State Sync
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
 * Expert Registry
 * ========================================================== */

/**
 * Runtime expert modules.
 */

const EXPERT_MODULES = {

  rain:
    "./expert_rain.js",

  birds:
    "./expert_birds.js",

  typing:
    "./expert_typing.js",
};

/* ============================================================
 * Expert Injection
 * ========================================================== */

/**
 * Shared expert injection pipeline.
 *
 * @param {string} modulePath
 */
async function injectExpert(
  modulePath
) {

  try {

    /**
     * Unlock engine.
     */

    await ensureEngine();

    if (!bus || !router) {
      return;
    }

    /**
     * ========================================================
     * Dynamic Import
     * ========================================================
     */

    const module =
      await import(modulePath);

    const ExpertClass =
      module.default;

    if (
      typeof ExpertClass !==
      "function"
    ) {

      throw new Error(
        `Invalid expert module: ${modulePath}`
      );
    }

    /**
     * ========================================================
     * Instantiate
     * ========================================================
     */

    const expertInstance =
      new ExpertClass(
        bus.context,
        bus.getInputBus()
      );

    /**
     * Safety identity.
     */

    if (!expertInstance.id) {

      expertInstance.id =
        crypto.randomUUID();
    }

    /**
     * ========================================================
     * Register to Router
     * ========================================================
     */

    router.registerExpert(
      expertInstance
    );

    /**
     * ========================================================
     * Create UI
     * ========================================================
     */

    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.innerHTML =
      expertInstance
        .getUICard()
        .trim();

    const cardElement =
      wrapper.firstElementChild;

    if (!cardElement) {

      throw new Error(
        "Invalid expert card."
      );
    }

    /**
     * Mount DOM.
     */

    expertRack.appendChild(
      cardElement
    );

    /**
     * ========================================================
     * Bind local controls
     * ========================================================
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
     * ========================================================
     * Hydrate state
     * ========================================================
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

    /**
     * ========================================================
     * DOM tracking ONLY
     * ========================================================
     */

    activeExpertsDOM.set(
      expertInstance.id,
      {
        element:
          cardElement,
        expert:
          expertInstance,
      }
    );

    closeModal();

    console.log(
      `[Engine] Expert injected: ${expertInstance.id}`
    );

  } catch (err) {

    console.error(
      "[Engine] Expert injection failed:",
      err
    );
  }
}

/* ============================================================
 * Modal Expert Buttons
 * ========================================================== */

document
  .querySelectorAll(
    "[data-expert]"
  )
  .forEach((button) => {

    button.addEventListener(
      "click",
      async () => {

        const expertType =
          button.dataset.expert;

        const modulePath =
          EXPERT_MODULES[
            expertType
          ];

        if (!modulePath) {

          console.warn(
            `Unknown expert type: ${expertType}`
          );

          return;
        }

        await injectExpert(
          modulePath
        );
      }
    );
  });

/* ============================================================
 * Runtime Code Injection
 * ========================================================== */

/**
 * Runtime ES6 expert injection.
 */

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
         * Blob Module
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
         * Dynamic Import
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
            "Injected module missing default export."
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
         * Safety identity.
         */

        if (!expertInstance.id) {

          expertInstance.id =
            crypto.randomUUID();
        }

        /**
         * ====================================================
         * Register to Router
         * ====================================================
         */

        router.registerExpert(
          expertInstance
        );

        /**
         * ====================================================
         * UI Injection
         * ====================================================
         */

        const wrapper =
          document.createElement(
            "div"
          );

        wrapper.innerHTML =
          expertInstance
            .getUICard()
            .trim();

        const cardElement =
          wrapper.firstElementChild;

        if (!cardElement) {

          throw new Error(
            "Injected expert card invalid."
          );
        }

        expertRack.appendChild(
          cardElement
        );

        /**
         * Bind controls.
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

        /**
         * DOM tracking.
         */

        activeExpertsDOM.set(
          expertInstance.id,
          {
            element:
              cardElement,
            expert:
              expertInstance,
          }
        );

        closeModal();

        console.log(
          "[Engine] Runtime expert injected."
        );

      } catch (err) {

        console.error(
          "[Engine] Runtime injection failed:",
          err
        );

        alert(
          "Expert injection failed. Check console."
        );
      }
    }
  );

/* ============================================================
 * Remove Expert Delegation
 * ========================================================== */

/**
 * Handles ALL dynamic experts.
 *
 * CRITICAL FIX:
 * router.unregisterExpert(id)
 */

expertRack
  ?.addEventListener(
    "click",
    (e) => {

      /**
       * Remove button.
       */

      if (
        !e.target.classList.contains(
          "remove-btn"
        )
      ) {

        return;
      }

      /**
       * Closest card.
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
       * DOM registry.
       */

      const tracked =
        activeExpertsDOM.get(id);

      /**
       * Lifecycle cleanup.
       */

      if (tracked?.expert) {

        try {

          if (
            typeof tracked
              .expert
              .destroy ===
            "function"
          ) {

            tracked
              .expert
              .destroy();
          }

        } catch (err) {

          console.warn(
            "[Engine] Expert destroy failed:",
            err
          );
        }
      }

      /**
       * ========================================================
       * CRITICAL FIX
       * ========================================================
       *
       * Remove from router.
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
       * Remove local DOM tracking.
       */

      activeExpertsDOM.delete(
        id
      );

      /**
       * Remove UI.
       */

      card.remove();

      console.log(
        `[Engine] Expert removed: ${id}`
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

/**
 * Initial WorldState.
 */

WorldState.setAtmosphericPressure(
  Number(
    pressureSlider?.value || 0
  )
);

WorldState.setEnclosure(
  enclosureSelect?.value ||
  "Open"
);

/**
 * Initial sync.
 */

broadcastWorldState();

/* ============================================================
 * Gesture-Based Early Unlock
 * ========================================================== */

/**
 * Mobile browser helper.
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
