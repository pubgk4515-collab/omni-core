#include <cmath>
#include <cstring>
#include <algorithm>
#include <cstdlib>

constexpr float kPi = 3.1415926535f;
constexpr int kMaxEngines = 16;
constexpr int kBlockSize = 128;

// Parameters
enum ParamID {
  TIME_STRETCH   = 0,
  REVERB_MIX     = 1,
  HIGH_PASS_FREQ = 2,
  SATURATION     = 3,
  MODULE_INTENSITY = 4, // Works for Wind & Rain
  ENGINE_TYPE    = 5    // 0 = Drone, 1 = Wind, 2 = Rain
};

// ---------------------------------------------------------------------------
// 1. Rock-Solid Biquad Filter (Direct Form 2 Transposed - No Explosions!)
// ---------------------------------------------------------------------------
struct Biquad {
  float b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  float z1 = 0, z2 = 0;

  void setLP(float freq, float sr, float q = 0.7071f) {
    float omega = 2.0f * kPi * freq / sr;
    float cs = cosf(omega), sn = sinf(omega);
    float alpha = sn / (2.0f * q);
    float a0inv = 1.0f / (1.0f + alpha);
    b0 = ((1.0f - cs) * 0.5f) * a0inv; b1 = (1.0f - cs) * a0inv; b2 = b0;
    a1 = (-2.0f * cs) * a0inv; a2 = (1.0f - alpha) * a0inv;
  }

  void setHP(float freq, float sr, float q = 0.7071f) {
    float omega = 2.0f * kPi * freq / sr;
    float cs = cosf(omega), sn = sinf(omega);
    float alpha = sn / (2.0f * q);
    float a0inv = 1.0f / (1.0f + alpha);
    b0 = ((1.0f + cs) * 0.5f) * a0inv; b1 = (-(1.0f + cs)) * a0inv; b2 = b0;
    a1 = (-2.0f * cs) * a0inv; a2 = (1.0f - alpha) * a0inv;
  }

  void setBP(float freq, float sr, float q) {
    float omega = 2.0f * kPi * freq / sr;
    float cs = cosf(omega), sn = sinf(omega);
    float alpha = sn / (2.0f * q);
    float a0inv = 1.0f / (1.0f + alpha);
    b0 = (sn * 0.5f) * a0inv; b1 = 0.0f; b2 = (-sn * 0.5f) * a0inv;
    a1 = (-2.0f * cs) * a0inv; a2 = (1.0f - alpha) * a0inv;
  }

  float process(float in) {
    float out = b0 * in + z1;
    z1 = b1 * in - a1 * out + z2;
    z2 = b2 * in - a2 * out;
    return out;
  }
};

// ---------------------------------------------------------------------------
// 2. Cinematic Components (Moog Ladder, Oscillators, LFO, Noise)
// ---------------------------------------------------------------------------
struct MoogLadder {
  float stage = {0};
  float lastOut = 0, sampleRate = 44100, cutoff = 1000, resonance = 0.2f;

  void init(float sr) { sampleRate = sr; }
  void setCutoff(float f, float res = 0.3f) {
    cutoff = f; resonance = res * 3.9f;
  }
  float process(float input) {
    float f = 1.27f * (cutoff / sampleRate);
    float g = f * 1.414f;
    float x = input - 4.0f * resonance * (stage - 0.333333f * stage * stage * stage);
    for (int i = 0; i < 4; ++i) {
      stage[i] += g * (tanhf(x) - stage[i]);
      x = stage[i];
    }
    return stage;
  }
};

struct Osc {
  float phase = 0, freq = 55, sr = 44100;
  void init(float sampleRate) { sr = sampleRate; }
  void setFreq(float f) { freq = f; }
  float next() {
    float v = 2.0f * phase - 1.0f; 
    phase += freq / sr;
    if (phase >= 1.0f) phase -= 1.0f;
    return v;
  }
};

struct LFO {
  float phase = 0, freq = 0.05f, sr = 44100, depth = 1.0f;
  void init(float sampleRate, float f) { sr = sampleRate; freq = f; }
  float get() {
    phase += freq / sr;
    if (phase >= 1.0f) phase -= 1.0f;
    return depth * sinf(2.0f * kPi * phase);
  }
};

