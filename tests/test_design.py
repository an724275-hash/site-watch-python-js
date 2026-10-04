"""Contrast checks for the actual shipped theme tokens."""
import re
from pathlib import Path

import pytest

CSS = (Path(__file__).parents[1] / "docs/style.css").read_text()
THEMES = re.findall(r":root(?:\[data-theme=\"dark\"\])?\s*\{([^}]+)", CSS)


def luminance(color):
    color = color.removeprefix("#")
    if len(color) == 3:
        color = "".join(char * 2 for char in color)
    values = [int(color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [value / 12.92 if value <= 0.04045 else ((value + .055) / 1.055) ** 2.4 for value in values]
    return sum(value * weight for value, weight in zip(linear, (.2126, .7152, .0722)))


def ratio(a, b):
    light, dark = sorted((luminance(a), luminance(b)), reverse=True)
    return (light + .05) / (dark + .05)


@pytest.mark.parametrize("theme", THEMES)
def test_theme_contrast(theme):
    colors = dict(re.findall(r"--([a-z]+):\s*(#[0-9a-f]+)", theme))
    for foreground in ("ink", "muted", "accent", "bad", "warn"):
        for background in ("paper", "surface", "tint"):
            assert ratio(colors[foreground], colors[background]) >= 4.5, (foreground, background)
    for foreground in ("control", "focus"):
        for background in ("paper", "surface", "tint"):
            assert ratio(colors[foreground], colors[background]) >= 3, (foreground, background)
    assert ratio(colors["surface"], colors["accent"]) >= 4.5


def test_both_themes_are_checked():
    assert len(THEMES) == 2
