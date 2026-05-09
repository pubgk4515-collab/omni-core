/**
 * atmosphere_core.js
 * Modular Procedural Atmosphere Composition Engine
 *
 * Focus:
 * - Strict ES6 OOP architecture
 * - Web Audio API routing
 * - Encapsulated, scalable layer graph
 * - Safe teardown / memory hygiene
 * - Async buffer loading helpers
 *
 * No UI code.
 * No WebAssembly / C++.
 */

/* ============================================================
 * Utilities
 * ========================================================== */

/**
 * Safely disconnects an AudioNode or AudioParam-connected graph.
 * Web Audio nodes often throw if disconnected redundantly; this helper
 * makes teardown idempotent.
 * @param {AudioNode|AudioParam|null|undefined} node
 */
function safeDisconnect(node) {
  if (!node) return;
  try {
    if (typeof node.disconnect === "function") {
      node.disconnect();
    }
  } catch (_) {
    // Intentionally swallow disconnect errors during cleanup.
  }
}

/**
 * Safe assignment for AudioParam smoothing.
 * @param {AudioParam} param
 * @param {number} value
 * @param {BaseAudioContext} context
 * @param {number} smoothTime
 */
function setSmoothedParam(param, value, context, smoothTime = 0.02) {
  if (!param || !context) return;

  const now = context.currentTime;
  const target = Number.isFinite(value) ? value : param.value;

  try {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);

    if (smoothTime > 0) {
      param.linearRampToValueAtTime(target, now + smoothTime);
    } else {
      param.setValueAtTime(target, now);
    }
  } catch (_) {
    // Fallback for browsers with stricter scheduling behavior.
    try {
      param.value = target;
    } catch (_) {}
  }
}

/**
 * Clamps a numeric value.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Resolves to an ArrayBuffer from a URL.
 * @param {string} url
 * @param {RequestInit} [fetchOptions]
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchArrayBuffer(url, fetchOptions = {}) {
  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    throw new Error(`Failed to fetch audio data: ${res.status} ${res.statusText}`);
  }
  return await res.arrayBuffer();
}

/**
 * Decodes audio data in a browser-safe way.
 * @param {BaseAudioContext} context
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioData(context, arrayBuffer) {
  if (!context) {
    throw new Error("AudioContext is not available.");
  }

  // Modern browsers return a Promise; older ones require callbacks.
  const result = context.decodeAudioData(arrayBuffer);
  if (result && typeof result.then === "function") {
    return await result;
  }

  return await new Promise((resolve, reject) => {
    context.decodeAudioData(arrayBuffer, resolve, reject);
  });
}

/* ============================================================
 * AtmosphereLayer
 * ========================================================== */

/**
 * A single environmental layer with its own internal routing:
 *
 * Source -> BiquadFilter -> StereoPanner -> LayerGain -> Master Bus
 *                                                      \-> Reverb Send Bus
 *
 * Source can be:
 * - BufferSource (sample playback)
 * - MediaStreamAudioSourceNode
 * - AudioWorkletNode
 * - Any AudioNode that outputs audio
 */
