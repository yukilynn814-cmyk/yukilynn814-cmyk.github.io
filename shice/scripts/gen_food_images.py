import os, json, urllib.request, urllib.error, time, io
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

BASE = "https://routercode.cn/v1"
KEY = os.environ.get("ROUTERCODE_API_KEY", "")
ROOT = r"C:\Users\Yuki\Desktop\Hermes素材\饮食助手"
OUT = os.path.join(ROOT, "assets", "img")
os.makedirs(OUT, exist_ok=True)

# key -> (中文名, 英文画面描述)
STAPLES = {
 "st_rice":     ("米饭",   "a round white ceramic bowl filled with steamed white rice, about 150 grams, rice mound slightly domed above the rim"),
 "st_bun":      ("馒头",   "one plain white steamed Chinese mantou bun on a small white plate, smooth fluffy dough, about 100 grams, one bun"),
 "st_flatbread":("大饼",   "one round golden Chinese flatbread scallion pancake on a wooden board, flaky layers visible, about 150 grams"),
 "st_noodle":   ("面条",   "a deep white bowl of boiled wheat noodles in clear broth, chopsticks resting on the rim, about 250 grams of noodles"),
 "st_dumpling": ("饺子",   "eight steamed Chinese dumplings arranged in a bamboo steamer basket, pleated white dough, visible steam"),
 "st_toast":    ("面包片", "two slices of plain white sandwich bread on a white plate, soft square crumb, about 70 grams"),
 "st_burger":   ("汉堡",   "a single fast food hamburger, sesame bun with beef patty lettuce and tomato, on a plain white plate"),
 "st_baozi":    ("包子",   "two steamed meat buns with pleated tops on a small white plate, soft white dough, about 100 grams"),
 "st_nostaple": ("不吃主食","a small white plate of fresh steamed green vegetables and broccoli, no rice or bread, about 150 grams of vegetables"),
}

DISHES = {
 "d_huangmenji":  ("黄焖鸡米饭","a white bowl of braised chicken with potato in glossy brown sauce served over steamed white rice, small side bowl of clear soup"),
 "d_qingzhengyu": ("清蒸鲈鱼套餐","a whole steamed sea bass fillet on a white oval plate garnished with scallion, small bowl of rice and a side of green vegetables"),
 "d_malaxiangguo":("麻辣香锅","a white bowl of dry spicy stir fry with sliced meat lotus root and vegetables coated in red chili oil, served with white rice"),
 "d_lanzhoulamian":("兰州拉面","a deep bowl of clear beef noodle soup with sliced beef radish cilantro and a swirl of pulled noodles, one Chinese noodle soup"),
 "d_chongqingxiaomian":("重庆小面","a bowl of spicy Chongqing noodles with minced pork peanuts and red chili oil, chopsticks resting on the bowl"),
 "d_fanqiejidanmian":("番茄鸡蛋面","a bowl of tomato and egg noodle soup, red broth with egg ribbons and wheat noodles"),
 "d_galijifan":  ("咖喱鸡饭","a white bowl of yellow Japanese curry with chunks of chicken potato and carrot over steamed white rice"),
 "d_fanqieyimian":("番茄意面","a white plate of spaghetti in red tomato meat sauce with basil, twirled pasta on a shallow dish"),
 "d_pisa":       ("披萨","two triangular slices of cheese pizza on a plain white plate, melted mozzarella and tomato sauce visible"),
 "d_qingshijixiong":("轻食鸡胸饭","a black bowl of grilled sliced chicken breast with brown rice and green broccoli, light salad greens, fitness style meal"),
 "d_quanmaijixiongsa":("全麦鸡胸沙拉","a white bowl of chicken breast salad with lettuce cucumber cherry tomato and two slices of brown whole wheat bread on the side"),
 "d_shuizhuyu":  ("水煮鱼","a wide bowl of Sichuan boiled fish in bright red chili oil with dried chilies and cabbage, served with rice"),
 "d_suancaiyu":  ("酸菜鱼","a large white bowl of fish in pickled mustard green sour soup with yellow chili oil, sliced white fish fillets"),
 "d_beijingkaoya":("北京烤鸭","sliced roast duck with crispy brown skin on a white plate, thin pale pancakes and julienned cucumber scallion beside it"),
 "d_tieban":     ("铁板牛肉饭","a hot cast iron plate of sliced sizzling beef with vegetables over steamed rice, steam rising"),
 "d_shiguobanfan":("石锅拌饭","a black stone bowl of Korean bibimbap with rice, vegetables, egg yolk and gochujang, stone bowl visible"),
 "d_baozaifan":  ("煲仔饭","a clay pot of Chinese rice with crispy rice crust at the edges, topped with Chinese sausage and egg, small side dish"),
 "d_jiaozi":     ("饺子","a plate of pan fried Chinese pork dumplings with golden crispy bottoms arranged in a row, small dish of vinegar"),
 "d_dapanji":    ("大盘鸡","a large bowl of Xinjiang big plate chicken with potato and bell pepper in red sauce, wide belt noodles beside it"),
 "d_malatang":   ("麻辣烫","a bowl of Chinese malatang soup with assorted vegetables meat slices and noodles in a reddish spicy broth"),
 "d_luosifen":   ("螺蛳粉","a bowl of Luosifen rice noodle soup with fermented bamboo shoots peanuts and red oil, chopsticks lifting noodles"),
 "d_niuroufan":  ("牛肉饭","a bowl of teriyaki beef rice topped with glossy sliced beef and onion over steamed white rice"),
 "d_hanbaoshutiao":("汉堡薯条","a fast food burger next to a paper cup of golden french fries on a white plate"),
 "d_zhaji":      ("炸鸡","a pile of golden crispy fried chicken pieces on a white plate, craggy crunchy coating"),
 "d_shaokao":    ("烧烤套餐","grilled meat skewers on a small metal tray with roasted peanuts and a glass of beer, charred edges"),
 "d_shaguozhou": ("砂锅粥","a clay pot of seafood congee with visible shrimp and crab, creamy pale porridge, small side plate"),
 "d_guandongzhu":("关东煮","a white bowl of oden with fish balls lotus root daikon and boiled egg in clear broth, bamboo skewer"),
 "d_kaolengmian":("烤冷面","a street food grilled cold noodle sheet on a metal griddle with egg and sauce, chopped scallion"),
 "d_jianjiao":   ("煎饺","a plate of pan fried dumplings with crispy browned bottoms, eight pieces, chive filling visible"),
 "d_huoguo":     ("火锅","a Chinese hot pot of red chili broth with sliced meat vegetables and mushrooms, steam rising, one person portion"),
 "d_doujiangyoutiao":("豆浆油条","a glass of warm soy milk beside two golden fried Chinese dough sticks on a white plate"),
 "d_pidanshouroujzhou":("皮蛋瘦肉粥","a white bowl of century egg and lean pork congee with a steamed mantou bun beside it"),
 "d_xiaolongbao":("小笼包","six steamed soup dumplings in a bamboo steamer with a small bowl of black vinegar"),
 "d_baozidoujiang":("包子豆浆","two steamed meat buns on a white plate with a glass of pale soy milk"),
 "d_tushijian dan":("吐司煎蛋牛奶","two toasted white bread slices with a fried egg on top, a glass of milk beside them"),
 "d_yanmaizhou":  ("燕麦粥","a white bowl of creamy oatmeal porridge topped with sliced banana and chopped nuts, a spoon resting in it"),
 "d_huntun":     ("馄饨","a white bowl of clear wonton soup with visible dumplings and thin green onion, one bowl"),
 "d_jianbingguozi":("煎饼果子","a Chinese jianbing crepe rolled with egg and crispy cracker in a paper sleeve, cut showing layers"),
 "d_sanmingzhi": ("三明治套餐","a triangular club sandwich with lettuce and tomato on a white plate, a cup of latte coffee beside it"),
 "d_changfen":   ("肠粉","a white plate of Cantonese rice noodle rolls with dark soy sauce poured on top, thin translucent rolls"),
}

