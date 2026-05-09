// ============================================================
// dsp_engine.cpp
// Algorithmic Video Factory
// Infinite Generative Ambient Engine
// WASM / Emscripten / C++17
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
    ENGINE_TYPE      = 5,
    SCALE_ID         = 6
};

// ============================================================
// UTILS
// ============================================================

inline float zap(float x) {

    return
        (std::fabs(x) < 1e-20f)
        ? 0.0f
        : x;
}

inline float midiToFreq(float midi) {

    return
        440.0f *
        std::pow(
            2.0f,
            (midi - 69.0f) / 12.0f
        );
}

// ============================================================
// RNG
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

        return
            ((nextUInt() / 4294967295.0f) * 2.0f)
            - 1.0f;
    }

    inline float nextUnit() {

        return
            nextUInt() / 4294967295.0f;
    }
};

// ============================================================
// SMOOTHER
// ============================================================

struct SmoothValue {

    float current = 0.0f;
    float target  = 0.0f;

    float speed = 0.0004f;

    inline void setTarget(float t) {

        target = t;
    }

    inline float process() {

        current +=
            speed *
            (target - current);

        return current;
    }
};

// ============================================================
// PRIME LFO
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
            std::sin(
                2.0f * kPi * phase
            ) * depth + offset;
    }
};

// ============================================================
// BIQUAD
// ============================================================

struct Biquad {

    float b0 = 1.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;

    float a1 = 0.0f;
    float a2 = 0.0f;

    float z1 = 0.0f;
    float z2 = 0.0f;

    inline float process(float x) {

        float y =
            b0 * x + z1;

        z1 =
            b1 * x - a1 * y + z2;

        z2 =
            b2 * x - a2 * y;

        z1 = zap(z1);
        z2 = zap(z2);

        return y;
    }

    void setLowpass(
        float freq,
        float sr,
        float q = 0.707f
    ) {

        freq =
            std::clamp(
                freq,
                20.0f,
                sr * 0.45f
            );

        float w0 =
            2.0f * kPi * freq / sr;

        float cs = std::cos(w0);
        float sn = std::sin(w0);

        float alpha =
            sn / (2.0f * q);

        float a0 =
            1.0f + alpha;

        float inv =
            1.0f / a0;

        b0 =
            ((1.0f - cs) * 0.5f) * inv;

        b1 =
            (1.0f - cs) * inv;

        b2 = b0;

        a1 =
            (-2.0f * cs) * inv;

        a2 =
            (1.0f - alpha) * inv;
    }

    void setBandpass(
        float freq,
        float sr,
        float q
    ) {

        freq =
            std::clamp(
                freq,
                20.0f,
                sr * 0.45f
            );

        float w0 =
            2.0f * kPi * freq / sr;

        float cs = std::cos(w0);
        float sn = std::sin(w0);

        float alpha =
            sn / (2.0f * q);

        float a0 =
            1.0f + alpha;

        float inv =
            1.0f / a0;

        b0 =
            alpha * inv;

        b1 = 0.0f;

        b2 =
            -alpha * inv;

        a1 =
            (-2.0f * cs) * inv;

        a2 =
            (1.0f - alpha) * inv;
    }

    void setHighpass(
        float freq,
        float sr,
        float q = 0.707f
    ) {

        freq =
            std::clamp(
                freq,
                20.0f,
                sr * 0.45f
            );

        float w0 =
            2.0f * kPi * freq / sr;

        float cs = std::cos(w0);
        float sn = std::sin(w0);

        float alpha =
            sn / (2.0f * q);

        float a0 =
            1.0f + alpha;

        float inv =
            1.0f / a0;

        b0 =
            ((1.0f + cs) * 0.5f) * inv;

        b1 =
            (-(1.0f + cs)) * inv;

        b2 = b0;

        a1 =
            (-2.0f * cs) * inv;

        a2 =
            (1.0f - alpha) * inv;
    }
};

// ============================================================
// DC BLOCKER
// ============================================================

struct DCBlocker {

    float xm1 = 0.0f;
    float ym1 = 0.0f;

    inline float process(float x) {

        float y =
            x - xm1 + 0.995f * ym1;

        xm1 = x;
        ym1 = y;

        return y;
    }
};

// ============================================================
// TRI OSC
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

        return
            2.0f *
            std::fabs(
                2.0f * phase - 1.0f
            ) - 1.0f;
    }
};

// ============================================================
// NOISE
// ============================================================

struct PinkNoise {

    FastRandom rng;

    float b0 = 0.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;

    inline float process() {

        float white =
            rng.nextFloat();

        b0 =
            0.99765f * b0 +
            white * 0.0990460f;

        b1 =
            0.96300f * b1 +
            white * 0.2965164f;

        b2 =
            0.57000f * b2 +
            white * 1.0526913f;

        return
            (b0 + b1 + b2 +
            white * 0.1848f)
            * 0.045f;
    }
};

struct BrownNoise {

    FastRandom rng;

    float state = 0.0f;

