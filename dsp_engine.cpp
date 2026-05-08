// ============================================================
// dsp_engine.cpp
// Production-Grade Cinematic Ambient DSP Engine
// Stable for WebAssembly / Emscripten
// C++17
// ============================================================

#include <cmath>
#include <cstdint>
#include <cstring>
#include <algorithm>

constexpr float kPi = 3.14159265358979323846f;

constexpr int kBlockSize    = 128;
constexpr int kMaxEngines   = 16;
constexpr int kReverbLines  = 8;
constexpr int kMaxDelaySize = 65536;

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

    uint32_t state = 0x12345678u;

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
// STABLE DF2T BIQUAD
// ============================================================

struct Biquad {

    float b0 = 1.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;

    float a1 = 0.0f;
    float a2 = 0.0f;

    float z1 = 0.0f;
    float z2 = 0.0f;

    inline void sanitize() {

        if (!std::isfinite(z1)) z1 = 0.0f;
        if (!std::isfinite(z2)) z2 = 0.0f;

        if (std::fabs(z1) < 1e-20f) z1 = 0.0f;
        if (std::fabs(z2) < 1e-20f) z2 = 0.0f;
    }

    inline float process(float x) {

        const float y = b0 * x + z1;

        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;

        sanitize();

        return y;
    }

    void setLowpass(float freq, float sr, float q = 0.707f) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float w0 = 2.0f * kPi * freq / sr;
        const float cs = std::cos(w0);
        const float sn = std::sin(w0);

        const float alpha = sn / (2.0f * q);

        const float a0 = 1.0f + alpha;
        const float inv = 1.0f / a0;

        b0 = ((1.0f - cs) * 0.5f) * inv;
        b1 = (1.0f - cs) * inv;
        b2 = b0;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    void setHighpass(float freq, float sr, float q = 0.707f) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float w0 = 2.0f * kPi * freq / sr;
        const float cs = std::cos(w0);
        const float sn = std::sin(w0);

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

        const float w0 = 2.0f * kPi * freq / sr;
        const float cs = std::cos(w0);
        const float sn = std::sin(w0);

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

        return phase * 2.0f - 1.0f;
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

        float white = rng.nextFloat();

        b0 = 0.99765f * b0 + white * 0.0990460f;
        b1 = 0.96300f * b1 + white * 0.2965164f;
        b2 = 0.57000f * b2 + white * 1.0526913f;

        return (b0 + b1 + b2 + white * 0.1848f) * 0.05f;
    }
};

// ============================================================
// STABLE MOOG LADDER
// ============================================================

struct MoogLadder {

    float sr = 44100.0f;

    float cutoff = 1000.0f;
    float resonance = 0.2f;

    float z[4] = {0};

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

        const float feedback =
            resonance * z[3];

        float x = input - feedback;

        for (int i = 0; i < 4; ++i) {

            float v = (x - z[i]) * G;
            float y = v + z[i];

            z[i] = y + v;

            x = std::tanh(y);
        }

        return x;
    }
};

// ============================================================
// MASSIVE FDN REVERB
// ============================================================

struct FDNReverb {

    int delayLengths[kReverbLines] = {
        11173,
        12277,
        13397,
        14591,
        15803,
        17029,
        18217,
        19423
    };

    float buffers[kReverbLines][kMaxDelaySize] = {};

    int writePos[kReverbLines] = {};

    Biquad dampers[kReverbLines];

    float wet = 0.25f;

    float feedback = 0.94f;

