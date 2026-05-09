/**
 * wasm_adapter.js
 * Phase 3 — WebAssembly AudioWorklet Bridge
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 * This module bridges:
 *
 *   WebAssembly DSP Engine
 *                ↕
 *        AudioWorkletProcessor
 *                ↕
 *          AudioWorkletNode
 *                ↕
 *         AtmosphereLayer
 *                ↕
 *         AtmosphereEngine
 *
 * ------------------------------------------------------------
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 * The AtmosphereLayer MUST remain completely agnostic.
 *
 * The layer should NOT know:
 * - whether sound is sample-based
 * - procedural
 * - synthesized
 * - WebAssembly powered
 *
 * It ONLY sees:
 *     "an AudioNode source"
 *
 * This adapter encapsulates:
 * - Wasm loading
 * - Worklet injection
 * - parameter routing
 * - message passing
 * - lifecycle cleanup
 *
 * ------------------------------------------------------------
 * FEATURES
 * ------------------------------------------------------------
 * - Safe Wasm loading
 * - Inline AudioWorkletProcessor injection
 * - AudioWorkletNode creation
 * - Persistent source attachment
 * - Parameter updates
 * - Scale control abstraction
 * - Memory-safe teardown
 *
 * ------------------------------------------------------------
 * REQUIREMENTS
 * ------------------------------------------------------------
 * Depends on:
 * - atmosphere_core.js
 *
 * Assumes:
 * - AtmosphereEngine is initialized
 * - Target layer already exists
 *
 * No UI code.
 * Pure ES6 OOP architecture.
 */

/* ============================================================
 * Constants
 * ========================================================== */

/**
 * Reserved DSP parameter IDs.
 * These IDs must match the DSP engine.
 */
export const WASM_PARAMS = Object.freeze({
  MASTER_GAIN: 0,
  FILTER_CUTOFF: 1,
  FILTER_RESONANCE: 2,
  TEXTURE_AMOUNT: 3,
  MOD_DEPTH: 4,
  MOD_RATE: 5,

  /**
   * Explicitly requested:
   * SCALE_ID = Param ID 6
   */
  SCALE_ID: 6,
});

/* ============================================================
 * Utility Helpers
 * ========================================================== */

/**
 * Safe disconnect helper.
 * @param {AudioNode|null|undefined} node
 */
function safeDisconnect(node) {
  if (!node) return;

  try {
    node.disconnect();
  } catch (_) {}
}

/**
 * Fetches a WASM binary safely.
 * @param {string} url
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchWasmBinary(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to load WASM binary: ${response.status} ${response.statusText}`
    );
  }

  return await response.arrayBuffer();
}

/* ============================================================
 * Inline AudioWorklet Processor Source
 * ========================================================== */

/**
 * Generates inline AudioWorkletProcessor source.
 *
 * The processor:
 * - receives compiled wasm bytes
 * - instantiates WASM INSIDE audio thread
 * - processes audio per render quantum
 * - accepts parameter messages
 *
 * IMPORTANT:
 * This is intentionally generic.
 * Actual DSP exports may differ depending on your C++/Rust engine.
 */