def prompt_for(desc):
    return ("Professional food photography, a real photograph of " + desc + ". "
            "Plain seamless light grey background, soft natural daylight from the left, "
            "45 degree angle, realistic appetizing texture, true to life single person portion size, "
            "clean minimal food magazine styling, high detail, "
            "no text, no watermark, no logo, no people, no hands, no illustration, no cartoon, no anime, "
            "no 3d render, no emoji")

def post(path, payload, timeout=180):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return 0, "ERR " + type(e).__name__ + ": " + str(e)[:160]

def fetch(url, timeout=90):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read()
    except Exception as e:
        return None

def compress(raw, path):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im = im.resize((512, 512), Image.LANCZOS)
    im.save(path, "JPEG", quality=82, optimize=True)
    return os.path.getsize(path)

def job(item):
    key, (cn, desc) = item
    path = os.path.join(OUT, key + ".jpg")
    if os.path.exists(path) and os.path.getsize(path) > 4000:
        return key, "SKIP", os.path.getsize(path)
    last = ""
    for attempt in range(3):
        model = "grok-imagine-image" if attempt < 2 else "grok-imagine-image-quality"
        st, body = post("/images/generations", {"model": model, "prompt": prompt_for(desc), "n": 1, "size": "1024x1024"})
        if st == 200:
            try:
                it = (json.loads(body).get("data") or [{}])[0]
                url = it.get("url")
                if not url:
                    last = "no url"; continue
                raw = fetch(url)
                if not raw:
                    last = "download fail"; continue
                sz = compress(raw, path)
                return key, "OK", sz
            except Exception as e:
                last = "parse " + str(e)[:100]
        else:
            last = "HTTP %s %s" % (st, body[:130].replace("\n", " "))
        time.sleep(3 + attempt * 4)
    return key, "FAIL", last

ALL = [(k, v) for k, v in STAPLES.items()] + [(k, v) for k, v in DISHES.items()]
print("total to generate:", len(ALL), flush=True)

ok = fail = 0
results = {}
with ThreadPoolExecutor(max_workers=3) as ex:
    futs = {ex.submit(job, it): it[0] for it in ALL}
    done = 0
    for f in as_completed(futs):
        key, status, info = f.result()
        done += 1
        results[key] = (status, info)
        if status == "OK" or status == "SKIP":
            ok += 1
        else:
            fail += 1
        print("[%2d/%2d] %-24s %-5s %s" % (done, len(ALL), key, status, info), flush=True)

with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump({"ok": ok, "fail": fail, "items": {k: v[0] for k, v in results.items()}}, fh, ensure_ascii=False, indent=1)
print("DONE ok=%d fail=%d" % (ok, fail))
if fail:
    print("FAILED:", [k for k, v in results.items() if v[0] == "FAIL"])
