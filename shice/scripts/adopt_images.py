import os, glob, shutil, json

PROJ = r"C:\Users\Yuki\Desktop\Hermes素材\饮食助手"
IMG = os.path.join(PROJ, "assets", "img")
CAND = r"C:\Users\Yuki\AppData\Local\hermes\cache\scratch\cand"

# 1) 采用候选图
adopt = {
    "st_flatbread": "st_flatbread_grok-imagine-image.jpg",
    "d_jianbingguozi": "d_jianbingguozi_wan2_6-t2i.jpg",
}
for key, fname in adopt.items():
    src = os.path.join(CAND, fname)
    dst = os.path.join(IMG, key + ".jpg")
    if os.path.exists(src):
        shutil.copyfile(src, dst)
        print("adopt:", key, "<-", fname, os.path.getsize(dst))

# 2) 清掉探针图和拼图
removed = 0
for p in glob.glob(os.path.join(IMG, "probe_*.png")) + glob.glob(os.path.join(IMG, "_*.jpg")):
    os.remove(p); removed += 1
print("removed probe files:", removed)

# 3) 盘点
files = sorted(os.path.basename(f) for f in glob.glob(os.path.join(IMG, "*.jpg")))
print("final jpg count:", len(files))
print(files)
print("total size: %.2f MB" % (sum(os.path.getsize(os.path.join(IMG, f)) for f in files) / 1048576))