export class AtmosphereLayer {
  /**
   * @param {object} params
   * @param {string} params.id - Unique layer identifier.
   * @param {string} [params.type="generic"] - Semantic layer type label.
   * @param {BaseAudioContext} params.context - Shared AudioContext from engine.
   * @param {GainNode} params.masterInput - Engine master summing input.
   * @param {GainNode} params.reverbInput - Engine reverb send summing input.
   * @param {object} [params.options={}] - Initial layer options.
   */
  constructor({
    id,
    type = "generic",
    context,
    masterInput,
    reverbInput,
    options = {},
  }) {
    if (!id) throw new Error("AtmosphereLayer requires a valid id.");
    if (!context) throw new Error("AtmosphereLayer requires an AudioContext.");
    if (!masterInput) throw new Error("AtmosphereLayer requires a master input node.");
    if (!reverbInput) throw new Error("AtmosphereLayer requires a reverb input node.");

    this._id = id;
    this._type = type;
    this._context = context;
    this._masterInput = masterInput;
    this._reverbInput = reverbInput;

    this._disposed = false;

    // Internal node graph.
    this._sourceNode = null;        // Current attached source node (or active BufferSource).
    this._sourceMode = "none";      // "none" | "buffer" | "persistent"
    this._buffer = null;            // Stored AudioBuffer for sample playback.

    this._filterNode = context.createBiquadFilter();
    this._pannerNode = context.createStereoPanner();
    this._layerGain = context.createGain();
    this._reverbSendGain = context.createGain();

    // Defaults tuned for environmental content.
    this._filterNode.type = options.filterType || "lowpass";
    this._filterNode.frequency.value = options.filterFreq ?? 20000;
    this._filterNode.Q.value = options.filterQ ?? 0.707;

    this._pannerNode.pan.value = options.pan ?? 0;

    this._layerGain.gain.value = options.volume ?? 1.0;
    this._reverbSendGain.gain.value = options.reverbSend ?? 0.0;

    // Internal leaf routing:
    // source -> filter -> panner -> gain -> master
    //                                      \-> reverb send -> engine reverb input
    this._connectInternalGraph();

    // Optional immediate source binding.
    if (options.source instanceof AudioNode) {
      this.attachSource(options.source);
    }

    if (options.buffer instanceof AudioBuffer) {
      this.setBuffer(options.buffer, {
        loop: Boolean(options.loop),
        playbackRate: options.playbackRate ?? 1.0,
      });
    }
  }

  /**
   * Unique id of this layer.
   * @returns {string}
   */
  get id() {
    return this._id;
  }

  /**
   * Semantic type of this layer.
   * @returns {string}
   */
  get type() {
    return this._type;
  }

  /**
   * Whether this layer has been destroyed.
   * @returns {boolean}
   */
  get disposed() {
    return this._disposed;
  }

  /**
   * Current connected source node, if any.
   * @returns {AudioNode|null}
   */
  get sourceNode() {
    return this._sourceNode;
  }

  /**
   * Access to the internal layer gain node for advanced automation.
   * @returns {GainNode}
   */
  get gainNode() {
    return this._layerGain;
  }

  /**
   * Access to the filter node for advanced automation.
   * @returns {BiquadFilterNode}
   */
  get filterNode() {
    return this._filterNode;
  }

  /**
   * Access to the panner node for advanced automation.
   * @returns {StereoPannerNode}
   */
  get pannerNode() {
    return this._pannerNode;
  }

  /**
   * Access to the reverb send gain.
   * @returns {GainNode}
   */
  get reverbSendNode() {
    return this._reverbSendGain;
  }

  /**
   * Connects the layer graph to engine buses.
   * @private
   */
  _connectInternalGraph() {
    // Ensure a clean reconnect state.
    safeDisconnect(this._filterNode);
    safeDisconnect(this._pannerNode);
    safeDisconnect(this._layerGain);
    safeDisconnect(this._reverbSendGain);

    // Chain: filter -> panner -> gain
    this._filterNode.connect(this._pannerNode);
    this._pannerNode.connect(this._layerGain);

    // Dry to master bus.
    this._layerGain.connect(this._masterInput);

    // Wet to reverb send bus.
    this._layerGain.connect(this._reverbSendGain);
    this._reverbSendGain.connect(this._reverbInput);
  }

  /**
   * Attaches a persistent source node to the layer.
   * Use this for MediaStreamAudioSourceNode / AudioWorkletNode / other persistent nodes.
   *
   * @param {AudioNode} sourceNode
   * @returns {AtmosphereLayer}
   */
  attachSource(sourceNode) {
    if (this._disposed) throw new Error(`Layer "${this._id}" is disposed.`);
    if (!(sourceNode instanceof AudioNode)) {
      throw new TypeError("attachSource expects an AudioNode.");
    }

    // Detach any existing source first.
    this.detachSource();

    this._sourceNode = sourceNode;
    this._sourceMode = "persistent";

    sourceNode.connect(this._filterNode);
    return this;
  }

