/**
 * AudioEngine - Web Audio API ベースの音声処理エンジン
 * EQ / Spatial Audio / レベルメーター / スペクトラムアナライザー
 */
class AudioEngine {
  constructor() {
    this.context = null;
    this.sourceNode = null;
    this.audioElement = null;

    // ノードチェーン
    this.gainNode = null;
    this.analyserLeft = null;
    this.analyserRight = null;
    this.analyserFull = null;
    this.splitter = null;
    this.merger = null;
    this.eqNodes = [];
    this.reverbNode = null;
    this.reverbGainNode = null;
    this.dryGainNode = null;
    this.compressorNode = null;

    // 状態
    this.isEQEnabled = true;
    this.isSpatialEnabled = false;
    this.currentSpeed = 1.0;
    this.currentVolume = 0.8;
    this.spatialMode = 'off';
    this._chainBuilt = false;

    // EQ設定 (5バンド: 60Hz, 250Hz, 1kHz, 4kHz, 16kHz)
    this.eqFrequencies = [60, 250, 1000, 4000, 16000];
    this.eqGains = [0, 0, 0, 0, 0];

    // リバーブ用IRバッファ
    this.reverbBuffers = {};

    // コールバック
    this.onTimeUpdate = null;
    this.onEnded = null;
    this.onLevelUpdate = null;
  }

  // ===================================
  // 初期化
  // ===================================
  async init() {
    // AudioContextはユーザー操作後に作成するため、遅延初期化
    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';

    // 動画用エレメント
    this.videoElement = document.createElement('video');
    this.videoElement.preload = 'auto';
    this.videoElement.style.display = 'none';
    document.body.appendChild(this.videoElement);

    // 現在アクティブなメディアエレメント
    this.activeElement = this.audioElement;
    this.isVideoMode = false;

    this._attachMediaEvents(this.audioElement);
    this._attachMediaEvents(this.videoElement);

    return this;
  }

  _attachMediaEvents(el) {
    el.addEventListener('timeupdate', () => {
      if (el !== this.activeElement) return;
      if (this.onTimeUpdate) {
        this.onTimeUpdate(el.currentTime, el.duration);
      }
    });

    el.addEventListener('ended', () => {
      if (el !== this.activeElement) return;
      if (this.onEnded) this.onEnded();
    });

    el.addEventListener('error', (e) => {
      if (el !== this.activeElement) return;
      console.error('Media element error:', e);
    });
  }

