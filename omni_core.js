// =====================================================================
// OmniEngine Auto-Director Bridge
// =====================================================================

const WORKLET_CODE = `
class OmniProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.wasmReady = false;
        this.engine = null;
        
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
            // Create the master engine (Type 0 handles the multi-routing now)
            this.engine = this.wasmExports.createEngine(sampleRate, 0);
            this.wasmReady = true;
            this.port.postMessage({ type: 'ready' });
        });

        this.port.onmessage = (e) => this.handleMessage(e.data);
    }

    handleMessage(data) {
        if (!this.wasmReady || !this.engine) return;
        
        if (data.type === 'setParam') {
            this.wasmExports.setParameter(this.engine, data.id, data.value);
        }
    }

    process(inputs, outputs, parameters) {
        const out = outputs;
        if (!out || !this.wasmReady) return true;
        
        const channel = out;
        const frames = channel.length;
        
        const ptr = this.wasmExports.processAudio(this.engine, frames);
        if (ptr) {
            const mem = this.wasmExports.memory;
            const view = new Float32Array(mem.buffer, ptr, frames);
            channel.set(view);
            // Copy to right channel for stereo spread
            if (out) out.set(view); 
        } else {
            channel.fill(0);
        }
        return true;
    }
}
registerProcessor('omni-processor', OmniProcessor);
`;

class AutoDirector {
    constructor() {
        this.ctx = null;
        this.node = null;
        this.isBooted = false;
        
        // UI Elements
        this.playBtn = document.getElementById('playBtn');
        this.genBtn = document.getElementById('generateBtn');
        this.droneSlider = document.getElementById('droneSlider');
        this.windSlider = document.getElementById('windSlider');
        this.vibeLabel = document.getElementById('vibeLabel');

        this.scales = ["Cinematic Space", "Himalayan Zen", "Cyberpunk Dystopia"];
        
        this.bindEvents();
    }

    bindEvents() {
        this.playBtn.onclick = () => this.bootEngine();
        this.genBtn.onclick = () => this.generateUniqueVibe();
        
        this.droneSlider.oninput = (e) => this.updateManual(0, e.target.value, 'val-drone');
        this.windSlider.oninput = (e) => this.updateManual(1, e.target.value, 'val-wind');
    }

    async bootEngine() {
        if (this.isBooted) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
                this.playBtn.innerText = "ACTIVE";
                this.playBtn.style.boxShadow = "0 0 40px rgba(255,255,255,0.2)";
            } else {
                this.ctx.suspend();
                this.playBtn.innerText = "PAUSED";
                this.playBtn.style.boxShadow = "none";
            }
            return;
        }

        this.playBtn.innerText = "LOADING...";
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        try {
            const resp = await fetch('dsp_engine.wasm');
            const wasmBuffer = await resp.arrayBuffer();

            const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
            await this.ctx.audioWorklet.addModule(URL.createObjectURL(blob));

            this.node = new AudioWorkletNode(this.ctx, 'omni-processor', {
                processorOptions: { wasmBinary: wasmBuffer }
            });
            this.node.connect(this.ctx.destination);

            this.isBooted = true;
            this.playBtn.innerText = "ACTIVE";
            this.playBtn.style.boxShadow = "0 0 40px rgba(255,255,255,0.2)";
            
            // Trigger first generation
            this.generateUniqueVibe();
            
        } catch (e) {
            this.playBtn.innerText = "ERROR";
            console.error(e);
        }
    }

    updateManual(type, value, labelId) {
        document.getElementById(labelId).innerText = Math.round(value * 100) + '%';
        if (!this.node) return;
        
        if (type === 0) {
            // Mapping Drone Intensity to Saturation/Filter trick to kill the 'refrigerator' hum
            this.node.port.postMessage({ type: 'setParam', id: 3, value: parseFloat(value) }); // Saturation
        } else if (type === 1) {
            this.node.port.postMessage({ type: 'setParam', id: 4, value: parseFloat(value) }); // Wind Intensity
            this.node.port.postMessage({ type: 'setParam', id: 5, value: 1 }); // Ensure wind engine triggers
        }
    }

    generateUniqueVibe() {
        if (!this.isBooted) {
            this.bootEngine().then(() => this.executeGeneration());
        } else {
            this.executeGeneration();
        }
    }

    executeGeneration() {
        // 1. Pick a mathematical mood (SCALE_ID: 0, 1, or 2)
        const scaleId = Math.floor(Math.random() * 3);
        const scaleName = this.scales[scaleId];

        // 2. Randomize Intensities
        const droneVal = (Math.random() * 0.7 + 0.3).toFixed(2); // Always keep some drone
        const windVal = (Math.random() * 0.8).toFixed(2);
        const verbVal = (Math.random() * 0.4 + 0.2).toFixed(2); // Reverb between 0.2 and 0.6

        // 3. Update UI
        this.droneSlider.value = droneVal;
        this.windSlider.value = windVal;
        document.getElementById('val-drone').innerText = Math.round(droneVal * 100) + '%';
        document.getElementById('val-wind').innerText = Math.round(windVal * 100) + '%';
        this.vibeLabel.innerText = `GENERATED: ${scaleName.toUpperCase()}`;

        // 4. Dispatch to C++ Wasm Worker
        this.node.port.postMessage({ type: 'setParam', id: 6, value: scaleId }); // Set Scale
        this.node.port.postMessage({ type: 'setParam', id: 1, value: parseFloat(verbVal) }); // Set Reverb Mix
        
        // Push slider values
        this.updateManual(0, droneVal, 'val-drone');
        this.updateManual(1, windVal, 'val-wind');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AutoDirector();
});