  /**
   * Stores an AudioBuffer for sample playback.
   * This does not start playback until play() is called.
   *
   * @param {AudioBuffer} buffer
   * @param {object} [options={}]
   * @param {boolean} [options.loop=false]
   * @param {number} [options.playbackRate=1.0]
   * @returns {AtmosphereLayer}
   */
  setBuffer(buffer, { loop = false, playbackRate = 1.0 } = {}) {
    if (this._disposed) throw new Error(`Layer "${this._id}" is disposed.`);
    if (!(buffer instanceof AudioBuffer)) {
      throw new TypeError("setBuffer expects an AudioBuffer.");
    }

    this._buffer = buffer;
    this._bufferLoop = Boolean(loop);
    this._bufferPlaybackRate = Number.isFinite(playbackRate) ? playbackRate : 1.0;

    return this;
  }

  /**
   * Loads a sample buffer from a URL and stores it in the layer.
   *
   * @param {string} url
   * @param {object} [options={}]
   * @param {RequestInit} [options.fetchOptions]
   * @param {boolean} [options.loop=false]
   * @param {number} [options.playbackRate=1.0]
   * @returns {Promise<AtmosphereLayer>}
   */
  async loadBuffer(url, { fetchOptions = {}, loop = false, playbackRate = 1.0 } = {}) {
    if (this._disposed) throw new Error(`Layer "${this._id}" is disposed.`);
    const arrayBuffer = await fetchArrayBuffer(url, fetchOptions);
    const audioBuffer = await decodeAudioData(this._context, arrayBuffer);
    this.setBuffer(audioBuffer, { loop, playbackRate });
    return this;
  }

  /**
   * Creates and starts a one-shot BufferSource from the stored buffer.
   * Each call generates a fresh source node, which is required by Web Audio.
   *
   * @param {object} [options={}]
   * @param {number} [options.when=0]
   * @param {number} [options.offset=0]
   * @param {number} [options.duration]
   * @param {boolean} [options.loop]
   * @param {number} [options.playbackRate]
   * @returns {AudioBufferSourceNode}
   */
  play({ when = 0, offset = 0, duration, loop, playbackRate } = {}) {
    if (this._disposed) throw new Error(`Layer "${this._id}" is disposed.`);
    if (!(this._buffer instanceof AudioBuffer)) {
      throw new Error(`Layer "${this._id}" has no AudioBuffer loaded.`);
    }

    // Stop any previous buffer source safely.
    if (this._sourceMode === "buffer" && this._sourceNode) {
      try {
        this._sourceNode.stop();
      } catch (_) {}
      this.detachSource();
    }

    const src = this._context.createBufferSource();
    src.buffer = this._buffer;
    src.loop = loop ?? this._bufferLoop ?? false;
    src.playbackRate.value = playbackRate ?? this._bufferPlaybackRate ?? 1.0;

    src.connect(this._filterNode);

    src.onended = () => {
      // Only auto-cleanup if this is still the current source.
      if (this._sourceNode === src) {
        this.detachSource();
      } else {
        safeDisconnect(src);
      }
    };

    this._sourceNode = src;
    this._sourceMode = "buffer";

    // Start after connecting.
    if (typeof duration === "number") {
      src.start(when, offset, duration);
    } else {
      src.start(when, offset);
    }

    return src;
  }

  /**
   * Stops a currently playing BufferSource, if the layer is in buffer mode.
   *
   * @param {number} [when=0]
   * @returns {AtmosphereLayer}
   */
  stop(when = 0) {
    if (this._disposed) return this;
    if (this._sourceMode === "buffer" && this._sourceNode) {
      try {
        this._sourceNode.stop(when);
      } catch (_) {
        // Ignore if already stopped or invalid timing.
      }
    }
    return this;
  }

