/**
 * Blueprint for all future expert sound modules.
 * Every module must implement: init(audioCtx, wasmNode), toggle(state), setSlider(value).
 *
 * Communication with the Wasm engine happens through the AudioWorkletNode's MessagePort.
 * The slider (0.0–1.0) is mapped to a rich set of DSP parameters according to the
 * “Void / Normal / Overdrive” axis described in the brief.
 */
export class ExpertModuleTemplate {
  /**
   * @param {string} id   Unique identifier (e.g., "AmbientPad")
   * @param {AudioContext} audioCtx
   * @param {AudioWorkletNode} wasmNode - dedicated node that hosts the Wasm processor
   */
  init(id, audioCtx, wasmNode) {
    this.id = id;
    this.ctx = audioCtx;
    this.node = wasmNode;
    this.isActive = false;  // Play/Pause state
    this.sliderValue = 0.5; // Default to Normal

    // Connect the worklet node to destination (or to a master bus)
    this.node.connect(this.ctx.destination);
  }

  /**
   * Toggle playback on (true) or off (false).
   * Sends a simple on/off message to the processor.
   */
  toggle(state) {
    this.isActive = state;
    // The processor expects a message to enable/disable its internal sound generation.
    this.node.port.postMessage({ type: 'setActive', active: state });
  }

  /**
   * Receives a normalised slider value (0.0–1.0) and maps it to the
   * “Void ← Normal → Overdrive” matrix.
   *
   * Mapping rules:
   *   0.0  – 0.4  → Granular time‑stretching + heavy cathedral reverb
   *   0.5         → Pure, untouched signal
   *   0.6  – 1.0  → Overdrive, high‑pass filter, harmonic saturation
   *
   * The exact numerical parameters are sent to the AudioWorklet node,
   * which then forwards them to the Wasm module.
   */
  setSlider(value) {
    this.sliderValue = value;
    const s = Math.min(1, Math.max(0, value));

    // --- Parameter calculation ---

    // Time stretch: 1.0 at normal, up to 10.0 at s=0.0
    const stretch = (s <= 0.4) ? 1 + 9 * ((0.4 - s) / 0.4) : 1.0;

    // Reverb mix: full wet at s=0, fading to dry by s=0.4; zero otherwise
    const reverbMix = (s < 0.4) ? (0.4 - s) / 0.4 : 0.0;

    // Overdrive region (0.6–1.0)
    let highPassFreq = 0;   // 0 = bypassed in DSP
    let saturation = 0;     // 0 = no drive
    if (s >= 0.6) {
      const t = (s - 0.6) / 0.4; // 0–1 in overdrive zone
      // High‑pass rises from 30 Hz to 8000 Hz (exponential mapping)
      highPassFreq = 30 * Math.pow(10, t * Math.log10(8000/30));
      saturation = t;  // 0 → 1
    }

    // Pack parameters into a message for the processor
    // Parameter IDs are defined in the C++ engine and mirrored here.
    const params = [
      [0, stretch],      // TIME_STRETCH
      [1, reverbMix],    // REVERB_MIX
      [2, highPassFreq], // HIGH_PASS_FREQ
      [3, saturation],   // SATURATION
    ];

    this.node.port.postMessage({
      type: 'setParams',
      values: params
    });
  }
}