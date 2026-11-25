/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "selector_draw.h"
#include "selector_font.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

#define BACKGROUND 0x0b0b0du
#define INK 0xfbf6efu
#define MUTED 0xc4b9b2u
#define ACCENT 0xefaf86u
#define DIVIDER 0x3b3435u
#define GALLERY_TOP 44
#define GALLERY_END 197

static void box(uint32_t *pixels, int x, int y, int width, int height, uint32_t color)
{
    for (int row = y; row < y + height; ++row)
        for (int col = x; col < x + width; ++col)
            pixels[row * SELECTOR_W + col] = color;
}

static const unsigned char *glyph(unsigned char c)
{
    return FONT_L[(c < 32 || c > 126 ? '?' : c) - 32];
}

static void text_at_size(uint32_t *pixels, int x, int y, int width, const char *text,
                         uint32_t color, bool center, int height)
{
    int cell = height * FONT_L_W / FONT_L_H;
    int chars = width / cell, length = 0;
    while (length < chars && text[length]) ++length;
    bool clipped = text[length] != '\0';
    if (center) x += (width - length * cell) / 2;
    for (int i = 0; i < length; ++i) {
        const unsigned char *letter = glyph(clipped && i >= length - 3 ? '.' : (unsigned char)text[i]);
        for (int row = 0; row < height; ++row)
            for (int col = 0; col < cell; ++col)
                if (letter[row * FONT_L_H / height] & (0x80 >> (col * FONT_L_W / cell)))
                    pixels[(y + row) * SELECTOR_W + x + i * cell + col] = color;
    }
}

static void label(uint32_t *pixels, int x, int y, int width, const char *text,
                  uint32_t color, bool center)
{
    text_at_size(pixels, x, y, width, text, color, center, FONT_L_H);
}

static void star(uint32_t *pixels, int x, int y)
{
    static const unsigned short shape[] = {0x020, 0x020, 0x070, 0x7ff, 0x3fe,
                                           0x1fc, 0x1fc, 0x1fc, 0x1dc, 0x306, 0x202};
    for (int row = 0; row < 11; ++row)
        for (int col = 0; col < 11; ++col)
            if (shape[row] & (1u << col))
                pixels[(y + row) * SELECTOR_W + x + col] = ACCENT;
}

static uint32_t mix(uint32_t back, uint32_t front, unsigned opacity)
{
    uint32_t result = 0;
    for (unsigned shift = 0; shift <= 16; shift += 8) {
        unsigned a = (back >> shift) & 255u, b = (front >> shift) & 255u;
        result |= ((a * (256u - opacity) + b * opacity) >> 8) << shift;
    }
    return result;
}

static uint32_t cover_tint(const char *id)
{
    static const uint32_t palette[] = {0x8d4648u, 0x417c79u, 0x926447u,
                                       0x645685u, 0x456d8du, 0x6f773fu};
    uint32_t hash = 2166136261u;
    for (; *id; ++id) hash = (hash ^ (unsigned char)*id) * 16777619u;
    return palette[hash % (sizeof palette / sizeof *palette)];
}

static uint32_t cover_pixel(const struct selector_item *item, uint32_t tint, int x, int y)
{
    if (item->cover) {
        const unsigned char *p = item->cover + (y * SELECTOR_ART_SIZE + x) * 2;
        unsigned packed = p[0] | (unsigned)p[1] << 8;
        return ((packed >> 11) * 255 / 31) << 16 |
               (((packed >> 5) & 63) * 255 / 63) << 8 |
               (packed & 31) * 255 / 31;
    }
    if (x >= 36 && x < 60 && y >= 22 && y < 70 &&
        (glyph((unsigned char)item->name[0])[(y - 22) / 3] & (0x80 >> ((x - 36) / 3))))
        return INK;
    if (y >= 78 && y < 81 && x >= 14 && x < 82) return tint;
    return mix(BACKGROUND, tint, 90 + (unsigned)(x + y) / 2);
}

