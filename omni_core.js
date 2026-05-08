import { ExpertModuleTemplate } from './expert_template.js';
import { ExpertWindModule } from './expert_wind.js';

// ------------------------- AudioWorklet Processor (Blob) -------------------------
function createWorkletCode() {
  return `
    class OmniProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this.wasmReady = false;
        this.engine = 0;
        this.active = true;

        const wasmBinary = options.processorOptions?.wasmBinary;
        if (!wasmBinary) return;

        WebAssembly.instantiate(wasmBinary, {
          env: {
            memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
            emscripten_resize_heap: () => {},
            abort: () => {}
          }
        }).then(({ instance }) => {
          this.wasmExports = instance.exports;
          // Create engine with default type 0; real type is set via message
          this.engine = this.wasmExports.createEngine(sampleRate, 0);
          this.wasmReady = true;
        });

        this.port.onmessage = (e) => this.handleMessage(e.data);
      }

      handleMessage(data) {
        if (!this.wasmReady) return;
        const exp = this.wasmExports;
        if (data.type === 'init' && data.engineType != null) {
          // Switch engine type (will re‑init inside)
          exp.setParameter(this.engine, 5, data.engineType);
          // Actually our C++ setParameter for ENGINE_TYPE does nothing; we call create again?
          // Better: destroy and recreate with correct type.
          exp.destroyEngine(this.engine);
          this.engine = exp.createEngine(sampleRate, data.engineType);
        } else if (data.type === 'setParams' && Array.isArray(data.values)) {
          for (const [id, val] of data.values) {
            exp.setParameter(this.engine, id, val);
          }
        } else if (data.type === 'setActive') {
          this.active = !!data.active;
        }
      }

      process(inputs, outputs, parameters) {
        const out = outputs[0];
        if (!out || !this.wasmReady) return true;
        const channel = out[0];
        const frames = channel.length;
        if (this.active) {
          const ptr = this.wasmExports.processAudio(this.engine, frames);
          if (ptr) {
            const mem = this.wasmExports.memory;
            const view = new Float32Array(mem.buffer, ptr, frames);
            channel.set(view);
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

// ------------------------- OmniCore (Motherboard) -------------------------
class OmniCore {
  constructor() {
    this.audioCtx = null;
    this.wasmBuffer = null;
    this.modules = [];
    this.tabsContainer = document.getElementById('tabsContainer');
    this.autoButton = document.getElementById('autoButton');
  }

  async boot() {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Load Wasm binary once
    const resp = await fetch('dsp_engine.wasm');
    this.wasmBuffer = await resp.arrayBuffer();

    // Register processor
    const blob = new Blob([createWorkletCode()], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this.audioCtx.audioWorklet.addModule(url);

    // Create modules – Drone (type 0) and Wind (type 1)
    const drone = new ExpertModuleTemplate();
    const wind = new ExpertWindModule();
    this._addModule('Drone', drone, 0);
    this._addModule('Wind', wind, 1);

    this.autoButton.onclick = () => this._autoDirector();
  }

  _addModule(name, expertInstance, engineType) {
    const node = new AudioWorkletNode(this.audioCtx, 'omni-dsp-processor', {
      processorOptions: { wasmBinary: this.wasmBuffer }
    });
    const id = `${name}_${engineType}`;
    expertInstance.init(id, this.audioCtx, node);
    expertInstance.toggle(false);
    this.modules.push({ instance: expertInstance, id, name });

    // Build UI tab (same structure as before)
    const card = document.createElement('div');
    card.className = 'tab-card';
    const nameLbl = document.createElement('div');
    nameLbl.className = 'module-name';
    nameLbl.textContent = name;
    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'slider-container';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = 0.01; slider.value = 0.5;
    const valSpan = document.createElement('span'); valSpan.style.color = '#ccc'; valSpan.textContent = '0.50';
    slider.oninput = () => {
      valSpan.textContent = parseFloat(slider.value).toFixed(2);
      expertInstance.setSlider(parseFloat(slider.value));
    };
    const btn = document.createElement('button');
    btn.className = 'play-pause-btn'; btn.textContent = '▶';
    btn.onclick = () => {
      const active = btn.classList.toggle('active');
      btn.textContent = active ? '⏸' : '▶';
      expertInstance.toggle(active);
    };
    sliderWrap.appendChild(slider); sliderWrap.appendChild(valSpan);
    card.appendChild(nameLbl); card.appendChild(sliderWrap); card.appendChild(btn);
    this.tabsContainer.appendChild(card);
  }

  _autoDirector() {
    // Randomise 1‑2 modules (non‑chaotic, weighted)
    const count = Math.floor(Math.random() * 2) + 1;
    const indices = [];
    while (indices.length < count) {
      const i = Math.floor(Math.random() * this.modules.length);
      if (!indices.includes(i)) indices.push(i);
    }
    indices.forEach(i => {
      const modObj = this.modules[i];
      const mod = modObj.instance;
      if (Math.random() < 0.5) {
        mod.toggle(true);
        const card = [...this.tabsContainer.children][i];
        card.querySelector('.play-pause-btn').classList.add('active');
        card.querySelector('.play-pause-btn').textContent = '⏸';
      }
      const val = 0.1 + Math.random() * 0.8;
      mod.setSlider(val);
      const slider = [...this.tabsContainer.children][i].querySelector('input[type=range]');
      slider.value = val;
      slider.nextElementSibling.textContent = val.toFixed(2);
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const core = new OmniCore();
  document.body.addEventListener('click', () => {
    if (core.audioCtx?.state === 'suspended') core.audioCtx.resume();
  }, { once: true });
  await core.boot();
});