    void init(float sr) {

        for (int i = 0; i < kReverbLines; ++i) {

            dampers[i].setLowpass(
                6500.0f,
                sr,
                0.707f
            );
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

        float average =
            sum / kReverbLines;

        for (int i = 0; i < kReverbLines; ++i) {

            float feedbackSignal =
                outputs[i] - average;

            buffers[i][writePos[i]] =
                input +
                feedbackSignal * feedback;

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

    float pitchMultiplier = 1.0f;

    void init(float sr) {

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

        cutoffLFO.depth = 900.0f;
    }

    inline float process() {

        float mix = 0.0f;

        for (int i = 0; i < 7; ++i) {

            mix += osc[i].nextSaw() * 0.12f;
        }

        const float cutoff =
            350.0f + cutoffLFO.process();

        ladder.setParams(
            cutoff,
            0.35f
        );

        return ladder.process(mix) * 0.45f;
    }
};

// ============================================================
// REALISTIC WIND
// ============================================================

struct ProceduralWind {

    BrownNoise noise;

    Biquad bp1;
    Biquad bp2;

    Biquad airLP;

    LFO lfo1;
    LFO lfo2;
    LFO gustLFO;

    float sr = 44100.0f;

    float intensity = 0.5f;

    int coeffCounter = 0;

    void init(float sampleRate) {

        sr = sampleRate;

        bp1.setBandpass(120.0f, sr, 0.7f);
        bp2.setBandpass(340.0f, sr, 0.9f);

        airLP.setLowpass(2200.0f, sr);

        lfo1.init(sr, 0.07f);
        lfo2.init(sr, 0.11f);
        gustLFO.init(sr, 0.018f);

        lfo1.depth = 60.0f;
        lfo2.depth = 90.0f;

        gustLFO.depth = 0.35f;
    }

    inline float process() {

        // IMPORTANT:
        // LFO ALWAYS ADVANCES
        // NO FREEZE BUG

        const float mod1 = lfo1.process();
        const float mod2 = lfo2.process();

        const float gust =
            0.65f + gustLFO.process();

        coeffCounter++;

        // Only coefficients update slowly
        // not the modulation sources

        if (coeffCounter >= 32) {

            coeffCounter = 0;

            bp1.setBandpass(
                120.0f + mod1,
                sr,
                0.7f
            );

            bp2.setBandpass(
                340.0f + mod2,
                sr,
                0.9f
            );
        }

        float n =
            noise.process();

        float out =
            bp1.process(n) * 0.7f +
            bp2.process(n) * 0.5f;

        out =
            airLP.process(out);

        out *= gust;

        out *= intensity;

        return out * 0.55f;
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
    int nextThunder = 0;

    void init(float sampleRate) {

        sr = sampleRate;

        rainHP.setHighpass(
            4200.0f,
            sr
        );

        thunderLP.setLowpass(
            120.0f,
            sr
        );

        scheduleThunder();
    }

    inline void scheduleThunder() {

        float seconds =
            7.0f + rng.nextUnit() * 3.0f;

        nextThunder =
            static_cast<int>(seconds * sr);

        thunderCounter = 0;
    }

    inline float process() {

        // Rain layer

        float rain =
            rainNoise.process();

        rain =
            rainHP.process(rain);

        rain *=
            intensity * 0.9f;

        // Thunder timing

        thunderCounter++;

        if (thunderCounter >= nextThunder) {

            thunderEnv = 1.0f;

            scheduleThunder();
        }

        // Thunder envelope

        thunderEnv *= 0.99993f;

        // Thunder

        float thunder =
            thunderNoise.process();

        thunder =
            thunderLP.process(thunder);

        thunder *=
            thunderEnv *
            thunderEnv *
            3.0f;

        return rain + thunder;
    }
};

// ============================================================
// OMNI ENGINE
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

    float reverbMix = 0.25f;

    float moduleIntensity = 0.5f;

    float timeStretch = 1.0f;

    float outputBuffer[kBlockSize] = {};

    void init(int sr, int type) {

        sampleRate = sr;

        engineType = type;

        pad.init(sr);
        wind.init(sr);
        rain.init(sr);

        highpass.setHighpass(
            30.0f,
            sr
        );

        reverb.init(sr);
    }

    inline float saturate(float x) {

        float drive =
            1.0f + saturation * 6.0f;

        return std::tanh(x * drive);
    }

    float* process(int numFrames) {

        numFrames =
            std::min(
                numFrames,
                kBlockSize
            );

        reverb.wet = reverbMix;

        for (int i = 0; i < numFrames; ++i) {

            float dry = 0.0f;

            switch (engineType) {

                case 0:

                    pad.pitchMultiplier =
                        timeStretch;

                    dry =
                        pad.process();

                    break;

                case 1:

                    wind.intensity =
                        moduleIntensity;

                    dry =
                        wind.process();

                    break;

                case 2:

                    rain.intensity =
                        moduleIntensity;

                    dry =
                        rain.process();

                    break;

                default:

                    dry = 0.0f;

                    break;
            }

            // MASTER FX CHAIN

            if (hpEnabled)
                dry = highpass.process(dry);

            dry =
                saturate(dry);

            dry =
                reverb.process(dry);

            dry =
                std::clamp(
                    dry,
                    -1.0f,
                    1.0f
                );

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
// EXPORTED C API
// ============================================================

extern "C" {

// ------------------------------------------------------------
// CREATE
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
// DESTROY
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
// SET PARAM
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
                std::clamp(
                    value,
                    0.25f,
                    4.0f
                );

            break;

        case REVERB_MIX:

            eng->reverbMix =
                std::clamp(
                    value,
                    0.0f,
                    1.0f
                );

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
                std::clamp(
                    value,
                    0.0f,
                    1.0f
                );

            break;

        case MODULE_INTENSITY:

            eng->moduleIntensity =
                std::clamp(
                    value,
                    0.0f,
                    1.0f
                );

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
// PROCESS
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
