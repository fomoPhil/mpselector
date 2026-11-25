/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <stdint.h>
#include "selector_logic.h"

#define SELECTOR_W 320
#define SELECTOR_H 240
#define SELECTOR_ART_SIZE 96
#define SELECTOR_ART_BYTES (SELECTOR_ART_SIZE * SELECTOR_ART_SIZE * 2)

void selector_draw(uint32_t *pixels, const struct selector *menu, float position, const char *message);
int selector_changed_rows(const uint32_t *before, const uint32_t *after, unsigned *top, unsigned *bottom);
