// ============================================================
// dsp_engine.cpp
// Production-Grade Cinematic Ambient DSP Engine
// C++17 / WebAssembly Ready
// Designed for Emscripten (-std=c++17)
// ============================================================

#include <cmath>
#include <cstdint>
#include <cstring>
#include <algorithm>

constexpr float kPi = 3.14159265358979323846f;

constexpr int kMaxEngines    = 16;
constexpr int kBlockSize     = 128;
constexpr int kReverbLines   = 8;
constexpr int kMaxDelaySize  = 65536;

// ============================================================
// PARAM IDS
// ============================================================

enum ParamID {
    TIME_STRETCH     = 0,
    REVERB_MIX       = 1,
    HIGH_PASS_FREQ   = 2,
    SATURATION       = 3,
    MODULE_INTENSITY = 4,
    ENGINE_TYPE      = 5
};

// ============================================================
// FAST RANDOM
// ============================================================

struct FastRandom {
    uint32_t state = 0xA341316Cu;

    inline uint32_t nextUInt() {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return state;
    }

    inline float nextFloat() {
        return ((nextUInt() / 4294967295.0f) * 2.0f) - 1.0f;
    }

    inline float nextUnit() {
        return nextUInt() / 4294967295.0f;
    }
};

// ============================================================
// STABLE BIQUAD (DF2T)
// ============================================================

struct Biquad {

    float b0 = 1.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;

    float a1 = 0.0f;
    float a2 = 0.0f;

    float z1 = 0.0f;
    float z2 = 0.0f;

    inline void reset() {
        z1 = z2 = 0.0f;
    }

    inline void sanitize() {
        if (!std::isfinite(z1)) z1 = 0.0f;
        if (!std::isfinite(z2)) z2 = 0.0f;

        if (std::fabs(z1) < 1e-24f) z1 = 0.0f;
        if (std::fabs(z2) < 1e-24f) z2 = 0.0f;
    }

    inline float process(float x) {

        float y = b0 * x + z1;

        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;

        sanitize();

        return y;
    }

    void setLowpass(float freq, float sr, float q = 0.7071f) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float omega = 2.0f * kPi * freq / sr;
        const float sn = std::sin(omega);
        const float cs = std::cos(omega);
        const float alpha = sn / (2.0f * q);

        const float a0 = 1.0f + alpha;
        const float inv = 1.0f / a0;

        b0 = ((1.0f - cs) * 0.5f) * inv;
        b1 = (1.0f - cs) * inv;
        b2 = b0;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    void setHighpass(float freq, float sr, float q = 0.7071f) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float omega = 2.0f * kPi * freq / sr;
        const float sn = std::sin(omega);
        const float cs = std::cos(omega);
        const float alpha = sn / (2.0f * q);

        const float a0 = 1.0f + alpha;
        const float inv = 1.0f / a0;

        b0 = ((1.0f + cs) * 0.5f) * inv;
        b1 = (-(1.0f + cs)) * inv;
        b2 = b0;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    void setBandpass(float freq, float sr, float q) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float omega = 2.0f * kPi * freq / sr;
        const float sn = std::sin(omega);
        const float cs = std::cos(omega);
        const float alpha = sn / (2.0f * q);

        const float a0 = 1.0f + alpha;
        const float inv = 1.0f / a0;

        b0 = alpha * inv;
        b1 = 0.0f;
        b2 = -alpha * inv;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }
};

// ============================================================
// OSCILLATOR
// ============================================================

struct Oscillator {

    float phase = 0.0f;
    float freq  = 110.0f;
    float sr    = 44100.0f;

    void init(float sampleRate) {
        sr = sampleRate;
    }

    inline void setFreq(float f) {
        freq = f;
    }

    inline float nextSaw() {

        phase += freq / sr;

        if (phase >= 1.0f)
            phase -= 1.0f;

        return (2.0f * phase) - 1.0f;
    }
};

// ============================================================
// LFO
// ============================================================

struct LFO {

    float phase = 0.0f;
    float freq  = 0.1f;
    float depth = 1.0f;
    float sr    = 44100.0f;

