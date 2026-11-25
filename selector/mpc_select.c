/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Jog-wheel firmware selector. Usage: mpc-select LAST MESSAGE [ID NAME]...
 * Prints the chosen ID or /shutdown. A failure lets the caller fall back to Akai.
 * The caller must stop ac50 first. */
#define _POSIX_C_SOURCE 200809L
#include "mpc_display.h"
#include "mpc_surface.h"
#include "selector_draw.h"
#include "selector_logic.h"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/input.h>
#include <poll.h>
#include <sound/asound.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define POWER_KEY "/dev/input/by-path/platform-fdd40000.i2c-platform-rk805-pwrkey.2.auto-event"
#define FRAME_MS 40
#define SETTLE_MS 220

static uint32_t frames[2][SELECTOR_W * SELECTOR_H];

static FILE *open_regular_file(const char *path)
{
    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) return NULL;
    struct stat info;
    if (fstat(fd, &info) == 0) {
        if (S_ISREG(info.st_mode)) {
            FILE *file = fdopen(fd, "rb");
            if (file) return file;
        } else {
            errno = EINVAL;
        }
    }
    int error = errno;
    close(fd);
    errno = error;
    return NULL;
}

static void load_cover(const char *card, struct selector_item *item)
{
    if (!card || strchr(item->id, '/') || !strcmp(item->id, ".") || !strcmp(item->id, "..")) return;
    char path[PATH_MAX];
    int length = !strcmp(item->id, "akai")
        ? snprintf(path, sizeof path, "%s/autorun/akai.rgb565", card)
        : snprintf(path, sizeof path, "%s/firmware/%s/cover.rgb565", card, item->id);
    if (length < 0 || (size_t)length >= sizeof path) return;
    FILE *file = open_regular_file(path);
    if (!file) return;
    unsigned char *cover = malloc(SELECTOR_ART_BYTES);
    if (cover && fread(cover, 1, SELECTOR_ART_BYTES, file) == SELECTOR_ART_BYTES &&
        fgetc(file) == EOF && !ferror(file))
        item->cover = cover;
    else
        free(cover);
    fclose(file);
}

static const char *caption(const char *id)
{
    if (!strcmp(id, "sampqol")) return "Sampling and mixing";
    if (!strcmp(id, "gridzilla")) return "Sequencing and arranging";
    if (!strcmp(id, "mp-doom")) return "Game port";
    if (!strcmp(id, "pad-lights")) return "Pad demo";
    return "Firmware";
}

/* Older entries have built-in captions. A preview's availability takes priority. */
static void load_card_caption(const char *card, struct selector_item *item)
{
    if (!card || !strcmp(item->id, "akai") || strchr(item->id, '/')) return;
    const char *files[] = {"unavailable", "caption"};
    for (size_t i = 0; i < sizeof files / sizeof files[0]; ++i) {
        char path[PATH_MAX];
        int length = snprintf(path, sizeof path, "%s/firmware/%s/%s", card, item->id, files[i]);
        if (length < 0 || (size_t)length >= sizeof path) return;
        FILE *file = open_regular_file(path);
        if (!file) continue;
        size_t count = 0;
        int ch;
        while ((ch = fgetc(file)) >= 32 && ch <= 126 && count + 1 < sizeof item->card_caption)
            item->card_caption[count++] = (char)ch;
        fclose(file);
        if (count) {
            item->card_caption[count] = '\0';
            item->caption = item->card_caption;
            return;
        }
    }
}

static bool load_favorites(const char *card, struct selector_item *items, int count,
                           char **unavailable, size_t *unavailable_size)
{
    if (!card) return true;
    char path[PATH_MAX];
    int length = snprintf(path, sizeof path, "%s/firmware/.favorites", card);
    if (length < 0 || (size_t)length >= sizeof path) return false;
    FILE *file = open_regular_file(path);
    if (!file) return errno == ENOENT;
    FILE *missing = NULL;
    bool complete = true;
    char line[PATH_MAX];
    while (fgets(line, sizeof line, file)) {
        size_t end = strlen(line);
        if (end && line[end - 1] == '\n') --end;
        else if (!feof(file)) {
            complete = false;
            break;
        }
        if (end && line[end - 1] == '\r') --end;
        line[end] = '\0';
        if (!end) continue;
        int match = 0;
        while (match < count && strcmp(items[match].id, line)) ++match;
        if (match < count) {
            items[match].favorite = true;
        } else {
            /* Preserve stars for mods that are temporarily absent from the menu. */
            if (!missing) missing = open_memstream(unavailable, unavailable_size);
            if (!missing || fprintf(missing, "%s\n", line) < 0) {
                complete = false;
                break;
            }
        }
    }
    if (ferror(file)) complete = false;
    if (fclose(file) != 0) complete = false;
    if (missing && fclose(missing) != 0) complete = false;
    return complete;
}

