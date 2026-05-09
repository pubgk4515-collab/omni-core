/**
 * ecology_controller.js
 * Phase 2 — Probabilistic Ecology Controller
 *
 * ------------------------------------------------------------
 * PURPOSE
 * ------------------------------------------------------------
 * This module sits ABOVE the AtmosphereEngine and AtmosphereLayer
 * architecture.
 *
 * It acts as the "living ecosystem brain" responsible for:
 *
 * - Probabilistic event spawning
 * - Ecological timing behavior
 * - Randomized realism
 * - Buffer caching / memory efficiency
 * - Organic environmental evolution
 *
 * Example events:
 * - Bird chirps
 * - Distant thunder
 * - Insect bursts
 * - Frog calls
 * - Wind gust accents
 * - Branch cracks
 * - Owl calls
 * - Water drips
 *
 * ------------------------------------------------------------
 * DESIGN PHILOSOPHY
 * ------------------------------------------------------------
 * The controller DOES NOT care about DSP routing.
 * That is fully owned by AtmosphereLayer.
 *
 * The controller ONLY decides:
 * - IF an event should occur
 * - WHEN it should occur
 * - WHICH sample to use
 * - HOW it should vary
 *
 * This separation keeps the system:
 * - infinitely scalable
 * - modular
 * - memory efficient
 * - ecologically believable
 *
 * ------------------------------------------------------------
 * REQUIREMENTS
 * ------------------------------------------------------------
 * Depends on:
 * - atmosphere_core.js
 *
 * Assumes:
 * - AtmosphereEngine is initialized
 * - Layers already exist
 *
 * No UI code.
 * Pure ES6 architecture.
 */

/* ============================================================
 * Utility Functions
 * ========================================================== */

/**
 * Random float in range.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Random array element.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Clamp number.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Safe async fetch of ArrayBuffer.
 * @param {string} url
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchArrayBuffer(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch audio file: ${response.status} ${response.statusText}`
    );
  }

  return await response.arrayBuffer();
}

/**
 * Browser-safe audio decoding.
 * @param {BaseAudioContext} context
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioData(context, arrayBuffer) {
  const decoded = context.decodeAudioData(arrayBuffer);

  // Modern browsers
  if (decoded && typeof decoded.then === "function") {
    return await decoded;
  }

  // Legacy Safari fallback
  return await new Promise((resolve, reject) => {
    context.decodeAudioData(arrayBuffer, resolve, reject);
  });
}

/* ============================================================
 * BufferCache
 * ========================================================== */

/**
 * Global shared buffer cache.
 *
 * Guarantees:
 * - A sample URL is fetched ONLY ONCE
 * - A sample is decoded ONLY ONCE
 * - Concurrent requests reuse same Promise
 *
 * Important for:
 * - thunder
 * - bird swarms
 * - long-running ecosystems
 */
class BufferCache {
  /**
   * @param {BaseAudioContext} context
   */
  constructor(context) {
    this._context = context;

    /**
     * Map<string, AudioBuffer>
     */
    this._buffers = new Map();

    /**
     * Prevent duplicate concurrent fetches.
     * Map<string, Promise<AudioBuffer>>
     */
    this._pendingLoads = new Map();
  }

  /**
   * Returns whether buffer already exists.
   * @param {string} url
   * @returns {boolean}
   */
  has(url) {
    return this._buffers.has(url);
  }

  /**
   * Get cached buffer immediately.
   * @param {string} url
   * @returns {AudioBuffer|undefined}
   */
  get(url) {
    return this._buffers.get(url);
  }

  /**
   * Load and cache buffer.
   *
   * Concurrent calls for same URL
   * reuse the same Promise.
   *
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async load(url) {
    // Already cached
    if (this._buffers.has(url)) {
      return this._buffers.get(url);
    }

    // Already loading
    if (this._pendingLoads.has(url)) {
      return await this._pendingLoads.get(url);
    }

    const promise = (async () => {
      try {
        const arrayBuffer = await fetchArrayBuffer(url);

        const audioBuffer = await decodeAudioData(
          this._context,
          arrayBuffer
        );

        this._buffers.set(url, audioBuffer);

        return audioBuffer;
      } finally {
        this._pendingLoads.delete(url);
      }
    })();

    this._pendingLoads.set(url, promise);

    return await promise;
  }

  /**
   * Preload multiple files.
   * @param {string[]} urls
   * @returns {Promise<void>}
   */
  async preload(urls = []) {
    await Promise.all(urls.map((url) => this.load(url)));
  }

