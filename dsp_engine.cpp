// ============================================================
// dsp_engine.cpp
// Endless Generative Ambient Engine
// Brian Eno + Hans Zimmer Inspired
// Stable WebAssembly DSP Engine
// C++17 / Emscripten Ready
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
};

// ============================================================
// PRIME-LFO
// ============================================================

struct PrimeLFO {

    float phase = 0.0f;
    float freq  = 0.01f;
    float depth = 1.0f;
    float offset = 0.0f;

    float sr = 44100.0f;

    void init(
        float sampleRate,
        float frequency,
        float d,
        float o = 0.0f
    ) {
        sr = sampleRate;
        freq = frequency;
        depth = d;
        offset = o;
    }

    inline float process() {

        phase += freq / sr;

        if (phase >= 1.0f)
            phase -= 1.0f;

        return
            std::sin(2.0f * kPi * phase)
            * depth
            + offset;
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

        if (!std::isfinite(z1))
            z1 = 0.0f;

        if (!std::isfinite(z2))
            z2 = 0.0f;

        if (std::fabs(z1) < 1e-24f)
            z1 = 0.0f;

        if (std::fabs(z2) < 1e-24f)
            z2 = 0.0f;
    }

    inline float process(float x) {

        const float y = b0 * x + z1;

        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;

        sanitize();

        return y;
    }

    void setLowpass(
        float freq,
        float sr,
        float q = 0.707f
    ) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float w0 =
            2.0f * kPi * freq / sr;

        const float cs = std::cos(w0);
        const float sn = std::sin(w0);

        const float alpha =
            sn / (2.0f * q);

        const float a0 =
            1.0f + alpha;

        const float inv =
            1.0f / a0;

        b0 = ((1.0f - cs) * 0.5f) * inv;
        b1 = (1.0f - cs) * inv;
        b2 = b0;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    void setBandpass(
        float freq,
        float sr,
        float q
    ) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float w0 =
            2.0f * kPi * freq / sr;

        const float cs = std::cos(w0);
        const float sn = std::sin(w0);

        const float alpha =
            sn / (2.0f * q);

        const float a0 =
            1.0f + alpha;

        const float inv =
            1.0f / a0;

        b0 = alpha * inv;
        b1 = 0.0f;
        b2 = -alpha * inv;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    void setHighpass(
        float freq,
        float sr,
        float q = 0.707f
    ) {

        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        const float w0 =
            2.0f * kPi * freq / sr;

        const float cs = std::cos(w0);
        const float sn = std::sin(w0);

        const float alpha =
            sn / (2.0f * q);

        const float a0 =
            1.0f + alpha;

        const float inv =
            1.0f / a0;

        b0 = ((1.0f + cs) * 0.5f) * inv;
        b1 = (-(1.0f + cs)) * inv;
        b2 = b0;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }
};

// ============================================================
// TRIANGLE OSCILLATOR
// ============================================================

struct TriangleOsc {

    float phase = 0.0f;
    float freq  = 110.0f;
    float sr    = 44100.0f;

    void init(float sampleRate) {

        sr = sampleRate;
    }

    inline void setFreq(float f) {

        freq = f;
    }

    inline float process() {

        phase += freq / sr;

        if (phase >= 1.0f)
            phase -= 1.0f;

        float tri =
            2.0f * std::fabs(2.0f * phase - 1.0f) - 1.0f;

        return tri;
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

        float white =
            rng.nextFloat();

        b0 = 0.99765f * b0 + white * 0.0990460f;
        b1 = 0.96300f * b1 + white * 0.2965164f;
        b2 = 0.57000f * b2 + white * 1.0526913f;

        return
            (b0 + b1 + b2 + white * 0.1848f)
            * 0.05f;
    }
};

// ============================================================
// STABLE MOOG LADDER
// ============================================================

struct MoogLadder {

    float sr = 44100.0f;

    float cutoff = 800.0f;
    float resonance = 0.15f;

    float z[4] = {0};

    void init(float sampleRate) {

        sr = sampleRate;
    }

    inline void setParams(
        float c,
        float r
    ) {

        cutoff =
            std::clamp(c, 20.0f, sr * 0.45f);

        resonance =
            std::clamp(r, 0.0f, 1.0f);
    }

    inline float process(float input) {

        const float g =
            std::tan(kPi * cutoff / sr);

        const float G =
            g / (1.0f + g);

        float x =
            input - resonance * z[3];

        for (int i = 0; i < 4; ++i) {

            float v =
                (x - z[i]) * G;

            float y =
                v + z[i];

            z[i] =
                y + v;

            x = std::tanh(y);
        }

        return x;
    }
};