  // ===================================
  // AudioContext の遅延初期化 (ユーザー操作時に呼び出す)
  // ===================================
  async _ensureContext() {
    if (this.context && this.context.state !== 'closed') {
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
      return;
    }

    this.context = new (window.AudioContext || window.webkitAudioContext)();

    // audio と video 両方のソースノードをここで作成（各エレメント1回のみ許可）
    this.audioSourceNode = this.context.createMediaElementSource(this.audioElement);
    this.videoSourceNode = this.context.createMediaElementSource(this.videoElement);

    // 現在のアクティブなソースを設定
    this.sourceNode = this.isVideoMode ? this.videoSourceNode : this.audioSourceNode;

    // ゲインノード (音量)
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this.currentVolume;

    // 5バンドイコライザー
    this.eqNodes = this.eqFrequencies.map((freq, i) => {
      const filter = this.context.createBiquadFilter();
      if (i === 0) filter.type = 'lowshelf';
      else if (i === this.eqFrequencies.length - 1) filter.type = 'highshelf';
      else filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.0;
      filter.gain.value = this.eqGains[i];
      return filter;
    });

    // EQノードをチェーン接続
    this.eqNodes.reduce((prev, curr) => { prev.connect(curr); return curr; });

    // チャンネルスプリッター (L/R分離)
    this.splitter = this.context.createChannelSplitter(2);
    this.merger = this.context.createChannelMerger(2);

    // アナライザー (L / R / Full)
    this.analyserLeft = this.context.createAnalyser();
    this.analyserLeft.fftSize = 256;
    this.analyserLeft.smoothingTimeConstant = 0.7;

    this.analyserRight = this.context.createAnalyser();
    this.analyserRight.fftSize = 256;
    this.analyserRight.smoothingTimeConstant = 0.7;

    this.analyserFull = this.context.createAnalyser();
    this.analyserFull.fftSize = 1024;
    this.analyserFull.smoothingTimeConstant = 0.8;

    // ドライ/ウェット (Spatial Audio用)
    this.dryGainNode = this.context.createGain();
    this.dryGainNode.gain.value = 1.0;

    this.reverbGainNode = this.context.createGain();
    this.reverbGainNode.gain.value = 0.0;

    // リバーブコンボルバー
    this.reverbNode = this.context.createConvolver();

    // コンプレッサー
    this.compressorNode = this.context.createDynamicsCompressor();
    this.compressorNode.threshold.value = -24;
    this.compressorNode.knee.value = 30;
    this.compressorNode.ratio.value = 1;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.25;

    // ノード接続
    this._buildChain();

    // レベルメーター更新ループ
    this._startLevelMeter();

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // AudioContextがsuspendedになった場合に自動resumeする
    this.context.addEventListener('statechange', () => {
      if (this.context.state === 'suspended') {
        this.context.resume().catch(e => console.warn('Context resume failed:', e));
      }
    });

    // ページ非表示→再表示時にも確実にresumeする
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.context && this.context.state === 'suspended') {
        this.context.resume().catch(e => console.warn('Visibility resume failed:', e));
      }
    });
  }

  // ===================================
  // ノードチェーン構築
  // ===================================
  _buildChain() {
    if (!this.context || !this.sourceNode) return;

    // 再生中かどうか記録（activeElement を使う）
    const wasPlaying = this.isPlaying;
    const activeEl   = this.activeElement;

    // 既存の接続をすべて切断
    const nodes = [
      this.sourceNode, ...this.eqNodes,
      this.dryGainNode, this.reverbGainNode, this.reverbNode,
      this.compressorNode, this.gainNode, this.splitter,
      this.analyserLeft, this.analyserRight, this.merger
    ];
    nodes.forEach(n => { if (n) try { n.disconnect(); } catch(e) {} });

    // ソース → EQ (有効時) → ドライゲイン
    if (this.isEQEnabled && this.eqNodes.length > 0) {
      this.sourceNode.connect(this.eqNodes[0]);
      const lastEq = this.eqNodes[this.eqNodes.length - 1];
      lastEq.connect(this.dryGainNode);
    } else {
      this.sourceNode.connect(this.dryGainNode);
    }

    // Spatial Audio (有効時)
    if (this.isSpatialEnabled && this.reverbBuffers[this.spatialMode]) {
      this.reverbNode.buffer = this.reverbBuffers[this.spatialMode];
      this.dryGainNode.connect(this.compressorNode);
      this.dryGainNode.connect(this.reverbNode);
      this.reverbNode.connect(this.reverbGainNode);
      this.reverbGainNode.connect(this.compressorNode);
    } else {
      this.dryGainNode.connect(this.compressorNode);
    }

    // コンプレッサー → ゲイン → スプリッター & フルアナライザー
    this.compressorNode.connect(this.gainNode);
    this.gainNode.connect(this.splitter);
    this.gainNode.connect(this.analyserFull);

    // スプリッター → L/Rアナライザー → マージャー → 出力
    this.splitter.connect(this.analyserLeft, 0);
    this.splitter.connect(this.analyserRight, 1);
    this.analyserLeft.connect(this.merger, 0, 0);
    this.analyserRight.connect(this.merger, 0, 1);
    this.merger.connect(this.context.destination);

    // 再生中だった場合は activeElement で再開
    if (wasPlaying) {
      this.context.resume().then(() => {
        activeEl.play().catch(e => console.warn('Resume play failed:', e));
      }).catch(e => console.warn('Context resume in buildChain failed:', e));
    }
  }

  // ===================================
  // ファイルロード (音声・動画両対応)
  // ===================================
  static isVideoFile(filePath) {
    return /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(filePath);
  }

  async loadFile(filePath) {
    console.log('Loading file:', filePath);

    // 以前のメディアを停止
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.videoElement.pause();
    this.videoElement.currentTime = 0;

    // 動画 or 音声を判定してアクティブエレメントを切り替え
    const wasVideo = this.isVideoMode;
    this.isVideoMode = AudioEngine.isVideoFile(filePath);
    this.activeElement = this.isVideoMode ? this.videoElement : this.audioElement;

    // コンテキストが存在する場合はソースノードを切り替えてチェーン再構築
    // ※ コンテキストを閉じてはいけない（createMediaElementSource は1回のみ）
    if (this.context && this.audioSourceNode && this.videoSourceNode) {
      this.sourceNode = this.isVideoMode ? this.videoSourceNode : this.audioSourceNode;
      this._buildChain();
    }

    // file:// プロトコルでURLを設定
    const fileUrl = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    this.activeElement.src = fileUrl;
    this.activeElement.load();

    return new Promise((resolve) => {
      const onReady = () => {
        cleanup();
        console.log('File loaded successfully:', filePath);
        resolve();
      };
      const onError = (e) => {
        cleanup();
        console.error('File load error:', e, 'src:', this.activeElement.src);
        resolve();
      };
      const cleanup = () => {
        this.activeElement.removeEventListener('canplay', onReady);
        this.activeElement.removeEventListener('loadedmetadata', onReady);
        this.activeElement.removeEventListener('error', onError);
        clearTimeout(timer);
      };
      this.activeElement.addEventListener('canplay', onReady, { once: true });
      this.activeElement.addEventListener('loadedmetadata', onReady, { once: true });
      this.activeElement.addEventListener('error', onError, { once: true });
      const timer = setTimeout(() => {
        cleanup();
        console.warn('File load timeout:', filePath);
        resolve();
      }, 5000);
    });
  }

  // ===================================
  // 再生制御
  // ===================================
  async play() {
    await this._ensureContext();

    if (!this.activeElement.src || this.activeElement.src === window.location.href) {
      console.warn('No media source set');
      return;
    }

    try {
      await this.activeElement.play();
      console.log('Playback started');
    } catch(e) {
      console.error('Play error:', e);
    }
  }

  pause() {
    this.activeElement.pause();
  }

  stop() {
    this.activeElement.pause();
    this.activeElement.currentTime = 0;
  }

  get isPlaying() {
    return this.activeElement
      ? !this.activeElement.paused && !this.activeElement.ended && this.activeElement.readyState > 2
      : false;
  }

  get currentTime() { return this.activeElement ? this.activeElement.currentTime : 0; }
  get duration()    { return this.activeElement ? (this.activeElement.duration || 0) : 0; }

  seek(time) {
    const t = Math.max(0, Math.min(time, this.duration));
    this.activeElement.currentTime = t;
  }

  rewind(seconds = 10)  { this.seek(this.currentTime - seconds); }
  forward(seconds = 10) { this.seek(this.currentTime + seconds); }

  // ===================================
  // 音量・速度
  // ===================================
  setVolume(value) {
    this.currentVolume = Math.max(0, Math.min(1, value));
    if (this.gainNode) this.gainNode.gain.value = this.currentVolume;
    this.audioElement.volume = this.currentVolume;
    this.videoElement.volume = this.currentVolume;
  }

  setSpeed(speed) {
    this.currentSpeed = Math.max(0.1, Math.min(4.0, speed));
    this.activeElement.playbackRate = this.currentSpeed;
  }

  // ===================================
  // イコライザー
  // ===================================
  setEQEnabled(enabled) {
    this.isEQEnabled = enabled;
    if (this.context) this._buildChain();
  }

  setEQGain(bandIndex, gainDb) {
    this.eqGains[bandIndex] = gainDb;
    if (this.eqNodes[bandIndex]) {
      this.eqNodes[bandIndex].gain.value = gainDb;
    }
  }

  applyEQPreset(preset) {
    const presets = {
      flat:      [0,    0,    0,    0,    0   ],
      rock:      [5,    3,   -1,    3,    5   ],
      pop:       [-1,   3,    5,    3,   -1   ],
      jazz:      [4,    2,   -2,    2,    4   ],
      classical: [5,    2,   -2,    2,    5   ],
      voice:     [-2,  -1,    5,    4,    1   ],
      bass:      [8,    5,    0,   -2,   -3   ],
      heavymetal:[8,    5,   -2,    6,    8   ],
    };

    const gains = presets[preset] || presets.flat;
    gains.forEach((gain, i) => {
      this.setEQGain(i, gain);
    });
    this.eqGains = [...gains];
    return gains;
  }

  // ===================================
  // Spatial Audio (リバーブ)
  // ===================================
  async setSpatialEnabled(enabled) {
    this.isSpatialEnabled = enabled;
    if (enabled && this.spatialMode !== 'off') {
      await this._ensureReverbBuffer(this.spatialMode);
    }
    if (this.context) this._buildChain();
  }

  async setSpatialMode(mode) {
    this.spatialMode = mode;
    if (mode === 'off') {
      this.isSpatialEnabled = false;
      if (this.context) this._buildChain();
      return;
    }
    this.isSpatialEnabled = true;
    await this._ensureReverbBuffer(mode);
    if (this.context) this._buildChain();
  }

  setReverbAmount(amount) { // 0-1
    if (this.reverbGainNode) this.reverbGainNode.gain.value = amount;
    if (this.dryGainNode) this.dryGainNode.gain.value = 1.0 - amount * 0.4;
  }

  setCompressorAmount(amount) { // 0-1
    if (this.compressorNode) {
      this.compressorNode.ratio.value = 1 + amount * 19;
      this.compressorNode.threshold.value = -24 - amount * 20;
    }
  }

  // リバーブ用インパルス応答バッファを合成生成
  async _ensureReverbBuffer(mode) {
    if (!this.context) return;
    if (this.reverbBuffers[mode]) return;

    const params = {
      concert:  { duration: 3.5, decay: 3.0 },
      theater:  { duration: 2.5, decay: 2.0 },
      room:     { duration: 1.2, decay: 1.0 },
      studio:   { duration: 0.5, decay: 0.4 },
      outdoor:  { duration: 4.0, decay: 3.5 },
    };

    const p = params[mode] || params.room;
    const sampleRate = this.context.sampleRate;
    const length = sampleRate * p.duration;
    const impulse = this.context.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / p.duration, p.decay);
        if (i < sampleRate * 0.05) {
          data[i] += (Math.random() * 2 - 1) * 0.3 * Math.pow(1 - i / (sampleRate * 0.05), 2);
        }
      }
    }

    this.reverbBuffers[mode] = impulse;
  }

  // ===================================
  // レベルメーター
  // ===================================
  _startLevelMeter() {
    const dataL = new Uint8Array(this.analyserLeft.fftSize);
    const dataR = new Uint8Array(this.analyserRight.fftSize);

    const update = () => {
      requestAnimationFrame(update);
      if (!this.onLevelUpdate || !this.analyserLeft) return;

      this.analyserLeft.getByteTimeDomainData(dataL);
      this.analyserRight.getByteTimeDomainData(dataR);

      let sumL = 0, sumR = 0;
      for (let i = 0; i < dataL.length; i++) {
        const vL = (dataL[i] - 128) / 128;
        const vR = (dataR[i] - 128) / 128;
        sumL += vL * vL;
        sumR += vR * vR;
      }

      const rmsL = Math.sqrt(sumL / dataL.length);
      const rmsR = Math.sqrt(sumR / dataR.length);

      const dbL = rmsL > 0 ? 20 * Math.log10(rmsL) : -100;
      const dbR = rmsR > 0 ? 20 * Math.log10(rmsR) : -100;

      const normL = Math.max(0, Math.min(1, (dbL + 60) / 60));
      const normR = Math.max(0, Math.min(1, (dbR + 60) / 60));

      this.onLevelUpdate(normL, normR);
    };

    requestAnimationFrame(update);
  }

  // ===================================
  // スペクトラムアナライザー データ取得
  // ===================================
  getSpectrumData() {
    if (!this.analyserFull) return new Uint8Array(512);
    const bufferLength = this.analyserFull.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyserFull.getByteFrequencyData(dataArray);
    return dataArray;
  }

  // ===================================
  // クリーンアップ
  // ===================================
  dispose() {
    this.stop();
    if (this.context) this.context.close();
  }
}

window.AudioEngine = AudioEngine;
