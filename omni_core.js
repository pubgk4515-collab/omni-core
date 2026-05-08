/**
 * Central motherboard – manages AudioContext, Wasm/AudioWorklet bridge,
 * UI state, and the "Auto" director.
 *
 * Architecture: multiple expert modules (instances of the template blueprint)
 * each own a dedicated AudioWorkletNode that runs a copy of the Wasm DSP engine.
 */
import { ExpertModuleTemplate } from './expert_template.js';
import { ExpertWindModule } from './expert_wind.js';
import { ExpertModuleTemplate } from './expert_template.js';

// --- 1. Worklet processor source (created as a Blob) ---
function createWorkletCode() {
  // language=JavaScript
  return `
    // Global registry for Wasm instance and engine pointers
    class OmniProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this.wasmReady = false;
        this.enginePtr = 0;
        this.active = true;  // Play/Pause state

        // The main thread passes the raw Wasm binary via processorOptions
        const wasmBinary = options.processorOptions?.wasmBinary;
        if (!wasmBinary) {
          console.error('[OmniProcessor] No Wasm binary received');
          return;
        }

        // Compile and instantiate the Wasm module in the worklet scope
        WebAssembly.instantiate(wasmBinary, {
          env: {
            memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
            // Provide a minimal set of imports (emscripten style)
            emscripten_resize_heap: () => {},
            abort: () => { console.error('Wasm abort'); }
          }
        })
        .then(({ instance }) => {
          this.wasmInstance = instance;
          const exports = instance.exports;
          // Create a DSP engine instance
          this.enginePtr = exports.createEngine(sampleRate);
          if (!this.enginePtr) {
            console.error('Failed to create engine');
            return;
          }
          // Set the internal sound buffer (a small procedural buffer is used here)
          // In a full version we could load a custom buffer via message.
          exports.setEngineBufferFromDefault(this.enginePtr);
          this.wasmReady = true;
        })
        .catch(e => console.error('Wasm instantiation failed', e));

        this.port.onmessage = (e) => this.handleMessage(e.data);
      }

      handleMessage(data) {
        if (!this.wasmReady || !this.wasmInstance) return;
        const exports = this.wasmInstance.exports;

        if (data.type === 'setParams' && Array.isArray(data.values)) {
          // data.values is an array of [paramId, value]
          for (const [id, val] of data.values) {
            exports.setParameter(this.enginePtr, id, val);
          }
        } else if (data.type === 'setActive') {
          this.active = !!data.active;
        }
      }

      process(inputs, outputs, parameters) {
        const out = outputs[0];
        if (!out || !this.wasmReady) return true;

        // Mono processing for simplicity; adapt for stereo later.
        const channel = out[0];
        const frames = channel.length;

        if (this.active && this.wasmInstance) {
          const outputPtr = this.wasmInstance.exports.processAudio(
            this.enginePtr, frames
          );
          if (outputPtr) {
            // Copy processed samples back from Wasm memory
            const memory = this.wasmInstance.exports.memory;
            const wasmView = new Float32Array(memory.buffer, outputPtr, frames);
            channel.set(wasmView);
          } else {
            channel.fill(0);
          }
        } else {
          channel.fill(0);
        }
        return true;
      }
    }

    registerProcessor('omni-dsp-processor', OmniProcessor);
  `;
}

// --- 2. Main Audio Engine Controller ---
class OmniCore {
  constructor() {
    this.audioCtx = null;
    this.wasmBuffer = null;       // Raw ArrayBuffer of the Wasm module
    this.modules = [];            // Expert module instances
    this.tabsContainer = document.getElementById('tabsContainer');
    this.autoButton = document.getElementById('autoButton');
  }

  async boot() {
    // Initialize AudioContext on user interaction
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Load and compile Wasm binary once
    const response = await fetch('dsp_engine.wasm');
    this.wasmBuffer = await response.arrayBuffer();

    // Register the custom AudioWorklet processor
    const workletCode = createWorkletCode();
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioCtx.audioWorklet.addModule(workletUrl);

    // Create the initial set of expert modules (examples)
    const moduleConfigs = [
      { name: 'Deep Drone', class: ExpertModuleTemplate },
      { name: 'Procedural Wind', class: ExpertWindModule }
    ];
    
    moduleConfigs.forEach((cfg, idx) => {
        this._addExpertModule(cfg.name, idx, cfg.class);
    });


    // Wire UI interactions
    this.autoButton.addEventListener('click', () => this._autoDirector());
  }