  /**
   * Removes the currently attached source and cleans up connections.
   * For persistent sources, this disconnects the input chain.
   * For buffer sources, this also clears the current active node reference.
   *
   * @returns {AtmosphereLayer}
   */
  detachSource() {
    if (this._disposed) return this;

    if (this._sourceNode) {
      safeDisconnect(this._sourceNode);
      this._sourceNode = null;
    }

    this._sourceMode = "none";
    return this;
  }

  /**
   * Sets layer volume with optional smoothing.
   *
   * @param {number} val - Linear gain value. Typical range 0.0 to 1.0+.
   * @param {number} [smoothTime=0.02] - Ramp duration in seconds.
   * @returns {AtmosphereLayer}
   */
  setVolume(val, smoothTime = 0.02) {
    if (this._disposed) return this;
    const target = Math.max(0, Number.isFinite(val) ? val : this._layerGain.gain.value);
    setSmoothedParam(this._layerGain.gain, target, this._context, smoothTime);
    return this;
  }

  /**
   * Sets stereo pan.
   *
   * @param {number} val - Range typically from -1 (left) to +1 (right).
   * @returns {AtmosphereLayer}
   */
  setPan(val) {
    if (this._disposed) return this;
    const target = clamp(Number.isFinite(val) ? val : 0, -1, 1);
    try {
      this._pannerNode.pan.value = target;
    } catch (_) {}
    return this;
  }

  /**
   * Sets filter frequency and resonance Q.
   *
   * @param {number} freq
   * @param {number} q
   * @returns {AtmosphereLayer}
   */
  setFilter(freq, q) {
    if (this._disposed) return this;

    const safeFreq = Number.isFinite(freq) ? clamp(freq, 10, this._context.sampleRate / 2) : this._filterNode.frequency.value;
    const safeQ = Number.isFinite(q) ? Math.max(0.0001, q) : this._filterNode.Q.value;

    try {
      this._filterNode.frequency.setValueAtTime(safeFreq, this._context.currentTime);
      this._filterNode.Q.setValueAtTime(safeQ, this._context.currentTime);
    } catch (_) {
      try {
        this._filterNode.frequency.value = safeFreq;
        this._filterNode.Q.value = safeQ;
      } catch (_) {}
    }

    return this;
  }

  /**
   * Sets the wet send level into the global reverb bus.
   * This is optional but useful for environmental depth control.
   *
   * @param {number} val
   * @param {number} [smoothTime=0.02]
   * @returns {AtmosphereLayer}
   */
  setReverbSend(val, smoothTime = 0.02) {
    if (this._disposed) return this;
    const target = Math.max(0, Number.isFinite(val) ? val : this._reverbSendGain.gain.value);
    setSmoothedParam(this._reverbSendGain.gain, target, this._context, smoothTime);
    return this;
  }

  /**
   * Returns a lightweight parameter snapshot for automation or inspection.
   * @returns {object}
   */
  getState() {
    return {
      id: this._id,
      type: this._type,
      disposed: this._disposed,
      sourceMode: this._sourceMode,
      hasBuffer: this._buffer instanceof AudioBuffer,
      volume: this._layerGain.gain.value,
      pan: this._pannerNode.pan.value,
      filterFreq: this._filterNode.frequency.value,
      filterQ: this._filterNode.Q.value,
      reverbSend: this._reverbSendGain.gain.value,
    };
  }