  /**
   * Clears all buffers.
   * Useful for memory cleanup.
   */
  clear() {
    this._buffers.clear();
    this._pendingLoads.clear();
  }
}

/* ============================================================
 * EcologySpawner
 * ========================================================== */

/**
 * Represents a single ecological behavior generator.
 *
 * Example:
 * - Random bird calls
 * - Occasional thunder
 * - Crickets at night
 * - Wind gusts
 */
class EcologySpawner {
  /**
   * @param {object} config
   */
  constructor(config = {}) {
    this.layerId = config.layerId;

    this.sampleUrls = Array.isArray(config.sampleUrls)
      ? config.sampleUrls
      : [];

    /**
     * Probability PER TICK.
     * Example:
     * 0.005 = 0.5% chance per ecosystem tick.
     */
    this.probability = clamp(
      Number(config.probability ?? 0),
      0,
      1
    );

    this.minDelay = Math.max(0, config.minDelay ?? 1);
    this.maxDelay = Math.max(this.minDelay, config.maxDelay ?? 5);

    this.volumeRange = config.volumeRange ?? [0.5, 1.0];
    this.panRange = config.panRange ?? [-1, 1];
    this.pitchRange = config.pitchRange ?? [0.95, 1.05];

    /**
     * Timestamp when this spawner
     * can next trigger.
     */
    this.nextAllowedTime = 0;

    /**
     * Whether enabled.
     */
    this.enabled = true;
  }

  /**
   * Returns whether spawner can trigger now.
   * @param {number} nowSeconds
   * @returns {boolean}
   */
  canSpawn(nowSeconds) {
    if (!this.enabled) return false;
    return nowSeconds >= this.nextAllowedTime;
  }

  /**
   * Rolls random probability.
   * @returns {boolean}
   */
  roll() {
    return Math.random() < this.probability;
  }

  /**
   * Schedules next cooldown.
   * @param {number} nowSeconds
   */
  applyCooldown(nowSeconds) {
    const delay = randomRange(this.minDelay, this.maxDelay);
    this.nextAllowedTime = nowSeconds + delay;
  }

  /**
   * Generates randomized spawn parameters.
   * @returns {object}
   */
  createSpawnProfile() {
    return {
      volume: randomRange(
        this.volumeRange[0],
        this.volumeRange[1]
      ),

      pan: randomRange(
        this.panRange[0],
        this.panRange[1]
      ),

      pitch: randomRange(
        this.pitchRange[0],
        this.pitchRange[1]
      ),

      sampleUrl: randomChoice(this.sampleUrls),
    };
  }
}

/* ============================================================
 * EcologyController
 * ========================================================== */

/**
 * The living ecosystem simulation layer.
 *
 * ------------------------------------------------------------
 * Responsibilities:
 * ------------------------------------------------------------
 * - Spawner management
 * - Tick loop
 * - Probability evaluation
 * - Sample caching
 * - Spawn randomization
 * - Ecosystem lifecycle
 *
 * ------------------------------------------------------------
 * Architecture:
 * ------------------------------------------------------------
 *
 * EcologyController
 *    ├── Spawners
 *    ├── BufferCache
 *    ├── Tick Loop
 *    └── AtmosphereEngine
 *
 */
export class EcologyController {
  /**
   * @param {AtmosphereEngine} engine
   * @param {object} [options={}]
   */
  constructor(engine, options = {}) {
    if (!engine) {
      throw new Error(
        "EcologyController requires an initialized AtmosphereEngine."
      );
    }

    if (!engine.context) {
      throw new Error(
        "AtmosphereEngine must be initialized before EcologyController."
      );
    }

    this._engine = engine;
    this._context = engine.context;

    /**
     * Ecosystem tick interval in milliseconds.
     * Lower = more reactive.
     * Higher = more CPU efficient.
     */
    this._tickRateMs = options.tickRateMs ?? 1000;

    /**
     * Active interval id.
     */
    this._intervalId = null;

    /**
     * Whether ecosystem is running.
     */
    this._running = false;

    /**
     * All registered spawners.
     * Map<string, EcologySpawner>
     */
    this._spawners = new Map();

    /**
     * Shared decoded audio cache.
     */
    this._bufferCache = new BufferCache(this._context);
  }

  /* ============================================================
   * Public API
   * ========================================================== */

