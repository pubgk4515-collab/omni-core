import { ExpertModuleTemplate } from './expert_template.js';

export class ExpertWindModule extends ExpertModuleTemplate {
  init(id, audioCtx, wasmNode) {
    // Standard template ko call karte hain
    super.init(id, audioCtx, wasmNode);
  }

  setSlider(value) {
    this.sliderValue = value;
    
    // Wind intensity seedha C++ ko bhej rahe hain (Param ID 4)
    this.node.port.postMessage({
      type: 'setParams',
      values: [
        [4, value] 
      ]
    });
  }
}
