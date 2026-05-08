import { ExpertModuleTemplate } from './expert_template.js';

/**
 * Expert Module – Procedural Wind & Storm (Engine Type 1)
 */
export class ExpertWindModule extends ExpertModuleTemplate {
  init(id, audioCtx, wasmNode) {
    super.init(id, audioCtx, wasmNode);
    // Override engine type to Wind
    this.node.port.postMessage({ type: 'init', engineType: 1 });
  }

  /**
   * Slider mapping:
   *   0.0‑0.4 → Distant winter wind (muffled, high reverb)
   *   0.5     → Gentle evening breeze
   *   0.6‑1.0 → Aggressive storm (open sound, less reverb)
   */
  setSlider(value) {
    const s = Math.min(1, Math.max(0, value));
    let windIntensity, reverbMix;

    if (s <= 0.4) {
      const t = s / 0.4;
      windIntensity = 0.1 + t * 0.3;   // 0.1 – 0.4
      reverbMix = 0.85 - t * 0.3;       // 0.85 → 0.55
    } else if (s <= 0.6) {
      const t = (s - 0.4) / 0.2;
      windIntensity = 0.4 + t * 0.1;   // 0.4 – 0.5
      reverbMix = 0.55 - t * 0.25;      // 0.55 → 0.3
    } else {
      const t = (s - 0.6) / 0.4;
      windIntensity = 0.5 + t * 0.5;    // 0.5 – 1.0
      reverbMix = 0.3 - t * 0.2;        // 0.3 → 0.1
    }

    this.node.port.postMessage({
      type: 'setParams',
      values: [
        [4, windIntensity], // WIND_INTENSITY
        [1, reverbMix]      // REVERB_MIX
      ]
    });
  }
}