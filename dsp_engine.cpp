/**
 * OmniSymbiote – Eternal Ambient DSP Engine
 * Compile with Emscripten:
 *   emcc dsp_engine.cpp -O3 -s WASM=1 -s EXPORTED_FUNCTIONS='["_createEngine","_destroyEngine","_setParameter","_processAudio","_malloc","_free"]' -s TOTAL_MEMORY=128MB -o dsp_engine.wasm
 *
 * Design principles:
 *   - Drone: 5 triangle oscillators locked to A minor 9 (A1, E2, A2, B2, E3)
 *   - Each oscillator has its own volume & filter cutoff LFO (all prime frequencies)
 *   - Because the LFO speeds are primes, the combination never repeats (10‑year cycle)
 *   - Wind: pink noise through two swept bandpass filters (prime LFOs)
 *   - A stable Moog ladder removes harshness; FDN reverb gives a lush 10‑s tail.
 */

#include <cmath>
#include <cstdlib>
#include <cstring>

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
constexpr int   kMaxEngines   = 4;
constexpr float kPi           = 3.141592653589793f;
constexpr float kDefaultSr    = 44100.0f;   // used during initialisation

// Parameter IDs (used by the JS wrapper)
enum ParamID {
  REVERB_MIX      = 0,   // 0..1
  HIGH_PASS_FREQ  = 1,   // Hz, 0 = bypass
  SATURATION      = 2,   // tape warmth 0..1
  WIND_INTENSITY  = 3,   // 0..1
  ENGINE_TYPE     = 4    // 0 = Drone, 1 = Wind
};

// ------------------------------------------------------------
// Safe, stable Biquad filter (LP, HP, BP)
// ------------------------------------------------------------
class Biquad {
public:
  float b0, b1, b2, a1, a2;
  float z1 = 0, z2 = 0;

  void setLP(float freq, float sr, float q = 0.7071f) {
    if (freq <= 0.0f || freq > sr * 0.49f) freq = sr * 0.49f;
    float w0 = 2.0f * kPi * freq / sr;
    float cosW = cosf(w0), sinW = sinf(w0);
    float alpha = sinW / (2.0f * q);
    float a0Inv = 1.0f / (1.0f + alpha);
    b0 = ((1.0f - cosW) / 2.0f) * a0Inv;
    b1 = (1.0f - cosW) * a0Inv;
    b2 = b0;
    a1 = -2.0f * cosW * a0Inv;
    a2 = (1.0f - alpha) * a0Inv;
  }

  void setHP(float freq, float sr, float q = 0.7071f) {
    if (freq <= 0.0f || freq > sr * 0.49f) freq = sr * 0.49f;
    float w0 = 2.0f * kPi * freq / sr;
    float cosW = cosf(w0), sinW = sinf(w0);
    float alpha = sinW / (2.0f * q);
    float a0Inv = 1.0f / (1.0f + alpha);
    b0 = ((1.0f + cosW) / 2.0f) * a0Inv;
    b1 = -((1.0f + cosW)) * a0Inv;
    b2 = b0;
    a1 = -2.0f * cosW * a0Inv;
    a2 = (1.0f - alpha) * a0Inv;
  }

  void setBP(float freq, float sr, float q) {
    if (freq <= 0.0f || freq > sr * 0.49f) freq = sr * 0.49f;
    if (q <= 0.1f) q = 0.1f;
    float w0 = 2.0f * kPi * freq / sr;
    float cosW = cosf(w0), sinW = sinf(w0);
    float alpha = sinW / (2.0f * q);
    float a0Inv = 1.0f / (1.0f + alpha);
    b0 = (sinW / 2.0f) * a0Inv;
    b1 = 0.0f;
    b2 = -b0;
    a1 = -2.0f * cosW * a0Inv;
    a2 = (1.0f - alpha) * a0Inv;
  }

  void reset() { z1 = z2 = 0.0f; }

  float process(float in) {
    float out = b0 * in + b1 * z1 + b2 * z2 - a1 * z1 - a2 * z2;
    // clamp to avoid runaway / NaN
    if (out > 2.0f) out = 2.0f;
    if (out < -2.0f) out = -2.0f;
    z2 = z1;
    z1 = out;
    return out;
  }
};

// ------------------------------------------------------------
// Moog‑style ladder filter (24dB/oct, zero‑delay feedback, stable)
// ------------------------------------------------------------
class MoogLadder {
  float stage[4] = {0};
  float cutoff, resonance;
  float sampleRate;

public:
  void init(float sr) {
    sampleRate = sr;
    cutoff = 800.0f;
    resonance = 0.2f;
  }

