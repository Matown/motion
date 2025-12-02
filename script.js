let video;
let prevPixels; 
let synth, filter, distortion, reverb;
let isStarted = false;

// 分辨率变量
let captureW, captureH;
let maxPixelChange = 0; 

// 调试日志（仅在出错时显示，保持界面干净）
function logError(msg) {
  console.log(msg);
  // 如果你想在手机屏幕看到报错，取消下面注释
  // alert("System Info: " + msg); 
}

function setup() {
  // --- 1. 智能判断：恢复电脑端的高画质 ---
  if (window.innerWidth > 800) {
    // 电脑端：保持原有的清晰度
    captureW = 640;
    captureH = 480;
  } else {
    // 手机端：使用低分辨率以防崩溃/发烫
    captureW = 320;
    captureH = 240;
  }

  // 更新左上角分辨率显示
  let infoEl = document.getElementById('res-info');
  if(infoEl) infoEl.innerText = `${captureW}x${captureH}`;

  // --- 2. 创建画布 ---
  let cnv = createCanvas(captureW, captureH); 
  cnv.parent('visual-container');
  pixelDensity(1); // 关键性能设置

  // --- 3. 视频初始化 ---
  // 不预设 width/height，先让浏览器请求权限
  let constraints = {
    audio: false,
    video: {
      facingMode: "user"
    }
  };

  video = createCapture(constraints, function(stream) {
    console.log("Camera started");
  });
  
  // 关键兼容设置
  video.elt.setAttribute('playsinline', ''); 
  // 强制将视频源缩放到我们需要的大小
  // 这一步确保了无论手机真实摄像头是多少像素，p5读到的都是我们设定的大小
  video.size(captureW, captureH); 
  video.hide();

  // --- 4. 计算阈值 ---
  maxPixelChange = (captureW * captureH) * 0.15; 

  // --- 5. 绑定启动 ---
  document.getElementById('start-btn').addEventListener('click', async () => {
    try {
      await Tone.start(); 
      setupAudio();
      isStarted = true;
      document.getElementById('overlay').style.display = 'none';
      
      // iOS 强制播放保险
      if (video && video.elt) {
        video.elt.play().catch(e => console.log(e));
      }
    } catch (e) {
      logError("Start Error: " + e);
    }
  });

  bindControls();
}

function draw() {
  background(0);

  if (!isStarted) return;
  
  // 等待视频加载
  if (video.width === 0 || video.height === 0) {
    // 简单的加载提示
    return;
  }

  // --- 核心安全区 ---
  try {
    video.loadPixels();
    
    // 如果视频数据还没准备好，直接跳过
    if (video.pixels.length === 0) return;

    if (!prevPixels) {
      prevPixels = new Uint8Array(video.pixels);
    }

    let motionCount = 0;
    loadPixels(); // 准备绘制画布

    // 动态步长：电脑端跳过一点点以优化性能，手机端逐点或跳点均可
    // 电脑 640 -> step 2
    // 手机 320 -> step 1 或 2 均可，这里用 2 保证绝对流畅
    let step = 2; 

    // 使用我们设定的 captureW/H 进行循环
    for (let y = 0; y < captureH; y += step) {
      for (let x = 0; x < captureW; x += step) {
        let i = (y * captureW + x) * 4;

        // --- 防崩溃保护锁 ---
        // 手机摄像头有时会在初始化瞬间返回错误的数组长度
        // 如果索引超出了实际视频数据的长度，立刻跳过，防止白屏/卡死
        if (i + 3 >= video.pixels.length) continue;
        if (i + 3 >= prevPixels.length) continue;

        let r = video.pixels[i];
        let g = video.pixels[i + 1];
        let b = video.pixels[i + 2];

        let pr = prevPixels[i];
        let pg = prevPixels[i + 1];
        let pb = prevPixels[i + 2];

        let diff = dist(r, g, b, pr, pg, pb);

        if (diff > 50) {
          motionCount++;
          // 视觉反馈
          pixels[i] = 0; pixels[i+1] = 255; pixels[i+2] = 136; pixels[i+3] = 255;
        } else {
          pixels[i] = r * 0.2; pixels[i+1] = g * 0.2; pixels[i+2] = b * 0.2; pixels[i+3] = 255;
        }
      }
    }
    
    updatePixels(); 
    
    // 更新上一帧 (加入长度检查)
    if (prevPixels.length === video.pixels.length) {
      prevPixels.set(video.pixels); 
    } else {
      // 如果发生罕见的分辨率突变，重置数组
      prevPixels = new Uint8Array(video.pixels);
    }
    
    // 归一化并驱动声音
    let realMotion = motionCount * (step * step);
    updateAudioFromMotion(realMotion);
    updateUI(realMotion);

  } catch (err) {
    console.error("Draw loop error:", err);
    // 即使出错也不要 alert，避免弹窗卡死手机
  }
}

// --- 以下音频和UI逻辑与之前完全一致，保持不变 ---

function setupAudio() {
  filter = new Tone.Filter({ frequency: 1000, type: "lowpass", rolloff: -12 });
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

function updateAudioFromMotion(motionAmt) {
  if (!synth) return;
  // 阈值重新计算
  let noiseFloor = (captureW * captureH) * 0.001; 

  if (motionAmt > noiseFloor) {
    let targetVol = map(motionAmt, noiseFloor, maxPixelChange, -20, 0, true);
    synth.volume.rampTo(targetVol, 0.1);

    let baseCutoff = parseFloat(document.getElementById('filter-cutoff').value);
    let modFreq = baseCutoff + map(motionAmt, noiseFloor, maxPixelChange, 0, 4000, true);
    filter.frequency.rampTo(modFreq, 0.1);
    
    let baseFreq = parseFloat(document.getElementById('base-freq').value);
    let detune = map(motionAmt, noiseFloor, maxPixelChange, 0, 20, true);
    synth.frequency.rampTo(baseFreq + detune, 0.1);
  } else {
    synth.volume.rampTo(-Infinity, 0.2);
  }
}

function updateUI(motionAmt) {
  let percentage = map(motionAmt, 0, maxPixelChange, 0, 100, true);
  let elVal = document.getElementById('motion-value');
  let elText = document.getElementById('motion-text');
  if(elVal) elVal.style.width = percentage + "%";
  if(elText) elText.innerText = Math.round(percentage);
}

function bindControls() {
  let el;
  el = document.getElementById('osc-type'); if(el) el.addEventListener('change', (e) => { if(synth) synth.oscillator.type = e.target.value; });
  el = document.getElementById('base-freq'); if(el) el.addEventListener('input', (e) => { if(synth) synth.frequency.rampTo(parseFloat(e.target.value), 0.1); });
  el = document.getElementById('filter-res'); if(el) el.addEventListener('input', (e) => { if(filter) filter.Q.value = parseFloat(e.target.value); });
  el = document.getElementById('dist-amt'); if(el) el.addEventListener('input', (e) => { if(distortion) distortion.distortion = parseFloat(e.target.value); });
  el = document.getElementById('reverb-wet'); if(el) el.addEventListener('input', (e) => { if(reverb) reverb.wet.value = parseFloat(e.target.value); });
}
