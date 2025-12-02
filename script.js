// --- 变量定义 ---
let video;
let prevPixels; 
let isMobile = false; 
let w, h; 
let scanStep;
let motionThreshold;  

let synth, filter, distortion, reverb, limiter;
let isStarted = false;

function setup() {
  // 1. 设备检测与参数配置
  isMobile = window.innerWidth < 800;

  if (isMobile) {
    // 手机: 320x240, 隔行扫描
    w = 320; h = 240;
    scanStep = 2;       
    motionThreshold = 50; 
  } else {
    // 电脑: 640x480, 逐点扫描
    w = 640; h = 480;
    scanStep = 1;       
    motionThreshold = 30; 
  }

  // 2. 创建画布
  let cnv = createCanvas(w, h); 
  cnv.parent('visual-container');
  pixelDensity(1); 

  // 3. 摄像头配置 (修复手机黑屏问题的核心)
  let constraints;
  if (isMobile) {
    // 【手机端高兼容写法】
    // 不再指定分辨率，只要求前置摄像头。
    // 分辨率由下方的 video.size() 强制缩放。
    constraints = {
      audio: false,
      video: {
        facingMode: "user"
      }
    };
  } else {
    // 电脑端直接调用默认
    constraints = VIDEO;
  }

  video = createCapture(constraints, function(stream) {
    // 摄像头成功回调 (调试用)
    console.log("Camera started");
  });
  
  // 强制缩放视频流到我们需要的大小
  video.size(w, h);
  video.hide();
  video.elt.setAttribute('playsinline', ''); 

  // 4. UI 绑定
  let startBtn = document.getElementById('start-btn');
  startBtn.addEventListener('click', async () => {
    // 必须由用户手势触发 AudioContext
    await Tone.start();
    setupAudio();
    isStarted = true;
    document.getElementById('overlay').style.display = 'none';
  });

  bindControls();
}

function draw() {
  background(0);

  if (!isStarted) {
    fill(255); noStroke(); textAlign(CENTER); textSize(16);
    text("等待启动...", width/2, height/2);
    return;
  }

  // 确保视频已加载
  if (video.loadedmetadata === false) return;
  
  video.loadPixels();
  if (video.pixels.length === 0) return;

  if (!prevPixels) {
    prevPixels = new Uint8Array(video.pixels);
  }

  let movedPixelsCount = 0; 
  let totalPixelsChecked = 0;

  loadPixels(); 

  // 扫描逻辑
  for (let y = 0; y < h; y += scanStep) {
    for (let x = 0; x < w; x += scanStep) {
      
      let i = (y * w + x) * 4;
      totalPixelsChecked++;

      let r = video.pixels[i];
      let g = video.pixels[i + 1];
      let b = video.pixels[i + 2];

      let pr = prevPixels[i];
      let pg = prevPixels[i + 1];
      let pb = prevPixels[i + 2];

      // 简化的颜色距离计算
      let diff = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);

      if (diff > motionThreshold * 3) { 
        movedPixelsCount++;
        
        // 视觉反馈：绿色高亮
        pixels[i] = 0; pixels[i+1] = 255; pixels[i+2] = 100; pixels[i+3] = 255;

        // 手机端视觉补偿 (填补隔行扫描的空隙)
        if (isMobile) {
          pixels[i+4] = 0; pixels[i+5] = 255; pixels[i+6] = 100; pixels[i+7] = 255;
        }

      } else {
        // 变暗
        pixels[i] = r * 0.2; pixels[i+1] = g * 0.2; pixels[i+2] = b * 0.2; pixels[i+3] = 255;
      }
    }
  }
  
  updatePixels(); 
  prevPixels.set(video.pixels); 

  // 计算动作百分比 (0.0 - 1.0)
  let motionRatio = movedPixelsCount / totalPixelsChecked;
  
  // 更新音频与UI
  updateAudioFromMotion(motionRatio);
  updateUI(motionRatio);
}

// --- 音频增强版 ---

function setupAudio() {
  // 1. 限制器 (Limiter): 放在最后，防止爆音，允许我们在前面把音量推大
  limiter = new Tone.Limiter(0).toDestination();

  // 2. 混响
  reverb = new Tone.Reverb({ decay: 2, wet: 0.4 }).connect(limiter);

  // 3. 滤波器
  filter = new Tone.Filter({
    frequency: 500,
    type: "lowpass",
    rolloff: -24 // 更陡峭的切除，共振时声音更锋利
  }).connect(reverb);

  // 4. 失真
  distortion = new Tone.Distortion(0.4).connect(filter);

  // 5. 合成器 (Volume Boosted)
  synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" }, // 锯齿波本身最响亮
    envelope: { 
      attack: 0.05, 
      decay: 0.2, 
      sustain: 1.0, // 【关键】设为1.0，只要有动作，声音就是满音量，不衰减
      release: 1 
    },
    filterEnvelope: { 
      attack: 0.01, 
      decay: 0.1, 
      sustain: 0.5, 
      baseFrequency: 200, 
      octaves: 3 
    }
  }).connect(distortion);

  // 初始化音量为静音
  synth.volume.value = -Infinity; 
  // 触发一个持续的长音
  synth.triggerAttack("C2"); 
}

function updateAudioFromMotion(ratio) {
  if (!synth) return;

  // 设定触发门槛 (手机上可以设低一点)
  let threshold = isMobile ? 0.005 : 0.001; 

  if (ratio > threshold) {
    // 【音量增强逻辑】
    // map的输出范围从 0 改为 +6 (分贝)。
    // 之前是 -20 到 0。现在 +6dB 意味着音量翻倍。
    // 有限制器保护，不会炸麦。
    // input max 设为 0.15，意味着不需要很剧烈的动作就能达到最大音量
    let targetVol = map(ratio, threshold, 0.15, -10, 6, true);
    synth.volume.rampTo(targetVol, 0.05); // 响应更快

    // 【滤波器增强逻辑】
    // 动作越大，滤波器开得越大。加上 5000Hz 的范围，声音会变得很亮、很炸。
    let baseCutoff = parseFloat(document.getElementById('filter-cutoff').value);
    let modFreq = baseCutoff + map(ratio, threshold, 0.3, 0, 6000, true);
    filter.frequency.rampTo(modFreq, 0.05);
    
    // 音高微调
    let baseFreq = parseFloat(document.getElementById('base-freq').value);
    synth.frequency.rampTo(baseFreq + (ratio * 50), 0.1);

  } else {
    // 快速静音
    synth.volume.rampTo(-Infinity, 0.2);
  }
}

function updateUI(ratio) {
  // 放大 UI 显示，让微小的动作也能看出来
  let percent = map(ratio, 0, 0.1, 0, 100, true);
  document.getElementById('motion-value').style.width = percent + "%";
}

function bindControls() {
  document.getElementById('osc-type').addEventListener('change', (e) => {
    if(synth) synth.oscillator.type = e.target.value;
  });
  document.getElementById('base-freq').addEventListener('input', (e) => {
     // 实时反馈
  });
  document.getElementById('filter-res').addEventListener('input', (e) => {
    if(filter) filter.Q.value = parseFloat(e.target.value);
  });
  document.getElementById('dist-amt').addEventListener('input', (e) => {
    if(distortion) distortion.distortion = parseFloat(e.target.value);
  });
  document.getElementById('reverb-wet').addEventListener('input', (e) => {
    if(reverb) reverb.wet.value = parseFloat(e.target.value);
  });
}