static void function_keys(uint32_t *pixels, const struct selector *menu, const struct selector_item *item)
{
    const char *titles[] = {menu->library ? "Covers" : "Library",
                            menu->favorites_only ? "All mods" : "Favorites",
                            item && item->favorite ? "Unstar" : "Star"};
    bool active[] = {menu->library, menu->favorites_only, item && item->favorite};
    for (int i = 0; i < 3; ++i) {
        int left = i * SELECTOR_W / 3 + 3;
        int width = (i + 1) * SELECTOR_W / 3 - left - 3;
        box(pixels, left, 2, width, 21, active[i] ? 0x3c2d2au : 0x201d20u);
        label(pixels, left, 4, width, titles[i], active[i] ? ACCENT : i == 2 && !item ? 0x807774u : INK, true);
    }
}

static void draw_library(uint32_t *pixels, const struct selector *menu, bool has_message)
{
    const int capacity = has_message ? 5 : 6;
    const int rows = menu->visible_count < capacity ? menu->visible_count : capacity;
    int first = menu->cursor - 2;
    if (first > menu->visible_count - rows) first = menu->visible_count - rows;
    if (first < 0) first = 0;
    for (int row = 0; row < rows; ++row) {
        int slot = first + row, y = 49 + row * 30;
        const struct selector_item *item = selector_item_at(menu, slot);
        if (slot == menu->cursor) {
            box(pixels, 8, y, 304, 29, 0x34292au);
            box(pixels, 8, y, 2, 29, ACCENT);
        }
        uint32_t tint = cover_tint(item->id);
        for (int line = 0; line < 22; ++line)
            for (int x = 0; x < 22; ++x)
                pixels[(y + 3 + line) * SELECTOR_W + 16 + x] =
                    cover_pixel(item, tint, x * SELECTOR_ART_SIZE / 22, line * SELECTOR_ART_SIZE / 22);
        label(pixels, 47, y + 6, 236, item->name, slot == menu->cursor ? INK : MUTED, false);
        if (item->favorite) star(pixels, 288, y + 9);
    }
}

static void draw_cover(uint32_t *pixels, const struct selector_item *item, float distance)
{
    float away = fabsf(distance);
    float turn = away < 1.0f ? away : 1.0f;
    float direction = distance < 0.0f ? -1.0f : 1.0f;
    float angle = -direction * turn;
    float sine = sinf(angle), cosine = cosf(angle);
    float size = 128.0f - 15.0f * turn, half = size / 2.0f;
    float center = SELECTOR_W / 2.0f + direction * (89.0f * turn + 36.0f * (away - turn));
    const float focal = 245.0f;
    float depth = focal + 37.0f * turn;
    int left = (int)ceilf(center - half * cosine * focal / (depth + half * sine));
    int right = (int)ceilf(center + half * cosine * focal / (depth - half * sine));
    if (left < 0) left = 0;
    if (right > SELECTOR_W) right = SELECTOR_W;
    uint32_t tint = cover_tint(item->id);
    unsigned opacity = (unsigned)(256.0f - 70.0f * turn);
    for (int x = left; x < right; ++x) {
        /* Undo the projection at the center of the screen column. */
        float offset = x + 0.5f - center;
        float local = offset * depth / (focal * cosine + offset * sine);
        int u = (int)((local / size + 0.5f) * SELECTOR_ART_SIZE);
        if (u < 0) u = 0;
        if (u >= SELECTOR_ART_SIZE) u = SELECTOR_ART_SIZE - 1;
        int tall = (int)(size * focal / (depth - local * sine) + 0.5f);
        int top = 111 - tall / 2, bottom = top + tall;
        for (int y = top < GALLERY_TOP ? GALLERY_TOP : top; y < bottom && y < GALLERY_END; ++y) {
            uint32_t color = cover_pixel(item, tint, u, (y - top) * SELECTOR_ART_SIZE / tall);
            pixels[y * SELECTOR_W + x] = mix(BACKGROUND, color, opacity);
        }
        int reflection = tall * 24 / 128;
        for (int row = 0; row < reflection && bottom + 1 + row < GALLERY_END; ++row) {
            uint32_t *pixel = pixels + (bottom + 1 + row) * SELECTOR_W + x;
            uint32_t color = cover_pixel(item, tint, u, SELECTOR_ART_SIZE - 1 - row * SELECTOR_ART_SIZE / tall);
            *pixel = mix(*pixel, color, (unsigned)(50 * (reflection - row) / reflection));
        }
    }
}

