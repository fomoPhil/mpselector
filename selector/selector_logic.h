/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Selector state with no hardware or I/O, so native tests can run it. */
#pragma once
#include <stdbool.h>
#include <stddef.h>

struct selector_item {
    const char *id, *name, *caption;
    unsigned char *cover;
    bool favorite;
    char card_caption[38];
};

enum { SELECTOR_SHUTDOWN_RESULT = -2 };

/* Item 0 is Akai. Cursor indexes visible entries and a selected result indexes all items. */
struct selector {
    struct selector_item *items;
    int *visible;
    int count, visible_count, cursor, result;
    unsigned held, armed;
    bool power_down, shutdown_prompt, done, library, favorites_only, favorites_changed;
};

enum selector_change {
    SELECTOR_IDLE,
    SELECTOR_EDIT,
    SELECTOR_STEP,
    SELECTOR_RESET,
};

static inline int selector_selected(const struct selector *s)
{
    return s->cursor >= 0 && s->cursor < s->visible_count ? s->visible[s->cursor] : -1;
}

static inline const struct selector_item *selector_item_at(const struct selector *s, int slot)
{
    return slot >= 0 && slot < s->visible_count ? &s->items[s->visible[slot]] : NULL;
}

static inline void selector_rebuild_visible(struct selector *s, int selected)
{
    int slot = -1;
    s->visible_count = 0;
    for (int i = 0; i < s->count; ++i) {
        if (s->favorites_only && !s->items[i].favorite) continue;
        if (i == selected) slot = s->visible_count;
        s->visible[s->visible_count++] = i;
    }
    if (slot >= 0)
        s->cursor = slot;
    else if (s->cursor >= s->visible_count)
        s->cursor = s->visible_count ? s->visible_count - 1 : 0;
}

static inline void selector_init(struct selector *s, struct selector_item *items,
                                 int count, int *visible, int initial_item,
                                 bool library, bool favorites_only)
{
    /* Keep the returning item visible after a Favorites write failure. */
    if (favorites_only && initial_item >= 0 && initial_item < count && !items[initial_item].favorite)
        favorites_only = false;
    *s = (struct selector){.items = items, .visible = visible, .count = count, .result = -1,
                           .library = library, .favorites_only = favorites_only};
    selector_rebuild_visible(s, initial_item);
}

/* Read the hardware events on MIDI channel 1. */
static inline enum selector_change selector_message(struct selector *s, const unsigned char *m)
{
    if (s->done) return SELECTOR_IDLE;
    if (!s->shutdown_prompt && m[0] == 0xB0 && m[1] == 100 && m[2]) {
        int next = s->cursor + (m[2] <= 64 ? 1 : -1);
        if (next < 0 || next >= s->visible_count) return SELECTOR_IDLE;
        s->cursor = next;
        return SELECTOR_STEP;
    }
    if (m[0] != 0x90 && m[0] != 0x80) return SELECTOR_IDLE;

    enum { VIEW = 1u, FILTER = 2u, STAR = 4u, OPEN = 8u };
    unsigned button;
    switch (m[1]) {
    case 12: button = VIEW; break;
    case 13: button = FILTER; break;
    case 14: button = STAR; break;
    case 111: button = OPEN; break;
    default: return SELECTOR_IDLE;
    }

    int selected = selector_selected(s);
    /* Wait for the release so the next firmware never inherits a held press. */
    if (m[0] == 0x90 && m[2]) {
        if (s->held & button) return SELECTOR_IDLE;
        s->held |= button;
        if (s->shutdown_prompt ? (button == VIEW || button == STAR)
                               : (selected >= 0 || button == VIEW || button == FILTER))
            s->armed |= button;
        return SELECTOR_IDLE;
    }
    s->held &= ~button;
    if (!(s->armed & button)) return SELECTOR_IDLE;
    s->armed &= ~button;

    if (s->shutdown_prompt) {
        if (button == VIEW) {
            s->shutdown_prompt = false;
            s->armed = 0;
            return SELECTOR_RESET;
        }
        if (button == STAR) {
            s->result = SELECTOR_SHUTDOWN_RESULT;
            s->done = true;
        }
        return SELECTOR_IDLE;
    }

    switch (button) {
    case VIEW:
        s->library = !s->library;
        return SELECTOR_RESET;
    case FILTER:
        s->favorites_only = !s->favorites_only;
        selector_rebuild_visible(s, selected);
        return SELECTOR_RESET;
    case STAR:
        if (selected < 0) return SELECTOR_IDLE;
        s->items[selected].favorite = !s->items[selected].favorite;
        s->favorites_changed = true;
        if (!s->favorites_only) return SELECTOR_EDIT;
        selector_rebuild_visible(s, selected);
        return SELECTOR_RESET;
    case OPEN:
        if (selected >= 0) {
            s->result = selected;
            s->done = true;
        }
        break;
    }
    return SELECTOR_IDLE;
}

/* A matched Power release can override an encoder release from the same poll. */
static inline enum selector_change selector_power(struct selector *s, int type, int code, int value)
{
    if (type != 1 || code != 116 || s->shutdown_prompt) return SELECTOR_IDLE;
    if (value == 1) s->power_down = true;
    else if (value == 0 && s->power_down) {
        s->power_down = false;
        /* A key already held when the prompt opens must be released before it can act. */
        s->armed = 0;
        s->shutdown_prompt = true;
        s->result = -1;
        s->done = false;
        return SELECTOR_RESET;
    }
    return SELECTOR_IDLE;
}