static void export_favorites(const struct selector *menu, const char *unavailable, size_t unavailable_size)
{
    const char *path = getenv("MPC_SELECT_FAVORITES_OUT");
    if (!menu->favorites_changed || !path) return;
    FILE *file = fopen(path, "w");
    if (!file) { perror("favorites"); return; }
    bool ok = !unavailable_size || fwrite(unavailable, 1, unavailable_size, file) == unavailable_size;
    for (int i = 0; ok && i < menu->count; ++i)
        if (menu->items[i].favorite && fprintf(file, "%s\n", menu->items[i].id) < 0) {
            ok = false;
            break;
        }
    if (fclose(file) != 0) ok = false;
    if (!ok) {
        unlink(path);
        fputs("Could not stage favorites\n", stderr);
    }
}

/* The launcher keeps this file in RAM for the lifetime of the selector session. */
static void load_view(const char *path, bool *library, bool *favorites_only)
{
    if (!path || !*path) return;
    FILE *file = open_regular_file(path);
    if (!file) return;
    char data[3];
    if (fread(data, 1, sizeof data, file) == sizeof data && fgetc(file) == EOF && !ferror(file) &&
        (data[0] == '0' || data[0] == '1') && (data[1] == '0' || data[1] == '1') && data[2] == '\n') {
        *library = data[0] == '1';
        *favorites_only = data[1] == '1';
    }
    fclose(file);
}

static void save_view(const char *path, const struct selector *menu)
{
    if (!path || !*path) return;
    char temporary[PATH_MAX];
    int length = snprintf(temporary, sizeof temporary, "%s.XXXXXX", path);
    if (length < 0 || (size_t)length >= sizeof temporary) return;
    int fd = mkstemp(temporary);
    if (fd < 0) { perror("selector view"); return; }
    const char data[] = {menu->library ? '1' : '0', menu->favorites_only ? '1' : '0', '\n'};
    bool written = write(fd, data, sizeof data) == (ssize_t)sizeof data;
    if (close(fd) != 0) written = false;
    if (!written || rename(temporary, path) != 0) {
        unlink(temporary);
        fputs("Could not stage selector view\n", stderr);
    }
}

