let video;
let prevPixels;
let isStarted = false;

// 核心参数
let w = 320; // 强制使用低分辨率处理，保证性能
let h = 240; 
let threshold = 50; // 动作检测阈值

// 音频组件
let synth, filter, distortion, reverb;

// 调试函数
function log(msg) {
  console.log(msg);
  document.getElementById('debug-console').innerText = "状态: " + msg;
}

function setup() {
  // 1. 创建画布
  let cnv = createCanvas(w, h);
  cnv.parent('visual-container');
  pixelDensity(1); // 关键：强制 1倍像素密度，防止 Retine 屏数据错位

  log("画布创建成功，正在请求摄像头...");

  // 2. 摄像头配置 (最通用的写法)
  // 不指定分辨率，只要求是视频。
  // 注意：p5.js 的 createCapture 在部分移动端比较奇怪，我们用最原始的方式
  video = createCapture({
    audio: false,
    video: {
      facingMode: "user" // 优先前置
    }
  }, function() {
    log("摄像头已授权，等待数据...");
  });

  video.hide();
  video.elt.setAttribute('playsinline', ''); // iOS 必须

  // 3. 按钮事件
  document.getElementById('start-btn').addEventListener('click', async () => {
    try {
      log("正在启动音频引擎...");
      await Tone.start();
      setupAudio();
      isStarted = true;
      document.getElementById('overlay').style.display = 'none';
      log("运行中 - 请移动身体");
    } catch (e) {
      log("启动失败: " + e);
    }
  });

  bindControls();
}

function draw() {
  background(0);

  if (!isStarted) return;

  // --- 核心修复逻辑 ---
  // 1. 不管摄像头实际多大，强制把它画到 320x240 的画布上
  // 这会自动处理缩放，解决所有手机的黑屏/比例问题
  if (video.elt.readyState >= 2) { // 确保视频有数据
    image(video, 0, 0, w, h);
  } else {
    // 视频未就绪时显示提示
    fill(255); textAlign(CENTER);
    text("加载摄像头...", width/2, height/2);
    return;
  }

  // 2. 现在的 pixels[] 里面就是刚刚画上去的视频画面
  loadPixels();

  if (!prevPixels) {
    prevPixels = new Uint8Array(pixels);
    return; // 第一帧不处理
  }

  let motionCount = 0;
  // 3. 遍历画布像素 (步长为 4，兼顾性能)
  // 我们直接读取画布上的像素，这绝对不会出错
  for (let i = 0; i < pixels.length; i += 4 * 2) { // *2 是隔点扫描
    
    // 当前像素 RGB
    let r = pixels[i];
    let g = pixels[i+1];
    let b = pixels[i+2];

    // 上一帧 RGB
    let pr = prevPixels[i];
    let pg = prevPixels[i+1];
    let pb = prevPixels[i+2];

    // 计算差异
    let diff = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);

    if (diff > threshold) {
      motionCount++;
      // 视觉反馈：直接修改画布像素为绿色
      pixels[i] = 0;
      pixels[i+1] = 255;
      pixels[i+2] = 0;
    } else {
      // 没动的地方变暗 (残影效果)
      pixels[i] = r * 0.1;
      pixels[i+1] = g * 0.1;
      pixels[i+2] = b * 0.1;
    }
  }

  // 4. 更新显示
  updatePixels();

  // 5. 保存当前帧用于下次比较
  // 注意：我们保存的是刚刚处理过(变绿/变暗)的帧，这会产生有趣的“光流残影”效果
  // 如果想要纯粹的运动检测，应该在 loadPixels 后立刻 copy，但为了性能这样也很好看
  prevPixels.set(pixels);

  // 6. 触发音频
  let motionRatio = motionCount / (pixels.length / (4 * 2));
  updateAudio(motionRatio);
  
  // UI
  let barWidth = Math.min(motionRatio * 500, 100);
  document.getElementById('motion-value').style.width = barWidth + "%";
}

// --- 简化的音频逻辑 (保证有声) ---
function setupAudio() {
  // 移除 Limiter，使用最基础的连接方式，防止兼容性问题
  
  // 1. 混响
  reverb = new Tone.Reverb({ decay: 2, wet: 0.4 }).toDestination();
  
  // 2. 滤波器
  filter = new Tone.Filter(1000, "lowpass").connect(reverb);
  
  // 3. 失真
  distortion = new Tone.Distortion(0.4).connect(filter);
  
  // 4. 合成器
  synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.1, sustain: 1, release: 1 }
  }).connect(distortion);

  // 初始静音
  synth.volume.value = -Infinity;
  synth.triggerAttack("C3");
  
  log("音频引擎已就绪");
}

function updateAudio(ratio) {
  if (!synth) return;

  // 稍微灵敏一点的触发
  if (ratio > 0.01) {
    // 动作越大，音量越大 (最大 +5dB)
    let vol = map(ratio, 0.01, 0.2, -20, 5, true);
    synth.volume.rampTo(vol, 0.05);

    // 动作越大，滤波越开
    let cut = map(ratio, 0.01, 0.2, 200, 5000, true);
    filter.frequency.rampTo(cut, 0.05);
    
  } else {
    synth.volume.rampTo(-Infinity, 0.2);
  }
}

function bindControls() {
  document.getElementById('osc-type').addEventListener('change', (e) => {
    if(synth) synth.oscillator.type = e.target.value;
  });
  document.getElementById('filter-cutoff').addEventListener('input', (e) => {
    // 基础值可以在这里存一下，或者直接通过 motion 动态控制
  });
  document.getElementById('dist-amt').addEventListener('input', (e) => {
    if(distortion) distortion.distortion = parseFloat(e.target.value);
  });
}
