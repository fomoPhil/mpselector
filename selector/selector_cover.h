/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <stddef.h>

/* Makes a 96 x 96 RGB565 cover from a PNG, JPEG or BMP, cropped to its middle
 * square. `out` holds SELECTOR_ART_BYTES. Returns 0 on success. */
int selector_cover_from_image(const unsigned char *data, size_t size, unsigned char *out);
