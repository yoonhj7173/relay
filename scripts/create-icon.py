"""
Converts logos/relay-logo-monochrome.png (white on black) to an 18x18
black-on-transparent PNG saved as resources/iconTemplate.png.

macOS treats *Template.png as a template image, rendering it correctly
in both light and dark menu bars.

Run automatically via `npm run postinstall`. Safe to re-run.
"""

import os
from PIL import Image

src = os.path.join(os.path.dirname(__file__), '../logos/relay-logo-monochrome.png')
dst = os.path.join(os.path.dirname(__file__), '../resources/iconTemplate.png')

os.makedirs(os.path.dirname(dst), exist_ok=True)

img = Image.open(src).convert("RGBA")
img = img.resize((18, 18), Image.LANCZOS)

pixels = img.load()
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = pixels[x, y]
        brightness = (r + g + b) / 3
        pixels[x, y] = (0, 0, 0, int(brightness))

img.save(dst)
print(f'Icon written to {dst}')