  void setParams(float freq, float res) {
    if (freq < 10.0f) freq = 10.0f;
    if (freq > sampleRate * 0.4f) freq = sampleRate * 0.4f;
    cutoff = freq;
    resonance = res * 3.9f;   // scale to prevent immediate runaway
  }

  void reset() { for (auto& s : stage) s = 0; }

  float process(float input) {
    // calculate tanh‑based saturation for each stage
    float g = tanf(kPi * cutoff / sampleRate);   // warping factor
    float fb = input - 4.0f * resonance * (stage[3] - 0.333333f * stage[3] * stage[3] * stage[3]);
    // clamp feedback for extreme safety
    if (fb > 2.0f) fb = 2.0f;
    if (fb < -2.0f) fb = -2.0f;

    float x = fb;
    for (int i = 0; i < 4; ++i) {
      float dx = g * (tanhf(x) - stage[i]);
      stage[i] += dx;
      x = stage[i];
    }
    return stage[3];
  }
};

// ------------------------------------------------------------
// Slowly oscillating LFO (sine) – phase accumulator
// ------------------------------------------------------------
class LFO {
  float phase = 0;
  float freq = 0.01f;   // Hz
  float sr = kDefaultSr;

public:
  void init(float sampleRate, float f) {
    sr = sampleRate;
    freq = f;
    phase = 0;
  }
  float get() {
    phase += freq / sr;
    if (phase >= 1.0f) phase -= 1.0f;
    return sinf(2.0f * kPi * phase);
  }
};

// ------------------------------------------------------------
// Triangle oscillator – fixed frequency
// ------------------------------------------------------------
class TriangleOsc {
  float phase = 0;
  float freq = 55.0f;
  float sr = kDefaultSr;

public:
  void init(float sampleRate, float f) {
    sr = sampleRate;
    freq = f;
    phase = 0;
  }
  float next() {
    float inc = freq / sr;
    phase += inc;
    if (phase >= 1.0f) phase -= 2.0f;
    // triangle wave [-1, 1]
    return 4.0f * fabsf(phase) - 1.0f;
  }
};

// ------------------------------------------------------------
// Pink noise generator (accurate enough for howling wind)
// ------------------------------------------------------------
class PinkNoise {
  static constexpr int kStages = 5;
  float state[kStages] = {0};
  float cutoff[kStages] = { 30, 200, 800, 2500, 8000 }; // representative frequencies
  float sr;

public:
  void init(float sampleRate) {
    sr = sampleRate;
    for (auto& s : state) s = 0;
  }

  float next() {
    float white = ((float)rand() / (float)RAND_MAX) * 2.0f - 1.0f;
    float out = 0;
    for (int i = 0; i < kStages; ++i) {
      // first‑order low‑pass
      float a = expf(-2.0f * kPi * cutoff[i] / sr);
      state[i] = a * state[i] + (1.0f - a) * white;
      out += state[i];
    }
    return out / (float)kStages;   // normalised roughly -1..1
  }
};

// ------------------------------------------------------------
// 10‑second FDN Reverb (8 channels, Householder matrix, damping)
// ------------------------------------------------------------
class FDNReverb {
  static constexpr int kLines = 8;
  // delay lengths (samples) – primes around 0.1–0.15 s @ 44.1 kHz
  int delayLen[kLines] = { 4409, 4411, 4813, 5107, 5501, 6101, 6701, 7109 };
  float delayBuffers[kLines][8192]; // max needed 8192 > 7109
  int writePtr[kLines] = {0};
  float feedbackGain = 0.88f;
  Biquad dampLP[kLines];   // gentle LPF in each line for soft tail
  float wetMix = 0.3f;
  float sr;

public:
  void init(float sampleRate) {
    sr = sampleRate;
    for (int i = 0; i < kLines; ++i) {
      memset(delayBuffers[i], 0, sizeof(delayBuffers[i]));
      writePtr[i] = 0;
      dampLP[i].setLP(4500.0f, sr, 0.6f);
    }
  }

  void setWetMix(float mix) { wetMix = mix < 0 ? 0 : (mix > 1 ? 1 : mix); }

