"""Generate teleprompter app icon set from scratch using PIL."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__)) + "/../src-tauri/icons"
os.makedirs(OUT, exist_ok=True)

FONT_PATH = "C:/Windows/Fonts/msyh.ttc"
BG_COLOR = (15, 23, 42)       # slate-900
FG_COLOR = (255, 255, 255)
ACCENT = (74, 158, 255)       # blue-400 (matches app UI accent)


def render(size: int) -> Image.Image:
    """Render the icon at the given size (square)."""
    img = Image.new("RGBA", (size, size), BG_COLOR + (255,))
    draw = ImageDraw.Draw(img)

    # Subtle accent border (only visible at larger sizes)
    if size >= 128:
        border_w = max(2, size // 64)
        draw.rounded_rectangle(
            [(border_w, border_w), (size - border_w, size - border_w)],
            radius=size // 8,
            outline=ACCENT + (255,),
            width=border_w,
        )

    # Character "提"
    font_size = int(size * 0.62)
    font = ImageFont.truetype(FONT_PATH, font_size, index=0)
    text = "提"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) // 2 - bbox[0]
    y = (size - text_h) // 2 - bbox[1]
    draw.text((x, y), text, fill=FG_COLOR, font=font)

    return img


# Required by tauri.conf.json bundle.icon
sizes = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
}

master = render(512)
master.save(os.path.join(OUT, "icon.png"))

for name, size in sizes.items():
    img = master.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, name))
    print(f"saved {name} ({size}x{size})")

# ICO with multiple resolutions
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico_images = [master.resize(s, Image.LANCZOS) for s in ico_sizes]
ico_images[0].save(
    os.path.join(OUT, "icon.ico"),
    format="ICO",
    sizes=[(s[0], s[1]) for s in ico_sizes],
    append_images=ico_images[1:],
)
print("saved icon.ico (multi-resolution)")

print("done")