    inline float process() {

        state +=
            rng.nextFloat() * 0.02f;

        state *= 0.995f;

        return
            std::clamp(
                state,
                -1.0f,
                1.0f
            );
    }
};

// ============================================================
// STABLE MOOG
// ============================================================

struct MoogLadder {

    float sr = 44100.0f;

    float cutoff = 900.0f;
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
            std::clamp(
                c,
                20.0f,
                sr * 0.45f
            );

        resonance =
            std::clamp(
                r,
                0.0f,
                1.0f
            );
    }

    inline float process(float input) {

        float g =
            std::tan(
                kPi * cutoff / sr
            );

        float G =
            g / (1.0f + g);

        float x =
            input -
            resonance * z[3];

        for (int i = 0; i < 4; ++i) {

            float v =
                (x - z[i]) * G;

            float y =
                v + z[i];

            z[i] =
                y + v;

            x =
                std::tanh(y);
        }

        return x;
    }
};

// ============================================================
// FDN REVERB
// ============================================================

struct FDNReverb {

    int lengths[kReverbLines] = {
        10691,
        11777,
        12983,
        14197,
        15401,
        16573,
        17749,
        18947
    };

    float buffers[kReverbLines][kMaxDelaySize] = {};

    int writePos[kReverbLines] = {};

    Biquad dampers[kReverbLines];

    float wet = 0.18f;
    float feedback = 0.84f;

    void init(float sr) {

        for (int i = 0; i < kReverbLines; ++i) {

            dampers[i].setLowpass(
                4200.0f,
                sr
            );
        }
    }

    inline float process(float input) {

        float outputs[kReverbLines];

        float sum = 0.0f;

        for (int i = 0; i < kReverbLines; ++i) {

            int readPos =
                writePos[i] - lengths[i];

            while (readPos < 0)
                readPos += kMaxDelaySize;

            float delayed =
                buffers[i][readPos];

            delayed =
                dampers[i].process(delayed);

            outputs[i] = delayed;

            sum += delayed;
        }

        float avg =
            sum / kReverbLines;

        for (int i = 0; i < kReverbLines; ++i) {

            float fb =
                outputs[i] - avg;

            buffers[i][writePos[i]] =
                input + fb * feedback;

            writePos[i]++;

            if (writePos[i] >= kMaxDelaySize)
                writePos[i] = 0;
        }

        return
            input * (1.0f - wet)
            + avg * wet;
    }
};

// ============================================================
// GENERATIVE DRONE
// ============================================================

struct GenerativeDrone {

    static constexpr int kVoices = 5;

    TriangleOsc osc[kVoices];

    PrimeLFO ampLFO[kVoices];
    PrimeLFO cutoffLFO[kVoices];

    SmoothValue cutoffSmooth;

    PinkNoise noise;

    MoogLadder ladder;

    int scaleID = 0;

    void init(float sr) {

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

            ampLFO[i].init(
                sr,
                ampPrimes[i],
                0.25f,
                0.75f
            );

            cutoffLFO[i].init(
                sr,
                cutoffPrimes[i],
                250.0f,
                700.0f
            );
        }

        ladder.init(sr);

        cutoffSmooth.current = 700.0f;
        cutoffSmooth.target  = 700.0f;
    }

    void setScale(int id) {

        scaleID = id;

        const float rootMidi = 33.0f;

        float intervals[kVoices];

        switch (scaleID) {

            // Cinematic Space
            case 0:

                intervals[0] = 0.0f;
                intervals[1] = 7.0f;
                intervals[2] = 14.0f;
                intervals[3] = 19.0f;
                intervals[4] = 24.0f;

                break;

            // Himalayan Zen
            case 1:

                intervals[0] = 0.0f;
                intervals[1] = 4.0f;
                intervals[2] = 7.0f;
                intervals[3] = 9.0f;
                intervals[4] = 16.0f;

                break;

            // Cyberpunk
            case 2:

                intervals[0] = 0.0f;
                intervals[1] = 3.0f;
                intervals[2] = 6.0f;
                intervals[3] = 15.0f;
                intervals[4] = 18.0f;

                break;

            default:

                intervals[0] = 0.0f;
                intervals[1] = 7.0f;
                intervals[2] = 14.0f;
                intervals[3] = 19.0f;
                intervals[4] = 24.0f;

                break;
        }

        for (int i = 0; i < kVoices; ++i) {

            osc[i].setFreq(
                midiToFreq(
                    rootMidi + intervals[i]
                )
            );
        }
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

            voice +=
                noise.process() * 0.002f;

            mix +=
                voice * amp * 0.11f;
        }

        cutoff /= kVoices;

        cutoffSmooth.setTarget(
            cutoff
        );

        ladder.setParams(
            cutoffSmooth.process(),
            0.15f
        );

        return
            ladder.process(mix)
            * 0.55f;
    }
};

// ============================================================
// WIND
// ============================================================

struct ProceduralWind {

    PinkNoise noise;

    Biquad bandpass;
    Biquad lowpass;

    PrimeLFO freqLFO;
    PrimeLFO ampLFO;

    SmoothValue freqSmooth;

