#include <cmath>
#include <cstring>
#include <algorithm>
#include <cstdlib>

constexpr float kPi = 3.14159265358979323846f;

constexpr int kMaxEngines   = 16;
constexpr int kBlockSize    = 128;
constexpr int kMaxDelaySize = 4096;

enum ParamID {
    TIME_STRETCH = 0,
    REVERB_MIX,
    HIGH_PASS_FREQ,
    SATURATION,
    MODULE_INTENSITY,
    ENGINE_TYPE
};

// ============================================================
// BIQUAD
// ============================================================

struct Biquad {
    float b0 = 0.0f, b1 = 0.0f, b2 = 0.0f;
    float a1 = 0.0f, a2 = 0.0f;

    float z1 = 0.0f, z2 = 0.0f;

    inline void reset() {
        z1 = z2 = 0.0f;
    }

    void setLP(float freq, float sr, float q = 0.7071f) {
        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        float omega = 2.0f * kPi * freq / sr;
        float sn = std::sin(omega);
        float cs = std::cos(omega);
        float alpha = sn / (2.0f * q);

        float a0 = 1.0f + alpha;
        float inv = 1.0f / a0;

        b0 = ((1.0f - cs) * 0.5f) * inv;
        b1 = (1.0f - cs) * inv;
        b2 = b0;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    void setHP(float freq, float sr, float q = 0.7071f) {
        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        float omega = 2.0f * kPi * freq / sr;
        float sn = std::sin(omega);
        float cs = std::cos(omega);
        float alpha = sn / (2.0f * q);

        float a0 = 1.0f + alpha;
        float inv = 1.0f / a0;

        b0 = ((1.0f + cs) * 0.5f) * inv;
        b1 = (-(1.0f + cs)) * inv;
        b2 = b0;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    void setBP(float freq, float sr, float q) {
        freq = std::clamp(freq, 20.0f, sr * 0.45f);

        float omega = 2.0f * kPi * freq / sr;
        float sn = std::sin(omega);
        float cs = std::cos(omega);
        float alpha = sn / (2.0f * q);

        float a0 = 1.0f + alpha;
        float inv = 1.0f / a0;

        b0 = alpha * inv;
        b1 = 0.0f;
        b2 = -alpha * inv;

        a1 = (-2.0f * cs) * inv;
        a2 = (1.0f - alpha) * inv;
    }

    inline float process(float in) {
        float out = b0 * in + z1;

        z1 = b1 * in - a1 * out + z2;
        z2 = b2 * in - a2 * out;

        if (std::fabs(z1) < 1e-20f) z1 = 0.0f;
        if (std::fabs(z2) < 1e-20f) z2 = 0.0f;

        return out;
    }
};

// ============================================================
// OSC
// ============================================================

struct Osc {
    float phase = 0.0f;
    float freq  = 55.0f;
    float sr    = 44100.0f;

    void init(float sampleRate) {
        sr = sampleRate;
    }

    inline void setFreq(float f) {
        freq = f;
    }

    inline float next() {
        float out = 2.0f * phase - 1.0f;

        phase += freq / sr;

        if (phase >= 1.0f)
            phase -= 1.0f;

        return out;
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

    void init(float sampleRate, float f) {
        sr = sampleRate;
        freq = f;
    }

    inline float get() {
        phase += freq / sr;

        if (phase >= 1.0f)
            phase -= 1.0f;

        return std::sin(2.0f * kPi * phase) * depth;
    }
};

// ============================================================
// FAST RANDOM
// ============================================================

struct FastNoise {
    uint32_t state = 0x12345678;

    inline float next() {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;

        return ((state / 4294967295.0f) * 2.0f - 1.0f);
    }
};

// ============================================================
// BROWN NOISE
// ============================================================

struct BrownNoise {
    FastNoise noise;
    float prev = 0.0f;

    inline float next() {
        prev += noise.next() * 0.02f;
        prev *= 0.995f;

        prev = std::clamp(prev, -1.0f, 1.0f);

        return prev;
    }
};

// ============================================================
// MOOG LADDER
// ============================================================

struct MoogLadder {
    float stage[4] = {0};

    float sampleRate = 44100.0f;
    float cutoff     = 1000.0f;
    float resonance  = 0.2f;

    void init(float sr) {
        sampleRate = sr;
    }

    inline void setCutoff(float f, float res) {
        cutoff = std::clamp(f, 20.0f, sampleRate * 0.45f);
        resonance = std::clamp(res, 0.0f, 1.0f);
    }

    inline float process(float input) {
        float f = cutoff / sampleRate;
        f *= 1.16f;

        float fb = resonance * (1.0f - 0.15f * f * f);

        input -= stage[3] * fb;
        input *= 0.35013f * (f * f) * (f * f);

        for (int i = 0; i < 4; ++i) {
            stage[i] = stage[i] + f * (std::tanh(input) - std::tanh(stage[i]));
            input = stage[i];
        }

        return stage[3];
    }
};

// ============================================================
// FDN REVERB
// ============================================================

struct FDNReverb {

    static constexpr int kNumLines = 8;

    int delayLen[kNumLines] = {
        1301, 1597, 1867, 2137,
        2423, 2713, 3001, 3307
    };

    float buffers[kNumLines][kMaxDelaySize] = {};
    int writePos[kNumLines] = {};

    float wet = 0.0f;
    float feedback = 0.82f;

    Biquad damp[kNumLines];

    void init(float sr) {
        for (int i = 0; i < kNumLines; ++i) {
            damp[i].setLP(7000.0f, sr);
        }
    }

    inline float process(float in) {

        if (wet <= 0.001f)
            return in;

        float outs[kNumLines];
        float sum = 0.0f;

        for (int i = 0; i < kNumLines; ++i) {

            int readPos =
                (writePos[i] + kMaxDelaySize - delayLen[i]) % kMaxDelaySize;

            outs[i] = damp[i].process(buffers[i][readPos]);

            sum += outs[i];
        }

        float avg = sum / kNumLines;

        for (int i = 0; i < kNumLines; ++i) {

            buffers[i][writePos[i]] =
                in + (outs[i] - avg) * feedback;

            writePos[i]++;

            if (writePos[i] >= kMaxDelaySize)
                writePos[i] = 0;
        }

        return in * (1.0f - wet) + avg * wet;
    }
};

// ============================================================
// PAD
// ============================================================

struct CinematicPad {

    Osc osc[7];

    MoogLadder ladder;

    LFO cutoffLFO;

    float pitchMultiplier = 1.0f;

    void init(float sr) {

        float detune[7] = {
            0.97f,
            0.985f,
            0.995f,
            1.0f,
            1.005f,
            1.015f,
            1.025f
        };

        for (int i = 0; i < 7; ++i) {
            osc[i].init(sr);
            osc[i].setFreq(55.0f * detune[i]);
        }

        ladder.init(sr);

        cutoffLFO.init(sr, 0.05f);
        cutoffLFO.depth = 200.0f;
    }

    inline float process() {

        float mix = 0.0f;

        for (int i = 0; i < 7; ++i) {

            osc[i].setFreq(
                55.0f *
                (1.0f + (i - 3) * 0.01f) *
                pitchMultiplier
            );

            mix += osc[i].next() * 0.14f;
        }

        float cutoff =
            350.0f + cutoffLFO.get();

        ladder.setCutoff(cutoff, 0.25f);

        return ladder.process(mix) * 0.4f;
    }
};

// ============================================================
// WIND
// ============================================================

struct ProceduralWind {

    BrownNoise noise;

    Biquad bp1;
    Biquad bp2;

    LFO lfo1;
    LFO lfo2;

    float intensity = 0.5f;
    float sr = 44100.0f;

    int updateCounter = 0;

    void init(float sampleRate) {

        sr = sampleRate;

        bp1.setBP(300.0f, sr, 4.0f);
        bp2.setBP(600.0f, sr, 3.0f);

        lfo1.init(sr, 0.12f);
        lfo2.init(sr, 0.17f);
    }

    inline float process() {

        updateCounter++;

        if (updateCounter >= 32) {

            updateCounter = 0;

            bp1.setBP(
                250.0f + lfo1.get() * 150.0f,
                sr,
                4.0f
            );

            bp2.setBP(
                600.0f + lfo2.get() * 200.0f,
                sr,
                3.0f
            );
        }

        float n = noise.next() * intensity;

        return (
            bp1.process(n) +
            bp2.process(n)
        ) * 0.5f;
    }
};

// ============================================================
// RAIN
// ============================================================

struct ProceduralRain {

    FastNoise noise;

    Biquad hp;

    float intensity = 0.5f;

    float pink = 0.0f;

    void init(float sr) {
        hp.setHP(400.0f, sr);
    }

    inline float process() {

        float white = noise.next();

        pink = pink * 0.98f + white * 0.02f;

        return hp.process(pink) * intensity * 0.5f;
    }
};

// ============================================================
// ENGINE
// ============================================================

struct OmniEngine {

    bool active = true;

    int sampleRate = 44100;
    int engineType = 0;

    CinematicPad pad;
    ProceduralWind wind;
    ProceduralRain rain;

    FDNReverb reverb;

    Biquad highPass;

    bool hpEnabled = false;

    float reverbMix = 0.0f;
    float saturation = 0.0f;
    float moduleIntensity = 0.5f;
    float timeStretch = 1.0f;

    float outputBuffer[kBlockSize] = {};

    void init(int sr, int type) {

        sampleRate = sr;
        engineType = type;

        pad.init(sr);
        wind.init(sr);
        rain.init(sr);

        reverb.init(sr);

        highPass.setHP(30.0f, sr);
    }

    float* process(int numFrames) {

        numFrames = std::min(numFrames, kBlockSize);

        if (!active) {
            std::memset(outputBuffer, 0, sizeof(outputBuffer));
            return outputBuffer;
        }

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
            }

            float sig =
                hpEnabled
                ? highPass.process(dry)
                : dry;

            if (saturation > 0.001f) {

                float drive =
                    1.0f + saturation * 6.0f;

                sig = std::tanh(sig * drive);

                sig *= (1.0f - saturation * 0.25f);
            }

            outputBuffer[i] =
                reverb.process(sig);
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
// C API
// ============================================================

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

    OmniEngine* eng =
        static_cast<OmniEngine*>(engine);

    switch (paramId) {

        case TIME_STRETCH:
            eng->timeStretch = value;
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
                eng->highPass.setHP(
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
    }
}

float* processAudio(void* engine, int numFrames) {

    return
        static_cast<OmniEngine*>(engine)
            ->process(numFrames);
}
}
