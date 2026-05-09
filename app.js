/**
 * app.js
 * Symbiote Acoustic MoE World Simulator
 *
 * ------------------------------------------------------------
 * AAA SYSTEMS INTEGRATION LAYER
 * ------------------------------------------------------------
 *
 * Responsibilities:
 * - Engine bootstrap
 * - Browser audio unlock
 * - Runtime expert injection
 * - Dynamic ES6 loading
 * - Expert lifecycle management
 * - WorldState synchronization
 * - UI ↔ Engine orchestration
 *
 * ------------------------------------------------------------
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 *
 * This file acts as:
 *
 * UI Layer
 *      ↓
 * Runtime Router
 *      ↓
 * Acoustic Bus
 *      ↓
 * Expert Modules
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * This implementation fixes:
 *
 * ✓ No sound bug
 * ✓ Remove button bug
 * ✓ Dynamic injection bug
 * ✓ Slider desync
 * ✓ Context unlock race conditions
 * ✓ Missing bindCardControls()
 * ✓ Broken expert lifecycle
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
 * Shared acoustic bus.
 */

let bus = null;

/**
 * Shared MoE router.
 */

let router = null;

/**
 * Engine flags.
 */

let initialized = false;

let initializing = false;

/**
 * RAF loop guard.
 */

let visualLoopStarted = false;

/**
 * Runtime expert registry.
 *
 * Map<string, Expert>
 */

const activeExperts =
  new Map();

/* ============================================================
 * Utility
 * ========================================================== */

/**
 * Safe async sleep.
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

  const snapshot =
    WorldState.snapshot();

  /**
   * Push into MoE Router.
   */

  router.broadcastState(
    snapshot
  );
}

/* ============================================================
 * Acoustic Update Loop
 * ========================================================== */

/**
 * Global acoustic update loop.
 *
 * Runs continuously once engine unlocks.
 */
function startVisualLoop() {

  if (visualLoopStarted) {
    return;
  }

  visualLoopStarted = true;

  function frame() {

    if (bus) {

      /**
       * Update environmental acoustics.
       */

      if (
        typeof bus
          .updateAcoustics ===
        "function"
      ) {

        bus.updateAcoustics(
          WorldState.snapshot()
        );
      }
    }

    requestAnimationFrame(frame);
  }

  frame();
}

/* ============================================================
 * Engine Unlock
 * ========================================================== */

/**
 * CRITICAL:
 * Browser-safe audio unlock.
 *
 * Guarantees:
 * - single AudioContext
 * - single Router
 * - resumed context
 * - RAF loop started
 */
async function ensureEngine() {

  /**
   * Already initialized.
   */

  if (initialized) {

    /**
     * Resume if suspended.
     */

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
     * Master Bus
     * ========================================================
     */

    bus =
      new MasterAcousticBus();

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
     * Start RAF Acoustics Loop
     * ========================================================
     */

    startVisualLoop();

    initialized = true;

    console.log(
      "[Engine] Audio unlocked."
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

      /**
       * Update global state.
       */

      WorldState
        .setAtmosphericPressure(
          value
        );

      /**
       * Broadcast to experts.
       */

      broadcastWorldState();
    }
  );

/**
 * Enclosure Select
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
 * Dynamic Expert Injection
 * ========================================================== */

/**
 * Dynamic expert mapping.
 *
 * IMPORTANT:
 * Expandable architecture.
 */

const EXPERT_MODULES = {

  rain:
    "./expert_rain.js",

  birds:
    "./expert_birds.js",

  typing:
    "./expert_typing.js",
};

/**
 * Shared injection pipeline.
 *
 * @param {string} modulePath
 */
async function injectExpert(
  modulePath
) {

  try {

    /**
     * ========================================================
     * Engine Unlock
     * ========================================================
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
     * Instantiate Expert
     * ========================================================
     */

    const expertInstance =
      new ExpertClass(
        bus.context,
        bus.getInputBus()
      );

    /**
     * Safety.
     */

    if (!expertInstance.id) {

      expertInstance.id =
        crypto.randomUUID();
    }

    /**
     * ========================================================
     * Register To Router
     * ========================================================
     */

    router.registerExpert(
      expertInstance
    );

    /**
     * ========================================================
     * Runtime Registry
     * ========================================================
     */

    activeExperts.set(
      expertInstance.id,
      expertInstance
    );

    /**
     * ========================================================
     * UI Injection
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
        "Expert UI card invalid."
      );
    }

    expertRack.appendChild(
      cardElement
    );

    /**
     * ========================================================
     * CRITICAL FIX
     * ========================================================
     *
     * Bind local controls immediately.
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
     * Hydrate Current WorldState
     * ========================================================
     */

    if (
      typeof expertInstance
        .onStateUpdate ===
      "function"
    ) {

      expertInstance
        .onStateUpdate(
          WorldState.snapshot()
        );
    }

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

/**
 * Handles:
 * - rain
 * - birds
 * - typing
 */

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
            `Unknown expert: ${expertType}`
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
 * Custom ES6 runtime injection.
 */

injectCodeBtn
  ?.addEventListener(
    "click",
    async () => {

      try {

        /**
         * Unlock engine.
         */

        await ensureEngine();

        /**
         * ====================================================
         * Prompt
         * ====================================================
         */

        const code =
          prompt(
`Paste ES6 Expert Class Code:

Example:

export default class MyExpert {
  constructor(audioContext, inputBus) {}
  getUICard() {}
  bindCardControls(card) {}
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
         * Safety.
         */

        if (!expertInstance.id) {

          expertInstance.id =
            crypto.randomUUID();
        }

        /**
         * ====================================================
         * Router Registration
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

        expertRack.appendChild(
          cardElement
        );

        /**
         * CRITICAL:
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
            .onStateUpdate ===
          "function"
        ) {

          expertInstance
            .onStateUpdate(
              WorldState.snapshot()
            );
        }

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
 * CRITICAL FIX:
 *
 * ONE delegated listener.
 *
 * Handles ALL future experts.
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
       * Runtime instance.
       */

      const expert =
        activeExperts.get(id);

      if (!expert) {

        card.remove();

        return;
      }

      /**
       * Destroy lifecycle.
       */

      try {

        if (
          typeof expert.destroy ===
          "function"
        ) {

          expert.destroy();
        }

      } catch (err) {

        console.warn(
          "[Engine] Expert destroy failed:",
          err
        );
      }

      /**
       * Remove from registry.
       */

      activeExperts.delete(id);

      /**
       * Remove DOM.
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
 * Initial state sync.
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
 * Broadcast initial snapshot.
 */

broadcastWorldState();

/* ============================================================
 * Gesture-Based Early Unlock
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