    void init(float sampleRate, float frequency) {
        sr = sampleRate;
        freq = frequency;
    }

    inline float process() {

        phase += freq / sr;

        if (phase >= 1.0f)
            phase -= 1.0f;

        return std::sin(2.0f * kPi * phase) * depth;
    }
};

// ============================================================
// BROWN NOISE
// ============================================================

struct BrownNoise {

    FastRandom rng;
    float state = 0.0f;

    inline float process() {

        state += rng.nextFloat() * 0.02f;
        state *= 0.995f;

        state = std::clamp(state, -1.0f, 1.0f);

        return state;
    }
};

// ============================================================
// PINK NOISE
// ============================================================

struct PinkNoise {

    FastRandom rng;

    float b0 = 0.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;

    inline float process() {

        const float white = rng.nextFloat();

        b0 = 0.99765f * b0 + white * 0.0990460f;
        b1 = 0.96300f * b1 + white * 0.2965164f;
        b2 = 0.57000f * b2 + white * 1.0526913f;

        return (b0 + b1 + b2 + white * 0.1848f) * 0.05f;
    }
};

// ============================================================
// STABLE ZDF MOOG LADDER
// ============================================================

struct MoogLadder {

    float sr = 44100.0f;

    float cutoff = 1000.0f;
    float resonance = 0.2f;

    float z1[4] = {0};

    void init(float sampleRate) {
        sr = sampleRate;
    }

    inline void setParams(float c, float r) {

        cutoff = std::clamp(c, 20.0f, sr * 0.45f);
        resonance = std::clamp(r, 0.0f, 1.0f);
    }

    inline float process(float input) {

        const float g =
            std::tan(kPi * cutoff / sr);

        const float G =
            g / (1.0f + g);

        float s =
            (z1[0] + z1[1] + z1[2] + z1[3]) * 0.25f;

        float u =
            (input - resonance * s);

        // Stage 1
        float v1 = (u - z1[0]) * G;
        float y1 = v1 + z1[0];
        z1[0] = y1 + v1;

        // Stage 2
        float v2 = (y1 - z1[1]) * G;
        float y2 = v2 + z1[1];
        z1[1] = y2 + v2;

        // Stage 3
        float v3 = (y2 - z1[2]) * G;
        float y3 = v3 + z1[2];
        z1[2] = y3 + v3;

        // Stage 4
        float v4 = (y3 - z1[3]) * G;
        float y4 = v4 + z1[3];
        z1[3] = y4 + v4;

        // Soft saturation
        return std::tanh(y4 * 1.5f);
    }
};

// ============================================================
// 8-LINE FDN REVERB
// ============================================================

struct FDNReverb {

    int delayLengths[kReverbLines] = {
        11681,
        12377,
        13159,
        13931,
        14717,
        15511,
        16381,
        17191
    };

    float buffers[kReverbLines][kMaxDelaySize] = {};
    int writePos[kReverbLines] = {};

    Biquad dampers[kReverbLines];

    float wet = 0.25f;
    float feedback = 0.93f;

    void init(float sr) {

        for (int i = 0; i < kReverbLines; ++i) {
            dampers[i].setLowpass(7000.0f, sr, 0.707f);
        }
    }

    inline float process(float input) {

        float outputs[kReverbLines];
        float sum = 0.0f;

        for (int i = 0; i < kReverbLines; ++i) {

            int readPos =
                writePos[i] - delayLengths[i];

            while (readPos < 0)
                readPos += kMaxDelaySize;

            float delayed =
                buffers[i][readPos];

            delayed =
                dampers[i].process(delayed);

            outputs[i] = delayed;

            sum += delayed;
        }

        float average = sum / kReverbLines;

        for (int i = 0; i < kReverbLines; ++i) {

            float feedbackSample =
                outputs[i] - average;

            buffers[i][writePos[i]] =
                input + feedbackSample * feedback;

            writePos[i]++;

            if (writePos[i] >= kMaxDelaySize)
                writePos[i] = 0;
        }

        return
            input * (1.0f - wet) +
            average * wet;
    }
};

// ============================================================
// CINEMATIC PAD
// ============================================================

struct CinematicPad {

