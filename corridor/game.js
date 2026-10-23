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
for(const r of ROOMS){
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

// 墙脚的踢脚线（一圈，加深轮廓）
for(const s of PATH.segs){
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
{
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

function nearestGlass(){
  camera.getWorldDirection(_aimDir);
  // 只看水平朝向：抬头/低头不该影响开门判定
  const alen = Math.hypot(_aimDir.x, _aimDir.z) || 1e-3;
  const ax = _aimDir.x/alen, az = _aimDir.z/alen;
  let best=null, bs=-1;
  for(const gd of GLASS){
    const dx=gd.x-camera.position.x, dz=gd.z-camera.position.z;
    const dist=Math.hypot(dx,dz);
    if(dist>4.2) continue;
    const dot=(dx*ax + dz*az)/(dist||1e-3);
    if(dot<0.55 && dist>1.3) continue;   // 贴脸时不用对准也能开
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
for(const s of PATH.segs) NET.push(s);
for(const x of VX) NET.push({x, z:-IZ, dx:0, dz:1, len:2*IZ});
for(const z of HY) NET.push({x:-IX, z, dx:1, dz:0, len:2*IX});
for(const s of NET){
  for(let d=2.6; d<s.len-1.2; d+=6.4){
  const p={x:s.x+s.dx*d, z:s.z+s.dz*d};
  const rotY = Math.abs(s.dx)>0.5 ? Math.PI/2 : 0;
  const slot=new THREE.Mesh(new THREE.BoxGeometry(1.18,.07,.34), darkMat);
  slot.position.set(p.x, H-.04, p.z); slot.rotation.y=rotY; scene.add(slot);

  const lit = R()<0.5;
  const panelMat=new THREE.MeshStandardMaterial({
    color: lit?0xdfe6ee:0x30343c, emissive: lit?0xf2f6ff:0x000000,
    emissiveIntensity: lit?1.4:0, roughness:.5
  });
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(1.0,.26), panelMat);
  panel.rotation.set(Math.PI/2, 0, rotY);
  panel.position.set(p.x, H-.085, p.z);
  scene.add(panel);

  if(lit){
    const pl=new THREE.PointLight(0xc6dce6, 56, 13, 1.85);
    pl.position.set(p.x+rr(-.16,.16), H-.24, p.z+rr(-.16,.16));
    pl.userData.base=62;
    scene.add(pl); lightPts.push(pl);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(.78, H-.16, 14, 1, true), coneMat);
    cone.position.set(pl.position.x, (H-.16)/2, pl.position.z);
    scene.add(cone);
  }
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
function losBlocked(x0,z0,x1,z1){
  for(const w of WALLS) if(segHitsRect(x0,z0,x1,z1,w)) return true;
  return false;
}
// 走廊上的随机点（一半在外围环廊，一半在内区四条走廊）
function randomSpawnPoint(){
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
  ghost.position.set(SPAWN.ghost.x, 0, SPAWN.ghost.z);
  scene.add(ghost);
}

// —— 安全出口：刷新在鬼附近 14 米内，避开转角 ——
// 固定位置：从鬼出生点往走廊前方找第一个"离所有门 3 米以上"的点
let EXIT_D = null;
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
{
  addDoorAt(EXIT_WALL.x, EXIT_WALL.z, Math.atan2(-EXIT_P.nx,-EXIT_P.nz), 0);   // 门（关着）
  // 绿色安全出口牌
  const c=canvasOf(256), cx2=c.getContext('2d');
  cx2.fillStyle='#02140a'; cx2.fillRect(0,0,256,256);
  cx2.fillStyle='#39e07c'; cx2.font='bold 74px sans-serif';
  cx2.textAlign='center'; cx2.textBaseline='middle';
  cx2.fillText('安全',128,84); cx2.fillText('出口',128,172);
  const tx=new THREE.CanvasTexture(c); tx.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(.64,.64),
    new THREE.MeshBasicMaterial({map:tx, transparent:true}));
  sign.position.set(EXIT_P.x + EXIT_P.nx*(W/2-.10), 2.44, EXIT_P.z + EXIT_P.nz*(W/2-.10));
  sign.rotation.y = Math.atan2(-EXIT_P.nx,-EXIT_P.nz);
  scene.add(sign);
  // 出口的绿光（远远就能看见"有救了"）
  const gl2=new THREE.PointLight(0x48d18c, 14, 9, 1.9);
  gl2.position.set(EXIT_P.x + EXIT_P.nx*(W/2-1.1), 2.3, EXIT_P.z + EXIT_P.nz*(W/2-1.1));
  scene.add(gl2);
  // 地面上一圈发光标记
  const ring=new THREE.Mesh(new THREE.RingGeometry(.55,.72,24),
    new THREE.MeshBasicMaterial({color:0x2fd47f, transparent:true, opacity:.35, side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;
  ring.position.set(EXIT_P.x + EXIT_P.nx*(W/2-1.0), .02, EXIT_P.z + EXIT_P.nz*(W/2-1.0));
  scene.add(ring);
}
window.EXIT_INFO = { d:EXIT_D, x:EXIT_WALL.x, z:EXIT_WALL.z, ghostD:GHOST_D, playerD:PLAYER_D };

/* ================= 2.0：柜子 / 架子 / 道具 / 交互 / 鬼视角 ================= */
const CABINETS=[], SHELVES=[], ITEMS=[], PROJECTILES=[];
const CAB_HIT=[], ITEM_HIT=[];
const INV={ink:0, shoe:0};
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
function toggleDrawer(rec){
  if(!rec || !rec.drawers) return;
  const d = rec.drawers.find(function(x){ return !x.open; });
  if(d){
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
spawnRoundItems();

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
  for(const h of CAB_HIT) test(h.mesh,'cabinet',h.cab);
  for(const h of ITEM_HIT) if(!h.item.taken && !h.item.hidden) test(h.mesh,'item',h.item);
  return best;
}
let tipT=0, tipMsg='';
function toastTip(msg){ tipMsg=msg; tipT=1.2; elAimTip.textContent=msg; elAimTip.style.opacity='1'; }
function updateItemHud(){
  const parts=[];
  if(INV.ink>0) parts.push('墨水 ×'+INV.ink+'（左键扔）');
  elItems.textContent = parts.join('　·　');
}
function pickupItem(it){
  if(it.taken) return;
  it.taken=true; it.mesh.visible=false;
  if(it.kind==='ink'){ INV.ink++; toastTip('捡到墨水 · 鼠标左键扔出去'); }
  else { STAM_MAX=CFG.道具.皮鞋疾跑上限; stamina=1; toastTip('捡到皮鞋 · 疾跑上限变成 '+CFG.道具.皮鞋疾跑上限+' 秒'); }
  updateItemHud();
}
// —— 墨水：扔出去，砸中鬼 → 鬼的屏幕黑 3 秒 ——
let blindT=0;          // 鬼被墨水糊住的剩余秒数（按真实时间衰减，不随视角切换重置）
function onInkHit(){
  Sound.click();
  blindT = CFG.道具.墨水黑屏秒;
  // 只有"正在看鬼的屏幕"才全黑；人类视角下只提示，不遮自己的眼
  if(GV.on){ elBlind.style.opacity='1'; }
  else toastTip('墨水砸中鬼 · 它被糊住眼睛 3 秒');
  ghost.userData.pulse = 1.0;      // 鬼身上闪一下，确认砸中了
}
function throwInk(){
  if(INV.ink<=0) return;
  INV.ink--; updateItemHud();
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
      if(GV.on) toastTip('视线恢复了');
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
  RADAR = true;              // 按过一次 P 之后，雷达常驻
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
  toastTip(GV.on ? '切到鬼的视角（再按 P 切回）' : '回到人类视角');
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
  if(DEAD) return;
  if(HURT_LV>=2) return;              // 掉腿状态下鬼不能再砍
  HURT_LV++;

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
      DEAD = true;
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
function clearTransient(){
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
  clearTimeout(window.__defeatT);
  if(document.pointerLockElement) document.exitPointerLock();
  STARTED = false; DEAD = false; HURT_LV = 0;
  if(typeof GHOST_WON !== 'undefined') GHOST_WON = false;
  clearTransient();
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
  ATK.on=true; ATK.t=0;
  const dx=player.x-GV.x, dz=player.z-GV.z;
  const dist=Math.hypot(dx,dz)||1e-3;
  const fx=-Math.sin(GV.yaw), fz=-Math.cos(GV.yaw);
  const dot=(dx*fx+dz*fz)/dist;
  Sound.slash();
  // 躲在柜子里的人砍不到；正面 2.2 米内且大致朝向 → 命中
  let hitSomething = false;
  if(!HIDE.hidden && dist<2.2 && dot>0.45){ applyHit(); hitSomething = true; GV.slowT = cfgNum('鬼AI','砍人减速秒',5); }
  else if(AI.humans.length){
    // 砍 AI 人类也算
    for(const h of AI.humans){
      if(h.state==='dead' || h.state==='out' || h.state==='hide') continue;
      const hx=h.person.root.position.x, hz=h.person.root.position.z;
      const hd=Math.hypot(hx-GV.x, hz-GV.z);
      if(hd < 2.2){ aiHurtHuman(h); hitSomething = true; GV.slowT = cfgNum('鬼AI','砍人减速秒',5); break; }
    }
  }
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
  if(!cab){ const dr = nearestDoor(); if(dr){ cab = dr; kind = 'door'; } }
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
    el.onclick = function(){
      const k = el.dataset.k;
      if(!k) return;
      if(k==='shoe'){ INV.shoe--; STAM_MAX=CFG.道具.皮鞋疾跑上限; stamina=1; toastTip('穿上皮鞋 · 疾跑上限 '+CFG.道具.皮鞋疾跑上限+' 秒'); }
      if(k==='ink'){ toastTip('墨水：关闭背包后按左键投掷'); }
      toggleBag();
    };
  });
}

function toggleBag(){
  if(!STARTED) return;
  BAG = !BAG;
  if(BAG){
    if(document.pointerLockElement) document.exitPointerLock();
    bagSlots(); elBag.style.display='flex';
  } else {
    elBag.style.display='none';
    const p2 = renderer.domElement.requestPointerLock();
    if(p2 && p2.catch) p2.catch(function(){});
  }
}


/* ================= 15. 雷达小地图（按 P 后常驻显示）================= */
let RADAR = false;
const elRadar = document.createElement('canvas');
elRadar.width = 168; elRadar.height = 126;
elRadar.style.cssText = 'position:fixed;left:16px;top:16px;z-index:39;opacity:0;' +
  'border:1px solid rgba(120,170,155,.35);border-radius:6px;background:rgba(4,9,11,.62);' +
  'box-shadow:0 0 14px rgba(0,0,0,.7);pointer-events:none;transition:opacity .3s';
document.body.appendChild(elRadar);
const rctx = elRadar.getContext('2d');

function drawRadar(){
  if(!RADAR || !STARTED){ elRadar.style.opacity='0'; return; }
  elRadar.style.opacity='1';
  const CW=elRadar.width, CH=elRadar.height, pad=9;
  const sx=(CW-pad*2)/(HX*2), sz=(CH-pad*2)/(HZ*2);
  const px=x=>pad+(x+HX)*sx, pz=z=>pad+(z+HZ)*sz;
  rctx.clearRect(0,0,CW,CH);
  // 走廊（外圈减中庭）
  rctx.fillStyle='rgba(96,140,128,.20)';
  rctx.fillRect(px(-HX),pz(-HZ),HX*2*sx,HZ*2*sz);
  rctx.clearRect(px(-IX),pz(-IZ),IX*2*sx,IZ*2*sz);
  rctx.strokeStyle='rgba(120,190,170,.45)'; rctx.lineWidth=1;
  rctx.strokeRect(px(-HX)+.5,pz(-HZ)+.5,HX*2*sx-1,HZ*2*sz-1);
  rctx.strokeRect(px(-IX)+.5,pz(-IZ)+.5,IX*2*sx-1,IZ*2*sz-1);
  // 安全出口
  if(window.EXIT_INFO){ rctx.fillStyle='#3fd48a'; rctx.fillRect(px(EXIT_INFO.x)-2,pz(EXIT_INFO.z)-2,4,4); }
  // 玻璃门
  for(const gd of GLASS){ rctx.fillStyle = gd.open?'rgba(150,220,255,.5)':'rgba(150,220,255,.9)';
    rctx.fillRect(px(gd.x)-1.5,pz(gd.z)-1.5,3,3); }
  // 玩家
  rctx.fillStyle='#7fe0a8'; rctx.beginPath(); rctx.arc(px(player.x),pz(player.z),3,0,7); rctx.fill();
  // 鬼
  rctx.fillStyle='#ff5a44'; rctx.beginPath(); rctx.arc(px(ghost.position.x),pz(ghost.position.z),3,0,7); rctx.fill();
  // 玩家朝向
  rctx.strokeStyle='rgba(127,224,168,.8)'; rctx.beginPath();
  rctx.moveTo(px(player.x),pz(player.z));
  rctx.lineTo(px(player.x - Math.sin(player.yaw)*2.2), pz(player.z - Math.cos(player.yaw)*2.2));
  rctx.stroke();
  // 标签
  rctx.fillStyle='rgba(150,200,185,.55)'; rctx.font='9px system-ui';
  rctx.fillText('RADAR', 6, CH-5);
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
    step(run){ noiseHit(run?420:330, 1.3, run?.32:.23, .004, run?.15:.20, 'lowpass');
      tone(run?72:60, .22, .18, 'sine', run?44:38);      // 体重砸地的低频
      tone(150, .07, .07, 'triangle');
      if(run) setTimeout(()=>noiseHit(1200,.9,.05,.002,.045,'bandpass'), 30);
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
Sound.setDrip(()=>Sound.drip());

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
const HANG = (()=>{
  const p=atPath(6);
  // 前方 6.4 米、屏幕右手边 1.95 米（走廊内侧那边）
  const px=p.x + p.dx*6.4 - p.dz*1.95;
  const pz=p.z + p.dz*6.4 + p.dx*1.95;
  const g=new THREE.Group(); g.position.set(px,0,pz);
  g.rotation.y = Math.atan2(-p.dx, -p.dz);   // 面朝镜头
  scene.add(g);
  const body=makePerson({cloth:0x171b20, torch:false});
  body.root.position.y=0.62; body.root.rotation.z=0.06;
  body.root.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  g.add(body.root);
  const rope=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,0.70,8),
                new THREE.MeshStandardMaterial({color:0x2b2a26, roughness:.95}));
  rope.position.y=2.50; g.add(rope);
  const hook=new THREE.Mesh(new THREE.TorusGeometry(.05,.012,6,10), metalMat);
  hook.position.y=2.84; g.add(hook);
  const spot=new THREE.PointLight(0x9fc4d6, 14, 7, 2.0);   // 身后一点轮廓光，把剪影勾出来
  spot.position.set(0.5, 2.45, -1.0); g.add(spot);
  return {group:g, x:px, z:pz};
})();
const keys=Object.create(null);
addEventListener('keydown',e=>{keys[e.code]=true;});
addEventListener('keyup',  e=>{keys[e.code]=false;});

/* —— 体力 + 冲刺开关 —— */
let   STAM_MAX=CFG.玩家.疾跑上限秒;                    // config.js 可调
const STAM_REGEN=CFG.玩家.体力回复秒, STAM_DELAY=0.9, WALK_SPD=CFG.玩家.走速, RUN_SPD=CFG.玩家.跑速;
let stamina=1, sprintHeld=false, exhausted=false, idleTime=0, lastStamPct=-1;
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
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ sprintHeld=true; }
  if(e.code==='KeyZ'){ crouchHeld=true; }
  // 空格跳跃
  if(e.code==='Space'){
    e.preventDefault();
    if(player.grounded){ player.vy=JUMP_V; player.grounded=false; }
  }
  // E 躲藏 / 出来
  if(e.code==='KeyE' && !e.repeat){
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
  // P 切换鬼视角（联机前调试鬼那端用的）
  if(e.code==='KeyP' && !e.repeat){ toggleGhostView(); return; }
  // F 开关手电
  if(e.code==='KeyF' && !e.repeat){
    flashOn=!flashOn;
    flashTipT=3.0;
    Sound.click();
    if(!flashOn) flash.intensity=0;
  }
});
addEventListener('keyup',e=>{
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ sprintHeld=false; }
  if(e.code==='KeyZ'){ crouchHeld=false; }
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
  else throwInk();
});


/* ================= 14. 躲藏系统（E 键）· 第三人称动画 · 声音衰减 ================= */
// —— 听力半径：以红色立方体为参照物，2 个立方体 ≈ 2.3 米 ——
const CUBE_SIZE = 1.15;                    // 鬼的占位立方体边长
const HEAR_R    = 2 * CUBE_SIZE;           // 鬼能听见开关门的半径
const NOISE_LOG = [];

// 门声事件：返回鬼有没有听见
function emitNoise(kind, x, z){
  const d = Math.hypot(ghost.position.x - x, ghost.position.z - z);
  const heard = d <= HEAR_R;
  NOISE_LOG.push({kind, x, z, d, heard});
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
      const dp2=atPath(pathD(HIDE.door.x,HIDE.door.z));
      const md2 = MAP.doors.reduce((a2,b2)=>{
        const q1=Math.hypot(a2.x-HIDE.door.x, a2.z-HIDE.door.z);
        const q2=Math.hypot(b2.x-HIDE.door.x, b2.z-HIDE.door.z);
        return q2<q1?b2:a2;
      }, MAP.doors[0]);
      player.x = HIDE.door.x + dp2.nx*0.55;   // 贴近观察窗，看得更宽
      player.z = HIDE.door.z + dp2.nz*0.55;
      // 相机 forward = (-sin yaw, -cos yaw)；要看向走廊（-n 方向）
      player.yaw = Math.atan2(dp2.nx, dp2.nz);
      HIDE.baseYaw = player.yaw;
      HIDE.room = (md2 && md2.box) ? md2.box : null;  // 柜内活动范围
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
    if(aim.kind==='cabinet'){ toggleDrawer(aim.ref); return; }
    if(aim.kind==='item'){ pickupItem(aim.ref); return; }
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
    sens:'鼠标灵敏度', vol:'音量', qual:'画质', gpu:'显卡',
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
    sens:'Mouse sensitivity', vol:'Volume', qual:'Quality', gpu:'GPU',
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
  $id('btnStart').textContent = STARTED ? t.resume : t.start;
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = T(el.dataset.i18n); });
  const row=(k,v)=>'<div class="row"><span class="key">'+k+'</span><span>'+v+'</span></div>';
  const H_LIST = [
    ['W A S D', '移动'], ['鼠标', '转视角'], ['Shift', '按住冲刺（消耗体力）'],
    ['空格', '跳跃'], ['Z', '蹲下（无脚步声）'], ['F', '开关手电'],
    ['E', '开门 / 抽屉 / 躲藏 / 拾取'], ['左键', '投掷墨水'],
    ['B', '背包'], ['P', '切到鬼视角（调试）'], ['Esc', '暂停 / 菜单']
  ];
  const G_LIST = [
    ['W A S D', '移动'], ['鼠标', '转视角'], ['Shift', '冲刺 3 秒 · 耗尽要喘气'],
    ['空格', '跳跃'], ['Z', '蹲下（无脚步声）'],
    ['E', '开门 / 开抽屉 / 检查假门'], ['左键', '挥刀攻击'],
    ['P', '切回人类视角（调试）'], ['Esc', '暂停 / 菜单']
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
  ['pMain','pMode','pCamp','pSettings','pControls','pSkin','pBye','pWin'].forEach(v=>{
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
function startGame(camp){
  CAMP = camp || CAMP;
  STARTED = true;
  const _ui0 = document.getElementById('ui'); if(_ui0) _ui0.classList.remove('menuBg');
  const _ma = document.getElementById('menuArt');
  if(_ma) _ma.style.opacity = '0';
  fadeIntoGame();
  const it=document.getElementById('items'); if(it) it.style.display='block';
  Sound.init();
  const p = renderer.domElement.requestPointerLock();
  if(p && p.catch) p.catch(()=>{});
  if(camp==='ghost' && !GV.on) setTimeout(()=>{ if(!GV.on) toggleGhostView(); }, 80);
}
$id('btnStart').onclick = ()=> STARTED ? startGame(CAMP) : playMenuIntro(()=>showView('pMode'));
$id('pickSingle').onclick = ()=> showView('pCamp');
$id('pickMulti').onclick  = ()=> toastTip('联机开发中，先玩单人模式');
// 新开一局：刷新出生点（位置不再沿用上一次退出时的位置）
function respawnPlayer(){
  const sp = pickSpawns();
  player.x = sp.player.x; player.z = sp.player.z; player.y = 0; player.vy = 0;
  player.yaw = Math.atan2(sp.ghost.x - sp.player.x, sp.ghost.z - sp.player.z);
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
    h.target = (h.d + rr(8,18)) % RING_LEN;
  }
  stamina = 1; STAM_MAX = CFG.玩家.疾跑上限秒;
  GAI.lane = 0; GAI.homeLane = 0; GAI.hopY = 0; GAI.lostT = 0; GAI.lastSeen = null; GAI.stam = 1; GAI.slowT = 0; GAI.pendingSlow = 0;
  ghost.position.set(sp.ghost.x, 0, sp.ghost.z);
  if(GV.on) toggleGhostView();     // 强制回到人类视角
}
$id('pickHuman').onclick = ()=>{
  const _m=document.getElementById('loadMask'); if(_m) _m.classList.add('on');
  setTimeout(function(){ if(_m) _m.classList.remove('on'); }, 260);
  AI.mode='single'; AI.role='human';
  respawnPlayer(); aiGhostInit();
  AI.humans.forEach(h=>{ h.person.root.visible=false; });
  startGame('human');
};
$id('pickGhost').onclick = ()=>{
  const mask=document.getElementById('loadMask');
  if(mask) mask.classList.add('on');
  // 先让浏览器把"加载中"画出来，再做重活，避免页面假死
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    try{
      AI.mode='single'; AI.role='ghost';
      respawnPlayer();
      AI.ghostOn=false;
      if(!AI.humans.length) aiSpawnHumans(4);
      startGame('ghost');
      // 把鬼视角要用的材质全部先编译，别等玩到一半才卡
      try{ renderer.compile(scene, camera); renderer.render(scene, camera); }catch(e){}
    }catch(e){ console.error(e); }
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      if(mask) mask.classList.remove('on');
    }); });
  }); });
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
document.addEventListener('pointerlockchange',()=>{
  const locked = document.pointerLockElement===renderer.domElement;
  ui.classList.toggle('hide', locked);
  PAUSED = !locked && STARTED;
  if(PAUSED){
    showView('pMain');        // 永远回到主菜单，不回上一个面板
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
function loop(){
  requestAnimationFrame(loop);
  const _rawDt = clock.getDelta();
  // 手电阴影隔一帧更新一次（画面几乎无差，但每帧少渲染一整套影子）
  try{
    _shadowFlip = !_shadowFlip;
    if(flash.shadow){ flash.shadow.autoUpdate = _shadowFlip; }
  }catch(e){}
  let dt=Math.min(_rawDt,0.05);
  try{ perfGuard(_rawDt); }catch(e){}
  if(PAUSED || BAG || !STARTED || (STARTED && !document.pointerLockElement && !BAG)) dt=0;   // 菜单/背包里世界冻结
  const t=clock.elapsedTime;

  // —— 移动 ——
  let fw=0, sd=0;
  if(keys.KeyW||keys.ArrowUp)   fw+=1;
  if(keys.KeyS||keys.ArrowDown) fw-=1;
  if(keys.KeyA||keys.ArrowLeft) sd-=1;
  if(keys.KeyD||keys.ArrowRight)sd+=1;
  if((HIDE.on || HIDE.hidden) && !GV.on){ fw=0; sd=0; } // 只锁人类

  // —— 鬼视角：鬼自己走，人类不动 ——
  if(GV.on && dt>0 && !CHECK.on && !ATK.on){
    const glen = Math.hypot(fw,sd);
    if(glen > 0){
      const nf=fw/glen, ns=sd/glen;
      // —— 鬼的体力：3 秒冲刺，耗尽后 0.5 秒缓慢减速（像跑完喘气），1 秒回满 ——
      const G_WALK = cfgNum('鬼AI','走路速度',1.80), G_SPRINT = CFG.鬼.速度*cfgNum('鬼AI','冲刺倍率',1.5);
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
        if(GV.stam <= 0.02){ GV.exhaustT = cfgNum('鬼AI','力竭减速秒',0.5); GV.gassed = true; } // 力竭减速
      } else {
        gspeed = G_WALK;
        GV.stam = Math.min(1, GV.stam + dt/1.0);  // 1 秒回满
      }
      // 力竭后必须松开 Shift 才能再次冲刺（像人喘完气才跑得动）
      if(GV.gassed && !sprintHeld) GV.gassed = false;
      GV.speedNow = gspeed;
      // 龟速惩罚：砍完人 5 秒内不能冲刺
      if(GV.slowT > 0){ gspeed = cfgNum('鬼AI','砍人后速度',0.80); GV.slowT = Math.max(0, GV.slowT - dt); GV.stam = Math.min(1, GV.stam + dt); }
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
  if(HANG){
    HANG.group.visible = (!STARTED || PAUSED);      // 游玩时藏起来，别再出现在走廊里
    if(!STARTED || PAUSED) HANG.group.rotation.z = Math.sin(t*0.55)*0.016;
  }
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
    if(aim){
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
  BODY.root.visible = HIDE.on || (GV.on && (!HIDE.hidden || (CHECK.on && CHECK.victim)));
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
        hitPlayer();                              // 人类掉体力 + 屏幕红
        Sound.heart();
      }

      // —— ④ 原地擦刀 1.2 秒（1.05 ~ 2.20s），人还锁在柜子里 ——
      //      擦完再把人拽出来，这样有"被按住"的压迫感

      // —— ⑤ 把人拖出来（2.20s）——
      if(CHECK.victim && !CHECK.out && CHECK.t >= 2.20){
        CHECK.out = true;
        forceOutOfHide();                         // 人落到走廊，立刻能跑
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
  const bInt = stamina<0.3 ? 1.05 : (running ? 1.75 : 3.4);
  if(breathAcc > bInt){ breathAcc=0; Sound.breath(stamina<0.3); }
  if(stamina < 0.28){
    heartAcc += dt;
    if(heartAcc > 0.88){ heartAcc=0; Sound.heart(); }
  }
  eventAcc += dt;
  // 随机事件已关闭（只留电流滋滋 + 水滴，其余交给环境音调度）

  // —— 体力条 + 缺氧感 ——
  const _cur = GV.on ? (GV.stam===undefined?1:GV.stam) : stamina;
  const pct=Math.round(_cur*100);
  if(pct!==lastStamPct){
    stamFill.style.width=pct+'%';
    stamFill.classList.toggle('low', _cur<0.28);
    stamEl.classList.toggle('on', GV.on ? (_cur<0.995 || sprintHeld) : (sprintHeld||stamina<0.995));
    lastStamPct=pct;
  }
  // AI 鬼的体力条（玩家当人类时才显示）
  if(stamAIEl){
    const showAI = AI.ghostOn && !GV.on && STARTED;
    const gs = (GAI.stam===undefined) ? 1 : GAI.stam;
    stamAIEl.classList.toggle('on', showAI && (gs < 0.995 || GAI.state==='chase'));
    stamAIFill.style.width = Math.round(gs*100) + '%';
  }
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

let AI_CLOCK = 0;
function aiGhostStep(dt, speed){
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
function aiGhostUpdate(dt){
  if(!AI.ghostOn || GV.on || DEAD) return;
  if(GAI.lane === undefined){ GAI.lane = 0; GAI.homeLane = 0; GAI.hopY = 0; }
  AI_CLOCK += dt;

  // AI 鬼路过玻璃门：自己滑开，走远再关上（否则会被卡住）
  try{
    for(const gd of GLASS){
      const dg = Math.hypot(gd.x - ghost.position.x, gd.z - ghost.position.z);
      if(!gd.open && dg < 2.8){ toggleGlass(gd); }
      else if(gd.open && dg > 5.0){ toggleGlass(gd); }
    }
  }catch(e){}

  // 砍人之后的减速惩罚（人类蹲走速度，5 秒）
  if(GAI.slowT > 0) GAI.slowT = Math.max(0, GAI.slowT - dt);

  const px=player.x, pz=player.z;
  const distP = Math.hypot(px-ghost.position.x, pz-ghost.position.z);
  const canSee = !HIDE.hidden && distP < 13.0;

  if(GAI.state === 'wipe'){
    GAI.wipe += dt;
    aiBladeWipe();
    if(GAI.wipe > 2.4){
      GAI.state='patrol'; GAI.target=(GAI.d+14)%RING_LEN;
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
    const gfx = -Math.sin(ghost.rotation.y), gfz = -Math.cos(ghost.rotation.y);
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
    if(GAI.slowT > 0){
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
    // 看得见 / 离得近：直接扑向玩家真实位置（不再只在外圈绕）
    if(seeing || gdist < 9){
      aiGhostSeek(px, pz, gsp, dt);
    } else {
      aiGhostStep(dt, gsp);
    }
    if(distP < 1.6){
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
  const arrived = Math.abs(aiShortest(GAI.d, GAI.target)) < 0.6;
  aiGhostStep(dt, GAI.slowT > 0 ? 0.80 : 1.05);
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
    const p = atPath(d);
    person.root.position.set(p.x, 0, p.z);
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

  // 第一刀：断右臂 → 从门里滚出来 → 加速逃开一段
  if(h.person.arms && h.person.arms[1]) h.person.arms[1].sh.visible = false;
  h.state='flee'; h.hideDoor=null; h.timer=4.5; h.postHit=4.5;
  h.person.root.visible = true;
  const p = atPath(h.d);
  h.person.root.position.set(p.x, 0, p.z);
  h.target = (h.d + 30) % RING_LEN;
}
let _aiAcc = 0;
function aiHumansUpdate(dt){
  if(!GV.on) return;
  // 20Hz 更新就够：4 个人物每帧跑一次会把帧时间拉出毛刺
  _aiAcc += dt;
  if(_aiAcc < 0.05) return;
  const aiDt = _aiAcc; _aiAcc = 0;

  // AI 人类路过玻璃门：自己滑开，走远关上
  try{
    for(const h of AI.humans){
      if(h.state === 'hide' || h.state === 'dead') continue;
      const hp = h.person.root.position;
      for(const gd of GLASS){
        const dg = Math.hypot(gd.x - hp.x, gd.z - hp.z);
        if(!gd.open && dg < 2.6){ toggleGlass(gd); }
      }
    }
  }catch(e){}

  for(const h of AI.humans){
    if(h.state==='out' || h.state==='dead') continue;
    h.walk += dt;
    if(h.postHit>0) h.postHit = Math.max(0, h.postHit-dt);
    const distG = Math.hypot(h.person.root.position.x-GV.x, h.person.root.position.z-GV.z);

    if(h.state === 'hide'){
      h.timer -= aiDt;
      h.stam = Math.min(1, h.stam + aiDt/CFG.玩家.体力回复秒);   // 躲着回体力
      // 只有躲太久（12~20 秒）才会自己探头出来；鬼站门口不会把人吓出来
      if(h.timer <= 0){
        h.state='wander'; h.hideDoor=null; h.person.root.visible=true; h.timer=rr(3,6);
      }
      continue;
    }

    if(distG < cfgNum('人类AI','发现鬼距离',6) && h.state !== 'flee'){ h.state='flee'; h.timer=3; }
    if(h.state === 'flee'){ h.timer -= aiDt; if(h.timer<=0 || distG > cfgNum('人类AI','安全距离',13)){ h.state='wander'; h.timer=rr(2,5); } }

    // 疾跑受体力限制：最多 8 秒，耗完只能快走
    let sprinting = false;
    let speed = cfgNum('人类AI','走路速度',1.35);
    if(h.state === 'flee'){
      if(h.stam > 0.02){
        sprinting = true;
        speed = (h.postHit>0 ? cfgNum('人类AI','受伤冲刺速度',5.4) : cfgNum('人类AI','冲刺速度',5.05));
        h.stam = Math.max(0, h.stam - aiDt/CFG.玩家.疾跑上限秒);
      } else {
        speed = 1.45;
        h.stam = Math.min(1, h.stam + aiDt/CFG.玩家.体力回复秒);
      }
    } else {
      h.stam = Math.min(1, h.stam + aiDt/CFG.玩家.体力回复秒);
    }
    // 走门：靠近门 → 钻进去躲好
    if(h.state === 'toDoor'){
      const q = pathD(h.hideDoor.x, h.hideDoor.z);
      h.target = q;
      if(Math.abs(aiShortest(h.d, q)) < 0.9){
        h.state='hide'; h.timer=rr(cfgNum('人类AI','躲藏最短秒',12), cfgNum('人类AI','躲藏最长秒',20));
        const pp = atPath(q);
        h.person.root.visible=false;
        h.person.root.position.set(pp.x + pp.nx*0.55, 0, pp.z + pp.nz*0.55);
        continue;
      }
    }

    // 闲逛：时间到就找一扇门过去躲
    if(h.state === 'wander'){
      h.timer -= aiDt;
      if(h.timer <= 0){
        const dr = aiNearestDoor(h.d, 10.0);
        if(dr && Math.random() < 0.85){
          h.state='toDoor'; h.hideDoor=dr;
          h.target = pathD(dr.x, dr.z);
        } else {
          h.target = (h.d + rr(8,18)) % RING_LEN;
          h.timer = rr(3,6);
        }
      }
    }
    if(h.state === 'flee'){
      const gd = pathD(GV.x, GV.z);
      const away = aiShortest(gd, h.d);            // 鬼 → 人的方向
      const sgn = away >= 0 ? 1 : -1;              // 朝远离鬼的那头跑
      h.target = (h.d + sgn*26 + RING_LEN) % RING_LEN;
      // 顺手往另一侧车道挪，别和鬼挤在一条线上
      h.homeLane = (sgn > 0 ? -1 : 1) * (0.45 + Math.random()*0.35);
    }

    const diff = aiShortest(h.d, h.target);
    const r = aiStepPath(h, speed, aiDt);
    const step = r.moved || 0;
    if(r.moved){
      h.person.root.position.set(r.x, r.y || 0, r.z);
      const p = atPath(h.d);
      h.person.root.rotation.y = Math.atan2(p.dx*Math.sign(step||1), p.dz*Math.sign(step||1));
    }
    // 走路动画：脚步频率随速度变，跑起来幅度更大
    const walkSpeed = Math.abs(step)/Math.max(1e-3, aiDt);
    h.walkAnim = (h.walkAnim||0) + aiDt * (3.2 + walkSpeed*2.6);
    if(h.person.update) h.person.update(h.walkAnim, walkSpeed/1.4, walkSpeed>2.4);
    if(Math.abs(diff) < 0.6 && h.state==='wander'){ h.target=(h.d+rr(8,18))%RING_LEN; h.timer=rr(2,5); }
  }
}

let GHOST_WON = false;
function checkGhostVictory(){
  if(GHOST_WON || AI.role !== 'ghost' || !AI.humans.length) return;
  const alive = AI.humans.filter(function(h){ return h.state!=='out' && h.state!=='dead'; });
  if(alive.length > 0) return;
  GHOST_WON = true;
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
  aiGhostUpdate(dt);
  aiHumansUpdate(dt);
  checkGhostVictory();
}

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
  try{
    if(renderer.compile) renderer.compile(scene, camera);
    renderer.render(scene, camera);
  }catch(e){ window.__pwErr2 = e.message; }
}
// 主菜单出来以后，趁玩家看菜单时把这活儿干完
setTimeout(function(){
  try{ requestAnimationFrame(function(){ requestAnimationFrame(prewarmWorld); }); }catch(e){ prewarmWorld(); }
}, 700);
