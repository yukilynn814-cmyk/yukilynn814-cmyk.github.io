// ===== 固定 8 张地图：每局随机选一张（maps.js 由关卡编辑器导出）=====
(function(){
  try{
    if(window.GAME_MAPS && window.GAME_MAPS.length){
      const i = (Math.random()*window.GAME_MAPS.length)|0;
      window.LEVEL_DATA = window.GAME_MAPS[i];
      window.__MAP_INDEX = i;
    }
  }catch(e){}
})();
/* ===== 数值表：来自 config.js（编辑器生成），没有就用默认值 ===== */
const CFG = Object.assign({
  "地图":{走廊宽:4.2, 层高:2.85, 总长:40, 总宽:32},
  "玩家":{走速:1.60, 跑速:5.2, 疾跑上限秒:8, 体力回复秒:12, 跳跃初速:5.0, 重力:18.0},
  "鬼":{速度:3.2},
  "画面":{雾浓度:0.058, 手电亮度:95, 菜单手电比例:0.34},
  "道具":{墨水黑屏秒:3.0, 皮鞋疾跑上限:12},
  "刷新":{环廊躲藏门最少:12, 环廊躲藏门最多:18, 墨水数量:1, 皮鞋最少:1, 皮鞋最多:2}
}, window.GAME_CONFIG||{});

/* ============================================================
   程序化恐怖走廊
   —— 所有几何体与贴图都由代码按参数生成，不使用任何外部素材
   ============================================================ */

/* ---------- 0. 基础工具：可复现的随机数 ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296}}
const R = mulberry32(20261011);          // 固定种子，每次打开走廊长得一样
const rr = (a,b)=>a+R()*(b-a);

function canvasOf(size){const c=document.createElement('canvas');c.width=c.height=size;return c;}

/* ---------- 1. 程序化贴图 ---------- */
// 石膏/涂料的凹凸高度图（专门用来算法线，比拿颜色反推准得多）
function plasterHeight(size){
  const r=mulberry32(99), c=canvasOf(size), x=c.getContext('2d'), k=size/512;
  x.fillStyle='#808080'; x.fillRect(0,0,size,size);
  for(let i=0;i<900;i++){                       // 大块的鼓包/凹陷
    const px=r()*size, py=r()*size, rad=(2+r()*14)*k, v=Math.round(104+r()*96);
    const g=x.createRadialGradient(px,py,0,px,py,rad);
    g.addColorStop(0,`rgba(${v},${v},${v},${.10+r()*.24})`);
    g.addColorStop(1,`rgba(${v},${v},${v},0)`);
    x.fillStyle=g; x.beginPath(); x.arc(px,py,rad,0,7); x.fill();
  }
  const img=x.getImageData(0,0,size,size), d=img.data;
  for(let i=0;i<d.length;i+=4){ const n=(r()-.5)*30; d[i]+=n; d[i+1]+=n; d[i+2]+=n; }  // 细砂粒
  x.putImageData(img,0,0);
  return c;
}

// 整面墙：下半灰白、上半脏绿，同一条底色噪声 → 水渍能连续穿过分界线
function wallTexSplit(size){
  const TILE=3.2, splitV=(H*.62)/TILE;            // 分界线在贴图里从底部数 55%
  const src=grime({size:size, base:[104,106,100], seed:3, noise:46, stains:42, drips:78}).image;  // 更脏
  const c=canvasOf(size), x=c.getContext('2d'), k=size/512;
  const splitY=size*(1-splitV);
  x.drawImage(src,0,0,size,size);
  x.save();
  x.beginPath(); x.rect(0,0,size,splitY); x.clip();
  x.drawImage(src,0,0,size,size);
  x.globalCompositeOperation='multiply';
  x.fillStyle='rgb(84,102,92)';                 // 更暗更脏的灰绿
  x.fillRect(0,0,size,splitY);
  x.restore();
  // 分界处：一道深色窄条 + 一点磨损（像漆边）
  x.fillStyle='rgba(20,20,18,0.5)';   x.fillRect(0, splitY-2*k, size, 5*k);
  x.fillStyle='rgba(210,208,196,0.16)'; x.fillRect(0, splitY+3*k, size, 3*k);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=16;
  return t;
}


// 从一张图的明暗推算"凹凸贴图"（法线贴图）：墙面不再是平的
function normalFromCanvas(src, strength){
  const N=256;                                   // 先在 256 上算 → 大块的起伏（逐像素算等于没做）
  const sm=document.createElement('canvas'); sm.width=sm.height=N;
  const sc=sm.getContext('2d'); sc.drawImage(src,0,0,N,N);
  const sd=sc.getImageData(0,0,N,N).data;
  const out=canvasOf(N), octx=out.getContext('2d');
  const img=octx.createImageData(N,N), od=img.data;
  const L=(x,y)=>{ x=(x+N)%N; y=(y+N)%N;
    const i=(y*N+x)*4; return (sd[i]*0.299+sd[i+1]*0.587+sd[i+2]*0.114)/255; };
  const st=2;                                    // 采样步长=2 → 起伏更大
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const dx=(L(x+st,y)-L(x-st,y))*strength;
    const dy=(L(x,y+st)-L(x,y-st))*strength;
    const nx=-dx, ny=-dy, nz=1;
    const l=Math.sqrt(nx*nx+ny*ny+nz*nz);
    const i=(y*N+x)*4;
    od[i]  =(nx/l*0.5+0.5)*255;
    od[i+1]=(ny/l*0.5+0.5)*255;
    od[i+2]=(nz/l*0.5+0.5)*255;
    od[i+3]=255;
  }
  octx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(out);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.colorSpace = (THREE.NoColorSpace!==undefined) ? THREE.NoColorSpace : '';
  return t;
}


// 通用脏污：底色 + 逐像素噪点 + 霉斑 + 水渍挂流
function grime(opts){
  const {size=1024,base=[140,140,132],seed=1,stains=26,drips=44,dark=[22,20,16],noise=44}=opts||{};
  const k=size/512;                                    // 特征等比放大，不然 1024 会变"太干净"
  const r=mulberry32(seed), c=canvasOf(size), x=c.getContext('2d');
  x.fillStyle=`rgb(${base[0]},${base[1]},${base[2]})`; x.fillRect(0,0,size,size);

  const img=x.getImageData(0,0,size,size), d=img.data;
  for(let i=0;i<d.length;i+=4){const n=(r()-.5)*noise; d[i]+=n; d[i+1]+=n; d[i+2]+=n;}
  x.putImageData(img,0,0);

  for(let i=0;i<stains;i++){                            // 霉斑
    const px=r()*size, py=r()*size, rad=(8+r()*88)*k;
    const g=x.createRadialGradient(px,py,0,px,py,rad);
    g.addColorStop(0,`rgba(${dark[0]},${dark[1]},${dark[2]},${.06+r()*.20})`);
    g.addColorStop(1,`rgba(${dark[0]},${dark[1]},${dark[2]},0)`);
    x.fillStyle=g; x.beginPath(); x.arc(px,py,rad,0,7); x.fill();
  }
  for(let i=0;i<drips;i++){                             // 水渍往下流
    const px=r()*size, py=r()*size, w=(1+r()*3)*k, h=(24+r()*200)*k;
    const g=x.createLinearGradient(0,py,0,py+h);
    g.addColorStop(0,`rgba(${dark[0]},${dark[1]},${dark[2]},${.09+r()*.17})`);
    g.addColorStop(1,`rgba(${dark[0]},${dark[1]},${dark[2]},0)`);
    x.fillStyle=g; x.fillRect(px,py,w,h);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=16;
  return t;
}

// 地板砖：格子里带污渍，缝隙发黑
function tiles(seed=7,size=1024,n=4){
  const r=mulberry32(seed), c=canvasOf(size), x=c.getContext('2d');
  x.fillStyle='#2b2c28'; x.fillRect(0,0,size,size);
  const k=size/512, pad=7*k, cell=size/n;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const g=64+r()*30;                                    // 地砖压暗
    x.fillStyle=`rgb(${g+5},${g+2},${g-5})`;
    x.fillRect(i*cell+pad,j*cell+pad,cell-pad*2,cell-pad*2);
    for(let k=0;k<150;k++){                              // 砖面颗粒
      x.fillStyle=`rgba(${18+r()*54},${18+r()*54},${16+r()*46},${.05+r()*.13})`;
      x.fillRect(i*cell+pad+r()*(cell-pad*2), j*cell+pad+r()*(cell-pad*2), (1+r()*3)*k,(1+r()*3)*k);
    }
  }
  for(let i=0;i<22;i++){                                 // 大块脏斑
    const px=r()*size, py=r()*size, rad=(10+r()*70)*k;
    const g=x.createRadialGradient(px,py,0,px,py,rad);
    g.addColorStop(0,`rgba(16,14,10,${.08+r()*.22})`); g.addColorStop(1,'rgba(16,14,10,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,rad,0,7); x.fill();
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=16;
  return t;
}

// 天花板：吸音板网格（发霉、发黄）
function ceilingTex(seed=13,size=1024){
  const r=mulberry32(seed), c=canvasOf(size), x=c.getContext('2d');
  x.fillStyle='#3a3a35'; x.fillRect(0,0,size,size);
  const k=size/512, n=4, cell=size/n, pad=3*k;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const g=64+r()*22;
    x.fillStyle=`rgb(${g+8},${g+6},${g-6})`;
    x.fillRect(i*cell+pad,j*cell+pad,cell-pad*2,cell-pad*2);
    for(let k=0;k<220;k++){                              // 吸音板孔洞
      x.fillStyle=`rgba(20,18,14,${.10+r()*.24})`;
      x.fillRect(i*cell+pad+r()*(cell-pad*2), j*cell+pad+r()*(cell-pad*2), Math.max(1,k),Math.max(1,k));
    }
  }
  for(let i=0;i<8;i++){                                  // 漏水痕
    const px=r()*size, py=r()*size, rad=(20+r()*90)*k;
    const g=x.createRadialGradient(px,py,0,px,py,rad);
    g.addColorStop(0,`rgba(52,40,18,${.12+r()*.24})`); g.addColorStop(1,'rgba(52,40,18,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,rad,0,7); x.fill();
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=16;
  return t;
}

/* ---------- 2. 尺寸参数：2.0 地图 = 九宫格房间 + 双横双纵走廊 + 外围环廊 ---------- */
const W = CFG.地图.走廊宽;        // 走廊宽度（config.js 可调）
const H = CFG.地图.层高;
const CELL = 3.0;               // 接缝/灯具的间距基准
const HX = CFG.地图.总长/2, HZ = CFG.地图.总宽/2;   // 外轮廓（config.js 可调）
const IX = HX - W, IZ = HZ - W; // 内区边界＝环廊内墙
const CX = HX - W/2, CZ = HZ - W/2;   // 环廊中心线
const RING_LEN = 4*(CX+CZ);     // 绕外围一圈的长度
const LEN = RING_LEN;           // 兼容旧引用

const WALL_T = 0.30;            // 墙厚（碰撞和模型一致）
// 迷宫模式：level.js 里有「墙体」就完全按编辑器数据建图，老环廊逻辑全部跳过
const MAZE = !!(window.LEVEL_DATA && Array.isArray(window.LEVEL_DATA.墙体) && window.LEVEL_DATA.墙体.length > 0);
window.MAZE = MAZE;
const DOOR_W = 1.10, DOOR_H = 2.06;   // 门洞尺寸
const PR = 0.30;                // 玩家碰撞半径
const WALLS = [];               // 碰撞用的墙 AABB 列表
// 家具碰撞盒：top = 需要跳多高才能过去
function addPropBox(x, z, top, r){
  WALLS.push({x0:x-r, x1:x+r, z0:z-r, z1:z+r, top:top});
}

// —— 3×3 房间：两条纵走廊 + 两条横走廊把它们分开 ——
const RW = (2*IX - 2*W)/3;      // 单间宽 ≈ 7.73
const RD = (2*IZ - 2*W)/3;      // 单间深 ≈ 5.07
const VX = [-(RW/2+W/2), (RW/2+W/2)];   // 两条纵走廊的中心 x
const HY = [-(RD/2+W/2), (RD/2+W/2)];   // 两条横走廊的中心 z
const COLX = [[-IX,-IX+RW], [-RW/2,RW/2], [IX-RW,IX]];
const ROWZ = [[-IZ,-IZ+RD], [-RD/2,RD/2], [IZ-RD,IZ]];
const ROOMS = [];
{ // level.js 里有「房间」就按它来（自由画房间），否则用九宫格
  const _LD=window.LEVEL_DATA, _list=(_LD&&Array.isArray(_LD.房间))?_LD.房间:null;
  if(_list && _list.length){
    _list.forEach(function(r0,idx){
      const r={x0:r0.x0, x1:r0.x1, z0:r0.z0, z1:r0.z1, doorFace:r0.door, id:idx};
      r.cx=(r.x0+r.x1)/2; r.cz=(r.z0+r.z1)/2;
      ROOMS.push(r);
    });
  } else {
    for(let ri=0; ri<3; ri++) for(let ci=0; ci<3; ci++){
      const r={ci, ri, x0:COLX[ci][0], x1:COLX[ci][1], z0:ROWZ[ri][0], z1:ROWZ[ri][1]};
      r.cx=(r.x0+r.x1)/2; r.cz=(r.z0+r.z1)/2; r.id=ri*3+ci;
      ROOMS.push(r);
    }
  }
}
// 内区四条走廊（灯、道具、刷新点都从这里采样）
const CORR_RECTS = [
  {x0:VX[0]-W/2, x1:VX[0]+W/2, z0:-IZ, z1:IZ, dir:'v'},
  {x0:VX[1]-W/2, x1:VX[1]+W/2, z0:-IZ, z1:IZ, dir:'v'},
  {x0:-IX, x1:IX, z0:HY[0]-W/2, z1:HY[0]+W/2, dir:'h'},
  {x0:-IX, x1:IX, z0:HY[1]-W/2, z1:HY[1]+W/2, dir:'h'},
];
// 房间门：随机挑一面「贴着走廊」的墙，开在这面墙的正中
const ROOM_DOORS = [];
function faceFromRot(rot){
  const r = ((rot % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  if(Math.abs(r - Math.PI/2) < 0.35) return 'x1';
  if(Math.abs(r - Math.PI*1.5) < 0.35) return 'x0';
  if(r < 0.35 || r > Math.PI*2-0.35) return 'z0';
  return 'z1';
}
if(MAZE){
  (window.LEVEL_DATA.房间门 || []).forEach(function(d){
    const face = faceFromRot(d.rot);
    ROOM_DOORS.push({ room:null, face:face, x:d.x, z:d.z, rotY:d.rot,
                      open:false, t:0, target:0, hinge:null });
  });
}
for(const r of (MAZE ? [] : ROOMS)){
  const faces=[];
  if(r.x0 > -IX+1e-3) faces.push('x0');
  if(r.x1 <  IX-1e-3) faces.push('x1');
  if(r.z0 > -IZ+1e-3) faces.push('z0');
  if(r.z1 <  IZ-1e-3) faces.push('z1');
  const _LDr=(window.LEVEL_DATA&&Array.isArray(window.LEVEL_DATA.房间门))?window.LEVEL_DATA.房间门[ROOMS.indexOf(r)]:null;
  const face=(r.doorFace && faces.indexOf(r.doorFace)>=0) ? r.doorFace
            : ((_LDr && faces.indexOf(_LDr)>=0) ? _LDr : faces[Math.floor(Math.random()*faces.length)]);
  const d={room:r, face, open:false, t:0, target:0, hinge:null};
  if(face==='x0'){ d.x=r.x0; d.z=r.cz; d.rotY=-Math.PI/2; }
  else if(face==='x1'){ d.x=r.x1; d.z=r.cz; d.rotY=Math.PI/2; }
  else if(face==='z0'){ d.x=r.cx; d.z=r.z0; d.rotY=0; }
  else               { d.x=r.cx; d.z=r.z1; d.rotY=Math.PI; }
  ROOM_DOORS.push(d); r.door=d;
}

// 到"外圈矩形"的有符号距离：矩形里面是负数，外面是正数
function sdRect(x,z,hx,hz){
  const dx=Math.abs(x)-hx, dz=Math.abs(z)-hz;
  const ax=Math.max(dx,0), az=Math.max(dz,0);
  return Math.hypot(ax,az) + Math.min(Math.max(dx,dz), 0);
}

// 沿中心线走一圈的路径（4 条直边）
const PATH = (()=>{
  const p=[[-CX,-CZ],[CX,-CZ],[CX,CZ],[-CX,CZ]];
  const segs=[]; let acc=0;
  for(let i=0;i<4;i++){
    const a=p[i], b=p[(i+1)%4];
    const len=Math.hypot(b[0]-a[0], b[1]-a[1]);
    segs.push({x:a[0], z:a[1],
               dx:(b[0]-a[0])/len, dz:(b[1]-a[1])/len, len, start:acc});
    acc+=len;
  }
  return {segs, total:acc};
})();
// 走到 d 米处：位置 + 前进方向 + 指向外圈墙的法线
function atPath(d){
  d = ((d % PATH.total) + PATH.total) % PATH.total;
  for(const s of PATH.segs){
    if(d <= s.start + s.len + 1e-6){
      const k = d - s.start;
      return {x:s.x+s.dx*k, z:s.z+s.dz*k, dx:s.dx, dz:s.dz,
              nx:s.dz, nz:-s.dx};
    }
  }
  const s=PATH.segs[0];
  return {x:s.x, z:s.z, dx:s.dx, dz:s.dz, nx:s.dz, nz:-s.dx};
}
// 玩家大概在环上的哪个位置（给"远处人影"用）
function pathD(x,z){
  let best=0, bd=1e9;
  for(const s of PATH.segs){
    const t=Math.max(0, Math.min(s.len, (x-s.x)*s.dx + (z-s.z)*s.dz));
    const px=s.x+s.dx*t, pz=s.z+s.dz*t;
    const d=(x-px)*(x-px)+(z-pz)*(z-pz);
    if(d<bd){ bd=d; best=s.start+t; }
  }
  return best;
}


// 读取真实显卡型号（判断是不是被浏览器丢给核显了）
function gpuNameOf(){
  try{
    const c=document.createElement('canvas');
    const gl=c.getContext('webgl2')||c.getContext('webgl');
    if(!gl) return '不支持 WebGL';
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
               : String(gl.getParameter(gl.RENDERER));
  }catch(e){ return '未知'; }
}
const GPU_NAME = gpuNameOf();
const GPU_WEAK = /Radeon\(TM\) 6\d\dM|UHD Graphics|Iris|Intel\(R\)|SwiftShader|llvmpipe|Basic Render/i.test(GPU_NAME);

/* ---------- 3. 场景 / 相机 / 渲染器 ---------- */
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0f1a1c, CFG.画面.雾浓度);   // 冷灰绿的浓雾（寂静岭）         // 暗蓝雾：远处是"看不见"而不是"没渲染"

const camera = new THREE.PerspectiveCamera(66, innerWidth/innerHeight, 0.05, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);

const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
let DPR_CAP = 2.0;                                   // 渲染倍率，实测发卡会自动往下降
renderer.setPixelRatio(Math.min(devicePixelRatio, DPR_CAP));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

/* ---------- 4. 材质 ---------- */
const wallMat = new THREE.MeshStandardMaterial({
  map: wallTexSplit(1024), roughness:.66, metalness:.04
});
const upperMat = new THREE.MeshStandardMaterial({
  map: grime({base:[86,102,88], seed:9, noise:34}), roughness:.92
});
const wallN  = normalFromCanvas(plasterHeight(512), 5.0);
wallMat.normalMap = wallN;  wallMat.normalScale = new THREE.Vector2(1.25,1.25);

const floorMat = new THREE.MeshStandardMaterial({map:tiles(), roughness:.24, metalness:.10});  // 湿地面：低粗糙度才有反光
const ceilMat  = new THREE.MeshStandardMaterial({map:ceilingTex(), roughness:.88});
// 尺寸改由几何体的 UV 承担（每面墙按自身长度重复），这里还原成 1:1
wallMat.map.repeat.set(1,1);  upperMat.map.repeat.set(1,1);
wallMat.map.wrapS=wallMat.map.wrapT=THREE.RepeatWrapping;
upperMat.map.wrapS=upperMat.map.wrapT=THREE.RepeatWrapping;
floorMat.map.repeat.set(1/1.5, 1/1.5);   // ShapeGeometry 的 UV 单位是"米"
ceilMat.map.repeat.set(1/1.5, 1/1.5);
// 地砖/吊顶的凹凸
floorMat.normalMap = normalFromCanvas(floorMat.map.image, 3.0);
floorMat.normalScale = new THREE.Vector2(1.3,1.3);
floorMat.normalMap.repeat.copy(floorMat.map.repeat);
ceilMat.normalMap  = normalFromCanvas(ceilMat.map.image, 1.6);
ceilMat.normalScale = new THREE.Vector2(.7,.7);
ceilMat.normalMap.repeat.copy(ceilMat.map.repeat);
floorMat.map.wrapS=floorMat.map.wrapT=THREE.RepeatWrapping;
ceilMat.map.wrapS=ceilMat.map.wrapT=THREE.RepeatWrapping;

const metalMat  = new THREE.MeshStandardMaterial({color:0x6a7178, roughness:.22, metalness:.95});  // 金属：亮、冷
const darkMat   = new THREE.MeshStandardMaterial({color:0x14161a, roughness:.9});
const paintMat  = new THREE.MeshStandardMaterial({color:0x8d949a, roughness:.34, metalness:.30});
const doorMat   = new THREE.MeshStandardMaterial({
  map: grime({base:[96,92,84], seed:21, noise:30, drips:60}), roughness:.8
});

function box(w,h,d,mat,pos,rot){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(...pos); if(rot)m.rotation.set(...rot);
  m.castShadow=true; m.receiveShadow=true; scene.add(m); return m;
}
function cyl(r1,r2,h,mat,pos,rot){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,12,1,true),mat);
  m.position.set(...pos); if(rot)m.rotation.set(...rot);
  m.castShadow=true; m.receiveShadow=true; scene.add(m); return m;
}
// 让贴图按"米"重复，而不是按整面墙拉一次
function uvRepeat(geo, gx, gy){
  const uv=geo.attributes.uv;
  for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*gx, uv.getY(i)*gy);
  uv.needsUpdate=true;
}

/* ---------- 4a. 地板 / 天花板：整块大矩形（2.0 全区都有地面） ---------- */
const floorGeo = new THREE.PlaneGeometry(2*HX, 2*HZ);
uvRepeat(floorGeo, (2*HX)/2.4, (2*HZ)/2.4);
const floorMesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.rotation.x = -Math.PI/2; floorMesh.position.y = 0;
floorMesh.receiveShadow = true; scene.add(floorMesh);

const ceilGeo = new THREE.PlaneGeometry(2*HX, 2*HZ);
uvRepeat(ceilGeo, (2*HX)/2.4, (2*HZ)/2.4);
const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
ceilMesh.rotation.x = Math.PI/2; ceilMesh.position.y = H;
ceilMesh.receiveShadow = true; scene.add(ceilMesh);

/* ---------- 4b. 墙体：外墙 + 内区边界（给走廊留口）+ 九个房间（各一扇门） ---------- */
function wallBox(x0,z0,x1,z1,y0,y1,solid){
  const alongX = Math.abs(x1-x0) >= Math.abs(z1-z0);
  const bw = alongX ? Math.abs(x1-x0) : WALL_T;
  const bd = alongX ? WALL_T : Math.abs(z1-z0);
  const ya = (y0===undefined?0:y0), yb = (y1===undefined?H:y1);
  const bh = yb-ya; if(bh<=1e-3) return null;
  const g = new THREE.BoxGeometry(bw, bh, bd);
  uvRepeat(g, Math.max(bw,bd)/3.2, bh/3.2);
  // ★ 贴图按「世界高度」连续：门楣这种矮墙段否则会从贴图最底部开始画，露出一块颜色不同的板子
  if(ya>1e-3){ const uv=g.attributes.uv; for(let k=0;k<uv.count;k++) uv.setY(k, uv.getY(k)+ya/3.2); uv.needsUpdate=true; }
  const m = new THREE.Mesh(g, wallMat);
  m.position.set((x0+x1)/2, ya+bh/2, (z0+z1)/2);
  m.receiveShadow = true; scene.add(m);
  if(solid!==false){
    WALLS.push({x0:m.position.x-bw/2, x1:m.position.x+bw/2,
                z0:m.position.z-bd/2, z1:m.position.z+bd/2});
  }
  return m;
}
// 一段墙；gap={c:门中心(绝对坐标), w:门宽} 时中间留门洞 + 门楣
function wallRun(x0,z0,x1,z1,gap){
  const alongX = Math.abs(x1-x0) >= Math.abs(z1-z0);
  const a0 = alongX?Math.min(x0,x1):Math.min(z0,z1);
  const a1 = alongX?Math.max(x0,x1):Math.max(z0,z1);
  const fx = alongX?z0:x0;
  const mk=(s,e,y0,y1,solid)=>{
    if(e-s<=1e-3) return;
    if(alongX) wallBox(s,fx,e,fx,y0,y1,solid);
    else       wallBox(fx,s,fx,e,y0,y1,solid);
  };
  if(!gap){ mk(a0,a1); return; }
  const g0=gap.c-gap.w/2, g1=gap.c+gap.w/2;
  mk(a0,g0); mk(g1,a1);
  mk(g0,g1, DOOR_H, H, false);          // 门楣（不参与碰撞）
}
// 外墙（四整面）

/* ============================================================
   地图底座 MAP —— 唯一数据源
   规则：一切"墙 / 门 / 门后空间"都从这里的数字算出来，
        任何地方都不要再自己算一遍坐标。
   ============================================================ */
const CLOSET_D = 1.45;      // 门后空间深度（从墙内表面往外）
const CLOSET_HW = 0.56;     // 门后空间半宽（★原来是 0.80，比门框还宽，两侧会从门框外露出墙板＝那条白边）
const HOLE_W   = 1.20;      // 墙上门洞宽度

function nearDoorTooClose(d, margin){
  const lists = (typeof DOORS !== "undefined" ? DOORS : []).concat(
                (typeof ROOM_DOORS !== "undefined" ? ROOM_DOORS : []),
                (typeof GLASS !== "undefined" ? GLASS : []));
  for(const q of lists){
    const qd = pathD(q.x, q.z);
    const dx = Math.abs(qd - d);
    if(Math.min(dx, RING_LEN - dx) < margin) return true;
  }
  return false;
}

const MAP = (function(){
  const faceX = HX - WALL_T/2;          // 东西墙内表面 x
  const faceZ = HZ - WALL_T/2;          // 南北墙内表面 z
  const doors = [];

  // —— 3.0 肉鸽：假门每局随机 12~18 扇，位置随机但不重叠 ——
  const N_MIN = CFG.刷新.环廊躲藏门最少, N_MAX = CFG.刷新.环廊躲藏门最多;
  const want = N_MIN + Math.floor(Math.random()*Math.max(1, N_MAX-N_MIN+1));
  const picks = [];
  let guard = 0;
  while(picks.length < want && guard++ < 6000){
    const d = 3.0 + Math.random()*(RING_LEN-6.0);
    if(cornerDist(d) < 2.6) continue;                       // 避开转角
    let bad = false;
    for(const q of picks){
      const dx = Math.abs(q - d);
      if(Math.min(dx, RING_LEN-dx) < 3.4){ bad = true; break; }
    }
    if(bad) continue;
    picks.push(d);
  }
  picks.sort(function(a,b){ return a-b; });

  for(const d of picks){
    const p = atPath(d);
    const alongX = Math.abs(p.nx) > 0.5;               // 门在东西墙上
    const sgn = alongX ? (p.nx >= 0 ? 1 : -1) : (p.nz >= 0 ? 1 : -1);
    const face = alongX ? faceX : faceZ;
    const plane = sgn * face;                          // 门平面绝对坐标
    const x = alongX ? plane : p.x;
    const z = alongX ? p.z : plane;

    // 门后空间（穿墙 + 向外延伸），用绝对 AABB 描述
    const outA = plane, outB = sgn * (face + CLOSET_D);
    const lo = Math.min(outA, outB), hi = Math.max(outA, outB);
    const box = alongX
      ? {x0:lo, x1:hi, z0:z-CLOSET_HW, z1:z+CLOSET_HW}
      : {x0:x-CLOSET_HW, x1:x+CLOSET_HW, z0:lo, z1:hi};

    doors.push({d, x, z, nx:p.nx, nz:p.nz, alongX, sgn, face, plane, box,
                hole:{ c: alongX ? z : x, w: HOLE_W }});
  }
  return { faceX, faceZ, doors };
})();
if(MAZE && MAP && MAP.doors) MAP.doors.length = 0;   // 迷宫模式不要环廊随机假门

window.MAP = MAP;

// —— 外墙：由 MAP.doors 决定在哪里开洞 ——
function outerWall(alongX, fixed, a0, a1){
  const gaps = MAP.doors.filter(d => d.alongX !== alongX && Math.abs((alongX ? d.z : d.x) - fixed) < 1.0)
                        .map(d => d.hole.c).sort((a,b)=>a-b);
  const mk=(s0,e0,y0,y1)=>{
    if(e0-s0 <= 1e-3) return;
    if(alongX) wallBox(s0,fixed,e0,fixed,y0,y1);
    else       wallBox(fixed,s0,fixed,e0,y0,y1);
  };
  let cur=a0;
  for(const g of gaps){
    const g0=g-HOLE_W/2, g1=g+HOLE_W/2;
    if(g0>cur) mk(cur,g0);
    mk(g0,g1, 2.16, H);
    cur=g1;
  }
  if(a1>cur) mk(cur,a1);
}

// ================= 迷宫模式：按 level.js 的「墙体 / 房间门」建图 =================
function buildMazeWalls(){
  const segs  = (window.LEVEL_DATA && window.LEVEL_DATA.墙体) || [];
  const doors = (window.LEVEL_DATA && window.LEVEL_DATA.房间门) || [];
  if(!segs.length) return;

  // 地图包围盒
  let mnx=1e9, mxx=-1e9, mnz=1e9, mxz=-1e9;
  for(const s of segs){
    mnx=Math.min(mnx,s.x0,s.x1); mxx=Math.max(mxx,s.x0,s.x1);
    mnz=Math.min(mnz,s.z0,s.z1); mxz=Math.max(mxz,s.z0,s.z1);
  }
  window.MAZE_BOUNDS = { x0:mnx, x1:mxx, z0:mnz, z1:mxz };

  const pad = 0.12;
  // 四面外墙
  wallRun(mnx-pad, mnz-pad, mxx+pad, mnz-pad);
  wallRun(mnx-pad, mxz+pad, mxx+pad, mxz+pad);
  wallRun(mnx-pad, mnz-pad, mnx-pad, mxz+pad);
  wallRun(mxx+pad, mnz-pad, mxx+pad, mxz+pad);

  const mk = function(x0,z0,x1,z1){
    const alongX = Math.abs(x1-x0) >= Math.abs(z1-z0);
    if(alongX) wallBox(Math.min(x0,x1), z0, Math.max(x0,x1), z0, 0, H, true);
    else       wallBox(x0, Math.min(z0,z1), x0, Math.max(z0,z1), 0, H, true);
  };

  for(const s of segs){
    // 斜墙（编辑器里可以 360° 画）：碰撞用小方块沿线段铺，视觉用旋转盒子
    const adx = s.x1 - s.x0, adz = s.z1 - s.z0;
    if(Math.abs(adx) > 0.06 && Math.abs(adz) > 0.06){
      const L = Math.hypot(adx, adz);
      const n = Math.max(1, Math.ceil(L/0.30));
      for(let k=0;k<n;k++){
        const t = (k+0.5)/n;
        const x = s.x0 + adx*t, z = s.z0 + adz*t;
        WALLS.push({ x0:x-0.17, x1:x+0.17, z0:z-0.17, z1:z+0.17 });
      }
      try{
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, H, WALL_T), wallMat);
        mesh.position.set((s.x0+s.x1)/2, H/2, (s.z0+s.z1)/2);
        mesh.rotation.y = -Math.atan2(adz, adx);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh);
      }catch(e){}
      continue;
    }
    const alongX = Math.abs(s.x1-s.x0) >= Math.abs(s.z1-s.z0);
    const a0 = alongX ? Math.min(s.x0,s.x1) : Math.min(s.z0,s.z1);
    const a1 = alongX ? Math.max(s.x0,s.x1) : Math.max(s.z0,s.z1);
    const f  = alongX ? s.z0 : s.x0;

    // 这堵墙上有没有门要开洞
    const gaps = doors.filter(function(d){
      return alongX
        ? (Math.abs(d.z - f) < 0.32 && d.x > a0-0.25 && d.x < a1+0.25)
        : (Math.abs(d.x - f) < 0.32 && d.z > a0-0.25 && d.z < a1+0.25);
    }).map(function(d){
      return { c: alongX ? d.x : d.z, w: HOLE_W };
    }).sort(function(p,q){ return p.c-q.c; });

    let cur = a0;
    for(const g of gaps){
      const g0 = g.c - g.w/2, g1 = g.c + g.w/2;
      if(g0 > cur + 1e-3) mk(alongX?cur:f, alongX?f:cur, alongX?g0:f, alongX?f:g0);
      // 门楣（不挡路）
      if(alongX) wallBox(g0, f, g1, f, DOOR_H, H, false);
      else       wallBox(f, g0, f, g1, DOOR_H, H, false);
      cur = Math.max(cur, g1);
    }
    if(a1 > cur + 1e-3) mk(alongX?cur:f, alongX?f:cur, alongX?a1:f, alongX?f:a1);
  }
}

if(!MAZE){
outerWall(true,  -HZ, -HX, HX);
outerWall(true,   HZ, -HX, HX);
outerWall(false, -HX, -HZ, HZ);
outerWall(false,  HX, -HZ, HZ);


// 内区边界：四条边，在四条走廊的口子上留空
{
  const mouthX=[[VX[0]-W/2, VX[0]+W/2],[VX[1]-W/2, VX[1]+W/2]];
  for(const z of [-IZ, IZ]){
    let cur=-IX;
    for(const m of mouthX){ wallRun(cur,z,m[0],z); cur=m[1]; }
    wallRun(cur,z, IX,z);
  }
  const mouthZ=[[HY[0]-W/2, HY[0]+W/2],[HY[1]-W/2, HY[1]+W/2]];
  for(const x of [-IX, IX]){
    let cur=-IZ;
    for(const m of mouthZ){ wallRun(x,cur,x,m[0]); cur=m[1]; }
    wallRun(x,cur,x, IZ);
  }
}
// 九个房间：四面墙，其中一面正中留门洞
for(const r of ROOMS){
  const d=r.door;
  if(r.x0 > -IX+1e-3) wallRun(r.x0,r.z0,r.x0,r.z1, d.face==='x0'?{c:r.cz,w:DOOR_W}:null);
  if(r.x1 <  IX-1e-3) wallRun(r.x1,r.z0,r.x1,r.z1, d.face==='x1'?{c:r.cz,w:DOOR_W}:null);
  if(r.z0 > -IZ+1e-3) wallRun(r.x0,r.z0,r.x1,r.z0, d.face==='z0'?{c:r.cx,w:DOOR_W}:null);
  if(r.z1 <  IZ-1e-3) wallRun(r.x0,r.z1,r.x1,r.z1, d.face==='z1'?{c:r.cx,w:DOOR_W}:null);
}
}
if(MAZE) buildMazeWalls();


// 墙脚的踢脚线（一圈，加深轮廓）
if(!MAZE) for(const s of PATH.segs){
  const mx=s.x+s.dx*s.len/2, mz=s.z+s.dz*s.len/2;
  for(const sgn of [-1,1]){
    const ox=s.dz*(W/2-.055)*sgn, oz=-s.dx*(W/2-.055)*sgn;
    const m=new THREE.Mesh(new THREE.BoxGeometry(Math.abs(s.dx)*s.len+Math.abs(s.dz)*.11,
                                                 .09,
                                                 Math.abs(s.dz)*s.len+Math.abs(s.dx)*.11), darkMat);
    m.position.set(mx+ox, .045, mz+oz);
    m.receiveShadow=true; scene.add(m);
  }
}

/* ---------- 4c. 墙上的竖向接缝板 ---------- */
if(!MAZE){
  const n=Math.floor(RING_LEN/CELL);
  const im=new THREE.InstancedMesh(new THREE.BoxGeometry(.07,H,.10), darkMat, n*2);
  const m4=new THREE.Matrix4(), q=new THREE.Quaternion(), e=new THREE.Euler(),
        pv=new THREE.Vector3(), sv=new THREE.Vector3(1,1,1);
  let k=0;
  for(let i=0;i<n;i++){
    const p=atPath(i*CELL);
    const alongX=Math.abs(p.dx)>0.5;
    e.set(0, alongX?Math.PI/2:0, 0); q.setFromEuler(e);
    for(const sgn of [-1,1]){
      pv.set(p.x + p.nx*(W/2-.035)*sgn, H/2, p.z + p.nz*(W/2-.035)*sgn);
      m4.compose(pv,q,sv); im.setMatrixAt(k++, m4);
    }
  }
  im.instanceMatrix.needsUpdate=true; im.receiveShadow=true;
  scene.add(im);
}

/* ---------- 5. 门（装在外墙上） ---------- */
const DOORS=[];
const DOOR_HIT=[];          // 准心射线打这些
// 门后的"柜子内部"：靠贴图造成纵深，开门时能看见里面
const closetTex = (()=>{
  const W2=256, H2=512;
  const c=document.createElement('canvas'); c.width=W2; c.height=H2;
  const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,0,H2);
  g.addColorStop(0,'#0a1014'); g.addColorStop(.55,'#0d1418'); g.addColorStop(1,'#05080a');
  x.fillStyle=g; x.fillRect(0,0,W2,H2);
  x.fillStyle='rgba(58,66,72,.45)'; x.fillRect(10,H2*0.42,W2-20,7);   // 一层隔板
  x.fillStyle='rgba(0,0,0,.5)';     x.fillRect(10,H2*0.42+7,W2-20,10); // 隔板下的阴影
  x.fillStyle='rgba(92,100,104,.16)'; x.fillRect(24,H2*0.16,44,120);   // 挂着的布
  x.fillStyle='rgba(0,0,0,.45)'; x.fillRect(0,H2*0.74,W2,H2*0.26);     // 底部更暗
  const r2=mulberry32(77);
  for(let i=0;i<160;i++){ x.fillStyle='rgba(0,0,0,'+(.04+r2()*.12)+')';
    x.fillRect(r2()*W2, r2()*H2, 2+r2()*9, 1+r2()*5); }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=4; return t;
})();
function addDoorAt(px,pz,rotY,openAngle){
  const g=new THREE.Group(); g.position.set(px,0,pz); g.rotation.y=rotY; scene.add(g);
  const dw=1.14, dh=2.06, fw=.14;   // ★ 门框要盖住墙洞（墙洞宽 1.20），原来门框只有 1.12 宽，两侧各露 4 厘米墙断面＝那条白边
  const addBox=(w,h,d,mat,x,y,z)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; g.add(m); return m; };
  // 门框做薄做窄，不再像一根凸出来的柱子
  const f1=addBox(fw, dh+fw, .10, darkMat, -(dw+fw)/2+.01, (dh+fw)/2, 0);
  const f2=addBox(fw, dh+fw, .10, darkMat,  (dw+fw)/2-.01, (dh+fw)/2, 0);
  const f3=addBox(dw+fw, fw, .10, darkMat, 0, dh+fw/2, 0);
  const f4=addBox(dw+fw, fw, .10, darkMat, 0, fw/2, 0);
  // —— 门洞内衬（把墙洞和门框之间的缝全包住）——
  const lining = new THREE.MeshStandardMaterial({color:0x14181c, roughness:.95});
  const L=(w,h,d,x,y,z)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),lining);
    m.position.set(x,y,z); m.receiveShadow=true; g.add(m); return m; };
  const HD = WALL_T + 0.14;                 // 内衬深度＝墙厚+余量
  L(.05, 2.18, HD, -(HOLE_W/2)-.005, 1.09, .06);   // 左
  L(.05, 2.18, HD,  (HOLE_W/2)+.005, 1.09, .06);   // 右
  L(HOLE_W+.10, .05, HD, 0, 2.175, .06);           // 上
  L(HOLE_W+.10, .05, HD, 0, .005, .06);            // 下

  // 【2.0 修复】这里原来贴着一块整扇门大小（1.04×2.08）的浅色假墙，隔着栅栏窗看就像
  //   另一扇旧门叠在新门后面。现在门后是真空间，这块板已经没用了，删除。

  // 门板挂在合页上
  const hinge=new THREE.Group();
  hinge.position.set(-dw/2+.04, dh/2, .12);
  hinge.rotation.y = openAngle;
  g.add(hinge);
  // 门板 = 四块实心板 + 中间一个观察窗（监狱式）
  const SW=dw-.06, SH=dh-.04, TH=.05;
  const WW=.62, WH=.62, WY=.52;
  const part=(w,h,x,y)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,TH), doorMat);
  // ★ 2.0 修复：门板要挂在合页「右边」，原来以合页为中心摆，整块门板左移半个门宽（0.48 米）
    m.position.set(x+SW/2,y,0); m.castShadow=true; m.receiveShadow=true; hinge.add(m); return m;
  };
  const topH = SH/2 - (WY+WH/2), botH = (WY-WH/2) + SH/2;
  const pTop = part(SW, topH, 0,  (SH/2)-topH/2);
  part(SW, botH, 0, -(SH/2)+botH/2);
  part((SW-WW)/2, WH, -(SW+WW)/4, WY);
  part((SW-WW)/2, WH,  (SW+WW)/4, WY);
  const mWin=new THREE.MeshStandardMaterial({color:0x2b323a, roughness:.45, metalness:.8});
  const mBar=new THREE.MeshStandardMaterial({color:0xc6cbd2, roughness:.62, metalness:.28});   // 栅栏：浅灰白
  for(const yy of [WY+WH/2, WY-WH/2]){
    const e=new THREE.Mesh(new THREE.BoxGeometry(WW+.05,.035,TH+.02), mWin);
    e.position.set(SW/2,yy,0); hinge.add(e);
  }
  for(const xx of [-WW/2, WW/2]){
    const e=new THREE.Mesh(new THREE.BoxGeometry(.035,WH+.05,TH+.02), mWin);
    e.position.set(xx+SW/2,WY,0); hinge.add(e);
  }
  for(let i=1;i<=4;i++){
    const bar=new THREE.Mesh(new THREE.BoxGeometry(.022,WH,.022), mBar);
    bar.position.set(SW/2-WW/2+(i/5)*WW, WY, 0); hinge.add(bar);
  }
  const slab = pTop;
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.035,10,8), metalMat);
  knob.position.set(SW-.13, -0.10, .055); hinge.add(knob);

  // 登记：hinge 可转，鬼以后也能开门
  DOOR_HIT.push(f1,f2,f3,f4,slab);
  DOORS.push({x:px, z:pz, rotY, hinge, slab, root:g, open:openAngle, target:openAngle, busy:0});
}
// —— 外围环廊的门：每局随机 12~18 扇，位置随机（用来躲藏）——
{
  // 门 = MAP.doors（唯一数据源：门位 / 门洞 / 门后空间 三者永远对齐）
  for(const md of MAP.doors){
    const p = atPath(md.d);
    addDoorAt(md.x, md.z, Math.atan2(-p.nx,-p.nz), 0);
  }
  // 迷宫模式：假门/躲藏门只认编辑器数据（25 扇）
  if(MAZE){
    for(const hd of (window.LEVEL_DATA.躲藏门 || [])){
      let nx = hd.nx, nz = hd.nz;
      if(nx === undefined || nz === undefined){
        const r = hd.rot || 0;
        nx = Math.sin(r); nz = Math.cos(r);
      }
      const L = Math.hypot(nx, nz) || 1;
      nx /= L; nz /= L;
      addDoorAt(hd.x, hd.z, Math.atan2(-nx, -nz), 0);
    }
  }
}

// —— 房间门：门框 + 能开合的门板（2.0 先做成普通的门，「真门」以后再说）——
function addRoomDoor(d){
  const g=new THREE.Group(); g.position.set(d.x,0,d.z); g.rotation.y=d.rotY; scene.add(g);
  const fw=.07, dh=DOOR_H, dw=DOOR_W;
  const addBox=(w,h,dd,mat,x,y,z)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,dd),mat);
    m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; g.add(m); return m; };
  addBox(fw, dh+fw, .22, darkMat, -(dw+fw)/2, (dh+fw)/2, 0);
  addBox(fw, dh+fw, .22, darkMat,  (dw+fw)/2, (dh+fw)/2, 0);
  addBox(dw+fw, fw, .22, darkMat, 0, dh+fw/2, 0);
  const hinge=new THREE.Group();
  hinge.position.set(-dw/2+.04, dh/2, 0);
  g.add(hinge);
  const slab=new THREE.Mesh(new THREE.BoxGeometry(dw-.06, dh-.04, .055), doorMat);
  slab.position.set(dw/2-.03, 0, 0); slab.castShadow=true; slab.receiveShadow=true; hinge.add(slab);
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.035,10,8), metalMat);
  knob.position.set(dw-.16,0,.06); hinge.add(knob);
  d.hinge=hinge; d.slab=slab; d.target=0; d.t=0; d.open=false;
  // 关着的时候挡路；开了就把碰撞盒挪到天边
  const half=dw/2, th=.16;
  const alongZ = (d.face==='x0'||d.face==='x1');
  d.col = alongZ ? {x0:d.x-th, x1:d.x+th, z0:d.z-half, z1:d.z+half}
                 : {x0:d.x-half, x1:d.x+half, z0:d.z-th, z1:d.z+th};
  WALLS.push(d.col);
}
for(const d of ROOM_DOORS) addRoomDoor(d);

// 房间门的开合动画（目标角度 -1.35 弧度 ≈ 77°）
function setRoomDoor(d, open){
  if(d.open===open) return;
  d.open=open;
  d.target = open ? -1.35 : 0;
  if(d.col){
    if(open){ d.col.x0=-9999; d.col.x1=-9999; d.col.z0=-9999; d.col.z1=-9999; }
    else{
      const half=DOOR_W/2, th=.16;
      const alongZ = (d.face==='x0'||d.face==='x1');
      if(alongZ){ d.col.x0=d.x-th; d.col.x1=d.x+th; d.col.z0=d.z-half; d.col.z1=d.z+half; }
      else      { d.col.x0=d.x-half; d.col.x1=d.x+half; d.col.z0=d.z-th; d.col.z1=d.z+th; }
    }
  }
}
function updateRoomDoors(dt){
  for(const d of ROOM_DOORS){
    if(!d.hinge) continue;
    if(Math.abs(d.hinge.rotation.y - d.target) > 0.002){
      d.hinge.rotation.y += (d.target - d.hinge.rotation.y) * Math.min(1, dt*7);
    }
  }
}


/* ---------- 5b. 玻璃落地门（2 扇，横跨走廊，关门时挡路）---------- */
const GLASS=[];
function makeGlassDoor(d){
  const p = atPath(d);
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  g.rotation.y = Math.atan2(p.dx, p.dz);        // 本地 x 横跨走廊
  scene.add(g);

  const mFrame = new THREE.MeshStandardMaterial({color:0x2b3238, roughness:.42, metalness:.75});
  const mGlass = new THREE.MeshPhysicalMaterial({
    color:0x9fc0c0, transparent:true, opacity:.14, roughness:.08,
    metalness:0, side:THREE.DoubleSide, depthWrite:false
  });
  const mEdge  = new THREE.MeshStandardMaterial({color:0x8f9a9e, roughness:.3, metalness:.9});

  const HW = W/2;                                  // 走廊半宽
  const H  = 2.42;                                 // 门高（落地到顶）
  // 门框：两侧立柱 + 上横梁 + 地轨
  for(const sx of [-1,1]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(.10,H,.16), mFrame);
    post.position.set(sx*(HW-.05), H/2, 0); post.castShadow=true; post.receiveShadow=true; g.add(post);
  }
  const lintel=new THREE.Mesh(new THREE.BoxGeometry(W,.12,.16), mFrame);
  lintel.position.set(0, H-.06, 0); lintel.castShadow=true; g.add(lintel);
  const track=new THREE.Mesh(new THREE.BoxGeometry(W,.04,.16), mFrame);
  track.position.set(0,.02,0); g.add(track);

  // 两片玻璃（关着时合拢在中间）
  const pW=(W-.20)/2, pH=H-.20;
  const panels=[];
  for(const sx of [-1,1]){
    const pan=new THREE.Group();
    const glass=new THREE.Mesh(new THREE.BoxGeometry(pW,pH,.02), mGlass);
    glass.position.set(sx*pW/2, 0, 0); pan.add(glass);
    // 玻璃四周的金属压边
    for(const yy of [-1,1]){
      const e=new THREE.Mesh(new THREE.BoxGeometry(pW,.035,.05), mEdge);
      e.position.set(sx*pW/2, yy*pH/2, 0); pan.add(e);
    }
    for(const xx of [-1,1]){
      const e=new THREE.Mesh(new THREE.BoxGeometry(.035,pH,.05), mEdge);
      e.position.set(sx*pW/2 + xx*pW/2, 0, 0); pan.add(e);
    }
    // 把手
    const hd=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,.34,8), mEdge);
    hd.position.set(sx*.18, 0, .07); hd.rotation.z=Math.PI/2; pan.add(hd);
    pan.position.set(0, H/2-.02, 0);
    g.add(pan); panels.push(pan);
  }

  // 关门时挡路（碰撞盒横跨走廊）
  const alongX = Math.abs(p.dx) > Math.abs(p.dz);
  const box = alongX
    ? {x0:p.x-.09, x1:p.x+.09, z0:p.z-HW-.35, z1:p.z+HW+.35}   // 伸进墙里，旁边绕不过去
    : {x0:p.x-HW-.35, x1:p.x+HW+.35, z0:p.z-.09, z1:p.z+.09};

  const gd={d, x:p.x, z:p.z, open:false, t:0, panels, box, rotY:g.rotation.y};
  WALLS.push(box);                                // 现在就挡着
  GLASS.push(gd);
  return gd;
}
  // 玻璃门：固定选点，避开所有门（真门 / 躲藏门），两扇之间留出隔离段
{
  const segs = PATH.segs.slice().sort((a,b)=>b.len-a.len);
  let picked = null;

  for(const seg of segs){
    const valid = [];
    for(let off=2.0; off<=seg.len-2.0; off+=0.5){
      const d = seg.start + off;
      let ok = true;
      for(const q of DOORS.concat(ROOM_DOORS)){
        const qd = pathD(q.x, q.z);
        const dx = Math.abs(qd - d);
        if(Math.min(dx, RING_LEN - dx) < 3.0){ ok = false; break; }
      }
      if(ok && cornerDist(d) > 3.2) valid.push(d);
    }
    // 找这一段的两个最远点（至少 8 米）
    if(valid.length >= 2){
      const a = valid[0], b = valid[valid.length-1];
      if(Math.abs(b-a) >= 8){ picked = [a,b]; break; }
    }
  }

  if(picked){
    makeGlassDoor(picked[0]);
    makeGlassDoor(picked[1]);
    window.GLASS_SEG = {a:picked[0], b:picked[1]};
    console.log("[GLASS] 固定位置", picked[0].toFixed(1), picked[1].toFixed(1));
  } else {
    console.warn("[GLASS] 找不到可放玻璃门的直线段");
  }
}

function toggleGlass(gd){
  gd.open = !gd.open;
  const idx = WALLS.indexOf(gd.box);
  if(gd.open){ if(idx>=0) WALLS.splice(idx,1); }      // 开门：可以过
  else if(idx<0){ WALLS.push(gd.box); }
  // 玻璃滑动的声音
  try{ Sound.slide(); }catch(e){}
}

function updateGlass(dt){
  for(const gd of GLASS){
    const want = gd.open ? 1 : 0;
    gd.t += (want - gd.t) * Math.min(1, dt*7);
    const k = gd.t * (W/2 - .12);                  // 往两侧滑开
    gd.panels[0].position.x = -k;
    gd.panels[1].position.x =  k;
  }
}

// 两点之间有没有墙挡着（只查真正的墙，不查家具和门自己）
function hasLineOfSight(x1, z1, x2, z2, skipBox){
  const dx = x2-x1, dz = z2-z1;
  const len = Math.hypot(dx, dz);
  if(len < 1e-3) return true;
  const steps = Math.max(2, Math.ceil(len/0.18));
  for(let i=1;i<steps;i++){
    const t = i/steps;
    const px = x1 + dx*t, pz = z1 + dz*t;
    for(const w of WALLS){
      if(w.top != null) continue;                  // 家具不算遮挡
      if(skipBox && w === skipBox) continue;       // 门自己不算
      if(px > w.x0 && px < w.x1 && pz > w.z0 && pz < w.z1) return false;
    }
  }
  return true;
}
function nearestGlass(){
  camera.getWorldDirection(_aimDir);
  // 只看水平朝向：抬头/低头不该影响开门判定
  const alen = Math.hypot(_aimDir.x, _aimDir.z) || 1e-3;
  const ax = _aimDir.x/alen, az = _aimDir.z/alen;
  const ex = camera.position.x, ez = camera.position.z;
  let best=null, bs=-1;
  for(const gd of GLASS){
    const dx=gd.x-ex, dz=gd.z-ez;
    const dist=Math.hypot(dx,dz);
    if(dist>3.2) continue;                          // 太远够不着
    const dot=(dx*ax + dz*az)/(dist||1e-3);
    // 必须正对着门（贴到 1.2 米内才稍微放宽）
    const need = dist < 1.2 ? 0.55 : 0.80;
    if(dot < need) continue;
    // 中间隔着墙 → 不算（防止隔房间遥控）
    if(!hasLineOfSight(ex, ez, gd.x, gd.z, gd.box)) continue;
    if(dot>bs){ bs=dot; best=gd; }
  }
  return best;
}

/* ---------- 5d. 门后空间（数据来自 MAP.box）---------- */
const mCloset = new THREE.MeshBasicMaterial({color:0x000000});  // 纯黑，不吃光，绝不发白
const mFloorC = new THREE.MeshBasicMaterial({color:0x000000});  // 纯黑
const mGrate  = new THREE.MeshStandardMaterial({color:0x2b323a, roughness:.45, metalness:.8});

for(const md of MAP.doors){
  const b = md.box;
  const cx=(b.x0+b.x1)/2, cz=(b.z0+b.z1)/2;
  const sx=b.x1-b.x0, sz=b.z1-b.z0;
  const add=(w,h,d,px,py,pz,mat)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
    m.position.set(px,py,pz); m.receiveShadow=true; scene.add(m); return m;
  };
  const CH = 2.10, T = 0.07;
  add(sx, .06, sz, cx, .03, cz, mFloorC);                 // 地板
  add(sx, .06, sz, cx, CH, cz, mCloset);                  // 顶
  // 五个面按外层坐标摆放
  const outerX = md.alongX ? (md.sgn>0 ? b.x1 : b.x0) : null;
  const outerZ = md.alongX ? null : (md.sgn>0 ? b.z1 : b.z0);
  if(md.alongX){
    add(T, CH, sz, outerX + (md.sgn>0?-T/2:T/2), CH/2, cz, mCloset);
    add(sx, CH, T, cx, CH/2, b.z0 + T/2, mCloset);
    add(sx, CH, T, cx, CH/2, b.z1 - T/2, mCloset);
    WALLS.push({x0:b.x0, x1:b.x1, z0:b.z0, z1:b.z0+T}, {x0:b.x0, x1:b.x1, z0:b.z1-T, z1:b.z1},
               {x0:Math.min(outerX,outerX+md.sgn*T), x1:Math.max(outerX,outerX+md.sgn*T), z0:b.z0, z1:b.z1});
  } else {
    add(sx, CH, T, cx, CH/2, outerZ + (md.sgn>0?-T/2:T/2), mCloset);
    add(T, CH, sz, b.x0 + T/2, CH/2, cz, mCloset);
    add(T, CH, sz, b.x1 - T/2, CH/2, cz, mCloset);
    WALLS.push({x0:b.x0, x1:b.x0+T, z0:b.z0, z1:b.z1}, {x0:b.x1-T, x1:b.x1, z0:b.z0, z1:b.z1},
               {x0:b.x0, x1:b.x1, z0:Math.min(outerZ,outerZ+md.sgn*T), z1:Math.max(outerZ,outerZ+md.sgn*T)});
  }
  // 门口挡墙（关着门进不去）
  if(md.alongX) WALLS.push({x0:md.x-.05, x1:md.x+.05, z0:md.z-HOLE_W/2, z1:md.z+HOLE_W/2});
  else          WALLS.push({x0:md.x-HOLE_W/2, x1:md.x+HOLE_W/2, z0:md.z-.05, z1:md.z+.05});
}
/* ---------- 6. 天花板：灯 + 光锥 + 管道 ---------- */
const lightPts=[];
const coneMat=new THREE.MeshBasicMaterial({
  color:0xb8ccd4, transparent:true, opacity:.048,
  blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
});
// 灯位：环廊 + 四条内区走廊，全部按中心线采样
const NET=[];
const LAMPS=[];
if(MAZE){
  // 迷宫模式：在可走区域按 6.4 米网格撒灯，灯绝不落在墙里
  const b = window.MAZE_BOUNDS || {x0:-28,x1:28,z0:-22,z1:22};
  const freeAt = function(x,z){
    for(const w of WALLS){
      if(x > w.x0-1.0 && x < w.x1+1.0 && z > w.z0-1.0 && z < w.z1+1.0) return false;
    }
    return true;
  };
  for(let x=b.x0+3.2; x<=b.x1-3.2; x+=6.4){
    for(let z=b.z0+3.2; z<=b.z1-3.2; z+=6.4){
      if(freeAt(x,z)) LAMPS.push({x:x, z:z, rotY:0});
    }
  }
} else {
  for(const s of PATH.segs) NET.push(s);
  for(const x of VX) NET.push({x, z:-IZ, dx:0, dz:1, len:2*IZ});
  for(const z of HY) NET.push({x:-IX, z, dx:1, dz:0, len:2*IX});
  for(const s of NET){
    for(let d=2.6; d<s.len-1.2; d+=6.4){
      LAMPS.push({x:s.x+s.dx*d, z:s.z+s.dz*d, rotY: Math.abs(s.dx)>0.5 ? Math.PI/2 : 0});
    }
  }
}
for(const p of LAMPS){
  const rotY = p.rotY || 0;
  const slot=new THREE.Mesh(new THREE.BoxGeometry(1.18,.07,.34), darkMat);
  slot.position.set(p.x, H-.04, p.z); slot.rotation.y=rotY; scene.add(slot);

  const lit = R()<(MAZE?0.72:0.5);
  const panelMat=new THREE.MeshStandardMaterial({
    color: lit?0xdfe6ee:0x30343c, emissive: lit?0xf2f6ff:0x000000,
    emissiveIntensity: lit?1.4:0, roughness:.5
  });
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(1.0,.26), panelMat);
  panel.rotation.set(Math.PI/2, 0, rotY);
  panel.position.set(p.x, H-.085, p.z);
  scene.add(panel);

  if(lit){
    const pl=new THREE.PointLight(0xc6dce6, MAZE?78:56, MAZE?16:13, 1.85);
    pl.position.set(p.x+rr(-.16,.16), H-.24, p.z+rr(-.16,.16));
    pl.userData.base=62;
    scene.add(pl); lightPts.push(pl);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(.78, H-.16, 14, 1, true), coneMat);
    cone.position.set(pl.position.x, (H-.16)/2, pl.position.z);
    scene.add(cone);
  }
}
// 顶部两根管道：沿四条边各拉一段，转角用吊顶盒子盖住接缝
for(const s of PATH.segs){
  const mx=s.x+s.dx*s.len/2, mz=s.z+s.dz*s.len/2;
  for(const sgn of [-1,1]){
    const ox=s.dz*0.95*sgn, oz=-s.dx*0.95*sgn;
    const g=new THREE.CylinderGeometry(.075,.075,s.len+.3,12,1,true);
    const m=new THREE.Mesh(g, metalMat);
    m.position.set(mx+ox, H-.30, mz+oz);
    if(Math.abs(s.dx)>0.5) m.rotation.z=Math.PI/2; else m.rotation.x=Math.PI/2;
    m.castShadow=true; scene.add(m);
  }
}
for(const c of [[CX,-CZ],[CX,CZ],[-CX,CZ],[-CX,-CZ]]){
  box(2.3,.22,2.3, darkMat, [c[0], H-.22, c[1]]);
}
// 垂下来的断线缆
for(let i=0;i<14;i++){
  const p=atPath(rr(2,RING_LEN-2));
  const off=rr(-1.0,1.0), h=rr(.18,.62);
  cyl(.012,.012,h, darkMat, [p.x+p.nx*off, H-.06-h/2, p.z+p.nz*off]);
}


// —— 物件用的真材质（不再是纯色块）——
function brushedMetal(seed, base){
  const c=canvasOf(512), x=c.getContext('2d'), r=mulberry32(seed);
  const b=base||[142,148,154];
  x.fillStyle='rgb('+b[0]+','+b[1]+','+b[2]+')'; x.fillRect(0,0,512,512);
  for(let i=0;i<3200;i++){                                   // 拉丝
    const y=r()*512, l=20+r()*260, a=.015+r()*.05;
    x.strokeStyle = r()<.5 ? 'rgba(255,255,255,'+a+')' : 'rgba(0,0,0,'+a*1.6+')';
    x.beginPath(); x.moveTo(r()*512, y); x.lineTo(r()*512+l, y); x.stroke();
  }
  for(let i=0;i<48;i++){                                     // 锈斑/污渍
    const px=r()*512, py=r()*512, rad=14+r()*80;
    const g=x.createRadialGradient(px,py,0,px,py,rad);
    g.addColorStop(0,'rgba(58,44,32,'+(.06+r()*.18)+')');
    g.addColorStop(1,'rgba(58,44,32,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,rad,0,7); x.fill();
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8;
  return t;
}
function fabricTex(seed){
  const c=canvasOf(512), x=c.getContext('2d'), r=mulberry32(seed);
  x.fillStyle='#787b76'; x.fillRect(0,0,512,512);
  for(let i=0;i<9000;i++){                                   // 布纹
    x.fillStyle='rgba('+(r()<.5?255:0)+','+(r()<.5?255:0)+','+(r()<.5?255:0)+','+(.02+r()*.05)+')';
    x.fillRect(r()*512, r()*512, 2, 1);
  }
  for(let i=0;i<26;i++){                                     // 霉/污
    const px=r()*512, py=r()*512, rad=20+r()*90;
    const g=x.createRadialGradient(px,py,0,px,py,rad);
    g.addColorStop(0,'rgba(40,34,26,'+(.10+r()*.22)+')');
    g.addColorStop(1,'rgba(40,34,26,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,rad,0,7); x.fill();
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8;
  return t;
}
const mSteel = new THREE.MeshStandardMaterial({
  map:brushedMetal(11), color:0xffffff, roughness:.34, metalness:.92
});
const mSteelDark = new THREE.MeshStandardMaterial({
  map:brushedMetal(12,[92,96,100]), color:0xffffff, roughness:.46, metalness:.85
});
const mFabric = new THREE.MeshStandardMaterial({
  map:fabricTex(13), color:0xa9ada6, roughness:.97, metalness:0
});
const mFabricDirty = new THREE.MeshStandardMaterial({
  map:fabricTex(14), color:0x6f736e, roughness:.98, metalness:0
});

/* ---------- 7. 杂物 ---------- */
function wheelchair(x,z,ry){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry; scene.add(g);
  const add=(m,px,py,pz,rx,rz)=>{m.position.set(px,py,pz);
    if(rx)m.rotation.x=rx; if(rz)m.rotation.z=rz; m.castShadow=true; g.add(m); return m;};
  const big=new THREE.TorusGeometry(.30,.032,8,20);
  add(new THREE.Mesh(big,metalMat), -.30,.32,0, 0, 0);
  add(new THREE.Mesh(big,metalMat),  .30,.32,0, 0, 0);
  const small=new THREE.TorusGeometry(.10,.022,6,14);
  add(new THREE.Mesh(small,metalMat), -.26,.11,.34, Math.PI/2, 0);
  add(new THREE.Mesh(small,metalMat),  .26,.11,.34, Math.PI/2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(.52,.055,.48),mFabricDirty), 0,.52,0);
  add(new THREE.Mesh(new THREE.BoxGeometry(.52,.46,.055),mFabricDirty), 0,.76,-.22);
  add(new THREE.Mesh(new THREE.BoxGeometry(.05,.42,.05),metalMat), -.26,.68,-.10);
  add(new THREE.Mesh(new THREE.BoxGeometry(.05,.42,.05),metalMat),  .26,.68,-.10);
  return g;
}
function gurney(x,z,ry){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry; scene.add(g);
  const add=(geo,mat,px,py,pz,rx,rz)=>{ const m=new THREE.Mesh(geo,mat);
    m.position.set(px,py,pz); if(rx)m.rotation.x=rx; if(rz)m.rotation.z=rz;
    m.castShadow=true; m.receiveShadow=true; g.add(m); return m; };

  // 床垫 + 包边（布纹）
  add(new THREE.BoxGeometry(.80,.11,1.86), mFabric,      0,.735,0);
  add(new THREE.BoxGeometry(.86,.055,1.92), mFabricDirty, 0,.672,0);

  // 床板（不锈钢）
  add(new THREE.BoxGeometry(.88,.035,1.94), mSteel, 0,.640,0);

  // 四条腿 + 横撑
  for(const dx of [-.38,.38]) for(const dz of [-.86,.86])
    add(new THREE.CylinderGeometry(.021,.021,.56,8), mSteel, dx,.34,dz);
  for(const dz of [-.86,.86])
    add(new THREE.CylinderGeometry(.017,.017,.80,8), mSteelDark, 0,.20,dz, 0, Math.PI/2);
  for(const dx of [-.38,.38])
    add(new THREE.CylinderGeometry(.017,.017,.80,8), mSteelDark, dx,.20,0, Math.PI/2, 0);

  // 四个脚轮
  for(const dx of [-.38,.38]) for(const dz of [-.86,.86]){
    add(new THREE.CylinderGeometry(.058,.058,.032,14), mSteelDark, dx,.058,dz, 0, Math.PI/2);
    add(new THREE.CylinderGeometry(.020,.020,.05,8),   mSteel,     dx,.045,dz, 0, Math.PI/2);
  }

  // 下层置物架（让下半身不再"空到底"）
  add(new THREE.BoxGeometry(.70,.018,1.52), mSteelDark, 0,.30,0);
  add(new THREE.CylinderGeometry(.012,.012,.70,6), mSteelDark, 0,.30,-.76, 0, Math.PI/2);
  add(new THREE.CylinderGeometry(.012,.012,.70,6), mSteelDark, 0,.30, .76, 0, Math.PI/2);
  // 四角的防撞胶垫
  for(const dx of [-.43,.43]) for(const dz of [-.95,.95])
    add(new THREE.BoxGeometry(.045,.09,.045), mFabricDirty, dx,.66,dz);

  // 两侧护栏
  for(const dx of [-.43,.43]){
    add(new THREE.CylinderGeometry(.013,.013,1.42,7), mSteel, dx,.86,0, Math.PI/2, 0);
    for(const dz of [-.62,0,.62])
      add(new THREE.CylinderGeometry(.011,.011,.22,7), mSteel, dx,.75,dz);
  }

  g.userData.gurneyTop = true;      // 血渍稍后再补（血贴图在后面才创建）
}

const warnTex=(()=>{
  const c=canvasOf(128), x=c.getContext('2d');
  x.fillStyle='#c9c2a6'; x.fillRect(0,0,128,128);
  x.fillStyle='#7d1b16'; x.font='bold 58px sans-serif'; x.textAlign='center';
  x.fillText('危',64,62); x.fillText('险',64,116);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
})();

function wallBoxAt(px,pz,rotY){
  const g=new THREE.Group(); g.position.set(px,0,pz); g.rotation.y=rotY; scene.add(g);
  const add=(w,h,d,mat,x,y,z)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; g.add(m); return m; };
  add(.26,.36,.14, darkMat, 0,1.35,.07);
  add(.30,.02,.18, metalMat, 0,1.18,.09);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(.2,.2),
    new THREE.MeshStandardMaterial({map:warnTex, emissive:0x331008, emissiveIntensity:.35, roughness:.9}));
  sign.position.set(0,1.72,.16); g.add(sign);
}
for(let i=0;i<10;i++){
  let d=0, ok=false;
  for(let k=0;k<40;k++){
    d = safeD(1.0);
    const clash = DOORS.some(dr=>{
      const q = pathD(dr.x, dr.z), dx = Math.abs(q-d);
      return Math.min(dx, RING_LEN-dx) < 1.9;        // 离门太近就换个位置
    });
    if(!clash){ ok=true; break; }
  }
  if(!ok) continue;
  const p=atPath(d);
  wallBoxAt(p.x + p.nx*(W/2-.07), p.z + p.nz*(W/2-.07), Math.atan2(-p.nx,-p.nz));
}
// 轮椅 / 推床
for(let i=0;i<4;i++){
  const p=atPath(rr(6,RING_LEN-6));
  const off=rr(-.75,.75);
  const x=p.x+p.nx*off, z=p.z+p.nz*off;
  const yaw=Math.atan2(p.dx,p.dz)+rr(-.5,.5);
  if(i%2===0){ wheelchair(x,z,yaw); addPropBox(x, z, 0.50, 0.42); }   // 跳过去
  else       { gurney(x,z,yaw);      addPropBox(x, z, 0.62, 0.80); }   // 跳过去
}
// 地上的杂物（58 件合并成 2 次绘制调用）
const debrisMats=[
  new THREE.MeshStandardMaterial({map:grime({base:[118,113,101],seed:31,noise:26,drips:16}), roughness:.95}),
  new THREE.MeshStandardMaterial({map:grime({base:[96,93,86],  seed:33,noise:22,drips:14}), roughness:.95})
];
{
  const per=29;
  const geo=new THREE.BoxGeometry(1,1,1);
  const m4=new THREE.Matrix4(), q=new THREE.Quaternion(), eu=new THREE.Euler(),
        pv=new THREE.Vector3(), sv=new THREE.Vector3();
  for(let g=0; g<2; g++){
    const im=new THREE.InstancedMesh(geo, debrisMats[g], per);
    for(let i=0;i<per;i++){
      const p=atPath(rr(2,RING_LEN-2));
      const off=rr(-(W/2-.30), W/2-.30);
      const sz=rr(.05,.20);
      pv.set(p.x+p.nx*off, sz*.4, p.z+p.nz*off);
      sv.set(sz*rr(1,2.6), sz*rr(.6,1.6), sz*rr(1,2.6));
      eu.set(rr(-.4,.4), rr(0,3.14), rr(-.4,.4)); q.setFromEuler(eu);
      m4.compose(pv,q,sv); im.setMatrixAt(i,m4);
    }
    im.instanceMatrix.needsUpdate=true; im.receiveShadow=true;
    scene.add(im);
  }
}
// 地上的污渍（软边渐变贴图）
{
  const c=canvasOf(256), x=c.getContext('2d');
  const g=x.createRadialGradient(128,128,4,128,128,126);
  g.addColorStop(0,   'rgba(5,5,7,.95)');
  g.addColorStop(.45, 'rgba(5,5,7,.72)');
  g.addColorStop(.78, 'rgba(5,5,7,.28)');
  g.addColorStop(1,   'rgba(5,5,7,0)');
  x.fillStyle=g; x.fillRect(0,0,256,256);
  const stainTex=new THREE.CanvasTexture(c);
  stainTex.colorSpace=THREE.SRGBColorSpace; stainTex.anisotropy=8;
  const stainMat=new THREE.MeshBasicMaterial({
    map:stainTex, transparent:true, depthWrite:false, opacity:.9
  });
  for(let i=0;i<14;i++){
    const p=atPath(rr(2,RING_LEN-2));
    const off=rr(-1.1,1.1);
    const sz=rr(.8,2.4);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(sz,sz), stainMat);
    m.rotation.x=-Math.PI/2; m.rotation.z=rr(0,3.14);
    m.position.set(p.x+p.nx*off, .012, p.z+p.nz*off);
    scene.add(m);
  }
}



// 沿路到最近转角的距离（转角处墙是断开的，贴花放那儿会探出去）
function cornerDist(d){
  let best=1e9;
  for(const seg of PATH.segs){
    best=Math.min(best, Math.abs(d-seg.start), Math.abs(d-(seg.start+seg.len)));
  }
  const m=((d%PATH.total)+PATH.total)%PATH.total;
  best=Math.min(best, Math.abs(m-PATH.total), Math.abs(m));
  return best;
}
// 取一个"离转角足够远"的随机位置
function safeD(margin){
  for(let i=0;i<40;i++){
    const d=((rr(1,RING_LEN-1)%RING_LEN)+RING_LEN)%RING_LEN;
    if(cornerDist(d) > margin) return d;
  }
  return RING_LEN*0.25;                 // 兜底
}

/* ---------- 7b. 血迹：手掌印 / 飞溅 / 下滑痕 / 地上拖痕 ---------- */
// 全部 canvas 现画。做法：先画形状 → 大模糊叠一层当"浸润晕开" → 再叠清晰的一层。
// 512 画布，但坐标系仍按 256 写（x.scale(2,2)），细节翻倍
function drawCanvas(){
  const c=canvasOf(512), x=c.getContext('2d');
  x.scale(2,2);
  return {c,x};
}
function bloodCanvas(){
  const {c,x}=drawCanvas();
  x.clearRect(0,0,256,256);
  return {c,x};
}
// 把临时画布"晕开 + 清晰"两遍合成到主画布
function soak(main, tmp, blur){
  main.filter='blur('+blur+'px)'; main.globalAlpha=.55; main.drawImage(tmp,0,0,256,256);
  main.filter='blur(1.6px)';      main.globalAlpha=1;   main.drawImage(tmp,0,0,256,256);
  main.globalAlpha=1; main.filter='none';
}
// 蹭掉/磨损（挖空，露出墙本身）
function wear(x, n, x0,x1,y0,y1, amt){
  x.globalCompositeOperation='destination-out';
  x.filter='blur(9px)';
  for(let i=0;i<n;i++){
    x.beginPath(); x.arc(rr(x0,x1), rr(y0,y1), rr(4,15), 0, 7);
    x.fillStyle='rgba(0,0,0,'+rr(amt*0.4,amt)+')'; x.fill();
  }
  x.globalCompositeOperation='source-over'; x.filter='none';
}

// 手掌印：方掌 + 四根长短不一的指 + 明显外展的长拇指（硬边，不用模糊，避免糊成兔子）
function handprintTex(){
  const {c:tmp, x:t}=drawCanvas();
  t.fillStyle='rgba(64,11,10,0.96)';
  // 掌：方底、上边略窄 —— 方底是关键，圆底会被看成动物身体
  t.beginPath(); t.roundRect(74,124,108,86,14); t.fill();
  // 四指：长短错开（中指最长、小指最短），指间留缝
  const F=[[92,60],[122,74],[151,70],[179,52]];
  for(const [fx,base] of F){
    const len=base*rr(.9,1.1);
    t.save(); t.translate(fx,128); t.rotate(rr(-.10,.10));
    t.beginPath(); t.roundRect(-11,-len,22,len+18,10); t.fill(); t.restore();
  }
  // 拇指：从掌的左上角斜着长出去，比手指短一截，但明显分离
  t.save(); t.translate(78,192); t.rotate(1.02+rr(-.08,.08));
  t.beginPath(); t.roundRect(-12,-58,24,70,12); t.fill(); t.restore();
  // 掌心略淡（按压轻的地方）
  t.globalCompositeOperation='destination-out';
  for(let i=0;i<4;i++){
    t.beginPath(); t.arc(rr(96,160), rr(150,196), rr(9,20), 0, 7);
    t.fillStyle='rgba(0,0,0,'+rr(.10,.24)+')'; t.fill();
  }
  t.globalCompositeOperation='source-over';

  const {c,x}=bloodCanvas();
  soak(x, tmp, 1.2);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}

// 飞溅
function splatterTex(){
  const {c:tmp, x:t}=drawCanvas();
  t.filter='blur(1.3px)';
  t.fillStyle='rgba(56,10,9,0.92)';
  for(let i=0;i<80;i++){
    const a=rr(0,7), r=Math.pow(R(),0.55)*118;
    const cx=128+Math.cos(a)*r, cy=128+Math.sin(a)*r;
    const sz=Math.max(rr(1.4,6.5)*(1-r/160), .7);
    t.beginPath(); t.ellipse(cx,cy,sz,Math.max(sz*rr(.6,1.7),.7),rr(0,3),0,7); t.fill();
  }
  for(let i=0;i<7;i++){                       // 往下淌
    const dx=rr(66,192), w=rr(2,5.5), h=rr(18,62);
    t.beginPath(); t.roundRect(dx, rr(110,160), w, h, w/2); t.fill();
  }
  t.filter='none';

  const {c,x}=bloodCanvas();
  soak(x, tmp, 8);
  wear(x, 8, 40,216, 40,216, .34);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}

// 贴着墙滑下去
function smearTex(){
  const {c:tmp, x:t}=drawCanvas();
  t.filter='blur(6px)';
  const g=t.createLinearGradient(0,10,0,250);
  g.addColorStop(0,   'rgba(62,12,11,0.95)');
  g.addColorStop(0.55,'rgba(56,10,9,0.52)');
  g.addColorStop(1,   'rgba(48,8,7,0)');
  t.fillStyle=g;
  for(let i=0;i<7;i++){
    const w=rr(9,26), dx=rr(66,172);
    t.beginPath(); t.roundRect(dx, rr(24,58), w, rr(150,215), w/2); t.fill();
  }
  t.filter='none';

  const {c,x}=bloodCanvas();
  soak(x, tmp, 10);
  wear(x, 10, 50,206, 60,250, .5);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}

// 地上被拖过的长痕
function dragTex(){
  const {c:tmp, x:t}=drawCanvas();
  t.filter='blur(4px)';
  t.fillStyle='rgba(66,14,13,0.92)';
  for(let i=0;i<4;i++){
    t.beginPath(); t.ellipse(128, 126+i*rr(7,15), rr(86,116), rr(3,7), 0, 0, 7); t.fill();
  }
  t.fillStyle='rgba(58,11,10,0.9)';
  for(let i=0;i<44;i++){
    t.beginPath(); t.ellipse(rr(14,242), 128+rr(-28,28), rr(2,7), rr(1,4), rr(0,3),0,7); t.fill();
  }
  t.filter='none';

  const {c,x}=bloodCanvas();
  soak(x, tmp, 9);
  wear(x, 16, 20,236, 96,160, .6);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}

const _bloodMats=new Map();
function bloodMat(t){
  if(!_bloodMats.has(t)) _bloodMats.set(t, new THREE.MeshStandardMaterial({
    map:t, transparent:true, opacity:.84, depthWrite:false,
    roughness:.52, metalness:0, color:0xc6c6c6,
    polygonOffset:true, polygonOffsetFactor:-6, polygonOffsetUnits:-6
  }));
  return _bloodMats.get(t);
}

// 地面上的血迹单独一份材质：带一点自发光，不然压在暗地砖上根本看不见
const _bloodMatsF=new Map();
function bloodMatF(t){
  if(!_bloodMatsF.has(t)) _bloodMatsF.set(t, new THREE.MeshStandardMaterial({
    map:t, transparent:true, opacity:.93, depthWrite:false,
    roughness:.55, metalness:0, color:0xd8d8d8,
    emissive:0x2a0606, emissiveIntensity:.85,
    polygonOffset:true, polygonOffsetFactor:-6, polygonOffsetUnits:-6
  }));
  return _bloodMatsF.get(t);
}

function wallDecal(tex, d, side, y, size, rotZ){
  for(const dr of DOORS){                       // 别贴在门框上（会像悬空的手印）
    if(Math.abs(pathD(dr.x,dr.z) - d) < 1.15) return null;
  }
  const p=atPath(d);
  const off=(W/2-.03)*side;
  const rotY = side>0 ? Math.atan2(-p.nx,-p.nz) : Math.atan2(p.nx,p.nz);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(size, size), bloodMat(tex));
  m.position.set(p.x+p.nx*off, y, p.z+p.nz*off);
  m.rotation.set(0, rotY, rotZ||0);
  m.renderOrder=1;
  scene.add(m); return m;
}
function floorDecal(tex, d, lateral, size, rotZ){
  const p=atPath(d);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(size, size*rr(.7,1.35)), bloodMatF(tex));
  m.rotation.x=-Math.PI/2; m.rotation.z=rotZ;
  m.position.set(p.x+p.nx*lateral, .017, p.z+p.nz*lateral);
  m.renderOrder=1;
  scene.add(m); return m;
}

const HANDS  = [0,1,2,3,4,5].map(()=>handprintTex());
const SPLATS = [splatterTex(), splatterTex(), splatterTex()];
const SMEARS = [smearTex(),     smearTex()];
const DRAGS  = [dragTex(),      dragTex()];

// ① 三处"挣扎现场"：一串手印（逐渐变淡）+ 下滑痕 + 飞溅
for(let k=0;k<8;k++){
  const d0   = safeD(3.0);                       // 整组都离转角够远
  const side = R()<0.5 ? 1 : -1;
  const base = rr(1.15,1.5);
  for(let i=0;i<3;i++){
    wallDecal(HANDS[(k*3+i)%6], d0 + i*rr(.34,.55), side, base+rr(-.14,.20), rr(.32,.48)*(1-i*0.10), rr(-.4,.4));
  }
  wallDecal(SMEARS[k%2], d0+1.0, side, base-.50, rr(.55,.80), 0);
  wallDecal(SPLATS[k%3], d0+rr(1.5,2.4), side, base+rr(-.35,.45), rr(.38,.62), rr(0,3));
}

// ② 沿墙零散的手印
for(let i=0;i<34;i++){
  const side = R()<0.5 ? 1 : -1;
  const sz   = rr(.24,.44);
  wallDecal(HANDS[i%6], safeD(sz/2+0.45), side, rr(.75,1.9), sz, rr(-.5,.5));
}

// ③ 墙上大块飞溅
for(let i=0;i<32;i++){
  const side = R()<0.5 ? 1 : -1;
  const sz   = rr(.34,.95);
  wallDecal(SPLATS[i%3], safeD(sz/2+0.45), side, rr(.4,2.3), sz, rr(0,3));
}

// ④ 地上：拖痕 + 血斑
for(let i=0;i<18;i++){
  floorDecal(DRAGS[i%2], rr(5,RING_LEN-5), rr(-.9,.9), rr(1.2,2.4), rr(0,3));
}
for(let i=0;i<28;i++){
  floorDecal(SPLATS[i%3], rr(3,RING_LEN-3), rr(-1.1,1.1), rr(.9,2.0), rr(0,3));
}



// 胸口伤口：中间破口 + 放射血丝 + 渗开的红
function woundTex(){
  const c=canvasOf(256), x=c.getContext('2d');
  x.clearRect(0,0,256,256);
  const g=x.createRadialGradient(128,128,10,128,128,122);
  g.addColorStop(0,'rgba(52,7,7,0.96)');
  g.addColorStop(.32,'rgba(72,11,10,0.80)');
  g.addColorStop(.68,'rgba(66,13,11,0.32)');
  g.addColorStop(1,'rgba(58,10,9,0)');
  x.fillStyle=g; x.beginPath(); x.arc(128,128,122,0,7); x.fill();
  x.strokeStyle='rgba(74,10,10,0.55)'; x.lineWidth=2.2;
  for(let i=0;i<18;i++){
    const a=rr(0,6.28), r0=rr(30,52), r1=rr(72,120);
    x.beginPath();
    x.moveTo(128+Math.cos(a)*r0,128+Math.sin(a)*r0);
    x.lineTo(128+Math.cos(a)*r1,128+Math.sin(a)*r1);
    x.stroke();
  }
  x.fillStyle='rgba(22,3,3,0.96)';                       // 破口（不规则）
  x.beginPath();
  for(let i=0;i<14;i++){
    const a=i/14*Math.PI*2, r=34+Math.sin(i*2.7)*14+rr(-6,6);
    const px=128+Math.cos(a)*r, py=128+Math.sin(a)*r;
    i?x.lineTo(px,py):x.moveTo(px,py);
  }
  x.closePath(); x.fill();
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
const WOUND_MAT = new THREE.MeshStandardMaterial({
  map:woundTex(), transparent:true, roughness:.38, metalness:.05,
  polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4
});

// 给所有检查床补上血渍（现在血贴图已经就绪）
scene.traverse(o=>{
  if(o.userData && o.userData.gurneyTop){
    const blood=new THREE.Mesh(new THREE.PlaneGeometry(.62,.9), bloodMatF(SPLATS[0]));
    blood.rotation.x=-Math.PI/2; blood.rotation.z=rr(0,3.14);
    blood.position.set(rr(-.12,.12),.755,rr(-.35,.35));
    blood.renderOrder=1;
    o.add(blood);
  }
});

/* ---------- 7c. 尸体残肢：头颅 / 断臂 + 血泊 ---------- */
const C_SKIN = new THREE.MeshStandardMaterial({color:0x574a42, roughness:.92,
  map:(function(){ const t=grime({size:256,base:[196,190,184],seed:73,noise:52,stains:18,drips:12}); t.repeat.set(2,2); return t; })()});  // 灰败、有污渍的皮肤
const C_HAIR = new THREE.MeshStandardMaterial({color:0x0f0c0b, roughness:.96});
const C_CLOTH= new THREE.MeshStandardMaterial({color:0x2a3038, roughness:.95,
  map:(function(){ const t=grime({size:256,base:[190,190,190],seed:71,noise:46,stains:22,drips:18}); t.repeat.set(2,2); return t; })()});
const C_PANTS= new THREE.MeshStandardMaterial({color:0x181c22, roughness:.96});
const C_SHOE = new THREE.MeshStandardMaterial({color:0x0e1013, roughness:.88});
const C_CUT  = new THREE.MeshStandardMaterial({color:0x2b0607, roughness:.45});
const C_EYE  = new THREE.MeshStandardMaterial({color:0x0a0708, roughness:.4});
const C_TEETH= new THREE.MeshStandardMaterial({color:0xb9b2a4, roughness:.6});

function poolAt(x,z,size){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(size,size*rr(.8,1.2)), bloodMatF(SPLATS[0]));
  m.rotation.x=-Math.PI/2; m.rotation.z=rr(0,3.14);
  m.position.set(x,.019,z); m.renderOrder=1; scene.add(m);
}


// 地上的头颅：球体颅骨 + 头发 + 五官，侧躺在地上
function severedHead(x,z,ry){
  const g=new THREE.Group();
  g.position.set(x,.108,z);
  g.rotation.set(0, ry, rr(1.05,1.55));            // 侧躺
  g.userData.head=true;
  scene.add(g);
  const M=(geo,mat,px,py,pz)=>{ const m=new THREE.Mesh(geo,mat);
    m.position.set(px,py,pz); m.castShadow=true; m.receiveShadow=true; g.add(m); return m; };

  const sk = M(new THREE.SphereGeometry(.118,12,10), C_SKIN, 0,0,0);
  sk.scale.set(.94,.96,1.05);                       // 颅骨
  const hr = M(new THREE.SphereGeometry(.122,12,8,0,Math.PI*2,0,Math.PI*0.60), C_HAIR, 0,.004,-.014);
  hr.scale.set(.99,.99,1.02);                       // 头发（上半球）
  M(new THREE.BoxGeometry(.150,.072,.126), C_SKIN, 0,-.090,.032);        // 下颌
  M(new THREE.SphereGeometry(.027,8,6), C_EYE, -.047,.020,.106);         // 左眼窝
  M(new THREE.SphereGeometry(.027,8,6), C_EYE,  .047,.020,.106);         // 右眼窝
  M(new THREE.ConeGeometry(.019,.042,6), C_SKIN, 0,-.022,.116);          // 鼻
  M(new THREE.BoxGeometry(.060,.028,.018), C_CUT, 0,-.070,.114);         // 嘴（黑）
  M(new THREE.CylinderGeometry(.060,.055,.075,10), C_CUT, 0,-.140,-.030); // 断颈
  for(let i=0;i<9;i++){                                                    // 断口撕裂的血肉
    const a=i/9*Math.PI*2, rr2=.050+rr(-.006,.010);
    M(new THREE.SphereGeometry(rr(.011,.019),6,5), i%3?C_CUT:C_SKIN,
      Math.cos(a)*rr2, -.172+rr(-.006,.006), -.030+Math.sin(a)*rr2);
  }
  poolAt(x,z,rr(.60,.95));                                                // 血泊
}

function slumpedBody(d, side){
  const p = atPath(d);
  const off = (W/2 - 0.52) * side;
  const x = p.x + p.nx*off, z = p.z + p.nz*off;
  const vx = -p.nx*side, vz = -p.nz*side;                 // 面朝走廊中心
  const yaw = Math.atan2(vx, vz);

  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  scene.add(g);

  const B=(w,h,dep,m,px,py,pz,parent)=>{
    const me=new THREE.Mesh(new THREE.BoxGeometry(w,h,dep),m);
    me.position.set(px,py,pz);
    me.castShadow=true; me.receiveShadow=true;
    (parent||g).add(me); return me;
  };

  // 骨盆（坐在地上）
  B(.36,.22,.28, C_CLOTH, 0,.17,0, g);
  // 躯干：往后靠在墙上
  const torso = new THREE.Group();
  torso.position.set(0,.26,0); torso.rotation.x = -.20; g.add(torso);
  B(.42,.44,.26, C_CLOTH, 0,.21,0, torso);
  B(.48,.10,.28, C_CLOTH, 0,.45,0, torso);                // 肩
  const wound=new THREE.Mesh(new THREE.PlaneGeometry(.34,.34), WOUND_MAT);
  wound.position.set(0,.30,.142); wound.rotation.z=rr(-.3,.3); torso.add(wound);   // 胸口伤口

  // 头：低垂向胸前
  const head = new THREE.Group();
  head.position.set(0,.50,.03); head.rotation.x = .74; head.rotation.z = rr(-.18,.18); torso.add(head);
  B(.245,.255,.245, C_SKIN, 0,.10,0, head);               // 颅
  B(.255,.09,.255, C_HAIR, 0,.235,0, head);               // 头发
  B(.195,.085,.215, C_SKIN, 0,-.035,.012, head);          // 下颌
  B(.075,.055,.022, C_EYE, -.063,.105,.123, head);        // 眼窝
  B(.075,.055,.022, C_EYE,  .063,.105,.123, head);
  B(.10,.026,.022, C_TEETH, 0,-.005,.124, head);          // 牙
  B(.16,.10,.16, C_CUT, 0,-.10,.005, head);               // 颈（露出的断面）

  // 手臂：垂到地上
  for(const sgn of [-1,1]){
    const sh = new THREE.Group();
    sh.position.set(sgn*.265,.42,0); torso.add(sh);
    sh.rotation.z = sgn*.40; sh.rotation.x = -.06;   // 往外撑开，剪影才看得出是手臂
    B(.125,.34,.145, C_CLOTH, 0,-.17,0, sh);
    const el = new THREE.Group(); el.position.y=-.34; sh.add(el);
    el.rotation.x = -.30; el.rotation.z = -sgn*.12;
    B(.115,.32,.135, C_CLOTH, 0,-.16,0, el);
    B(.105,.10,.115, C_SKIN, 0,-.35,0, el);               // 手
  }

  // 腿：摊在前面的地上
  for(const sgn of [-1,1]){
    const hip = new THREE.Group();
    hip.position.set(sgn*.13,.145,.11); hip.rotation.x = -1.40; hip.rotation.z = sgn*.26; g.add(hip);
    B(.175,.46,.19, C_PANTS, 0,-.23,0, hip);
    const kn = new THREE.Group(); kn.position.y=-.46; kn.rotation.x = sgn>0? .30 : .02; hip.add(kn);
    B(.155,.44,.17, C_PANTS, 0,-.22,0, kn);
    B(.165,.095,.29, C_SHOE, 0,-.475,.045, kn);
  }

  // 脚下的血泊 + 身后墙上的血印
  poolAt(x, z, rr(1.2,1.9));
  poolAt(x + vx*.55, z + vz*.55, rr(.8,1.3));
}

// 断臂：袖子 + 前臂 + 手 + 断口
function severedArm(x,z,yaw){
  const g=new THREE.Group();
  g.position.set(x, .055, z);
  g.rotation.set(0, yaw, rr(-.1,.1));
  scene.add(g);
  const B=(w,h,d,m,px,py,pz)=>{ const me=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
    me.position.set(px,py,pz); me.castShadow=true; me.receiveShadow=true; g.add(me); return me; };
  B(.125,.115,.30, C_CLOTH, 0,0,-.16);                  // 上臂（袖子）
  B(.105,.10,.28, C_SKIN, 0,0,.13);                     // 前臂
  B(.115,.07,.13, C_SKIN, 0,-.005,.33);                 // 手
  B(.035,.03,.07, C_SKIN, -.05,-.005,.38);              // 拇指
  B(.125,.12,.055, C_CUT, 0,0,-.325);                   // 断口
  poolAt(x,z,rr(.9,1.6));
}

// 摆在走廊里（同时记下位置，方便调试镜头）
window.CORPSES=[];
for(let i=0;i<4;i++){
  const d=safeD(1.8), side = (i%2===0)?1:-1;
  slumpedBody(d, side);
  const p=atPath(d), off=(W/2-.52)*side;
  window.CORPSES.push({kind:'body', x:p.x+p.nx*off, z:p.z+p.nz*off, d});
}
for(let i=0;i<5;i++){
  const p=atPath(safeD(1.6));
  const off=rr(-.85,.85), x=p.x+p.nx*off, z=p.z+p.nz*off;
  severedArm(x, z, rr(0,6.28));
  window.CORPSES.push({kind:'arm', x, z, d: pathD(x,z)});
}
// 另外两颗头颅（补上减少的两具尸体）
for(let i=0;i<2;i++){
  const p=atPath(safeD(1.8));
  const off=rr(-.7,.7), x=p.x+p.nx*off, z=p.z+p.nz*off;
  severedHead(x, z, rr(0,6.28));
  window.CORPSES.push({kind:'head', x, z, d: pathD(x,z)});
}


/* ---------- 7c2. 出生点：全图随机，互相看不见、至少隔开「10 秒疾跑」的距离 ---------- */
// 线段与矩形是否相交（Liang-Barsky）——给「开局互相看不见」做视线判定
function segHitsRect(x0,z0,x1,z1,rct){
  let t0=0, t1=1;
  const dx=x1-x0, dz=z1-z0;
  const p=[-dx,dx,-dz,dz], q=[x0-rct.x0, rct.x1-x0, z0-rct.z0, rct.z1-z0];
  for(let i=0;i<4;i++){
    if(Math.abs(p[i])<1e-9){ if(q[i]<0) return false; }
    else{
      const t=q[i]/p[i];
      if(p[i]<0){ if(t>t1) return false; if(t>t0) t0=t; }
      else      { if(t<t0) return false; if(t<t1) t1=t; }
    }
  }
  return true;
}
// 鬼要能"推门进来"：找那扇挡在它和玩家之间、还关着的房间门
function doorBetweenGhostAndPlayer(){
  let best = null, bd = 1e9;
  for(const d of ROOM_DOORS){
    if(d.open) continue;
    const dg = Math.hypot(d.x - ghost.position.x, d.z - ghost.position.z);
    if(dg > 3.2 || dg > bd) continue;
    const dp = Math.hypot(d.x - player.x, d.z - player.z);
    const straight = Math.hypot(player.x - ghost.position.x, player.z - ghost.position.z);
    if(dg + dp < straight + 1.6){ bd = dg; best = d; }
  }
  return best;
}
function losBlocked(x0,z0,x1,z1){
  for(const w of WALLS) if(segHitsRect(x0,z0,x1,z1,w)) return true;
  return false;
}
// 走廊上的随机点（一半在外围环廊，一半在内区四条走廊）

// ===== 连通性：保证出生点不会被封在独立小房间里 =====
// 用与寻路同样的规则（门可以推开 → 不算障碍）做一次洪水填充，
// 取"含出口 + 含钥匙柜"的那个连通区当可玩区，玩家和鬼都只在这个区里出生。
function mazePlayRegion(){
  if(window.__MAZE_REGION) return window.__MAZE_REGION;
  const b = window.MAZE_BOUNDS || {x0:-28,x1:28,z0:-22,z1:22};
  const cell = 0.55, R = 0.34;
  const nx = Math.max(2, Math.ceil((b.x1-b.x0)/cell));
  const nz = Math.max(2, Math.ceil((b.z1-b.z0)/cell));
  const N = nx*nz;
  const blocked = new Uint8Array(N);
  // 门的碰撞盒不算障碍
  const doorCols = new Set();
  try{ for(const d of ROOM_DOORS) if(d && d.col) doorCols.add(d.col); }catch(e){}
  for(let iz=0; iz<nz; iz++){
    for(let ix=0; ix<nx; ix++){
      const x = b.x0 + (ix+0.5)*cell, z = b.z0 + (iz+0.5)*cell;
      let bl = !(x > b.x0+0.2 && x < b.x1-0.2 && z > b.z0+0.2 && z < b.z1-0.2);
      if(!bl){
        for(const w of WALLS){
          if(w.top != null && w.top <= 0.75) continue;
          if(doorCols.has(w)) continue;
          if(x > w.x0-R && x < w.x1+R && z > w.z0-R && z < w.z1+R){ bl = true; break; }
        }
      }
      blocked[iz*nx+ix] = bl ? 1 : 0;
    }
  }
  // 洪水填充
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  const q = new Int32Array(N);
  let cid = 0;
  for(let i=0;i<N;i++){
    if(blocked[i] || comp[i] !== -1) continue;
    let head=0, tail=0; q[tail++]=i; comp[i]=cid; let sz=0;
    while(head<tail){
      const cur=q[head++]; sz++;
      const cx=cur%nx, cz=(cur-cx)/nx;
      const nb=[cx>0?cur-1:-1, cx<nx-1?cur+1:-1, cz>0?cur-nx:-1, cz<nz-1?cur+nx:-1];
      for(const n2 of nb){
        if(n2<0 || blocked[n2] || comp[n2]!==-1) continue;
        comp[n2]=cid; q[tail++]=n2;
      }
    }
    sizes.push(sz); cid++;
  }
  // 给每个连通区打分：含出口 +5，含钥匙柜 +3，面积按比例
  const score = new Int32Array(sizes.length);
  const cellOf = function(x,z){
    const ix = Math.floor((x-b.x0)/cell), iz = Math.floor((z-b.z0)/cell);
    if(ix<0||iz<0||ix>=nx||iz>=nz) return -1;
    return comp[iz*nx+ix];
  };
  // 出口门在墙上，格子本身可能是"不可走"，要往周围找最近的可行走格再给它所属区域加分
  const compNear = function(x,z){
    const base = cellOf(x,z);
    if(base >= 0) return base;
    for(let r=1; r<=10; r++){
      for(let dz=-r; dz<=r; dz++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.max(Math.abs(dx),Math.abs(dz)) !== r) continue;
          const c = cellOf(x + dx*cell, z + dz*cell);
          if(c >= 0) return c;
        }
      }
    }
    return -1;
  };
  try{ for(const e of (window.EXITS||[])){ const c=compNear(e.x,e.z); if(c>=0) score[c]+=5; } }catch(e){}
  try{
    for(const c of CABINETS){
      let nearKey = false;
      for(const kp of (window.LEVEL_DATA && LEVEL_DATA.钥匙点) || []){
        if(Math.hypot(kp.x-c.x, kp.z-c.z) < 3) nearKey = true;
      }
      if(nearKey){ const cc=compNear(c.x,c.z); if(cc>=0) score[cc]+=3; }
    }
  }catch(e){}
  let best = -1, bs = -1;
  for(let i=0;i<sizes.length;i++){
    const s2 = score[i]*1000 + sizes[i];
    if(s2 > bs){ bs = s2; best = i; }
  }
  const region = { comp, nx, nz, cell, x0:b.x0, z0:b.z0, best, sizes, score };
  window.__MAZE_REGION = region;
  return region;
}
// 在可玩连通区里随机取一个点
function mazePickInRegion(minDistFrom, fx, fz){
  const r = mazePlayRegion();
  if(r.best < 0) return null;
  const N = r.nx*r.nz;
  let best = null, bestScore = -1;
  for(let tries=0; tries<900; tries++){
    const i = (Math.random()*N)|0;
    if(r.comp[i] !== r.best) continue;
    const ix = i % r.nx, iz = (i - ix)/r.nx;
    const x = r.x0 + (ix+0.5)*r.cell, z = r.z0 + (iz+0.5)*r.cell;
    if(minDistFrom && fx !== undefined){
      if(Math.hypot(x-fx, z-fz) < minDistFrom) continue;
      return {x:x, z:z};                       // 只要够远，直接要
    }
    const sc = Math.random();
    if(sc > bestScore){ bestScore = sc; best = {x:x, z:z}; }
  }
  return best;
}

function randomSpawnPoint(){
  if(MAZE){
    // 只在"和出口/钥匙连在一起"的那片区域里出生，绝不会被小房间关死
    const p = mazePickInRegion();
    if(p) return p;
  }
  if(Math.random()<0.5){
    const p=atPath(Math.random()*RING_LEN);
    const t=rr(-W/2+PR+0.25, W/2-PR-0.25);
    return {x:p.x+p.nx*t, z:p.z+p.nz*t};
  }
  const c=CORR_RECTS[(Math.random()*4)|0];
  if(c.x1-c.x0 > c.z1-c.z0)
    return {x:rr(c.x0+0.7, c.x1-0.7), z:(c.z0+c.z1)/2 + rr(-0.9,0.9)};
  return {x:(c.x0+c.x1)/2 + rr(-0.9,0.9), z:rr(c.z0+0.7, c.z1-0.7)};
}
// 10 秒疾跑 ≈ 3.2 m/s × 10 = 32 米（RUN_SPD 在本节之后才声明，这里写死避免 TDZ）
const SPAWN_MIN_D = 32;
function pickSpawns(){
  let best=null, bestD=-1;
  for(let i=0;i<2500;i++){
    const a=randomSpawnPoint(), b=randomSpawnPoint();
    const d=Math.hypot(a.x-b.x, a.z-b.z);
    if(d>bestD){ bestD=d; best={a,b}; }
    if(d>=SPAWN_MIN_D && losBlocked(a.x,a.z,b.x,b.z)) return {player:a, ghost:b, dist:d};
  }
  return {player:best.a, ghost:best.b, dist:bestD};   // 兜底：用最远的一对
}
const SPAWN = pickSpawns();

// 世界坐标判断：这一点离任何一扇门（真门/躲藏门/玻璃门）是否够远
function doorsClearWorld(x, z, minD){
  const lists = [];
  if(typeof DOORS !== "undefined") lists.push(DOORS);
  if(typeof ROOM_DOORS !== "undefined") lists.push(ROOM_DOORS);
  if(typeof GLASS !== "undefined") lists.push(GLASS);
  for(const arr of lists){
    for(const q of arr){
      if(Math.hypot(q.x - x, q.z - z) < minD) return false;
    }
  }
  return true;
}

/* ---------- 7d. 对局布置：鬼的出生点 / 玩家位置 / 安全出口 ---------- */
const GHOST_D  = RING_LEN - (pathD(SPAWN.ghost.x, SPAWN.ghost.z) || 0);
const PLAYER_D = pathD(SPAWN.player.x, SPAWN.player.z);

// —— 鬼的占位：血红色立方体（建模和逻辑都待定）——
const ghost = new THREE.Group();
{
  // 3.0：联机前，鬼暂用「玩家同款模型」占位（深红衣服 + 一把大刀）
  const gPerson = makePerson({cloth:0x4a1512, dark:true});
  const g = gPerson.root;
  g.scale.setScalar(1.22);
  ghost.add(g);

  const mBlade=new THREE.MeshStandardMaterial({color:0x6f6a62, roughness:.42, metalness:.85, flatShading:true});
  const mRust =new THREE.MeshStandardMaterial({color:0x4a2a1c, roughness:.7,  metalness:.35, flatShading:true});
  const blade=new THREE.Group(); blade.position.set(.25,1.05,.06); blade.rotation.x=.35; g.add(blade);
  const b1=new THREE.Mesh(new THREE.BoxGeometry(.09,1.15,.05), mBlade); b1.position.y=-.30; blade.add(b1);
  const b2=new THREE.Mesh(new THREE.BoxGeometry(.09,.32,.09), mRust);   b2.position.y=-.98; blade.add(b2);
  const b3=new THREE.Mesh(new THREE.BoxGeometry(.26,.07,.07), mRust);   b3.position.y=.36;  blade.add(b3);

  g.userData.arms = [
    {side: 1, grp: gPerson.arms[1].sh, base: 0},
    {side:-1, grp: gPerson.arms[0].sh, base: 0}
  ];
  g.userData.blade = blade;

  // 保留一个不可见的方块当碰撞参考
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.0,1.9,1.0),
    new THREE.MeshBasicMaterial({visible:false}));
  cube.position.y = .95; cube.visible=false; ghost.add(cube);
  ghost.userData.cube = cube;
  ghost.userData.body = { root: g };
  ghost.userData.person = gPerson;      // 留着走路动画用
  ghost.position.set(SPAWN.ghost.x, 0, SPAWN.ghost.z);
  scene.add(ghost);
}

// —— 安全出口：刷新在鬼附近 14 米内，避开转角 ——
// 固定位置：从鬼出生点往走廊前方找第一个"离所有门 3 米以上"的点
// ===== 安全出口：样式统一，位置由 level.js 的「安全出口」决定（迷宫模式） =====
window.EXITS = [];
function exitDoorAt(px, pz, nx, nz){
  const rotY = Math.atan2(-nx, -nz);
  addDoorAt(px, pz, rotY, 0);
  try{ DOORS[DOORS.length-1].kind = 'exit'; }catch(e){}   // 标记：出口门（不给躲、不给鬼检视）
  // 绿色 EXIT 牌
  const c=canvasOf(256), cx2=c.getContext('2d');
  cx2.fillStyle='#02140a'; cx2.fillRect(0,0,256,256);
  cx2.fillStyle='#39e07c'; cx2.font='bold 96px sans-serif';
  cx2.textAlign='center'; cx2.textBaseline='middle';
  cx2.fillText('EXIT', 128, 128);
  const tx2=new THREE.CanvasTexture(c); tx2.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(0.86,0.86),
    new THREE.MeshBasicMaterial({map:tx2, transparent:true, side:THREE.DoubleSide}));
  sign.position.set(px - nx*0.34, 2.70, pz - nz*0.34);
  sign.rotation.y = rotY;
  scene.add(sign);
  // 绿光
  const gl2=new THREE.PointLight(0x48d18c, 14, 9, 1.9);
  gl2.position.set(px - nx*1.1, 2.3, pz - nz*1.1);
  scene.add(gl2);
  // 地面光环
  const ring=new THREE.Mesh(new THREE.RingGeometry(.55,.72,24),
    new THREE.MeshBasicMaterial({color:0x2fd47f, transparent:true, opacity:.35, side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;
  ring.position.set(px - nx*1.0, .02, pz - nz*1.0);
  scene.add(ring);
  // 地面柔光
  const gc = canvasOf(256), gx2 = gc.getContext('2d');
  const gg = gx2.createRadialGradient(128,128,6,128,128,126);
  gg.addColorStop(0.00,'rgba(70,255,160,0.85)');
  gg.addColorStop(0.40,'rgba(50,220,140,0.42)');
  gg.addColorStop(0.75,'rgba(30,160,100,0.14)');
  gg.addColorStop(1.00,'rgba(20,120,70,0)');
  gx2.fillStyle=gg; gx2.fillRect(0,0,256,256);
  const gtex = new THREE.CanvasTexture(gc); gtex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1,1),
    new THREE.MeshBasicMaterial({map:gtex, transparent:true, opacity:0.85,
      depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false}));
  glow.rotation.x = -Math.PI/2;
  glow.scale.set(4.6,4.6,1);
  glow.position.set(px - nx*1.35, .035, pz - nz*1.35);
  glow.renderOrder = 3;
  scene.add(glow);
  return {x:px, z:pz, nx:nx, nz:nz};
}

let EXIT_D = null;
if(MAZE && window.LEVEL_DATA && Array.isArray(LEVEL_DATA.安全出口) && LEVEL_DATA.安全出口.length){
  for(const ex of LEVEL_DATA.安全出口){
    const r = ex.rot || 0;
    const nx = Math.sin(r), nz = Math.cos(r);      // 朝外的法线
    window.EXITS.push(exitDoorAt(ex.x, ex.z, nx, nz));
  }
  window.EXIT_INFO = { x: window.EXITS[0].x, z: window.EXITS[0].z, all: window.EXITS };
} else {
  for(let k=0;k<120;k++){
    const d = (GHOST_D + 5.0 + k*0.5) % RING_LEN;
    if(cornerDist(d) < 3.2) continue;
    const pp = atPath(d);
    const wx = pp.x + pp.nx*(W/2-0.15), wz = pp.z + pp.nz*(W/2-0.15);
    if(!doorsClearWorld(wx, wz, 3.0)) continue;
    EXIT_D = d; break;
  }
  if(EXIT_D === null) EXIT_D = (GHOST_D + 9) % RING_LEN;
  const EXIT_P = atPath(EXIT_D);
  const EXIT_WALL = { x: EXIT_P.x + EXIT_P.nx*(W/2-0.15), z: EXIT_P.z + EXIT_P.nz*(W/2-0.15) };
  const rec = exitDoorAt(EXIT_WALL.x, EXIT_WALL.z, EXIT_P.nx, EXIT_P.nz);
  window.EXITS.push(rec);
  window.EXIT_INFO = { d:EXIT_D, x:EXIT_WALL.x, z:EXIT_WALL.z, ghostD:GHOST_D, playerD:PLAYER_D };
}

/* ================= 2.0：柜子 / 架子 / 道具 / 交互 / 鬼视角 ================= */
const CABINETS=[], SHELVES=[], ITEMS=[], PROJECTILES=[];
const CAB_HIT=[], ITEM_HIT=[];
const INV={ink:0, shoe:0};
let INK_READY=false;    // 背包里拿起了墨水，左键可扔
const elXh=document.getElementById('xhair');
const elAimTip=document.getElementById('prompt');
if(elAimTip) elAimTip.style.display='none';   // 不要再在屏幕中间弹 E 提示（只保留下方小条）
const elBlind=document.getElementById('blind');
const elRed=document.getElementById('redview');
const elItems=document.getElementById('items');
const elGhostTag=document.getElementById('ghostTag');

// —— 柜子：一片门板，能开；里面有道具位 ——
function makeCabinet(x,z,rotY){
  // 三层抽屉柜：每次交互拉出一层，抽屉里有概率刷到东西
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=rotY; scene.add(g);
  const W=0.95, H=1.16, D=0.52, N=3, T=0.05;
  const bodyMat=new THREE.MeshStandardMaterial({color:0x3b4046, roughness:.88, metalness:.06});
  const faceMat=new THREE.MeshStandardMaterial({color:0x4b525a, roughness:.80, metalness:.12});
  const trayMat=new THREE.MeshStandardMaterial({color:0x4a5058, roughness:.9, emissive:0x101418, emissiveIntensity:.6});
  const add=(geo,mat,px,py,pz,parent)=>{
    const m=new THREE.Mesh(geo,mat); m.position.set(px,py,pz);
    m.castShadow=true; m.receiveShadow=true; (parent||g).add(m); return m;
  };
  // 外壳：底 / 顶 / 左右 / 背（前面敞开）
  add(new THREE.BoxGeometry(W,T,D), bodyMat, 0, T/2, 0);
  add(new THREE.BoxGeometry(W,T,D), bodyMat, 0, H-T/2, 0);
  add(new THREE.BoxGeometry(T,H,D), bodyMat, -W/2+T/2, H/2, 0);
  add(new THREE.BoxGeometry(T,H,D), bodyMat,  W/2-T/2, H/2, 0);
  add(new THREE.BoxGeometry(W,H,T), bodyMat, 0, H/2, -D/2+T/2);

  const dh=(H-2*T-0.06)/N;
  const drawers=[];
  for(let i=0;i<N;i++){
    const cy = T + 0.03 + dh*(i+0.5);
    const slide=new THREE.Group(); slide.position.set(0, cy, D/2-0.10); g.add(slide);
    const face=add(new THREE.BoxGeometry(W-0.06, dh-0.04, 0.04), faceMat, 0, 0, 0.02, slide);
    add(new THREE.BoxGeometry(0.18,0.025,0.03), metalMat, 0, 0, 0.048, slide);   // 拉手
    // 抽屉内胆：底 + 三面
    add(new THREE.BoxGeometry(W-0.10, 0.02, D-0.14), trayMat, 0, -dh/2+0.02, -0.05, slide);
    add(new THREE.BoxGeometry(0.02, dh-0.06, D-0.14), trayMat, -(W-0.10)/2, 0, -0.05, slide);
    add(new THREE.BoxGeometry(0.02, dh-0.06, D-0.14), trayMat,  (W-0.10)/2, 0, -0.05, slide);
    const lamp=new THREE.PointLight(0xffe2b8, 0, 2.0, 2); lamp.position.set(0,0.10,0.16); slide.add(lamp);
    const anchor=new THREE.Object3D(); anchor.position.set(0, -dh*0.12, 0.02); slide.add(anchor);
    drawers.push({i, slide, face, lamp, anchor, open:false, item:null, baseZ:D/2-0.10});
  }
  const rec={drawers, x, z, rotY, kind:'drawer', open:false};
  CABINETS.push(rec);
  for(const d of drawers) CAB_HIT.push({mesh:d.face, cab:rec});
  CAB_HIT.push({mesh:g.children[4], cab:rec});
  return rec;
}

// 拉开抽屉时，把里面的东西露出来（不然会一直是"隐藏"状态）
function revealDrawerItem(cab){
  try{
    if(cab && cab.item && !cab.item.taken){
      cab.item.hidden = false;
      cab.item.mesh.visible = true;
    }
  }catch(e){}
}

function toggleDrawer(rec){
  if(!rec || !rec.drawers) return;
  const d = rec.drawers.find(function(x){ return !x.open; });
  if(d){
    try{ SFX.play('cabinetOpen'); }catch(e){}
    d.open = true;
    if(d.item){
      d.item.hidden = false;
      d.item.mesh.visible = true;
      d.item.mesh.traverse(function(o){ if(o.isPointLight) o.intensity = 1.2; });
    }
    Sound.click();
  } else {
    for(const x of rec.drawers) x.open = false;
    Sound.click();
  }
}

// —— 架子：三层板，道具直接摆在上面 ——
function makeShelf(x,z,rotY){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=rotY; scene.add(g);
  const w=1.15, h=1.92, d=0.38;
  for(const sx of [-1,1]){
    const m=new THREE.Mesh(new THREE.BoxGeometry(.05,h,d), darkMat);
    m.position.set(sx*(w/2-.025), h/2, 0); m.castShadow=true; m.receiveShadow=true; g.add(m);
  }
  const top=new THREE.Mesh(new THREE.BoxGeometry(w,.05,d), darkMat);
  top.position.y=h-.025; top.castShadow=true; g.add(top);
  const anchors=[];
  for(const yy of [0.52, 1.02, 1.52]){
    const b=new THREE.Mesh(new THREE.BoxGeometry(w-.07,.04,d-.05), darkMat);
    b.position.y=yy; b.receiveShadow=true; g.add(b);
    const a=new THREE.Object3D(); a.position.set(rr(-0.28,0.28), yy+0.03, 0); g.add(a); anchors.push(a);
  }
  const rec={x,z,rotY,anchors};
  SHELVES.push(rec);
  return rec;
}
// —— 贴墙摆放：正面朝走廊/房间内侧；skipFace 用来说「这面墙有门，别挡」——
function placePropsInRect(r, nCab, nSh, skipFace){
  const sides=[];
  if(skipFace!=='z0') sides.push({ax:'z', v:r.z0, rot:0});
  if(skipFace!=='z1') sides.push({ax:'z', v:r.z1, rot:Math.PI});
  if(skipFace!=='x0') sides.push({ax:'x', v:r.x0, rot:Math.PI/2});
  if(skipFace!=='x1') sides.push({ax:'x', v:r.x1, rot:-Math.PI/2});
  if(!sides.length) return;
  const put=(fn)=>{
    const s=sides[(Math.random()*sides.length)|0];
    const off=0.26;
    if(s.ax==='z'){
      const x=rr(r.x0+0.95, r.x1-0.95);
      const z=s.v + (s.rot===0 ? off : -off);
      if(!isFinite(x)) return;
      fn(x,z,s.rot);
      addPropBox(x,z, fn===makeShelf ? 0.50 : 1.15, fn===makeShelf ? 0.42 : 0.40);
    }else{
      const z=rr(r.z0+0.95, r.z1-0.95);
      const x=s.v + (s.rot===Math.PI/2 ? off : -off);
      if(!isFinite(z)) return;
      fn(x,z,s.rot);
      addPropBox(x,z, fn===makeShelf ? 0.50 : 1.15, fn===makeShelf ? 0.42 : 0.40);
    }
  };
  for(let i=0;i<nCab;i++) put(makeCabinet);
  for(let i=0;i<nSh;i++)  put(makeShelf);
}
// 走廊里的柜子：只贴外墙/内墙，避开门口和转角，绝不摆在走廊中间
// level.js 里配了「柜子架子」就按它摆，跳过下面两段自动铺
const _LDprops = (window.LEVEL_DATA && Array.isArray(window.LEVEL_DATA.柜子架子)) ? window.LEVEL_DATA.柜子架子 : null;
if(_LDprops && _LDprops.length){
  for(const pp of _LDprops){
    const ry=(pp.rot||0)*Math.PI/2;
    if(pp.type==='shelf'){ makeShelf(pp.x,pp.z,ry); addPropBox(pp.x,pp.z,0.50,0.42); }
    else                 { makeCabinet(pp.x,pp.z,ry); addPropBox(pp.x,pp.z,1.15,0.40); }
  }
}
if(!_LDprops || !_LDprops.length){
  const used=[];
  for(let i=0;i<9;i++){
    let d=0, ok=false;
    for(let k=0;k<60;k++){
      d = rr(7, RING_LEN-7);
      if(cornerDist(d) < 2.4) continue;
      if(nearDoorTooClose(d, 2.8)) continue;
      if(used.some(q=>Math.abs(q-d) < 4.2)) continue;
      ok=true; break;
    }
    if(!ok) continue;
    used.push(d);
    const p=atPath(d), side=(i%2===0)?1:-1;
    const off=(W/2-0.30)*side;                       // 贴着墙，只留 30cm 厚度
    const cx=p.x + p.nx*off, cz=p.z + p.nz*off;
    if(!doorsClearWorld(cx, cz, 2.2)) continue;       // 离任何门都至少 2.2 米
    if(CABINETS.some(c=>Math.hypot(c.x-cx, c.z-cz) < 1.6)) continue;  // 柜子之间不重叠
    if(SHELVES.some(c=>Math.hypot(c.x-cx, c.z-cz) < 1.4)) continue;
    makeCabinet(cx, cz, side>0 ? Math.atan2(-p.nx,-p.nz) : Math.atan2(p.nx,p.nz));
    addPropBox(cx, cz, 1.15, 0.40);
  }
}
if(!_LDprops || !_LDprops.length) for(const r of ROOMS) placePropsInRect(r, 1, 1, r.door.face);

// —— 道具：墨水（全局唯一）/ 皮鞋（提高疾跑上限）——
function makeItemMesh(kind){
  const g=new THREE.Group();
  if(kind==='ink'){
    const m=new THREE.MeshStandardMaterial({color:0x121a24, emissive:0x2b4055, emissiveIntensity:1.1, roughness:.3, metalness:.5});
    const b=new THREE.Mesh(new THREE.CylinderGeometry(.055,.07,.15,10), m); b.position.y=.075; b.castShadow=true; g.add(b);
    const c=new THREE.Mesh(new THREE.CylinderGeometry(.042,.042,.045,10), metalMat); c.position.y=.17; g.add(c);
    const gl=new THREE.PointLight(0x74a8ff, 1.6, 1.5, 2.0); gl.position.y=.12; g.add(gl);
  }else{
    const m=new THREE.MeshStandardMaterial({color:0x4a3320, emissive:0x1f1208, emissiveIntensity:.9, roughness:.75});
    const s=new THREE.Mesh(new THREE.BoxGeometry(.22,.08,.30), m); s.position.y=.04; s.castShadow=true; g.add(s);
    const t=new THREE.Mesh(new THREE.BoxGeometry(.22,.05,.11), m); t.position.set(0,.02,.20); g.add(t);
  }
  return g;
}
function shuffleArr(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; const t=a[i]; a[i]=a[j]; a[j]=t; } }
function placeItem(kind, anchor){
  const m=makeItemMesh(kind); anchor.add(m);
  const it={kind, mesh:m, taken:false};
  ITEMS.push(it); ITEM_HIT.push({mesh:m, item:it});
}
// 肉鸽：每局重新随机（墨水全场只刷一个）
function spawnRoundItems(){
  // 肉鸽规则（3.0）：
  //   墨水只刷在抽屉里，1~2 个；皮鞋只刷在架子上，固定 2 个
  const drawers=[];
  for(const c of CABINETS) for(const d of c.drawers) drawers.push(d);
  shuffleArr(drawers);

  const nInk = 1 + (Math.random()<0.55 ? 1 : 0);          // 1 或 2
  for(let i=0;i<Math.min(nInk,drawers.length);i++){
    const d=drawers[i];
    const gg=makeItemMesh('ink');
    gg.position.set(0, 0.02, 0.02);
    gg.visible=false;
    gg.traverse(function(o){ if(o.isPointLight) o.intensity=0; });
    d.slide.add(gg);
    const it={kind:'ink', mesh:gg, taken:false, hidden:true, drawer:d};
    ITEMS.push(it); ITEM_HIT.push({mesh:gg, item:it});
    d.item=it;
  }

  const anchors=[];
  for(const s of SHELVES) for(const a of s.anchors) anchors.push(a);
  shuffleArr(anchors);
  for(let i=0;i<Math.min(2, anchors.length);i++) placeItem('shoe', anchors[i]);
}
function nearestCabinet(x,z,used){
  let best=null, bd=1e9;
  for(const c of CABINETS){
    if(used && used.has(c)) continue;
    const d = Math.hypot(c.x-x, c.z-z);
    if(d < bd){ bd=d; best=c; }
  }
  return best;
}
function nearestShelf(x,z){
  let best=null, bd=1e9;
  for(const sh of SHELVES){
    const d = Math.hypot(sh.x-x, sh.z-z);
    if(d < bd){ bd=d; best=sh; }
  }
  return best;
}
function spawnRoundItemsMaze(){
  const pts = (window.LEVEL_DATA && LEVEL_DATA.道具点) || [];
  const usedCabs = new Set();
  for(const p of pts){
    if(p.kind === 'ink'){
      const c = nearestCabinet(p.x, p.z, usedCabs);
      if(!c) continue;
      const free = c.drawers.filter(function(d){ return !d.item; });
      if(!free.length) continue;
      const d = free[free.length-1];
      const gg = makeItemMesh('ink');
      gg.position.set(0, 0.02, 0.02); gg.visible = false;
      gg.traverse(function(o){ if(o.isPointLight) o.intensity = 0; });
      d.slide.add(gg);
      const it = {kind:'ink', mesh:gg, taken:false, hidden:true, drawer:d};
      ITEMS.push(it); ITEM_HIT.push({mesh:gg, item:it});
      d.item = it; usedCabs.add(c);
    } else if(p.kind === 'shoe'){
      const sh = nearestShelf(p.x, p.z);
      if(!sh || !sh.anchors || !sh.anchors.length) continue;
      const a = sh.anchors[(Math.random()*sh.anchors.length)|0];
      if(a.userData && a.userData.__item) continue;
      placeItem('shoe', a);
      try{ a.userData.__item = true; }catch(e){}
    }
  }
}
if(MAZE && window.LEVEL_DATA && Array.isArray(LEVEL_DATA.道具点) && LEVEL_DATA.道具点.length){
  spawnRoundItemsMaze();
} else {
  spawnRoundItems();
}

// —— 准心瞄准：距离 + 夹角（不用射线，便宜且够准）——
const _aimDir=new THREE.Vector3(), _aimPos=new THREE.Vector3();
function aimTarget(){
  camera.getWorldDirection(_aimDir);
  const ex=camera.position.x, ey=camera.position.y, ez=camera.position.z;
  let best=null, bestScore=-1;
  const test=(mesh, kind, ref)=>{
    mesh.getWorldPosition(_aimPos);
    const dx=_aimPos.x-ex, dy=_aimPos.y-ey, dz=_aimPos.z-ez;
    const dist=Math.hypot(dx,dy,dz)||1e-3;
    if(dist>2.5) return;
    const dot=(dx*_aimDir.x+dy*_aimDir.y+dz*_aimDir.z)/dist;
    if(dot<0.88) return;
    const score=dot*(1-dist/3.4);
    if(score>bestScore){ bestScore=score; best={kind, ref}; }
  };
  let bestItem=null, bestItemScore=-1;
  let bestCab=null,  bestCabScore=-1;
  const testOne=(mesh, cb)=>{
    mesh.getWorldPosition(_aimPos);
    const dx=_aimPos.x-ex, dy=_aimPos.y-ey, dz=_aimPos.z-ez;
    const dist=Math.hypot(dx,dy,dz)||1e-3;
    if(dist>2.5) return;
    const dot=(dx*_aimDir.x+dy*_aimDir.y+dz*_aimDir.z)/dist;
    if(dot<0.86) return;
    cb(dot*(1-dist/3.4));
  };
  for(const h of ITEM_HIT) if(!h.item.taken && (!h.item.hidden || (h.item.drawer && h.item.drawer.open))) testOne(h.mesh,(sc)=>{ if(sc>bestItemScore){ bestItemScore=sc; bestItem={kind:'item', ref:h.item}; } });
  for(const h of CAB_HIT) testOne(h.mesh,(sc)=>{ if(sc>bestCabScore){ bestCabScore=sc; bestCab={kind:'cabinet', ref:h.cab}; } });
  return bestItem || bestCab;   // 道具优先
}
let tipT=0, tipMsg='';

// 独立提示条（拾取道具等），不会被准心提示覆盖
const elToast = document.createElement('div');
elToast.style.cssText = 'position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:70;' +
  'padding:9px 18px;border-radius:8px;background:rgba(8,12,16,.82);border:1px solid rgba(150,200,180,.35);' +
  'color:#d6e6dd;font:13px/1.4 system-ui,sans-serif;letter-spacing:.06em;opacity:0;' +
  'transition:opacity .18s;pointer-events:none;white-space:nowrap';
document.body.appendChild(elToast);
let _toastT = 0;
function showToast(msg, sec){
  elToast.textContent = msg;
  elToast.style.opacity = '1';
  _toastT = sec || 2.0;
}

function toastTip(msg){ tipMsg=msg; tipT=1.2; elAimTip.textContent=msg; elAimTip.style.opacity='1'; }
function updateItemHud(){
  const parts=[];
  if(INV.ink>0) parts.push('墨水 ×'+INV.ink+'（左键扔）');
  elItems.textContent = parts.join('　·　');
}
function pickupItem(it){
  if(it.taken) return;
  it.taken=true; it.mesh.visible=false;
  if(it.kind==='ink'){ INV.ink++; showToast('拾取道具 · 墨水炸弹 ×1'); }
  else if(it.kind==='key'){
    PLAYER_HAS_KEY = true; it.taken = true;
    if(it.key) it.key.taken = true;
    KEYS_TAKEN++;
    try{ if(it.drawer) it.drawer.item = null; }catch(e){}
    showToast('拾取钥匙 ×1 · 去安全门撤离');
    updateKeyHud();
  }
  else { INV.shoe++; showToast('拾取道具 · 皮鞋 ×1'); }
  updateItemHud();
}
// —— 墨水：扔出去，砸中鬼 → 鬼的屏幕黑 3 秒 ——
let blindT=0;          // 鬼被墨水糊住的剩余秒数（按真实时间衰减，不随视角切换重置）

// 鬼被墨水糊一脸（全屏墨迹，效果结束时跟着消失）
const INK_FACE = document.createElement('canvas');
INK_FACE.id = 'inkFace';
INK_FACE.style.cssText = 'position:fixed;inset:0;z-index:78;pointer-events:none;opacity:0;transition:opacity .6s';
document.body.appendChild(INK_FACE);
function drawInkSplat(){
  INK_FACE.width = innerWidth; INK_FACE.height = innerHeight;
  const x = INK_FACE.getContext('2d'), W=INK_FACE.width, H=INK_FACE.height;
  x.clearRect(0,0,W,H);
  const cx=W*0.5, cy=H*0.5, R=Math.min(W,H)*0.42;
  x.fillStyle='rgba(5,7,18,.97)';
  x.beginPath();
  for(let i=0;i<=48;i++){
    const a=i/48*Math.PI*2, rr2=R*(0.70+Math.random()*0.55);
    const px=cx+Math.cos(a)*rr2, py=cy+Math.sin(a)*rr2*0.92;
    i?x.lineTo(px,py):x.moveTo(px,py);
  }
  x.closePath(); x.fill();
  for(let i=0;i<80;i++){
    const a=Math.random()*Math.PI*2, d=R*(0.55+Math.random()*0.9);
    x.fillStyle='rgba(5,7,18,'+(0.45+Math.random()*0.5)+')';
    x.beginPath(); x.arc(cx+Math.cos(a)*d, cy+Math.sin(a)*d*0.9, 4+Math.random()*20, 0, 7); x.fill();
  }
  for(let i=0;i<10;i++){
    const sx=cx+(Math.random()-0.5)*R*1.1, sy=cy-R*0.15;
    x.strokeStyle='rgba(5,7,18,.72)'; x.lineWidth=6+Math.random()*9; x.lineCap='round';
    x.beginPath(); x.moveTo(sx,sy); x.lineTo(sx+(Math.random()-0.5)*24, sy+R*(0.55+Math.random()*0.6)); x.stroke();
  }
}

// 鬼脸上的墨迹：贴在鬼的头上，被砸中才出现，效果结束自己淡掉
let GHOST_INK = null;
function makeInkTexture(){
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  x.clearRect(0,0,128,128);
  const cx=64, cy=64;
  x.fillStyle='rgba(6,9,20,.97)';
  x.beginPath();
  for(let i=0;i<=28;i++){
    const a=i/28*Math.PI*2, r=40*(0.55+Math.random()*0.55);
    const px=cx+Math.cos(a)*r, py=cy+Math.sin(a)*r;
    i?x.lineTo(px,py):x.moveTo(px,py);
  }
  x.closePath(); x.fill();
  for(let i=0;i<26;i++){
    const a=Math.random()*Math.PI*2, d=40+Math.random()*24;
    x.fillStyle='rgba(6,9,20,'+(0.45+Math.random()*0.5)+')';
    x.beginPath(); x.arc(cx+Math.cos(a)*d, cy+Math.sin(a)*d, 2+Math.random()*7, 0, 7); x.fill();
  }
  // 往下淌的两道
  for(let i=0;i<3;i++){
    x.strokeStyle='rgba(6,9,20,.8)'; x.lineWidth=3+Math.random()*4; x.lineCap='round';
    x.beginPath(); x.moveTo(cx-10+i*10, cy); x.lineTo(cx-10+i*10+(Math.random()*8-4), cy+34+Math.random()*14); x.stroke();
  }
  return new THREE.CanvasTexture(cv);
}
function attachGhostInk(){
  if(GHOST_INK){ ghost.remove(GHOST_INK); GHOST_INK.geometry.dispose(); GHOST_INK.material.map.dispose(); GHOST_INK.material.dispose(); GHOST_INK=null; }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.46),
    new THREE.MeshBasicMaterial({ map: makeInkTexture(), transparent:true, opacity:1, depthWrite:false, side:THREE.DoubleSide })
  );
  m.position.set(0, 1.78, 0.20);      // 脸的位置（模型放大了 1.22 倍）
  m.renderOrder = 3;
  ghost.add(m);
  GHOST_INK = m;
}
function tickGhostInk(){
  if(!GHOST_INK) return;
  const total = Math.max(0.001, CFG.道具.墨水黑屏秒);
  const k = Math.max(0, blindT/total);
  GHOST_INK.material.opacity = k;
  if(k <= 0.01){
    ghost.remove(GHOST_INK);
    GHOST_INK.geometry.dispose(); GHOST_INK.material.map.dispose(); GHOST_INK.material.dispose();
    GHOST_INK = null;
  }
}

function inkHitGhost(){
  blindT = Math.max(blindT, CFG.道具.墨水黑屏秒);
  // 墨水黏住：鬼被拖慢 1 秒，只有人类蹲着走的一半速度
  const _d = cfgNum('鬼AI','墨水减速秒',1);
  if(GV.on) GV.inkSlowT = Math.max(GV.inkSlowT||0, _d);
  else      GAI.inkSlowT = Math.max(GAI.inkSlowT||0, _d);
  attachGhostInk();                       // 鬼脸上糊一块墨（看着鬼的人都能看到）
  if(GV.on){                              // 只有被砸的鬼自己，屏幕才会被糊住
    drawInkSplat();
    INK_FACE.style.opacity = '1';
    try{ elBlind.style.opacity='0'; }catch(e){}
    showToast('你被墨水糊住了！');
  } else {
    showToast('墨水砸中鬼！它的脸被糊住了');
  }
}

function onInkHit(){
  Sound.click();
  if(!GV.on) INK_FACE.style.opacity = '0';   // 人类不该被糊屏幕
  inkHitGhost();
  // 人类视角下只提示
  ghost.userData.pulse = 1.0;      // 鬼身上闪一下，确认砸中了
}
function throwInk(){
  if(!INK_READY) return;
  INK_READY = false;
  camera.getWorldDirection(_aimDir);
  const m=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),
    new THREE.MeshStandardMaterial({color:0x0d141c, emissive:0x2b4055, emissiveIntensity:1.1, roughness:.4}));
  m.position.copy(camera.position).addScaledVector(_aimDir, .35);
  scene.add(m);
  PROJECTILES.push({mesh:m, vx:_aimDir.x*17, vy:_aimDir.y*17+1.2, vz:_aimDir.z*17, life:4});
  Sound.click();
}
function updateProjectiles(dt){
  for(let i=PROJECTILES.length-1;i>=0;i--){
    const p=PROJECTILES[i];
    p.vy -= 8.0*dt;
    p.mesh.position.x += p.vx*dt;
    p.mesh.position.y += p.vy*dt;
    p.mesh.position.z += p.vz*dt;
    p.life -= dt;
    const gx=ghost.position.x, gz=ghost.position.z;
    if(Math.hypot(p.mesh.position.x-gx, p.mesh.position.z-gz)<0.85 && Math.abs(p.mesh.position.y-1.00)<1.15){
      onInkHit(); scene.remove(p.mesh); PROJECTILES.splice(i,1); continue;
    }
    if(p.mesh.position.y<=0.06 || p.life<=0){ scene.remove(p.mesh); PROJECTILES.splice(i,1); }
  }
}
function updateBlind(dt){
  if(blindT>0){
    blindT = Math.max(0, blindT - dt);
    if(GV.on){
      // 前 1 秒全黑，之后 2 秒线性恢复
      const k = blindT > (CFG.道具.墨水黑屏秒 - 1.0) ? 1 : Math.max(0, blindT / (CFG.道具.墨水黑屏秒 - 1.0));
      elBlind.style.opacity = String(k);
    }
    if(blindT <= 0){
      elBlind.style.opacity = '0';
      tickGhostInk();
      if(GV.on) toastTip('视线恢复了');
      try{ INK_FACE.style.opacity='0'; }catch(e){}
    }
  } else if(!GV.on){
    elBlind.style.opacity = '0';
  }
}
// —— 柜门开合 ——
function updateCabinets(dt){
  for(const c of CABINETS){
    if(!c.drawers) continue;
    for(const d of c.drawers){
      const goal = d.baseZ + (d.open ? 0.30 : 0);
      if(Math.abs(d.slide.position.z - goal) > 0.001){
        d.slide.position.z += (goal - d.slide.position.z) * Math.min(1, dt*9);
      }
      const lit = d.open ? 1.9 : 0;
      d.lamp.intensity += (lit - d.lamp.intensity) * Math.min(1, dt*8);
    }
  }
}
// —— P 键：切到鬼的视角（调试联机用）——
const GV={on:false, x:0, z:0, y:0, vy:0, grounded:true, yaw:0, pitch:0};
function toggleGhostView(){
  // 雷达只由 F8 控制，不再跟视角绑定
  // 注意：切到鬼视角时【不要】清掉躲藏状态——那是人类那一侧的状态，
  // 清掉就会让玩家重新"站回门外"。鬼本身不能躲藏（tryHide 里已拦）。
  GV.on=!GV.on;
  if(GV.on){
    GV.x=ghost.position.x; GV.z=ghost.position.z;
    GV.yaw=player.yaw+Math.PI; GV.pitch=0;
    stamina=1;
  }
  elRed.style.opacity = GV.on ? '0.45':'0';
  elGhostTag.style.opacity = GV.on ? '1':'0';
  if(ghost.userData.body) ghost.userData.body.root.visible = !GV.on;
  toastTip(GV.on ? '进入鬼的视角' : '回到人类视角');
}

/* ---------- 8. 手电筒 + 极弱环境光 ---------- */
scene.add(new THREE.AmbientLight(0x14232a, 0.135));   // 冷青环境光
scene.add(new THREE.HemisphereLight(0x35455f, 0x0d1014, 0.18));   // 下半球稍亮＝假地面反弹光

const FLASH_I = CFG.画面.手电亮度;      // 手电亮度（config.js 可调）
const flash = new THREE.SpotLight(0xdfeaf2, FLASH_I, 22, 0.62, 0.90, 1.50);
flash.position.set(0.16,-0.14,0.06);
flash.castShadow = true;
// 阴影质量：决定"地面阴影是不是一块一块的"
flash.shadow.mapSize.set(1024,1024);           // 1024 仍然偏软，2048 才够
flash.shadow.camera.near = 0.30;
flash.shadow.bias = -0.0004;
flash.shadow.normalBias = 0.018;
// ★关键：阴影相机默认覆盖整个光锥（22 米），分辨率全浪费在空处。
//   focus<1 把阴影锥收窄到光斑中心，texel 密度立刻提升数倍。
if('focus' in flash.shadow) flash.shadow.focus = 0.70;
camera.add(flash);
flash.target.position.set(0,0,-1);
camera.add(flash.target);

/* ---------- 9. 尘埃 ---------- */
{
  const N=420, pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){
    pos[i*3]  = rr(-W/2, W/2);
    pos[i*3+1]= rr(.1, H-.1);
    pos[i*3+2]= -rr(0,LEN);
  }
  const gm=new THREE.BufferGeometry();
  gm.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const dust=new THREE.Points(gm, new THREE.PointsMaterial({
    color:0x8d949e, size:.016, transparent:true, opacity:.5, depthWrite:false}));
  dust.name='dust'; scene.add(dust);
}

/* ---------- 10. 远处的人影（走近就消失） ---------- */
const figure = new THREE.Group();
{
  const fm=new THREE.MeshBasicMaterial({color:0x000000, fog:true});
  const parts=[[.34,.95,.20, 0,1.12,0],[.26,.46,.24, 0,1.94,0],
               [.11,.62,.13, -.22,.52,0],[.11,.62,.13, .22,.52,0]];
  for(const [w,h,d,x,y,z] of parts){
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),fm);
    m.position.set(x,y,z); figure.add(m);
  }
  figure.visible=false; scene.add(figure);
}
let figureTimer=0, figureCool=14;


/* ---------- 10b. 人物模型（方块人 + 程序化走路动画） ---------- */
function makePerson(opt){
  opt = opt || {};
  const cSkin  = opt.dark ? 0x6b6058 : 0x9d8a78;
  const cCloth = opt.cloth || (opt.dark ? 0x23282e : 0x3a4450);
  const cPants = opt.dark ? 0x14171b : 0x1f252d;

  // PS1 风格：低段数 + 平面着色（棱面感），但比例是真人
  const mk=(c,ex)=>new THREE.MeshStandardMaterial(Object.assign(
    {color:c, roughness:.84, metalness:.02, flatShading:true}, ex||{}));
  const mSkin =mk(cSkin);
  const mCloth=mk(cCloth);
  const mPants=mk(cPants);
  const mShoe =mk(0x101216,{roughness:.7});
  const mHair =mk(0x1a1310,{roughness:.96});
  const mWhite=mk(0xc6c0b6,{roughness:.42,flatShading:false});
  const mDark =mk(0x0a0a0c,{roughness:.4,flatShading:false});
  const mRed  =mk(0x3a1413,{roughness:.75});

  const root=new THREE.Group();
  const body=new THREE.Group(); root.add(body);
  const add=(geo,mat,parent)=>{ const m=new THREE.Mesh(geo,mat);
    m.castShadow=true; m.receiveShadow=true; parent.add(m); return m; };

  /* ---------- 腿（髋 0.90 → 膝 0.48 → 踝 0.06） ---------- */
  const legs=[];
  for(const sgn of [-1,1]){
    const hip=new THREE.Group(); hip.position.set(sgn*.105,.90,0); body.add(hip);
    add(new THREE.CylinderGeometry(.088,.070,.42,7), mPants, hip).position.y=-.21;
    const knee=new THREE.Group(); knee.position.y=-.42; hip.add(knee);
    add(new THREE.CylinderGeometry(.068,.050,.42,7), mPants, knee).position.y=-.21;
    add(new THREE.SphereGeometry(.055,7,5), mPants, knee).position.y=-.42;      // 脚踝
    const foot=add(new THREE.BoxGeometry(.10,.07,.235), mShoe, knee);
    foot.position.set(0,-.455,.055);
    legs.push({hip,knee});
  }

  /* ---------- 躯干（胯 0.90→1.08，胸 1.08→1.44，上宽下窄） ---------- */
  const torso=new THREE.Group(); torso.position.y=.90; body.add(torso);
  add(new THREE.CylinderGeometry(.165,.155,.18,8), mCloth, torso).position.y=.09;   // 胯
  add(new THREE.CylinderGeometry(.150,.165,.16,8), mCloth, torso).position.y=.26;   // 腰（略收）
  const chest=add(new THREE.CylinderGeometry(.195,.150,.20,8), mCloth, torso);      // 胸
  chest.position.y=.44;
  add(new THREE.SphereGeometry(.088,8,6), mCloth, torso).position.set(-.178,.522,0); // 肩（加宽）
  add(new THREE.SphereGeometry(.088,8,6), mCloth, torso).position.set( .178,.522,0);
  add(new THREE.CylinderGeometry(.058,.070,.13,8), mSkin, torso).position.y=.585;   // 脖子（加长）

  /* ---------- 头（1.52→1.74，8 头身） ---------- */
  const headG=new THREE.Group(); headG.position.y=.655; torso.add(headG);           // 世界 1.555
  const skull=add(new THREE.SphereGeometry(.097,10,8), mSkin, headG);
  skull.scale.set(.93,1.0,.96); skull.position.y=.095;
  add(new THREE.BoxGeometry(.142,.068,.138), mSkin, headG).position.set(0,.022,.012); // 下颌
  const hair=add(new THREE.SphereGeometry(.101,10,8), mHair, headG);                 // 头发（露脸）
  hair.scale.set(.92,.74,1.0); hair.position.set(0,.128,-.010);
  add(new THREE.BoxGeometry(.155,.042,.04), mHair, headG).position.set(0,.104,.082);  // 刘海
  for(const sgn of [-1,1]){                                                          // 鬓角
    add(new THREE.BoxGeometry(.03,.09,.10), mHair, headG).position.set(sgn*.098,.075,-.01);
    add(new THREE.BoxGeometry(.032,.05,.02), mSkin, headG).position.set(sgn*.104,.10,-.01); // 耳
    add(new THREE.BoxGeometry(.062,.018,.02), mHair, headG).position.set(sgn*.045,.140,.086); // 眉（加粗）
    add(new THREE.SphereGeometry(.023,8,6), mWhite, headG).position.set(sgn*.045,.108,.083);  // 眼白
    add(new THREE.SphereGeometry(.013,7,5), mDark,  headG).position.set(sgn*.045,.107,.096);  // 瞳孔
  }
  const nose=add(new THREE.ConeGeometry(.020,.048,6), mSkin, headG);                 // 鼻
  nose.rotation.x=Math.PI*.5; nose.position.set(0,.084,.094);
  add(new THREE.BoxGeometry(.066,.020,.014), mRed, headG).position.set(0,.046,.094); // 嘴（加大）

  /* ---------- 手臂（肩 1.40 → 肘 1.10 → 腕 0.84） ---------- */
  const arms=[];
  for(const sgn of [-1,1]){
    const sh=new THREE.Group(); sh.position.set(sgn*.195,.50,0); torso.add(sh);      // 世界 1.40
    add(new THREE.CylinderGeometry(.055,.045,.30,7), mCloth, sh).position.y=-.15;
    const el=new THREE.Group(); el.position.y=-.30; sh.add(el);
    add(new THREE.SphereGeometry(.046,7,5), mCloth, el).position.y=-.02;             // 肘
    add(new THREE.CylinderGeometry(.042,.036,.26,7), mCloth, el).position.y=-.15;
    const hand=add(new THREE.BoxGeometry(.062,.10,.038), mSkin, el);                 // 手
    hand.position.y=-.32;
    add(new THREE.BoxGeometry(.028,.055,.032), mSkin, el).position.set(sgn*-.040,-.295,.004); // 拇指
    arms.push({sh,el});
  }

  /* ---------- 手电 ---------- */
  if(opt.torch!==false){
    const lamp=new THREE.SpotLight(0xffe3c6, 48, 15, 0.62, 0.9, 1.6);
    lamp.position.set(.17, 1.30, .2); lamp.castShadow=false;
    const tgt=new THREE.Object3D(); tgt.position.set(.17, 1.0, 6);
    root.add(tgt); lamp.target=tgt; root.add(lamp);
  }

  function update(phase, speed, run){
    const amp=Math.min(.8, .20+speed*.18);
    const sw=Math.sin(phase), sw2=Math.sin(phase+Math.PI);
    legs[0].hip.rotation.x= sw*amp;  legs[1].hip.rotation.x= sw2*amp;
    legs[0].knee.rotation.x=Math.max(0,-sw)*amp*1.6;
    legs[1].knee.rotation.x=Math.max(0,-sw2)*amp*1.6;
    arms[0].sh.rotation.x=-sw*amp*.75;  arms[1].sh.rotation.x=-sw2*amp*.75;
    arms[0].el.rotation.x=-Math.abs(sw)*.26-.10;
    arms[1].el.rotation.x=-Math.abs(sw2)*.26-.10;
    body.position.y=Math.abs(Math.sin(phase))*.026;
    torso.rotation.z=Math.sin(phase)*.022;
    torso.rotation.y=Math.sin(phase)*.038;
    const lean=run?.15:.035;
    torso.rotation.x += (lean-torso.rotation.x)*.12;
    headG.rotation.x=-torso.rotation.x*.7+Math.sin(phase*2)*.010;
    headG.rotation.y=-torso.rotation.y*.5;
  }
  update(0,0,false);
  return {root, update, legs, arms};
}

// 三名演示"逃生者"（联机时会换成真实玩家）
// 暂时不生成多余的 NPC：地图上只有「你」和「鬼」两个实体
// （以后做联机时，其他玩家/鬼的模型再从这里按人数生成）
const walkers=[];

/* ---------- 11. 后期：暗角 + 胶片颗粒 ---------- */
const ovScene=new THREE.Scene();
const ovCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const ovUni={uTime:{value:0}, uStress:{value:0}, uRes:{value:new THREE.Vector2(innerWidth,innerHeight)}};
ovScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.ShaderMaterial({
  uniforms:ovUni, transparent:true, depthTest:false, depthWrite:false,
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`
    precision highp float; varying vec2 vUv; uniform float uTime; uniform float uStress; uniform vec2 uRes;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 c=vUv-0.5;
      float vig=smoothstep(0.95,0.22-uStress*0.30,length(c*vec2(1.12,1.0)));
      float g=hash(vUv*uRes+fract(uTime)*97.0);
      float a=(1.0-vig)*0.90 + (g-0.5)*0.06 + uStress*0.055*sin(uTime*6.5);
      gl_FragColor=vec4(vec3(0.002,0.008,0.010), clamp(a,0.0,1.0));
    }`
})));
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
  ovUni.uRes.value.set(innerWidth,innerHeight);
});


/* ================= 鬼检查柜子 / 砍伤 / 背包 ================= */
let HURT=false, CHECK={on:false,t:0}, BAG=false;
// 伤害分级：0 正常 / 1 掉胳膊 / 2 掉腿（只能爬，且不能再被砍）/ 3 出局
let HURT_LV=0, DEAD=false;
// 鬼的左键挥刀
let ATK={on:false,t:0,miss:false,dur:0.55};

function hitPlayer(){
  // 兼容旧调用：真正逻辑在 applyHit
  applyHit();
}
function applyHit(){
  if(GV.on) return;
  if(DEAD) return;
  // 硬保底：两次砍中至少间隔 2.8 秒（不管是 AI 鬼还是玩家鬼、也不管哪条代码路径触发）
  const _now = performance.now();
  if(_now - (window.__LAST_HIT_AT || 0) < 2800) return;
  window.__LAST_HIT_AT = _now;
  // 躲柜子里被砍：立刻被拽到门外，马上能跑（不用等玩家自己按 E）
  try{ if(typeof HIDE !== 'undefined' && HIDE.hidden) forceOutOfHide(); }catch(e){}
  if(HURT_LV>=2) return;              // 掉腿状态下鬼不能再砍
  HURT_LV++;
  stamina = 1;                        // 被砍一刀 → 体力立刻回满（肾上腺素）
  try{ exhausted = false; }catch(e){}

  Sound.heart();
  scream();                       // 玩家的惨叫
  jumpScare();                    // 鬼跳脸 CG（只对玩家）
  elRed.style.opacity='0.9';
  setTimeout(()=>{ elRed.style.opacity='0'; }, 900);

  if(HURT_LV===1){
    // 掉一条胳膊（右臂）
    if(BODY.arms && BODY.arms[1]) BODY.arms[1].sh.visible=false;
    STAM_MAX = Math.max(4, CFG.道具.皮鞋疾跑上限 - 4);
    stumps(1);
    toastTip('右臂被砍断！疾跑上限下降');
  } else if(HURT_LV===2){
    // 掉一条腿（左腿）→ 只能爬
    if(BODY.legs && BODY.legs[0]) BODY.legs[0].hip.visible=false;
    stumps(2);
    toastTip('左腿被砍断！你只能爬行，无法开门和开抽屉');
    // 单人模式：被砍两刀直接判负
    if(AI.mode==='single' && AI.role==='human'){
      DEAD = true; try{ SFX.play('playerDie'); }catch(e){} try{ SFX.play('playerDie'); }catch(e){}
      if(ghost.userData.body) ghost.userData.body.root.visible = true;
      showDead();
    }
  } else if(HURT_LV>=3){
    DEAD = true;
    showDead();
  }
}
// 断口：在身体上补一块暗红创面
function stumps(level){
  if(!BODY.root) return;
  const m=new THREE.MeshStandardMaterial({color:0x3a0d0b, roughness:.95, emissive:0x1a0403, emissiveIntensity:.5});
  for(let i=0;i<3;i++){
    const g=new THREE.Mesh(new THREE.SphereGeometry(.055+Math.random()*.03,7,5), m);
    g.position.set((Math.random()-.5)*.18, level===1?1.36:0.88, (Math.random()-.5)*.12);
    BODY.root.add(g);
  }
}

// —— 玩家的惨叫 ——
function scream(){ try{ Sound.scream(); }catch(e){} }

// —— 鬼跳脸 CG（1 秒，只给玩家看）——
function jumpScare(){
  try{ if(SFX.play('jumpScare')){ /* 已播真实跳脸音 */ } }catch(e){}
  if(!STARTED || DEAD) return;          // 回主界面 / 已经死了：绝对不再弹脸
  let el = document.getElementById('jumpScare');
  if(!el){
    el = document.createElement('div');
    el.id = 'jumpScare';
    const c = document.createElement('canvas');
    c.width = 900; c.height = 900;
    el.appendChild(c);
    document.body.appendChild(el);
    drawScareFace(c);
  }
  el.classList.remove('on');
  void el.offsetWidth;          // 强制重排，动画能重播
  el.classList.add('on');
  clearTimeout(window.__jsT);
  window.__jsT = setTimeout(function(){ el.classList.remove('on'); }, 1000);
}


// —— 写实鬼脸贴图（由生图接口生成，素材/鬼脸.png）——
const MENU_BG = new Image();
MENU_BG.src = '素材/主界面背景.png';

// 开局后切换到的"它已经转过头"的那张图
const MENU_BG2 = new Image();
MENU_BG2.src = '素材/主界面背景-正面.png';
MENU_BG2.onload = function(){ try{ drawMenuFrame(performance.now()); }catch(e){} };
MENU_BG.onload = function(){ try{ paintMenuBackdrop(); }catch(e){} };

const FACE_IMG = new Image();
FACE_IMG.src = '素材/鬼脸.png';
FACE_IMG.onload = function(){ try{ if(typeof paintMenuBackdrop==='function') paintMenuBackdrop(); }catch(e){} };

// ================= 写实恐怖脸（菜单吊死鬼 + 跳脸共用） =================
// 参考：停尸房尸体脸 —— 青灰皮肤、无眼白的黑红眼眶、张开的黑嘴、
// 额头裂口流血、底光把眼窝压成深渊。
function drawHorrorFace(x, cx, cy, R, tilt){
  x.save();
  x.translate(cx, cy);
  if(tilt) x.rotate(tilt);

  const W = R*0.80, Hh = R*1.00;

  // ---- 脸型：青灰底 ----
  const skin = x.createRadialGradient(-W*0.25, -Hh*0.35, R*0.10, 0, Hh*0.05, R*1.15);
  skin.addColorStop(0,   '#b9c2bc');
  skin.addColorStop(0.28,'#93a09b');
  skin.addColorStop(0.58,'#6b7876');
  skin.addColorStop(0.82,'#414b4d');
  skin.addColorStop(1,   '#1b2124');
  x.fillStyle = skin;
  x.beginPath(); x.ellipse(0, 0, W, Hh, 0, 0, Math.PI*2); x.fill();

  // ---- 两侧压暗（把脸从背景里切出来）----
  x.save();
  x.filter = 'blur(' + (R*0.10).toFixed(1) + 'px)';
  const sideL = x.createLinearGradient(-W, 0, -W*0.15, 0);
  sideL.addColorStop(0,'rgba(6,8,9,.92)'); sideL.addColorStop(1,'rgba(6,8,9,0)');
  x.fillStyle = sideL; x.beginPath(); x.ellipse(0,0,W,Hh,0,0,7); x.fill();
  const sideR = x.createLinearGradient(W, 0, W*0.15, 0);
  sideR.addColorStop(0,'rgba(6,8,9,.92)'); sideR.addColorStop(1,'rgba(6,8,9,0)');
  x.fillStyle = sideR; x.beginPath(); x.ellipse(0,0,W,Hh,0,0,7); x.fill();

  // ---- 眼窝 / 颧骨 / 太阳穴的凹陷 ----
  const socket = (sx, sy, rx, ry, a) => {
    const g = x.createRadialGradient(sx, sy, 0, sx, sy, Math.max(rx,ry));
    g.addColorStop(0, 'rgba(4,5,7,'+a+')');
    g.addColorStop(0.65,'rgba(8,10,12,'+(a*0.55)+')');
    g.addColorStop(1, 'rgba(8,10,12,0)');
    x.fillStyle = g;
    x.beginPath(); x.ellipse(sx, sy, rx, ry, 0, 0, 7); x.fill();
  };
  socket(-W*0.36, -Hh*0.16, W*0.34, Hh*0.26, .95);
  socket( W*0.36, -Hh*0.16, W*0.34, Hh*0.26, .95);
  socket(-W*0.55,  Hh*0.10, W*0.30, Hh*0.30, .75);
  socket( W*0.55,  Hh*0.10, W*0.30, Hh*0.30, .75);
  socket(0, Hh*0.62, W*0.55, Hh*0.22, .80);          // 下颌阴影
  x.restore();

  // ---- 额头/鼻梁/下巴的底光高光 ----
  x.save();
  x.filter = 'blur(' + (R*0.09).toFixed(1) + 'px)';
  const key = x.createRadialGradient(0, -Hh*0.42, R*0.02, 0, -Hh*0.10, R*0.85);
  key.addColorStop(0, 'rgba(228,236,230,.55)');
  key.addColorStop(0.35,'rgba(190,205,198,.24)');
  key.addColorStop(1, 'rgba(190,205,198,0)');
  x.fillStyle = key;
  x.beginPath(); x.ellipse(0, -Hh*0.35, W*0.70, Hh*0.42, 0, 0, 7); x.fill();
  x.restore();

  // ---- 眉骨阴影 ----
  x.save();
  x.filter = 'blur(' + (R*0.05).toFixed(1) + 'px)';
  x.fillStyle = 'rgba(10,12,14,.55)';
  x.beginPath(); x.ellipse(-W*0.33, -Hh*0.30, W*0.28, Hh*0.07, -0.10, 0, 7); x.fill();
  x.beginPath(); x.ellipse( W*0.33, -Hh*0.30, W*0.28, Hh*0.07,  0.10, 0, 7); x.fill();
  x.restore();

  // ---- 眼睛：大、圆、没有眼白 ----
  for(const sx of [-1, 1]){
    const ex = sx * W*0.34, ey = -Hh*0.15;
    const ew = W*0.235, eh = Hh*0.165;
    // 眼眶黑底
    x.fillStyle = '#050608';
    x.beginPath(); x.ellipse(ex, ey, ew*1.18, eh*1.22, sx*0.06, 0, 7); x.fill();
    // 暗红充血
    const red = x.createRadialGradient(ex, ey, 0, ex, ey, ew*1.05);
    red.addColorStop(0,   '#5c0f10');
    red.addColorStop(0.55,'#2a0709');
    red.addColorStop(1,   '#070405');
    x.fillStyle = red;
    x.beginPath(); x.ellipse(ex, ey, ew, eh, 0, 0, 7); x.fill();
    // 虹膜/瞳孔（纯黑，带一点湿光）
    x.fillStyle = '#000';
    x.beginPath(); x.ellipse(ex + sx*ew*0.06, ey + eh*0.05, ew*0.62, eh*0.66, 0, 0, 7); x.fill();
    const wet = x.createRadialGradient(ex - sx*ew*0.22, ey - eh*0.30, 0, ex - sx*ew*0.22, ey - eh*0.30, ew*0.42);
    wet.addColorStop(0,'rgba(235,240,238,.78)');
    wet.addColorStop(1,'rgba(235,240,238,0)');
    x.fillStyle = wet;
    x.beginPath(); x.ellipse(ex - sx*ew*0.20, ey - eh*0.28, ew*0.30, eh*0.26, 0, 0, 7); x.fill();
    // 眼周血丝
    x.strokeStyle = 'rgba(120,16,16,.55)'; x.lineWidth = Math.max(1, R*0.012);
    for(let i=0;i<5;i++){
      const a = (i/5)*Math.PI*2 + (sx>0?0.3:1.1);
      x.beginPath();
      x.moveTo(ex + Math.cos(a)*ew*1.05, ey + Math.sin(a)*eh*1.05);
      x.quadraticCurveTo(ex + Math.cos(a)*ew*1.35, ey + Math.sin(a)*eh*1.45,
                         ex + Math.cos(a)*ew*1.7,  ey + Math.sin(a)*eh*1.9);
      x.stroke();
    }
  }

  // ---- 鼻子 ----
  x.save();
  x.filter = 'blur(' + (R*0.04).toFixed(1) + 'px)';
  x.fillStyle = 'rgba(20,24,26,.55)';
  x.beginPath(); x.ellipse(0, Hh*0.10, W*0.09, Hh*0.20, 0, 0, 7); x.fill();   // 鼻梁侧影
  x.restore();
  x.fillStyle = 'rgba(8,9,11,.92)';
  x.beginPath(); x.ellipse(-W*0.085, Hh*0.215, W*0.055, Hh*0.038, -0.25, 0, 7); x.fill();
  x.beginPath(); x.ellipse( W*0.085, Hh*0.215, W*0.055, Hh*0.038,  0.25, 0, 7); x.fill();

  // ---- 嘴：微张，黑唇，露齿 ----
  const my = Hh*0.47;
  x.fillStyle = '#0a0507';
  x.beginPath(); x.ellipse(0, my, W*0.30, Hh*0.115, 0, 0, 7); x.fill();
  // 嘴唇
  x.strokeStyle = '#1d1114'; x.lineWidth = Math.max(2, R*0.05);
  x.beginPath(); x.ellipse(0, my, W*0.30, Hh*0.115, 0, 0, 7); x.stroke();
  // 牙
  x.fillStyle = 'rgba(196,188,172,.85)';
  const tw = W*0.44, ty = my - Hh*0.055;
  for(let i=0;i<7;i++){
    x.fillRect(-tw/2 + i*(tw/7) + 1, ty, tw/7 - 2, Hh*0.045);
  }
  // 舌头
  x.fillStyle = '#3b0f12';
  x.beginPath(); x.ellipse(0, my + Hh*0.045, W*0.14, Hh*0.035, 0, 0, 7); x.fill();

  // ---- 额头裂口 + 血流 ----
  x.fillStyle = '#2a0508';
  x.beginPath();
  x.moveTo(-W*0.10, -Hh*0.62); x.lineTo(W*0.12, -Hh*0.66);
  x.lineTo(W*0.06, -Hh*0.50);  x.lineTo(-W*0.06, -Hh*0.48);
  x.closePath(); x.fill();
  x.strokeStyle = 'rgba(92,8,10,.85)';
  x.lineCap = 'round';
  for(let i=0;i<6;i++){
    const sx0 = -W*0.08 + i*W*0.05;
    x.lineWidth = Math.max(1, R*(0.028 - i*0.002));
    x.beginPath();
    x.moveTo(sx0, -Hh*0.55);
    x.bezierCurveTo(sx0 + (Math.random()-.5)*W*0.10, -Hh*0.30,
                    sx0 + (Math.random()-.5)*W*0.16, -Hh*0.05,
                    sx0 + (Math.random()-.5)*W*0.20,  Hh*(0.10+Math.random()*0.25));
    x.stroke();
  }
  // 嘴角往下流
  x.strokeStyle = 'rgba(50,6,8,.9)'; x.lineWidth = Math.max(2, R*0.03);
  x.beginPath(); x.moveTo(-W*0.26, my + Hh*0.08);
  x.quadraticCurveTo(-W*0.30, my + Hh*0.22, -W*0.24, my + Hh*0.34); x.stroke();

  // ---- 头发：湿、乱、贴着头 ----
  x.fillStyle = '#0b0908';
  x.beginPath();
  x.moveTo(-W*1.02, -Hh*0.30);
  x.quadraticCurveTo(-W*0.9, -Hh*1.15, 0, -Hh*1.12);
  x.quadraticCurveTo(W*0.9, -Hh*1.15, W*1.02, -Hh*0.30);
  x.quadraticCurveTo(W*0.6, -Hh*0.72, W*0.2, -Hh*0.62);
  x.quadraticCurveTo(0, -Hh*0.70, -W*0.2, -Hh*0.62);
  x.quadraticCurveTo(-W*0.6, -Hh*0.72, -W*1.02, -Hh*0.30);
  x.closePath(); x.fill();
  // 垂下来的发丝
  x.strokeStyle = '#0b0908';
  for(let i=0;i<14;i++){
    const hx = -W*0.95 + (i/13)*W*1.9;
    x.lineWidth = Math.max(1, R*(0.02+Math.random()*0.02));
    x.beginPath(); x.moveTo(hx, -Hh*0.72);
    x.quadraticCurveTo(hx + (Math.random()-.5)*W*0.25, -Hh*0.2,
                       hx + (Math.random()-.5)*W*0.4,  Hh*(0.15+Math.random()*0.5));
    x.stroke();
  }

  // ---- 皮肤颗粒（很近才看得见，但会让脸不像塑料）----
  for(let i=0;i<180;i++){
    const a = Math.random()*Math.PI*2, rr2 = Math.sqrt(Math.random());
    const px = Math.cos(a)*W*rr2*0.92, py = Math.sin(a)*Hh*rr2*0.92;
    x.fillStyle = 'rgba(30,38,38,'+(0.05+Math.random()*0.14)+')';
    x.fillRect(px, py, Math.max(1,R*0.012), Math.max(1,R*0.012));
  }

  x.restore();
}

function drawScareFace(c){
  const x = c.getContext('2d'), W=c.width, H=c.height;
  x.fillStyle='#000'; x.fillRect(0,0,W,H);
  if(FACE_IMG.complete && FACE_IMG.naturalWidth>0){
    // 照片级鬼脸：铺满 + 稍微放大裁切，视线压迫更强
    const iw=FACE_IMG.naturalWidth, ih=FACE_IMG.naturalHeight;
    const sc=Math.max(W/iw, H/ih)*1.06;
    const dw=iw*sc, dh=ih*sc;
    x.drawImage(FACE_IMG, (W-dw)/2, (H-dh)/2 - H*0.02, dw, dh);
  } else {
    drawHorrorFace(x, W/2, H*0.52, W*0.46, 0);
  }
  const vig = x.createRadialGradient(W/2,H/2,H*0.30,W/2,H/2,H*0.80);
  vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,.88)');
  x.fillStyle=vig; x.fillRect(0,0,W,H);
}


// ================= 3.0-C：主界面动态背景 =================
// 你给的背景图 + 我加的：人影轻摆、灯管闪、地面渗血、灰尘、进场镜头
const MENU_ANIM = { t:0, intro:0, cb:null, ambT:4, last:0, stare:0, stareT:0, turn:0, turnT:0, sw:0, swT:0 };


// 把鬼脸做成一张边缘羽化、压暗过的贴图，贴在场景里才不突兀
function getMaskedFace(){
  if(MENU_ANIM.faceCache) return MENU_ANIM.faceCache;
  if(!(FACE_IMG.complete && FACE_IMG.naturalWidth>0)) return null;
  const S = 256;
  const cv = document.createElement('canvas'); cv.width=S; cv.height=S;
  const q = cv.getContext('2d');
  q.drawImage(FACE_IMG, 0, 0, S, S);
  // 圆形羽化
  q.globalCompositeOperation = 'destination-in';
  const g = q.createRadialGradient(S/2,S/2,S*0.18,S/2,S/2,S*0.5);
  g.addColorStop(0,'rgba(0,0,0,1)');
  g.addColorStop(0.70,'rgba(0,0,0,1)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  q.fillStyle = g; q.fillRect(0,0,S,S);
  // 压暗 + 往冷色偏，融进这张青灰色走廊
  q.globalCompositeOperation = 'source-atop';
  q.fillStyle = 'rgba(12,18,22,.66)'; q.fillRect(0,0,S,S);
  const lg = q.createLinearGradient(0,0,0,S);
  lg.addColorStop(0,'rgba(150,170,175,.10)');
  lg.addColorStop(0.55,'rgba(0,0,0,0)');
  lg.addColorStop(1,'rgba(0,0,0,.35)');
  q.fillStyle = lg; q.fillRect(0,0,S,S);
  MENU_ANIM.faceCache = cv;
  return cv;
}

function drawMenuFrame(ts){
  const c = document.getElementById('menuArt');
  if(!c || !(MENU_BG.complete && MENU_BG.naturalWidth>0)) return;
  if(c.width!==1280){ c.width=1280; c.height=720; }
  const x = c.getContext('2d'), W=1280, H=720;
  const t = ts/1000;

  x.clearRect(0,0,W,H);

  // —— 背景：缓慢呼吸式摇镜（人影跟着左右轻摆）——
  const iw=MENU_BG.naturalWidth, ih=MENU_BG.naturalHeight;
  const base = Math.max(W/iw, H/ih) * 1.04;
  const swayX = Math.sin(t*0.55)*7 + Math.sin(t*1.7)*2;
  const swayY = Math.cos(t*0.42)*4;
  const zoom  = 1 + Math.sin(t*0.33)*0.006 + (MENU_ANIM.intro>0 ? MENU_ANIM.intro*1.25 : 0);
  const sc = base*zoom;
  const px = (W - iw*sc)/2 + swayX - MENU_ANIM.intro*W*0.22;
  const py = (H - ih*sc)/2 + swayY - MENU_ANIM.intro*H*0.16;
  // 转头盯着你：以鬼的头部为锚点缓慢推近，开始之后一直保持
  const st = MENU_ANIM.stare || 0;
  x.save();
  if(st>0.001){
    const Z = 1 + st*0.05;
    x.translate(W*0.72, H*0.30); x.scale(Z,Z); x.translate(-W*0.72,-H*0.30);
  }
  x.drawImage(MENU_BG, px, py, iw*sc, ih*sc);

  // —— 交叉溶解到第二张（转过头后的画面）——
  const sw = MENU_ANIM.sw || 0;
  if(sw >= 0.5 && MENU_BG2.complete && MENU_BG2.naturalWidth>0){
    const iw2 = MENU_BG2.naturalWidth, ih2 = MENU_BG2.naturalHeight;
    const sc2 = Math.max(W/iw2, H/ih2) * 1.04 * zoom;
    const px2 = (W - iw2*sc2)/2 + swayX*0.7;
    const py2 = (H - ih2*sc2)/2 + swayY*0.7;
    x.drawImage(MENU_BG2, px2, py2, iw2*sc2, ih2*sc2);
  }
  x.restore();

  // 切换的一瞬间压一下亮度，把两张图的构图差异"盖"过去
  // 灯管熄灭 → 换图 → 灯管亮起：中间是全黑，所以看不到"两张图重叠"
  if(sw > 0.01 && sw < 0.99){
    const dk = Math.pow(Math.sin(Math.PI*sw), 0.5);
    x.fillStyle = 'rgba(2,3,4,' + (dk*0.97) + ')';
    x.fillRect(0,0,W,H);
  }
  if(st>0.05){
    const gg = x.createRadialGradient(W*0.723,H*0.258,0,W*0.723,H*0.258,W*0.09);
    gg.addColorStop(0,'rgba(150,14,16,'+(0.20*st)+')');
    gg.addColorStop(1,'rgba(120,10,12,0)');
    x.fillStyle=gg; x.beginPath(); x.arc(W*0.723,H*0.258,W*0.09,0,7); x.fill();
  }

  // —— 暗角（左侧留给菜单，右侧压暗）——
  const vg = x.createRadialGradient(W*0.55,H*0.48,H*0.22,W*0.55,H*0.5,H*0.85);
  vg.addColorStop(0,'rgba(0,0,0,0)');
  vg.addColorStop(0.62,'rgba(0,0,0,.38)');
  vg.addColorStop(1,'rgba(0,0,0,.90)');
  x.fillStyle=vg; x.fillRect(0,0,W,H);
  const lg = x.createLinearGradient(0,0,W*0.42,0);
  lg.addColorStop(0,'rgba(2,4,6,.92)');
  lg.addColorStop(0.7,'rgba(2,4,6,.55)');
  lg.addColorStop(1,'rgba(2,4,6,0)');
  x.fillStyle=lg; x.fillRect(0,0,W*0.42,H);

  // —— 进场：红灯一闪 ——
  if(MENU_ANIM.intro>0.55){
    const k = (MENU_ANIM.intro-0.55)/0.45;
    x.fillStyle='rgba(120,10,10,'+(k*0.85)+')';
    x.fillRect(0,0,W,H);
  }
  if(MENU_ANIM.intro>0.9){
    x.fillStyle='rgba(0,0,0,'+((MENU_ANIM.intro-0.9)/0.1)+')';
    x.fillRect(0,0,W,H);
  }
}

let _menuRaf = 0;
function menuTick(ts){
  _menuRaf = requestAnimationFrame(menuTick);
  const c = document.getElementById('menuArt');
  if(!c) return;
  // 只在主菜单显示时动
  const ui = document.getElementById('ui');
  const menuVisible = ui && !ui.classList.contains('hide');
  if(!menuVisible) return;

  const dt = MENU_ANIM.last ? Math.max(0, Math.min(0.1,(ts-MENU_ANIM.last)/1000)) : 0;
  MENU_ANIM.last = ts;

  if(MENU_ANIM.intro>0){
    MENU_ANIM.intro = Math.min(1, MENU_ANIM.intro + dt/1.15);
    if(MENU_ANIM.intro>=1 && MENU_ANIM.cb){
      const cb = MENU_ANIM.cb; MENU_ANIM.cb = null;
      MENU_ANIM.intro = 0;
      MENU_ANIM.stareT = 1;
      setTimeout(function(){
        cb && cb();
        MENU_ANIM.swT = 1;                 // 换到"转过头"的那张，1.3 秒柔和过渡
      }, 160);
    }
  }
  MENU_ANIM.stare += (MENU_ANIM.stareT - MENU_ANIM.stare) * Math.min(1, dt*1.6);
  if(MENU_ANIM.swT > MENU_ANIM.sw) MENU_ANIM.sw = Math.min(1, MENU_ANIM.sw + dt/1.3);
  else if(MENU_ANIM.swT < MENU_ANIM.sw) MENU_ANIM.sw = Math.max(0, MENU_ANIM.sw - dt/0.5);
  if(MENU_ANIM.turnT > MENU_ANIM.turn){
    MENU_ANIM.turn = Math.min(1, MENU_ANIM.turn + dt/1.6);
    if(MENU_ANIM.turn > 0.4 && !MENU_ANIM._gasp){ MENU_ANIM._gasp = true; try{ Sound.heart(); }catch(e){} }
  } else if(MENU_ANIM.turnT < MENU_ANIM.turn){
    MENU_ANIM.turn = Math.max(0, MENU_ANIM.turn - dt/0.4);
  }
  drawMenuFrame(ts);

  // 环境音：水滴 + 电流（浏览器要求先有一次点击才允许出声）
  MENU_ANIM.ambT -= dt;
  if(MENU_ANIM.ambT <= 0){
    MENU_ANIM.ambT = 3.5 + Math.random()*5;
    try{ Math.random()<0.6 ? Sound.drip() : Sound.crackle(); }catch(e){}
  }
}

// 点「开始游戏」：镜头怼向鬼的脸 → 红闪 → 黑场 → 切换
function playMenuIntro(cb){
  if(MENU_ANIM.intro>0) return;
  MENU_ANIM.intro = 0.001;
  MENU_ANIM.cb = cb;
  try{ Sound.heart(); }catch(e){}
}

// 进入游戏时整体淡入
function fadeIntoGame(){
  let el = document.getElementById('gameFade');
  if(!el){
    el = document.createElement('div');
    el.id='gameFade';
    el.style.cssText='position:fixed;inset:0;background:#000;z-index:75;pointer-events:none;opacity:0;transition:opacity 1.1s ease';
    document.body.appendChild(el);
  }
  el.style.transition='none'; el.style.opacity='1';
  void el.offsetWidth;
  el.style.transition='opacity 1.2s ease';
  el.style.opacity='0';
}

try{ requestAnimationFrame(menuTick); }catch(e){}

// 第一次交互后打开音频（菜单里的水滴/电流声）
(function(){
  const kick = function(){
    try{ Sound.init(); }catch(e){}
    window.removeEventListener('pointerdown', kick);
    window.removeEventListener('keydown', kick);
  };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);
})();

// —— 主界面：一张独立的恐怖贴图（不是游戏画面）——
function paintMenuBackdrop(){
  // 菜单美术画在一块独立的 <canvas> 上（放在 3D 画布之上、UI 之下）
  // 注意：不能用 toDataURL——file:// 下贴图会污染画布
  let c=document.getElementById('menuArt');
  if(!c){
    c=document.createElement('canvas'); c.id='menuArt';
    c.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:5;pointer-events:none';
    const ui=document.getElementById('ui');
    document.body.insertBefore(c, ui || null);
  }
  const W=1280, H=720;
  if(c.width!==W){ c.width=W; c.height=H; }
  const x=c.getContext('2d');
  x.clearRect(0,0,W,H);

  // 用户自带的背景图优先：素材/主界面背景.png
  if(MENU_BG.complete && MENU_BG.naturalWidth>0){
    const iw=MENU_BG.naturalWidth, ih=MENU_BG.naturalHeight;
    const sc=Math.max(W/iw, H/ih);
    const dw=iw*sc, dh=ih*sc;
    x.drawImage(MENU_BG, (W-dw)/2, (H-dh)/2, dw, dh);
    return;
  }
  // 底：脏墙
  x.fillStyle='#171c22'; x.fillRect(0,0,W,H);
  for(let i=0;i<9000;i++){
    const px=Math.random()*W, py=Math.random()*H, v=Math.random();
    x.fillStyle='rgba('+(55+v*95|0)+','+(58+v*92|0)+','+(60+v*88|0)+','+(0.10+v*0.30)+')';
    x.fillRect(px,py,1+Math.random()*2,1+Math.random()*2);
  }
  // 中央暗红手印 / 血迹
  for(let i=0;i<7;i++){
    const px=W*(0.15+Math.random()*0.7), py=H*(0.2+Math.random()*0.65), R=30+Math.random()*90;
    const g=x.createRadialGradient(px,py,0,px,py,R);
    g.addColorStop(0,'rgba(158,20,16,.72)'); g.addColorStop(1,'rgba(90,10,9,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,R,0,7); x.fill();
  }
  // 竖向拖痕
  x.strokeStyle='rgba(130,14,12,.60)';
  for(let i=0;i<26;i++){
    x.lineWidth=1+Math.random()*3;
    const px=Math.random()*W, py=H*(0.15+Math.random()*0.35);
    x.beginPath(); x.moveTo(px,py); x.lineTo(px+(Math.random()-.5)*20, py+H*(0.1+Math.random()*0.35)); x.stroke();
  }
  // ===== 吊死鬼：从天花板垂下来的尸体 =====
  (function(){
    const cx = W*0.735;
    const topY = 0;
    const neckY = H*0.335;

    // 天花板横梁阴影
    const ceil = x.createLinearGradient(0,0,0,H*0.20);
    ceil.addColorStop(0,'rgba(4,4,5,.98)'); ceil.addColorStop(1,'rgba(4,4,5,0)');
    x.fillStyle=ceil; x.fillRect(0,0,W,H*0.20);

    // 背后那点冷光（把尸体从黑暗里"抠"出来）
    const back = x.createRadialGradient(cx, H*0.34, 20, cx, H*0.36, H*0.42);
    back.addColorStop(0,'rgba(120,140,135,.16)');
    back.addColorStop(.45,'rgba(60,80,78,.07)');
    back.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=back; x.fillRect(cx-H*0.45, 0, H*0.9, H*0.9);

    // 绳
    x.strokeStyle='#7a6647'; x.lineWidth=6;
    x.beginPath(); x.moveTo(cx, topY); x.lineTo(cx+3, H*0.352); x.stroke();
    // 绳圈
    x.strokeStyle='#a58c5e'; x.lineWidth=5;
    x.beginPath(); x.ellipse(cx+3, H*0.368, 24, 30, 0.10, 0, Math.PI*2); x.stroke();
    // 吊绳勒痕
    x.strokeStyle='rgba(40,10,14,.9)'; x.lineWidth=7;
    x.beginPath(); x.moveTo(cx-16, H*0.392); x.lineTo(cx+20, H*0.392); x.stroke();

    // 身体（微微侧吊）
    x.save();
    x.translate(cx+3, -H*0.02);
    x.scale(1.30, 1.28);          // 放大，压迫感更强
    x.rotate(0.045);

    // 腿（带明暗渐变，像尸体不是火柴棍）
    const legGrad = x.createLinearGradient(-30, 0, 30, 0);
    legGrad.addColorStop(0,'#1a1d21'); legGrad.addColorStop(.45,'#333a41'); legGrad.addColorStop(1,'#15181b');
    x.strokeStyle=legGrad; x.lineWidth=19; x.lineCap='round';
    x.beginPath(); x.moveTo(-6, H*0.545); x.lineTo(-16, H*0.70); x.lineTo(-26, H*0.805); x.stroke();
    x.beginPath(); x.moveTo(8,  H*0.545); x.lineTo(16,  H*0.705); x.lineTo(28, H*0.80); x.stroke();
    // 裤腿破口
    x.strokeStyle='rgba(90,12,12,.5)'; x.lineWidth=4;
    x.beginPath(); x.moveTo(-20,H*0.735); x.lineTo(-14,H*0.756); x.stroke();
    // 鞋
    x.fillStyle='#101214';
    x.beginPath(); x.ellipse(-26, H*0.812, 15, 9, 0.3, 0, 7); x.fill();
    x.beginPath(); x.ellipse(28,  H*0.806, 15, 9, -0.2, 0, 7); x.fill();

    // 躯干（破旧病号服，带褶皱和阴影）
    const torso = x.createLinearGradient(-44,0,44,0);
    torso.addColorStop(0,'#15191d'); torso.addColorStop(.28,'#2f363d');
    torso.addColorStop(.55,'#454d55'); torso.addColorStop(.8,'#242a30'); torso.addColorStop(1,'#0f1215');
    x.fillStyle=torso;
    x.beginPath();
    x.moveTo(-31, H*0.352);
    x.quadraticCurveTo(-4, H*0.338, 29, H*0.352);
    x.quadraticCurveTo(37, H*0.45, 35, H*0.548);
    x.quadraticCurveTo(0, H*0.565, -35, H*0.548);
    x.quadraticCurveTo(-38, H*0.45, -31, H*0.352);
    x.closePath(); x.fill();
    // 衣褶
    x.strokeStyle='rgba(8,10,12,.55)'; x.lineWidth=3; x.lineCap='round';
    for(let i=0;i<5;i++){
      const fx=-22+i*11;
      x.beginPath(); x.moveTo(fx, H*0.372);
      x.quadraticCurveTo(fx+(i%2?4:-4), H*0.45, fx+(i%2?2:-2), H*0.535); x.stroke();
    }
    // 下摆的破布条
    x.fillStyle='#20262c';
    for(let i=0;i<7;i++){
      const bx=-33+i*10;
      x.beginPath();
      x.moveTo(bx, H*0.545); x.lineTo(bx+6, H*0.545);
      x.lineTo(bx+4, H*0.585+ (i%3)*4); x.lineTo(bx+1, H*0.548);
      x.closePath(); x.fill();
    }
    // 衣服上的血
    x.fillStyle='rgba(96,10,10,.55)';
    x.beginPath(); x.ellipse(6, H*0.47, 16, 26, 0.2, 0, 7); x.fill();

    // 手臂（青灰皮肤，有明暗）
    const armGrad = x.createLinearGradient(-50,0,50,0);
    armGrad.addColorStop(0,'#5d574d'); armGrad.addColorStop(.5,'#938a7c'); armGrad.addColorStop(1,'#4a453d');
    x.strokeStyle=armGrad; x.lineWidth=14; x.lineCap='round';
    x.beginPath(); x.moveTo(-28, H*0.372); x.lineTo(-43, H*0.52); x.lineTo(-38, H*0.632); x.stroke();
    x.beginPath(); x.moveTo(26,  H*0.372); x.lineTo(41,  H*0.505); x.lineTo(47, H*0.618); x.stroke();
    // 手臂上的淤青/血
    x.strokeStyle='rgba(70,30,34,.45)'; x.lineWidth=5;
    x.beginPath(); x.moveTo(-36,H*0.47); x.lineTo(-40,H*0.52); x.stroke();
    // 手
    x.fillStyle='#9a9184';
    x.beginPath(); x.ellipse(-38, H*0.642, 9, 12, 0.1, 0, 7); x.fill();
    x.beginPath(); x.ellipse(47,  H*0.628, 9, 12, -0.1, 0, 7); x.fill();

    // ===== 剪影：把四肢收进一团黑影，和写实头统一 =====
    x.save();
    x.globalAlpha = 0.94;
    const silGrad = x.createLinearGradient(-50,0,50,0);
    silGrad.addColorStop(0,'#05070a'); silGrad.addColorStop(.45,'#0d1115');
    silGrad.addColorStop(.62,'#171d22'); silGrad.addColorStop(1,'#05070a');
    x.fillStyle = silGrad;
    x.beginPath();
    // 肩 → 躯干 → 腿，一整块
    x.moveTo(-52, H*0.378);
    x.quadraticCurveTo(0, H*0.338, 52, H*0.378);
    x.quadraticCurveTo(42, H*0.475, 27, H*0.560);
    x.lineTo(14, H*0.700); x.lineTo(20, H*0.812);
    x.lineTo(4,  H*0.812); x.lineTo(0,  H*0.700);
    x.lineTo(-4, H*0.812); x.lineTo(-18, H*0.812);
    x.lineTo(-12, H*0.700); x.lineTo(-26, H*0.560);
    x.quadraticCurveTo(-42, H*0.475, -52, H*0.378);
    x.closePath(); x.fill();
    // 垂下的手臂也并进剪影（贴着身体）
    x.strokeStyle = '#0b0f13'; x.lineWidth = 16; x.lineCap='round';
    x.beginPath(); x.moveTo(-30,H*0.380); x.quadraticCurveTo(-44,H*0.50,-38,H*0.625); x.stroke();
    x.beginPath(); x.moveTo( 30,H*0.380); x.quadraticCurveTo( 44,H*0.495, 46,H*0.615); x.stroke();
    x.restore();
    // 左侧轮廓光（让剪影有体积）
    x.strokeStyle='rgba(150,165,160,.16)'; x.lineWidth=3;
    x.beginPath(); x.moveTo(-33,H*0.372); x.quadraticCurveTo(-30,H*0.47,-21,H*0.556); x.stroke();
    x.beginPath(); x.moveTo(-30,H*0.382); x.quadraticCurveTo(-43,H*0.50,-37,H*0.622); x.stroke();

    // 脖子（勒出的紫痕）
    x.fillStyle='#6f6558';
    x.fillRect(-9, H*0.318, 18, H*0.042);
    x.fillStyle='rgba(58,16,28,.85)';
    x.beginPath(); x.ellipse(0, H*0.335, 13, 8, 0, 0, 7); x.fill();

    // 头：写实鬼脸贴图（没有就退回到手绘脸）
    if(FACE_IMG.complete && FACE_IMG.naturalWidth>0){
      const hw = 64, hh2 = 84;
      x.save();
      x.translate(2, H*0.300); x.rotate(0.22);
      x.beginPath(); x.ellipse(0, 0, hw/2, hh2/2, 0, 0, Math.PI*2); x.clip();
      x.globalAlpha = 0.96;
      x.drawImage(FACE_IMG, -hw/2, -hh2/2 - 6, hw, hh2);
      x.globalAlpha = 1;
      // 眼窝再压黑一点，远看更吓人
      x.fillStyle='rgba(0,0,0,.35)';
      x.beginPath(); x.ellipse(-10,-8,16,12,0,0,7); x.fill();
      x.beginPath(); x.ellipse( 10,-8,16,12,0,0,7); x.fill();
      x.restore();
    } else {
      drawHorrorFace(x, 2, H*0.285, 46, 0.28);
    }

    // 脖子（连接头和肩，带勒痕）
    x.fillStyle='#151a1e';
    x.beginPath();
    x.moveTo(-13, H*0.330); x.lineTo(13, H*0.330);
    x.lineTo(16, H*0.384); x.lineTo(-16, H*0.384);
    x.closePath(); x.fill();
    x.strokeStyle='rgba(58,14,22,.9)'; x.lineWidth=6;
    x.beginPath(); x.moveTo(-13, H*0.360); x.lineTo(14, H*0.362); x.stroke();

    // 绳套（压在脖子正前方，明确"吊"的关系）
    x.strokeStyle='#8d7750'; x.lineWidth=5;
    x.beginPath(); x.moveTo(2, -H*0.06); x.lineTo(3, H*0.404); x.stroke();
    x.strokeStyle='#a98f61'; x.lineWidth=6;
    x.beginPath(); x.ellipse(3, H*0.400, 20, 13, 0.05, 0, Math.PI*2); x.stroke();
    x.restore();

    // 头顶那盏坏灯（只照尸体一圈）
    const lamp = x.createRadialGradient(cx, H*0.12, 10, cx, H*0.30, H*0.42);
    lamp.addColorStop(0,'rgba(150,160,150,.10)');
    lamp.addColorStop(.5,'rgba(90,110,100,.05)');
    lamp.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=lamp; x.fillRect(cx-H*0.45, 0, H*0.9, H*0.7);

    // 脚下的血泊 + 滴落
    const pool = x.createRadialGradient(cx, H*0.845, 4, cx, H*0.845, 120);
    pool.addColorStop(0,'rgba(110,8,8,.75)'); pool.addColorStop(.6,'rgba(70,6,6,.35)'); pool.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=pool;
    x.beginPath(); x.ellipse(cx, H*0.855, 120, 26, 0, 0, 7); x.fill();
  })();

  // 压暗 + 暗角
  const vg=x.createRadialGradient(W*0.5,H*0.45,H*0.05,W*0.5,H*0.5,H*0.85);
  vg.addColorStop(0,'rgba(0,0,0,.05)'); vg.addColorStop(0.55,'rgba(0,0,0,.38)'); vg.addColorStop(1,'rgba(0,0,0,.86)');
  x.fillStyle=vg; x.fillRect(0,0,W,H);
}


// 把上一局残留的遮罩/提示全部清干净（回菜单、死亡、重开都要调）
function resetInventory(){
  try{ INV.ink = 0; INV.shoe = 0; }catch(e){}
  try{ BAG = false; const b=document.getElementById('bag'); if(b) b.classList.remove('on'); }catch(e){}
  try{ clearKeys(); }catch(e){}
  try{ PLAYER_HAS_KEY = false; KEYS_TAKEN = 0; }catch(e){}
  try{ PROJECTILES.length = 0; }catch(e){}
  try{ updateKeyHud(); }catch(e){}
  try{ const it=document.getElementById('items'); if(it) it.style.display='none'; }catch(e){}
}
function clearTransient(){
  try{ resetInventory(); }catch(e){}
  try{
    const js = document.getElementById('jumpScare');
    if(js){ js.classList.remove('on'); js.style.opacity='0'; }
    clearTimeout(window.__jsT);
  }catch(e){}
  try{ if(typeof forceOutOfHide==='function') forceOutOfHide(); }catch(e){}
  try{
    if(typeof HIDE!=='undefined'){ HIDE.on=false; HIDE.hidden=false; HIDE.cam=null; }
    if(typeof BODY!=='undefined' && BODY.root) BODY.root.visible=false;
  }catch(e){}
  try{
    elBlack.style.opacity='0'; elSlit.style.opacity='0';
    elEdge.style.opacity='0'; elTip.style.opacity='0'; elRed.style.opacity='0';
  }catch(e){}
  try{ if(typeof ATK!=='undefined'){ ATK.on=false; ATK.t=0; } }catch(e){}
  try{ if(typeof CHECK!=='undefined'){ CHECK.on=false; CHECK.t=0; } }catch(e){}
}

function showDead(){ showDefeat(); }

// 单人失败：先显示「你失败了」，再回主界面
function showDefeat(){
  if(document.pointerLockElement) document.exitPointerLock();
  STARTED = false;
  clearTransient();
  const t=document.getElementById('winTitle');
  const hh=document.getElementById('winHint');
  const b=document.getElementById('winBtn');
  if(t)  t.textContent  = '你失败了';
  if(hh) hh.textContent = '你被鬼砍倒两次 · 5 秒后自动返回主界面';
  if(b){ b.textContent = '返回主界面'; b.onclick = function(){ backToMenu(); }; }
  showView('pWin');
  clearTimeout(window.__defeatT);
  window.__defeatT = setTimeout(backToMenu, 5000);
}
function backToMenu(){
  try{ SFX.stopAll(); SFX.music('ambience', false); SFX.music('menuMusic', true); }catch(e){}
  clearTimeout(window.__defeatT);
  if(document.pointerLockElement) document.exitPointerLock();
  // —— 回主菜单＝这一局直接作废，全部重置 ——
  try{ if(GV.on) toggleGhostView(); }catch(e){}      // 退出鬼视角
  try{ PAUSED = false; }catch(e){}
  try{ if(typeof BAG !== 'undefined' && BAG){ BAG = false; const b=document.getElementById('bag'); if(b) b.classList.remove('on'); } }catch(e){}
  try{ RADAR = false; }catch(e){}
  try{ ATK.on = false; ATK.t = 0; }catch(e){}
  try{ if(typeof CHECK !== 'undefined'){ CHECK.on=false; CHECK.t=0; CHECK.npc=null; CHECK.door=null; } }catch(e){}
  try{ respawnPlayer(); }catch(e){}                  // 玩家/鬼/AI 回到开局位置与状态
  STARTED = false; DEAD = false; HURT_LV = 0;
  if(typeof GHOST_WON !== 'undefined') GHOST_WON = false;
  setTimeout(function(){ try{ if(!STARTED && GV.on) toggleGhostView(); }catch(e){} }, 150);
  clearTransient();
  // 游戏内 HUD 一律收起来：钥匙提示、体力条、鬼标记、雷达、准心
  try{
    const hideIds = ['items','hud','ghostTag','elRadar','lockHint','tapToPlay'];
    for(const id of hideIds){ const el=document.getElementById(id); if(el) el.style.display='none'; }
    if(typeof elRadar!=='undefined' && elRadar) elRadar.style.display='none';
    if(typeof switchHUD==='function') switchHUD(false);
  }catch(e){}
  showView('pMain');
  MENU_ANIM.intro = 0; MENU_ANIM.stareT = 0; MENU_ANIM.stare = 0; MENU_ANIM.turnT = 0; MENU_ANIM.turn = 0;
  MENU_ANIM.swT = 0; MENU_ANIM.sw = 0;
  MENU_ANIM.last = 0; MENU_ANIM._gasp = false;
  try{ drawMenuFrame(performance.now()); }catch(e){}
  const _ma2=document.getElementById('menuArt'); if(_ma2) _ma2.style.opacity='1';
  const t=document.getElementById('winTitle');
  const b=document.getElementById('winBtn');
  if(t) t.textContent = '你逃出去了';
  if(b){ b.textContent='再来一次'; b.onclick=function(){ location.reload(); }; }
}
// 鬼按左键：挥刀 → 命中判定
function ghostAttack(){
  if(!GV.on || ATK.on || DEAD) return;
  if(GV.hitCd === undefined) GV.hitCd = 0;
  if(GV.hitCd > 0){
    try{ toastTip('刀还在擦，等一下再砍（' + GV.hitCd.toFixed(1) + ' 秒）'); }catch(e){}
    return;
  }
  ATK.on=true; ATK.t=0;
  const dx=player.x-GV.x, dz=player.z-GV.z;
  const dist=Math.hypot(dx,dz)||1e-3;
  const fx=-Math.sin(GV.yaw), fz=-Math.cos(GV.yaw);
  const dot=(dx*fx+dz*fz)/dist;
  Sound.slash();
  // 躲在柜子里的人砍不到；正面 2.2 米内且大致朝向 → 命中
  let hitSomething = false;
  if(!GV.on && !HIDE.hidden && dist<2.2 && dot>0.45 && !losBlocked(GV.x, GV.z, player.x, player.z)){ GV.hitCd = cfgNum('鬼AI','砍人间隔秒',3); applyHit(); hitSomething = true; GV.slowT = cfgNum('鬼AI','砍人减速秒',5); }
  // 注：以前这里还有一段"砍 AI 人类"的判定，会和下面的循环重复计算一次，
  // 导致 AI 一刀就被判定两下直接倒地。现在只保留下面对朝向 + 视线有要求的循环。
  // AI 人类也能砍（倒地的不再判定）
  const fx2=fx, fz2=fz;
  for(const h of AI.humans){
    if(!aiHumanVisible(h) || h.state==='dead') continue;
    const hx=h.person.root.position.x-GV.x, hz=h.person.root.position.z-GV.z;
    const hd=Math.hypot(hx,hz)||1e-3;
    if(hd<2.2 && (hx*fx2+hz*fz2)/hd>0.45){ aiHurtHuman(h); hitSomething = true; }
  }
  ATK.miss = !hitSomething;
  ATK.dur  = 3.0;                          // 命中/挥空都走 3 秒第三人称擦刀
  toastTip(hitSomething ? '砍中！' : '挥空了');
}

function ghostCheck(){
  if(CHECK.on) return;

  let cab = null, kind = null;
  const aim = aimTarget();
  if(aim && aim.kind === 'cabinet'){ cab = aim.ref; kind = 'cabinet'; }
  if(!cab && typeof DOORS!=='undefined'){
    const dr = nearestDoor();
    if(dr && dr.kind !== 'exit'){ cab = dr; kind = 'door'; }
  }
  if(!cab){ const rd = nearestRoomDoor(); if(rd){ cab = rd; kind = 'roomdoor'; } }
  if(!cab){ toastTip('对准柜子或门按 E 检查'); return; }

  // —— 是否正好有人躲在这扇门里 ——
  let victim = false;
  if(kind === 'door' && HIDE.hidden && HIDE.door){
    // 判定的是"这扇门里有没有人"，和鬼站多远无关（鬼站在 1.7 米外检查也算）
    const d = Math.hypot(HIDE.door.x - cab.x, HIDE.door.z - cab.z);
    if(HIDE.door === cab || d < 1.2) victim = true;
  }

  CHECK.on    = true;
  CHECK.t     = 0;          // 已播放秒数
  CHECK.dur   = 2.90;
  CHECK.kind  = kind;
  CHECK.ref   = cab;
  CHECK.tx    = cab.x;
  CHECK.tz    = cab.z;
  // 门后有没有 AI 人类（玩家当鬼时，AI 也会躲门里）
  let npc = null;
  if(kind === 'door'){
    npc = AI.humans.find(function(h){
      if(h.state !== 'hide' || !h.hideDoor) return false;
      if(h.hideDoor === cab) return true;
      return Math.hypot(h.hideDoor.x - cab.x, h.hideDoor.z - cab.z) < 1.2;
    }) || null;
    if(npc) victim = true;
  }
  CHECK.npc   = npc;
  CHECK.victim= victim;
  CHECK.opened= false;
  CHECK.closed= false;
  CHECK.hit   = false;

  // 鬼转身面向门/柜
  const dx = cab.x - GV.x, dz = cab.z - GV.z;
  CHECK.yaw0 = GV.yaw;
  CHECK.yaw1 = Math.atan2(-dx, -dz);
}

// —— 背包（B）——
const elBag = document.createElement('div');
elBag.style.cssText = 'position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;' +
  'background:rgba(2,5,7,.86);backdrop-filter:blur(3px);font:14px/1.4 system-ui,sans-serif;color:#cfd8e0';
elBag.innerHTML = '<div style="text-align:center"><div style="font-size:12px;letter-spacing:.5em;color:#6d7b88;' +
  'margin-bottom:22px">背 包</div><div id="bagSlots" style="display:flex;gap:16px;justify-content:center"></div>' +
  '<div style="margin-top:22px;font-size:11px;color:#5d6b78;letter-spacing:.1em">按 B 关闭 · 点击道具使用</div></div>';
document.body.appendChild(elBag);

function bagSlots(){
  const w = elBag.querySelector('#bagSlots');
  const slots = [];
  if(INV.ink>0)  slots.push({k:'ink',  n:'墨水 ×'+INV.ink,  d:'左键投掷，砸中会让鬼短暂失明'});
  if(INV.shoe>0) slots.push({k:'shoe', n:'皮鞋 ×'+INV.shoe, d:'永久提高疾跑上限'});
  while(slots.length<5) slots.push({k:'', n:'空', d:''});
  w.innerHTML = slots.map(function(x,i){
    return '<div data-k="'+x.k+'" style="width:104px;height:124px;border:1px solid ' +
      (x.k?'rgba(150,200,180,.45)':'rgba(90,105,118,.28)') + ';border-radius:8px;' +
      'background:rgba(255,255,255,.02);display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:8px;cursor:'+(x.k?'pointer':'default')+';font-size:12px;color:' +
      (x.k?'#c8dccf':'#47535e')+'">' +
      '<b style="font-size:13px;letter-spacing:.05em">'+x.n+'</b>' +
      '<span style="font-size:10px;opacity:.62;text-align:center;padding:0 6px;line-height:1.35">'+x.d+'</span></div>';
  }).join('');
  w.querySelectorAll('[data-k]').forEach(function(el){
    el.onclick = function(ev){
      ev.stopPropagation();
      const k = el.dataset.k;
      if(!k) return;
      if(k==='shoe'){ INV.shoe--; STAM_MAX=CFG.道具.皮鞋疾跑上限; stamina=1; showToast('已穿上皮鞋 · 疾跑上限 '+CFG.道具.皮鞋疾跑上限+' 秒'); }
      if(k==='ink'){ INV.ink--; INK_READY=true; showToast('已携带墨水炸弹 · 左键投掷'); }
      toggleBag();
    };
  });
  // 点背包的空白处：把已经拿在手上的墨水收回背包（取消携带）
  w.addEventListener('click', function(ev){
    if(ev.target.closest('[data-k]')) return;
    if(INK_READY){
      INK_READY = false;
      INV.ink++;
      updateItemHud();
      showToast('墨水已收回背包');
      toggleBag();
    }
  });
}

let BAG_INTENT = false;
function toggleBag(){
  if(!STARTED) return;
  BAG = !BAG;
  if(BAG){
    BAG_INTENT = true;
    if(document.pointerLockElement) document.exitPointerLock();
    bagSlots(); elBag.style.display='flex';
  } else {
    elBag.style.display='none';
    BAG_INTENT = false;
    const p2 = renderer.domElement.requestPointerLock();
    if(p2 && p2.catch) p2.catch(function(){});
  }
}



/* ================= 鬼的红色地面警示圈 =================
   以鬼为圆心、半径约 3.2 米（≈3 个身位）的红光，只对"人类玩家"可见，
   靠近时逐渐变亮并轻微脉动，用来提示"鬼就在附近"。 */
const GHOST_AURA = (()=>{
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S/2, S/2, S*0.06, S/2, S/2, S*0.5);
  grad.addColorStop(0.00, 'rgba(255,70,50,0.95)');
  grad.addColorStop(0.35, 'rgba(220,40,30,0.55)');
  grad.addColorStop(0.70, 'rgba(150,20,15,0.20)');
  grad.addColorStop(1.00, 'rgba(120,10,10,0)');
  g.fillStyle = grad; g.fillRect(0,0,S,S);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1,1),
    new THREE.MeshBasicMaterial({ map: tex, transparent:true, opacity:0, depthWrite:false,
                                  blending: THREE.AdditiveBlending, toneMapped:false })
  );
  mesh.rotation.x = -Math.PI/2;
  mesh.position.y = 0.03;
  mesh.renderOrder = 3;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, radius: 6.4, mat: mesh.material };
})();

function updateGhostAura(dt, t){
  try{
    const m = GHOST_AURA.mesh;
    if(!m) return;
    if(GV.on || !STARTED || DEAD){ m.visible = false; return; }
    const dx = ghost.position.x - player.x, dz = ghost.position.z - player.z;
    const d = Math.hypot(dx, dz);
    if(d > 24){ m.visible = false; return; }
    m.visible = true;
    m.position.set(ghost.position.x, 0.03, ghost.position.z);
    const R = GHOST_AURA.radius * 2;         // 直径
    const pulse = 0.86 + Math.sin(t*4.2)*0.14;
    m.scale.set(R*pulse, R*pulse, 1);
    const near = 1 - Math.min(1, Math.max(0, (d - 2) / 18));   // 2 米内最亮
    GHOST_AURA.mat.opacity = 0.32 + near*0.58;
  }catch(e){}
}


/* ================= 钥匙系统（3 色钥匙 / 通关条件） =================
   · 玩家当鬼：场上刷 3 把（红/绿/蓝），分在不同房间的抽屉里，AI 集齐 → 人类赢
   · 玩家当人类：只刷 1 把，拿到后去安全门按 E 撤退 → 人类赢
   · 钥匙只刷在抽屉里，且不会和墨水刷在同一个抽屉
*/
const KEY_COLORS = [0xff4a4a, 0x5cff9d, 0x5aa9ff];
const KEY_NAMES  = ['红', '绿', '蓝'];
let KEYS = [];
let KEYS_TAKEN = 0;
let PLAYER_HAS_KEY = false;
let HUMANS_WON = false;
let AI_ESCAPED = 0;

function roomOfPoint(x, z){
  for(const r of ROOMS){
    if(x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r;
  }
  return null;
}
function makeKeyMesh(color){
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3.2, metalness: .55, roughness: .25 });   // 亮度提高一倍多
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.030, .009, 6, 12), m);
  ring.rotation.x = Math.PI/2; g.add(ring);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(.011,.011,.070), m);
  shaft.position.z = .046; g.add(shaft);
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(.026,.009,.013), m);
  tooth.position.set(.010, 0, .078); g.add(tooth);
  // 不给钥匙加灯光：鬼不该看到钥匙的光
  return g;
}
function clearKeys(){
  for(const k of KEYS){
    try{
      const it = k.drawer && k.drawer.item;
      if(it){
        for(let i=ITEM_HIT.length-1;i>=0;i--) if(ITEM_HIT[i].item === it) ITEM_HIT.splice(i,1);
        for(let i=ITEMS.length-1;i>=0;i--) if(ITEMS[i] === it) ITEMS.splice(i,1);
      }
    }catch(e){}
    try{ if(k.mesh && k.mesh.parent) k.mesh.parent.remove(k.mesh); }catch(e){}
    try{ if(k.drawer && k.drawer.item && k.drawer.item.kind === 'key') k.drawer.item = null; }catch(e){}
  }
  KEYS = []; KEYS_TAKEN = 0; PLAYER_HAS_KEY = false; HUMANS_WON = false;
  updateKeyHud();
}
function spawnKeys(n){
  clearKeys();
  const pool = [], usedRoom = new Set();
  // 迷宫模式：直接按编辑器「钥匙点」找最近的柜子，一把一个
  if(MAZE && window.LEVEL_DATA && Array.isArray(LEVEL_DATA.钥匙点) && LEVEL_DATA.钥匙点.length){
    const usedC = new Set();
    for(const kp of LEVEL_DATA.钥匙点){
      if(pool.length >= n) break;
      const c = nearestCabinet(kp.x, kp.z, usedC);
      if(!c) continue;
      const free = c.drawers.filter(function(d){ return !d.item; });
      if(!free.length) continue;
      usedC.add(c);
      pool.push({ c:c, free:free });
    }
    for(let i=0;i<pool.length;i++){
      const e = pool[i];
      const d = e.free[e.free.length-1];
      const mesh = makeKeyMesh(KEY_COLORS[i]);
      mesh.position.set(0, 0.02, 0.02);
      mesh.rotation.x = 0;
      mesh.rotation.y = Math.random()*Math.PI*2;
      mesh.scale.set(2.6, 2.6, 2.6);
      mesh.visible = false;
      mesh.traverse(function(o){ if(o.isPointLight) o.intensity = 0; });
      d.slide.add(mesh);
      const rec = { color:KEY_COLORS[i], name:KEY_NAMES[i], cab:e.c, drawer:d, mesh:mesh, taken:false };
      const it  = { kind:'key', mesh:mesh, taken:false, hidden:true, drawer:d, key:rec };
      d.item = it;
      ITEMS.push(it);
      ITEM_HIT.push({ mesh:mesh, item: it });
      KEYS.push(rec);
    }
    updateKeyHud();
    return;
  }
  for(const c of CABINETS){
    const r = roomOfPoint(c.x, c.z);
    if(!r || usedRoom.has(r)) continue;
    const free = c.drawers.filter(d => !d.item);      // 不和墨水抢同一个抽屉
    if(!free.length) continue;
    usedRoom.add(r);
    pool.push({ c, free });
  }
  shuffleArr(pool);
  for(let i=0; i<Math.min(n, pool.length); i++){
    const e = pool[i];
    const d = e.free[e.free.length-1];                // 放最下层抽屉，避免和上层墨水混淆
    const mesh = makeKeyMesh(KEY_COLORS[i]);
    // 放进抽屉内胆里（贴底、靠里），不要浮在抽屉口外面
    // 和墨水用同一个摆放位置（那个位置已验证"拉开抽屉就能看见"）
    mesh.position.set(0, 0.02, 0.02);
    mesh.rotation.x = 0;                 // 钥匙本身已经是平躺的，不要再转 90°
    mesh.rotation.y = Math.random()*Math.PI*2;   // 每把朝向随机一点，自然些
    mesh.scale.set(2.6, 2.6, 2.6);
    mesh.visible = false;
    mesh.traverse(function(o){ if(o.isPointLight) o.intensity = 0; });
    d.slide.add(mesh);
    const rec = { color:KEY_COLORS[i], name:KEY_NAMES[i], cab:e.c, drawer:d, mesh, taken:false };
    const it  = { kind:'key', mesh, taken:false, hidden:true, drawer:d, key:rec };
    d.item = it;
    ITEMS.push(it);                       // ★ 注册到道具表，准心才能识别、E 才能拾取
    ITEM_HIT.push({ mesh, item: it });
    KEYS.push(rec);
  }
  updateKeyHud();
}
function takeKeyFromDrawer(d){
  if(!d || !d.item || d.item.kind !== 'key' || d.item.taken) return null;
  d.item.taken = true;
  try{ d.item.mesh.visible = false;
       d.item.mesh.traverse(function(o){ if(o.isPointLight) o.intensity = 0; }); }catch(e){}
  const k = d.item.key;
  if(k) k.taken = true;
  KEYS_TAKEN++;
  updateKeyHud();
  // 集齐钥匙不再直接结束：他们必须逐个走到安全门撤离（见 aiHumansUpdate 的 toExit）
  return k;
}
function updateKeyHud(){
  try{
    let el = document.getElementById('keyHud');
    if(!el){
      el = document.createElement('div');
      el.id = 'keyHud';
      el.style.cssText = 'position:fixed;right:16px;top:70px;z-index:38;font:12px/1.6 system-ui;' +
        'color:#dfeaf2;background:rgba(6,10,14,.62);border:1px solid rgba(120,170,155,.30);' +
        'border-radius:8px;padding:7px 11px;pointer-events:none;white-space:pre';
      document.body.appendChild(el);
    }
    if(!STARTED){ el.style.display='none'; return; }
    el.style.display = 'block';
    if(KEYS.length <= 1){
      el.textContent = '钥匙  ' + (KEYS_TAKEN >= 1 ? '已拿到 ✔' : '未拿到');
    }else{
      let line = '钥匙  ' + KEYS_TAKEN + ' / ' + KEYS.length + '  ';
      for(const k of KEYS) line += (k.taken ? '●' : '○');
      el.textContent = line;
    }
  }catch(e){}
}
// 统一结束界面：解锁鼠标、显示菜单层、切到结算页（否则会停在 3D 画面里出不去）
function showEndScreen(title, hint){
  try{ if(document.pointerLockElement) document.exitPointerLock(); }catch(e){}
  STARTED = false;
  PAUSED = false;
  try{
    const t = document.getElementById('winTitle');
    const h = document.getElementById('winHint');
    if(t) t.textContent = title;
    if(h) h.textContent = hint || '';
    const uiEl = document.getElementById('ui');
    if(uiEl) uiEl.classList.remove('hide');
    const btn = document.getElementById('winBtn');
    if(btn){ btn.textContent = '再来一次'; btn.onclick = function(){ location.reload(); }; }
    showView('pWin');
  }catch(e){}
}

function humanSideWin(reason){
  if(HUMANS_WON) return;
  HUMANS_WON = true;
  if(AI.role === 'ghost'){ try{ SFX.play('gameOver'); }catch(e){} }
  else { try{ Sound.scream && Sound.scream(); }catch(e){} }
  try{ showEndScreen('人类赢了', reason || '他们带着钥匙从安全门撤离了'); }catch(e){}
}

/* ================= 15. 雷达小地图 ================= */
let RADAR = false;
let RADAR_BOUNDS = null;
const elRadar = document.createElement('canvas');
elRadar.width = 260; elRadar.height = 196;
elRadar.style.cssText = 'position:fixed;left:16px;top:16px;z-index:39;opacity:0;' +
  'border:1px solid rgba(120,170,155,.45);border-radius:8px;background:rgba(4,9,11,.72);' +
  'box-shadow:0 0 14px rgba(0,0,0,.7);pointer-events:none;transition:opacity .3s';
document.body.appendChild(elRadar);
const rctx = elRadar.getContext('2d');

function drawRadar(){
  if(!RADAR || !STARTED){ elRadar.style.opacity='0'; return; }
  elRadar.style.opacity='1';
  const CW=elRadar.width, CH=elRadar.height, pad=10;
  // 地图范围只算一次：开着的门会把碰撞盒设成 -9999，每次都重算就会把地图压成一个点
  if(!RADAR_BOUNDS){
    let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9;
    for(const w of WALLS){
      if(w.top != null) continue;
      if(w.x0 < -500 || w.x1 < -500) continue;        // 开着的门 / 无效盒
      if(w.x0<mnx) mnx=w.x0; if(w.x1>mxx) mxx=w.x1;
      if(w.z0<mnz) mnz=w.z0; if(w.z1>mxz) mxz=w.z1;
    }
    if(mnx>mxx){ mnx=-HX; mxx=HX; mnz=-HZ; mxz=HZ; }
    RADAR_BOUNDS = {mnx, mxx, mnz, mxz};
  }
  const mnx=RADAR_BOUNDS.mnx, mxx=RADAR_BOUNDS.mxx, mnz=RADAR_BOUNDS.mnz, mxz=RADAR_BOUNDS.mxz;
  const spanX = Math.max(1, mxx-mnx), spanZ = Math.max(1, mxz-mnz);
  const sc = Math.min((CW-pad*2)/spanX, (CH-pad*2)/spanZ);
  const ox = pad + ((CW-pad*2) - spanX*sc)/2;
  const oz = pad + ((CH-pad*2) - spanZ*sc)/2;
  const px = x => ox + (x-mnx)*sc;
  const pz = z => oz + (z-mnz)*sc;

  rctx.clearRect(0,0,CW,CH);
  rctx.fillStyle='rgba(3,8,10,.78)';
  rctx.fillRect(0,0,CW,CH);

  // 墙体（只画墙，不画矮家具）
  rctx.fillStyle='rgba(110,160,150,.42)';
  for(const w of WALLS){
    if(w.top != null) continue;
    if(w.x0 < -500 || w.x1 < -500) continue;
    const x0=px(w.x0), z0=pz(w.z0);
    const ww=Math.max(0.8,(w.x1-w.x0)*sc), hh=Math.max(0.8,(w.z1-w.z0)*sc);
    rctx.fillRect(x0, z0, ww, hh);
  }

  // 假门（能藏人的门）
  try{
    for(const dr of (typeof DOORS!=='undefined' ? DOORS : MAP.doors)){
      if(dr.kind === 'exit') continue;
      const X=px(dr.x), Z=pz(dr.z);
      rctx.fillStyle='#ffd166';
      rctx.fillRect(X-2, Z-2, 4, 4);
      rctx.strokeStyle='rgba(255,209,102,.35)'; rctx.lineWidth=1;
      rctx.strokeRect(X-3.5, Z-3.5, 7, 7);
    }
  }catch(e){}
  // 房间真门
  try{
    for(const rd of (ROOM_DOORS||[])){
      rctx.fillStyle='rgba(120,200,255,.85)';
      rctx.fillRect(px(rd.x)-1.5, pz(rd.z)-1.5, 3, 3);
    }
  }catch(e){}
  // 玻璃门
  for(const gd of GLASS){
    rctx.fillStyle = gd.open ? 'rgba(150,220,255,.45)' : 'rgba(150,220,255,.95)';
    rctx.fillRect(px(gd.x)-1.5, pz(gd.z)-1.5, 3, 3);
  }
  // 安全出口
  if(window.EXIT_INFO){ rctx.fillStyle='#3fd48a'; rctx.fillRect(px(EXIT_INFO.x)-2,pz(EXIT_INFO.z)-2,4,4); }

  // 道具点位（墨水=蓝，皮鞋=橙；已捡走的不画）
  try{
    for(const it of ITEMS){
      if(!it || it.taken) continue;
      const m = it.mesh;
      if(!m) continue;
      let wx = m.position.x, wz = m.position.z;
      try{ if(m.parent){ const v=new THREE.Vector3(); m.getWorldPosition(v); wx=v.x; wz=v.z; } }catch(e){}
      rctx.fillStyle = (it.kind==='ink') ? '#5c8fe0' : '#e0a24a';
      rctx.fillRect(px(wx)-2, pz(wz)-2, 4, 4);
      rctx.strokeStyle = (it.kind==='ink') ? 'rgba(92,143,224,.4)' : 'rgba(224,162,74,.4)';
      rctx.lineWidth=1; rctx.strokeRect(px(wx)-3.5, pz(wz)-3.5, 7, 7);
    }
  }catch(e){}
  // 抽屉柜（灰点）＋ 有钥匙的抽屉（亮黄点）
  try{
    for(const c of CABINETS){
      rctx.fillStyle='rgba(150,160,175,.55)';
      rctx.fillRect(px(c.x)-1.5, pz(c.z)-1.5, 3, 3);
      if(c.drawers && c.drawers.some(function(d){ return d.item && d.item.kind==='key' && !d.item.taken; })){
        rctx.fillStyle='#ffe066';
        rctx.fillRect(px(c.x)-1, pz(c.z)-4.5, 2.5, 2.5);
      }
    }
  }catch(e){}

  // 安全出口：大一点的绿方块 + 光圈
  if(window.EXIT_INFO){
    const X=px(EXIT_INFO.x), Z=pz(EXIT_INFO.z);
    rctx.fillStyle='#3fd48a';
    rctx.fillRect(X-3, Z-3, 6, 6);
    rctx.strokeStyle='rgba(63,212,138,.7)'; rctx.lineWidth=1.2;
    rctx.beginPath(); rctx.arc(X, Z, 6.5, 0, 7); rctx.stroke();
  }

  // 4 个 AI 人类（橙点；躲起来的是空心橘圈）
  try{
    for(const h of AI.humans){
      if(h.state === 'dead') continue;
      const X=px(h.person.root.position.x), Z=pz(h.person.root.position.z);
      if(h.state === 'hide'){
        rctx.strokeStyle='#ff9f43'; rctx.lineWidth=1.2;
        rctx.beginPath(); rctx.arc(X,Z,2.4,0,7); rctx.stroke();
      }else{
        rctx.fillStyle='#ff9f43'; rctx.beginPath(); rctx.arc(X,Z,2.4,0,7); rctx.fill();
      }
    }
  }catch(e){}

  if(GV.on){
    // 玩家在玩鬼：绿点＝你自己（鬼的位置），不再画那个残留的"人类替身"
    rctx.fillStyle='#7fe0a8'; rctx.beginPath(); rctx.arc(px(GV.x),pz(GV.z),3,0,7); rctx.fill();
    rctx.strokeStyle='rgba(127,224,168,.85)'; rctx.lineWidth=1.2;
    rctx.beginPath(); rctx.moveTo(px(GV.x),pz(GV.z));
    rctx.lineTo(px(GV.x + Math.sin(GV.yaw)*2.2), pz(GV.z + Math.cos(GV.yaw)*2.2));
    rctx.stroke();
  }else{
    // 玩人类：红点＝鬼，绿点＝你
    const gx = ghost.position.x, gz = ghost.position.z;
    rctx.fillStyle='#ff4d3d'; rctx.beginPath(); rctx.arc(px(gx),pz(gz),3,0,7); rctx.fill();
    const gyaw = ghost.rotation.y;
    rctx.strokeStyle='rgba(255,90,70,.85)'; rctx.lineWidth=1.2;
    rctx.beginPath(); rctx.moveTo(px(gx),pz(gz));
    rctx.lineTo(px(gx + Math.sin(gyaw)*2.2), pz(gz + Math.cos(gyaw)*2.2));
    rctx.stroke();

    rctx.fillStyle='#7fe0a8'; rctx.beginPath(); rctx.arc(px(player.x),pz(player.z),3,0,7); rctx.fill();
    rctx.strokeStyle='rgba(127,224,168,.85)'; rctx.lineWidth=1.2;
    rctx.beginPath(); rctx.moveTo(px(player.x),pz(player.z));
    rctx.lineTo(px(player.x - Math.sin(player.yaw)*2.2), pz(player.z - Math.cos(player.yaw)*2.2));
    rctx.stroke();
  }

  // 图例
  rctx.font='8px system-ui';
  rctx.fillStyle='rgba(150,200,185,.75)';
  rctx.fillText('F8 调试地图', 5, 10);
  rctx.fillStyle='#7fe0a8'; rctx.fillText('●你', 5, CH-4);
  rctx.fillStyle='#ff4d3d'; rctx.fillText('●鬼', 26, CH-4);
  rctx.fillStyle='#ff9f43'; rctx.fillText('●AI', 47, CH-4);
  rctx.fillStyle='#ffd166'; rctx.fillText('■假门', 68, CH-4);
}

/* ---------- 13. 声音系统：全部由代码合成，不用任何音频文件 ---------- */
const Sound = (()=>{
  let ctx=null, master=null, noiseBuf=null, on=false;
  let vol = parseFloat(localStorage.getItem('corridor_vol') || '60')/100;

  let module_drip_hook = function(){};
  function init(){
    if(on) return true;
    try{ ctx = new (window.AudioContext||window.webkitAudioContext)(); }
    catch(e){ return false; }
    if(ctx.state==='suspended') ctx.resume();
    master = ctx.createGain(); master.gain.value = vol*2.8; master.connect(ctx.destination);

    // 2 秒白噪声，反复复用（比每次现算便宜）
    const n = Math.floor(ctx.sampleRate*2);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for(let i=0;i<n;i++) d[i] = Math.random()*2-1;

    // 环境底噪：低沉的风声
    const amb = ctx.createBufferSource(); amb.buffer = noiseBuf; amb.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=200; lp.Q.value=.7;
    const ag = ctx.createGain(); ag.gain.value=.075;
    amb.connect(lp); lp.connect(ag); ag.connect(master); amb.start();

    // 极低频嗡鸣（医院/空房间的那种压迫感）
    const dr = ctx.createOscillator(); dr.type='triangle'; dr.frequency.value=46;
    const dg = ctx.createGain(); dg.gain.value=.042;
    const lfo = ctx.createOscillator(); lfo.frequency.value=.06;
    const lg = ctx.createGain(); lg.gain.value=.010;
    lfo.connect(lg); lg.connect(dg.gain);
    dr.connect(dg); dg.connect(master); dr.start(); lfo.start();

    // —— 电流声：坏掉的灯管在响 ——
    const buzz = ctx.createOscillator(); buzz.type='sawtooth'; buzz.frequency.value=100;
    const bf = ctx.createBiquadFilter(); bf.type='bandpass'; bf.frequency.value=290; bf.Q.value=5.5;
    const bg = ctx.createGain(); bg.gain.value=.020;
    const trem = ctx.createOscillator(); trem.frequency.value=0.37;      // 慢慢起伏
    const tg = ctx.createGain(); tg.gain.value=.009;
    trem.connect(tg); tg.connect(bg.gain);
    buzz.connect(bf); bf.connect(bg); bg.connect(master);
    buzz.start(); trem.start();

    // 随机"啪"的电流爆裂
    setInterval(()=>{
      if(!on) return;
      if(Math.random()<0.30) noiseHit(rr(2200,4600), 4.5, .055, .002, .045, 'bandpass');
    }, 1000);

    on = true; return true;
  }

  // 噪声型（脚步、呼吸、撞击的"沙"感）
  function noiseHit(freq, q, peak, atk, dec, type){
    if(!on) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = .85 + Math.random()*.3;
    const f = ctx.createBiquadFilter(); f.type = type||'bandpass';
    f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t+atk);
    g.gain.exponentialRampToValueAtTime(.0001, t+atk+dec);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t+atk+dec+.05);
  }
  // 音调型（心跳、水滴、金属）
  function tone(freq, peak, dur, type, slideTo){
    if(!on) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type||'sine';
    o.frequency.setValueAtTime(freq, t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t+dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t+.012);
    g.gain.exponentialRampToValueAtTime(.0001, t+dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+.03);
  }

  return {
    init,
    setDrip(fn){ module_drip_hook = fn; },
    setVol(v){ vol=v; if(master) master.gain.value=v*2.8; },
    // 脚步：跑和走音色不同
    step(run){ noiseHit(run?420:330, 1.3, run?.64:.46, .004, run?.30:.40, 'lowpass');
      tone(run?72:60, .44, .36, 'sine', run?44:38);      // 体重砸地的低频（加倍）
      tone(150, .14, .14, 'triangle');
      if(run) setTimeout(()=>noiseHit(1200,.9,.10,.002,.09,'bandpass'), 30);
               tone(run?92:74, .10, .09, 'sine'); },
    // 玩家惨叫（被砍中）
    scream(){
      if(!on) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type='sawtooth';
      o.frequency.setValueAtTime(480, t);
      o.frequency.exponentialRampToValueAtTime(900, t+0.10);
      o.frequency.exponentialRampToValueAtTime(230, t+0.72);
      const vib = ctx.createOscillator(); vib.type='sine'; vib.frequency.value=18;
      const vg  = ctx.createGain(); vg.gain.value = 38;
      vib.connect(vg); vg.connect(o.frequency);
      const f = ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1150; f.Q.value=1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(.55, t+0.04);
      g.gain.exponentialRampToValueAtTime(.0001, t+0.80);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); vib.start(t); o.stop(t+0.85); vib.stop(t+0.85);
      noiseHit(1500, .8, .10, .01, .30, 'bandpass');
    },
    // 鬼挥刀：风声 + 金属划破空气
    slash(){
      noiseHit(900, 1.6, .30, .01, .18, 'bandpass');
      tone(320, .10, .16, 'sawtooth', 120);
      setTimeout(()=>noiseHit(2400, .9, .10, .004, .09, 'highpass'), 40);
    },
    // 鬼的脚步：更沉、带回声、带金属拖地感（和人类明显不同）
    ghostStep(run){
      noiseHit(run?300:240, 1.1, run?.34:.26, .006, run?.22:.26, 'lowpass');
      tone(run?48:40, .30, .26, 'sine', run?30:26);          // 低频体重
      tone(88, .12, .18, 'sawtooth', 60);                     // 闷响
      setTimeout(()=>noiseHit(1800,.8,.045,.003,.10,'bandpass'), 60);  // 拖地
      if(run) setTimeout(()=>tone(64,.16,.22,'sine',40), 110);
    },
    // 呼吸：体力越低越重
    breath(hard){ noiseHit(hard?520:380, .8, hard?.20:.10, .09, hard?.30:.42, 'lowpass'); },
    // 心跳（双拍）
    heart(){ tone(52,.36,.16,'sine'); setTimeout(()=>tone(46,.24,.20,'sine'),165); },
    // 手电开关的"咔哒"
    click(){ noiseHit(2600,2.2,.10,.002,.032,'bandpass'); setTimeout(()=>noiseHit(1700,2.6,.06,.002,.028,'bandpass'),45); },
    // 落地
    land(){ noiseHit(300,1.2,.20,.004,.10,'lowpass'); tone(78,.11,.10,'sine'); },
    // 远处金属撞击
    clang(){ tone(1180,.095,.5,'triangle',760); tone(1730,.06,.4,'sine',1100);
             noiseHit(2400,.7,.085,.004,.25); },
    // 滴水
    drip(){
      if(!on) return;
      // 真实水滴：高频一击 + 快速下滑的"嗒"，后面跟一声闷闷的水面回响
      const f0 = 1750 + Math.random()*850;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type='sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0*0.42, t+0.055);
      const g = ctx.createGain();
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(.075, t+0.004);
      g.gain.exponentialRampToValueAtTime(.0001, t+0.075);
      o.connect(g); g.connect(master); o.start(t); o.stop(t+0.09);
      noiseHit(5400, 2.0, .022, .001, .03, 'bandpass');       // 水珠击面的"啧"
      setTimeout(()=>{                                        // 水面回响（闷、慢、小）
        const t2 = ctx.currentTime;
        const o2 = ctx.createOscillator(); o2.type='sine';
        o2.frequency.setValueAtTime(f0*0.60, t2);
        o2.frequency.exponentialRampToValueAtTime(f0*0.30, t2+0.18);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(.0001, t2);
        g2.gain.exponentialRampToValueAtTime(.018, t2+0.012);
        g2.gain.exponentialRampToValueAtTime(.0001, t2+0.26);
        o2.connect(g2); g2.connect(master); o2.start(t2); o2.stop(t2+0.28);
      }, 90);
    },
    // 木门吱呀：一串不规则的"咯…吱…咯"，像干木头在门轴上摩擦
    creak(){
      if(!on) return;
      const t0 = ctx.currentTime;
      const N = 26 + Math.floor(Math.random()*10);
      const total = 1.40;
      let tt = t0;
      const variant = Math.random();                    // 每次开门音色都不一样
      const loF = 200 + variant*420, hiF = loF + 500 + Math.random()*900;
      const qBase = 5 + Math.random()*14;
      for(let i=0;i<N;i++){
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type='bandpass';
        f.frequency.value = loF + Math.random()*(hiF-loF);
        f.Q.value = qBase*(0.45 + Math.random()*1.7);
        if(Math.random()<0.22){                            // 偶尔来一个上滑的"吱——"
          f.frequency.setValueAtTime(f.frequency.value, tt);
          f.frequency.linearRampToValueAtTime(f.frequency.value*(1.5+Math.random()), tt+.06);
        }
        const g = ctx.createGain();
        const dur = .012 + Math.random()*.075;
        const peak = .020 + Math.random()*.060;
        g.gain.setValueAtTime(.0001, tt);
        g.gain.exponentialRampToValueAtTime(peak, tt+.004);
        g.gain.exponentialRampToValueAtTime(.0001, tt+dur);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(tt, Math.random()*1.4, dur+.02);
        tt += (total - (tt - t0)) / Math.max(1,(N-i)) * (0.55 + Math.random()*0.9);
        if(tt > t0 + total) tt = t0 + total;
      }
      // 门板被拉动时木头受力的低频"嗯——"
      const o = ctx.createOscillator();
      o.type = Math.random()<0.5 ? 'triangle' : 'sawtooth';
      o.frequency.setValueAtTime(90 + Math.random()*70, t0);
      o.frequency.linearRampToValueAtTime(52 + Math.random()*40, t0+1.10);
      if(Math.random()<0.45){
        const sq = ctx.createOscillator(); sq.type='square';
        const f0s = 1500 + Math.random()*1100;
        sq.frequency.setValueAtTime(f0s, t0+0.1);
        sq.frequency.linearRampToValueAtTime(f0s*0.7, t0+0.9);
        const vib2 = ctx.createOscillator(); vib2.frequency.value = 5+Math.random()*6;
        const vg2 = ctx.createGain(); vg2.gain.value = 12+Math.random()*22;
        vib2.connect(vg2); vg2.connect(sq.frequency);
        const fq = ctx.createBiquadFilter(); fq.type='bandpass'; fq.Q.value=9;
        fq.frequency.setValueAtTime(1900, t0); fq.frequency.linearRampToValueAtTime(900, t0+.9);
        const gs = ctx.createGain();
        gs.gain.setValueAtTime(.0001, t0+.08);
        gs.gain.exponentialRampToValueAtTime(.014, t0+.22);
        gs.gain.exponentialRampToValueAtTime(.0001, t0+1.0);
        sq.connect(fq); fq.connect(gs); gs.connect(master);
        sq.start(t0+.08); vib2.start(t0+.08);
        sq.stop(t0+1.02); vib2.stop(t0+1.02);
      }
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(.0001, t0);
      g2.gain.exponentialRampToValueAtTime(.055, t0+.10);
      g2.gain.exponentialRampToValueAtTime(.0001, t0+1.20);
      o.connect(g2); g2.connect(master); o.start(t0); o.stop(t0+1.22);
    },
    // 玻璃门滑动（金属轨道 + 玻璃摩擦）
    slide(){
      if(!on) return;
      noiseHit(2400, 1.1, .05, .025, .30, 'bandpass');
      setTimeout(()=>noiseHit(1400,.85,.042,.012,.24,'bandpass'), 230);
      tone(320,.06,.03,'triangle',240);
    },
    // 电流滋滋（背景里时不时来一下）
    crackle(){
      if(!on) return;
      noiseHit(3100,.9,.045,.001,.030,'bandpass');
      setTimeout(()=>noiseHit(4300,1.2,.028,.001,.026,'bandpass'), 52);
      if(Math.random()<.45) setTimeout(()=>tone(2100,.02,.05,'square'), 96);
    },
    // 门的五种吱呀（铁门那种）
    doorOpen(){ this.creak(); setTimeout(()=>this.clang(), 640); },
    doorClose(){
      if(!on) return;
      noiseHit(180,1.0,.15,.003,.26,'lowpass');            // 门板撞框：闷、带一点余韵
      tone(126,.24,.18,'sine',58);                          // 木头/门框的低频
      setTimeout(()=>noiseHit(1700,2.6,.06,.001,.05,'bandpass'), 70);   // 锁舌"嗒"
      setTimeout(()=>this.creak(), 120);                     // 关到一半木头还在磨
    },
    randomEvent(){
      const r = Math.random();
      if(r<.40) this.clang(); else if(r<.75) this.drip(); else this.creak();
    }
  };
})();

/* ================= 音效系统：按 level.js 的「音效」播放真实 mp3 ================= */
const SFX = (function(){
  const CFG = (window.LEVEL_DATA && window.LEVEL_DATA.音效) || {};
  const DEL = new Set((window.LEVEL_DATA && window.LEVEL_DATA.删除音效) || []);
  const LIMIT = { breath:1, heart:1, ghostStep:2, step:3, drip:1 };
  const live = new Map();          // 事件 -> 正在播的 Audio[]
  const pool = new Map();          // 文件 -> Audio（复用，避免重复 new）
  let last = null;
  let master = 1;

  function src(f){ return '素材/音频/' + encodeURIComponent(f); }
  function audioFor(f){
    if(pool.has(f)) return pool.get(f);
    const a = new Audio(src(f));
    a.preload = 'auto';
    pool.set(f, a);
    return a;
  }
  function stopEvent(name){
    const arr = live.get(name) || [];
    for(const a of arr){ try{ a.pause(); a.currentTime = 0; }catch(e){} }
    live.set(name, []);
  }
  function stopAll(){ for(const k of live.keys()) stopEvent(k); }
  function play(name){
    if(DEL.has(name)) return false;
    const ev = CFG[name];
    if(!ev || !ev.items || !ev.items.length) return false;
    const files = ev.items.filter(function(it){ return it.kind==='file' && it.file; });
    if(!files.length) return false;                       // 纯合成音事件交给老的 Sound

    const lim = LIMIT[name] || 3;
    const arr = (live.get(name) || []).filter(function(a){ return a && !a.paused && !a.ended; });
    if(arr.length >= lim) return false;

    const it = ev.random ? files[(Math.random()*files.length)|0] : files[0];
    const a = audioFor(it.file);
    try{
      a.pause(); a.currentTime = 0;
      const _boost = (name === 'ghostStep') ? 1.9 :
                     (name === 'doorOpen' || name === 'doorClose') ? 1.25 : 1;   // 开关门再放大 1/4
      a.volume = Math.min(1, (ev.vol==null?1:ev.vol) * master * _boost);
      a.loop = false;
      a.__event = name;
    }catch(e){}

    // 重复 n 遍
    const reps = Math.max(1, it.repeat|0 || 1);
    if(reps > 1){
      let n = 1;
      a.onended = function(){
        if(n < reps){ n++; try{ a.currentTime = 0; a.play().catch(function(){}); }catch(e){} }
      };
    } else {
      a.onended = null;
    }

    // 到点掐断
    if(it.dur && it.dur > 0){
      setTimeout(function(){ try{ a.pause(); }catch(e){} }, it.dur*1000);
    }

    const p = a.play();
    if(p && p.catch) p.catch(function(){ /* 文件缺失：静默回落 */ });

    arr.push(a); live.set(name, arr);
    last = { name:name, file:it.file };
    return true;
  }

  // 音乐层：主界面 / 游戏内，loop 循环
  const music = {};
  function playMusic(name, on){
    const ev = CFG[name];
    if(!ev || !ev.items) return false;
    const f = (ev.items.find(function(it){ return it.kind==='file'; }) || {}).file;
    if(!f) return false;
    if(!on){ if(music[name]){ try{ music[name].pause(); }catch(e){} } return true; }
    if(!music[name]){
      const a = new Audio(src(f));
      a.loop = true; a.preload = 'auto';
      music[name] = a;
    }
    try{
      music[name].volume = Math.min(1, (ev.vol==null?1:ev.vol));
      const p = music[name].play();
      if(p && p.catch) p.catch(function(){});
    }catch(e){}
    return true;
  }
  function stopMusic(){ for(const k in music){ try{ music[k].pause(); }catch(e){} } }

  return { play:play, stopEvent:stopEvent, stopAll:stopAll, music:playMusic, stopMusic:stopMusic,
           get last(){ return last; }, setMaster:function(v){ master = v; } };
})();
window.SFX = SFX;
// ===== 胜利音：优先用 level.js 的 victory/win 音频；没有就合成一段上行和弦 =====
let _WIN_CTX = null;
function playWin(){
  try{ if(typeof SFX!=='undefined' && (SFX.play('victory') || SFX.play('win'))) return; }catch(e){}
  // 没有配置 victory 时，播这首阴森的"幸存"音（低沉嗡鸣 + 三全音）
  try{
    if(!window.__WIN_AUDIO){
      window.__WIN_AUDIO = new Audio('素材/音频/' + encodeURIComponent('胜利-阴森.wav'));
      window.__WIN_AUDIO.volume = 0.85;
    }
    const a = window.__WIN_AUDIO;
    a.currentTime = 0;
    const pr = a.play();
    if(pr && pr.then){ pr.then(function(){ window.__WIN_PLAYED = true; }).catch(function(){}); }
    if(window.__WIN_PLAYED || !a.error) return;
  }catch(e){}
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(!_WIN_CTX) _WIN_CTX = new AC();
    const ctx = _WIN_CTX;
    if(ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const notes = [392.00, 493.88, 587.33, 783.99];      // G4 B4 D5 G5（整体降纯四度，更低沉）
    const lp = ctx.createBiquadFilter();                 // 低通：削掉高频，声音更闷
    lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 0.6;
    lp.connect(ctx.destination);
    notes.forEach(function(f, i){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      const st = t0 + i*0.16;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.22, st + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.55);
      o.connect(g); g.connect(lp);
      o.start(st); o.stop(st + 0.6);
    });
  }catch(e){}
}


// 老 Sound 的对应方法改成"优先放真音频，没有文件再回落合成音"
(function(){
  const pairs = [['doorOpen','doorOpen'],['creak','doorOpen'],['doorClose','doorClose'],
                 ['ghostStep','ghostStep'],['heart','heart'],['breath','breath'],
                 ['slash','slash'],['drip','drip'],['scream','scream']];
  for(const pr of pairs){
    const k = pr[0], ev = pr[1];
    const f = Sound[k];
    if(typeof f === 'function'){
      Sound[k] = function(){ if(SFX.play(ev)) return; return f.apply(Sound, arguments); };
    }
  }
})();

// 滴水改由 Drip 控制器统一管理（单次、不重叠）

/* ---------- 12. 行走控制 ---------- */
const _spawn = SPAWN.player;
const _yaw0  = Math.atan2(SPAWN.ghost.x - _spawn.x, SPAWN.ghost.z - _spawn.z);   // 背对鬼出生
const player={x:_spawn.x, z:_spawn.z, yaw:_yaw0,
              pitch:-0.02, bob:0, y:0, vy:0, grounded:true};   // 出生点：全图随机（见 7c2）
let WON=false;
let flashOn=true;            // 手电默认「开」
let flashTipT=0;             // 按 F 之后显示 3 秒，然后完全消失

/* ---------- 2.0：菜单背景 —— 固定机位 + 吊在走廊上的那只鬼 ---------- */
const MENU_CAM = (()=>{
  const p=atPath(6);
  // 站在走廊中心线偏内侧 0.9 米，避开吊灯的锥形光罩（否则那块光罩会糊在镜头前）
  return {x:p.x - p.dz*0.9, z:p.z + p.dx*0.9,
          yaw:Math.atan2(-p.dx,-p.dz), pitch:-0.015};
})();
// 吊死鬼 3D 模型已彻底删除（主菜单用照片背景，走廊里不再有这只吊死鬼）
const HANG = null;

const keys=Object.create(null);
addEventListener('keydown',e=>{keys[e.code]=true;});
addEventListener('keyup',  e=>{keys[e.code]=false;});

/* —— 体力 + 冲刺开关 —— */
let   STAM_MAX=CFG.玩家.疾跑上限秒;                    // config.js 可调
const STAM_REGEN=CFG.玩家.体力回复秒, STAM_DELAY=0.9, WALK_SPD=CFG.玩家.走速, RUN_SPD=CFG.玩家.跑速;

// ===== 心跳：鬼在 12 米内才有，越近越快越响，单音源不重叠 =====
const Heart = (function(){
  let a = window.__HEART_AUDIO || null;
  let playing = false, fadeT = null, cur = 0;
  const START = 0.0, LOOP_END = 3.30;      // 心跳声2：3.42 秒一段，无缝循环
  function el(){
    if(!a){
      a = new Audio('素材/音频/' + encodeURIComponent('心跳声2-增强.mp3'));
      a.loop = true; a.preload = 'auto'; a.volume = 0;
      window.__HEART_AUDIO = a;
    }
    return a;
  }
  function fade(to, secs, done){
    const e = el();
    if(fadeT){ clearInterval(fadeT); fadeT = null; }
    const steps = Math.max(1, Math.round(secs*1000/40));
    let i2 = 0; const from = cur;
    fadeT = setInterval(function(){
      i2++; cur = from + (to-from)*(i2/steps);
      try{ e.volume = Math.max(0, Math.min(1, cur)); }catch(err){}
      if(i2 >= steps){ clearInterval(fadeT); fadeT = null; cur = to; if(done) done(); }
    }, 40);
  }
  function start(){
    const e = el();
    if(playing) return;
    playing = true;
    try{ if(e.currentTime < START) e.currentTime = START; }catch(err){}
    const pr = e.play();
    if(pr && pr.catch) pr.catch(function(){ playing = false; });
    cur = 0; fade(1.0, 0.3);
  }
  function stop(){
    if(!playing) return;
    playing = false;
    fade(0, 0.3, function(){ try{ el().pause(); }catch(err){} });
  }
  function update(dt, dist, active){
    const e = el();
    const _evH = (window.LEVEL_DATA && LEVEL_DATA.音效 && LEVEL_DATA.音效.heart) || {};
    const HR = (_evH.范围 !== undefined) ? _evH.范围 : 18;
    const inRange = active && dist <= HR;
    if(!inRange){ stop(); return; }
    if(!playing) start();
    // 跳过文件里的静音段，只在有鼓点的 1.05~20.2 秒之间循环
    try{ if(e.currentTime > LOOP_END) e.currentTime = START; }catch(err){}
    // 越近越快、越响
    const k = Math.max(0, Math.min(1, (dist - 3) / 15));       // 3m→0，18m→1
    try{ e.playbackRate = 1.45 - k * 0.45; }catch(err){}       // 3m 1.45x，18m 1.0x
    try{ e.volume = Math.max(0, Math.min(1, 1.0 - k*0.55)); }catch(err){}
    cur = e.volume;
  }
  return { update:update, get playing(){ return playing; }, _el:el };
})();

// 心跳的合成低频层：即使 mp3 声音小，也能保证"咚"一下听得见
let _HEART_CTX = null;
function heartThump(gain){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(!_HEART_CTX) _HEART_CTX = new AC();
    const ctx = _HEART_CTX;
    if(ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    for(const off of [0, 0.16]){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(58, t0+off);
      o.frequency.exponentialRampToValueAtTime(34, t0+off+0.13);
      g.gain.setValueAtTime(0.0001, t0+off);
      g.gain.exponentialRampToValueAtTime(0.55*(gain||1), t0+off+0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+off+0.18);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0+off); o.stop(t0+off+0.20);
    }
  }catch(e){}
}
// ===== 水滴：只播一次、不重叠、音量减半 =====
const Drip = (function(){
  const _evD = (window.LEVEL_DATA && LEVEL_DATA.音效 && LEVEL_DATA.音效.drip) || {};
  const DRIP_VOL = (_evD.音量 !== undefined) ? _evD.音量 : ((_evD.vol !== undefined) ? _evD.vol : 0.12);
  const DRIP_GAP = (_evD.间隔 !== undefined) ? _evD.间隔 : 8;
  let a = window.__DRIP_AUDIO || null, t = DRIP_GAP + Math.random()*4;
  function el(){
    if(!a){
      a = new Audio('素材/音频/' + encodeURIComponent('走廊尽头的水滴上，或者有水管子漏了之后的那个水滴声.mp3'));
      a.preload = 'auto'; a.volume = DRIP_VOL; window.__DRIP_AUDIO = a;
    }
    return a;
  }
  function update(dt, active){
    if(!active) return;
    t -= dt;
    if(t <= 0){
      t = DRIP_GAP + Math.random()*3;
      const e = el();
      try{ e.pause(); e.currentTime = 0; e.volume = DRIP_VOL; const pr = e.play(); if(pr && pr.catch) pr.catch(function(){}); }catch(err){}
    }
  }
  return { update:update, force:function(){ t = 0; } };
})();

let stamina=1, sprintHeld=false, exhausted=false, idleTime=0, lastStamPct=-1;
// ===== 喘息：只在体力 < 50% 期间发声，渐入 / 渐出，条件结束立即淡出停止 =====
const Breath = (function(){
  let a = window.__BREATH_AUDIO || null;      // 全局单例：绝不允许出现第二个喘息声源
  let playing = false, timer = null, curVol = 0, tgtVol = 0, breathNoiseT = 0;
  let lastStart = 0, lastUpdate = 0;
  const _evB = (window.LEVEL_DATA && LEVEL_DATA.音效 && LEVEL_DATA.音效.breath) || {};
  const BREATH_R = (_evB.范围 !== undefined) ? _evB.范围 : 1.65;   // 编辑器里可调
  function el(){
    if(!a){
      a = new Audio('素材/音频/' + encodeURIComponent('玩家恢复体力时的呼吸声.mp3'));
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      window.__BREATH_AUDIO = a;
    }
    return a;
  }
  function ramp(to, secs, done){
    const e = el();
    if(timer){ clearInterval(timer); timer = null; }
    const steps = Math.max(1, Math.round(secs*1000/40));
    let i = 0;
    const from = curVol;
    timer = setInterval(function(){
      i++;
      curVol = from + (to - from) * (i/steps);
      try{ e.volume = Math.max(0, Math.min(1, curVol)); }catch(err){}
      if(i >= steps){
        clearInterval(timer); timer = null; curVol = to;
        if(done) done();
      }
    }, 40);
  }
  function start(){
    const e = el();
    // 已经在响 / 刚启动过 / 元素还在播放 → 一律不再触发（喘气只触发一次）
    if(playing || !e.paused) return;
    const now = performance.now();
    if(now - lastStart < 1500) return;
    lastStart = now;
    window.__BREATH_PLAYS = (window.__BREATH_PLAYS||0) + 1;
    playing = true;
    try{ e.currentTime = 0; }catch(err){}
    const pr = e.play();
    if(pr && pr.catch) pr.catch(function(){ playing = false; });
    curVol = 0; tgtVol = 0.55;
    ramp(0.55, 0.35);
  }
  function stop(){
    if(!playing) return;
    playing = false;
    const e = el();
    ramp(0, 0.32, function(){ try{ e.pause(); e.currentTime = 0; }catch(err){} });
  }
  function update(stam, active){
    // 每帧只处理一次（防止同一帧被多个更新点重复调用）
    const nowMs = performance.now();
    if(nowMs - lastUpdate < 12) return;
    lastUpdate = nowMs;
    if(active === false){ stop(); return; }
    const want = stam < 0.5;                 // 关键判定：过半才喘，回到一半以上立刻停
    if(want){
      if(!playing) start();
      // 喘息的"传播半径"只有一个身位：1.65 米内才可能被听见，越远越弱
      breathNoiseT -= 0.016;
      if(breathNoiseT <= 0){
        breathNoiseT = 1.0;
        try{ emitNoise('breath', player.x, player.z, BREATH_R); }catch(e){}
      }
      // 体力越低，喘得越响（0.5→0.35，0→0.85）
      const v = 0.35 + (0.5 - Math.max(0, Math.min(0.5, stam))) / 0.5 * 0.50;
      if(Math.abs(v - tgtVol) > 0.06){ tgtVol = v; ramp(v, 0.25); }
    } else {
      stop();
    }
  }
  return { update:update, stop:stop, get playing(){ return playing; }, get vol(){ return +curVol.toFixed(2); }, _el:el };
})();

updateItemHud();          // 2.0：道具栏初值
let crouchHeld=false, EYE_H=1.62;   // 蹲：速度减半、没有脚步声
// 准心透明度（0–100，默认 25%）
let XH = parseInt(localStorage.getItem('corridor_xhair')||'25', 10);
if(isNaN(XH)) XH = 25;
document.documentElement.style.setProperty('--xh', String(XH/100));

const BASE_SENS = 0.0014;                       // 鼠标基准（原来 0.0021，太快了）
let sens = parseFloat(localStorage.getItem('corridor_sens') || '1.0');
let stepAcc=0, breathAcc=0, heartAcc=0, eventAcc=0, eventNext=rr(6,14);
const stamEl=document.getElementById('stam'), stamFill=stamEl.firstElementChild;
const stamAIEl=document.getElementById('stamAI'), stamAIFill=stamAIEl?stamAIEl.firstElementChild:null;
const fpsEl=document.getElementById('fps');

// Shift：按住加速，松开恢复走路（不再是开关）
const JUMP_V=Math.max(5.9, CFG.玩家.跳跃初速), GRAV=CFG.玩家.重力;
addEventListener('keydown',e=>{
  if(e.code==='Escape' && !e.repeat && STARTED && !DEAD){
    PAUSED = true;
    try{ TAP_ACTIVE = false; const ov2=document.getElementById('tapToPlay'); if(ov2) ov2.classList.remove('on'); }catch(err){}
    try{ if(document.pointerLockElement) document.exitPointerLock(); }catch(err){}
    try{ ui.classList.remove('hide'); showView('pPause'); }catch(err){}
    return;
  }
  if((e.code==='F8' || e.keyCode===119) && !e.repeat){
    try{
      RADAR = !RADAR;
      if(elRadar) elRadar.style.opacity = RADAR ? '1' : '0';   // 立刻生效，不等下一帧
      try{ drawRadar(); }catch(err){}
      toastTip(RADAR ? '调试地图：开（再按 F8 关闭）' : '调试地图：关');
    }catch(err){}
    e.preventDefault();
    return;
  }
  if(e.code==='F3' && !e.repeat){ try{ toggleStallPanel(); }catch(err){} return; }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ sprintHeld=true; }
  if(e.code==='KeyZ' && !e.repeat){ crouchHeld = !crouchHeld; }   // 按一次蹲，再按一次站
  // 空格跳跃
  if(e.code==='Space'){
    e.preventDefault();
    if(player.grounded){ player.vy=JUMP_V; player.grounded=false; }
  }
  // E 躲藏 / 出来
  if(e.code==='KeyE' && !e.repeat){
    // —— 安全门：有钥匙才能撤离 ——
    try{
      if(!GV.on && window.EXIT_INFO){
        const de = Math.hypot(player.x-EXIT_INFO.x, player.z-EXIT_INFO.z);
        if(de < 2.6){
          if(PLAYER_HAS_KEY){
            HUMANS_WON = true;
            try{ Sound.scream && Sound.scream(); }catch(err){}
            try{ playWin(); }catch(e){}
            showEndScreen('你逃出去了', '带着钥匙从安全门撤离');
          }else{
            toastTip('门已被锁上 · 需要先找到钥匙');
          }
          return;
        }
      }
    }catch(err){}
    const gd = nearestGlass();
    if(gd) toggleGlass(gd);
    else if(GV.on){
      const aim = aimTarget();
      if(aim && aim.kind==='item'){ /* 鬼不能捡人类的道具：直接忽略 */ }
      else if(aim && aim.kind==='cabinet'){                      // 抽屉：和人类一样，拉一层
        toggleDrawer(aim.ref);
      }
      else {
        const rd = nearestRoomDoor();                            // 真门：和玩家一样，只是开关
        if(rd){ setRoomDoor(rd, !rd.open); Sound.click(); }
        else ghostCheck();                                       // 假门 / 环廊门：检查
      }
    }
    else tryHide();
  }
  if(e.code==='KeyB' && !e.repeat){ toggleBag(); }
  // F 开关手电
  if(e.code==='KeyF' && !e.repeat){
    flashOn=!flashOn;
    try{ SFX.play(flashOn ? 'flashlightOn' : 'flashlightOff'); }catch(e){}
    flashTipT=3.0;
    Sound.click();
    if(!flashOn) flash.intensity=0;
  }
});
addEventListener('keyup',e=>{
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ sprintHeld=false; }
});
// 切到后台时松开，避免"切回来还在冲刺"
addEventListener('blur',()=>{ sprintHeld=false; crouchHeld=false; });
// 关掉右键菜单和右键手势（误触不会退回上一页）
document.addEventListener('contextmenu', e=>e.preventDefault());
document.addEventListener('mousedown', e=>{ if(e.button===2) e.preventDefault(); });
document.addEventListener('auxclick', e=>{ if(e.button===1||e.button===2) e.preventDefault(); });
// 左键：扔墨水（2.0）
addEventListener('mousedown', e=>{
  if(e.button!==0) return;
  if(document.pointerLockElement!==renderer.domElement) return;
  if(GV.on) ghostAttack();
  else if(HURT_LV>=2) toastTip('腿断了，扔不动东西');
  else if(INK_READY) throwInk();
  else toastTip('背包里点一下墨水，才能投掷');
});


/* ================= 14. 躲藏系统（E 键）· 第三人称动画 · 声音衰减 ================= */
// —— 听力半径：以红色立方体为参照物，2 个立方体 ≈ 2.3 米 ——
const CUBE_SIZE = 1.15;                    // 鬼的占位立方体边长
const HEAR_R    = 2 * CUBE_SIZE;           // 鬼能听见开关门的半径
const NOISE_LOG = [];

// 门声事件：返回鬼有没有听见
function emitNoise(kind, x, z, radius){
  const d = Math.hypot(ghost.position.x - x, ghost.position.z - z);
  const R = (radius && radius > 0) ? radius : HEAR_R;
  // 自定义半径的事件（喘息）：0 米=1.0，1 米=0.5，1.65 米=0，之后听不见
  let strength = 1;
  if(radius && radius > 0){
    strength = Math.max(0, Math.min(1, 1 - (d - 0.35) / 1.30));
  }
  const heard = (radius && radius > 0) ? (strength > 0.001) : (d <= R);
  NOISE_LOG.push({kind, x, z, d, heard, strength:+strength.toFixed(2)});
  if(NOISE_LOG.length > 40) NOISE_LOG.shift();
  if(heard){ ghost.userData.pulse = 1.0; }   // 鬼听见了：立方体闪红
  window.LAST_NOISE = {kind, d, heard};
  return heard;
}

// —— 第三人称时露出的"自己的身体" ——
const BODY = makePerson({cloth:0x39434f, torch:false});   // 玩家自己的身体不自带手电光源——关灯时"胸口/肩膀发亮"就是它自带的那盏 48 强度暖光在照自己
BODY.root.visible = false;
scene.add(BODY.root);

// —— 界面元素（动态创建，不动原 HTML 结构）——
const elPrompt = document.createElement('div');
elPrompt.style.cssText = 'position:fixed;left:50%;bottom:19%;transform:translateX(-50%);' +
  'padding:9px 18px;border:1px solid rgba(140,200,180,.55);border-radius:6px;' +
  'background:rgba(4,10,12,.72);color:#bfe6da;font:14px/1.4 system-ui,sans-serif;' +
  'letter-spacing:.06em;opacity:0;transition:opacity .18s;pointer-events:none;z-index:40;' +
  'text-shadow:0 0 8px rgba(90,220,180,.5)';
document.body.appendChild(elPrompt);

const elBlack = document.createElement('div');
elBlack.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;' +
  'pointer-events:none;z-index:35;transition:none';
document.body.appendChild(elBlack);

const elSlit = document.createElement('div');   // 右半边：被门挡住
elSlit.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none;z-index:36;' +
  'transition:opacity .25s;background:#000;' +
  'clip-path:polygon(100% 0, 100% 0, 100% 100%, 100% 100%)';
document.body.appendChild(elSlit);
// 门缝边缘的一道细高光，像门板的边
const elEdge = document.createElement('div');
elEdge.style.cssText = 'position:fixed;top:0;bottom:0;left:87.6%;width:2px;opacity:0;' +
  'pointer-events:none;z-index:37;transition:opacity .25s;' +
  'background:linear-gradient(to bottom, rgba(120,140,140,0), rgba(150,175,170,.28) 18%, rgba(120,140,140,.10) 82%, rgba(90,110,105,0))';
document.body.appendChild(elEdge);

const elFlash = document.createElement('div');   // 手电状态（右下角，很淡）
elFlash.style.cssText = 'position:fixed;right:22px;bottom:20px;color:#a8c6bd;' +
  'font:11px/1 system-ui,sans-serif;letter-spacing:.14em;opacity:.3;pointer-events:none;' +
  'z-index:40;transition:opacity .35s;text-shadow:0 0 6px rgba(0,0,0,.9)';
document.body.appendChild(elFlash);

const elTip = document.createElement('div');
elTip.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);' +
  'color:#7ea79b;font:13px/1.7 system-ui,sans-serif;letter-spacing:.10em;' +
  'text-align:center;opacity:0;transition:opacity .3s;pointer-events:none;z-index:41';
elTip.innerHTML = '躲 藏 中<br><span style="font-size:11px;opacity:.7">按 E 出来</span>';
document.body.appendChild(elTip);

const hideLamp = new THREE.PointLight(0x9fb6c4, 0, 5.0, 2.0);
scene.add(hideLamp);

const HIDE = {
  on:false, hidden:false, mode:'', t:0, door:null,
  cam:null, bodyFrom:null, bodyTo:null, tried:0
};

const _ray = new THREE.Raycaster();
const _ctr = new THREE.Vector2(0,0);
// 准心（屏幕正中）对着的门，3 米内才算
function nearestDoor(){
  // 交互判定只依赖"玩家离门多近 + 是否大致朝向"，不再依赖射线命中门板
  // （门板是挖了观察窗的四块拼装体，射线本来就会从窗口穿过去）
  const px=camera.position.x, pz=camera.position.z;
  camera.getWorldDirection(_aimDir);

  let best=null, bestScore=-1;
  for(const d of DOORS){
    if(d.kind === 'exit') continue;      // 出口门不是躲藏点
    const dx=d.x-px, dz=d.z-pz;
    const dist=Math.hypot(dx,dz);
    if(dist>2.4) continue;
    const dot=(dx*_aimDir.x + dz*_aimDir.z)/(dist||1e-3);
    if(dot<0.35) continue;                       // 大致朝门的方向
    const score = dot * (1 - dist/3.2);
    if(score>bestScore){ bestScore=score; best=d; }
  }
  return best;
}

function startHide(door){
  if(HIDE.on) return;
  HIDE.on = true; HIDE.mode='in'; HIDE.t=0; HIDE.door=door;
  HIDE._opened=false; HIDE._closed=false; HIDE._outOpen=false; HIDE._outClose=false;
  // 手电：关着就一定是 0；开着就把光源推到身体前面，避免照在角色自己身上
  if(!flashOn){ flash.intensity = 0; }
  flash.position.set(flashOn ? 0.06 : 0.16, flashOn ? -0.08 : -0.14, flashOn ? -2.05 : 0.06);
  HIDE.cam = { pos:new THREE.Vector3(player.x, 1.62, player.z),
               look:new THREE.Vector3(door.x, 1.15, door.z), roll:0,
               from:new THREE.Vector3(player.x, 1.62, player.z),
               to:null };
  // 第三人称机位：站在走廊里、离门 2.15 米、高 1.8 米
  const dp = atPath(pathD(door.x, door.z));
  // 过肩机位：离门 2.6 米、再往侧面让 0.95 米，避免自己挡住门
  HIDE.cam.to = new THREE.Vector3(
    door.x - dp.nx*2.35 + dp.dx*1.15,
    1.66,
    door.z - dp.nz*2.35 + dp.dz*1.15
  );
  HIDE.cam.look.set(door.x, 1.10, door.z);

  // 身体从玩家位置走到门口
  BODY.root.visible = true;
  BODY.root.position.set(player.x, 0, player.z);
  BODY.root.rotation.y = Math.atan2(door.x-player.x, door.z-player.z);
  HIDE.bodyFrom = new THREE.Vector3(player.x, 0, player.z);
  HIDE.bodyTo   = new THREE.Vector3(door.x - dp.nx*0.55, 0, door.z - dp.nz*0.55);
  HIDE.bodyYaw  = BODY.root.rotation.y;
};

function startExit(){
  if(HIDE.on) return;
  HIDE.on = true; HIDE.mode='out'; HIDE.t=0;
  HIDE._opened=false; HIDE._closed=false; HIDE._outOpen=false; HIDE._outClose=false;
  const dp = atPath(pathD(HIDE.door.x, HIDE.door.z));
  HIDE.exitFrom = new THREE.Vector3(player.x, 1.62, player.z);                       // 门内
  HIDE.exitTo   = new THREE.Vector3(HIDE.door.x - dp.nx*1.35, 1.62, HIDE.door.z - dp.nz*1.35); // 门外走廊
  HIDE.tp = new THREE.Vector3(HIDE.door.x - dp.nx*2.35 + dp.dx*1.15, 1.66,
                              HIDE.door.z - dp.nz*2.35 + dp.dz*1.15);                 // 过肩机位
  HIDE.cam = HIDE.cam || {pos:new THREE.Vector3(), look:new THREE.Vector3()};
  HIDE.cam.from = new THREE.Vector3(player.x, 1.62, player.z);
  HIDE.cam.to   = HIDE.tp.clone();
  HIDE.cam.look.set(HIDE.door.x, 1.10, HIDE.door.z);
  HIDE.bodyYaw = Math.atan2(-dp.dx, -dp.dz);          // 面向走廊
  HIDE.lookA = new THREE.Vector3(HIDE.door.x, 1.10, HIDE.door.z);                 // 看门
  HIDE.lookB = new THREE.Vector3(HIDE.exitTo.x - dp.dx*3.2, 1.52, HIDE.exitTo.z - dp.dz*3.2); // 看走廊
  HIDE.bodyFrom0 = new THREE.Vector3(player.x, 0, player.z);
  HIDE.bodyTo0   = new THREE.Vector3(HIDE.exitTo.x, 0, HIDE.exitTo.z);
  // 立刻撤掉门缝遮罩（否则会和第三人称镜头叠在一起）
  elSlit.style.transition='none'; elEdge.style.transition='none';
  elSlit.style.opacity='0'; elEdge.style.opacity='0'; elTip.style.opacity='0';
  setTimeout(function(){ elSlit.style.transition='opacity .25s'; elEdge.style.transition='opacity .25s'; }, 30);
  // 身体：从门内出现，面向走廊
  BODY.root.visible = true;
  BODY.root.position.set(player.x, 0, player.z);
  BODY.root.rotation.y = HIDE.bodyYaw;
  if(!flashOn){ flash.intensity = 0; }
  flash.position.set(flashOn ? 0.06 : 0.16, flashOn ? -0.08 : -0.14, flashOn ? -2.05 : 0.06);
};

const easeInOut = u => u<.5 ? 2*u*u : 1-Math.pow(-2*u+2,2)/2;

function updateHide(dt){
  // —— 门的开合：所有门每帧朝 target 转 ——
  for(const dr of DOORS){
    dr.hinge.rotation.y += (dr.target - dr.hinge.rotation.y) * Math.min(1, dt*7.5);
  }
  if(ghost.userData.pulse > 0){
    ghost.userData.pulse = Math.max(0, ghost.userData.pulse - dt*2.2);
    // 找鬼身上第一个真正带 emissive 的材质（ghost.children[0] 是个 Group，没有 material）
    let m = ghost.userData.bodyMat;
    if(!m){
      ghost.traverse(function(o){
        if(!m && o.isMesh && o.material && o.material.emissiveIntensity !== undefined) m = o.material;
      });
      ghost.userData.bodyMat = m || null;
    }
    if(m) m.emissiveIntensity = .32 + ghost.userData.pulse*1.6;
  }

  if(!HIDE.on) return;
  HIDE.t += dt;
  const t = HIDE.t;

  if(HIDE.mode === 'in'){
    /* 0.00–0.30 镜头拉到第三人称 */
    const u1 = Math.min(1, t/0.30);
    if(u1 < 1 || HIDE.cam.pos.y > 1.61){
      HIDE.cam.pos.lerpVectors(HIDE.cam.from, HIDE.cam.to, easeInOut(u1));
    } else {
      HIDE.cam.pos.copy(HIDE.cam.to);
    }
    /* 0.14–0.46 左右看一眼（身体转向） */
    if(t > 0.14 && t < 0.46){
      const k = (t-0.14)/0.32;
      BODY.root.rotation.y = HIDE.bodyYaw + Math.sin(k*Math.PI*2)*0.42;
    }
    /* 0.40–0.62 先开门 */
    if(t >= 0.40 && !HIDE._opened){
      HIDE._opened = true; HIDE.door.target = -1.55;
      Sound.doorOpen(); emitNoise('door-open', HIDE.door.x, HIDE.door.z);
    }
    /* 0.58–0.92 门开了再走进去 */
    if(t >= 0.58 && t <= 0.92){
      const k = Math.min(1,(t-0.58)/0.34);
      BODY.root.position.lerpVectors(HIDE.bodyFrom, HIDE.bodyTo, easeInOut(k));
      BODY.root.rotation.y = HIDE.bodyYaw;
    }
    /* 0.88–1.14 黑场 */
    elBlack.style.opacity = String(Math.min(1, Math.max(0,(t-0.88)/0.26)));
    /* 1.04–1.36 关门 */
    if(t >= 1.04 && !HIDE._closed){
      HIDE._closed = true; HIDE.door.target = 0;
      Sound.doorClose(); emitNoise('door-close', HIDE.door.x, HIDE.door.z);
    }
    if(t >= 1.46){                                  // 结束：进入"躲藏中"
      HIDE.on=false; HIDE.hidden=true;
      HIDE.cam=null;                                // ★ 镜头交还，用玩家的位置/朝向
      BODY.root.visible=false;
      let dp2, md2 = null;
      if(MAZE){
        // 迷宫模式：门自己带 rotY，直接算"朝走廊"的法线（pathD 是环廊的，会算反）
        const rY = HIDE.door.rotY || 0;
        dp2 = { nx: -Math.sin(rY), nz: -Math.cos(rY) };
        HIDE.room = null;
      } else {
        dp2 = atPath(pathD(HIDE.door.x, HIDE.door.z));
        md2 = MAP.doors.reduce((a2,b2)=>{
          const q1=Math.hypot(a2.x-HIDE.door.x, a2.z-HIDE.door.z);
          const q2=Math.hypot(b2.x-HIDE.door.x, b2.z-HIDE.door.z);
          return q2<q1?b2:a2;
        }, MAP.doors[0]);
      }
      player.x = HIDE.door.x + dp2.nx*0.55;   // 贴近观察窗，看得更宽
      player.z = HIDE.door.z + dp2.nz*0.55;
      // 相机 forward = (-sin yaw, -cos yaw)；要看向走廊（-n 方向）
      player.yaw = Math.atan2(dp2.nx, dp2.nz);
      HIDE.baseYaw = player.yaw;
      if(!MAZE) HIDE.room = (md2 && md2.box) ? md2.box : null;  // 柜内活动范围
      player.pitch = 0.0;
      if(flashOn){ HIDE.flashBack = true; flashOn = false; flash.intensity = 0; }
      // 补光放到"人与门之间"，只照亮门和窗口，两侧柜壁留暗
      hideLamp.position.set(
        player.x - dp2.nx*0.45,
        1.52,
        player.z - dp2.nz*0.45
      );
      hideLamp.intensity = 0.16;
      hideLamp.distance  = 1.7;
      elBlack.style.opacity='0';                    // ★ 黑场必须撤掉，否则一直全黑
      elTip.style.opacity='1';
      elSlit.style.opacity='1';                     // 右半边被门挡住
      elEdge.style.opacity='1';
    }
  }

  if(HIDE.mode === 'out'){
    /* 0.00 开门 + 撤掉门缝遮罩 */
    if(!HIDE._outOpen){
      HIDE._outOpen = true; HIDE.door.target = -1.55;
      Sound.doorOpen(); emitNoise('door-open', HIDE.door.x, HIDE.door.z);
      elTip.style.opacity='0'; elSlit.style.opacity='0'; elEdge.style.opacity='0';
    }
    elBlack.style.opacity = '0';

    /* 0.00–0.30 镜头从门内拉到第三人称 */
    const k1 = Math.min(1, t/0.30);
    HIDE.cam.pos.lerpVectors(HIDE.exitFrom, HIDE.tp, easeInOut(k1));

    /* 0.26–0.56 左右看一眼 */
    if(t > 0.26 && t < 0.56){
      BODY.root.rotation.y = HIDE.bodyYaw + Math.sin((t-0.26)/0.30*Math.PI*2)*0.42;
    } else {
      BODY.root.rotation.y = HIDE.bodyYaw;
    }

    /* 0.56–0.92 走出门 */
    if(t >= 0.56){
      const k = Math.min(1,(t-0.56)/0.36);
      BODY.root.position.lerpVectors(HIDE.bodyFrom0, HIDE.bodyTo0, easeInOut(k));
    }

    /* 0.88 起藏掉身体，避免镜头穿过模型 */
    if(t >= 0.88) BODY.root.visible = false;

    /* 0.92–1.10 先把门关上（否则镜头回退时会穿过开着的门板） */
    if(t >= 0.92 && !HIDE._outClose){
      HIDE._outClose = true; HIDE.door.target = 0;
      Sound.doorClose(); emitNoise('door-close', HIDE.door.x, HIDE.door.z);
    }

    /* 1.08–1.42 镜头自然回到第一人称，视线从门转向走廊 */
    if(t >= 1.08){
      const k = Math.min(1,(t-1.08)/0.34);
      HIDE.cam.pos.lerpVectors(HIDE.tp, HIDE.exitTo, easeInOut(k));
      HIDE.cam.look.lerpVectors(HIDE.lookA, HIDE.lookB, easeInOut(k));
    }

    if(t >= 1.50){
      HIDE.on=false; HIDE.hidden=false; HIDE.cam=null;
      BODY.root.visible=false;
      elBlack.style.opacity='0'; elTip.style.opacity='0';
      hideLamp.intensity = 0;
      elSlit.style.opacity='0'; elEdge.style.opacity='0';
      if(HIDE.flashI){
        flash.intensity = HIDE.flashI; HIDE.flashI = 0;
        if(HIDE.flashP){ flash.position.copy(HIDE.flashP); HIDE.flashP = null; }
      }
      player.x = HIDE.exitTo.x; player.z = HIDE.exitTo.z;   // 人已经在门外
      flash.position.set(0.16,-0.14,0.06);                   // 手电恢复原位
      if(HIDE.flashBack){ HIDE.flashBack = false; flashOn = true; flashTipT = 3.0; }
    }
  }
}

function nearestRoomDoor(){
  camera.getWorldDirection(_aimDir);
  let best=null, bs=-1;
  for(const d of ROOM_DOORS){
    const dx=d.x-camera.position.x, dz=d.z-camera.position.z;
    const dist=Math.hypot(dx,dz);
    if(dist>2.4) continue;
    const dot=(dx*_aimDir.x + dz*_aimDir.z)/(dist||1e-3);
    if(dot<0.30) continue;
    const sc=dot*(1-dist/3.2);
    if(sc>bs){ bs=sc; best=d; }
  }
  return best;
}
// 鬼砍中人之后：强制把人类从柜子里拽到走廊上，立刻可跑
function forceOutOfHide(){
  if(!HIDE.hidden) return;
  const dr = HIDE.door;
  if(dr){
    const dp = atPath(pathD(dr.x, dr.z));
    // 门外 1.15 米，略微侧一点，避免正对门板
    player.x = dr.x - dp.nx*1.15 + dp.dx*0.35;
    player.z = dr.z - dp.nz*1.15 + dp.dz*0.35;
    player.yaw = Math.atan2(dp.nx, dp.nz);      // 背对门，面朝走廊
    player.pitch = 0;
  }
  HIDE.hidden = false;
  HIDE.on     = false;
  HIDE.cam    = null;
  HIDE.room   = null;
  BODY.root.visible = false;
  BODY.root.position.set(player.x, 0, player.z);
  elSlit.style.opacity = '0';
  elEdge.style.opacity = '0';
  elTip.style.opacity  = '0';
  hideLamp.intensity   = 0;
  flashOn = true;  flash.intensity = FLASH_I;   // 出来还他手电，方便逃
  toastTip('你被拽了出来！快跑！');
}

function tryHide(){
  if(GV.on) return;             // 鬼不能躲藏
  if(HIDE.on) return;
  if(HURT_LV>=2 && !HIDE.hidden){ toastTip('腿断了，够不到门'); return; }
  if(HIDE.hidden){ startExit(); return; }
  const aim = aimTarget();               // ① 准心对准的东西优先（柜子 / 道具）
  if(aim){
    if(aim.kind==='item'){ pickupItem(aim.ref); return; }
    if(aim.kind==='cabinet'){ toggleDrawer(aim.ref); return; }
  }
  const rd = nearestRoomDoor();          // ② 房间门：E 键开关
  if(rd){ setRoomDoor(rd, !rd.open); Sound.click(); return; }
  const dr = nearestDoor();              // ③ 环廊上可以躲进去的门
  if(dr){ startHide(dr); }
}

// —— 每帧：提示 + 黑场 + 镜头接管 ——
function updateHideUI(){
  if(!STARTED){ elPrompt.style.opacity='0'; return; }     // 菜单里不要冒交互提示
  if(!HIDE.hidden) elTip.style.opacity='0';          // 不在躲藏中，"躲藏中"必须消失
  if(HIDE.on || HIDE.hidden){ elPrompt.style.opacity='0'; return; }
  const dr = nearestDoor();
  if(GV.on){
    // 鬼：红色提示（门 / 柜子 / 道具 全用这一条样式）
    let aim2 = aimTarget();
    if(aim2 && aim2.kind==='item') aim2 = null;      // 鬼对道具不显示任何提示
    const rd2 = (dr || aim2) ? null : nearestRoomDoor();
    if(dr || aim2 || rd2){
      elPrompt.textContent = (LANG_CODE==='en')
        ? (aim2 && aim2.kind==='cabinet' ? '[E] OPEN' : (rd2 ? (rd2.open ? '[E] CLOSE' : '[E] OPEN') : '[E] CHECK'))
        : (aim2 && aim2.kind==='cabinet' ? (aim2.ref.open ? '按 E 关柜子' : '按 E 开柜子')
           : (rd2 ? (rd2.open ? '按 E 关门' : '按 E 开门') : '按 E 检查'));
      elPrompt.style.color = '#ff9b8a';
      elPrompt.style.borderColor = 'rgba(210,110,90,.55)';
      elPrompt.style.textShadow = '0 0 8px rgba(255,90,60,.45)';
      elPrompt.style.opacity = '1';
    } else elPrompt.style.opacity='0';
    return;
  }
  // 人类：绿色提示（保留原来的躲藏文案）
  elPrompt.style.color = '#bfe6da';
  elPrompt.style.borderColor = 'rgba(140,200,180,.55)';
  elPrompt.style.textShadow = '0 0 8px rgba(90,220,180,.5)';

  // ① 安全门优先：有钥匙=可以撤离，没钥匙=门锁着
  try{
    if(window.EXIT_INFO && !GV.on){
      const de = Math.hypot(player.x-EXIT_INFO.x, player.z-EXIT_INFO.z);
      if(de < 3.0){
        elPrompt.textContent = PLAYER_HAS_KEY
          ? (LANG_CODE==='en' ? '[E] ESCAPE' : '按 E 逃离')
          : (LANG_CODE==='en' ? 'LOCKED · NEED KEY' : '门已上锁 · 需要找钥匙');
        elPrompt.style.opacity = '1';
        return;
      }
    }
  }catch(e){}

  // ② 准心对着钥匙/道具：显示拾取
  try{
    const aimH = aimTarget();
    if(aimH && aimH.kind==='item'){
      const isKey = aimH.ref && aimH.ref.kind === 'key';
      elPrompt.textContent = (LANG_CODE==='en')
        ? (isKey ? '[E] TAKE KEY' : '[E] TAKE')
        : (isKey ? '按 E 拾取钥匙' : '按 E 拾取');
      elPrompt.style.opacity = '1';
      return;
    }
    if(aimH && aimH.kind==='cabinet'){
      elPrompt.textContent = (LANG_CODE==='en')
        ? (aimH.ref.open ? '[E] CLOSE' : '[E] OPEN')
        : (aimH.ref.open ? '按 E 关柜子' : '按 E 开抽屉');
      elPrompt.style.opacity = '1';
      return;
    }
  }catch(e){}

  if(dr){
    elPrompt.textContent = (LANG_CODE==='en') ? '[E] HIDE' : '按 E 躲进去';
    elPrompt.style.opacity='1';
  } else {
    const rd1 = nearestRoomDoor();
    if(rd1){
      elPrompt.textContent = (LANG_CODE==='en') ? (rd1.open ? '[E] CLOSE' : '[E] OPEN')
                                                : (rd1.open ? '按 E 关门' : '按 E 开门');
      elPrompt.style.opacity='1';
    } else {
      elPrompt.style.opacity='0';
    }
  }
}

window.HIDE = HIDE; window.DOORS = DOORS; window.NOISE_LOG = NOISE_LOG;
window.HEAR_R = HEAR_R;

const ui=document.getElementById('ui');

/* ================= 界面：主菜单 / 语言 / 皮肤 ================= */
const $id = id => document.getElementById(id);
let LANG_CODE = localStorage.getItem('corridor_lang') || 'zh';
let STARTED = false;

const I18N = {
  zh: {
    title:'走 廊', sub:'程序化生成 · 零外部素材',
    start:'开始游戏', resume:'继续游戏', settings:'设置', controls:'说明',
    skin:'皮肤', quit:'退出游戏', lang:'English', back:'返回',
    sens:'鼠标灵敏度', vol:'音量', xhair:'准星透明度', qual:'画质', gpu:'显卡',
    q0:'低（流畅）', q1:'中（推荐）', q2:'高（清晰）',
    hint:'调完点「返回」，再点「开始游戏」',
    kMove:'移动', kLook:'鼠标', kTurn:'转向', kShift:'按住加速', kSpace:'跳跃',
    kF:'开关手电', kEsc:'暂停 / 打开菜单',
    skinHint:'联机时，其他玩家看到的就是这个颜色',
    bye:'可以关掉这个标签页了', win:'你逃出去了', winHint:'你找到了安全出口', winBtn:'再来一次', hud:'WASD 移动 · Shift 加速 · 空格 跳跃 · F 手电 · Esc 菜单'
  },
  en: {
    title:'C O R R I D O R', sub:'procedural · no external assets',
    start:'START GAME', resume:'RESUME', settings:'Settings', controls:'Info',
    skin:'Character', quit:'Quit', lang:'中文', back:'Back',
    sens:'Mouse sensitivity', vol:'Volume', xhair:'Crosshair opacity', qual:'Quality', gpu:'GPU',
    q0:'Low', q1:'Medium', q2:'High',
    hint:'Press Back, then Start Game',
    kMove:'Move', kLook:'Mouse', kTurn:'Look', kShift:'Hold to sprint', kSpace:'Jump',
    kF:'Flashlight', kEsc:'Pause / menu',
    skinHint:'This is the colour other players will see',
    bye:'You can close this tab now', win:'YOU ESCAPED', winHint:'You found the emergency exit', winBtn:'Play again', hud:'WASD move · Shift sprint · Space jump · F flashlight · Esc menu'
  }
};
const T = k => (I18N[LANG_CODE] || I18N.zh)[k] || k;

/* —— 皮肤：只换衣服颜色 —— */
const SKINS = [0x2b3138,0x3a2f2a,0x2a3a2e,0x372b45,0x1e2a3a,0x4a3a2a,0x332a2a,0x2e3f45,0x4b4a3d,0x243b34];
let SKIN = SKINS[0];
try{ const sv = parseInt(localStorage.getItem('corridor_skin')); if(SKINS.indexOf(sv)>=0) SKIN = sv; }catch(e){}

function drawSkin(){
  const c = $id('skinPrev'); if(!c) return;
  const x = c.getContext('2d');
  x.clearRect(0,0,c.width,c.height);
  const col = '#'+SKIN.toString(16).padStart(6,'0');
  const cx = c.width/2;
  x.fillStyle='#8a7b6d'; x.fillRect(cx-17,22,34,38);            // 头
  x.fillStyle='#0a0a0c';
  x.fillRect(cx-10,36,6,5); x.fillRect(cx+4,36,6,5);             // 眼
  x.fillRect(cx-8,50,16,2);                                      // 嘴
  x.fillStyle=col;        x.fillRect(cx-27,62,54,80);            // 躯干
  x.fillRect(cx-48,68,19,66); x.fillRect(cx+29,68,19,66);        // 手臂
  x.fillStyle='#1b1f25';  x.fillRect(cx-26,144,22,78);           // 腿
  x.fillRect(cx+4,144,22,78);
  x.fillStyle='#101216';  x.fillRect(cx-28,219,26,10); x.fillRect(cx+2,219,26,10);  // 鞋
  x.fillStyle='rgba(255,255,255,.06)'; x.fillRect(0,232,c.width,1);
  x.fillStyle='#5c6472'; x.font='11px system-ui'; x.textAlign='center';
  x.fillText('#'+SKIN.toString(16).toUpperCase().padStart(6,'0'), cx, 248);
}

function buildSwatches(){
  const wrap = $id('swatches'); if(!wrap) return;
  wrap.innerHTML='';
  SKINS.forEach(v=>{
    const i=document.createElement('i');
    i.style.background='#'+v.toString(16).padStart(6,'0');
    if(v===SKIN) i.className='on';
    i.onclick=()=>{
      SKIN=v; localStorage.setItem('corridor_skin', String(v));
      [...wrap.children].forEach(c=>c.classList.remove('on'));
      i.classList.add('on'); drawSkin();
    };
    wrap.appendChild(i);
  });
}

function applyLang(){
  const t = I18N[LANG_CODE];
  $id('uiTitle').textContent = t.title;
  $id('btnLang').textContent = t.lang;
  $id('btnStart').textContent = t.start;   // 主菜单永远是开始游戏，继续游戏只在暂停页
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = T(el.dataset.i18n); });
  const row=(k,v)=>'<div class="row"><span class="key">'+k+'</span><span>'+v+'</span></div>';
  const H_LIST = [
    ['W A S D', '移动'], ['鼠标', '转视角'], ['Shift', '按住冲刺（消耗体力）'],
    ['空格', '跳跃'], ['Z', '蹲下（无脚步声）'], ['F', '开关手电'],
    ['E', '开门 / 抽屉 / 躲藏 / 拾取'], ['左键', '投掷墨水'],
    ['B', '背包'], ['F8', '调试地图'], ['Esc', '暂停 / 菜单']
  ];
  const G_LIST = [
    ['W A S D', '移动'], ['鼠标', '转视角'], ['Shift', '冲刺 3 秒 · 耗尽要喘气'],
    ['空格', '跳跃'], ['Z', '蹲下（无脚步声）'],
    ['E', '开门 / 开抽屉 / 检查假门'], ['左键', '挥刀攻击'],
    ['F8', '调试地图'], ['Esc', '暂停 / 菜单']
  ];
  const kh=$id('keyListHuman'), kg=$id('keyListGhost');
  if(kh) kh.innerHTML = H_LIST.map(function(x){return row(x[0],x[1]);}).join('');
  if(kg) kg.innerHTML = G_LIST.map(function(x){return row(x[0],x[1]);}).join('');
  const kl=$id('keyList');
  if(kl) kl.innerHTML = H_LIST.map(function(x){return row(x[0],x[1]);}).join('');
  $id('hud').textContent = '';
  $id('hud').style.display='none';      // 游玩中不显示操作提示
  const vb=$id('verLine');
  if(vb) vb.innerHTML = '<div style="font-size:13px;color:#cfd8e0;letter-spacing:.1em">v3.0</div>' +
    '<div style="margin-top:6px;font-size:11px;line-height:1.9;color:#6d7b88">' +
    '肉鸽 · 随机门位<br>抽屉 / 架子交互<br>鬼的断肢伤害<br>4 人联机筹备中</div>';
  $id('winTitle').textContent = t.win;
  $id('winHint').textContent  = t.winHint;
  $id('winBtn').textContent   = t.winBtn;
  document.documentElement.lang = LANG_CODE;
  $id('btnLang').textContent = t.lang;
}

function showView(id){
  try{ RADAR = false; }catch(e){}          // 进任何菜单都关掉调试地图，不带进下一局
  // 菜单期间收起游戏内 HUD（HUD 是独立元素，不在 #ui 里，必须单独关）
  try{
    const h=document.getElementById('hud'); if(h) h.style.display='none';
    const it=document.getElementById('items'); if(it) it.style.display='none';
    const gt=document.getElementById('ghostTag'); if(gt) gt.style.opacity='0';
    if(typeof elRadar!=='undefined' && elRadar) elRadar.style.opacity='0';
  }catch(e){}
  ['pMain','pMode','pCamp','pSettings','pControls','pSkin','pBye','pWin','pPause'].forEach(v=>{
    const el=$id(v); if(el) el.classList.toggle('on', v===id);
  });
  // 3.0：所有菜单页都透出同一张背景图（包括选择阵营、设置、按键说明）
  const ui = document.getElementById('ui');
  if(ui) ui.classList.add('menuBg');
  const _ma3=document.getElementById('menuArt'); if(_ma3) _ma3.style.opacity='1';
  // 立刻按当前状态重画一帧，避免出现"背景还没绘制"的黑屏瞬间
  try{ if(typeof drawMenuFrame==='function') drawMenuFrame(performance.now()); }catch(e){}
}
showView('pMain');

$id('btnResume').onclick = ()=>{
  PAUSED = false;       // 先解除暂停，否则 beginPlay 会以为还在菜单里
  beginPlay();          // 再出"点击画面继续"，点一下才锁鼠标
};

// 重新上锁；浏览器刚退出鼠标锁时短时间内不允许再锁，
// 那就兜底退回暂停菜单，绝不出现"菜单没了、世界冻住、也点不动"的死局
let TAP_ACTIVE = false;
function beginPlay(){
  PAUSED = false;
  try{ ui.classList.add('hide'); }catch(e){}
  // 关键：把"吊死鬼照片"背景关掉，否则游戏在跑，但照片一直盖在上面（就是那个卡住的界面）
  try{ const ma = document.getElementById('menuArt'); if(ma) ma.style.opacity = '0'; }catch(e){}
  try{ ui.classList.remove('menuBg'); }catch(e){}
  try{ const lm = document.getElementById('loadMask'); if(lm) lm.classList.remove('on'); }catch(e){}
  try{ const ov = document.getElementById('tapToPlay'); if(ov) ov.classList.remove('on'); }catch(e){}
  relockPointer();
}
function relockPointer(){
  const d = renderer.domElement;
  let p = null;
  try{ p = d.requestPointerLock(); }catch(e){}
  if(p && p.catch) p.catch(function(){});
  setTimeout(function(){
    if(STARTED && !DEAD && document.pointerLockElement !== d){
      // 锁不上也照样进游戏：世界不冻结，玩家用键盘能走，点一下画面再锁鼠标
      PAUSED = false;
      try{ ui.classList.add('hide'); }catch(e){}
      try{ toastTip('点一下画面锁定鼠标（浏览器刚放开，需要等一下）'); }catch(e){}
    }
  }, 700);
}
$id('btnToMenu').onclick = ()=>{ backToMenu(); };
$id('btnSettings').onclick = ()=>showView('pSettings');
$id('btnControls').onclick = ()=>showView('pControls');
$id('btnSkin').onclick     = ()=>{ showView('pSkin'); drawSkin(); };
document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>showView('pMain'));
$id('btnLang').onclick = ()=>{
  LANG_CODE = (LANG_CODE==='zh') ? 'en' : 'zh';
  localStorage.setItem('corridor_lang', LANG_CODE);
  applyLang();
};
$id('btnQuit').onclick = ()=>{
  if(!confirm(LANG_CODE==='en' ? 'Quit the current game?' : '确定要退出当前游戏吗？')) return;
  if(document.pointerLockElement) document.exitPointerLock();
  showView('pBye');
  try{ window.close(); }catch(e){}
  setTimeout(()=>{ showView('pBye'); }, 120);
};
buildSwatches(); drawSkin(); applyLang();
paintMenuBackdrop();

// 只有「开始游戏」按钮才进入游戏（先选阵营）
let CAMP='human';

// 整个程序只编译一次着色器：放在"加载中"遮罩后面做，做完再进游戏
window.__BOOT = [];
function bootMark(n){ try{ window.__BOOT.push([n, +performance.now().toFixed(0)]); }catch(e){} }
let _warmedOnce = false;
let _warming = false;
const _afterWarm = [];

// 立刻把加载页亮出来（先让浏览器画一帧，再做后面的重活），
// 避免"点完之后先卡 1~2 秒才看到加载页"
function showLoadingNow(text){
  const mask = document.getElementById('loadMask');
  if(!mask) return;
  mask.classList.add('on');
  const lb = mask.querySelector('div');
  if(lb && text) lb.textContent = text;
}
function afterPaint(fn){
  requestAnimationFrame(function(){ requestAnimationFrame(fn); });
}

function warmupOnce(cb, silent){
  bootMark(silent ? 'silent-warm-start' : 'warm-start');
  const mask = document.getElementById('loadMask');
  const label = mask ? mask.querySelector('div') : null;
  if(_warming){
    _afterWarm.push(function(){ warmupOnce(cb, silent); });
    return;
  }
  if(_warmedOnce){
    // 第二局起：已经编译过，不用再等，但加载页必须收掉（以前没收 → 看着像卡死）
    cb && cb();
    try{ renderer.render(scene, camera); }catch(e){}
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        if(mask) mask.classList.remove('on');
        try{ beginPlay(); }catch(e){}
      });
    });
    return;
  }
  if(mask && !silent) mask.classList.add('on');
  if(label && !silent) label.textContent = '预 加 载 资 源';
  const t0 = performance.now();

  // 需要预加载的图片（鬼脸、菜单背景等）
  const imgs = [];
  try{ if(typeof FACE_IMG !== 'undefined' && FACE_IMG) imgs.push(FACE_IMG); }catch(e){}
  try{ if(typeof MENU_BG !== 'undefined' && MENU_BG) imgs.push(MENU_BG); }catch(e){}
  try{ if(typeof MENU_BG2 !== 'undefined' && MENU_BG2) imgs.push(MENU_BG2); }catch(e){}

  let started = false;
  const boot = function(){
    if(started) return;            // 图片超时和加载完成只走一次
    started = true;
    if(label) label.textContent = '正 在 准 备 场 景';
    // 先让"加载中"这一帧画出来，再进游戏，再编译着色器
    requestAnimationFrame(function(){
      try{ cb && cb(); }catch(e){}
      requestAnimationFrame(function(){
        _warming = true;
        // 玩鬼的话，先把鬼视角切好再编译，否则鬼视角那套材质要等进游戏才编，还是会卡
        let _gvWasOff = false;
        try{
          if(typeof GV !== 'undefined'){
            if(typeof CAMP !== 'undefined' && CAMP === 'ghost' && !GV.on){ toggleGhostView(); }
            else if(silent && !GV.on){ toggleGhostView(); _gvWasOff = true; }   // 静默预热：顺手编鬼视角
          }
        }catch(e){}
        const tmp = [];
        const show = function(o){ if(o && o.visible === false){ tmp.push([o, false]); o.visible = true; } };
        try{ show(BODY.root); }catch(e){}
        try{ show(ghost); }catch(e){}
        try{ (AI.humans||[]).forEach(function(h){ show(h.person.root); }); }catch(e){}

        // 把 4 个 AI 人类临时搬到镜头正前方，强制它们真正被"画"一次
        // （只改 visible 不够，渲染器会跳过不在视野里的物体，材质照样没编译）
        const _aiSaved = [];
        try{
          const _dir = new THREE.Vector3(); camera.getWorldDirection(_dir);
          const _base = camera.position.clone().add(_dir.multiplyScalar(3.2));
          (AI.humans||[]).forEach(function(h, i){
            const p = h.person.root.position;
            _aiSaved.push([h.person.root, p.x, p.z, h.person.root.visible]);
            h.person.root.position.set(_base.x + (i-1.5)*0.85, 0, _base.z + (i%2)*0.4);
            h.person.root.visible = true;
          });
        }catch(e){}
        try{
          // 所有灯临时点一次（含影子）：把"灯光+影子"版本的材质也提前编好，
          // 否则游戏中途第一次开灯/开影子会突然编译，卡死好几秒
          const lampSave = [];
          try{
            scene.traverse(function(o){
              if(!o.isLight) return;
              lampSave.push([o, o.intensity, o.castShadow]);
              if(o.intensity === 0) o.intensity = 1.0;
              // 不给额外的灯强开影子：影子变体会让编译量翻倍，卡得更久
            });
          }catch(e){}
          try{
            if(label) label.textContent = '编 译 场 景';
            // 原地转一圈渲染 8 个方向：把"出生点附近真正会看到的材质"全部编掉，
            // 既不像全量 compile 那样卡十几秒，也不会进游戏后走两步就新编一次。
            const _yaw0 = (typeof player !== 'undefined') ? player.yaw : 0;
            for(let i=0;i<8;i++){
              try{ if(typeof player !== 'undefined'){ player.yaw = _yaw0 + i*Math.PI/4; camera.rotation.y = -player.yaw; } }catch(e){}
              renderer.render(scene, camera);
            }
            try{ if(typeof player !== 'undefined') player.yaw = _yaw0; }catch(e){}
            renderer.render(scene, camera);
          }finally{
            lampSave.forEach(function(r){ r[0].intensity = r[1]; r[0].castShadow = r[2]; });
          }
        }catch(e){}
        tmp.forEach(function(pair){ pair[0].visible = pair[1]; });
        try{ _aiSaved.forEach(function(r){ r[0].position.set(r[1], 0, r[2]); r[0].visible = r[3]; }); }catch(e){}
        try{ if(_gvWasOff && GV.on) toggleGhostView(); }catch(e){}
        _warmedOnce = true;
        _warming = false;
        try{ const q = _afterWarm.splice(0); q.forEach(function(f){ try{ f(); }catch(e){} }); }catch(e){}
        if(silent){ return; }
        // 加载页至少停 0.9 秒，避免一闪而过
        const wait = Math.max(0, 900 - (performance.now()-t0));
        setTimeout(function(){
          if(mask) mask.classList.remove('on');
          try{ beginPlay(); }catch(e){}     // 场景就绪 → 出"点击画面开始"
        }, wait);
      });
    });
  };

  if(!imgs.length){ boot(); return; }
  let pending = imgs.length;
  const one = function(){ if(--pending <= 0) boot(); };
  imgs.forEach(function(im){
    if(im.complete && im.naturalWidth) one();
    else{
      im.addEventListener('load', one, { once:true });
      im.addEventListener('error', one, { once:true });
    }
  });
  setTimeout(boot, 2500);      // 图片卡住也不许拦住开局
}


function startGame(camp){
  window.__MAZE_REGION = null;      // 出口/柜子都建好了，重新算一次连通区（带出口加权）
  CAMP = camp || CAMP;
  STARTED = true;
  const _ui0 = document.getElementById('ui');
  if(_ui0){ _ui0.classList.remove('menuBg'); _ui0.classList.add('hide'); }
  PAUSED = false;
  const _ma = document.getElementById('menuArt');
  if(_ma) _ma.style.opacity = '0';
  fadeIntoGame();
  bootMark('startGame');
  try{
    if(window.Net && location.search.indexOf('mp=1') >= 0 && !Net.connected){
      const nm = (new URLSearchParams(location.search)).get('name') || '玩家';
      Net.connect(nm);
      const t=setTimeout(()=>{ try{ Net.attach(scene, THREE); }catch(e){} }, 800);
    }
  }catch(e){}
  try{
    SFX.music('menuMusic', false);
    const amb = (LEVEL_DATA && LEVEL_DATA.环境底噪) || {};
    if(amb.on !== false) SFX.music('ambience', true);
  }catch(e){}
  const it=document.getElementById('items'); if(it) it.style.display='block';
  try{
    const R2 = CFG.刷新 || {};
    const lo = (typeof R2.钥匙最少 === 'number') ? R2.钥匙最少 : ((typeof R2.钥匙数量 === 'number') ? R2.钥匙数量 : 3);
    const hi = (typeof R2.钥匙最多 === 'number') ? R2.钥匙最多 : lo;
    const n  = Math.max(1, Math.min(6, lo + Math.floor(Math.random()*(Math.max(lo,hi)-lo+1))));
    spawnKeys(AI.role === 'ghost' ? n : 1);
  }catch(e){}
  const hh=document.getElementById('hud'); if(hh) hh.style.display='';
  Sound.init();
  if(camp==='human'){ try{ aiGhostInit(); AI.ghostOn = true; }catch(e){ console.warn('aiGhostInit', e); } }
  if(camp==='ghost' && !GV.on) setTimeout(()=>{ if(!GV.on && STARTED && !PAUSED) toggleGhostView(); }, 80);
}
$id('btnStart').onclick = ()=>{
  try{ SFX.music('menuMusic', true); }catch(e){}      // 首次点击后才能出声
  playMenuIntro(()=>showView('pMode'));
};
$id('pickSingle').onclick = ()=> showView('pCamp');
$id('pickMulti').onclick  = ()=> toastTip('联机开发中，先玩单人模式');
// 新开一局：刷新出生点（位置不再沿用上一次退出时的位置）
function respawnPlayer(){
  const sp = pickSpawns();
  player.x = sp.player.x; player.z = sp.player.z; player.y = 0; player.vy = 0;
  player.yaw = Math.atan2(sp.ghost.x - sp.player.x, sp.ghost.z - sp.player.z);
  if(MAZE){
    // 面朝最开阔的方向，避免开局贴脸墙
    const freeAhead = function(a){
      for(let d=1; d<=7; d+=0.5){
        const x = player.x + Math.sin(a)*d, z = player.z + Math.cos(a)*d;
        for(const w of WALLS){
          if(x > w.x0-0.35 && x < w.x1+0.35 && z > w.z0-0.35 && z < w.z1+0.35) return d;
        }
      }
      return 7;
    };
    let best = player.yaw, bd = -1;
    for(let i=0;i<16;i++){
      const a = i*Math.PI/8;
      const d = freeAhead(a);
      if(d > bd){ bd = d; best = a; }
    }
    player.yaw = best;
  }
  player.pitch = -0.02;
  HIDE.on = false; HIDE.hidden = false; HIDE.cam = null; HIDE.room = null;
  HURT_LV = 0; DEAD = false; HURT = false;
  GHOST_WON = false;
  // AI 人类全部复位（新一局重新开始躲）
  for(const h of AI.humans){
    h.hp = 0; h.state='wander'; h.hideDoor=null; h.timer=rr(2,6);
    h.lane = (Math.random()<0.5?1:-1)*(0.35+Math.random()*0.5);
    h.homeLane = h.lane; h.hopY = 0;
    h.person.root.visible = (AI.role === 'ghost');
    h.person.root.rotation.x = 0;
    if(h.person.arms && h.person.arms[1]) h.person.arms[1].sh.visible = true;
    const p = atPath(h.d);
    h.person.root.position.set(p.x, 0, p.z);
    try{ snapEntityToWalkable(h.person.root); }catch(e){}
    h.target = (h.d + rr(8,18)) % RING_LEN;
  }
  stamina = 1; STAM_MAX = CFG.玩家.疾跑上限秒;
  GAI.lane = 0; GAI.homeLane = 0; GAI.hopY = 0; GAI.lostT = 0; GAI.lastSeen = null; GAI.stam = 1; GAI.slowT = 0; GAI.pendingSlow = 0; GAI.inkSlowT = 0; GV.inkSlowT = 0;
  ghost.position.set(sp.ghost.x, 0, sp.ghost.z);
  try{ if(!NAV.built) navBuild(); snapEntityToWalkable(ghost); GAI.path=null; GAI.repathT=0; }catch(e){}
  if(GV.on) toggleGhostView();     // 强制回到人类视角
}
$id('pickHuman').onclick = ()=>{
  AI.mode='single'; AI.role='human';
  showLoadingNow('预 加 载 资 源');
  afterPaint(function(){
    try{ respawnPlayer(); aiGhostInit(); }catch(e){}
    try{ AI.humans.forEach(h=>{ h.person.root.visible=false; }); }catch(e){}
    warmupOnce(function(){ startGame('human'); });
  });
};
$id('pickGhost').onclick = ()=>{
  AI.mode='single'; AI.role='ghost';
  showLoadingNow('预 加 载 资 源');            // 先出加载页
  afterPaint(function(){
    try{ respawnPlayer(); AI.ghostOn=false; }catch(e){}
    try{ if(!AI.humans.length) aiSpawnHumans(4); }catch(e){}   // 造 4 个 AI（重活，藏在加载页后面）
    warmupOnce(function(){ startGame('ghost'); });
  });
};

/* —— 画质档位：低/中/高，改渲染倍率和阴影精度 —— */
let QUALITY = 1;
function applyQuality(q){
  QUALITY = q;
  const dpr=[1.0,1.5,2.0][q], sh=[1024,1536,2048][q];
  DPR_CAP=dpr;
  renderer.setPixelRatio(Math.min(devicePixelRatio, dpr));
  renderer.setSize(innerWidth, innerHeight);
  flash.shadow.mapSize.set(sh,sh);
  flash.shadow.autoUpdate = true;
  if(flash.shadow.map){ flash.shadow.map.dispose(); flash.shadow.map=null; }
  localStorage.setItem('corridor_q', q);
  const sel=document.getElementById('qual'); if(sel) sel.value=String(q);
}
window.applyQuality = applyQuality;

/* —— 设置面板：灵敏度 / 音量（保存在本地，下次打开还记得） —— */
{
  const sensEl=document.getElementById('sens'), sensV=document.getElementById('sensV');
  const volEl=document.getElementById('vol'),  volV=document.getElementById('volV');
  sensEl.value = sens; sensV.textContent = Number(sens).toFixed(2);
  volEl.value  = localStorage.getItem('corridor_vol') || '60';
  volV.textContent = volEl.value;
  // 点滑块不要触发"进入游戏"
  const box=document.querySelector('.set');
  if(box) box.addEventListener('click', e=>e.stopPropagation());
  sensEl.addEventListener('input', ()=>{
    sens = parseFloat(sensEl.value);
    sensV.textContent = sens.toFixed(2);
    localStorage.setItem('corridor_sens', sens);
  });
  // 准心透明度（默认 25%）
  const xhEl=document.getElementById('xh'), xhV=document.getElementById('xhV');
  if(xhEl){
    xhEl.value = String(XH); if(xhV) xhV.textContent = String(XH);
    xhEl.addEventListener('input', ()=>{
      XH = parseInt(xhEl.value,10)||0;
      localStorage.setItem('corridor_xhair', String(XH));
      document.documentElement.style.setProperty('--xh', String(XH/100));
      if(xhV) xhV.textContent = String(XH);
    });
  }
  const gEl=document.getElementById('gpuLine');
  if(gEl){
    gEl.innerHTML = '显卡：<b>' + GPU_NAME.replace(/ANGLE \(|\)/g,'').slice(0,60) + '</b>' +
      (GPU_WEAK ? '<br><span class="warn">⚠ 现在用的是核显，帧数会很低。到 Windows「设置 → 系统 → 显示 → 图形」把浏览器设为「高性能」</span>' : '');
  }
  const qualEl=document.getElementById('qual');
  if(qualEl){
    qualEl.value = localStorage.getItem('corridor_q') || (GPU_WEAK ? '0' : '1');
    applyQuality(parseInt(qualEl.value,10));
    qualEl.addEventListener('change', ()=>applyQuality(parseInt(qualEl.value,10)));
  }
  volEl.addEventListener('input', ()=>{
    volV.textContent = volEl.value;
    Sound.setVol(parseInt(volEl.value,10)/100);
    localStorage.setItem('corridor_vol', volEl.value);
  });
}

let PAUSED = false;
window.addEventListener('mousedown', function(){
  if(!STARTED || DEAD || BAG) return;
  if(document.pointerLockElement === renderer.domElement) return;
  const uiEl = document.getElementById('ui');
  if(uiEl && !uiEl.classList.contains('hide')) return;   // 菜单开着就交给按钮
  const ov = document.getElementById('tapToPlay');
  if(ov && ov.classList.contains('on')) return;          // 点画面遮罩自己会处理
  relockPointer();
}, true);

document.addEventListener('pointerlockchange',()=>{
  const locked = document.pointerLockElement===renderer.domElement;
  ui.classList.toggle('hide', locked || BAG);
  PAUSED = !locked && STARTED && !BAG && !TAP_ACTIVE;   // 点击遮罩/背包期间不算暂停
  if(PAUSED){
    showView('pPause');       // 先给暂停页：继续 / 返回主菜单
    applyLang();
    if(HIDE.on || HIDE.hidden){                // 暂停时别卡在躲藏动画里
      HIDE.on=false; HIDE.hidden=false; HIDE.cam=null;
      BODY.root.visible=false;
      elBlack.style.opacity='0'; elSlit.style.opacity='0';
      elEdge.style.opacity='0'; elTip.style.opacity='0';
    }
  }
});
let lockAt = -1e9;
document.addEventListener('pointerlockchange', ()=>{ lockAt = performance.now(); });
addEventListener('mousemove',e=>{
  if(document.pointerLockElement!==renderer.domElement) return;
  if(HIDE.hidden && !GV.on){                    // 躲藏中：允许在门缝/栅栏窗范围里看
    player.yaw   -= mx*BASE_SENS*sens;
    player.pitch -= my*BASE_SENS*sens;
    const lim = 0.62;                            // 左右各约 35°
    const dy  = player.yaw - HIDE.baseYaw;
    player.yaw = HIDE.baseYaw + Math.max(-lim, Math.min(lim, dy));
    player.pitch = Math.max(-0.35, Math.min(0.45, player.pitch));
    return;
  }
  // ① 刚锁定鼠标的那一小会儿，浏览器会甩出一个巨大的位移 → 直接丢掉
  if(performance.now() - lockAt < 160) return;
  // ② 单次位移封顶：浏览器偶发几百像素的"抽搐"值，夹住就不会甩视角
  const mx = Math.max(-130, Math.min(130, e.movementX || 0));
  const my = Math.max(-130, Math.min(130, e.movementY || 0));
  if(!isFinite(mx) || !isFinite(my)) return;
  const tgt = GV.on ? GV : player;          // 鬼视角时改鬼的朝向
  tgt.yaw   -= mx*BASE_SENS*sens;
  tgt.pitch -= my*BASE_SENS*sens;
  tgt.pitch = Math.max(-1.15, Math.min(1.15, tgt.pitch));
});

let AMB_T = 2.0;
const clock=new THREE.Clock();
let fpsAcc=0, fpsN=0, qualityStep=0;
// 碰撞：把玩家关在轮廓内，再从每一段墙里推出去（2.0 是"房间+走廊"的格子地图）
const PL_R = 0.34;                       // 玩家半径
const OX = HX - PL_R, OZ = HZ - PL_R;    // 外墙能走到哪
function pushOutAABB(p, w){
  const ex0=w.x0-PL_R, ex1=w.x1+PL_R, ez0=w.z0-PL_R, ez1=w.z1+PL_R;
  if(p.x<=ex0 || p.x>=ex1 || p.z<=ez0 || p.z>=ez1) return false;
  const dl=p.x-ex0, dr=ex1-p.x, dn=p.z-ez0, df=ez1-p.z;
  const m=Math.min(dl,dr,dn,df);
  if(m===dl)      p.x=ex0;
  else if(m===dr) p.x=ex1;
  else if(m===dn) p.z=ez0;
  else            p.z=ez1;
  return true;
}

// 脚下这块地的"可站立高度"（家具顶面），没有家具就是 0

// 读 config 里的数值，缺了就回退到默认值（编辑器重新生成 config 也不会崩）
function cfgNum(section, key, dflt){
  try{
    const sec = CFG[section];
    if(sec && typeof sec[key] === 'number') return sec[key];
  }catch(e){}
  return dflt;
}

function groundAt(x, z, r){
  let g = 0;
  for(const w of WALLS){
    if(w.top == null) continue;
    if(x > w.x0 - r && x < w.x1 + r && z > w.z0 - r && z < w.z1 + r){
      if(w.top > g && w.top <= 1.20) g = w.top;
    }
  }
  return g;
}

function collide(p){
  p.x = Math.max(-OX, Math.min(OX, p.x));
  p.z = Math.max(-OZ, Math.min(OZ, p.z));
  // 迭代两次，保证挤在墙角时也能推干净
  for(let it=0; it<2; it++){
    let hit=false;
    for(const w of WALLS){
      if(w.top != null && (p.y||0) >= w.top - 0.04) continue;   // 脚够高就越过去 / 站着
      if(pushOutAABB(p,w)) hit=true;
    }
    if(!hit) break;
  }
  return p;
}


// 自适应画质：连续两次（约 2 秒）帧时超过 45ms 就降一档；最低档还卡就关手电阴影
let _ftAcc = 0, _ftN = 0, _ftLow = 0, _ftDone = false;

/* ============ 卡顿记录（按 F3 看）============
   每次卡超过 0.25 秒记一条，并记下当时的着色器/贴图/几何体数量。
   数量突然变多 = 现场编译/上传；数量不变 = 垃圾回收或算力不够。 */
const STALLS = [];
let _stallPrev = null;
function stallLog(ms){
  let info = null;
  try{
    info = {
      p: renderer.info.programs ? renderer.info.programs.length : -1,
      t: renderer.info.memory.textures,
      g: renderer.info.memory.geometries,
      c: Math.round(renderer.info.render.calls),
      tri: Math.round(renderer.info.render.triangles)
    };
  }catch(e){}
  STALLS.push({ at: +(performance.now()/1000).toFixed(1), ms: Math.round(ms*1000), info, prev: _stallPrev });
  if(STALLS.length > 12) STALLS.shift();
  _stallPrev = info;
}
function toggleStallPanel(){
  let el = document.getElementById('stallPanel');
  if(el){ el.style.display = el.style.display === 'none' ? 'block' : 'none'; return; }
  el = document.createElement('div');
  el.id = 'stallPanel';
  el.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99999;background:rgba(0,0,0,.86);color:#7CFFB2;' +
    'font:12px/1.5 Consolas,monospace;padding:10px 12px;border:1px solid #2c5;border-radius:8px;max-width:460px;white-space:pre-wrap';
  document.body.appendChild(el);
  el.textContent = '（暂无卡顿记录，玩一会儿再按 F3）';
}
function refreshStallPanel(){
  const el = document.getElementById('stallPanel');
  if(!el || el.style.display === 'none') return;
  if(!STALLS.length){ el.textContent = '（暂无卡顿记录）'; return; }
  el.textContent = STALLS.slice(-8).map(function(x, i){
    const a = x.info || {}, b = x.prev || {};
    const d = (k) => (b[k] === undefined ? '?' : (a[k] - b[k]));
    return (i+1) + '. ' + x.ms + 'ms  程序+' + d('p') + ' 贴图+' + d('t') + ' 几何+' + d('g') +
           '  绘制' + a.c + ' 面' + a.tri;
  }).join('\n');
}
window.toggleStallPanel = toggleStallPanel;

function perfGuard(rawDt){
  if(!STARTED || _ftDone) return;
  _ftAcc += rawDt; _ftN++;
  if(_ftAcc < 0.8) return;                    // 每 0.8 秒判断一次（低帧率也能很快反应）
  const ms = (_ftAcc/_ftN)*1000;
  _ftAcc = 0; _ftN = 0;

  if(ms > 120){                                // 严重卡顿：只记录，不再中途改画质（会重编译着色器，更卡）
    _ftDone = true;
    try{ toastTip('帧率偏低，已自动降到最低画质'); }catch(e){}
    return;
  }
  if(ms > 45) _ftLow++; else _ftLow = 0;
  if(_ftLow >= 2){ _ftLow = 0; _ftDone = true; }   // 同上：只标记，不中途动画质
}

let _shadowFlip = false;

// —— 通用走路动画：按实际位移推腿和手臂（AI 鬼 / 玩家鬼 / 人类身体 都用这套）——
const _walkPrev = new WeakMap();
// 让某个角色"盯着"目标点：取最短夹角平滑转过去
function faceTarget(obj, tx, tz, rate, dt){
  if(!obj) return;
  const want = Math.atan2(tx - obj.position.x, tz - obj.position.z);
  let d = want - obj.rotation.y;
  while(d >  Math.PI) d -= Math.PI*2;
  while(d < -Math.PI) d += Math.PI*2;
  obj.rotation.y += d * Math.min(1, (rate || 8) * dt);
}

function driveWalk(person, obj, dt){
  if(!person || !person.update || !obj || !(dt > 0)) return;
  const p = obj.position;
  let prev = _walkPrev.get(person);
  if(!prev){ _walkPrev.set(person, {x:p.x, z:p.z, phase:0}); return; }
  const dist = Math.hypot(p.x-prev.x, p.z-prev.z);
  const speed = dist / Math.max(dt, 1e-4);
  prev.phase += dt * (2.6 + speed*2.2);
  prev.x = p.x; prev.z = p.z;
  person.update(prev.phase, Math.min(2.4, speed/1.35), speed > 2.6);
}

function loop(){
  requestAnimationFrame(loop);
  const _rawDt = clock.getDelta();
  // 手电阴影隔一帧更新一次（画面几乎无差，但每帧少渲染一整套影子）
  try{
    _shadowFlip = !_shadowFlip;
    if(flash.shadow){ flash.shadow.autoUpdate = _shadowFlip; }
  }catch(e){}
  try{ if(STARTED && _rawDt > 0.25) stallLog(_rawDt); }catch(e){}
  let dt=Math.min(_rawDt,0.05);
  try{ perfGuard(_rawDt); }catch(e){}
  try{ if(GV.hitCd > 0) GV.hitCd = Math.max(0, GV.hitCd - dt); }catch(e){}
  try{ navTick(dt); }catch(e){}
  try{ updateGhostAura(dt, performance.now()*0.001); }catch(e){}
  // —— 状态兜底：躲藏动画如果被打断（切换/被砍/暂停），这里会把身体和手电复位 ——
  try{
    if(!HIDE.on && BODY.root.visible) BODY.root.visible = false;
    if(!HIDE.on && Math.abs(flash.position.z - 0.06) > 0.01){
      flash.position.set(0.16, -0.14, 0.06);
    }
  }catch(e){}
  try{ if((_stallTick=(_stallTick||0)+_rawDt) > 0.5){ _stallTick = 0; refreshStallPanel(); } }catch(e){}
  // 鼠标没锁住时给个提示（此时游戏照常跑，点一下画面就能锁回来）
  try{
    const _lh = document.getElementById('lockHint');
    if(_lh){
      const need = STARTED && !PAUSED && !DEAD && document.pointerLockElement !== renderer.domElement;
      _lh.style.display = need ? 'block' : 'none';
    }
  }catch(e){}
  if(PAUSED || !STARTED) dt=0;   // 只有暂停/菜单才冻结；鼠标锁没拿到也照常跑，避免卡成死局
  const t=clock.elapsedTime;

  // —— 移动 ——
  let fw=0, sd=0;
  if(keys.KeyW||keys.ArrowUp)   fw+=1;
  if(keys.KeyS||keys.ArrowDown) fw-=1;
  if(keys.KeyA||keys.ArrowLeft) sd-=1;
  if(keys.KeyD||keys.ArrowRight)sd+=1;
  if((HIDE.on || HIDE.hidden) && !GV.on){ fw=0; sd=0; } // 只锁人类
  if(BAG){ fw=0; sd=0; }                               // 看背包时站住不动，但世界继续

  // —— 鬼视角：鬼自己走，人类不动 ——
  if(GV.on && dt>0 && !CHECK.on && !ATK.on){
    const glen = Math.hypot(fw,sd);
    if(glen > 0){
      const nf=fw/glen, ns=sd/glen;
      // —— 鬼的体力：3 秒冲刺，耗尽后 0.5 秒缓慢减速（像跑完喘气），1 秒回满 ——
      const _humanSprint = (CFG.玩家 && CFG.玩家.疾跑速度) ? CFG.玩家.疾跑速度 : 5.05;
      const G_WALK = cfgNum('鬼AI','走路速度',1.80);
      const G_SPRINT = Math.min(CFG.鬼.速度*cfgNum('鬼AI','冲刺倍率',1.5), _humanSprint - 0.8);   // 永远追不上人类疾跑
      if(GV.exhaustT === undefined) GV.exhaustT = 0;
      if(GV.stam === undefined) GV.stam = 1;
      let gspeed;
      if(GV.exhaustT > 0){
        GV.exhaustT = Math.max(0, GV.exhaustT - dt);
        const k = GV.exhaustT / cfgNum('鬼AI','力竭减速秒',0.5);   // 1 → 0，慢慢从冲刺降到走路
        gspeed = G_WALK + (G_SPRINT - G_WALK) * k;
        GV.stam = Math.min(1, GV.stam + dt);      // 喘气时也在回体力
      } else if(sprintHeld && GV.stam > 0.02 && !GV.gassed){
        gspeed = G_SPRINT;
        GV.stam = Math.max(0, GV.stam - dt/cfgNum('鬼AI','冲刺秒',3));    // 3 秒耗尽
        if(GV.stam <= 0.02){ GV.exhaustT = cfgNum('鬼AI','力竭减速秒',1.2); GV.gassed = true; } // 力竭减速
      } else {
        gspeed = G_WALK;
        GV.stam = Math.min(1, GV.stam + dt/cfgNum('鬼AI','体力恢复秒',6));  // 恢复要 6 秒，比冲刺长一倍
      }
      // 力竭后必须松开 Shift 才能再次冲刺（像人喘完气才跑得动）
      if(GV.gassed && !sprintHeld) GV.gassed = false;
      GV.speedNow = gspeed;
      // 龟速惩罚：砍完人 5 秒内不能冲刺
      if(GV.inkSlowT > 0){
        gspeed = cfgNum('鬼AI','墨水减速速度',0.40);      // 墨水：蹲速的一半
        GV.inkSlowT = Math.max(0, GV.inkSlowT - dt);
      } else if(GV.slowT > 0){ gspeed = cfgNum('鬼AI','砍人后速度',0.80); GV.slowT = Math.max(0, GV.slowT - dt); GV.stam = Math.min(1, GV.stam + dt); }
      const gspd = gspeed*dt;
      const gsin=Math.sin(GV.yaw), gcos=Math.cos(GV.yaw);
      GV.x += (nf*-gsin + ns*gcos)*gspd;
      GV.z += (nf*-gcos + ns*-gsin)*gspd;
      const gp={x:GV.x, z:GV.z, y:GV.y}; collide(gp); GV.x=gp.x; GV.z=gp.z;
      GV.walk = (GV.walk||0) + dt*7;
    }
    // 鬼跳跃：和人类同一套物理（能站到家具上、也能跳过去）
    if(GV.grounded && keys.Space){ GV.vy = JUMP_V*1.05; GV.grounded=false; }
    const ggy = groundAt(GV.x, GV.z, 0.30);
    if(GV.grounded && GV.y > ggy + 0.02) GV.grounded = false;
    if(!GV.grounded){
      GV.vy -= GRAV*dt;
      GV.y  += GV.vy*dt;
      if(GV.y <= ggy){ GV.y = ggy; GV.vy = 0; GV.grounded = true; }
    } else {
      GV.y = ggy; GV.vy = 0;
    }
    fw=0; sd=0;
  }
  const moving=(fw||sd);
  // 力竭锁：体力见底后，要回到 28% 才允许再次冲刺（防止一直按着一顿一顿）
  if(stamina<=0.001) exhausted=true;
  if(exhausted && stamina>0.28) exhausted=false;
  const running = sprintHeld && moving && !exhausted && stamina>0 && !crouchHeld;
  if(moving){
    const len=Math.hypot(fw,sd); fw/=len; sd/=len;
    const runSpd = HURT ? RUN_SPD*2 : RUN_SPD;
    const crawl = (HURT_LV>=2);
    const spd=(crawl ? WALK_SPD*0.25 : (crouchHeld ? WALK_SPD*0.5 : (running?runSpd:WALK_SPD)))*dt;
    const sin=Math.sin(player.yaw), cos=Math.cos(player.yaw);
    player.x += (fw*-sin + sd*cos)*spd;
    player.z += (fw*-cos + sd*-sin)*spd;
    player.bob += dt*(running?13.5:8.5);
  }else{
    player.bob += dt*1.6;
  }

  // —— 体力：冲刺 8 秒见底，停下约 1 秒后开始回复（满血约 12 秒）——
  if(running && HURT_LV<2){ stamina=Math.max(0, stamina-dt/STAM_MAX); idleTime=0; }
  else       { idleTime+=dt; if(idleTime>STAM_DELAY) stamina=Math.min(1, stamina+dt/STAM_REGEN); }
  // 3.0：鬼也有体力上限（3 秒冲刺），不再无限
  // —— 跳跃：重力 + 落地 ——
  // 重力：地面或家具顶面
  const gy = groundAt(player.x, player.z, 0.22);
  if(player.grounded && player.y > gy + 0.02) player.grounded = false;   // 走出边缘 → 掉下去
  if(!player.grounded || player.y > gy + 0.02){
    player.vy -= GRAV*dt;
    player.y  += player.vy*dt;
    if(player.y <= gy){
      player.y = gy; player.vy = 0;
      if(!player.grounded){ player.grounded = true; Sound.land(); }
    }
  } else {
    player.y = gy; player.vy = 0;
  }

  if(HIDE.hidden && HIDE.room){
    const b=HIDE.room, m=0.16;
    const x0=Math.min(b.x0,b.x1), x1=Math.max(b.x0,b.x1);
    const z0=Math.min(b.z0,b.z1), z1=Math.max(b.z0,b.z1);
    player.x=Math.min(Math.max(player.x,x0+m),x1-m);
    player.z=Math.min(Math.max(player.z,z0+m),z1-m);
  } else {
    collide(player);
  }

  // （出口暂不触发胜利，等玩法确定）


  updateHide(dt);
  updateAI(dt);
  updateHideUI();
  updateRoomDoors(dt);
  updateGlass(dt);
  updateCabinets(dt);
  updateProjectiles(dt);
  updateBlind(dt);
  // 吊死鬼模型已删除，这里不再需要更新
  // —— 准心 / 交互提示 ——
  elXh.style.opacity = STARTED ? '1' : '0';
  if(tipT>0){
    tipT-=dt;
    if(tipT<=0) elAimTip.style.opacity='0';
  } else if(STARTED && !HIDE.on && !HIDE.hidden){
    const gd = nearestGlass();
    if(gd){
      elAimTip.textContent = gd.open ? 'E  关门' : 'E  开门';
      elAimTip.style.opacity='1';
      elXh.classList.add('hot');
    } else {
    const aim=aimTarget();
    if(aim && aim.kind==='item'){
      elAimTip.textContent = 'E  拾取 ' + (aim.ref.kind==='ink' ? '墨水炸弹' : '皮鞋');
      elAimTip.style.opacity='1';
      elXh.classList.add('hot');
    } else if(aim){
      elAimTip.textContent = aim.kind==='cabinet'
        ? (GV.on ? (aim.ref.open ? 'E  关上柜子' : 'E  检查柜子')
                 : (aim.ref.open ? 'E  关上柜子' : 'E  打开柜子'))
        : ('E  拾取 '+(aim.ref.kind==='ink' ? '墨水' : '皮鞋'));
      elAimTip.style.opacity='1';
      elXh.classList.add('hot');
    } else { elAimTip.style.opacity='0'; elXh.classList.remove('hot'); }
    }
  }

  const bobY = moving ? Math.sin(player.bob)*0.022 : Math.sin(player.bob)*0.006;
  const eyeTarget = (HURT_LV>=2) ? 0.42 : (crouchHeld ? 1.12 : 1.62);   // 断腿：趴在地上看
  EYE_H += (eyeTarget - EYE_H) * Math.min(1, dt*9);
  // 走路动画：鬼（AI 或玩家）和人类身体都按实际速度迈腿
  try{
    const gp = ghost.userData && ghost.userData.person;
    if(gp) driveWalk(gp, ghost, dt);
    if(typeof BODY !== 'undefined' && BODY.root && BODY.root.visible) driveWalk(BODY, BODY.root, dt);
  }catch(e){}

  camera.position.set(player.x, EYE_H+bobY+player.y, player.z);
  camera.rotation.y=player.yaw;
  camera.rotation.x=player.pitch + (moving?Math.sin(player.bob*0.5)*0.004:0);

  // —— 鬼左键挥刀（0.55 秒）——
  if(ATK.on){
    ATK.t += dt;
    const gb = ghost.userData && ghost.userData.body && ghost.userData.body.root;
    const dur = ATK.dur || 0.55;
    const u = Math.min(1, ATK.t/dur);
    let swing = 0, bladeX = 0.35;

    // 0~1.1 秒：劈砍；之后：站在原地擦刀
    if(u < 0.26)      swing = -1.5*(u/0.26);
    else if(u < 0.40) swing = -1.5 + 3.2*((u-0.26)/0.14);
    else              swing = 1.7*(1-Math.min(1,(u-0.40)/0.16));
    const wipeW = Math.max(0, (ATK.t - 1.2) / (dur - 1.2));
    if(wipeW > 0){
      const sway = Math.sin(ATK.t*7.5);
      swing = -1.05 + sway*0.09;
      bladeX = 1.35 + sway*0.16;
    } else {
      bladeX = 0.35 + swing*0.75;
    }

    if(gb && gb.userData.arms){
      for(const a of gb.userData.arms) a.grp.rotation.x = a.base + (a.side>0 ? swing : swing*0.35);
      if(gb.userData.blade) gb.userData.blade.rotation.x = bladeX;
    }
    if(ATK.t >= dur){ ATK.on=false; ATK.miss=false; }
  }

  // —— 角色可见性：每帧统一决定，绝不留残影 ——
  if(ghost.userData && ghost.userData.body)
    ghost.userData.body.root.visible = !GV.on || CHECK.on || ATK.on;   // 检查/擦刀时能看见鬼自己
  BODY.root.visible = HIDE.on;   // 玩鬼时不再显示"玩家自己的身体"（那是 P 键切换时代留下的）
  // 鬼检查到人所在的那扇门时，人是可见的；其余时间躲着不可见

  if(GV.on){
    camera.position.set(GV.x, 1.78 + GV.y + Math.sin((GV.walk||0))*0.016, GV.z);
    camera.rotation.y = GV.yaw;
    camera.rotation.x = GV.pitch;
    ghost.position.set(GV.x, GV.y, GV.z);
    ghost.rotation.y = GV.yaw + Math.PI;
    // 玩家本体跟着玩家的真实位置（鬼才看得到人）
    BODY.root.position.set(player.x, HURT_LV>=2 ? 0.22 : 0, player.z);
    BODY.root.rotation.order = 'YXZ';
    BODY.root.rotation.y = player.yaw + Math.PI;
    BODY.root.rotation.x = (HURT_LV>=2) ? -1.30 : 0;   // 断腿：整个人趴/爬在地上
  }

  // —— 挥空擦刀：第三人称拉远 + 晃动，3 秒后回第一人称 ——
  if(ATK.on && GV.on){
    const dur = ATK.dur, tt = ATK.t;
    const inK  = Math.min(1, tt/0.30);
    const outK = Math.max(0, Math.min(1, (tt-(dur-0.45))/0.45));
    const blend = inK * (1-outK);
    const bx = -Math.sin(GV.yaw), bz = -Math.cos(GV.yaw);
    const rx = bz, rz = -bx;
    const tx = GV.x - bx*2.15 + rx*0.75;
    const tz = GV.z - bz*2.15 + rz*0.75;
    const fx0 = camera.position.x, fy0 = camera.position.y, fz0 = camera.position.z;
    camera.position.set(
      fx0 + (tx - fx0)*blend,
      fy0 + (1.72 - fy0)*blend,
      fz0 + (tz - fz0)*blend
    );
    camera.lookAt(GV.x, 1.10, GV.z);
    camera.rotation.z += Math.sin(tt*9.0)*0.020*blend;
    camera.rotation.y += Math.sin(tt*3.6)*0.028*blend;
  }


  if(CHECK.on){
    if(!GV.on){                                  // 切回人类：取消检查，把门还原
      if(CHECK.opened && !CHECK.closed){
        if(CHECK.kind === 'door') CHECK.ref.target = 0;
        else if(CHECK.kind === 'roomdoor') setRoomDoor(CHECK.ref, false);
        else CHECK.ref.open = false;
        CHECK.closed = true;
      }
      CHECK.on = false;
      // 已经被砍中的人：切走也要被拽出来，不能又缩回柜子里
      if(CHECK.victim && CHECK.hit) forceOutOfHide();
    }
    else {
      const T = CHECK.t;
      CHECK.t += dt;
      const k = Math.min(1, CHECK.t / CHECK.dur);

      // —— ① 转身（0 ~ 0.22s）——
      GV.yaw = CHECK.yaw0 + (CHECK.yaw1 - CHECK.yaw0) * Math.min(1, CHECK.t / 0.22);

      // —— ② 开门（0.25s）——
      if(!CHECK.opened && CHECK.t >= 0.25){
        CHECK.opened = true;
        if(CHECK.kind === 'door') CHECK.ref.target = -1.55;
        else if(CHECK.kind === 'roomdoor') setRoomDoor(CHECK.ref, true);
        else CHECK.ref.open = true;
        (Sound.doorOpen || Sound.creak).call(Sound);
      }

      // —— ③ 挥刀砍中（0.55s）——
      if(CHECK.victim && !CHECK.hit && CHECK.t >= 0.55){
        CHECK.hit = true;
        if(CHECK.npc){
          // 砍到 AI 人类：掉一条胳膊 → 强制出门 → 掉头就跑
          aiHurtHuman(CHECK.npc);
        } else {
          hitPlayer();                            // 砍到真人玩家
        }
        Sound.heart();
      }

      // —— ④ 原地擦刀 1.2 秒（1.05 ~ 2.20s），人还锁在柜子里 ——
      //      擦完再把人拽出来，这样有"被按住"的压迫感

      // —— ⑤ 把人拖出来（2.20s）——
      if(CHECK.victim && !CHECK.out && CHECK.t >= 2.20){
        CHECK.out = true;
        if(CHECK.npc){
          CHECK.npc.state = 'flee';
          CHECK.npc.hideDoor = null;
          CHECK.npc.person.root.visible = true;
          CHECK.npc.timer = 4.5;
          const pp = ghost.position;
          CHECK.npc.target = (pathD(pp.x, pp.z) + 26) % RING_LEN;   // 朝远处跑
        } else {
          forceOutOfHide();                       // 人落到走廊，立刻能跑
        }
      }

      // —— ⑥ 关门（2.32s）——
      if(!CHECK.closed && CHECK.t >= 2.32){
        CHECK.closed = true;
        if(CHECK.kind === 'door') CHECK.ref.target = 0;
        else if(CHECK.kind === 'roomdoor') setRoomDoor(CHECK.ref, false);
        else CHECK.ref.open = false;
        (Sound.doorClose || Sound.creak).call(Sound);
      }

      // —— ⑦ 结束（2.90s）——
      if(CHECK.t >= CHECK.dur) CHECK.on = false;

      // ===== 第三人称机位（放在第一人称之后，才不会被覆盖）=====
      const fwdX = -Math.sin(GV.yaw), fwdZ = -Math.cos(GV.yaw);
      const rgtX =  fwdZ,              rgtZ = -fwdX;
      const inK  = Math.min(1, CHECK.t / 0.26);              // 拉远
      const outK = Math.max(0, Math.min(1, (CHECK.t - 2.45) / 0.42)); // 收回
      const blend = inK * (1 - outK);
      const back = 2.35, side = 0.80, camH = 1.82;
      const tx = GV.x - fwdX*back + rgtX*side;
      const tz = GV.z - fwdZ*back + rgtZ*side;
      const fpX = camera.position.x, fpY = camera.position.y, fpZ = camera.position.z;
      camera.position.set(
        fpX + (tx - fpX)*blend,
        fpY + (camH - fpY)*blend,
        fpZ + (tz - fpZ)*blend
      );
      const look = new THREE.Vector3(CHECK.tx, 1.24, CHECK.tz);
      const q = new THREE.Quaternion();
      camera.lookAt(look);
      // 左右摇摆 + 轻微呼吸
      camera.rotation.z += Math.sin(CHECK.t*7.5) * 0.012 * blend;
      camera.rotation.y += Math.sin(CHECK.t*3.1) * 0.020 * blend;

      // ===== 鬼的挥刀动作 =====
      const gb = ghost.userData && ghost.userData.body && ghost.userData.body.root;
      if(gb && gb.userData.arms){
        let swing = 0, wipe = 0;

        if(CHECK.t < 1.05){
          // 抬刀 → 猛劈 → 收回
          const u = Math.min(1, Math.max(0, (CHECK.t - 0.42) / 0.66));
          if(u > 0){
            if(u < 0.35)      swing = -1.5 * (u/0.35);
            else if(u < 0.55) swing = -1.5 + 3.2*((u-0.35)/0.20);
            else              swing = 1.7 * (1 - Math.min(1,(u-0.55)/0.45));
          }
        } else {
          // 原地擦刀：把刀横在身前，手臂小幅来回蹭 1.15 秒
          const w = Math.min(1, (CHECK.t - 1.05) / 1.15);
          const sway = Math.sin((CHECK.t - 1.05) * 8.0);
          swing = -1.10 + sway * 0.09;               // 手臂抬到胸前
          wipe  = 0.75 + sway * 0.28;                // 刀面横向来回蹭
          if(w > 0.88) swing += (w - 0.88) * 2.4;    // 收尾放低
        }

        for(const a of gb.userData.arms){
          a.grp.rotation.x = a.base + (a.side>0 ? swing : swing*0.35);
        }
        if(gb.userData.blade){
          const inWipe = CHECK.t >= 1.05 && CHECK.t < 2.20;
          gb.userData.blade.rotation.x = inWipe ? (1.35 + Math.sin(CHECK.t*8)*0.12)
                                                : (0.35 + swing*0.75);
          gb.userData.blade.rotation.z = inWipe ? wipe : 0;   // 擦刀时刀面横向蹭动
        }
      }
    }
  }


  // —— 菜单/暂停都用「菜单机位」（背光走廊 + 右手边吊着的人）——
  if(!STARTED || PAUSED){
    camera.position.set(MENU_CAM.x, 1.60, MENU_CAM.z);
    camera.rotation.y = MENU_CAM.yaw;
    camera.rotation.x = MENU_CAM.pitch;
  }

  // —— 鬼视角：镜头摆好之后再把坐标换回去（并让鬼的身体跟着走）——
  // —— 躲藏动画接管镜头（必须在相机赋值之后）——
  if(HIDE.cam){
    camera.position.copy(HIDE.cam.pos);
    if(HIDE.on && HIDE.mode==='in' && HIDE.t<0.55){
      camera.position.x += Math.sin(HIDE.t*31)*0.018;   // 镜头摇晃
      camera.position.y += Math.sin(HIDE.t*24+1.3)*0.014;
    }
    camera.lookAt(HIDE.cam.look);
    camera.rotation.z += Math.sin(HIDE.t*9)*0.006;
  }

  drawRadar();

  // —— 手电状态指示 ——
  if(flashTipT>0) flashTipT -= dt;
  elFlash.textContent = (LANG_CODE==='en' ? 'FLASHLIGHT · '+(flashOn?'ON':'OFF')
                                          : '手电 · '+(flashOn?'开':'关'));
  // 3 秒：0.4 秒淡入 → 2.2 秒常亮 → 0.4 秒淡出 → 完全消失
  if(flashTipT > 0){
    const k = Math.min(1, Math.min((3.0-flashTipT)/0.4, flashTipT/0.4));
    elFlash.style.opacity = String(Math.max(0, Math.min(1, k)));
  } else {
    elFlash.style.opacity = '0';
  }

  // —— 背景音：电流滋滋 + 下水道滴水（随机间隔）——
  AMB_T -= dt;
  if(AMB_T <= 0){
    AMB_T = rr(4.0, 8.5);
    if(R() < .52) Sound.crackle(); else Sound.drip();
  }

  // —— 灯管闪烁 ——
  for(const pl of lightPts){
    if(R()<0.035) pl.userData.drop = rr(.06,.35);
    if(pl.userData.drop>0){
      pl.userData.drop-=dt*2.2;
      pl.intensity = pl.userData.drop>0 ? pl.userData.base*pl.userData.drop : pl.userData.base;
    }else{
      pl.intensity = pl.userData.base*(0.9+Math.sin(t*7+pl.position.z)*0.05);
    }
    if(HIDE.on) pl.intensity *= 0.10;      // 躲藏动画期间几乎关掉顶灯
    else if(HIDE.hidden) pl.intensity *= 0.55;   // 躲藏中：能看清，但更阴
  }
  // 手电筒轻微呼吸
  flash.intensity = flashOn ? FLASH_I + Math.sin(t*2.1)*12 : 0;
  if(!STARTED) flash.intensity *= 0.34;          // 菜单：手电压暗，吊死鬼才是一团黑影

  // —— 远处人影 ——
  figureCool-=dt;
  if(figureTimer>0){
    figureTimer-=dt;
    figure.visible=true;
    // 玩家走近就消失
    const d=Math.hypot(figure.position.x-player.x, figure.position.z-player.z);
    if(d<9) figureTimer=0;
    if(figureTimer<=0){ figure.visible=false; figureCool=rr(18,42); }
  }else if(figureCool<=0){
    // 放在"环上往前走 12~26 米"的位置（可能在转角后面，正合适）
    const p=atPath(pathD(player.x,player.z) + rr(12,26));
    figure.position.set(p.x, 0, p.z);
    figure.rotation.y = Math.atan2(player.x-p.x, player.z-p.z)+Math.PI;
    figureTimer=rr(1.6,4.2);
  }

  // —— 演示用行人：沿着环走（联机时换成真实玩家位置）——
  for(const w of walkers){
    if(w.speed<=0){                                   // 待定模型：原地站着
      w.obj.root.position.set(atPath(w.d).x, 0, atPath(w.d).z);
      continue;
    }
    w.d += w.speed*dt;
    const wp = atPath(w.d);
    w.obj.root.position.set(wp.x, 0, wp.z);
    const want = Math.atan2(wp.dx, wp.dz);
    let df = want - w.obj.root.rotation.y;
    while(df> Math.PI) df-=Math.PI*2;
    while(df<-Math.PI) df+=Math.PI*2;
    w.obj.root.rotation.y += df*Math.min(1, dt*5);
    w.phase += dt*(2.2 + w.speed*1.35);
    w.obj.update(w.phase, w.speed, false);
  }

  // —— 尘埃缓慢飘 ——
  const dust=scene.getObjectByName('dust');
  if(dust){ dust.rotation.y = t*0.012; dust.position.z = ((t*0.10)%CELL)*-1; }

  // —— 声音：脚步 / 呼吸 / 心跳 / 远处异响 ——
  if(moving){
    stepAcc += dt*(running?1:0.62);
    if(stepAcc >= (GV.on ? 0.46 : 0.42)){
      stepAcc=0;
      if(!crouchHeld){
        if(GV.on) Sound.ghostStep(sprintHeld);   // 鬼：更沉、带回声的脚步
        else      Sound.step(running);
      }
    }
  }
  breathAcc += dt;
  // 喘息：只跟体力判定，连续播放 + 渐入渐出（不再一下一下地响）
  try{ Breath.update(stamina, !PAUSED && !GV.on && !DEAD); }catch(e){}
  try{ Heart.update(dt, Math.hypot(player.x-ghost.position.x, player.z-ghost.position.z), !PAUSED && !GV.on && !DEAD); }catch(e){}
  try{ Drip.update(dt, !PAUSED); }catch(e){}
  if(stamina < 0.28){
    heartAcc += dt;
    if(heartAcc > 0.88){ heartAcc=0; Sound.heart(); }
  }
  eventAcc += dt;
  // 随机事件已关闭（只留电流滋滋 + 水滴，其余交给环境音调度）

  // 拾取提示淡出
  if(_toastT > 0){ _toastT -= dt; if(_toastT <= 0) elToast.style.opacity = '0'; }

  // —— 体力条 + 缺氧感 ——
  const _cur = GV.on ? (GV.stam===undefined?1:GV.stam) : stamina;
  const pct=Math.round(_cur*100);
  if(pct!==lastStamPct){
    stamFill.style.width=pct+'%';
    stamFill.classList.toggle('low', _cur<0.28);
    stamEl.classList.toggle('on', GV.on ? (_cur<0.995 || sprintHeld) : (sprintHeld||stamina<0.995));
    lastStamPct=pct;
  }
  // 鬼的体力只有鬼自己看得到：人类视角把这条藏起来
  if(stamAIEl) stamAIEl.classList.remove('on');
  ovUni.uStress.value = stamina<0.3 ? (0.3-stamina)/0.3 : 0;

  // —— 自适应画质：实测不够流畅就自动往下调 ——
  fpsAcc+=dt; fpsN++;
  if(fpsAcc>=1.0){
    const fps=fpsN/fpsAcc; fpsAcc=0; fpsN=0;
    fpsEl.textContent=fps.toFixed(0)+' fps';
    if(fps<52 && qualityStep<5){
      qualityStep++;
      if(qualityStep===1){
        DPR_CAP=Math.min(DPR_CAP,1.25);
      }else if(qualityStep===2){
        DPR_CAP=Math.min(DPR_CAP,1.0);
      }else if(qualityStep===3){                    // 阴影降到 512
        flash.shadow.mapSize.set(512,512);
        if(flash.shadow.map){ flash.shadow.map.dispose(); flash.shadow.map=null; }
      }else if(qualityStep===4){                    // 关阴影
        renderer.shadowMap.enabled=false; flash.castShadow=false;
        scene.traverse(o=>{
          const ms=o.material&&(Array.isArray(o.material)?o.material:[o.material]);
          if(ms) ms.forEach(mm=>{mm.needsUpdate=true;});
        });
      }else{                                        // 最后：关掉一半的点光源（每个光源都要算一遍像素）
        for(let i=0;i<lightPts.length;i++) if(i%2===1) lightPts[i].visible=false;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio,DPR_CAP));
      renderer.setSize(innerWidth,innerHeight);
    }
  }

  ovUni.uTime.value=t;
  renderer.render(scene,camera);
  renderer.autoClear=false;
  renderer.render(ovScene,ovCam);
  renderer.autoClear=true;
}

/* ================= 3.0 单人 AI ================= */
const AI = { ghostOn:false, humans:[], mode:'single', role:'human' };

/* ---------- 鬼 AI：巡逻 → 看见人追 → 抓到砍一刀 → 擦刀 ---------- */
const GAI = { state:'patrol', d:0, target:0, t:0, wipe:0, door:null, doorT:0, hits:0 };

function aiShortest(a, b){
  let diff = b - a;
  if(diff >  RING_LEN/2) diff -= RING_LEN;
  if(diff < -RING_LEN/2) diff += RING_LEN;
  return diff;
}
function aiGhostInit(){
  // 迷宫模式：把鬼放到真正站得住的地方（避免生成在柜子/墙缝里被卡死）
  if(MAZE){
    // 鬼也放在同一片连通区里，且离玩家至少 14 米
    const gp = mazePickInRegion(14, player.x, player.z) || mazePickInRegion();
    if(gp){
      const q = {x:gp.x, y:0, z:gp.z};
      try{ collide(q); }catch(e){}
      ghost.position.set(q.x, 0, q.z);
    }
  }
  GAI.state='patrol'; GAI.t=0; GAI.wipe=0; GAI.door=null; GAI.doorT=0;
  GAI.d = pathD(ghost.position.x, ghost.position.z);
  GAI.target = (GAI.d + 18) % RING_LEN;
  AI.ghostOn = true;
}

/* ---------- AI 走路：会被家具挡住，绕着走或跳过去 ---------- */
function wallAt(x, z, r){
  for(const w of WALLS){
    if(x > w.x0 - r && x < w.x1 + r && z > w.z0 - r && z < w.z1 + r) return w;
  }
  return null;
}
// 沿环形路走一步：自动绕开柜子/架子，矮的（轮椅/推床）直接跳过去
function aiStepPath(ent, speed, dt){
  if(ent.lane === undefined) ent.lane = 0;
  if(ent.homeLane === undefined) ent.homeLane = ent.lane;
  const diff = aiShortest(ent.d, ent.target);
  const step = Math.sign(diff) * Math.min(Math.abs(diff), speed*dt);
  if(Math.abs(step) < 1e-4) return {moved:0, speed:0};

  const nd = (ent.d + step + RING_LEN) % RING_LEN;
  const p = atPath(nd);
  let lane = ent.lane;
  let px = p.x + p.nx*lane, pz = p.z + p.nz*lane;
  let hop = 0;

  const hit = wallAt(px, pz, 0.36);
  if(hit){
    if(hit.top != null && hit.top <= 0.72){
      hop = hit.top + 0.08;                    // 矮家具：跳过去
    }else{
      let ok = false;
      for(const sgn of [1,-1,2,-2]){
        const l2 = lane + sgn*0.55;
        if(Math.abs(l2) > 1.10) continue;
        const qx = p.x + p.nx*l2, qz = p.z + p.nz*l2;
        if(!wallAt(qx, qz, 0.36)){ lane = l2; px = qx; pz = qz; ok = true; break; }
      }
      if(!ok) return {moved:0, speed:0};       // 两边都堵死：这一帧原地待着
    }
  }else if(Math.abs(lane - ent.homeLane) > 0.04){
    // 没人挡了：慢慢回到自己习惯的那条线
    const k = Math.min(Math.abs(ent.homeLane - lane), 0.8*dt);
    lane += Math.sign(ent.homeLane - lane) * k;
    px = p.x + p.nx*lane; pz = p.z + p.nz*lane;
    if(wallAt(px, pz, 0.36)){ lane -= Math.sign(ent.homeLane - lane) * k; px = p.x + p.nx*lane; pz = p.z + p.nz*lane; }
  }

  ent.lane = lane;
  // 跳跃高度缓动（跳过去那一下会离地）
  if(hop > 0) ent.hopY = Math.max(ent.hopY||0, hop);
  else if(ent.hopY > 0) ent.hopY = Math.max(0, ent.hopY - 2.6*dt);

  ent.d = nd;
  ent.px = px; ent.pz = pz;
  ent.walkSpeed = speed;
  return {moved:step, speed:speed, x:px, z:pz, y:ent.hopY||0};
}


/* 鬼直接朝目标点走（会撞墙、撞家具，自动贴墙滑行；卡住就退回沿路绕行） */
function aiGhostSeek(tx, tz, speed, dt){
  const dx = tx - ghost.position.x, dz = tz - ghost.position.z;
  const dist = Math.hypot(dx, dz) || 1e-4;
  const ux = dx/dist, uz = dz/dist;
  const p = {x: ghost.position.x + ux*speed*dt, z: ghost.position.z + uz*speed*dt, y: ghost.position.y||0};
  collide(p);
  const moved = Math.hypot(p.x-ghost.position.x, p.z-ghost.position.z);
  ghost.position.set(p.x, p.y||0, p.z);
  ghost.rotation.y = Math.atan2(ux, uz);
  GAI.d = pathD(p.x, p.z);
  GAI.walkSpeed = speed;
  if(moved < speed*dt*0.30){
    GAI.stuckT = (GAI.stuckT||0) + dt;
    if(GAI.stuckT > 0.7){ GAI.stuckT = 0; aiGhostStep(dt, speed); }   // 贴墙绕不出去 → 沿走廊绕
  } else {
    GAI.stuckT = 0;
  }
}


/* ================= 网格寻路（NAV） =================
   0.45 米一格，从 WALLS 生成可走网格；A* 用于追人/回家，
   随机漫游用于"瞎走"，撞墙自动换方向。 */
const NAV = { cell: 0.45, x0: 0, z0: 0, nx: 0, nz: 0, g: null, built: false };

function navBuild(){
  // 网格范围按"真实墙体的包围盒"算，不用 config 的数字（否则会走出地图外）
  let minX=1e9, maxX=-1e9, minZ=1e9, maxZ=-1e9;
  for(const w of WALLS){
    if(w.top != null) continue;                 // 只看墙，不看矮家具
    if(w.x0 < minX) minX = w.x0;
    if(w.x1 > maxX) maxX = w.x1;
    if(w.z0 < minZ) minZ = w.z0;
    if(w.z1 > maxZ) maxZ = w.z1;
  }
  if(minX > maxX){ minX=-24; maxX=24; minZ=-19; maxZ=19; }
  const pad = 0.6;
  NAV.x0 = minX - pad; NAV.z0 = minZ - pad;
  NAV.bx0 = minX; NAV.bx1 = maxX; NAV.bz0 = minZ; NAV.bz1 = maxZ;
  NAV.nx = Math.ceil((maxX-minX+pad*2)/NAV.cell);
  NAV.nz = Math.ceil((maxZ-minZ+pad*2)/NAV.cell);
  const N = NAV.nx*NAV.nz;
  const g = new Uint8Array(N);
  const R = 0.34;                       // 人半径
  // 门的碰撞盒要排除掉：门是可以打开的，寻路必须能规划"穿过门"的路线，
  // 否则房间会被判定成不可达，鬼就只会朝玩家直线撞墙
  const DOOR_COL = new Set();
  try{ for(const d of ROOM_DOORS) if(d && d.col) DOOR_COL.add(d.col); }catch(e){}
  for(let iz=0; iz<NAV.nz; iz++){
    for(let ix=0; ix<NAV.nx; ix++){
      const x = NAV.x0 + (ix+0.5)*NAV.cell;
      const z = NAV.z0 + (iz+0.5)*NAV.cell;
      let blocked = (x < NAV.bx0-0.05 || x > NAV.bx1+0.05 || z < NAV.bz0-0.05 || z > NAV.bz1+0.05);
      if(!blocked){
        for(const w of WALLS){
          if(w.top != null && w.top <= 0.75) continue;    // 矮家具可以跨过去
          if(DOOR_COL.has(w)) continue;                   // 门不算障碍（走过去再推开）
          if(x > w.x0-R && x < w.x1+R && z > w.z0-R && z < w.z1+R){ blocked = true; break; }
        }
      }
      g[iz*NAV.nx + ix] = blocked ? 1 : 0;
    }
  }
  NAV.g = g; NAV.built = true;
}


// 找最近的可走点（防止刷在墙里/卡在角落）
function navNearestFree(x, z){
  if(!NAV.built) navBuild();
  if(navWalkableAt(x, z)) return {x, z};
  const c = navCell(x, z);
  const cx = c ? c.ix : Math.round((x-NAV.x0)/NAV.cell);
  const cz = c ? c.iz : Math.round((z-NAV.z0)/NAV.cell);
  for(let r=1; r<=24; r++){
    let best = null, bd = 1e9;
    for(let dz=-r; dz<=r; dz++) for(let dx=-r; dx<=r; dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz)) !== r) continue;
      const ix = cx+dx, iz = cz+dz;
      if(!navWalkable(ix, iz)) continue;
      const p = navCellCenter(ix, iz);
      const d = Math.hypot(p.x-x, p.z-z);
      if(d < bd){ bd = d; best = p; }
    }
    if(best) return best;
  }
  return null;
}
function snapEntityToWalkable(obj){
  if(!obj) return;
  const p = navNearestFree(obj.position.x, obj.position.z);
  if(p && (Math.abs(p.x-obj.position.x) > 0.05 || Math.abs(p.z-obj.position.z) > 0.05)){
    obj.position.set(p.x, 0, p.z);
  }
}

function navCell(x, z){
  const ix = Math.floor((x - NAV.x0)/NAV.cell);
  const iz = Math.floor((z - NAV.z0)/NAV.cell);
  if(ix < 0 || iz < 0 || ix >= NAV.nx || iz >= NAV.nz) return null;
  return { ix, iz };
}
function navWalkable(ix, iz){
  if(ix < 0 || iz < 0 || ix >= NAV.nx || iz >= NAV.nz) return false;
  return NAV.g[iz*NAV.nx + ix] === 0;
}
function navCellCenter(ix, iz){
  return { x: NAV.x0 + (ix+0.5)*NAV.cell, z: NAV.z0 + (iz+0.5)*NAV.cell };
}
function navWalkableAt(x, z){
  const c = navCell(x, z);
  return c ? navWalkable(c.ix, c.iz) : false;
}

// A*：从世界坐标到世界坐标，返回路点数组（不含起点）
// 用二叉堆 + 迭代上限，避免大地图上一次寻路卡几十毫秒
const NB8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
let _navBudget = 6;
function navTick(dt){ _navBudget = Math.min(6, _navBudget + dt*6); }
function navPath(sx, sz, tx, tz){
  if(_navBudget <= 0) return null;      // 这一帧的寻路额度用完了
  const _nt0 = performance.now();
  _navBudget -= 1;
  if(!NAV.built) navBuild();
  const s0 = navCell(sx, sz), t0 = navCell(tx, tz);
  if(!s0 || !t0) return null;
  let start = s0, goal = t0;
  if(!navWalkable(goal.ix, goal.iz)){
    let best = null, bd = 1e9;
    for(let r=1; r<=14 && !best; r++){
      for(let dz=-r; dz<=r; dz++) for(let dx=-r; dx<=r; dx++){
        const ix = goal.ix+dx, iz = goal.iz+dz;
        if(!navWalkable(ix, iz)) continue;
        const c = navCellCenter(ix, iz), d = Math.hypot(c.x-tx, c.z-tz);
        if(d < bd){ bd = d; best = {ix, iz}; }
      }
    }
    if(!best) return null;
    goal = best;
  }
  if(!navWalkable(start.ix, start.iz)){
    let best = null, bd = 1e9;
    for(let r=1; r<=14 && !best; r++){
      for(let dz=-r; dz<=r; dz++) for(let dx=-r; dx<=r; dx++){
        const ix = start.ix+dx, iz = start.iz+dz;
        if(!navWalkable(ix, iz)) continue;
        const c = navCellCenter(ix, iz), d = Math.hypot(c.x-sx, c.z-sz);
        if(d < bd){ bd = d; best = {ix, iz}; }
      }
    }
    if(!best) return null;
    start = best;
  }

  const W = NAV.nx, H = NAV.nz;
  const idx = (ix, iz) => iz*W + ix;
  const total = W * H;
  // 复用缓冲区：以前每次寻路都 new 三个大数组，4 个 AI 一起来就疯狂 GC → 卡顿
  if(!NAV.buf || NAV.buf.total !== total){
    NAV.buf = { total, prev: new Int32Array(total), seen: new Uint8Array(total), queue: new Int32Array(total) };
  }
  const prev = NAV.buf.prev, seen = NAV.buf.seen, queue = NAV.buf.queue;
  prev.fill(-1); seen.fill(0);
  const sId = idx(start.ix, start.iz), gId = idx(goal.ix, goal.iz);

  // BFS：格子上没有地形代价差异，BFS 比 A* 更稳、更快，永远不会因为启发式算错而失败
  let head = 0, tail2 = 0;
  queue[tail2++] = sId; seen[sId] = 1;
  let found = false;
  while(head < tail2){
    const cur = queue[head++];
    if(cur === gId){ found = true; break; }
    const cix = cur % W, ciz = (cur - (cur % W)) / W;
    // 8 邻域（斜角要求两侧都通，避免贴墙角穿模）
    for(let i=0;i<8;i++){
      const dx = NB8[i][0], dz = NB8[i][1];
      const nix = cix+dx, niz = ciz+dz;
      if(!navWalkable(nix, niz)) continue;
      if(dx && dz && (!navWalkable(cix+dx, ciz) || !navWalkable(cix, ciz+dz))) continue;
      const id = idx(nix, niz);
      if(seen[id]) continue;
      seen[id] = 1; prev[id] = cur;
      queue[tail2++] = id;
    }
  }
  const _nms = performance.now() - _nt0;
  try{ const P=window.__AI_PROF; P.navN++; P.navMs+=_nms; if(_nms>P.navMax) P.navMax=_nms; }catch(e){}
  if(!found) return null;

  // 回溯 → 路点
  const path = [];
  let n = gId;
  while(n !== sId && n !== -1){
    path.push(navCellCenter(n % W, (n - (n % W)) / W));
    n = prev[n];
  }
  path.reverse();
  return path;
}
// 沿着路点走一步（会被墙挡住的那种）
function navFollow(ent, obj, speed, dt){
  if(!ent.path || !ent.path.length){
    return false;
  }
  const wp = ent.path[0];
  const dx = wp.x - obj.position.x, dz = wp.z - obj.position.z;
  const dist = Math.hypot(dx, dz);
  if(dist < 0.35){
    ent.path.shift();
    return true;
  }
  const step = Math.min(dist, speed*dt);
  const p = {x: obj.position.x + dx/dist*step, z: obj.position.z + dz/dist*step, y: obj.position.y||0};
  collide(p);
  obj.position.set(p.x, p.y||0, p.z);
  obj.rotation.y = Math.atan2(dx, dz);
  return true;
}

let AI_CLOCK = 0;
function aiGhostStep(dt, speed){
  if(MAZE){
    if(!NAV.built){ try{ navBuild(); }catch(e){} }
    GAI.repathT = (GAI.repathT || 0) - dt;
    const chase = (GAI.state === 'chase');
    if(!GAI.path || !GAI.path.length || GAI.repathT <= 0){
      let tx = null, tz = null;
      if(chase){ tx = player.x; tz = player.z; }
      else {
        if(!GAI.wanderTarget ||
           Math.hypot(GAI.wanderTarget.x - ghost.position.x, GAI.wanderTarget.z - ghost.position.z) < 1.5){
          const b = window.MAZE_BOUNDS || {x0:-25,x1:25,z0:-20,z1:20};
          GAI.wanderTarget = null;
          for(let i=0;i<240;i++){
            const x = rr(b.x0+1.6, b.x1-1.6), z = rr(b.z0+1.6, b.z1-1.6);
            if(navWalkableAt(x,z) && Math.hypot(x-ghost.position.x, z-ghost.position.z) > 9){ GAI.wanderTarget = {x:x, z:z}; break; }
          }
          // 保底：实在挑不到远处的点，就随便给一个远点，navPath 会吸附到最近可走格
          if(!GAI.wanderTarget){
            for(let i=0;i<120;i++){
              const x = rr(b.x0+1.6, b.x1-1.6), z = rr(b.z0+1.6, b.z1-1.6);
              if(Math.hypot(x-ghost.position.x, z-ghost.position.z) > 12){ GAI.wanderTarget = {x:x, z:z}; break; }
            }
          }
        }
        if(GAI.wanderTarget){ tx = GAI.wanderTarget.x; tz = GAI.wanderTarget.z; }
      }
      if(tx !== null){
        const np = navPath(ghost.position.x, ghost.position.z, tx, tz);
        if(np && np.length) GAI.path = np;
      }
      GAI.repathT = chase ? 0.55 : 1.4;
    }
    const moved = navFollow(GAI, ghost, speed, dt);
    if(moved){
      try{ if(ghost.userData && ghost.userData.body && ghost.userData.body.root) driveWalk(ghost.userData.body.root, ghost, dt); }catch(e){}
    }
    return;
  }
  const r = aiStepPath(GAI, speed, dt);
  if(!r.moved) return;
  ghost.position.set(r.x, r.y || 0, r.z);
  const p = atPath(GAI.d);
  ghost.rotation.y = Math.atan2(p.dx * Math.sign(r.moved||1), p.dz * Math.sign(r.moved||1));
}
function aiNearestDoor(d, maxDist){
  let best=null, bd=maxDist;
  for(const dr of DOORS){
    if(dr.__aiCool && dr.__aiCool > AI_CLOCK) continue;      // 刚翻过的门先别翻
    const q = pathD(dr.x, dr.z);
    const dist = Math.abs(aiShortest(d, q));
    if(dist < bd){ bd = dist; best = dr; }
  }
  return best;
}
function aiBladeWipe(){
  const gb = ghost.userData.body.root;
  if(!gb || !gb.userData.arms) return;
  const sw = -0.9 + Math.sin(GAI.wipe*7)*0.09;
  for(const a of gb.userData.arms) a.grp.rotation.x = a.base + (a.side>0 ? sw : sw*0.3);
  if(gb.userData.blade) gb.userData.blade.rotation.x = 1.3 + Math.sin(GAI.wipe*8)*0.12;
}

// ---------- 迷宫模式：鬼 AI（巡逻 / 警戒 / 追击 / 搜寻 四态） ----------
function mazePickFarPoint(gx, gz, minD){
  const b = window.MAZE_BOUNDS || {x0:-25,x1:25,z0:-20,z1:20};
  let best=null, bd=-1;
  for(let i=0;i<200;i++){
    const x = rr(b.x0+1.6,b.x1-1.6), z = rr(b.z0+1.6,b.z1-1.6);
    if(!navWalkableAt(x,z)) continue;
    const d = Math.hypot(x-gx,z-gz);
    if(d > bd && d >= (minD||0)){ bd=d; best={x:x,z:z}; }
    if(bd > 30) break;
  }
  return best;
}
function mazePickDoor(){
  const list = (ROOM_DOORS||[]).filter(function(d){ return !d.open; });
  if(!list.length) return null;
  return list[(Math.random()*list.length)|0];
}
function mazeSamplesAround(x,z,n){
  const out=[];
  for(let i=0;i<60 && out.length<n;i++){
    const a = Math.random()*Math.PI*2, r = 3.5 + Math.random()*6;
    const sx = x + Math.cos(a)*r, sz = z + Math.sin(a)*r;
    if(navWalkableAt(sx,sz)) out.push({x:sx,z:sz});
  }
  return out;
}
function gsFace(tx,tz,dt){ try{ faceTarget(ghost, tx, tz, 20, dt); }catch(e){} }
function gsWalk(tx,tz,spd,dt){
  window.__GS=(window.__GS||0)+1; window.__GS_LAST=[+tx.toFixed(1),+tz.toFixed(1)];
  GAI.repathT = (GAI.repathT||0) - dt;
  if(GAI.repathT<=0 || !GAI.path || !GAI.path.length){
    const np = navPath(ghost.position.x, ghost.position.z, tx, tz);
    if(np && np.length){ GAI.path = np; }
    else {
      // 寻路失败：直接朝目标迈一步（有碰撞兜底），绝不站着不动
      const dx = tx - ghost.position.x, dz = tz - ghost.position.z;
      const d = Math.hypot(dx,dz) || 1;
      const q = { x: ghost.position.x + dx/d*spd*dt, z: ghost.position.z + dz/d*spd*dt, y:0 };
      try{ collide(q); }catch(e){}
      ghost.position.set(q.x, 0, q.z);
      ghost.rotation.y = Math.atan2(dx, dz);
      GAI.repathT = 0.5;
      return;
    }
    GAI.repathT = 0.45;
  }
  navFollow(GAI, ghost, spd, dt);
  try{ driveWalk(ghost.userData.body.root, ghost, dt); }catch(e){}
}
function aiGhostUpdateMaze(dt, distP, canSeeRaw){
  try{ return aiGhostMazeInner(dt, distP, canSeeRaw); }
  catch(e){ window.__GAI_ERR2 = e.message + ' @ ' + String((e.stack||'')).split(String.fromCharCode(10))[1]; }
}
function aiGhostMazeInner(dt, distP, canSeeRaw){
  window.__MI = (window.__MI||0)+1;
  if(!(dt > 0) || dt > 0.5) dt = 1/60;   // 兜底：切后台/掉帧时 dt 可能是 0，会让鬼站着不动
  window.__DT = dt;
  if(!GAI.st){
    GAI.st = { state:'PATROL', t:0, wait:0, lastSeen:null, target:null,
               samples:[], si:0, lostT:0, heardT:0, noise:null, cool:0 };
  }
  const S = GAI.st;
  S.t += dt;  S.cool = Math.max(0, S.cool - dt);
  GAI.hitCd = Math.max(0, (GAI.hitCd||0) - dt);

  // ---- 感知：视觉 ----
  const dx = player.x - ghost.position.x, dz = player.z - ghost.position.z;
  const dist = Math.hypot(dx, dz);
  const yaw  = ghost.rotation.y;
  let ang = Math.atan2(dx, dz) - yaw;
  while(ang >  Math.PI) ang -= Math.PI*2;
  while(ang < -Math.PI) ang += Math.PI*2;
  const FOV_HALF = Math.PI * 0.42;              // ±75°
  const lit = (typeof flashOn!=='undefined' && flashOn && !HIDE.hidden) ? 1.45 : 1.0;
  const seeDist = 9.75 * lit;        // 追击判定范围缩小 1/4（13 → 9.75）
  const see = !HIDE.hidden && dist < seeDist &&
              (Math.abs(ang) < FOV_HALF || dist < 3.2) &&
              !losBlocked(ghost.position.x, ghost.position.z, player.x, player.z);
  if(see){ S.lastSeen = {x:player.x, z:player.z}; S.lostT = 0; }
  else   { S.lostT += dt; }

  // ---- 感知：听觉 ----
  let heardAt = null;
  const lastN = NOISE_LOG.length ? NOISE_LOG[NOISE_LOG.length-1] : null;
  if(lastN && lastN !== S._lastN){
    S._lastN = lastN;
    if(lastN.heard){
      const st = (lastN.strength === undefined) ? 1 : lastN.strength;
      // 强度就是"被听见的概率"：贴着（0m）必被发现，1 米一半机会
      if(Math.random() < st) heardAt = {x:lastN.x, z:lastN.z};
    }
  }
  // 玩家奔跑：自身也在制造噪音
  if(!GAI._pp){ GAI._pp = {x:player.x, z:player.z}; }
  const pSpeed = Math.hypot(player.x-GAI._pp.x, player.z-GAI._pp.z) / Math.max(dt,0.0001);
  GAI._pp.x = player.x; GAI._pp.z = player.z;
  S.heardT = Math.max(0, S.heardT - dt);
  if(!heardAt && pSpeed > 3.2 && S.heardT <= 0 && dist < 11 && !HIDE.hidden){
    heardAt = {x:player.x, z:player.z}; S.heardT = 1.1;
  }

  // ---- 砍人 ----
  if(see && dist < 1.6 && GAI.hitCd <= 0){
    GAI.hitCd = cfgNum('鬼AI','砍人间隔秒',3);
    GAI.state='wipe'; GAI.wipe=0; GAI.path=null; GAI.pendingSlow=5;
    S.state='CHASE'; S.lostT=0;
    try{ applyHit(); }catch(e){}
    return;
  }
  // 擦刀
  if(GAI.state === 'wipe'){
    GAI.wipe = (GAI.wipe||0) + dt;
    try{ aiBladeWipe(); }catch(e){}
    if(GAI.wipe > 2.4){
      GAI.wipe = 0; GAI.path = null; GAI.state = 'chase';
      S.state = see ? 'CHASE' : 'SEARCH';
      if(GAI.pendingSlow){ GAI.slowT = GAI.pendingSlow; GAI.pendingSlow = 0; }
    }
    return;
  }

  const spd = (GAI.slowT > 0) ? 0.85 : (S.state==='CHASE' ? 4.10 : (S.state==='PATROL' ? 1.80 : 2.30));
  if(GAI.slowT > 0) GAI.slowT = Math.max(0, GAI.slowT - dt);

  const setState = function(n){
    if(S.state === n || S.cool > 0) return;
    S.state = n; S.t = 0; S.cool = 0.35; GAI.path = null; GAI.repathT = 0;
  };

  // ---- 状态机 ----
  if(see){ setState('CHASE'); }
  else if(heardAt && S.state !== 'CHASE'){ S.noise = heardAt; setState('ALERT'); }

  try {
  switch(S.state){
    case 'CHASE': {
      // 看得见就一直追；丢了先去最后看见的位置
      if(see){
        gsWalk(player.x, player.z, spd, dt);
        gsFace(player.x, player.z, dt);
      } else if(S.lostT > 0.55 || dist > 20){
        const p = S.lastSeen || {x:player.x, z:player.z};
        S.target = p; S.state = 'SEARCH'; S.t = 0;
        S.samples = []; S.si = 0; S.wait = 0;
      } else {
        gsWalk(S.lastSeen ? S.lastSeen.x : player.x, S.lastSeen ? S.lastSeen.z : player.z, spd, dt);
      }
      break;
    }
    case 'ALERT': {
      const t = S.noise || S.lastSeen || {x:player.x, z:player.z};
      gsWalk(t.x, t.z, spd, dt);
      gsFace(t.x, t.z, dt);
      if(Math.hypot(ghost.position.x-t.x, ghost.position.z-t.z) < 1.8 || S.t > 12){
        S.target = t; S.samples = []; S.si = 0; S.wait = 0;
        S.state = 'SEARCH'; S.t = 0;
      }
      break;
    }
    case 'SEARCH': {
      // 1) 先去最后的位置，站 2~4 秒
      if(!S.samples.length && S.si === 0){
        const t = S.target || S.lastSeen || {x:ghost.position.x, z:ghost.position.z};
        const d = Math.hypot(ghost.position.x-t.x, ghost.position.z-t.z);
        if(d > 1.6){ gsWalk(t.x, t.z, spd, dt); gsFace(t.x, t.z, dt); }
        else {
          if(S.wait <= 0) S.wait = rr(2.0, 4.0);
          S.wait -= dt;
          gsFace(ghost.position.x + Math.sin(S.t*1.7)*3, ghost.position.z + Math.cos(S.t*1.3)*3, dt);
          if(S.wait <= 0){
            S.samples = mazeSamplesAround(t.x, t.z, 3 + (Math.random()*3|0));
            S.si = 0;
          }
        }
        break;
      }
      // 2) 依次探查采样点
      const sp = S.samples[S.si];
      if(!sp){ S.state = 'PATROL'; S.t = 0; S.samples = []; S.target = null; break; }
      gsWalk(sp.x, sp.z, spd, dt);
      gsFace(sp.x, sp.z, dt);
      if(Math.hypot(ghost.position.x-sp.x, ghost.position.z-sp.z) < 1.5){
        S.si++;
        if(S.si >= S.samples.length){
          S.state = 'PATROL'; S.t = 0; S.samples = []; S.si = 0; S.target = null;
        }
      }
      if(S.t > 26){ S.state = 'PATROL'; S.t = 0; S.samples = []; S.si = 0; }
      break;
    }
    default: {
      // PATROL：全图跑点，点与点之间停 1~3 秒；偶尔去翻一扇门
      if(S.wait > 0){
        S.wait -= dt;
        break;
      }
      if(!S.target || Math.hypot(ghost.position.x-S.target.x, ghost.position.z-S.target.z) < 1.8){
        S.target = mazePickFarPoint(ghost.position.x, ghost.position.z, 14) ||
                   {x:ghost.position.x, z:ghost.position.z};
        if(Math.random() < 0.28){
          const rd = mazePickDoor();
          if(rd) S.target = {x:rd.x, z:rd.z, door:rd};
        }
        S.wait = rr(1.0, 3.0);
        GAI.path = null;
      }
      if(S.target){
        gsWalk(S.target.x, S.target.z, spd, dt);
        gsFace(S.target.x, S.target.z, dt);
        if(S.target.door && Math.hypot(S.target.door.x-ghost.position.x, S.target.door.z-ghost.position.z) < 2.0){
          const rd = S.target.door;
          try{
            setRoomDoor(rd, true);
            try{ (Sound.doorOpen||Sound.creak||Sound.click).call(Sound); }catch(e){}
            setTimeout(function(){ try{ setRoomDoor(rd, false); }catch(e){} }, 2000);
          }catch(e){}
          S.target = null;
        }
      }
      break;
    }
  }

  }catch(err){ window.__GAI_ERR = err.message + ' @ ' + String(err.stack||'').split(String.fromCharCode(10))[1]; }

  // 卡住自救
  if(!GAI._mz) GAI._mz = {x:ghost.position.x, z:ghost.position.z, t:0};
  GAI._mz.t += dt;
  if(GAI._mz.t > 1.0){
    if(Math.hypot(ghost.position.x-GAI._mz.x, ghost.position.z-GAI._mz.z) < 0.3){
      GAI.path = null; GAI.repathT = 0;
      if(S.state === 'PATROL') S.target = null;
      // 贴着墙/家具卡住：直接吸附到最近的可走格，别在原地耗
      try{ if(typeof snapEntityToWalkable === 'function') snapEntityToWalkable(ghost); }catch(e){}
    }
    GAI._mz.x = ghost.position.x; GAI._mz.z = ghost.position.z; GAI._mz.t = 0;
  }
}
function aiGhostUpdate(dt){
  window.__GAI_ENTRY = (window.__GAI_ENTRY||0) + 1;
  // 巡逻/追击路上遇到关着的房间门 → 推开（不然会顶着门站着不动）
  try{
    for(const rd of ROOM_DOORS){
      if(rd.open) continue;
      if(Math.hypot(rd.x - ghost.position.x, rd.z - ghost.position.z) < 1.9){
        setRoomDoor(rd, true);
        GAI.path = null; GAI.repathT = 0;
        try{ (Sound.doorOpen||Sound.creak||Sound.click).call(Sound); }catch(e){}
        break;
      }
    }
  }catch(e){}
  if((!AI.ghostOn && !MAZE) || GV.on || DEAD) return;
  if(GAI.lane === undefined){ GAI.lane = 0; GAI.homeLane = 0; GAI.hopY = 0; }
  AI_CLOCK += dt;

  // AI 鬼路过玻璃门：只有要穿过去才开，过去后关上（不跟玩家抢门）
  try{
    GAI.glassT = (GAI.glassT||0) + dt;
    if(GAI.glassT > 0.2){
      GAI.glassT = 0;
      for(const gd of GLASS){
        const dg = Math.hypot(gd.x - ghost.position.x, gd.z - ghost.position.z);
        const playerNear = Math.hypot(gd.x - player.x, gd.z - player.z) < 3.2;
        if(!gd.open && dg < 2.4){ toggleGlass(gd); gd.__aiOpened = AI_CLOCK; }   // 追人时一定开，不能被门卡住
        else if(gd.open && gd.__aiOpened && AI_CLOCK - gd.__aiOpened > 2.5 && dg > 3.0 && !playerNear){
          toggleGlass(gd); gd.__aiOpened = 0;
        }
      }
    }
  }catch(e){}

  // 砍人之后的减速惩罚（人类蹲走速度，5 秒）
  if(GAI.slowT > 0) GAI.slowT = Math.max(0, GAI.slowT - dt);
  if(GAI.hitCd === undefined) GAI.hitCd = 0;
  if(GAI.hitCd > 0) GAI.hitCd = Math.max(0, GAI.hitCd - dt);
  if(GAI.inkSlowT > 0) GAI.inkSlowT = Math.max(0, GAI.inkSlowT - dt);

  const px=player.x, pz=player.z;
  const distP = Math.hypot(px-ghost.position.x, pz-ghost.position.z);
  const canSee = !HIDE.hidden && distP < 13.0;
  if(MAZE){ window.__GAI_MAZE = (window.__GAI_MAZE||0) + 1; aiGhostUpdateMaze(dt, distP, canSee); return; }

  if(GAI.state === 'wipe'){
    GAI.wipe += dt;
    aiBladeWipe();
    if(GAI.wipe > 2.4){
      GAI.path = null;
      GAI.state = canSee ? 'chase' : 'patrol';
      GAI.target=(GAI.d+14)%RING_LEN;
      if(GAI.pendingSlow){ GAI.slowT = GAI.pendingSlow; GAI.pendingSlow = 0; }
    }
    return;
  }

  if(GAI.state === 'chase'){
    if(HIDE.hidden){
      // 人躲了：去他躲的那扇门附近翻门
      GAI.state='search'; GAI.t=0;
      GAI.door = HIDE.door ? HIDE.door : null;
      return;
    }
    // 视野判定：看得到才冲刺，跟丢就恢复走路
    const gfx = Math.sin(ghost.rotation.y), gfz = Math.cos(ghost.rotation.y);   // 模型朝向 = (sin,cos)
    const gdx = px - ghost.position.x, gdz = pz - ghost.position.z;
    const gdist = Math.hypot(gdx, gdz) || 1e-3;
    const gdot = (gdx*gfx + gdz*gfz)/gdist;
    const seeing = !HIDE.hidden && gdist < cfgNum('鬼AI','视野距离',13) && (gdist < cfgNum('鬼AI','贴身视野',4.5) || gdot > 0.05);

    if(seeing){ GAI.lostT = 0; GAI.lastSeen = {x:px, z:pz}; }
    else { GAI.lostT = (GAI.lostT||0) + dt; }

    if(!seeing && GAI.lostT > cfgNum('鬼AI','跟丢秒',3.2)){
      // 跟丢几秒：改成翻门搜索
      GAI.state='search'; GAI.t=0; GAI.rolled=false;
      GAI.door = aiNearestDoor(GAI.d, 7.0);
      return;
    }

    const seenPos = GAI.lastSeen || {x:px, z:pz};
    GAI.target = pathD(seenPos.x, seenPos.z);

    if(GAI.stam === undefined) GAI.stam = 1;
    let gsp = cfgNum('鬼AI','走路速度',1.80);        // 看不到：正常走路
    if(GAI.inkSlowT > 0){
      gsp = cfgNum('鬼AI','墨水减速速度',0.40);        // 被墨水黏住：蹲速的一半
      GAI.stam = Math.min(1, GAI.stam + dt);
    } else if(GAI.slowT > 0){
      gsp = cfgNum('鬼AI','砍人后速度',0.80);                                  // 砍完人：5 秒内只有人类蹲着走的速度
      GAI.stam = Math.min(1, GAI.stam + dt/1.0);
    } else if(seeing){
      if(GAI.stam > 0.02){
        gsp = CFG.鬼.速度*cfgNum('鬼AI','冲刺倍率',1.5);   // 冲刺
        GAI.stam = Math.max(0, GAI.stam - dt/cfgNum('鬼AI','冲刺秒',3));
      } else {
        GAI.stam = Math.min(1, GAI.stam + dt/1.0); // 没体力了只能走
      }
    } else {
      GAI.stam = Math.min(1, GAI.stam + dt/1.0);
    }
    // —— 网格寻路追人（会绕墙，不会怼墙）——
    GAI.repathT = (GAI.repathT || 0) - dt;
    if(GAI.repathT <= 0 || !GAI.path || !GAI.path.length){
      GAI.path = navPath(ghost.position.x, ghost.position.z, px, pz) || [];
      GAI.repathT = 0.35;
      if(!GAI.path.length) GAI.repathT = 0.8;
    }
    if(GAI.path && GAI.path.length){
      navFollow(GAI, ghost, gsp, dt);
      GAI.walkSpeed = gsp;
      GAI.d = pathD(ghost.position.x, ghost.position.z);
    } else if(seeing || gdist < 9){
      // 没有可用路线又隔着墙：先想办法开门，不要直撞墙
      if(losBlocked(ghost.position.x, ghost.position.z, px, pz)){
        const dr = doorBetweenGhostAndPlayer();
        if(dr){ setRoomDoor(dr, true); GAI.path = null; GAI.repathT = 0; }
      } else {
        aiGhostSeek(px, pz, gsp, dt);
      }
    } else {
      aiGhostStep(dt, gsp);
    }
    // 门挡在中间：先推开这扇门（玩家会听到开门声，这才对）
    if(losBlocked(ghost.position.x, ghost.position.z, player.x, player.z)){
      const dr = doorBetweenGhostAndPlayer();
      if(dr){
        setRoomDoor(dr, true);
        try{ (Sound.doorOpen||Sound.creak||Sound.click).call(Sound); }catch(e){}
        GAI.path = null; GAI.repathT = 0;
      }
    }

    // 追击时眼睛始终盯着玩家：朝向直接对准玩家，而不是寻路拐弯的方向
    try{ faceTarget(ghost, player.x, player.z, 22, dt); }catch(e){}

    // —— 卡住自救：0.7 秒没挪动就重新找路 / 挪出死角 ——
    const _gx = ghost.position.x, _gz = ghost.position.z;
    const _dm = Math.hypot(_gx - (GAI._lx===undefined?_gx:GAI._lx), _gz - (GAI._lz===undefined?_gz:GAI._lz));
    if(_dm < 0.02) GAI._stuck = (GAI._stuck||0) + dt; else GAI._stuck = 0;
    GAI._lx = _gx; GAI._lz = _gz;
    if(GAI._stuck > 1.5){      // 卡住判定：1.5 秒没动才换路线（0.7 太急，会频繁改道）
      GAI._stuck = 0;
      GAI.path = null; GAI.repathT = 0;
      const nf = navNearestFree(_gx, _gz);
      if(nf && Math.hypot(nf.x-_gx, nf.z-_gz) > 0.12){
        ghost.position.set(nf.x, 0, nf.z);
        GAI.d = pathD(nf.x, nf.z);
      }
      // 连续被同一个东西卡住（比如带角的造型件）→ 直接挪到玩家附近能走的格子，
      // 宁可"闪现"一下，也不要站着一直卡
      GAI._unstuckN = (GAI._unstuckN || 0) + 1;
      if(GAI._unstuckN >= 3){
        GAI._unstuckN = 0;
        const c = navNearestFree(player.x + (Math.random()-0.5)*4, player.z + (Math.random()-0.5)*4);
        if(c){ ghost.position.set(c.x, 0, c.z); GAI.d = pathD(c.x, c.z); }
        GAI.path = null; GAI.repathT = 0;
      }
    } else {
      GAI._unstuckN = 0;
    }

    // 砍中一次后有冷却（默认 3 秒），期间不能再出刀
    if(distP < 1.6 && GAI.hitCd <= 0 && !losBlocked(ghost.position.x, ghost.position.z, player.x, player.z)){
      GAI.hitCd = cfgNum('鬼AI','砍人间隔秒',3);
      applyHit();
      GAI.state='wipe'; GAI.wipe=0;
      GAI.pendingSlow = cfgNum('鬼AI','砍人减速秒',5);   // 擦完刀再开始减速
    }
    return;
  }

  if(GAI.state === 'search' || GAI.state === 'check'){
    GAI.t += dt;
    const dr = GAI.door;
    if(dr){
      const q = pathD(dr.x, dr.z);
      if(GAI.state==='search' && GAI.t < 0.4){
        GAI.target = q;
        aiGhostStep(dt, GAI.slowT>0 ? 0.80 : 1.6);
        return;
      }
      // 每扇门只掷一次骰子
      if(!GAI.rolled){
        GAI.rolled = true;
        const playerBehind = (typeof HIDE!=='undefined') && HIDE.hidden && HIDE.door === dr;
        let npcBehind = false;
        try{ npcBehind = AI.humans.some(function(h){ return h.state==='hide' && h.hideDoor === dr; }); }catch(e){}
        const occupied = playerBehind || npcBehind;
        // 门后有人：15% 打开；没人：40% 打开
        GAI.willOpen = Math.random() < (occupied ? cfgNum('鬼AI','翻门有人概率',0.15) : cfgNum('鬼AI','翻门没人概率',0.40));
        dr.__aiCool = AI_CLOCK + (occupied ? cfgNum('鬼AI','翻门冷却有人',12) : cfgNum('鬼AI','翻门冷却没人',9));      // 一段时间内不再翻这扇
        if(GAI.willOpen){
          dr.__aiOpen = true;
          dr.target = -1.55;
          try{ (Sound.doorOpen||Sound.creak).call(Sound); }catch(e){}
          setTimeout(function(){
            try{
              if(playerBehind && HIDE.hidden && HIDE.door === dr) applyHit();
              aiDamageHiddenInDoor(dr);
            }catch(e){}
          }, 500);
          // 开完必须关上
          setTimeout(function(){
            try{
              dr.target = 0;
              dr.__aiOpen = false;
              (Sound.doorClose||Sound.creak).call(Sound);
            }catch(e){}
          }, 1400);
        }
      }
      if(GAI.t > 2.6){
        if(dr.__aiOpen){ dr.target = 0; dr.__aiOpen = false; }   // 兜底：绝不留门开着
        GAI.state='patrol'; GAI.door=null; GAI.rolled=false; GAI.willOpen=false;
        GAI.target=(GAI.d+12)%RING_LEN;
      }
      return;
    }
    GAI.state='patrol'; GAI.rolled=false;
    return;
  }

  // patrol
  if(canSee){
    GAI.state='chase';
    return;
  }
  // 巡逻：网格里随机挑一个能走的点过去，到了再换
  if(!GAI.path || !GAI.path.length){
    let tx = ghost.position.x, tz = ghost.position.z;
    for(let i=0;i<12;i++){
      const a = Math.random()*Math.PI*2, r = 6 + Math.random()*10;
      const cx2 = ghost.position.x + Math.cos(a)*r, cz2 = ghost.position.z + Math.sin(a)*r;
      if(navWalkableAt(cx2, cz2)){ tx = cx2; tz = cz2; break; }
    }
    GAI.path = navPath(ghost.position.x, ghost.position.z, tx, tz) || [];
  }
  const patrolSpeed = GAI.inkSlowT > 0 ? 0.40 : (GAI.slowT > 0 ? 0.80 : 1.05);
  if(GAI.path && GAI.path.length){
    navFollow(GAI, ghost, patrolSpeed, dt);
    GAI.walkSpeed = patrolSpeed;
    GAI.d = pathD(ghost.position.x, ghost.position.z);
  } else {
    aiGhostStep(dt, patrolSpeed);
  }
  const arrived = !GAI.path || GAI.path.length === 0;
  if(arrived){
    GAI.t += dt;
    if(GAI.t > 1.2){
      GAI.t = 0;
      const dr = aiNearestDoor(GAI.d, 6.0);
      if(dr){ GAI.state='search'; GAI.door=dr; GAI.t=0; GAI.rolled=false; }
      else GAI.target=(GAI.d+rr(10,22))%RING_LEN;
    }
  }
}

/* ---------- AI 人类（玩家当鬼时，4 个） ---------- */
const AI_CLOTH = [0x2f3b46, 0x40323a, 0x2a3b32, 0x3a3326];
function aiSpawnHumans(n){
  for(let i=0;i<n;i++){
    const person = makePerson({cloth: AI_CLOTH[i % AI_CLOTH.length]});
    const d = (i * RING_LEN / n + rr(-2,2) + RING_LEN) % RING_LEN;
    // 迷宫模式：AI 人类也只放在"可玩连通区"里，免得被关在小房间
    const p = MAZE ? (mazePickInRegion() || {x:0, z:0}) : atPath(d);
    person.root.position.set(p.x, 0, p.z);
    try{ if(!NAV.built) navBuild(); snapEntityToWalkable(person.root); }catch(e){}
    person.root.traverse(function(o){ if(o.isMesh){ o.castShadow=false; o.receiveShadow=false; } });
    scene.add(person.root);
    const lane0 = (i%2===0 ? 1 : -1) * (0.35 + Math.random()*0.5);
    AI.humans.push({person, d, target:(d+rr(10,20))%RING_LEN, state:'wander', hp:0, hideDoor:null,
                    timer:rr(3,7), walk:0, walkAnim:rr(0,6), stam:1,
                    lane:lane0, homeLane:lane0, hopY:0});
  }
}
function aiHumanVisible(h){ return h.state !== 'out' && h.state !== 'hide'; }
function aiDamageHiddenInDoor(dr){
  for(const h of AI.humans){
    if(h.state === 'hide' && h.hideDoor === dr) aiHurtHuman(h);
  }
}
function aiHurtHuman(h){
  if(h.state === 'out' || h.state === 'dead') return;
  h.hp++;
  h.stam = 1;                          // 挨一刀 → 体力立刻回满，起身就跑

  if(h.hp >= 2){
    // 第二刀：直接倒地死亡（趴在血泊里，不再动）
    h.state='dead'; h.hideDoor=null;
    h.person.root.visible = true;
    h.person.root.rotation.order='YXZ';
    h.person.root.rotation.x = -1.35;
    const p = atPath(h.d);
    h.person.root.position.set(p.x, 0.22, p.z);
    return;
  }

  // 第一刀：断右臂 → 冲刺更快，但冲刺时长减半（体力上限砍一半）
  if(h.person.arms && h.person.arms[1]) h.person.arms[1].sh.visible = false;
  h.stamMax = 0.5;
  h.stam = Math.min(h.stam, 0.5);
  h.state='flee'; h.hideDoor=null; h.timer=4.5; h.postHit=4.5;
  h.person.root.visible = true;
  const p = atPath(h.d);
  h.person.root.position.set(p.x, 0, p.z);
  h.target = (h.d + 30) % RING_LEN;
}
let _aiAcc = 0;

// —— AI 人类：真实坐标移动（撞墙自动换向，不再绑在环形路上）——
function humanMove(h, dx, dz, speed, dt){
  const p = h.person.root.position;
  const L = Math.hypot(dx, dz) || 1;
  const step = speed*dt;
  const q = { x: p.x + dx/L*step, z: p.z + dz/L*step, y: 0 };
  collide(q);
  const mx = q.x - p.x, mz = q.z - p.z;      // ★ 先记下位移，再移动（否则朝向永远算成 0）
  const moved = Math.hypot(mx, mz);
  if(moved > 1e-4){
    p.set(q.x, 0, q.z);
    h.person.root.rotation.y = Math.atan2(mx, mz);
    h.d = pathD(q.x, q.z);
  }
  return moved;
}
function humanWander(h, speed, dt){
  const p = h.person.root.position;
  // 没路线就挑一个 5~12 米外、确实能走到的点，用 A* 过去
  if(!h.path || !h.path.length){
    let target = null;
    for(let i=0;i<20;i++){
      const a = Math.random()*6.283, r = 5 + Math.random()*7;
      const tx = p.x + Math.cos(a)*r, tz = p.z + Math.sin(a)*r;
      if(!navWalkableAt(tx, tz)) continue;
      target = {x:tx, z:tz}; break;
    }
    if(target){
      const path = navPath(p.x, p.z, target.x, target.z);
      if(path && path.length){ h.path = path; }
    }
    h.pathT = rr(3, 6);
  }

  if(h.path && h.path.length){
    const wp = h.path[0];
    const dx = wp.x - p.x, dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    if(d < 0.32){ h.path.shift(); return; }
    const moved = humanMove(h, dx, dz, speed, dt);
    if(moved < speed*dt*0.35){
      h.stuckT = (h.stuckT||0) + dt;
      if(h.stuckT > 0.6){
        h.stuckT = 0;
        h.path = null;
        h.stuckCount = (h.stuckCount||0) + 1;
        if(h.stuckCount >= 2){
          h.stuckCount = 0;
          snapEntityToWalkable(h.person.root);    // 连续卡住：直接挪出墙缝
        }
        const a = Math.atan2(h.person.root.position.z - (h._pz||h.person.root.position.z),
                             h.person.root.position.x - (h._px||h.person.root.position.x));
        h.heading = { x: Math.cos(a + Math.PI), z: Math.sin(a + Math.PI) };  // 背对卡点转身
      }
    } else { h.stuckT = 0; h.stuckCount = 0; }
  } else {
    // 找不到路（角落/门后）：保持一个朝向走，每 0.35 秒转一下，不要每帧随机（会打转）
    if(!h.escH) h.escH = Math.random()*6.283;
    h.escT = (h.escT||0) + dt;
    if(h.escT > 0.35){ h.escT = 0; h.escH += 1.2; }
    if(humanMove(h, Math.cos(h.escH), Math.sin(h.escH), speed*0.8, dt) < speed*dt*0.3){
      h.escT = 0; h.escH += 2.1;
    }
    h.pathT = 0;
  }
}
function humanFlee(h, speed, dt, gx, gz){
  const p = h.person.root.position;
  // 贴太近（3 米内）：别管路线了，直接背对鬼跑，绝不往脸上撞
  const dg0 = Math.hypot(p.x-gx, p.z-gz);
  if(dg0 < 5.0){
    const a = Math.atan2(p.z-gz, p.x-gx);
    if(humanMove(h, Math.cos(a), Math.sin(a), speed, dt) < speed*dt*0.3){
      humanMove(h, Math.cos(a+1.3), Math.sin(a+1.3), speed, dt);
    }
    h.path = null; h.fleeT = 0.25;
    return;
  }
  // 逃跑也用寻路：每 0.45 秒重算一次"背离鬼、且真的能走到"的目标点，
  // 不再每帧左右试探（那样会原地左右晃）
  h.fleeT = (h.fleeT || 0) - dt;
  if(!h.path || !h.path.length || h.fleeT <= 0){
    let best = null, bd = -1e9;
    const away = Math.atan2(p.z - gz, p.x - gx);
    for(let i=0;i<20;i++){
      const off = (Math.random()-0.5)*0.5;
      const a = away + off;
      const r = 9 + Math.random()*4;
      const tx = p.x + Math.cos(a)*r, tz = p.z + Math.sin(a)*r;
      if(!navWalkableAt(tx, tz)) continue;
      const d = Math.hypot(tx-gx, tz-gz);
      // 打分：离鬼越远越好，同时偏好"顺着已经跑的方向"，避免来回折返被堵住
      const score = d - Math.abs(off)*1.6;
      if(score > bd){ bd = score; best = {x:tx, z:tz}; }
    }
    if(best){
      const path = navPath(p.x, p.z, best.x, best.z);
      // 关键：路线如果会从鬼身边擦过去（往脸上撞），换一个目标点重算
      let safe = true;
      if(path && path.length){
        for(let i=0;i<Math.min(5, path.length);i++){
          if(Math.hypot(path[i].x-gx, path[i].z-gz) < 2.6){ safe = false; break; }
        }
      }
      if(safe && path && path.length) h.path = path;
      else if(path && path.length){ h.path = null; h.fleeT = 0.12; }   // 下一拍重新挑
      else if(!h.path || !h.path.length){ /* 保留旧路线 */ }
    }
    h.fleeT = 1.0;
  }

  if(h.path && h.path.length){
    const wp = h.path[0];
    const dx = wp.x - p.x, dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    if(d < 0.30){ h.path.shift(); return; }
    const moved = humanMove(h, dx, dz, speed, dt);
    if(moved < speed*dt*0.35){
      h.stuckT = (h.stuckT||0) + dt;
      if(h.stuckT > 0.5){                 // 0.5 秒原地徘徊 → 立刻换路线
        h.stuckT = 0; h.path = null; h.fleeT = 0;
        h.stuckCount = (h.stuckCount||0) + 1;
        if(h.stuckCount >= 2){ h.stuckCount = 0; snapEntityToWalkable(p); }
      }
    } else { h.stuckT = 0; h.stuckCount = 0; }
    return;
  }

  // 实在找不到路：保持一个方向跑 0.4 秒再换，不要每帧翻转
  if(!h.escH) h.escH = Math.atan2(p.z-gz, p.x-gx);
  h.escT = (h.escT||0) + dt;
  if(h.escT > 0.4){ h.escT = 0; h.escH += 0.9; }
  if(humanMove(h, Math.cos(h.escH), Math.sin(h.escH), speed, dt) < speed*dt*0.3){
    h.escT = 0; h.escH += 1.8;
  }
}

window.__AI_PROF = { n:0, total:0, max:0, navN:0, navMs:0, navMax:0, buildMs:0, builds:0 };
function aiHumansUpdate(dt){
  const _t0 = performance.now();
  try{ aiHumansUpdateInner(dt); }catch(e){}
  const _dt2 = performance.now() - _t0;
  const P = window.__AI_PROF;
  P.n++; P.total += _dt2; if(_dt2 > P.max) P.max = _dt2;
}
function aiHumansUpdateInner(dt){
  if(!GV.on) return;
  // 20Hz 更新就够：4 个人物每帧跑一次会把帧时间拉出毛刺
  _aiAcc += dt;
  if(_aiAcc < 0.08) return;
  const aiDt = _aiAcc; _aiAcc = 0;

  // AI 人类路过玻璃门：靠近才滑开；没有人类在门口就自动关上
  try{
    for(const gd of GLASS){
      let anyNear = false;
      for(const h of AI.humans){
        if(h.state === 'hide' || h.state === 'dead') continue;
        const hp = h.person.root.position;
        if(Math.hypot(gd.x - hp.x, gd.z - hp.z) < 2.2){ anyNear = true; break; }
      }
      const playerNear = Math.hypot(gd.x - player.x, gd.z - player.z) < 3.2;
      if(anyNear && !gd.open && !playerNear){ toggleGlass(gd); gd.__aiOpened = AI_CLOCK; }
      else if(gd.open && gd.__aiOpened && AI_CLOCK - gd.__aiOpened > 2.5 && !anyNear && !playerNear){
        toggleGlass(gd); gd.__aiOpened = 0;
      }
    }
  }catch(e){}

  for(const h of AI.humans){
    if(h.state==='out' || h.state==='dead') continue;
    // 距离剔除：18 米外不画；15 米外不再算动画（雾里根本看不见）
    let distG0 = 0;
    try{
      distG0 = Math.hypot(h.person.root.position.x-GV.x, h.person.root.position.z-GV.z);
    }catch(e){}
    if(h.state !== 'hide'){
      const near = distG0 < 20;
      if(h.person.root.visible !== near) h.person.root.visible = near;
      // 注意：远处的人只是"不画"，模拟照常走，否则他们会永远站桩
    }
    h.walk += dt;
    if(h.postHit>0) h.postHit = Math.max(0, h.postHit-dt);
    const distG = Math.hypot(h.person.root.position.x-GV.x, h.person.root.position.z-GV.z);

    // ================= 行为决策（简化版） =================
    //  鬼在 9 米内 = 被追：立刻疾跑远离，绝不躲
    //  鬼在 10 米内但没追：找门躲进去
    //  鬼走了（>10 米）：出来继续找钥匙
    //  其余时间：走去抽屉翻钥匙（走路，不疾跑）
    if(h.state === 'escaped') continue;      // 已经撤离的人不再参与任何决策
    const chased = distG < 9;
    const allKeysDone = (KEYS.length > 0 && KEYS_TAKEN >= KEYS.length);
    if(allKeysDone && !chased && h.state !== 'escaped'){
      h.state = 'toExit';                 // 钥匙齐了：往安全门撤
    } else if(chased){
      if(h.state === 'hiding' || h.state === 'toHide'){ h.person.root.visible = true; }
      h.state = 'flee';
      h.hideDoor = null; h.searchCab = null; h.searchT = 0;
      h.path = null;
    } else if(h.state === 'flee'){
      if(distG > 16){ h.state = 'search'; h.path = null; h.searchCab = null; }
    } else if(h.state === 'hiding'){
      if(distG > 10){                     // 鬼走了 → 出来继续找钥匙
        h.state = 'search'; h.person.root.visible = true;
        h.hideDoor = null; h.path = null; h.searchCab = null;
      }
    } else if(h.state === 'toHide'){
      /* 继续走向门，下面处理 */
    } else {
      if(distG < 10){                     // 鬼在附近但没追 → 躲
        const dr = aiNearestDoor(h.d, 10);
        if(dr){ h.state = 'toHide'; h.hideDoor = dr; }
        else { h.state = 'search'; }
      } else {
        h.state = 'search';
      }
    }

    // ================= 体力 =================
    let sprinting = false;
    let speed = cfgNum('人类AI','走路速度',1.35);
    if(h.state === 'flee'){
      if(h.stam > 0.03){
        sprinting = true;
        speed = (h.postHit>0 ? cfgNum('人类AI','受伤冲刺速度',5.4) : cfgNum('人类AI','冲刺速度',5.05));
        h.stam = Math.max(0, h.stam - aiDt/CFG.玩家.疾跑上限秒);
      } else {
        speed = 3.2;                                  // 没体力也小跑，不走路
        h.stam = Math.min(h.stamMax||1, h.stam + aiDt/6);
      }
    } else {
      h.stam = Math.min(h.stamMax||1, h.stam + aiDt/CFG.玩家.体力回复秒);
      if(h.state === 'toExit') speed = 3.4;      // 撤离时快跑，到一个撤一个
    }

    // 路上遇到关着的房间门 → 推开（AI 不会开门会一直卡在门口）
    try{
      const pp = h.person.root.position;
      for(const rd of ROOM_DOORS){
        if(rd.open) continue;
        if(Math.hypot(rd.x - pp.x, rd.z - pp.z) < 1.7){
          setRoomDoor(rd, true);
          GAI.path = null; h.path = null;
          break;
        }
      }
    }catch(e){}

    // ================= 行动 =================
    if(h.state === 'flee'){
      humanFlee(h, speed, aiDt, GV.x, GV.z);

    }else if(h.state === 'toHide' && h.hideDoor){
      const dp = atPath(pathD(h.hideDoor.x, h.hideDoor.z));
      humanMove(h, dp.x - h.person.root.position.x, dp.z - h.person.root.position.z, speed, aiDt);
      if(Math.hypot(dp.x - h.person.root.position.x, dp.z - h.person.root.position.z) < 0.85){
        h.state = 'hiding';
        h.timer = rr(cfgNum('人类AI','躲藏最短秒',6), cfgNum('人类AI','躲藏最长秒',11));
        h.person.root.visible = false;
        h.person.root.position.set(dp.x + dp.nx*0.55, 0, dp.z + dp.nz*0.55);
      }

    }else if(h.state === 'hiding'){
      h.timer -= aiDt;

    }else if(h.state === 'toExit'){
      // 目标点：门内侧 1.1 米（门本身在墙里，直接走过去会被墙挡住，永远到不了）
      if(!window.EXIT_APPROACH){
        const ddx = 0 - EXIT_INFO.x, ddz = 0 - EXIT_INFO.z;
        const LL = Math.hypot(ddx, ddz) || 1;
        window.EXIT_APPROACH = { x: EXIT_INFO.x + ddx/LL*1.1, z: EXIT_INFO.z + ddz/LL*1.1 };
      }
      const ex = window.EXIT_APPROACH.x, ez = window.EXIT_APPROACH.z;
      const px2 = h.person.root.position.x, pz2 = h.person.root.position.z;
      const dd = Math.hypot(ex - px2, ez - pz2);
      if(dd < 1.45){
        h.state = 'escaped';
        h.person.root.visible = false;
        AI_ESCAPED++;
        const alive = AI.humans.filter(function(x){ return x.state !== 'dead' && x.state !== 'escaped'; }).length;
        if(alive === 0) humanSideWin('AI 带着钥匙从安全门撤离了');
      }else{
        h._exitT = (h._exitT || 0) - aiDt;
        if(!h.path || !h.path.length || h._exitT <= 0){
          const pth = navPath(px2, pz2, ex, ez);
          if(pth && pth.length) h.path = pth;
          h._exitT = 1.0;
        }
        if(h.path && h.path.length){
          const wp2 = h.path[0];
          const dx3 = wp2.x - px2, dz3 = wp2.z - pz2;
          if(Math.hypot(dx3, dz3) < 0.32) h.path.shift();
          else if(humanMove(h, dx3, dz3, speed, aiDt) < speed*aiDt*0.3) h.path = null;
        }else{
          humanMove(h, ex - px2, ez - pz2, speed, aiDt);
        }
      }

    }else{
      // —— 找钥匙：走到一个没翻过的抽屉柜，翻 1.2 秒 ——
      if(!h.searchCab || h.cabSearched){
        const pool = CABINETS.filter(function(c){ return !c.__searchedByAI; });
        if(!pool.length){
          for(const c of CABINETS) c.__searchedByAI = false;      // 都翻完了就重来
        }
        const keyCabs = CABINETS.filter(function(c){
          return !c.__searchedByAI && c.drawers.some(function(d){ return d.item && d.item.kind==='key' && !d.item.taken; });
        });
        let pick = null;
        if(keyCabs.length && Math.random() < 0.6) pick = keyCabs[(Math.random()*keyCabs.length)|0];
        if(!pick){
          const rest = CABINETS.filter(function(c){ return !c.__searchedByAI; });
          if(rest.length) pick = rest[(Math.random()*rest.length)|0];
        }
        h.searchCab = pick || null;
        h.cabSearched = false; h.searchT = 0; h.path = null;
      }

      const cab = h.searchCab;
      if(!cab){
        humanWander(h, speed, aiDt);
      }else{
        const px = h.person.root.position.x, pz = h.person.root.position.z;
        const dc = Math.hypot(cab.x - px, cab.z - pz);
        if(dc > 1.3){
          // 走向抽屉柜（用寻路，撞墙会自动换路）
          if(!h.path || !h.path.length){
            const pth = navPath(px, pz, cab.x, cab.z);
            if(pth && pth.length) h.path = pth;
          }
          if(h.path && h.path.length){
            const wp = h.path[0];
            const dx2 = wp.x - px, dz2 = wp.z - pz;
            if(Math.hypot(dx2, dz2) < 0.3){ h.path.shift(); }
            else if(humanMove(h, dx2, dz2, speed, aiDt) < speed*aiDt*0.3){ h.path = null; }
          }else{
            humanMove(h, cab.x - px, cab.z - pz, speed, aiDt);
          }
        }else{
          // 到了：一层一层拉抽屉（每层 0.9 秒），翻到钥匙就拿走
          h.searchT = (h.searchT||0) + aiDt;
          if(h.searchT > 0.9){
            h.searchT = 0;
            try{ toggleDrawer(cab); }catch(e){}
            try{ Sound.click(); }catch(e){}      // 翻抽屉只用这一个音效，之后替换成你的
            for(const d of cab.drawers){
              if(d.open && d.item && d.item.kind === 'key' && !d.item.taken){
                takeKeyFromDrawer(d);
                break;
              }
            }
            // 三层都拉开了 → 这个柜子翻完
            if(cab.drawers.every(function(d){ return d.open; })){
              h.cabSearched = true;
              cab.__searchedByAI = true;
            }
          }
        }
      }
    }
    const step = speed*aiDt;
    // 走路动画：按"真实位移"算幅度；远处的也给呼吸摆幅，
    // 否则他们站着就是 A-pose 白模，看着像废弃模型
    const _px0 = (h._px === undefined) ? h.person.root.position.x : h._px;
    const _pz0 = (h._pz === undefined) ? h.person.root.position.z : h._pz;
    const _mv = Math.hypot(h.person.root.position.x - _px0, h.person.root.position.z - _pz0);
    h._px = h.person.root.position.x; h._pz = h.person.root.position.z;
    const realSpeed = _mv / Math.max(1e-3, aiDt);
    h.walkAnim = (h.walkAnim||0) + aiDt * (3.2 + realSpeed*2.6);
    if(h.person.update) h.person.update(h.walkAnim, Math.max(0.12, Math.min(2.4, realSpeed/1.4)), realSpeed>2.4);
    if(h.state==='wander' && (h.headT||0) <= 0){ h.headT = rr(1.6,3.6); }
  }
}

let GHOST_WON = false;
function checkGhostVictory(){
  if(GHOST_WON || AI.role !== 'ghost' || !AI.humans.length) return;
  const alive = AI.humans.filter(function(h){ return h.state!=='out' && h.state!=='dead'; });
  if(alive.length > 0) return;
  GHOST_WON = true;
  try{ playWin(); }catch(e){}
  if(document.pointerLockElement) document.exitPointerLock();
  const t=document.getElementById('winTitle'), hh=document.getElementById('winHint');
  if(t)  t.textContent = '你把所有人都杀了';
  if(hh) hh.textContent = '游戏结束 · 5 秒后返回主界面';
  const wb=document.getElementById('winBtn');
  if(wb){ wb.textContent='返回主界面'; wb.onclick=function(){ backToMenu(); }; }
  showView('pWin');
  STARTED = false;
  clearTimeout(window.__defeatT);
  window.__defeatT = setTimeout(backToMenu, 5000);
}
function updateAI(dt){
  if(AI.mode !== 'single') return;
  // 4 扇出口：把 EXIT_INFO 指到离玩家最近的那扇，提示/撤离判定都跟着它走
  if(window.EXITS && window.EXITS.length > 1 && !GV.on){
    let bestX = EXIT_INFO.x, bestZ = EXIT_INFO.z, bd = 1e9;
    for(const e of window.EXITS){
      const dd = Math.hypot(player.x - e.x, player.z - e.z);
      if(dd < bd){ bd = dd; bestX = e.x; bestZ = e.z; }
    }
    EXIT_INFO.x = bestX; EXIT_INFO.z = bestZ;
  }
  try{ if(window.Net && Net.connected) Net.tick(player); }catch(e){}
  aiGhostUpdate(dt);
  aiHumansUpdate(dt);
  checkGhostVictory();
}

// 菜单阶段先把 4 个 AI 人类造好（藏在菜单后面），点"我当鬼"时就不用现场造了
try{ if(!AI.humans.length) aiSpawnHumans(4); }catch(e){}
try{ AI.humans.forEach(function(h){ h.person.root.visible = false; }); }catch(e){}

// 菜单阶段就在背后把着色器编好：这样点「我当鬼」时不用再等 8 秒
setTimeout(function(){
  try{
    if(_warmedOnce || STARTED) return;
    warmupOnce(function(){}, true);
  }catch(e){}
}, 1000);

loop();



// 一次性优化：把小物件（瓶子、碎片、血迹）从阴影投射里剔掉，
// 阴影 pass 的绘制次数能砍掉一大半，帧率立刻上来
setTimeout(function(){
  let cut = 0, keep = 0;
  try{
    scene.traverse(function(o){
      if(!o.isMesh || !o.castShadow || !o.geometry) return;
      if(!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const r = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 1;
      if(r < 0.60){ o.castShadow = false; cut++; } else keep++;
    });
  }catch(e){ window.__shadowErr = e.message; }
  window.__shadowCut = {cut, keep};
}, 1000);


// 进菜单后测 2 秒帧率：机器慢就先把画质定到最低，避免开局后卡
setTimeout(function(){
  let n = 0, t0 = 0, last = 0;
  function tick(ts){
    if(!t0){ t0 = ts; last = ts; }
    n++;
    last = ts;
    if(ts - t0 < 2000){ requestAnimationFrame(tick); return; }
    const avg = (ts - t0) / Math.max(1, n);
    if(avg > 22){                       // 平均超过 22ms（<45fps）：先降档
      try{ applyQuality(0); }catch(e){}
      try{ flash.castShadow = false; }catch(e){}
      window.__autoQ = 'low';
    } else {
      window.__autoQ = 'ok';
    }
  }
  requestAnimationFrame(tick);
}, 2400);

// —— 预热：着色器编译 + 阴影贴图 + 4 个 AI 人类，全在主菜单期间完成 ——
let _prewarmed = false;
function prewarmWorld(){
  if(_prewarmed) return; _prewarmed = true;
  try{
    if(!AI.humans.length){
      aiSpawnHumans(4);
      for(const h of AI.humans) h.person.root.visible = false;
    }
  }catch(e){ window.__pwErr = e.message; }
  // 着色器编译统一交给 warmupOnce（点开始游戏时、在"加载中"遮罩后面做一次）
}
// 主菜单出来以后，只把 4 个 AI 人类建好（不编译、不渲染，避免菜单卡死）
setTimeout(function(){
  try{ requestAnimationFrame(function(){ requestAnimationFrame(prewarmWorld); }); }catch(e){ prewarmWorld(); }
}, 700);

/* ================= 编辑器音效接入（LEVEL_DATA.音效） =================
   用 <audio> 播放，file:// 打开也能用；没配或文件坏了就回落程序化音效 */
const SND_OVR = { data: {}, ready: false, failed: [] };

function probeAudio(url){
  return new Promise(function(resolve){
    const a = new Audio();
    let done = false;
    const finish = function(ok){
      if(done) return; done = true;
      resolve(ok ? { url, dur: (isFinite(a.duration) ? a.duration : 0) } : null);
    };
    a.preload = 'auto';
    a.oncanplaythrough = function(){ finish(true); };
    a.onloadeddata = function(){ finish(true); };
    a.onerror = function(){ finish(false); };
    a.src = url;
    setTimeout(function(){ finish(!!(a.readyState >= 2)); }, 3000);
  });
}

async function loadSoundOverrides(){
  const cfg = (window.LEVEL_DATA && LEVEL_DATA.音效) || null;
  if(!cfg) return;
  const keys = Object.keys(cfg);
  if(!keys.length) return;

  for(const k of keys){
    const entry = cfg[k] || {};
    const files = (entry.items || []).filter(function(it){ return it && it.kind === 'file' && it.file; });
    const ok = [];
    for(const it of files){
      const url = '素材/音频/' + encodeURIComponent(it.file);
      const r = await probeAudio(url);
      if(r) ok.push({ url: r.url, dur: it.dur || r.dur || 0, repeat: it.repeat || 1 });
      else SND_OVR.failed.push(it.file);
    }
    if(ok.length){
      SND_OVR.data[k] = { bufs: ok, vol: (entry.vol != null ? entry.vol : 1), random: !!entry.random };
    }
  }

  for(const k in SND_OVR.data){
    if(typeof Sound[k] !== 'function') continue;
    Sound[k] = (function(key){ return function(){ playOverride(key); }; })(k);
  }
  SND_OVR.ready = true;
  window.SND_OVR = SND_OVR;
  if(SND_OVR.failed.length) console.warn('[音效] 没加载成功：', SND_OVR.failed.join(', '));
}

function playOverride(k){
  const d = SND_OVR.data[k];
  if(!d || !d.bufs.length) return;
  const item = d.random ? d.bufs[Math.floor(Math.random()*d.bufs.length)] : d.bufs[0];
  const n = Math.max(1, item.repeat|0);
  const gap = item.dur > 0 ? item.dur : 0.5;
  for(let i=0;i<n;i++){
    setTimeout(function(){
      try{
        const a = new Audio(item.url);
        a.volume = Math.max(0, Math.min(1, d.vol));
        a.play().catch(function(){});
      }catch(e){}
    }, Math.round(i * gap * 1000));
  }
}

setTimeout(function(){ try{ loadSoundOverrides(); }catch(e){} }, 1800);
// 第一次交互时解锁音频
(function(){
  const kick = function(){
    try{ const c = sndCtx(); if(c && c.state === 'suspended') c.resume(); }catch(e){}
  };
  window.addEventListener('pointerdown', kick, { once:true });
  window.addEventListener('keydown', kick, { once:true });
})();