    Oscillator osc[7];

    MoogLadder ladder;

    LFO cutoffLFO;

    float sr = 44100.0f;

    float pitchMultiplier = 1.0f;

    void init(float sampleRate) {

        sr = sampleRate;

        const float detune[7] = {
            -0.035f,
            -0.020f,
            -0.010f,
             0.000f,
             0.010f,
             0.020f,
             0.035f
        };

        for (int i = 0; i < 7; ++i) {

            osc[i].init(sr);

            osc[i].setFreq(
                55.0f * (1.0f + detune[i])
            );
        }

        ladder.init(sr);

        cutoffLFO.init(sr, 0.05f);
        cutoffLFO.depth = 700.0f;
    }

    inline float process() {

        float mix = 0.0f;

        for (int i = 0; i < 7; ++i) {

            mix += osc[i].nextSaw() * 0.12f;
        }

        const float cutoff =
            250.0f + cutoffLFO.process();

        ladder.setParams(cutoff, 0.45f);

        return ladder.process(mix) * 0.45f;
    }
};

// ============================================================
// PROCEDURAL WIND
// ============================================================

struct ProceduralWind {

    BrownNoise noise;

    Biquad bp1;
    Biquad bp2;

    LFO lfo1;
    LFO lfo2;

    float sr = 44100.0f;

    float intensity = 0.5f;

    int coeffCounter = 0;

    void init(float sampleRate) {

        sr = sampleRate;

        bp1.setBandpass(300.0f, sr, 4.0f);
        bp2.setBandpass(600.0f, sr, 3.0f);

        lfo1.init(sr, 0.08f);
        lfo2.init(sr, 0.11f);

        lfo1.depth = 250.0f;
        lfo2.depth = 350.0f;
    }

    inline float process() {

        // IMPORTANT:
        // LFO advances EVERY SAMPLE
        // No freeze bug possible

        const float mod1 = lfo1.process();
        const float mod2 = lfo2.process();

        coeffCounter++;

        if (coeffCounter >= 32) {

            coeffCounter = 0;

            bp1.setBandpass(
                250.0f + mod1,
                sr,
                4.0f
            );

            bp2.setBandpass(
                500.0f + mod2,
                sr,
                3.0f
            );
        }

        const float n =
            noise.process() * intensity;

        float out =
            bp1.process(n) +
            bp2.process(n);

        return out * 0.4f;
    }
};

// ============================================================
// RAIN + THUNDER
// ============================================================

struct ProceduralRain {

    PinkNoise rainNoise;
    BrownNoise thunderNoise;

    Biquad rainHP;
    Biquad thunderLP;

    FastRandom rng;

    float sr = 44100.0f;

    float intensity = 0.5f;

    float thunderEnv = 0.0f;

    int thunderCounter = 0;
    int nextThunderSamples = 0;

    void init(float sampleRate) {

        sr = sampleRate;

        rainHP.setHighpass(4500.0f, sr);
        thunderLP.setLowpass(120.0f, sr);

        scheduleNextThunder();
    }

    inline void scheduleNextThunder() {

        const float seconds =
            7.0f + rng.nextUnit() * 3.0f;

        nextThunderSamples =
            static_cast<int>(seconds * sr);

        thunderCounter = 0;
    }

    inline float process() {

        // Rain

        float rain =
            rainNoise.process();

        rain =
            rainHP.process(rain);

        rain *= intensity * 0.8f;

        // Thunder Trigger

        thunderCounter++;

        if (thunderCounter >= nextThunderSamples) {

            thunderEnv = 1.0f;

            scheduleNextThunder();
        }

        // Thunder Envelope

        thunderEnv *= 0.99992f;

        // Thunder Noise

        float thunder =
            thunderNoise.process();

        thunder =
            thunderLP.process(thunder);

        thunder *= thunderEnv * thunderEnv;

        thunder *= 3.0f;

        return rain + thunder;
    }
};

// ============================================================
// MAIN ENGINE
// ============================================================

struct OmniEngine {

    int sampleRate = 44100;

    int engineType = 0;

    bool active = true;

    CinematicPad pad;
    ProceduralWind wind;
    ProceduralRain rain;