    float sr = 44100.0f;

    void init(float sampleRate) {

        sr = sampleRate;

        bandpass.setBandpass(
            220.0f,
            sr,
            0.55f
        );

        lowpass.setLowpass(
            1700.0f,
            sr
        );

        freqLFO.init(
            sr,
            0.017f,
            60.0f,
            240.0f
        );

        ampLFO.init(
            sr,
            0.013f,
            0.20f,
            0.80f
        );

        freqSmooth.current = 240.0f;
        freqSmooth.target  = 240.0f;
    }

    inline float process() {

        freqSmooth.setTarget(
            freqLFO.process()
        );

        bandpass.setBandpass(
            freqSmooth.process(),
            sr,
            0.55f
        );

        float out =
            noise.process();

        out =
            bandpass.process(out);

        out =
            lowpass.process(out);

        out *=
            ampLFO.process();

        return out * 0.40f;
    }
};

// ============================================================
// RAIN / THUNDER
// ============================================================

struct ProceduralRain {

    PinkNoise rainNoise;
    BrownNoise thunderNoise;

    Biquad rainHP;
    Biquad thunderLP;

    FastRandom rng;

    float thunderEnv = 0.0f;

    int counter = 0;
    int nextStrike = 44100 * 8;

    float sr = 44100.0f;

    void init(float sampleRate) {

        sr = sampleRate;

        rainHP.setHighpass(
            4500.0f,
            sr
        );

        thunderLP.setLowpass(
            120.0f,
            sr
        );
    }

    inline float process() {

        float rain =
            rainNoise.process();

        rain =
            rainHP.process(rain);

        counter++;

        if (counter >= nextStrike) {

            thunderEnv = 1.0f;

            nextStrike =
                static_cast<int>(
                    sr *
                    (7.0f + rng.nextUnit() * 3.0f)
                );

            counter = 0;
        }

        thunderEnv *= 0.99993f;

        float thunder =
            thunderNoise.process();

        thunder =
            thunderLP.process(thunder);

        thunder *=
            thunderEnv *
            thunderEnv *
            2.5f;

        return
            rain * 0.25f +
            thunder;
    }
};

// ============================================================
// MAIN ENGINE
// ============================================================

struct OmniEngine {

    int sampleRate = 44100;

    int engineType = 0;

    GenerativeDrone drone;
    ProceduralWind wind;
    ProceduralRain rain;

    FDNReverb reverb;

    Biquad highpass;

    DCBlocker dc;

    SmoothValue wetSmooth;
    SmoothValue satSmooth;

    float outputBuffer[kBlockSize] = {};

    bool hpEnabled = false;

    int scaleID = 0;

    void init(
        int sr,
        int type
    ) {

        sampleRate = sr;

        engineType = type;

        drone.init(sr);
        wind.init(sr);
        rain.init(sr);

        drone.setScale(0);

        highpass.setHighpass(
            25.0f,
            sr
        );

        reverb.init(sr);

        wetSmooth.current = 0.18f;
        wetSmooth.target  = 0.18f;

        satSmooth.current = 0.0f;
        satSmooth.target  = 0.0f;
    }

    inline float saturate(
        float x,
        float amt
    ) {

        float drive =
            1.0f + amt * 2.5f;

        return
            std::tanh(x * drive);
    }

    float* process(int numFrames) {

        numFrames =
            std::min(
                numFrames,
                kBlockSize
            );

        reverb.wet =
            wetSmooth.process();

        for (int i = 0; i < numFrames; ++i) {

            float dry = 0.0f;

            switch (engineType) {

                case 0:
                    dry = drone.process();
                    break;

                case 1:
                    dry = wind.process();
                    break;

                case 2:
                    dry = rain.process();
                    break;

                default:
                    break;
            }

            if (hpEnabled)
                dry =
                    highpass.process(dry);

            dry =
                saturate(
                    dry,
                    satSmooth.process()
                );

            dry =
                dc.process(dry);

            dry =
                reverb.process(dry);

            outputBuffer[i] =
                std::clamp(
                    dry,
                    -1.0f,
                    1.0f
                );
        }

        return outputBuffer;
    }
};

// ============================================================
// GLOBAL POOL
// ============================================================

static OmniEngine gEngines[kMaxEngines];

static bool gUsed[kMaxEngines] = { false };

// ============================================================
// EXPORTS
// ============================================================

extern "C" {

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

void destroyEngine(void* ptr) {

    for (int i = 0; i < kMaxEngines; ++i) {

        if (&gEngines[i] == ptr) {

            gUsed[i] = false;

            break;
        }
    }
}

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

            eng->wetSmooth.setTarget(
                std::clamp(
                    value,
                    0.0f,
                    1.0f
                )
            );

            break;

        case SATURATION:

            eng->satSmooth.setTarget(
                std::clamp(
                    value,
                    0.0f,
                    1.0f
                )
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

        case SCALE_ID:

            eng->scaleID =
                static_cast<int>(value);

            eng->drone.setScale(
                eng->scaleID
            );

            break;

        default:
            break;
    }
}

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
