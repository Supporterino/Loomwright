#!/usr/bin/env python3
"""Generate GitHub social preview images (1280x640) for Loomwright.
Usage: python3 make_social.py [--serif /path/to/Fraunces.ttf] name:"tagline" ...
  e.g. python3 make_social.py org:"Spec in. Woven software out." factory:"Repo-local AI software factory"
'org' renders without a repo label; any other name renders as loomwright/<name>.
Needs Pillow. Set the headline font with --serif (Fraunces SemiBold expected; falls back to Lora/DejaVu Serif)."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
W, H, SS = 1280, 640, 2
INK, FLAX, LILAC, CORAL, SUB = '#14172B', '#F3EBDD', '#8E9BEA', '#E0714F', '#BFC4E8'
def rgba(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4)) + (255,)

def mark(size, t, w):
    N = size * SS; s = N / 80
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    def R(x, y, w_, h_, fill, rad=0): d.rounded_rectangle([x*s, y*s, (x+w_)*s-1, (y+h_)*s-1], radius=rad*s, fill=fill)
    for x in (12, 28, 44, 60): R(x, 6, 10, 68, t, 5)
    for y in (20, 48): R(5, y-1, 70, 13, (0, 0, 0, 0), 6.5); R(6, y, 68, 11, w, 5.5)
    for x, y in ((28, 19), (60, 19), (12, 47), (44, 47)): R(x-1, y-1, 12, 15, (0, 0, 0, 0)); R(x, y, 10, 13, t)
    return im

def load(paths, size, var=None):
    for p in paths:
        if p and os.path.exists(p):
            f = ImageFont.truetype(p, size)
            if var:
                try: f.set_variation_by_axes([var])
                except Exception: pass
            return f
    return ImageFont.load_default()

def render(name, tagline, serif, out):
    im = Image.new('RGBA', (W*SS, H*SS), rgba(INK)); d = ImageDraw.Draw(im)
    m = mark(300, rgba(LILAC), rgba(CORAL)); im.alpha_composite(m, (96*SS, (H-300)//2*SS))
    big = load([serif, '/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'], 112*SS, 600)
    mid = load(['/usr/share/fonts/opentype/inter/Inter-Medium.otf'], 30*SS)
    sub = load(['/usr/share/fonts/opentype/inter/Inter-Regular.otf'], 34*SS)
    x = (96 + 300 + 64) * SS
    label = None if name == 'org' else f'loomwright/{name}'
    blocks = ([('label', label, mid, LILAC)] if label else []) + [('word', 'Loomwright', big, FLAX), ('tag', tagline, sub, SUB)]
    heights = {'label': 30, 'word': 112, 'tag': 34}; gaps = {'label': 22, 'word': 26, 'tag': 0}
    total = sum(heights[k] + gaps[k] for k, *_ in blocks)
    y = (H - total) // 2
    for k, text, font, col in blocks:
        asc = font.getmetrics()[0]
        d.text((x, y*SS + (0 if k != 'word' else 0)), text, font=font, fill=col)
        y += heights[k] + gaps[k]
    im.convert('RGB').resize((W, H), Image.LANCZOS).save(out, optimize=True)

if __name__ == '__main__':
    a = sys.argv[1:]; serif = None
    if '--serif' in a: i = a.index('--serif'); serif = a[i+1]; del a[i:i+2]
    for spec in a:
        n, t = spec.split(':', 1); render(n, t, serif, f'social-preview-{n}.png'); print('wrote', f'social-preview-{n}.png')