static int64_t time_ms(void)
{
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static float position_at(float start, int target, int64_t elapsed)
{
    if (elapsed >= SETTLE_MS) return (float)target;
    float remaining = 1.0f - (float)elapsed / SETTLE_MS;
    return target + (start - target) * remaining * remaining * remaining;
}

static int run(struct selector *s, const char *message,
               int surface, int power)
{
    struct mpc_midi_parser parser = {0};
    uint32_t *shown = NULL;
    int target = s->cursor;
    float start = (float)target;
    int64_t began = 0, next_frame = 0;
    bool dirty = true, moving = false;
    while (!s->done) {
        int64_t now = time_ms();
        if (now < 0) return -1;
        if ((dirty || moving) && now >= next_frame) {
            float position = moving ? position_at(start, target, now - began) : (float)target;
            uint32_t *frame = shown == frames[0] ? frames[1] : frames[0];
            unsigned top = 0, bottom = SELECTOR_H;
            selector_draw(frame, s, position, message);
            if (!shown || selector_changed_rows(shown, frame, &top, &bottom)) {
                if (mpc_display_native_rows(frame, top, bottom) < 0) return -1;
                shown = frame;
            }
            moving = moving && now - began < SETTLE_MS;
            dirty = false;
            next_frame = now + FRAME_MS;
            now = time_ms();
            if (now < 0) return -1;
        }
        struct pollfd fds[] = {{surface, POLLIN, 0}, {power, POLLIN, 0}};
        int timeout = dirty || moving ? (next_frame > now ? (int)(next_frame - now) : 0) : -1;
        if (poll(fds, 2, timeout) < 0) {
            if (errno == EINTR) continue;
            perror("poll");
            return -1;
        }
        if ((fds[0].revents | fds[1].revents) & (POLLERR | POLLHUP | POLLNVAL)) return -1;
        enum selector_change change = SELECTOR_IDLE;
        if (fds[0].revents & POLLIN) {
            unsigned char data[512], m[3];
            ssize_t n = read(surface, data, sizeof data);
            if (n == 0 || (n < 0 && errno != EINTR && errno != EAGAIN)) return -1;
            for (ssize_t i = 0; i < n && !s->done; ++i) {
                if (mpc_midi_feed(&parser, data[i], m) != 1) continue;
                enum selector_change event = selector_message(s, m);
                if (event > change) change = event;
            }
        }
        if (fds[1].revents & POLLIN) {
            struct input_event events[16];
            ssize_t n = read(power, events, sizeof events);
            if (n == 0 || (n < 0 && errno != EINTR && errno != EAGAIN)) return -1;
            for (ssize_t i = 0; i < n / (ssize_t)sizeof events[0]; ++i) {
                enum selector_change event = selector_power(s, events[i].type, events[i].code, events[i].value);
                if (event == SELECTOR_RESET) {
                    change = event;
                    next_frame = 0; /* Paint the prompt before accepting its buttons. */
                }
            }
        }
        if (s->done || change == SELECTOR_IDLE) continue;
        dirty = true;
        if (change == SELECTOR_RESET || s->library) {
            target = s->cursor;
            moving = false;
        } else if (change == SELECTOR_STEP && target != s->cursor) {
            now = time_ms();
            if (now < 0) return -1;
            start = moving ? position_at(start, target, now - began) : (float)target;
            target = s->cursor;
            /* A fast spin catches up in one frame, with at most two covers left to settle. */
            if (start < target - 2.0f) start = target - 2.0f;
            if (start > target + 2.0f) start = target + 2.0f;
            began = now;
            moving = start != (float)target;
        }
    }
    return 0;
}

int main(int argc, char **argv)
{
    if (argc < 3 || argc % 2 == 0) {
        fputs("usage: mpc-select LAST MESSAGE [ID NAME]...\n", stderr);
        return 2;
    }
    int count = 1 + (argc - 3) / 2, cursor = 0, result = 1;
    char *unavailable = NULL;
    size_t unavailable_size = 0;
    struct selector_item *items = calloc((size_t)count, sizeof *items);
    int *visible = malloc((size_t)count * sizeof *visible);
    if (!items || !visible) goto free_items;
    items[0] = (struct selector_item){.id = "akai", .name = "Akai", .caption = "Stock firmware"};
    for (int i = 1; i < count; ++i) {
        items[i].id = argv[3 + (i - 1) * 2];
        items[i].name = argv[4 + (i - 1) * 2];
        items[i].caption = caption(items[i].id);
        if (!strcmp(items[i].id, argv[1])) cursor = i;
    }
    const char *card = getenv("MPC_SELECT_CARD");
    for (int i = 0; i < count; ++i) {
        load_cover(card, &items[i]);
        load_card_caption(card, &items[i]);
    }
    bool favorites_read = load_favorites(card, items, count, &unavailable, &unavailable_size);
    const char *message = argv[2];
    if (!favorites_read) {
        fputs("Could not read all favorites\n", stderr);
        if (!*message) message = "Favorites could not be read";
    }

    int surface = mpc_surface_open(O_RDWR | O_NONBLOCK | O_CLOEXEC);
    if (surface < 0) { perror("MPC surface open"); goto free_items; }
    /* Stock's timestamp framing survives closing the port; the parser needs plain MIDI. */
    struct snd_rawmidi_params params = {
        .stream = SNDRV_RAWMIDI_STREAM_INPUT,
        .buffer_size = 4096, .avail_min = 1,
        .mode = SNDRV_RAWMIDI_MODE_FRAMING_NONE | SNDRV_RAWMIDI_MODE_CLOCK_NONE
    };
    int power = -1;
    if (ioctl(surface, SNDRV_RAWMIDI_IOCTL_PARAMS, &params) < 0) { perror("plain MIDI input setup"); goto done; }
    power = open(POWER_KEY, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (power < 0) { perror("power key"); goto done; }
    if (mpc_display_open() < 0) goto done;
    mpc_surface_clear(surface);

    const char *view_path = getenv("MPC_SELECT_VIEW_STATE");
    bool library = false, favorites_only = false;
    load_view(view_path, &library, &favorites_only);
    struct selector s;
    selector_init(&s, items, count, visible, cursor, library, favorites_only);
    if (run(&s, message, surface, power) == 0) {
        if (favorites_read) export_favorites(&s, unavailable, unavailable_size);
        save_view(view_path, &s);
        result = puts(s.result == SELECTOR_SHUTDOWN_RESULT ? "/shutdown" : items[s.result].id) == EOF;
    }
done:
    mpc_display_close();
    if (power >= 0) close(power);
    mpc_surface_clear(surface);
    close(surface);
free_items:
    if (items)
        for (int i = 0; i < count; ++i) free(items[i].cover);
    free(items);
    free(visible);
    free(unavailable);
    return result;
}
