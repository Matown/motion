// --- 变量定义 ---
let video;
let prevPixels; 
let isMobile = false; // 是否为移动端
let w, h; // 动态分辨率

// 核心参数
let motionThreshold;  // 像素变色阈值 (越小越灵敏)
let triggerThreshold; // 触发声音的动作总量百分比
let scanStep;         // 扫描步长 (1=逐点, 2=隔行)

let synth, filter, distortion, reverb;
let isStarted = false;

function setup() {
  // 1. 智能设备检测
  // 如果屏幕宽度小于 800，我们认为是手机/平板，开启性能优化模式
  isMobile = window.innerWidth < 800;

  if (isMobile) {
    // [手机模式] 低分屏 + 隔行扫描 + 高容差(防抖)
    w = 320; 
    h = 240;
    scanStep = 2;       // 每隔一个像素测一次，性能提升4倍
    motionThreshold = 40; // 手机摄像头噪点多，阈值调高
    triggerThreshold = 0.005; // 动作占比超过 0.5% 触发
  } else {
    // [电脑模式] 高分屏 + 逐点扫描 + 高灵敏度
    w = 640; 
    h = 480;
    scanStep = 1;       // 每一个像素都测，极致丝滑
    motionThreshold = 25; // 电脑Webcam通常较清晰，阈值调低更灵敏
    triggerThreshold = 0.001; // 动作占比超过 0.1% 就触发 (非常灵敏)
  }

  // 2. 创建画布
  let cnv = createCanvas(w, h); 
  cnv.parent('visual-container');
  pixelDensity(1); // 统一像素密度，防止Retina屏计算量爆炸
  
  // 3. 摄像头配置
  let constraints = {
    video: {
      width: { ideal: w },
      height: { ideal: h },
      facingMode: "user"
    },
    audio: false
  };

  video = createCapture(constraints);
  video.size(w, h);
  video.hide();
  video.elt.setAttribute('playsinline', ''); // 兼容 iOS

  // 4. UI 绑定
  let startBtn = document.getElementById('start-btn');
  startBtn.addEventListener('click', async () => {
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

  video.loadPixels();
  if (video.pixels.length === 0) return;

  if (!prevPixels) {
    prevPixels = new Uint8Array(video.pixels);
  }

  let movedPixelsCount = 0; 
  let totalPixelsChecked = 0;

  loadPixels(); 

  // --- 动态扫描循环 ---
  // 根据 scanStep 决定是逐行还是隔行
  for (let y = 0; y < h; y += scanStep) {
    for (let x = 0; x < w; x += scanStep) {
      
      let i = (y * w + x) * 4;
      totalPixelsChecked++;

      // 快速获取 RGB
      let r = video.pixels[i];
      let g = video.pixels[i + 1];
      let b = video.pixels[i + 2];

      let pr = prevPixels[i];
      let pg = prevPixels[i + 1];
      let pb = prevPixels[i + 2];

      // 快速计算差异 (曼哈顿距离比欧氏距离快，适合实时计算)
      let diff = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);

      if (diff > motionThreshold * 3) { 
        movedPixelsCount++;
        
        // --- 视觉增强 ---
        // 电脑上画得细腻点，手机上画得明显点
        pixels[i] = 0;     // R
        pixels[i+1] = 255; // G (高亮绿)
        pixels[i+2] = 150; // B
        pixels[i+3] = 255; // A

        // 如果是手机(隔行扫描)，我们需要由于跳过了像素，
        // 为了视觉连续性，把旁边跳过的像素也填上颜色（视觉补偿）
        if (isMobile) {
          pixels[i+4] = 0; pixels[i+5] = 255; pixels[i+6] = 150; pixels[i+7] = 255;
        }

      } else {
        // 背景变暗，营造赛博感
        pixels[i] = r * 0.2;
        pixels[i+1] = g * 0.2;
        pixels[i+2] = b * 0.2;
        pixels[i+3] = 255;
      }
    }
  }
  
  updatePixels(); 
  prevPixels.set(video.pixels); 

  // --- 归一化算法 (解决分辨率差异的核心) ---
  // 无论分辨率多少，我们只看“动的像素占总检测像素的百分比”
  // motionRatio 范围 0.0 到 1.0
  let motionRatio = movedPixelsCount / totalPixelsChecked;

  // 使用指数曲线放大微小动作，让操作更跟手
  // 比如轻微挥手也能触发声音
  updateAudioFromMotion(motionRatio);
  updateUI(motionRatio);
}

// --- 音频逻辑 ---

function setupAudio() {
      // 1. 滤波器 (Lowpass)
      // 【修正】Tone.Filter 是静态效果器，不需要 .start()
      // 这里我们也修正了参数写法，使用对象传参更稳健
      filter = new Tone.Filter({
        frequency: 1000,
        type: "lowpass",
        rolloff: -12
      });

      // 2. 失真
      distortion = new Tone.Distortion(0.2);

      // 3. 混响
      // 生成混响脉冲可能需要一点时间，所以使用 generate() 并不是必须的，
      // 但直接实例化通常没问题。为了保险，我们简化参数。
      reverb = new Tone.Reverb({ decay: 3, wet: 0.3 }).toDestination();

      // 4. 合成器 (MonoSynth)
      synth = new Tone.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.8 },
        filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0, baseFrequency: 200, octaves: 2 }
      });

      // 连线: Synth -> Distortion -> Filter -> Reverb -> Speakers
      synth.chain(distortion, filter, reverb);

      // 启动一个持续的 Drone 音
      // 初始音量设为极低 (-Infinity db)
      synth.volume.value = -Infinity; 
      synth.triggerAttack("C2"); 
    }

function updateAudioFromMotion(ratio) {
  if (!synth) return;

  // 这里的映射逻辑改为基于百分比
  // 如果动作占比超过 triggerThreshold (比如 0.1%)
  if (ratio > triggerThreshold) {
    
    // 映射音量：从 -20dB 到 0dB
    // 动作越大，声音越响
    // input范围: triggerThreshold ~ 0.2 (假设动作最大占屏幕20%)
    let targetVol = map(ratio, triggerThreshold, 0.2, -20, 0, true);
    synth.volume.rampTo(targetVol, 0.1);

    // 映射滤波器 (Wah-Wah 效果)
    let baseCutoff = parseFloat(document.getElementById('filter-cutoff').value);
    let modFreq = baseCutoff + map(ratio, triggerThreshold, 0.3, 0, 4000, true);
    filter.frequency.rampTo(modFreq, 0.1);
    
    // 映射音高微调 (Detune)
    let baseFreq = parseFloat(document.getElementById('base-freq').value);
    synth.frequency.rampTo(baseFreq + (ratio * 100), 0.1);

  } else {
    // 没动作时快速静音
    synth.volume.rampTo(-Infinity, 0.2);
  }
}

function updateUI(ratio) {
  // UI显示也放大一下，方便观看
  let percent = map(ratio, 0, 0.1, 0, 100, true);
  document.getElementById('motion-value').style.width = percent + "%";
}

function bindControls() {
  document.getElementById('osc-type').addEventListener('change', (e) => {
    if(synth) synth.oscillator.type = e.target.value;
  });
  document.getElementById('base-freq').addEventListener('input', (e) => {
     if(synth) synth.frequency.rampTo(parseFloat(e.target.value), 0.1);
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

