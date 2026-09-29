# Compare two screenshot sets from screenshots.js, ignoring pixels that
# differ between two runs of the baseline (live values: speeds, timers):
#   python3 tools/test/compare.py <baseline> <baseline-again> <new>
# Prints each screenshot as "same" or where it differs. Needs Pillow.
import sys, os
from PIL import Image, ImageChops

a, noise, b = sys.argv[1], sys.argv[2], sys.argv[3]
D = 'test-output/'
bad = 0
for f in sorted(os.listdir(D + a)):
    pa, pn, pb = D + a + '/' + f, D + noise + '/' + f, D + b + '/' + f
    if not os.path.exists(pb):
        print(f'{f:32} MISSING'); bad += 1; continue
    A, B = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
    if A.size != B.size:
        print(f'{f:32} SIZE {A.size} -> {B.size}'); bad += 1; continue
    mask = None
    if os.path.exists(pn):
        N = Image.open(pn).convert('RGB')
        if N.size == A.size:
            mask = ImageChops.difference(A, N).convert('L').point(lambda v: 255 if v > 0 else 0)
            # grow the noise mask a little (text changing width)
            from PIL import ImageFilter
            mask = mask.filter(ImageFilter.MaxFilter(9))
    d = ImageChops.difference(A, B).convert('L').point(lambda v: 255 if v > 8 else 0)
    if mask is not None:
        d = ImageChops.subtract(d, mask)
    box = d.getbbox()
    pixels = d.get_flattened_data() if hasattr(d, 'get_flattened_data') else d.getdata()
    n = sum(1 for v in pixels if v) if box else 0
    if box:
        bad += 1
        print(f'{f:32} DIFF {n} px in {box}')
    else:
        print(f'{f:32} same')
print('differing:', bad)