struct BrownNoise {
  float prev = 0, gain = 1.0f;
  float next() {
    float white = ((float)rand() / (float)RAND_MAX) * 2.0f - 1.0f;
    prev = (prev + white * 0.02f) * 0.99f; 
    return prev * gain;
  }
};

struct FDNReverb {
  static constexpr int kNumLines = 8;
  int delayLen[kNumLines] = { 1300, 1500, 1800, 2100, 2400, 2700, 3000, 3300 };
  float delayBuffers[kNumLines];
  int writePtr[kNumLines] = {0};
  float feedbackGain = 0.85f, wetMix = 0.0f;
  Biquad lpFilters[kNumLines];

  void init(int sr) {
    for (int i = 0; i < kNumLines; ++i) {
      memset(delayBuffers[i], 0, sizeof(delayBuffers[i]));
      lpFilters[i].setLP(6000.0f, sr, 0.6f);
    }
  }
  float process(float in) {
    if (wetMix <= 0.01f) return in;
    float lineOut[kNumLines], sum = 0;
    for (int i = 0; i < kNumLines; ++i) {
      lineOut[i] = lpFilters[i].process(delayBuffers[i][writePtr[i] % delayLen[i]]);
      sum += lineOut[i];
    }
    float scalar = 2.0f / kNumLines * sum;
    float wetOut = 0;
    for (int i = 0; i < kNumLines; ++i) {
      float feed = lineOut[i] - scalar;
      delayBuffers[i][(writePtr[i] + 1) % delayLen[i]] = feed * feedbackGain + ((i == 0) ? in : 0.0f);
      writePtr[i] = (writePtr[i] + 1) % delayLen[i];
      wetOut += lineOut[i];
    }
    return (1.0f - wetMix) * in + wetMix * (wetOut / kNumLines);
  }
};

// ---------------------------------------------------------------------------
// 3. Module Engines (Type 0, Type 1, Type 2)
// ---------------------------------------------------------------------------

// TYPE 0: ZIMMER DRONE
struct CinematicPad {
  Osc osc; MoogLadder ladder; LFO cutoffLFO; float pitchMultiplier = 1.0f;
  void init(float sr) {
    float detune = {0.97f, 0.985f, 0.995f, 1.0f, 1.005f, 1.015f, 1.025f};
    for (int i=0; i<7; ++i) { osc[i].init(sr); osc[i].setFreq(55.0f * detune[i]); }
    ladder.init(sr); cutoffLFO.init(sr, 0.05f); cutoffLFO.depth = 0.7f;
  }
  float process() {
    float sample = 0;
    for (int i=0; i<7; ++i) {
      osc[i].setFreq(55.0f * (1.0f + (i-3)*0.01f) * pitchMultiplier);
      sample += osc[i].next() * 0.4f;
    }
    ladder.setCutoff(300.0f + cutoffLFO.get() * 250.0f, 0.25f);
    return ladder.process(sample) * 0.25f;
  }
};

// TYPE 1: PROCEDURAL WIND
struct ProceduralWind {
  BrownNoise noise; Biquad bp1, bp2; LFO lfo1, lfo2;
  float intensity = 0.5f, sampleRate = 44100;
  void init(float sr) {
    sampleRate = sr; bp1.setBP(300.0f, sr, 4.0f); bp2.setBP(600.0f, sr, 3.5f);
    lfo1.init(sr, 0.12f); lfo2.init(sr, 0.17f);
  }
  float process() {
    float n = noise.next() * intensity * 1.5f;
    bp1.setBP(200.0f + lfo1.get() * 300.0f, sampleRate, 4.0f);
    bp2.setBP(500.0f + lfo2.get() * 350.0f, sampleRate, 3.5f);
    return (bp1.process(n) + bp2.process(n)) * 0.5f * intensity;
  }
};

// TYPE 2: CINEMATIC RAIN & THUNDER
struct ProceduralRain {
  BrownNoise thunderNoise; Biquad rainFilter; 
  float intensity = 0.5f, sampleRate = 44100, thunderEnv = 0.0f, pinkState = 0.0f, tFilter = 0.0f;
  int thunderTimer = 0;
  