static void draw_gallery(uint32_t *pixels, const struct selector *menu, float position)
{
    for (int y = GALLERY_TOP; y < GALLERY_END; ++y) {
        int dy = y - 119;
        for (int x = 0; x < SELECTOR_W; ++x) {
            int dx = x - SELECTOR_W / 2;
            int falloff = (dx * dx + 2 * dy * dy) / 1200;
            pixels[y * SELECTOR_W + x] = BACKGROUND + (falloff < 20 ? 20 - falloff : 0) * 0x010101u;
        }
    }
    int left = (int)position - 4, right = (int)position + 5;
    if (left < 0) left = 0;
    if (right >= menu->visible_count) right = menu->visible_count - 1;
    /* Draw the farthest cover first so the front cover owns the overlap. */
    while (left <= right) {
        int slot = position - left > right - position ? left++ : right--;
        draw_cover(pixels, selector_item_at(menu, slot), slot - position);
    }
}

static void draw_shutdown(uint32_t *pixels)
{
    const uint32_t text = 0xf4f2f1u;
    box(pixels, 0, 0, SELECTOR_W, SELECTOR_H, 0x27272bu);
    box(pixels, 4, 4, SELECTOR_W - 8, 2, 0x7a7c87u);
    text_at_size(pixels, 0, 17, 106, "No", text, true, 14);
    text_at_size(pixels, 214, 17, 106, "Yes", 0x9fd4ffu, true, 14);
    box(pixels, 6, 51, 308, 143, 0xe0dee2u);
    box(pixels, 7, 52, 306, 141, 0x1d1d21u);
    text_at_size(pixels, 29, 67, 262, "Shutdown", text, false, 20);
    box(pixels, 29, 101, 262, 1, text);
    text_at_size(pixels, 29, 110, 262, "Do you want to shut down?", text, false, 20);
}

void selector_draw(uint32_t *pixels, const struct selector *menu, float position, const char *message)
{
    if (menu->shutdown_prompt) {
        draw_shutdown(pixels);
        return;
    }
    const struct selector_item *item = selector_item_at(menu, menu->cursor);
    bool has_message = message && *message;
    box(pixels, 0, 0, SELECTOR_W, SELECTOR_H, BACKGROUND);
    function_keys(pixels, menu, item);
    const char *title = menu->favorites_only ? "Favorites" : menu->library ? "Library" : "Firmware";
    label(pixels, 12, 25, 144, title, MUTED, false);
    char count[32];
    snprintf(count, sizeof count, "%d / %d", item ? menu->cursor + 1 : 0, menu->visible_count);
    label(pixels, SELECTOR_W - 12 - (int)strlen(count) * FONT_L_W, 25, (int)strlen(count) * FONT_L_W, count, MUTED, false);
    box(pixels, 12, 42, SELECTOR_W - 24, 1, DIVIDER);

    if (!item) {
        label(pixels, 16, 100, SELECTOR_W - 32, "No favorites yet", INK, true);
        label(pixels, 16, 123, SELECTOR_W - 32, "B2 shows all mods", MUTED, true);
    } else if (menu->library) {
        draw_library(pixels, menu, has_message);
    } else {
        draw_gallery(pixels, menu, position);
        text_at_size(pixels, 12, 195, SELECTOR_W - 24, item->name, INK, true, 20);
        if (!has_message) label(pixels, 12, 220, SELECTOR_W - 24, item->caption, MUTED, true);
    }
    if (has_message) label(pixels, 12, 220, SELECTOR_W - 24, message, ACCENT, true);
}

/* Return the smallest full-width band containing every changed pixel. */
int selector_changed_rows(const uint32_t *before, const uint32_t *after, unsigned *top, unsigned *bottom)
{
    const size_t row_bytes = SELECTOR_W * sizeof *before;
    unsigned first = 0, end = SELECTOR_H;
    while (first < end && !memcmp(before + first * SELECTOR_W, after + first * SELECTOR_W, row_bytes))
        ++first;
    if (first == end) return 0;
    while (!memcmp(before + (end - 1) * SELECTOR_W, after + (end - 1) * SELECTOR_W, row_bytes))
        --end;
    *top = first;
    *bottom = end;
    return 1;
}