function createWorkletProcessorSource() {
  return `
class OmniWasmProcessor extends AudioWorkletProcessor {

  constructor() {
    super();

    /**
     * WebAssembly state
     */
    this.wasmInstance = null;
    this.wasmReady = false;

    /**
     * Parameter store.
     * JS-side fallback cache.
     */
    this.params = new Map();

    /**
     * DSP exports
     */
    this.processFn = null;

    /**
     * Receive messages from main thread.
     */
    this.port.onmessage = async (event) => {
      const data = event.data;

      try {

        switch (data.type) {

          case 'INIT_WASM':
            await this.initWasm(data.wasmBytes);
            break;

          case 'SET_PARAM':
            this.setParam(data.paramId, data.value);
            break;

          default:
            break;
        }

      } catch (err) {
        this.port.postMessage({
          type: 'ERROR',
          message: err.message || String(err)
        });
      }
    };
  }

  /**
   * Instantiate WebAssembly inside AudioWorklet thread.
   */
  async initWasm(wasmBytes) {

    const wasmModule = await WebAssembly.instantiate(
      wasmBytes,
      {}
    );

    this.wasmInstance = wasmModule.instance;
    this.wasmReady = true;

    /**
     * Optional exported DSP function.
     *
     * Expected signature example:
     * process(outputLPtr, outputRPtr, frames)
     */
    this.processFn =
      this.wasmInstance.exports.process || null;

    this.port.postMessage({
      type: 'WASM_READY'
    });
  }

  /**
   * Set DSP parameter.
   */
  setParam(paramId, value) {

    this.params.set(paramId, value);

    /**
     * Optional DSP export.
     *
     * Expected:
     * set_param(id, value)
     */
    if (
      this.wasmReady &&
      this.wasmInstance &&
      this.wasmInstance.exports &&
      this.wasmInstance.exports.set_param
    ) {
      try {
        this.wasmInstance.exports.set_param(
          paramId,
          value
        );
      } catch (_) {}
    }
  }

  /**
   * Audio processing callback.
   */
  process(inputs, outputs) {

    const output = outputs[0];

    if (!output || output.length === 0) {
      return true;
    }

    const left = output[0];
    const right = output[1] || output[0];

    /**
     * Silence until WASM ready.
     */
    if (!this.wasmReady) {

      for (let i = 0; i < left.length; i++) {
        left[i] = 0;
        right[i] = 0;
      }

      return true;
    }

    /**
     * --------------------------------------------------------
     * GENERIC FALLBACK DSP
     * --------------------------------------------------------
     *
     * If no exported process function exists,
     * generate minimal drone tone so graph remains alive.
     *
     * Replace with your actual WASM DSP later.
     */

    const gain =
      this.params.get(0) ?? 0.05;

    const modRate =
      this.params.get(5) ?? 0.05;

    const scaleId =
      this.params.get(6) ?? 0;

    const freqTable = [
      55,
      65.4,
      73.4,
      82.4,
      98,
      110,
      130.8
    ];

    const baseFreq =
      freqTable[scaleId % freqTable.length];

    if (!this.phase) {
      this.phase = 0;
    }

    for (let i = 0; i < left.length; i++) {

      const t =
        this.phase / sampleRate;

      const lfo =
        Math.sin(
          2 * Math.PI * modRate * t
        ) * 0.2;

      const sample =
        Math.sin(
          2 * Math.PI * (baseFreq + lfo) * t
        ) * gain;

      left[i] = sample;
      right[i] = sample;

      this.phase++;
    }

    return true;
  }
}

registerProcessor(
  'omni-wasm-processor',
  OmniWasmProcessor
);
`;
}

/* ============================================================
 * WasmLayerAdapter
 * ========================================================== */

/**
 * Bridges:
 * Wasm DSP ↔ AudioWorklet ↔ AtmosphereLayer
 */
export class WasmLayerAdapter {
  /**
   * @param {AtmosphereEngine} engine
   * @param {string} layerId
   * @param {object} [options={}]
   */
  constructor(engine, layerId, options = {}) {
    if (!engine) {
      throw new Error(
        "WasmLayerAdapter requires an AtmosphereEngine instance."
      );
    }

    if (!engine.context) {
      throw new Error(
        "AtmosphereEngine must be initialized before WasmLayerAdapter."
      );
    }

    if (!layerId) {
      throw new Error(
        "WasmLayerAdapter requires a target layerId."
      );
    }

    /**
     * Core references
     */
    this._engine = engine;
    this._context = engine.context;
    this._layerId = layerId;

    /**
     * Target AtmosphereLayer
     */
    this._layer = engine.getLayer(layerId);

    if (!this._layer) {
      throw new Error(
        `Layer "${layerId}" does not exist in AtmosphereEngine.`
      );
    }

    /**
     * WASM configuration
     */
    this._wasmUrl =
      options.wasmUrl || "dsp_engine.wasm";

    /**
     * Worklet identifiers
     */
    this._processorName =
      options.processorName ||
      "omni-wasm-processor";

    /**
     * Runtime state
     */
    this._workletNode = null;
    this._workletModuleUrl = null;
    this._wasmBytes = null;

    this._initialized = false;
    this._destroyed = false;
  }

  /* ============================================================
   * Public API
   * ========================================================== */

