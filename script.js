let video;
let prevPixels; 
let motionThreshold = 40; // 手机上稍微灵敏一点
let totalMotion = 0; 

let synth, filter, distortion, reverb;
let isStarted = false;

function setup() {
  // 不再根据容器大小创建 Canvas，而是固定一个小分辨率以保证性能
  // 手机性能有限，320x240 是平衡点
  let cnv = createCanvas(320, 240); 
  cnv.parent('visual-container');
  
  // 强制像素密度为 1，这对于 Retina 屏幕的手机至关重要，否则会非常卡
  pixelDensity(1); 
  
  // --- 摄像头配置 (移动端核心修改) ---
  let constraints = {
    video: {
      facingMode: "user", // 优先使用前置摄像头
      width: { ideal: 320 },
      height: { ideal: 240 }
    },
    audio: false
  };

  video = createCapture(constraints);
  video.size(320, 240);
  video.hide();
  
  // 【关键】兼容 iOS Safari，防止视频自动全屏
  video.elt.setAttribute('playsinline', '');

  // UI 事件
  // 使用 touchstart 以获得更快的移动端响应，但 click 兼容性更好
  let startBtn = document.getElementById('start-btn');
  startBtn.addEventListener('click', async () => {
    await Tone.start(); // 必须由用户手势触发
    setupAudio();
    isStarted = true;
    document.getElementById('overlay').style.display = 'none';
  });

  bindControls();
}

function draw() {
  background(0);

  if (!isStarted) {
    fill(255); noStroke();
    textAlign(CENTER);
    textSize(16);
    text("等待启动...", width/2, height/2);
    return;
  }

  video.loadPixels();
  
  // 如果摄像头还没准备好，就跳过
  if (video.pixels.length === 0) return;

  if (!prevPixels) {
    prevPixels = new Uint8Array(video.pixels);
  }

  let motionCount = 0; 
  loadPixels(); 

  // 为了手机性能优化，步长设为 8 (降低检测精度，提高 FPS)
  // i += 4 (RGBA) * 2 (隔一个像素点测一次)
  let step = 8; 

  for (let y = 0; y < video.height; y += 2) {
    for (let x = 0; x < video.width; x += 2) {
      let i = (y * video.width + x) * 4;

      // 边界检查
      if (i >= video.pixels.length) continue;

      let r = video.pixels[i];
      let g = video.pixels[i + 1];
      let b = video.pixels[i + 2];

      let pr = prevPixels[i];
      let pg = prevPixels[i + 1];
      let pb = prevPixels[i + 2];

      let diff = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);

      // 为了视觉效果，我们还是需要填充像素
      // 但为了性能，我们画大一点的矩形，而不是操作像素数组？
      // 不，操作像素数组在低分辨率下其实比画几千个 rect 快。
      
      // 简化算法：只比较简单的亮度差，或者 RGB 距离
      if (diff > motionThreshold * 3) { // *3 是因为上面是简单的加法
        motionCount++;
        pixels[i] = 0;     pixels[i+1] = 255; 
        pixels[i+2] = 136; pixels[i+3] = 255;
        // 简单的“膨胀”效果，让动点看起来更粗，弥补隔行扫描的空隙
        pixels[i+4] = 0;   pixels[i+5] = 255;
      } else {
        pixels[i] = r * 0.2;
        pixels[i+1] = g * 0.2;
        pixels[i+2] = b * 0.2;
        pixels[i+3] = 255;
      }
    }
  }
  
  updatePixels(); 
  prevPixels.set(video.pixels); 
  
  // 放大动作数值以适应采样率的降低
  totalMotion = motionCount * 2; 
  updateAudioFromMotion(totalMotion);
  updateUI(totalMotion);
}

// --- 音频部分保持不变 ---
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

function updateAudioFromMotion(motionAmount) {
  if (!synth) return;

  // 手机摄像头噪点多，增加一点门限值
  if (motionAmount > 150) {
    let targetVol = map(motionAmount, 150, 3000, -20, 0, true);
    synth.volume.rampTo(targetVol, 0.1);

    let baseCutoff = parseFloat(document.getElementById('filter-cutoff').value);
    let modFreq = baseCutoff + map(motionAmount, 150, 3000, 0, 3000, true);
    filter.frequency.rampTo(modFreq, 0.1);
    
    let baseFreq = parseFloat(document.getElementById('base-freq').value);
    synth.frequency.rampTo(baseFreq + (motionAmount * 0.02), 0.1);

  } else {
    synth.volume.rampTo(-Infinity, 0.5);
  }
}

function updateUI(motion) {
  // 使用 requestAnimationFrame 节流 UI 更新（可选，为了流畅度暂不加复杂逻辑）
  let percent = map(motion, 0, 3000, 0, 100, true);
  document.getElementById('motion-value').style.width = percent + "%";
}

function bindControls() {
  // 移动端的 input 事件有时候会频繁触发，但 Tone.js 处理得过来
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