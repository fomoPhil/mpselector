/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "selector_cover.h"
#include "selector_draw.h"

#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_STATIC
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_ONLY_BMP
#define STBI_NO_STDIO
#define STBI_NO_LINEAR
#define STBI_NO_HDR
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wsign-compare"
#endif
#include "stb_image.h"
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

#define MAX_SIDE 4096

int selector_cover_from_image(const unsigned char *data, size_t size, unsigned char *out)
{
    int w, h, channels;
    if (size > INT_MAX || !stbi_info_from_memory(data, (int)size, &w, &h, &channels)) return -1;
    if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) return -1;
    unsigned char *rgb = stbi_load_from_memory(data, (int)size, &w, &h, &channels, 3);
    if (!rgb) return -1;
    int side = w < h ? w : h, left = (w - side) / 2, top = (h - side) / 2;
    for (int y = 0; y < SELECTOR_ART_SIZE; ++y) {
        int y0 = top + y * side / SELECTOR_ART_SIZE, y1 = top + (y + 1) * side / SELECTOR_ART_SIZE;
        if (y1 <= y0) y1 = y0 + 1;
        for (int x = 0; x < SELECTOR_ART_SIZE; ++x) {
            int x0 = left + x * side / SELECTOR_ART_SIZE, x1 = left + (x + 1) * side / SELECTOR_ART_SIZE;
            if (x1 <= x0) x1 = x0 + 1;
            /* Average the block of source pixels this cover pixel stands for. */
            unsigned sum[3] = {0, 0, 0}, count = (unsigned)((y1 - y0) * (x1 - x0));
            for (int sy = y0; sy < y1; ++sy) {
                const unsigned char *p = rgb + ((size_t)sy * (size_t)w + (size_t)x0) * 3;
                for (int sx = x0; sx < x1; ++sx, p += 3) {
                    sum[0] += p[0];
                    sum[1] += p[1];
                    sum[2] += p[2];
                }
            }
            unsigned value = ((sum[0] / count) >> 3) << 11 | ((sum[1] / count) >> 2) << 5 | (sum[2] / count) >> 3;
            *out++ = (unsigned char)(value & 255);
            *out++ = (unsigned char)(value >> 8);
        }
    }
    stbi_image_free(rgb);
    return 0;
}