// ============================================================
// 10-SECOND FDN REVERB
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

    float feedback = 0.91f;

    void init(float sr) {

        for (int i = 0; i < kReverbLines; ++i) {

            dampers[i].setLowpass(
                4500.0f,
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
            input * (1.0f - wet)
            + average * wet;
    }
};

// ============================================================
// ENGINE 0
// GENERATIVE ENO / ZIMMER DRONE
// ============================================================

struct GenerativeDrone {

    static constexpr int kVoices = 5;

    TriangleOsc osc[kVoices];

    PrimeLFO ampLFO[kVoices];
    PrimeLFO cutoffLFO[kVoices];

    MoogLadder ladder;

    float mixBuffer[kVoices] = {};

    float sr = 44100.0f;

    void init(float sampleRate) {

        sr = sampleRate;

        // Dsus2 / A suspended harmonic stack

        const float freqs[kVoices] = {
            55.0f,      // Root
            82.5f,      // Fifth
            110.0f,     // Octave
            123.75f,    // Ninth
            165.0f      // Upper Fifth
        };

        const float ampPrimes[kVoices] = {
            0.011f,
            0.013f,
            0.017f,
            0.019f,
            0.023f
        };

        const float cutoffPrimes[kVoices] = {
            0.029f,
            0.031f,
            0.037f,
            0.041f,
            0.043f
        };

        for (int i = 0; i < kVoices; ++i) {

            osc[i].init(sr);
            osc[i].setFreq(freqs[i]);

            ampLFO[i].init(
                sr,
                ampPrimes[i],
                0.35f,
                0.65f
            );

            cutoffLFO[i].init(
                sr,
                cutoffPrimes[i],
                350.0f,
                650.0f
            );
        }

        ladder.init(sr);
    }

    inline float process() {

        float mix = 0.0f;

        float cutoff = 0.0f;

        for (int i = 0; i < kVoices; ++i) {

            float amp =
                ampLFO[i].process();

            cutoff +=
                cutoffLFO[i].process();

            float voice =
                osc[i].process();

            mix += voice * amp * 0.12f;
        }

        cutoff /= kVoices;

        ladder.setParams(
            cutoff,
            0.18f
        );

        return
            ladder.process(mix)
            * 0.6f;
    }
};

// ============================================================
// ENGINE 1
// PRIME-LFO WIND
// ============================================================

struct ProceduralWind {

    PinkNoise noise;

    Biquad bandpass;
    Biquad lowpass;

    PrimeLFO freqLFO;
    PrimeLFO ampLFO;

    float sr = 44100.0f;

    int coeffCounter = 0;

    void init(float sampleRate) {

        sr = sampleRate;

        bandpass.setBandpass(
            250.0f,
            sr,
            0.6f
        );

        lowpass.setLowpass(
            1800.0f,
            sr,
            0.707f
        );

        freqLFO.init(
            sr,
            0.017f,
            80.0f,
            220.0f
        );

        ampLFO.init(
            sr,
            0.013f,
            0.2f,
            0.8f
        );
    }

    inline float process() {

        // Prime-LFO always advances

        float centerFreq =
            freqLFO.process();

        float amp =
            ampLFO.process();

        coeffCounter++;

        if (coeffCounter >= 64) {

            coeffCounter = 0;

            bandpass.setBandpass(
                centerFreq,
                sr,
                0.6f
            );
        }

        float n =
            noise.process();

        float out =
            bandpass.process(n);

        out =
            lowpass.process(out);

        out *= amp;

        return out * 0.45f;
    }
};

// ============================================================
// MAIN ENGINE
// ============================================================

struct OmniEngine {

    int sampleRate = 44100;

    int engineType = 0;

    bool active = true;

    GenerativeDrone drone;
    ProceduralWind wind;

    Biquad highpass;

    bool hpEnabled = false;

    FDNReverb reverb;

    float saturation = 0.0f;

    float reverbMix = 0.25f;

    float outputBuffer[kBlockSize] = {};

    void init(
        int sr,
        int type
    ) {

        sampleRate = sr;

        engineType = type;

        drone.init(sr);
        wind.init(sr);

        highpass.setHighpass(
            25.0f,
            sr
        );

        reverb.init(sr);
    }

    inline float saturate(float x) {

        float drive =
            1.0f + saturation * 3.0f;

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

                    dry =
                        drone.process();

                    break;

                case 1:

                    dry =
                        wind.process();

                    break;

                default:

                    dry = 0.0f;
                    break;
            }

            // MASTER CHAIN

            if (hpEnabled)
                dry =
                    highpass.process(dry);

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
// C EXPORTS
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

        case REVERB_MIX:

            eng->reverbMix =
                std::clamp(
                    value,
                    0.0f,
                    1.0f
                );

            break;

        case SATURATION:

            eng->saturation =
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
