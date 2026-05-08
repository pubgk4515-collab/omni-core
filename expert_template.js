/**
 * Expert Module – Cinematic Drone (Engine Type 0)
 * Inherits standard interface: init(), toggle(), setSlider()
 */
export class ExpertModuleTemplate {
  constructor() {
    this.id = '';
    this.ctx = null;
    this.node = null;      // AudioWorkletNode
    this.gainNode = null;  // for zero‑pop volume
    this.isActive = false;
  }

  init(id, audioCtx, wasmNode) {
    this.id = id;
    this.ctx = audioCtx;
    this.node = wasmNode;

    // Zero‑pop volume control
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0;  // fade in later
    this.node.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);

    // Set engine type to 0 (Pad)
    this.node.port.postMessage({ type: 'init', engineType: 0 });
  }

  toggle(state) {
    this.isActive = state;
    const now = this.ctx.currentTime;
    // Smooth gain ramp – no pops
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setTargetAtTime(state ? 1.0 : 0.0, now, 0.05);
    // Also tell the Wasm processor to stop generating (saves CPU)
    this.node.port.postMessage({ type: 'setActive', active: state });
  }

  /**
   * Slider mapping for Drone:
   *   0.0‑0.4  → Deep pitch dive, heavy reverb, mellow warmth
   *   0.5      → Pure, untouched signal (pitch = 1.0, no reverb)
   *   0.6‑1.0  → Rising pitch, saturation, open high‑pass
   */
  setSlider(value) {
    const s = Math.min(1, Math.max(0, value));
    let pitch, reverb, hpFreq, sat;

    if (s <= 0.4) {
      // Void region – low, slow, cathedral
      const t = s / 0.4; // 0..1
      pitch = 1.0 - t * 0.9;          // 1.0 → 0.1
      reverb = 0.8 * (1 - t) + 0.2;   // 0.8 .. 0.2? Actually heavy at low s: strong reverb
      reverb = 0.9 - t * 0.5;         // 0.9 → 0.4
      hpFreq = 30.0 + t * 100.0;      // muffled, gentle high‑pass
      sat = 0.0;
    } else if (s <= 0.6) {
      // Normal zone
      const t = (s - 0.4) / 0.2;
      pitch = 1.0;
      reverb = 0.2 - t * 0.2;          // 0.2 → 0.0
      hpFreq = 100.0 + t * 200.0;
      sat = 0.0;
    } else {
      // Overdrive / intensity
      const t = (s - 0.6) / 0.4;
      pitch = 1.0 + t * 0.5;          // 1.0 → 1.5
      reverb = t * 0.3;                // 0 → 0.3
      hpFreq = 300.0 + t * 5000.0;     // opens up
      sat = t;                         // 0 → 1
    }

    const params = [
      [0, pitch],   // TIME_STRETCH (pitch multiplier)
      [1, reverb],  // REVERB_MIX
      [2, hpFreq],  // HIGH_PASS_FREQ
      [3, sat]      // SATURATION
    ];
    this.node.port.postMessage({ type: 'setParams', values: params });
  }
}