  /**
   * Initializes:
   * - WASM fetch
   * - Worklet injection
   * - AudioWorkletNode creation
   * - Layer attachment
   *
   * @returns {Promise<WasmLayerAdapter>}
   */
  async init() {
    if (this._destroyed) {
      throw new Error(
        "Cannot initialize destroyed WasmLayerAdapter."
      );
    }

    if (this._initialized) {
      return this;
    }

    try {
      /**
       * --------------------------------------------------------
       * STEP 1:
       * Load WASM binary
       * --------------------------------------------------------
       */
      this._wasmBytes = await fetchWasmBinary(
        this._wasmUrl
      );

      /**
       * --------------------------------------------------------
       * STEP 2:
       * Inject inline AudioWorkletProcessor
       * --------------------------------------------------------
       */
      await this._injectWorklet();

      /**
       * --------------------------------------------------------
       * STEP 3:
       * Create AudioWorkletNode
       * --------------------------------------------------------
       */
      this._createWorkletNode();

      /**
       * --------------------------------------------------------
       * STEP 4:
       * Attach to AtmosphereLayer
       * --------------------------------------------------------
       */
      this._attachToLayer();

      /**
       * --------------------------------------------------------
       * STEP 5:
       * Send WASM binary to processor
       * --------------------------------------------------------
       */
      this._initializeProcessor();

      this._initialized = true;

      return this;

    } catch (err) {

      console.error(
        "[WasmLayerAdapter] Initialization failed:",
        err
      );

      await this.destroy();

      throw err;
    }
  }

  /**
   * Safely updates a DSP parameter.
   *
   * @param {number} paramId
   * @param {number} value
   */
  setWasmParam(paramId, value) {
    if (!this._workletNode) {
      return;
    }

    this._workletNode.port.postMessage({
      type: "SET_PARAM",
      paramId,
      value,
    });
  }

  /**
   * Convenience wrapper for SCALE_ID.
   *
   * Requested explicitly:
   * SCALE_ID = Param ID 6
   *
   * @param {number} scaleId
   */
  setDroneScale(scaleId) {
    this.setWasmParam(
      WASM_PARAMS.SCALE_ID,
      scaleId
    );
  }

  /**
   * Returns active AudioWorkletNode.
   * @returns {AudioWorkletNode|null}
   */
  get node() {
    return this._workletNode;
  }

  /**
   * Returns whether initialized.
   * @returns {boolean}
   */
  get initialized() {
    return this._initialized;
  }

  /**
   * Full teardown.
   *
   * Safely:
   * - detaches layer source
   * - disconnects worklet
   * - revokes Blob URL
   * - clears references
   */
  async destroy() {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;

    try {

      /**
       * Detach from AtmosphereLayer
       */
      if (this._layer) {
        this._layer.detachSource();
      }

      /**
       * Disconnect node
       */
      if (this._workletNode) {
        safeDisconnect(this._workletNode);
      }

      /**
       * Cleanup Blob URL
       */
      if (this._workletModuleUrl) {
        URL.revokeObjectURL(
          this._workletModuleUrl
        );
      }

    } catch (_) {}

    this._workletNode = null;
    this._workletModuleUrl = null;
    this._wasmBytes = null;
    this._initialized = false;
  }

  /* ============================================================
   * Internal Methods
   * ========================================================== */

  /**
   * Injects inline AudioWorkletProcessor
   * using Blob URL.
   */
  async _injectWorklet() {
    const source =
      createWorkletProcessorSource();

    const blob = new Blob(
      [source],
      { type: "application/javascript" }
    );

    this._workletModuleUrl =
      URL.createObjectURL(blob);

    await this._context.audioWorklet.addModule(
      this._workletModuleUrl
    );
  }

  /**
   * Creates AudioWorkletNode.
   */
  _createWorkletNode() {

    this._workletNode = new AudioWorkletNode(
      this._context,
      this._processorName,
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      }
    );

    /**
     * Optional diagnostics channel.
     */
    this._workletNode.port.onmessage = (event) => {

      const data = event.data;

      switch (data.type) {

        case "WASM_READY":
          console.info(
            "[WasmLayerAdapter] WASM processor ready."
          );
          break;

        case "ERROR":
          console.error(
            "[WasmLayerAdapter] Processor error:",
            data.message
          );
          break;

        default:
          break;
      }
    };
  }

  /**
   * Attaches AudioWorkletNode
   * as persistent source to layer.
   */
  _attachToLayer() {

    /**
     * IMPORTANT:
     * Layer remains fully abstract.
     *
     * It only sees:
     * "an AudioNode source"
     */
    this._layer.attachSource(
      this._workletNode
    );
  }

  /**
   * Sends WASM binary into processor thread.
   */
  _initializeProcessor() {

    this._workletNode.port.postMessage(
      {
        type: "INIT_WASM",
        wasmBytes: this._wasmBytes,
      }
    );
  }
}

/* ============================================================
 * Default Export
 * ========================================================== */

export default WasmLayerAdapter;