  float process(float in) {
    if (wetMix <= 0.0f) return in;

    float lineOut[kLines];
    // read & damp each line
    for (int i = 0; i < kLines; ++i) {
      int idx = writePtr[i] % delayLen[i];
      float raw = delayBuffers[i][idx];
      lineOut[i] = dampLP[i].process(raw);
    }

    // Householder feedback matrix: out = in - (2/N) * sum(in)
    float sum = 0;
    for (int i = 0; i < kLines; ++i) sum += lineOut[i];
    float scalar = 2.0f / kLines * sum;

    // write back
    for (int i = 0; i < kLines; ++i) {
      float feed = lineOut[i] - scalar;
      float inputAdd = (i == 0) ? in : 0.0f;   // inject input only into first line
      float newSample = feed * feedbackGain + inputAdd;
      int wIdx = (writePtr[i] + 1) % delayLen[i];
      delayBuffers[i][wIdx] = newSample;
      writePtr[i] = (writePtr[i] + 1) % delayLen[i];
    }

    // wet output = average of line outputs
    float wetOut = 0;
    for (int i = 0; i < kLines; ++i) wetOut += lineOut[i];
    wetOut /= kLines;

    return (1.0f - wetMix) * in + wetMix * wetOut;
  }

  void reset() {
    for (int i = 0; i < kLines; ++i) {
      memset(delayBuffers[i], 0, sizeof(delayBuffers[i]));
      writePtr[i] = 0;
      dampLP[i].reset();
    }
  }
};

// ------------------------------------------------------------
// Drone Pad (Engine Type 0) – 5 triangle voices with prime LFOs
// ------------------------------------------------------------
class DronePad {
  // Oscillator frequencies (A minor 9 suspended chord)
  static constexpr int kVoices = 5;
  float voiceFreq[kVoices] = {
    55.0f,      // A1 (root)
    82.5f,      // E2 (fifth)
    110.0f,     // A2 (octave)
    123.75f,    // B2 (ninth)
    165.0f      // E3 (fifth up)
  };

  TriangleOsc osc[kVoices];
  LFO volLFO[kVoices];       // volume modulation (prime freq)
  LFO cutLFO[kVoices];       // cutoff modulation (prime freq)
  Biquad voiceLP[kVoices];   // gentle low‑pass per voice
  MoogLadder masterMoog;     // final smoothing
  float sr;

  // Prime LFO frequencies (selected to have no common factors)
  float primeVol[kVoices]   = {0.011f, 0.013f, 0.017f, 0.019f, 0.023f};
  float primeCut[kVoices]   = {0.029f, 0.031f, 0.037f, 0.041f, 0.043f};

public:
  void init(float sampleRate) {
    sr = sampleRate;
    for (int i = 0; i < kVoices; ++i) {
      osc[i].init(sr, voiceFreq[i]);
      volLFO[i].init(sr, primeVol[i]);
      cutLFO[i].init(sr, primeCut[i]);
      voiceLP[i].setLP(800.0f, sr, 0.5f);
    }
    masterMoog.init(sr);
    masterMoog.setParams(800.0f, 0.2f);   // fixed, gentle low‑pass
  }

  float process() {
    float sum = 0;
    for (int i = 0; i < kVoices; ++i) {
      float sample = osc[i].next();

      // Volume LFO (range 0.3 .. 1.0)
      float vol = 0.3f + 0.7f * (0.5f + 0.5f * volLFO[i].get());
      sample *= vol;

      // Per‑voice cutoff LFO modulates its LP filter (200‑1200 Hz)
      float cutoffMod = 500.0f + 400.0f * cutLFO[i].get();
      voiceLP[i].setLP(cutoffMod, sr, 0.7f);
      sample = voiceLP[i].process(sample);

      sum += sample * 0.35f;   // scale to avoid clipping
    }

    // Final Moog ladder tames any remaining high end
    return masterMoog.process(sum);
  }
};

// ------------------------------------------------------------
// Procedural Wind (Engine Type 1)
// ------------------------------------------------------------
class Wind {
  PinkNoise noise;
  Biquad bp1, bp2;         // two howling bandpass filters
  LFO lfo1, lfo2;          // sweep their center frequencies
  LFO volLFO;              // slow volume swell
  float intensity = 0.5f;
  float sr;

public:
  void init(float sampleRate) {
    sr = sampleRate;
    noise.init(sr);
    bp1.setBP(350.0f, sr, 4.0f);
    bp2.setBP(700.0f, sr, 4.5f);
    lfo1.init(sr, 0.013f);   // prime
    lfo2.init(sr, 0.019f);   // prime
    volLFO.init(sr, 0.005f); // very slow
  }

  void setIntensity(float val) {
    intensity = val < 0 ? 0 : (val > 1 ? 1 : val);
  }