    Biquad highpass;

    bool hpEnabled = false;

    FDNReverb reverb;

    float saturation = 0.0f;
    float reverbMix  = 0.25f;
    float moduleIntensity = 0.5f;
    float timeStretch = 1.0f;

    float outputBuffer[kBlockSize] = {};

    void init(int sr, int type) {

        sampleRate = sr;
        engineType = type;

        pad.init(sr);
        wind.init(sr);
        rain.init(sr);

        highpass.setHighpass(30.0f, sr);

        reverb.init(sr);
    }

    inline float saturate(float x) {

        const float drive =
            1.0f + saturation * 8.0f;

        return std::tanh(x * drive);
    }

    float* process(int numFrames) {

        numFrames =
            std::min(numFrames, kBlockSize);

        reverb.wet = reverbMix;

        for (int i = 0; i < numFrames; ++i) {

            float dry = 0.0f;

            switch (engineType) {

                case 0:
                    pad.pitchMultiplier = timeStretch;
                    dry = pad.process();
                    break;

                case 1:
                    wind.intensity = moduleIntensity;
                    dry = wind.process();
                    break;

                case 2:
                    rain.intensity = moduleIntensity;
                    dry = rain.process();
                    break;

                default:
                    dry = 0.0f;
                    break;
            }

            // FX CHAIN

            if (hpEnabled)
                dry = highpass.process(dry);

            dry = saturate(dry);

            dry = reverb.process(dry);

            // Safety limiter

            dry =
                std::clamp(dry, -1.0f, 1.0f);

            outputBuffer[i] = dry;
        }

        return outputBuffer;
    }
};

// ============================================================
// GLOBAL ENGINE POOL
// ============================================================

static OmniEngine gEngines[kMaxEngines];
static bool gUsed[kMaxEngines] = { false };

// ============================================================
// C API EXPORTS
// ============================================================

extern "C" {

// ------------------------------------------------------------
// CREATE ENGINE
// ------------------------------------------------------------

void* createEngine(
    int sampleRate,
    int engineType
) {

    for (int i = 0; i < kMaxEngines; ++i) {

        if (!gUsed[i]) {

            gUsed[i] = true;

            gEngines[i].init(
                sampleRate,
                engineType
            );

            return &gEngines[i];
        }
    }

    return nullptr;
}

// ------------------------------------------------------------
// DESTROY ENGINE
// ------------------------------------------------------------

void destroyEngine(void* ptr) {

    for (int i = 0; i < kMaxEngines; ++i) {

        if (&gEngines[i] == ptr) {

            gUsed[i] = false;

            break;
        }
    }
}

// ------------------------------------------------------------
// SET PARAMETER
// ------------------------------------------------------------

void setParameter(
    void* engine,
    int paramId,
    float value
) {

    if (!engine)
        return;

    OmniEngine* eng =
        static_cast<OmniEngine*>(engine);

    switch (paramId) {

        case TIME_STRETCH:
            eng->timeStretch =
                std::clamp(value, 0.25f, 4.0f);
            break;

        case REVERB_MIX:
            eng->reverbMix =
                std::clamp(value, 0.0f, 1.0f);
            break;

        case HIGH_PASS_FREQ:

            if (value <= 0.0f) {

                eng->hpEnabled = false;
            }
            else {

                eng->hpEnabled = true;

                eng->highpass.setHighpass(
                    value,
                    eng->sampleRate
                );
            }

            break;

        case SATURATION:
            eng->saturation =
                std::clamp(value, 0.0f, 1.0f);
            break;

        case MODULE_INTENSITY:
            eng->moduleIntensity =
                std::clamp(value, 0.0f, 1.0f);
            break;

        case ENGINE_TYPE:
            eng->engineType =
                static_cast<int>(value);
            break;

        default:
            break;
    }
}

// ------------------------------------------------------------
// PROCESS AUDIO
// ------------------------------------------------------------

float* processAudio(
    void* engine,
    int numFrames
) {

    if (!engine)
        return nullptr;

    return
        static_cast<OmniEngine*>(engine)
            ->process(numFrames);
}

}