  /**
   * Registers a probabilistic ecological event generator.
   *
   * @param {object} config
   * @param {string} config.layerId
   * @param {string[]} config.sampleUrls
   * @param {number} config.probability
   * @param {number} config.minDelay
   * @param {number} config.maxDelay
   * @param {[number, number]} config.volumeRange
   * @param {[number, number]} config.panRange
   * @param {[number, number]} config.pitchRange
   *
   * @returns {EcologySpawner}
   */
  registerSpawner(config = {}) {
    if (!config.layerId) {
      throw new Error("Spawner requires a layerId.");
    }

    const layer = this._engine.getLayer(config.layerId);

    if (!layer) {
      throw new Error(
        `Layer "${config.layerId}" does not exist in AtmosphereEngine.`
      );
    }

    if (
      !Array.isArray(config.sampleUrls) ||
      config.sampleUrls.length === 0
    ) {
      throw new Error(
        `Spawner "${config.layerId}" requires sampleUrls.`
      );
    }

    const spawner = new EcologySpawner(config);

    this._spawners.set(config.layerId, spawner);

    return spawner;
  }

  /**
   * Removes a spawner.
   * @param {string} layerId
   * @returns {boolean}
   */
  removeSpawner(layerId) {
    return this._spawners.delete(layerId);
  }

  /**
   * Retrieve spawner.
   * @param {string} layerId
   * @returns {EcologySpawner|undefined}
   */
  getSpawner(layerId) {
    return this._spawners.get(layerId);
  }

  /**
   * Preload all samples used by all spawners.
   *
   * Useful for:
   * - eliminating runtime latency
   * - immersive startup
   * - thunder realism
   *
   * @returns {Promise<void>}
   */
  async preloadAll() {
    const urls = new Set();

    for (const spawner of this._spawners.values()) {
      for (const url of spawner.sampleUrls) {
        urls.add(url);
      }
    }

    await this._bufferCache.preload([...urls]);
  }

  /**
   * Starts the ecosystem simulation.
   */
  start() {
    if (this._running) return;

    this._running = true;

    this._intervalId = setInterval(() => {
      this._tick();
    }, this._tickRateMs);
  }

  /**
   * Stops ecosystem simulation.
   */
  stop() {
    if (!this._running) return;

    this._running = false;

    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Destroy controller and release memory.
   */
  destroy() {
    this.stop();

    this._spawners.clear();

    this._bufferCache.clear();
  }

  /**
   * Returns ecosystem status snapshot.
   * @returns {object}
   */
  getState() {
    return {
      running: this._running,
      tickRateMs: this._tickRateMs,
      spawnerCount: this._spawners.size,
      cachedBuffers: this._bufferCache._buffers.size,
    };
  }

  /* ============================================================
   * Internal Tick Loop
   * ========================================================== */

  /**
   * Ecosystem heartbeat.
   *
   * Every tick:
   * - Evaluate each spawner
   * - Respect cooldowns
   * - Roll probability
   * - Spawn ecological events
   */
  async _tick() {
    if (!this._running) return;

    const now = this._context.currentTime;

    for (const spawner of this._spawners.values()) {
      try {
        // Cooldown check
        if (!spawner.canSpawn(now)) {
          continue;
        }

        // Probability check
        if (!spawner.roll()) {
          continue;
        }

        // Trigger event
        await this._spawnEvent(spawner, now);

        // Apply cooldown AFTER successful trigger
        spawner.applyCooldown(now);
      } catch (err) {
        console.warn(
          `[EcologyController] Spawner "${spawner.layerId}" failed:`,
          err
        );
      }
    }
  }

  /**
   * Spawns one ecological event.
   *
   * @param {EcologySpawner} spawner
   * @param {number} now
   */
  async _spawnEvent(spawner, now) {
    const layer = this._engine.getLayer(spawner.layerId);

    if (!layer) {
      console.warn(
        `[EcologyController] Missing layer "${spawner.layerId}".`
      );
      return;
    }

    // Randomized ecology profile
    const profile = spawner.createSpawnProfile();

    // Fetch cached buffer
    const buffer = await this._bufferCache.load(
      profile.sampleUrl
    );

    // Configure layer
    layer.setVolume(profile.volume, 0.01);
    layer.setPan(profile.pan);

    // Assign buffer
    layer.setBuffer(buffer, {
      loop: false,
      playbackRate: profile.pitch,
    });

    // Trigger playback
    layer.play({
      when: now,
      playbackRate: profile.pitch,
    });
  }
}

/* ============================================================
 * Default Export
 * ========================================================== */

export default EcologyController;