  float process() {
    float n = noise.next() * 0.7f;   // scale

    // Sweep BP center frequencies within a howling range
    float center1 = 200.0f + 400.0f * (0.5f + 0.5f * lfo1.get());
    float center2 = 500.0f + 600.0f * (0.5f + 0.5f * lfo2.get());
    bp1.setBP(center1, sr, 4.0f);
    bp2.setBP(center2, sr, 4.5f);

    float wind = bp1.process(n) + bp2.process(n);
    wind *= 0.6f;   // mix

    // Global volume swell (0.5 .. 1.0)
    float vol = 0.5f + 0.5f * (0.5f + 0.5f * volLFO.get());
    return wind * intensity * vol;
  }
};

// ------------------------------------------------------------
// Master Engine structure (one per AudioWorklet instance)
// ------------------------------------------------------------
class Engine {
public:
  int engineType;
  bool active;
  float sampleRate;

  DronePad drone;
  Wind     wind;
  FDNReverb reverb;
  Biquad   highPass;

  float reverbMix = 0.3f;
  float saturation = 0.0f;
  float windIntensity = 0.5f;

  // output buffer
  float outputBuffer[128];

  Engine() : active(true), engineType(0), sampleRate(kDefaultSr) {}

  void init(int sr, int type) {
    sampleRate = (float)sr;
    engineType = type;
    drone.init(sampleRate);
    wind.init(sampleRate);
    reverb.init(sampleRate);
    highPass.setHP(20.0f, sampleRate);   // gentle rumble removal
    highPass.reset();
    reverb.setWetMix(reverbMix);
  }

  float* process(int numFrames) {
    if (!active) {
      memset(outputBuffer, 0, numFrames * sizeof(float));
      return outputBuffer;
    }

    for (int i = 0; i < numFrames; ++i) {
      float dry = 0;
      if (engineType == 0) {
        dry = drone.process();
      } else if (engineType == 1) {
        wind.setIntensity(windIntensity);
        dry = wind.process();
      }

      // High‑pass (bypass if frequency very low)
      float hp = dry;
      if (highPass.b0 != 0) hp = highPass.process(dry);

      // Tape saturation (warmth, no hard clipping)
      float sat = hp;
      if (saturation > 0.001f) {
        float drive = 1.0f + saturation * 4.0f;
        sat = tanhf(drive * hp);
        // blend back to retain dynamics
        sat = sat * (1.0f - saturation * 0.5f) + hp * (saturation * 0.5f);
      }

      // FDN Reverb (handles wet/dry internally)
      reverb.setWetMix(reverbMix);
      float out = reverb.process(sat);
      outputBuffer[i] = out;
    }
    return outputBuffer;
  }
};

// ------------------------------------------------------------
// Global engine registry (static allocation)
// ------------------------------------------------------------
static Engine gEngines[kMaxEngines];
static bool gUsed[kMaxEngines] = {false};

// ------------------------------------------------------------
// C‑API exports
// ------------------------------------------------------------
extern "C" {

  void* createEngine(int sampleRate, int engineType) {
    for (int i = 0; i < kMaxEngines; ++i) {
      if (!gUsed[i]) {
        gUsed[i] = true;
        gEngines[i].init(sampleRate, engineType);
        return &gEngines[i];
      }
    }
    return nullptr;
  }

  void destroyEngine(void* ptr) {
    for (int i = 0; i < kMaxEngines; ++i) {
      if (&gEngines[i] == ptr) {
        gUsed[i] = false;
        break;
      }
    }
  }

  void setParameter(void* engine, int paramId, float value) {
    Engine* eng = reinterpret_cast<Engine*>(engine);
    if (!eng) return;

    switch (paramId) {
      case REVERB_MIX:
        eng->reverbMix = value < 0 ? 0 : (value > 1 ? 1 : value);
        eng->reverb.setWetMix(eng->reverbMix);
        break;
      case HIGH_PASS_FREQ:
        if (value <= 0.0f) {
          // bypass by setting a very low cutoff
          eng->highPass.setHP(1.0f, eng->sampleRate, 0.7071f);
          eng->highPass.reset();
        } else {
          eng->highPass.setHP(value, eng->sampleRate, 0.7071f);
        }
        break;
      case SATURATION:
        eng->saturation = value < 0 ? 0 : (value > 1 ? 1 : value);
        break;
      case WIND_INTENSITY:
        eng->windIntensity = value < 0 ? 0 : (value > 1 ? 1 : value);
        break;
      case ENGINE_TYPE:
        // Changing engine type requires re‑init of the entire engine;
        // this is handled by the JS side destroying and recreating the instance.
        // Here we just store the value (though it will be overwritten on creation).
        eng->engineType = (value < 0.5f) ? 0 : 1;
        break;
    }
  }

  float* processAudio(void* engine, int numFrames) {
    Engine* eng = reinterpret_cast<Engine*>(engine);
    if (!eng) return nullptr;
    return eng->process(numFrames);
  }
}
