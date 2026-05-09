/**
 * app.js
 * Symbiote Acoustic MoE World Simulator
 *
 * ------------------------------------------------------------
 * RESPONSIBILITIES
 * ------------------------------------------------------------
 *
 * - UI ↔ Engine integration
 * - Runtime expert injection
 * - Dynamic ES6 module loading
 * - Global state propagation
 * - Expert lifecycle management
 *
 * ------------------------------------------------------------
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * Audio initialization is:
 * - lazy
 * - gesture-safe
 * - mobile-safe
 * - singleton-protected
 */

/* ============================================================
 * Imports
 * ========================================================== */

import {
  WorldState,
  BehavioralRulesEngine,
} from "./world_brain.js";

import {
  AcousticEnvironment,
} from "./acoustic_bus.js";

/* ============================================================
 * DOM
 * ========================================================== */

const enclosureSelect =
  document.getElementById(
    "enclosureSelect"
  );

const pressureSlider =
  document.getElementById(
    "pressureSlider"
  );

const pressureValue =
  document.getElementById(
    "pressureValue"
  );

const expertRack =
  document.getElementById(
    "expertRack"
  );

const rainButton =
  document.querySelector(
    '[data-expert="rain"]'
  );

const injectCodeBtn =
  document.getElementById(
    "injectCodeBtn"
  );

/* ============================================================
 * Runtime
 * ========================================================== */

/**
 * Shared audio environment.
 */

let environment = null;

/**
 * Prevent duplicate init.
 */

let initialized = false;

/**
 * Prevent parallel init.
 */

let initializing = false;

/**
 * Runtime expert registry.
 *
 * Map<string, object>
 */

const activeExperts =
  new Map();

/* ============================================================
 * Engine Initialization
 * ========================================================== */

/**
 * Lazy-safe initialization.
 *
 * Prevents:
 * - null context
 * - duplicate AudioContexts
 * - autoplay policy failures
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
      environment
        ?.context
        ?.state ===
      "suspended"
    ) {

      await environment
        .context
        .resume();
    }

    return environment;
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

    return environment;
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
     * Mobile autoplay safety.
     */

    if (
      environment.context
        .state ===
      "suspended"
    ) {

      await environment
        .context
        .resume();
    }

    initialized = true;

    console.log(
      "[Engine] Initialized."
    );

    return environment;

  } catch (err) {

    console.error(
      "[Engine] Failed to initialize:",
      err
    );

    return null;

  } finally {

    initializing = false;
  }
}

/* ============================================================
 * Global State Updates
 * ========================================================== */

/**
 * Push current state to:
 * - WorldState
 * - Environment
 * - Experts
 */
function propagateState() {

  const snapshot =
    WorldState.snapshot();

  /**
   * Update environment acoustics.
   */

  if (
    environment &&
    typeof environment
      .updateAcoustics ===
      "function"
  ) {

    environment
      .updateAcoustics(
        snapshot
      );
  }

  /**
   * Update experts.
   */

  for (
    const expert
    of activeExperts.values()
  ) {

    if (
      typeof expert
        .onStateUpdate ===
      "function"
    ) {

      expert.onStateUpdate(
        snapshot
      );
    }
  }
}

/* ============================================================
 * Global UI Listeners
 * ========================================================== */

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

      propagateState();
    }
  );

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

      propagateState();
    }
  );

/* ============================================================
 * Rain Expert Injection
 * ========================================================== */

rainButton
  ?.addEventListener(
    "click",
    async () => {

      await injectRainExpert();
    }
  );

/**
 * Dynamic RainExpert loader.
 */
async function injectRainExpert() {

  try {

    /**
     * Ensure audio exists.
     */

    await ensureEngine();

    if (!environment) {
      return;
    }

    /**
     * ========================================================
     * Dynamic Import
     * ========================================================
     */

    const module =
      await import(
        "./expert_rain.js"
      );

    const RainExpert =
      module.default;

    /**
     * ========================================================
     * Instantiate
     * ========================================================
     */

    const expert =
      new RainExpert(
        environment.context,
        environment
          .getInputBus()
      );

    /**
     * ========================================================
     * Register
     * ========================================================
     */

    activeExperts.set(
      expert.id,
      expert
    );

    /**
     * ========================================================
     * UI
     * ========================================================
     */

    const wrapper =
      document
        .createElement(
          "div"
        );

    wrapper.innerHTML =
      expert.getUICard();

    const card =
      wrapper.firstElementChild;

    /**
     * Append.
     */

    expertRack.appendChild(
      card
    );

    /**
     * Local UI binding.
     */

    if (
      typeof expert
        .bindCardControls ===
      "function"
    ) {

      expert.bindCardControls(
        card
      );
    }

    /**
     * Hydrate current state.
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
 * Runtime ES6 Injection
 * ========================================================== */

injectCodeBtn
  ?.addEventListener(
    "click",
    async () => {

      try {

        await ensureEngine();

        if (!environment) {
          return;
        }

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
            "No default export class found."
          );
        }

        /**
         * ====================================================
         * Instantiate
         * ====================================================
         */

        const expert =
          new ExpertClass(
            environment.context,
            environment
              .getInputBus()
          );

        /**
         * Safety.
         */

        if (!expert.id) {

          expert.id =
            crypto.randomUUID();
        }

        /**
         * ====================================================
         * Register
         * ====================================================
         */

        activeExperts.set(
          expert.id,
          expert
        );

        /**
         * ====================================================
         * UI
         * ====================================================
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

          const card =
            wrapper.firstElementChild;

          expertRack.appendChild(
            card
          );

          /**
           * Optional UI binding.
           */

          if (
            typeof expert
              .bindCardControls ===
            "function"
          ) {

            expert.bindCardControls(
              card
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
 * CRITICAL:
 * Handles dynamically-created experts.
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
       * Parent card.
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
       * Runtime expert.
       */

      const expert =
        activeExperts.get(id);

      if (!expert) {

        card.remove();

        return;
      }

      /**
       * Lifecycle cleanup.
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
       * Remove registry.
       */

      activeExperts.delete(id);

      /**
       * Remove UI.
       */

      card.remove();

      console.log(
        "[Engine] Expert removed:",
        id
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
 * Initial world state.
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
 * Initial propagation.
 */

propagateState();

/* ============================================================
 * BehavioralRulesEngine Hook
 * ========================================================== */

/**
 * Reserved future ecological routing.
 */

if (
  BehavioralRulesEngine
) {

  console.log(
    "[Engine] BehavioralRulesEngine detected."
  );
}
