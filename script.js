let video;
let prevPixels; 
let synth, filter, distortion, reverb;
let isStarted = false;

// 动态分辨率设置
let captureW, captureH;
let maxPixelChange = 0; 

// --- P5.js 初始化 ---
function setup() {
  // 1. 智能判断设备分辨率
  if (window.innerWidth > 800) {
    captureW = 640;
    captureH = 480;
  } else {
    captureW = 320;
    captureH = 240;
  }

  // 显示当前分辨率
  document.getElementById('res-info').innerText = `${captureW}x${captureH}`;

  // 2. 创建画布
  let cnv = createCanvas(captureW, captureH); 
  cnv.parent('visual-container');
  
  // 3. 视频捕获配置
  video = createCapture({
    audio: false,
    video: {
      facingMode: "user", 
      width: captureW,
      height: captureH
    }
  });
  video.elt.setAttribute('playsinline', ''); // iOS 兼容
  video.size(captureW, captureH);
  video.hide();
  
  pixelDensity(1); 

  // 4. 计算触发阈值 (总像素的 15%)
  maxPixelChange = (captureW * captureH) * 0.15; 

  // 绑定启动按钮
  document.getElementById('start-btn').addEventListener('click', async () => {
    await Tone.start(); 
    setupAudio();
    isStarted = true;
    document.getElementById('overlay').style.display = 'none';
  });

  // 绑定 UI 控件
  bindControls();
}

// --- P5.js 渲染循环 ---
function draw() {
  background(0);

  if (!isStarted) return;
  if (video.width === 0 || video.height === 0) return;

  video.loadPixels();
  
  if (!prevPixels) {
    prevPixels = new Uint8Array(video.pixels);
  }

  let motionCount = 0;
  loadPixels(); 

  // 动态采样步长
  let step = captureW > 400 ? 2 : 1; 

  // 帧差法核心循环
  for (let y = 0; y < captureH; y += step) {
    for (let x = 0; x < captureW; x += step) {
      let i = (y * video.width + x) * 4;

      let r = video.pixels[i];
      let g = video.pixels[i + 1];
      let b = video.pixels[i + 2];

      let pr = prevPixels[i];
      let pg = prevPixels[i + 1];
      let pb = prevPixels[i + 2];

      let diff = dist(r, g, b, pr, pg, pb);

      if (diff > 50) {
        motionCount++;
        // 视觉高亮 (绿色)
        pixels[i] = 0; pixels[i+1] = 255; pixels[i+2] = 136; pixels[i+3] = 255;
      } else {
        // 背景变暗
        pixels[i] = r * 0.2; pixels[i+1] = g * 0.2; pixels[i+2] = b * 0.2; pixels[i+3] = 255;
      }
    }
  }
  
  updatePixels(); 
  prevPixels.set(video.pixels); 
  
  // 归一化动作值
  let realMotion = motionCount * (step * step);

  // 驱动音频和 UI
  updateAudioFromMotion(realMotion);
  updateUI(realMotion);
}

// --- Tone.js 音频设置 ---
function setupAudio() {
  filter = new Tone.Filter({
    frequency: 1000,
    type: "lowpass",
    rolloff: -12
  });

  distortion = new Tone.Distortion(0.2);
  reverb = new Tone.Reverb({ decay: 3, wet: 0.3 }).toDestination();

  synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.8 },
    filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0, baseFrequency: 200, octaves: 2 }
  });

  synth.chain(distortion, filter, reverb);
  synth.volume.value = -Infinity; 
  synth.triggerAttack("C2"); 
}

// --- 音频映射逻辑 ---
function updateAudioFromMotion(motionAmt) {
  if (!synth) return;
  
  let noiseFloor = (captureW * captureH) * 0.001; // 0.1% 底噪过滤

  if (motionAmt > noiseFloor) {
    // 音量映射
    let targetVol = map(motionAmt, noiseFloor, maxPixelChange, -20, 0, true);
    synth.volume.rampTo(targetVol, 0.1);

    // 滤波器映射
    let baseCutoff = parseFloat(document.getElementById('filter-cutoff').value);
    let modFreq = baseCutoff + map(motionAmt, noiseFloor, maxPixelChange, 0, 4000, true);
    filter.frequency.rampTo(modFreq, 0.1);
    
    // 音高微调
    let baseFreq = parseFloat(document.getElementById('base-freq').value);
    let detune = map(motionAmt, noiseFloor, maxPixelChange, 0, 20, true);
    synth.frequency.rampTo(baseFreq + detune, 0.1);

  } else {
    synth.volume.rampTo(-Infinity, 0.2);
  }
}

// --- UI 更新 ---
function updateUI(motionAmt) {
  let percentage = map(motionAmt, 0, maxPixelChange, 0, 100, true);
  document.getElementById('motion-value').style.width = percentage + "%";
  document.getElementById('motion-text').innerText = Math.round(percentage);
}

// --- 控件事件绑定 ---
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