  void init(float sr) {
    sampleRate = sr;
    rainFilter.setHP(400.0f, sr, 0.5f); // Crisp drops
  }
  
  float process() {
    // Rain
    float rawRain = ((float)rand() / RAND_MAX) * 2.0f - 1.0f;
    pinkState = 0.99f * pinkState + 0.05f * rawRain;
    float rainSound = rainFilter.process(pinkState) * 0.4f * intensity;

    // Thunder Rumble
    thunderTimer++;
    if (thunderTimer > sampleRate * 7.0f) { // Check every 7 seconds
      if (((float)rand() / RAND_MAX) < (0.1f + intensity * 0.3f)) thunderEnv = 1.0f; // Strike
      thunderTimer = 0;
    }
    thunderEnv *= 0.9998f; // Slow deep decay
    
    float tNoise = thunderNoise.next();
    float rawThunder = tNoise * thunderEnv * thunderEnv * 2.5f;
    tFilter = 0.95f * tFilter + 0.05f * rawThunder; // Muffle the boom

    return rainSound + tFilter;
  }
};

// ---------------------------------------------------------------------------
// 4. The Master Wrapper
// ---------------------------------------------------------------------------
struct OmniEngine {
  int sampleRate, engineType; bool active;
  CinematicPad pad; ProceduralWind wind; ProceduralRain rain;
  FDNReverb reverb; Biquad highPass;
  float reverbMix = 0.0f, saturation = 0.0f, moduleIntensity = 0.0f, timeStretch = 1.0f;
  float outputBuffer;

  OmniEngine() : active(true), engineType(0) {}

  void init(int sr, int type) {
    sampleRate = sr; engineType = type;
    pad.init(sr); wind.init(sr); rain.init(sr); reverb.init(sr);
    highPass.setHP(30.0f, sr);
  }

  float* process(int numFrames) {
    if (!active) {
      memset(outputBuffer, 0, numFrames * sizeof(float));
      return outputBuffer;
    }
    for (int i = 0; i < numFrames; ++i) {
      float dry = 0;
      if (engineType == 0) { pad.pitchMultiplier = timeStretch; dry = pad.process(); } 
      else if (engineType == 1) { wind.intensity = moduleIntensity; dry = wind.process(); }
      else if (engineType == 2) { rain.intensity = moduleIntensity; dry = rain.process(); }

      float hpOut = (highPass.b0 != 0) ? highPass.process(dry) : dry;
      float warm = hpOut;
      if (saturation > 0.001f) {
        warm = tanhf((1.0f + saturation * 5.0f) * warm);
        warm = warm * (1.0f - saturation * 0.3f) + hpOut * (saturation * 0.3f);
      }
      reverb.wetMix = reverbMix;
      outputBuffer[i] = reverb.process(warm);
    }
    return outputBuffer;
  }
};

static OmniEngine gEngines[kMaxEngines];
static bool gUsed[kMaxEngines] = {false};

extern "C" {
  void* createEngine(int sampleRate, int engineType) {
    for (int i = 0; i < kMaxEngines; ++i) {
      if (!gUsed[i]) { gUsed[i] = true; gEngines[i].init(sampleRate, engineType); return &gEngines[i]; }
    }
    return nullptr;
  }
  void destroyEngine(void* ptr) {
    for (int i = 0; i < kMaxEngines; ++i) { if (&gEngines[i] == ptr) { gUsed[i] = false; break; } }
  }
  void setParameter(void* engine, int paramId, float value) {
    OmniEngine* eng = (OmniEngine*)engine;
    switch (paramId) {
      case TIME_STRETCH: eng->timeStretch = value; break;
      case REVERB_MIX: eng->reverbMix = std::max(0.0f, std::min(1.0f, value)); break;
      case HIGH_PASS_FREQ: if (value <= 0.0f) eng->highPass.b0 = 0; else eng->highPass.setHP(value, eng->sampleRate); break;
      case SATURATION: eng->saturation = std::max(0.0f, std::min(1.0f, value)); break;
      case MODULE_INTENSITY: eng->moduleIntensity = value; break;
    }
  }
  float* processAudio(void* engine, int numFrames) {
    return ((OmniEngine*)engine)->process(numFrames);
  }
}