  /**
   * Creates a new expert module, its dedicated Wasm AudioWorkletNode,
   * and the corresponding UI tab.
   */
  _addExpertModule(name, index, ModuleClass) {
    const expert = new ModuleClass(); // Ye dynamic class initiate karega
    const id = `${name}_${index}`;

    // Each module gets its own Wasm instance (copy of the binary)
    const bufferCopy = this.wasmBuffer.slice(0); // transferable clone
    const node = new AudioWorkletNode(this.audioCtx, 'omni-dsp-processor', {
      processorOptions: { wasmBinary: bufferCopy }
    });

    // Initialise the expert module
    expert.init(id, this.audioCtx, node);
    expert.toggle(false); // start muted
    this.modules.push(expert);

    // --- Build UI tab for this module ---
    const card = document.createElement('div');
    card.className = 'tab-card';
    card.dataset.moduleId = id;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'module-name';
    nameLabel.textContent = name;

    const sliderWrapper = document.createElement('div');
    sliderWrapper.className = 'slider-container';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0;
    slider.max = 1;
    slider.step = 0.01;
    slider.value = 0.5;
    slider.addEventListener('input', (e) => {
      expert.setSlider(parseFloat(e.target.value));
    });
    const valueDisplay = document.createElement('span');
    valueDisplay.style.color = '#ccc';
    valueDisplay.textContent = '0.50';
    slider.addEventListener('input', (e) => {
      valueDisplay.textContent = parseFloat(e.target.value).toFixed(2);
    });

    sliderWrapper.appendChild(slider);
    sliderWrapper.appendChild(valueDisplay);

    const btn = document.createElement('button');
    btn.className = 'play-pause-btn';
    btn.textContent = '▶';
    btn.addEventListener('click', () => {
      const isActive = btn.classList.toggle('active');
      btn.textContent = isActive ? '⏸' : '▶';
      expert.toggle(isActive);
    });

    card.appendChild(nameLabel);
    card.appendChild(sliderWrapper);
    card.appendChild(btn);
    this.tabsContainer.appendChild(card);
  }

  /**
   * "Auto" button director – randomizes the engine state using
   * a weighted probabilistic approach that ensures musical, non‑chaotic results.
   *
   * Steps:
   *  1. Choose 2–4 modules to target.
   *  2. For each, randomly toggle its active state with a bias toward
   *     keeping at least two modules running.
   *  3. Set sliders using a Gaussian distribution centered at 0.5
   *     (pure signal) with occasional excursions into Void/Overdrive.
   */
  _autoDirector() {
    const n = this.modules.length;
    if (n < 2) return;

    // Weighted selection: each module has a chance to be altered
    const targetCount = Math.floor(Math.random() * 3) + 2; // 2–4
    const indices = this._pickWeightedIndices(n, targetCount);

    indices.forEach(i => {
      const mod = this.modules[i];

      // Toggle: 40% chance to switch state (more likely to turn on than off)
      const shouldToggle = Math.random() < 0.4;
      if (shouldToggle) {
        const newState = !mod.isActive;
        // Bias: if fewer than 2 modules are active, always turn on
        const activeCount = this.modules.filter(m => m.isActive).length;
        const finalState = (activeCount < 2) ? true : newState;
        mod.toggle(finalState);

        // Update UI button
        const card = [...this.tabsContainer.children]
          .find(c => c.dataset.moduleId === mod.id);
        if (card) {
          const btn = card.querySelector('.play-pause-btn');
          btn.classList.toggle('active', finalState);
          btn.textContent = finalState ? '⏸' : '▶';
        }
      }

      // Slider: Gaussian-like distribution (central bias) with reduced extremes
      let raw = this._gaussianRandom(0.5, 0.15);
      raw = Math.min(1, Math.max(0, raw));
      // Occasionally push into Void or Overdrive when near edges
      if (raw < 0.1 && Math.random() < 0.3) raw = 0.02;
      if (raw > 0.9 && Math.random() < 0.3) raw = 0.98;

      mod.setSlider(raw);

      // Sync UI slider
      const card = [...this.tabsContainer.children]
        .find(c => c.dataset.moduleId === mod.id);
      if (card) {
        const slider = card.querySelector('input[type=range]');
        const span = card.querySelector('span');
        if (slider) {
          slider.value = raw;
          if (span) span.textContent = raw.toFixed(2);
        }
      }
    });
  }

  /* Utility: pick `count` distinct indices from 0..n-1 with higher
     probability for modules that are currently inactive (to keep variety). */
  _pickWeightedIndices(n, count) {
    const weights = this.modules.map(m => m.isActive ? 1 : 2);
    const chosen = [];
    const temp = [...weights];
    for (let c = 0; c < count; c++) {
      const total = temp.reduce((a,b)=>a+b,0);
      let rand = Math.random() * total;
      let idx = -1;
      for (let i=0; i<n; i++) {
        if (temp[i] === 0) continue;
        rand -= temp[i];
        if (rand <= 0) { idx = i; break; }
      }
      if (idx >= 0 && !chosen.includes(idx)) {
        chosen.push(idx);
        temp[idx] = 0; // do not pick again
      }
    }
    return chosen;
  }

  /* Gaussian random number (Box-Muller) */
  _gaussianRandom(mean, stdev) {
    let u = 1 - Math.random();
    let v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
  }
}

// --- Boot when DOM ready ---
document.addEventListener('DOMContentLoaded', async () => {
  const core = new OmniCore();
  // Simulate user gesture for AudioContext (tie to a tap if needed)
  // For demonstration, we start after a click anywhere.
  document.body.addEventListener('click', () => {
    if (core.audioCtx?.state === 'suspended') core.audioCtx.resume();
  }, { once: true });
  await core.boot();
});