  /**
   * Destroys the layer and releases references for GC.
   * Safe to call multiple times.
   *
   * @returns {void}
   */
  destroy() {
    if (this._disposed) return;
    this._disposed = true;

    // Stop buffer playback if active.
    if (this._sourceMode === "buffer" && this._sourceNode) {
      try {
        this._sourceNode.stop();
      } catch (_) {}
    }

    // Disconnect source and internal nodes.
    this.detachSource();

    safeDisconnect(this._filterNode);
    safeDisconnect(this._pannerNode);
    safeDisconnect(this._layerGain);
    safeDisconnect(this._reverbSendGain);

    // Null out references for memory hygiene.
    this._buffer = null;
    this._sourceNode = null;
    this._masterInput = null;
    this._reverbInput = null;
    this._context = null;

    // Keep node references null-safe after destroy.
    this._filterNode = null;
    this._pannerNode = null;
    this._layerGain = null;
    this._reverbSendGain = null;
  }
}

/* ============================================================
 * AtmosphereEngine
 * ========================================================== */

/**
 * Main audio engine that manages:
 * - AudioContext lifecycle
 * - Master bus
 * - Limiter / compressor
 * - Global reverb bus
 * - Unlimited AtmosphereLayer instances
 */
export class AtmosphereEngine {
  /**
   * @param {object} [options={}]
   * @param {AudioContext} [options.context] - Optional pre-existing AudioContext.
   * @param {string} [options.reverbImpulseUrl] - Optional impulse response URL.
   * @param {number} [options.masterGain=1.0] - Final output gain.
   * @param {object} [options.compressor={}] - Compressor settings.
   */
  constructor(options = {}) {
    this._providedContext = options.context || null;
    this._context = options.context || null;

    this._layers = new Map();
    this._isInitialized = false;
    this._disposed = false;

    this._masterInput = null;      // Dry layer sum and wet return sum feed here.
    this._masterCompressor = null; // Final limiter / glue compressor.
    this._masterGain = null;       // Output trim before destination.
    this._reverbInput = null;      // Wet sends arrive here.
    this._reverbConvolver = null;
    this._reverbWetGain = null;
    this._reverbDryGain = null;

    this._masterGainValue = Number.isFinite(options.masterGain) ? options.masterGain : 1.0;

    this._compressorConfig = {
      threshold: options.compressor?.threshold ?? -12,
      knee: options.compressor?.knee ?? 30,
      ratio: options.compressor?.ratio ?? 12,
      attack: options.compressor?.attack ?? 0.003,
      release: options.compressor?.release ?? 0.25,
    };

    this._reverbImpulseUrl = options.reverbImpulseUrl || null;
  }

  /**
   * Returns the shared AudioContext, if initialized.
   * @returns {AudioContext|null}
   */
  get context() {
    return this._context;
  }

  /**
   * Returns whether the engine has been initialized.
   * @returns {boolean}
   */
  get initialized() {
    return this._isInitialized;
  }

  /**
   * Returns a read-only view of the active layer ids.
   * @returns {string[]}
   */
  get layerIds() {
    return Array.from(this._layers.keys());
  }

  /**
   * Returns the number of active layers.
   * @returns {number}
   */
  get layerCount() {
    return this._layers.size;
  }

  /**
   * Sets up the AudioContext and master routing.
   * Must be called before creating layers or starting audio.
   *
   * @returns {Promise<AtmosphereEngine>}
   */
  async init() {
    if (this._disposed) throw new Error("AtmosphereEngine is disposed.");
    if (this._isInitialized) return this;

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this._context) {
      if (!AC) {
        throw new Error("Web Audio API is not supported in this environment.");
      }
      this._context = new AC();
    }

    // Resume in a user-gesture-safe way.
    if (this._context.state === "suspended") {
      await this._context.resume();
    }

    this._buildMasterRouting();

    if (this._reverbImpulseUrl) {
      try {
        await this.loadReverbImpulse(this._reverbImpulseUrl);
      } catch (err) {
        // The engine still works without an impulse response.
        console.warn("[AtmosphereEngine] Reverb impulse load failed:", err);
      }
    }

