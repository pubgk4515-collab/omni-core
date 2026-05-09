/**
 * app.js
 * Studio Glue Layer
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

const layers = [];

/* ============================================================
 * Init
 * ========================================================== */

async function initialize() {

  environment =
    new AcousticEnvironment();

  await environment.context.resume();

  sampleBank =
    new SampleBank(
      environment.context
    );

  scheduler =
    new AtomicScheduler();

  scheduler.start();
}

/* ============================================================
 * Layer Builders
 * ========================================================== */

function addRainLayer() {

  const rain =
    new ParticleRainSynth(
      environment
    );

  layers.push(rain);

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

  const slider =
    card.querySelector("input");

  slider.addEventListener(
    "input",
    (e) => {

      const value =
        Number(e.target.value);

      rain.update(value);

      WorldState
        .setRainIntensity(value);
    }
  );

  layerContainer.appendChild(
    card
  );
}

function addBirdLayer() {

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
    });

  scheduler.registerBehavior(
    birds
  );

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

  const slider =
    card.querySelector("input");

  slider.addEventListener(
    "input",
    (e) => {

      birds.baseRate =
        Number(e.target.value);
    }
  );

  layerContainer.appendChild(
    card
  );
}

/* ============================================================
 * Modal
 * ========================================================== */

addLayerBtn.addEventListener(
  "click",
  () => {

    layerModal.classList.add(
      "open"
    );
  }
);

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

document
  .querySelectorAll("[data-layer]")
  .forEach((btn) => {

    btn.addEventListener(
      "click",
      () => {

        const type =
          btn.dataset.layer;

        switch (type) {

          case "rain":
            addRainLayer();
            break;

          case "birds":
            addBirdLayer();
            break;
        }

        layerModal.classList.remove(
          "open"
        );
      }
    );
  });

/* ============================================================
 * Init Button
 * ========================================================== */

initBtn.addEventListener(
  "click",
  async () => {

    await initialize();

    initBtn.textContent =
      "Audio Active";
  }
);

/* ============================================================
 * Acoustics Loop
 * ========================================================== */

function frame() {

  if (environment) {
    environment
      .updateAcoustics();
  }

  requestAnimationFrame(
    frame
  );
}

frame();
