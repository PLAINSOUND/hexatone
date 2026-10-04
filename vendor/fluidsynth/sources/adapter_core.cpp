#include <fluidsynth.h>
#include <fluidsynth/sfont.h>
#include <cstdio>

struct PlainsoundSynth {
    fluid_settings_t *settings;
    fluid_synth_t *synth;
};

extern "C" {

void *ps_create(double sample_rate)
{
    auto *ps = new PlainsoundSynth{nullptr, nullptr};
    if (!ps) return nullptr;

    ps->settings = new_fluid_settings();
    if (!ps->settings) {
        delete ps;
        return nullptr;
    }

    fluid_settings_setnum(ps->settings, "synth.sample-rate", sample_rate);
    fluid_settings_setnum(ps->settings, "synth.gain", 1.0);
    fluid_settings_setint(ps->settings, "synth.polyphony", 2048);
    fluid_settings_setint(ps->settings, "synth.midi-channels", 256);
    fluid_settings_setint(ps->settings, "synth.chorus.active", 0);
    fluid_settings_setnum(ps->settings, "synth.reverb.room-size", 0.5);
    fluid_settings_setnum(ps->settings, "synth.reverb.damp", 0.5);
    fluid_settings_setnum(ps->settings, "synth.reverb.level", 0.35);

    ps->synth = new_fluid_synth(ps->settings);
    if (!ps->synth) {
        delete_fluid_settings(ps->settings);
        delete ps;
        return nullptr;
    }

    return ps;
}

int ps_load_soundfont(void *handle, const char *path)
{
    if (!handle || !path) return FLUID_FAILED;

    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_sfload(ps->synth, path, 0);
}

int ps_select_first_program(void *handle, int soundfont_id)
{
    if (!handle) return FLUID_FAILED;

    auto *ps = static_cast<PlainsoundSynth *>(handle);
    fluid_sfont_t *soundfont =
        fluid_synth_get_sfont_by_id(ps->synth, soundfont_id);
    if (!soundfont) return -2;

    fluid_sfont_iteration_start(soundfont);
    fluid_preset_t *preset = fluid_sfont_iteration_next(soundfont);
    if (!preset) return -3;

    return fluid_synth_program_select(
        ps->synth,
        0,
        soundfont_id,
        fluid_preset_get_banknum(preset),
        fluid_preset_get_num(preset));
}

int ps_get_preset_count(void *handle, int soundfont_id)
{
    if (!handle) return FLUID_FAILED;

    auto *ps = static_cast<PlainsoundSynth *>(handle);
    fluid_sfont_t *soundfont = fluid_synth_get_sfont_by_id(ps->synth, soundfont_id);
    if (!soundfont) return -2;

    int count = 0;
    fluid_sfont_iteration_start(soundfont);

    while (fluid_sfont_iteration_next(soundfont) !=nullptr) {
        ++count;
    }

    return count;
}

int ps_get_preset_info(
    void *handle,
    int soundfont_id,
    int index,
    char *name,
    int name_capacity,
    int *bank,
    int *program)
{
    if (!handle || !name || name_capacity <= 0 || !bank || !program) return FLUID_FAILED;
    if (index < 0) return -2;

    auto *ps = static_cast<PlainsoundSynth *>(handle);
    fluid_sfont_t *soundfont = fluid_synth_get_sfont_by_id(ps->synth, soundfont_id);
    if (!soundfont) return -3;

    fluid_sfont_iteration_start(soundfont);

    for (int current = 0; current <= index; ++current) {
        fluid_preset_t *preset = fluid_sfont_iteration_next(soundfont);
        if (!preset) return -4;

        if (current == index) {
            const char *preset_name = fluid_preset_get_name(preset);
            std::snprintf(name, name_capacity, "%s", preset_name ? preset_name : "");
            *bank = fluid_preset_get_banknum(preset);
            *program = fluid_preset_get_num(preset);
            return 0;
        }
    }

    return -4;
}

int ps_select_program(
    void *handle,
    int channel,
    int soundfont_id,
    int bank,
    int program)
{
    if (!handle) return FLUID_FAILED;
    
    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_program_select(
        ps->synth,
        channel,
        soundfont_id,
        bank,
        program);
}

int ps_note_on(void *handle, int channel, int key, int velocity)
{
    if (!handle) return FLUID_FAILED;
    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_noteon(ps->synth, channel, key, velocity);
}

int ps_note_off(void *handle, int channel, int key)
{
    if (!handle) return FLUID_FAILED;
    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_noteoff(ps->synth, channel, key);
}

int ps_cc(void *handle, int channel, int controller, int value)
{
    if (!handle) return FLUID_FAILED;
    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_cc(ps->synth, channel, controller, value);
}

int ps_pitch_bend(void *handle, int channel, int value)
{
    if (!handle) return FLUID_FAILED;
    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_pitch_bend(ps->synth, channel, value);
}

int ps_activate_tuning(void *handle, int channel, int bank, int program, int apply)
{
    if (!handle) return FLUID_FAILED;

    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_activate_tuning(ps->synth, channel, bank, program, apply);
}

int ps_channel_pressure(void *handle, int channel, int value)
{
    if (!handle) return FLUID_FAILED;
    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_channel_pressure(ps->synth, channel, value);
}

int ps_key_pressure(void *handle, int channel, int key, int value)
{
    if (!handle) return FLUID_FAILED;
    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_key_pressure(ps->synth, channel, key, value);
}

int ps_sysex(void *handle, const unsigned char *data, int length, int *handled)
{
    if (!handle || !data || length <= 0) return FLUID_FAILED;

    auto *ps = static_cast<PlainsoundSynth *>(handle);
    return fluid_synth_sysex(ps->synth, reinterpret_cast<const char *>(data), length, nullptr, nullptr, handled, 0);
}

int ps_render(void *handle, float *left, float *right, int frames)
{
    if (!handle || !left || !right || frames <= 0) return FLUID_FAILED;
    auto *ps = static_cast<PlainsoundSynth *>(handle);

    return fluid_synth_write_float(
        ps->synth, frames, left, 0, 1, right, 0, 1);
}

void ps_destroy(void *handle)
{
    if (!handle) return;
    auto *ps = static_cast<PlainsoundSynth *>(handle);

    if (ps->synth) delete_fluid_synth(ps->synth);
    if (ps->settings) delete_fluid_settings(ps->settings);
    delete ps;
}

}