    this._isInitialized = true;
    return this;
  }

  /**
   * Builds the master routing graph:
   *
   * layer dry sends -> masterInput -> compressor -> masterGain -> destination
   * layer wet sends -> reverbInput -> convolver -> reverbWetGain -> masterInput
   */
  _buildMasterRouting() {
    const ctx = this._context;

    // Tear down any prior routing safely.
    safeDisconnect(this._masterInput);
    safeDisconnect(this._reverbInput);
    safeDisconnect(this._reverbConvolver);
    safeDisconnect(this._reverbWetGain);
    safeDisconnect(this._reverbDryGain);
    safeDisconnect(this._masterCompressor);
    safeDisconnect(this._masterGain);

    this._masterInput = ctx.createGain();
    this._reverbInput = ctx.createGain();
    this._reverbConvolver = ctx.createConvolver();
    this._reverbWetGain = ctx.createGain();
    this._reverbDryGain = ctx.createGain();
    this._masterCompressor = ctx.createDynamicsCompressor();
    this._masterGain = ctx.createGain();

    // Default reverb mix: fully wet return is controlled by reverbWetGain.
    // The reverb bus can be subtle or aggressive via impulse + send levels.
    this._reverbWetGain.gain.value = 1.0;
    this._reverbDryGain.gain.value = 0.0; // Kept for future flexibility / architecture completeness.

    // Compressor defaults.
    const c = this._compressorConfig;
    try {
      this._masterCompressor.threshold.value = c.threshold;
      this._masterCompressor.knee.value = c.knee;
      this._masterCompressor.ratio.value = c.ratio;
      this._masterCompressor.attack.value = c.attack;
      this._masterCompressor.release.value = c.release;
    } catch (_) {}

    this._masterGain.gain.value = this._masterGainValue;

    // Routing:
    // reverbInput -> convolver -> wetGain -> masterInput
    this._reverbInput.connect(this._reverbConvolver);
    this._reverbConvolver.connect(this._reverbWetGain);
    this._reverbWetGain.connect(this._masterInput);

    // Final output: masterInput -> compressor -> masterGain -> destination
    this._masterInput.connect(this._masterCompressor);
    this._masterCompressor.connect(this._masterGain);
    this._masterGain.connect(this._context.destination);
  }

  /**
   * Creates and registers a new AtmosphereLayer.
   *
   * @param {string} id
   * @param {string} [type="generic"]
   * @param {object} [options={}]
   * @returns {AtmosphereLayer}
   */
  createLayer(id, type = "generic", options = {}) {
    if (this._disposed) throw new Error("AtmosphereEngine is disposed.");
    if (!this._isInitialized) {
      throw new Error("Call init() before creating layers.");
    }
    if (!id) throw new Error("createLayer requires a valid id.");
    if (this._layers.has(id)) {
      throw new Error(`Layer with id "${id}" already exists.`);
    }

    const layer = new AtmosphereLayer({
      id,
      type,
      context: this._context,
      masterInput: this._masterInput,
      reverbInput: this._reverbInput,
      options,
    });

    this._layers.set(id, layer);
    return layer;
  }

  /**
   * Retrieves a layer by id.
   *
   * @param {string} id
   * @returns {AtmosphereLayer|undefined}
   */
  getLayer(id) {
    return this._layers.get(id);
  }

  /**
   * Removes a layer, disconnects it, and frees references.
   *
   * @param {string} id
   * @returns {boolean} True if removed, false if not found.
   */
  removeLayer(id) {
    if (this._disposed) return false;

    const layer = this._layers.get(id);
    if (!layer) return false;

    try {
      layer.destroy();
    } catch (err) {
      console.warn(`[AtmosphereEngine] Failed to destroy layer "${id}":`, err);
    }

    this._layers.delete(id);
    return true;
  }

  /**
   * Removes all layers safely.
   *
   * @returns {void}
   */
  clearLayers() {
    for (const id of this._layers.keys()) {
      this.removeLayer(id);
    }
  }

  /**
   * Loads a convolution impulse response for the global reverb bus.
   *
   * @param {string} url
   * @param {RequestInit} [fetchOptions={}]
   * @returns {Promise<AudioBuffer>}
   */
  async loadReverbImpulse(url, fetchOptions = {}) {
    if (this._disposed) throw new Error("AtmosphereEngine is disposed.");
    if (!this._isInitialized) {
      throw new Error("Call init() before loading impulse responses.");
    }

    const arrayBuffer = await fetchArrayBuffer(url, fetchOptions);
    const audioBuffer = await decodeAudioData(this._context, arrayBuffer);

    this.setReverbImpulse(audioBuffer);
    return audioBuffer;
  }

  /**
   * Directly sets the global reverb impulse buffer.
   *
   * @param {AudioBuffer|null} buffer
   * @returns {AtmosphereEngine}
   */
  setReverbImpulse(buffer) {
    if (this._disposed) return this;
    if (!this._isInitialized) {
      throw new Error("Call init() before setting reverb impulse.");
    }

    if (buffer !== null && !(buffer instanceof AudioBuffer)) {
      throw new TypeError("setReverbImpulse expects an AudioBuffer or null.");
    }

    try {
      this._reverbConvolver.buffer = buffer;
    } catch (err) {
      throw new Error(`Failed to set reverb impulse buffer: ${err.message || err}`);
    }

    return this;
  }

  /**
   * Adjusts the master output gain.
   *
   * @param {number} val
   * @param {number} [smoothTime=0.02]
   * @returns {AtmosphereEngine}
   */
  setMasterGain(val, smoothTime = 0.02) {
    if (this._disposed) return this;
    if (!this._masterGain) return this;

    const target = Math.max(0, Number.isFinite(val) ? val : this._masterGain.gain.value);
    setSmoothedParam(this._masterGain.gain, target, this._context, smoothTime);
    return this;
  }

  /**
   * Suspends the AudioContext.
   * @returns {Promise<void>}
   */
  async suspend() {
    if (this._context && this._context.state !== "closed") {
      await this._context.suspend();
    }
  }

  /**
   * Resumes the AudioContext.
   * @returns {Promise<void>}
   */
  async resume() {
    if (this._context && this._context.state !== "closed") {
      await this._context.resume();
    }
  }

  /**
   * Destroys all layers, disconnects the master graph, and closes the context if owned.
   * Safe to call multiple times.
   *
   * @returns {Promise<void>}
   */
  async dispose() {
    if (this._disposed) return;
    this._disposed = true;

    this.clearLayers();

    safeDisconnect(this._masterInput);
    safeDisconnect(this._reverbInput);
    safeDisconnect(this._reverbConvolver);
    safeDisconnect(this._reverbWetGain);
    safeDisconnect(this._reverbDryGain);
    safeDisconnect(this._masterCompressor);
    safeDisconnect(this._masterGain);

    this._masterInput = null;
    this._reverbInput = null;
    this._reverbConvolver = null;
    this._reverbWetGain = null;
    this._reverbDryGain = null;
    this._masterCompressor = null;
    this._masterGain = null;

    // Close the context only if the engine created/owns it.
    // If a context was injected externally, leave lifecycle control to caller.
    if (this._context && !this._providedContext) {
      try {
        await this._context.close();
      } catch (_) {}
    }

    this._context = null;
    this._isInitialized = false;
  }

  /**
   * Snapshot of engine state for diagnostics.
   * @returns {object}
   */
  getState() {
    return {
      initialized: this._isInitialized,
      disposed: this._disposed,
      layerCount: this._layers.size,
      layerIds: this.layerIds.slice(),
      masterGain: this._masterGain ? this._masterGain.gain.value : null,
      contextState: this._context ? this._context.state : null,
    };
  }
}

/* ============================================================
 * Default Export
 * ========================================================== */

export default AtmosphereEngine;
