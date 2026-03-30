/**
 * renderer.js - メインUIロジック
 * プレイリスト / Drag&Drop / 再生制御 / EQ / Spatial / レベルメーター / ビジュアライザー
 */

// ===================================
// グローバル状態
// ===================================
let engine = null;
let playlist = [];
let currentIndex = -1;
// repeatMode: 0=OFF, 1=1曲リピート, 2=全曲ループ
let repeatMode = 0;
let isShuffle = false;
let isSeeking = false;
const SEG_COUNT = 30; // レベルメーターのセグメント数

// ===================================
// プレイリスト保存管理 (localStorage)
// ===================================
const STORAGE_KEY = 'musicplayer_saved_playlists';

function loadSavedPlaylists() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch(e) { return []; }
}

function savePlaylistsToStorage(lists) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
}

// ===================================
// DOM参照 (DOMContentLoaded後に設定)
// ===================================
const $ = id => document.getElementById(id);
let dom = {};

// ===================================
// 初期化
// ===================================
async function init() {
  // DOM参照を設定
  dom = {
    btnClose:       $('btn-close'),
    btnMinimize:    $('btn-minimize'),
    btnMaximize:    $('btn-maximize'),
    dropZone:       $('drop-zone'),
    playlist:       $('playlist'),
    trackCount:     $('track-count'),
    btnClear:       $('btn-clear-playlist'),
    btnShuffleL:    $('btn-shuffle'),
    coverArt:       $('cover-art'),
    coverBlur:      $('cover-blur'),
    coverWrapper:   $('cover-wrapper'),
    coverPlaceholder: $('cover-placeholder'),
    trackTitle:     $('track-title'),
    trackArtist:    $('track-artist'),
    trackAlbum:     $('track-album'),
    trackGenre:     $('track-genre'),
    trackYear:      $('track-year'),
    segLeft:        $('seg-left'),
    segRight:       $('seg-right'),
    seekBar:        $('seek-bar'),
    seekProgress:   $('seek-bar-progress'),
    seekBarBg:      $('seek-bar-bg'),
    currentTime:    $('current-time'),
    totalTime:      $('total-time'),
    btnPlay:        $('btn-play'),
    iconPlay:       document.querySelector('.icon-play'),
    iconPause:      document.querySelector('.icon-pause'),
    btnPrev:        $('btn-prev'),
    btnNext:        $('btn-next'),
    btnRewind:      $('btn-rewind'),
    btnForward:     $('btn-forward'),
    btnRepeat:      $('btn-repeat'),
    btnShuffleC:    $('btn-shuffle-ctrl'),
    speedInput:     $('speed-input'),
    btnApplySpeed:  $('btn-apply-speed'),
    volumeSlider:   $('volume-slider'),
    volValue:       $('vol-value'),
    eqToggle:       $('eq-toggle'),
    btnEqReset:     $('btn-eq-reset'),
    spatialToggle:  $('spatial-toggle'),
    reverbSlider:   $('reverb-slider'),
    reverbVal:      $('reverb-val'),
    stereoSlider:   $('stereo-slider'),
    stereoVal:      $('stereo-val'),
    compSlider:     $('comp-slider'),
    compVal:        $('comp-val'),
    infoCover:      $('info-cover'),
    infoCoverPh:    $('info-cover-placeholder'),
    infoTitle:      $('info-title'),
    infoArtist:     $('info-artist'),
    infoAlbum:      $('info-album'),
    infoYear:       $('info-year'),
    infoGenre:      $('info-genre'),
    infoDuration:   $('info-duration'),
    infoSpeed:      $('info-speed'),
    canvas:         $('visualizer-canvas'),
  };

  // AudioEngine初期化
  engine = new AudioEngine();
  await engine.init();

  // macOSシステムボリュームを取得して初期設定
  try {
    const sysVol = await window.electronAPI.getSystemVolume();
    if (sysVol && sysVol.success) {
      const vol = Math.max(0, Math.min(100, sysVol.volume));
      engine.setVolume(vol / 100);
      // DOMセットアップ前なので直接属性を設定
      document.getElementById('volume-slider').value = vol;
      document.getElementById('vol-value').textContent = `${vol}%`;
      updateVolumeSliderBg(vol);
    } else {
      engine.audioElement.volume = 0.8;
    }
  } catch(e) {
    engine.audioElement.volume = 0.8;
  }

  setupTitlebar();
  setupDropZone();
  setupPlaylistControls();
  setupSavedPlaylists();
  setupPlayerControls();
  setupSpeedControls();
  setupVolumeControl();
  setupEqualizer();
  setupSpatialAudio();
  setupTabs();
  initSegmentMeter();
  initVisualizer();

  // オーディオエンジンコールバック
  engine.onTimeUpdate = (current, duration) => {
    if (isSeeking) return;
    updateSeekBar(current, duration);
  };

  engine.onEnded = () => {
    onTrackEnded();
  };

  engine.onLevelUpdate = (normL, normR) => {
    updateSegmentMeter(normL, normR);
  };

  console.log('Music Player initialized');
}

// ===================================
// タイトルバー
// ===================================
function setupTitlebar() {
  dom.btnClose.addEventListener('click', () => window.electronAPI.close());
  dom.btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
  dom.btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
}

// ===================================
// Drag & Drop
// ===================================
function setupDropZone() {
  document.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    dom.dropZone.classList.add('drag-over');
  });

  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      dom.dropZone.classList.remove('drag-over');
    }
  });

  document.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    dom.dropZone.classList.remove('drag-over');

    const files = [];

    // Electron では dataTransfer.files の File オブジェクトに .path プロパティがある
    // これが最も確実な方法
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        const filePath = file.path; // Electron固有のプロパティ
        if (filePath && isAudioFile(filePath)) {
          files.push(filePath);
        }
      }
    }

    // フォルダドロップの場合は webkitGetAsEntry を使用
    if (files.length === 0 && e.dataTransfer.items) {
      for (const item of e.dataTransfer.items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry?.();
          if (entry && entry.isDirectory) {
            await collectFilesFromDirectory(entry, files);
          } else if (entry && entry.isFile) {
            await new Promise(resolve => {
              entry.file(f => {
                const fp = f.path || '';
                if (fp && isAudioFile(fp)) files.push(fp);
                resolve();
              });
            });
          }
        }
      }
    }

    console.log('Dropped files:', files);

    if (files.length > 0) {
      await addFilesToPlaylist(files);
    } else {
      console.warn('No audio files found in drop');
    }
  });
}

// フォルダ再帰処理
async function collectFilesFromDirectory(dirEntry, files) {
  const reader = dirEntry.createReader();
  return new Promise(resolve => {
    const readAll = () => {
      reader.readEntries(async entries => {
        if (entries.length === 0) { resolve(); return; }
        for (const entry of entries) {
          if (entry.isFile) {
            await new Promise(r => {
              entry.file(f => {
                const fp = f.path || '';
                if (fp && isAudioFile(fp)) files.push(fp);
                r();
              });
            });
          } else if (entry.isDirectory) {
            await collectFilesFromDirectory(entry, files);
          }
        }
        readAll(); // 100件以上の場合も対応
      });
    };
    readAll();
  });
}

function isAudioFile(name) {
  return /\.(mp3|m4a|aac|flac|wav|ogg|mp4|mov|webm|mkv|avi|m4v)$/i.test(name);
}

function isVideoFile(name) {
  return /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(name);
}

// ===================================
// プレイリスト管理
// ===================================
async function addFilesToPlaylist(filePaths) {
  const prevLength = playlist.length;

  for (const filePath of filePaths) {
    // 重複チェック
    if (playlist.some(t => t.filePath === filePath)) continue;

    let meta;
    try {
      meta = await window.electronAPI.readMetadata(filePath);
    } catch(e) {
      console.error('Metadata error:', e);
      meta = { success: false };
    }

    const fileName = filePath.split('/').pop().replace(/\.[^/.]+$/, '');
    const track = {
      filePath,
      title:    (meta && meta.title)    || fileName,
      artist:   (meta && meta.artist)   || 'Unknown Artist',
      album:    (meta && meta.album)    || '',
      year:     (meta && meta.year)     || '',
      genre:    (meta && meta.genre)    || '',
      duration: (meta && meta.duration) || 0,
      cover:    (meta && meta.cover)    || null,
    };

    playlist.push(track);
    renderPlaylistItem(track, playlist.length - 1);
  }

  dom.trackCount.textContent = `${playlist.length} track${playlist.length !== 1 ? 's' : ''}`;

  // 初回追加時は1曲目をロード (再生はしない)
  if (prevLength === 0 && playlist.length > 0 && currentIndex === -1) {
    await selectTrack(0, false);
  }
}

function renderPlaylistItem(track, index) {
  const li = document.createElement('li');
  li.className = 'playlist-item';
  li.dataset.index = String(index); // data-index に正確なインデックスを保持

  const durationStr = formatTime(track.duration);

  li.innerHTML = `
    <div class="pl-playing-anim">
      <div class="bar-anim"></div>
      <div class="bar-anim"></div>
      <div class="bar-anim"></div>
    </div>
    <span class="pl-num">${index + 1}</span>
    <div class="pl-cover">
      ${track.cover ? `<img src="${track.cover}" alt="">` : '🎵'}
    </div>
    <div class="pl-info">
      <div class="pl-title">${escapeHtml(track.title)}</div>
      <div class="pl-artist">${escapeHtml(track.artist)}</div>
    </div>
    <span class="pl-duration">${durationStr}</span>
  `;

  // data-index から取得するので再描画後もインデックスが正確
  li.addEventListener('click', (e) => {
    const idx = parseInt(li.dataset.index, 10);
    if (!isNaN(idx)) selectTrack(idx, true);
  });
  dom.playlist.appendChild(li);
}

function renderPlaylist() {
  dom.playlist.innerHTML = '';
  playlist.forEach((track, i) => renderPlaylistItem(track, i));
  dom.trackCount.textContent = `${playlist.length} track${playlist.length !== 1 ? 's' : ''}`;
  // アクティブ曲のハイライトを復元
  if (currentIndex >= 0) {
    const items = dom.playlist.querySelectorAll('.playlist-item');
    items[currentIndex]?.classList.add('active');
  }
}

async function selectTrack(index, autoPlay = true) {
  if (index < 0 || index >= playlist.length) return;

  currentIndex = index;
  const track = playlist[index];

  // プレイリストのアクティブ表示更新
  document.querySelectorAll('.playlist-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });

  // 選択された項目を表示領域にスクロール
  const activeEl = document.querySelectorAll('.playlist-item')[index];
  activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // ファイルロード
  try {
    await engine.loadFile(track.filePath);
  } catch(e) {
    console.error('Load error:', e);
    return;
  }

  // 速度を維持
  engine.setSpeed(engine.currentSpeed);

  // UI更新（動画/音声で表示を切り替え）
  updateTrackUI(track);

  if (autoPlay) {
    await engine.play();
    setPlayingState(true);
  }
}

function updateTrackUI(track) {
  const isVid = isVideoFile(track.filePath);

  dom.trackTitle.textContent  = track.title;
  dom.trackArtist.textContent = isVid ? '▶ 動画ファイル' : track.artist;
  dom.trackAlbum.textContent  = track.album || '';
  dom.trackGenre.textContent  = track.genre || '';
  dom.trackYear.textContent   = track.year  || '';

  // プレイリストアイコン：動画は🎬
  const activeLi = dom.playlist.querySelectorAll('.playlist-item')[currentIndex];
  if (activeLi) {
    const coverEl = activeLi.querySelector('.pl-cover');
    if (isVid && coverEl && !track.cover) coverEl.textContent = '🎬';
  }

  // ----- 動画/音声モードの表示切り替え -----
  const videoOverlay = $('video-overlay');
  const videoEl = engine.videoElement;

  const coverContainer = videoOverlay.closest('.cover-art-container') || videoOverlay.parentElement;

  if (isVid) {
    // コンテナを2倍サイズに拡大
    coverContainer.classList.add('video-active');

    // カバーアートを非表示
    dom.coverWrapper.style.display = 'none';
    dom.coverBlur.style.backgroundImage = '';

    // video要素がオーバーレイにまだなければ追加
    if (!videoOverlay.contains(videoEl)) {
      videoOverlay.innerHTML = '';
      videoOverlay.appendChild(videoEl);
    }
    // video要素のスタイルをリセットして表示
    videoEl.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;border-radius:12px;background:#000;';
    videoOverlay.style.display = 'flex';
  } else {
    // コンテナを元のサイズに戻す
    coverContainer.classList.remove('video-active');

    // 音声モード：オーバーレイを非表示、カバーアートを表示
    videoOverlay.style.display = 'none';
    dom.coverWrapper.style.display = '';

    // video要素を body に戻して非表示に（AudioContext のソースを維持）
    if (!document.body.contains(videoEl) || videoOverlay.contains(videoEl)) {
      document.body.appendChild(videoEl);
    }
    videoEl.style.cssText = 'display:none;';

    if (track.cover) {
      dom.coverArt.src = track.cover;
      dom.coverArt.classList.add('visible');
      dom.coverPlaceholder.style.display = 'none';
      dom.coverBlur.style.backgroundImage = `url(${track.cover})`;
    } else {
      dom.coverArt.src = '';
      dom.coverArt.classList.remove('visible');
      dom.coverPlaceholder.style.display = 'flex';
      dom.coverBlur.style.backgroundImage = '';
    }
  }

  // INFOタブ
  dom.infoTitle.textContent    = track.title;
  dom.infoArtist.textContent   = track.artist;
  dom.infoAlbum.textContent    = track.album    || '—';
  dom.infoYear.textContent     = track.year     || '—';
  dom.infoGenre.textContent    = track.genre    || '—';
  dom.infoDuration.textContent = formatTime(track.duration);

  if (track.cover) {
    dom.infoCover.src = track.cover;
    dom.infoCover.classList.add('visible');
    dom.infoCoverPh.style.display = 'none';
  } else {
    dom.infoCover.src = '';
    dom.infoCover.classList.remove('visible');
    dom.infoCoverPh.style.display = 'flex';
  }

  // シークバーリセット
  dom.currentTime.textContent = '0:00';
  dom.totalTime.textContent = formatTime(track.duration);
  dom.seekProgress.style.width = '0%';
  dom.seekBar.value = 0;
}

function setPlayingState(playing) {
  dom.iconPlay.style.display  = playing ? 'none'  : 'block';
  dom.iconPause.style.display = playing ? 'block' : 'none';
  // 音声モードのみ回転アニメーション
  if (!engine.isVideoMode) {
    if (playing) {
      dom.coverWrapper.classList.add('spinning');
    } else {
      dom.coverWrapper.classList.remove('spinning');
    }
  } else {
    dom.coverWrapper.classList.remove('spinning');
  }
}

// ===================================
// プレイリスト操作ボタン
// ===================================
function setupPlaylistControls() {
  dom.btnClear.addEventListener('click', () => {
    // 選択中の曲がなければ何もしない
    if (currentIndex < 0 || currentIndex >= playlist.length) return;

    const wasPlaying = engine.isPlaying;
    const removedIndex = currentIndex;

    // 再生中なら停止
    engine.stop();

    // プレイリストから1曲削除
    playlist.splice(removedIndex, 1);

    // currentIndexの更新
    if (playlist.length === 0) {
      // 全曲削除された場合
      currentIndex = -1;
      setPlayingState(false);
      dom.trackTitle.textContent  = '楽曲を選択してください';
      dom.trackArtist.textContent = '—';
      dom.trackAlbum.textContent  = '';
      dom.trackGenre.textContent  = '';
      dom.trackYear.textContent   = '';
      dom.coverArt.classList.remove('visible');
      dom.coverPlaceholder.style.display = 'flex';
      dom.coverBlur.style.backgroundImage = '';
      dom.currentTime.textContent = '0:00';
      dom.totalTime.textContent   = '0:00';
      dom.seekProgress.style.width = '0%';
      dom.seekBar.value = 0;
    } else if (removedIndex >= playlist.length) {
      // 末尾の曲を削除した場合は一つ前へ
      currentIndex = playlist.length - 1;
    } else {
      // それ以外はそのインデックスを維持（次の曲がそのインデックスに来る）
      currentIndex = removedIndex;
    }

    // プレイリストを再描画
    renderPlaylist();

    // 残曲があれば次の曲をロードして再生
    if (playlist.length > 0) {
      selectTrack(currentIndex, wasPlaying);
    }
  });

  dom.btnShuffleL.addEventListener('click', shufflePlaylist);
}

function shufflePlaylist() {
  if (playlist.length < 2) return;
  const current = currentIndex >= 0 ? playlist[currentIndex] : null;

  for (let i = playlist.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
  }

  if (current) {
    currentIndex = playlist.findIndex(t => t.filePath === current.filePath);
  }

  renderPlaylist();
  if (currentIndex >= 0) {
    document.querySelectorAll('.playlist-item')[currentIndex]?.classList.add('active');
  }
}

// ===================================
// 再生コントロール
// ===================================
function setupPlayerControls() {
  // 再生/停止
  dom.btnPlay.addEventListener('click', async () => {
    if (playlist.length === 0) return;

    if (currentIndex === -1) {
      await selectTrack(0, true);
      return;
    }

    if (engine.isPlaying) {
      engine.pause();
      setPlayingState(false);
    } else {
      await engine.play();
      setPlayingState(true);
    }
  });

  // 前の曲
  dom.btnPrev.addEventListener('click', async () => {
    if (playlist.length === 0) return;
    if (engine.currentTime > 3) {
      engine.seek(0);
      return;
    }
    let next = isShuffle ? randomIndex() : currentIndex - 1;
    if (next < 0) next = playlist.length - 1;
    await selectTrack(next, true);
  });

  // 次の曲
  dom.btnNext.addEventListener('click', async () => {
    await playNext();
  });

  // 巻き戻し (-10秒)
  dom.btnRewind.addEventListener('click', () => {
    engine.rewind(10);
  });

  // 早送り (+10秒)
  dom.btnForward.addEventListener('click', () => {
    engine.forward(10);
  });

  // リピート (OFF→1曲→全曲ループ の3段階)
  dom.btnRepeat.addEventListener('click', () => {
    repeatMode = (repeatMode + 1) % 3;
    updateRepeatUI();
  });

  // シャッフル
  dom.btnShuffleC.addEventListener('click', () => {
    isShuffle = !isShuffle;
    dom.btnShuffleC.classList.toggle('active', isShuffle);
  });

  // シークバー操作
  dom.seekBar.addEventListener('mousedown', () => { isSeeking = true; });
  dom.seekBar.addEventListener('input', () => {
    const pct = dom.seekBar.value / 1000;
    dom.seekProgress.style.width = `${pct * 100}%`;
    const t = pct * (engine.duration || 0);
    dom.currentTime.textContent = formatTime(t);
  });
  dom.seekBar.addEventListener('change', () => {
    const pct = dom.seekBar.value / 1000;
    engine.seek(pct * (engine.duration || 0));
    isSeeking = false;
  });
  dom.seekBar.addEventListener('mouseup', () => { isSeeking = false; });

  // シークバー背景クリック
  dom.seekBarBg.addEventListener('click', (e) => {
    if (e.target === dom.seekBar) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    engine.seek(pct * (engine.duration || 0));
  });
}

function updateRepeatUI() {
  const badge = $('repeat-badge');
  // 0=OFF, 1=1曲, 2=全曲ループ
  if (repeatMode === 0) {
    dom.btnRepeat.classList.remove('active');
    badge.style.display = 'none';
  } else if (repeatMode === 1) {
    dom.btnRepeat.classList.add('active');
    badge.style.display = 'block';
    badge.textContent = '1';
  } else {
    dom.btnRepeat.classList.add('active');
    badge.style.display = 'block';
    badge.textContent = '∞';
  }
}

async function playNext() {
  if (playlist.length === 0) return;
  let next;
  if (isShuffle) {
    next = randomIndex();
  } else {
    next = currentIndex + 1;
    if (next >= playlist.length) {
      if (repeatMode === 2) {
        next = 0; // 全曲ループ
      } else {
        engine.stop();
        setPlayingState(false);
        return;
      }
    }
  }
  await selectTrack(next, true);
}

function onTrackEnded() {
  setPlayingState(false);
  if (repeatMode === 1) {
    // 1曲リピート
    engine.seek(0);
    engine.play().then(() => setPlayingState(true));
  } else {
    playNext();
  }
}

function randomIndex() {
  if (playlist.length <= 1) return 0;
  let idx;
  do { idx = Math.floor(Math.random() * playlist.length); }
  while (idx === currentIndex);
  return idx;
}

// ===================================
// シークバー更新
// ===================================
function updateSeekBar(current, duration) {
  if (!duration || isNaN(duration) || duration === Infinity) return;
  const pct = current / duration;
  dom.seekProgress.style.width = `${pct * 100}%`;
  dom.seekBar.value = Math.round(pct * 1000);
  dom.currentTime.textContent = formatTime(current);
  dom.totalTime.textContent   = formatTime(duration);
}

// ===================================
// 速度コントロール
// ===================================
function setupSpeedControls() {
  document.querySelectorAll('.speed-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      applySpeed(speed);
      document.querySelectorAll('.speed-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  dom.btnApplySpeed.addEventListener('click', () => {
    const speed = parseFloat(dom.speedInput.value);
    if (!isNaN(speed) && speed >= 0.1 && speed <= 4.0) {
      applySpeed(speed);
      document.querySelectorAll('.speed-preset-btn').forEach(b => {
        b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
      });
    }
  });

  dom.speedInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') dom.btnApplySpeed.click();
  });
}

function applySpeed(speed) {
  engine.setSpeed(speed);
  dom.speedInput.value = speed.toFixed(2);
  dom.infoSpeed.textContent = `${speed.toFixed(2)}x`;
}

// ===================================
// 音量コントロール
// ===================================
function setupVolumeControl() {
  dom.volumeSlider.addEventListener('input', () => {
    const val = parseInt(dom.volumeSlider.value);
    engine.setVolume(val / 100);
    dom.volValue.textContent = `${val}%`;
    updateVolumeSliderBg(val);
  });
  // 初期値を適用
  updateVolumeSliderBg(parseInt(dom.volumeSlider.value));
}

function updateVolumeSliderBg(val) {
  dom.volumeSlider.style.background =
    `linear-gradient(to right, #a0a0a0 ${val}%, rgba(255,255,255,0.08) ${val}%)`;
}

// ===================================
// イコライザー
// ===================================
function setupEqualizer() {
  // 起動時にROCKプリセットをON状態で適用
  engine.setEQEnabled(true);
  const initGains = engine.applyEQPreset('rock');
  initGains.forEach((gain, i) => {
    $(`eq-${i}`).value = gain;
    $(`eq-val-${i}`).textContent = (gain >= 0 ? '+' : '') + gain.toFixed(1) + 'dB';
  });

  dom.eqToggle.addEventListener('change', () => {
    engine.setEQEnabled(dom.eqToggle.checked);
  });

  for (let i = 0; i < 5; i++) {
    const slider   = $(`eq-${i}`);
    const valLabel = $(`eq-val-${i}`);
    slider.addEventListener('input', () => {
      const gain = parseFloat(slider.value);
      engine.setEQGain(i, gain);
      valLabel.textContent = (gain >= 0 ? '+' : '') + gain.toFixed(1) + 'dB';
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    });
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const gains = engine.applyEQPreset(preset);
      gains.forEach((gain, i) => {
        $(`eq-${i}`).value = gain;
        $(`eq-val-${i}`).textContent = (gain >= 0 ? '+' : '') + gain.toFixed(1) + 'dB';
      });
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  dom.btnEqReset.addEventListener('click', () => {
    engine.applyEQPreset('flat');
    for (let i = 0; i < 5; i++) {
      $(`eq-${i}`).value = 0;
      $(`eq-val-${i}`).textContent = '0dB';
    }
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-preset="flat"]').classList.add('active');
  });
}

// ===================================
// Spatial Audio
// ===================================
function setupSpatialAudio() {
  dom.spatialToggle.addEventListener('change', async () => {
    await engine.setSpatialEnabled(dom.spatialToggle.checked);
  });

  document.querySelectorAll('.spatial-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      await engine.setSpatialMode(mode);

      document.querySelectorAll('.spatial-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (mode === 'off') {
        dom.spatialToggle.checked = false;
      } else {
        dom.spatialToggle.checked = true;
        const defaultReverb = { concert: 60, theater: 45, room: 30, studio: 15, outdoor: 50 };
        const revVal = defaultReverb[mode] || 30;
        dom.reverbSlider.value = revVal;
        dom.reverbVal.textContent = `${revVal}%`;
        engine.setReverbAmount(revVal / 100);
      }
    });
  });

  dom.reverbSlider.addEventListener('input', () => {
    const val = parseInt(dom.reverbSlider.value);
    dom.reverbVal.textContent = `${val}%`;
    engine.setReverbAmount(val / 100);
  });

  dom.stereoSlider.addEventListener('input', () => {
    const val = parseInt(dom.stereoSlider.value);
    dom.stereoVal.textContent = `${val}%`;
  });

  dom.compSlider.addEventListener('input', () => {
    const val = parseInt(dom.compSlider.value);
    dom.compVal.textContent = `${val}%`;
    engine.setCompressorAmount(val / 100);
  });
}

// ===================================
// タブ切り替え
// ===================================
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${tab}`)?.classList.add('active');
    });
  });
}

// ===================================
// セグメント型レベルメーター
// ===================================
function initSegmentMeter() {
  [dom.segLeft, dom.segRight].forEach(track => {
    track.innerHTML = '';
    for (let i = 0; i < SEG_COUNT; i++) {
      const block = document.createElement('div');
      block.className = 'seg-block';
      track.appendChild(block);
    }
  });
}

function updateSegmentMeter(normL, normR) {
  const blueEnd   = Math.floor(SEG_COUNT * 0.70);
  const yellowEnd = Math.floor(SEG_COUNT * 0.90);

  const updateChannel = (trackEl, norm) => {
    const active = Math.round(norm * SEG_COUNT);
    const blocks = trackEl.querySelectorAll('.seg-block');
    blocks.forEach((block, i) => {
      block.className = 'seg-block';
      if (i < active) {
        if (i < blueEnd)        block.classList.add('active-blue');
        else if (i < yellowEnd) block.classList.add('active-yellow');
        else                    block.classList.add('active-red');
      }
    });
  };

  updateChannel(dom.segLeft,  normL);
  updateChannel(dom.segRight, normR);
}

// ===================================
// スペクトラムビジュアライザー
// ===================================
let vizCtx = null;

function initVisualizer() {
  const canvas = dom.canvas;
  resizeCanvas(canvas);
  window.addEventListener('resize', () => resizeCanvas(canvas));

  function drawFrame() {
    requestAnimationFrame(drawFrame);

    if (!vizCtx) return;

    // canvasの実際のサイズを取得 (CSS pxベース)
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;

    vizCtx.clearRect(0, 0, W, H);
    vizCtx.fillStyle = 'rgba(13,13,26,0.4)';
    vizCtx.fillRect(0, 0, W, H);

    if (!engine || !engine.analyserFull) return;

    const data = engine.getSpectrumData();
    const barCount = Math.min(data.length, 80);
    const gap = 2;
    const barW = (W - gap * (barCount - 1)) / barCount;

    // 7色レインボーグラデーション (バー位置に応じて色相を変化)
    for (let i = 0; i < barCount; i++) {
      const val  = data[i] / 255;
      const barH = val * H * 0.9;
      const x    = i * (barW + gap);
      const y    = H - barH;

      if (barH < 1) continue;

      // バーの横位置に応じて色相を変化 (0°→300°: 赤→橙→黄→緑→青→藍→紫)
      const hue = (i / barCount) * 300;

      const grad = vizCtx.createLinearGradient(x, y, x, H);
      grad.addColorStop(0,    `hsla(${hue}, 100%, 70%, ${0.85 + val * 0.15})`);
      grad.addColorStop(0.35, `hsla(${hue}, 100%, 55%, ${0.75 + val * 0.2})`);
      grad.addColorStop(0.7,  `hsla(${hue}, 90%,  40%, ${0.65 + val * 0.2})`);
      grad.addColorStop(1,    `hsla(${hue}, 80%,  25%, ${0.5 + val * 0.3})`);

      vizCtx.fillStyle = grad;
      vizCtx.beginPath();
      if (vizCtx.roundRect) {
        vizCtx.roundRect(x, y, Math.max(barW, 1), barH, [2, 2, 0, 0]);
      } else {
        vizCtx.rect(x, y, Math.max(barW, 1), barH);
      }
      vizCtx.fill();

      // ピーク線 (バーの色に合わせた色)
      if (val > 0.02) {
        vizCtx.fillStyle = `hsla(${hue}, 100%, 85%, ${val * 0.9})`;
        vizCtx.fillRect(x, Math.max(y - 2, 0), Math.max(barW, 1), 2);
      }
    }
  }

  drawFrame();
}

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  vizCtx = canvas.getContext('2d');
  vizCtx.scale(dpr, dpr);
}

// ===================================
// ユーティリティ
// ===================================
function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds === Infinity) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===================================
// キーボードショートカット
// ===================================
document.addEventListener('keydown', async (e) => {
  if (e.target.tagName === 'INPUT') return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      dom.btnPlay?.click();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (engine) engine.rewind(e.shiftKey ? 30 : 10);
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (engine) engine.forward(e.shiftKey ? 30 : 10);
      break;
    case 'ArrowUp': {
      e.preventDefault();
      const volUp = Math.min(100, parseInt(dom.volumeSlider.value) + 5);
      dom.volumeSlider.value = volUp;
      dom.volumeSlider.dispatchEvent(new Event('input'));
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      const volDown = Math.max(0, parseInt(dom.volumeSlider.value) - 5);
      dom.volumeSlider.value = volDown;
      dom.volumeSlider.dispatchEvent(new Event('input'));
      break;
    }
    case 'KeyN':
      dom.btnNext?.click();
      break;
    case 'KeyP':
      dom.btnPrev?.click();
      break;
  }
});

// ===================================
// 保存済みプレイリスト管理
// ===================================
function setupSavedPlaylists() {
  const btnSave       = $('btn-save-playlist');
  const overlay       = $('pl-dialog-overlay');
  const nameInput     = $('pl-name-input');
  const dialogInfo    = $('pl-dialog-info');
  const btnCancel     = $('pl-dialog-cancel');
  const btnNew        = $('pl-dialog-save');
  const btnOverwrite  = $('pl-dialog-overwrite');
  const toggleBtn     = $('btn-toggle-saved-pl');
  const savedList     = $('saved-pl-list');
  const existSection  = $('pl-existing-section');
  const existListEl   = $('pl-existing-list');
  const overwriteMsg  = $('pl-overwrite-msg');

  // ダイアログの状態を更新するヘルパー
  const updateDialogState = () => {
    const name = nameInput.value.trim();
    const lists = loadSavedPlaylists();
    const exists = lists.some(p => p.name === name);

    if (exists) {
      overwriteMsg.style.display = 'block';
      btnOverwrite.style.display = 'block';
      btnNew.style.display = 'none';
    } else {
      overwriteMsg.style.display = 'none';
      btnOverwrite.style.display = 'none';
      btnNew.style.display = 'block';
    }

    // チップのハイライトを更新
    existListEl.querySelectorAll('.pl-existing-chip').forEach(chip => {
      chip.classList.toggle('selected', chip.dataset.name === name);
    });
  };

  // 保存ボタン（左パネル）
  btnSave.addEventListener('click', () => {
    if (playlist.length === 0) return;

    // 既存プレイリスト名チップを生成
    const lists = loadSavedPlaylists();
    existListEl.innerHTML = '';
    if (lists.length > 0) {
      lists.forEach(pl => {
        const chip = document.createElement('button');
        chip.className = 'pl-existing-chip';
        chip.textContent = pl.name;
        chip.dataset.name = pl.name;
        chip.title = pl.name;
        chip.addEventListener('click', () => {
          nameInput.value = pl.name;
          updateDialogState();
        });
        existListEl.appendChild(chip);
      });
      existSection.style.display = 'block';
    } else {
      existSection.style.display = 'none';
    }

    nameInput.value = '';
    dialogInfo.textContent = `${playlist.length} 曲を保存します`;
    overwriteMsg.style.display = 'none';
    btnOverwrite.style.display = 'none';
    btnNew.style.display = 'block';
    overlay.style.display = 'flex';
    setTimeout(() => nameInput.focus(), 50);
  });

  // 入力変化で状態を更新
  nameInput.addEventListener('input', updateDialogState);

  // キャンセル
  btnCancel.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });

  // Enter キーで確定（状態に応じて新規/上書き）
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (btnOverwrite.style.display !== 'none') {
        btnOverwrite.click();
      } else {
        btnNew.click();
      }
    }
  });

  // トラック情報生成ヘルパー
  const buildTracks = () => playlist.map(t => ({
    filePath: t.filePath,
    title:    t.title,
    artist:   t.artist,
    album:    t.album,
    year:     t.year,
    genre:    t.genre,
    duration: t.duration,
    cover:    t.cover,
  }));

  // 新規保存
  btnNew.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const lists = loadSavedPlaylists();
    lists.unshift({
      id:      Date.now(),
      name,
      tracks:  buildTracks(),
      savedAt: new Date().toLocaleDateString('ja-JP'),
    });
    savePlaylistsToStorage(lists);
    overlay.style.display = 'none';
    renderSavedPlaylists();
  });

  // 上書き保存
  btnOverwrite.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const lists = loadSavedPlaylists();
    const idx = lists.findIndex(p => p.name === name);
    if (idx >= 0) {
      lists[idx].tracks  = buildTracks();
      lists[idx].savedAt = new Date().toLocaleDateString('ja-JP');
    }
    savePlaylistsToStorage(lists);
    overlay.style.display = 'none';
    renderSavedPlaylists();
  });

  // 開閉トグル
  toggleBtn.addEventListener('click', () => {
    savedList.classList.toggle('collapsed');
    toggleBtn.textContent = savedList.classList.contains('collapsed') ? '▸' : '▾';
  });

  // 初期描画
  renderSavedPlaylists();
}

function renderSavedPlaylists() {
  const savedList  = $('saved-pl-list');
  const emptyMsg   = $('saved-pl-empty');
  const lists      = loadSavedPlaylists();

  // 既存のアイテムを削除（空メッセージは残す）
  savedList.querySelectorAll('.saved-pl-item').forEach(el => el.remove());

  if (lists.length === 0) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  lists.forEach(pl => {
    const div = document.createElement('div');
    div.className = 'saved-pl-item';
    div.innerHTML = `
      <div class="saved-pl-item-info" title="${escapeHtml(pl.name)}">
        <span class="saved-pl-item-name">${escapeHtml(pl.name)}</span>
        <span class="saved-pl-item-meta">${pl.tracks.length}曲 · ${pl.savedAt}</span>
      </div>
      <div class="saved-pl-item-actions">
        <button class="saved-pl-btn load" title="このプレイリストをロード">▶</button>
        <button class="saved-pl-btn del" title="削除">✕</button>
      </div>
    `;

    // ロードボタン
    div.querySelector('.load').addEventListener('click', async () => {
      playlist = [];
      currentIndex = -1;
      engine.stop();
      setPlayingState(false);
      dom.playlist.innerHTML = '';
      dom.trackCount.textContent = '0 tracks';
      await addFilesToPlaylist(pl.tracks.map(t => t.filePath));
    });

    // 削除ボタン
    div.querySelector('.del').addEventListener('click', () => {
      const lists2 = loadSavedPlaylists().filter(p => p.id !== pl.id);
      savePlaylistsToStorage(lists2);
      renderSavedPlaylists();
    });

    savedList.appendChild(div);
  });
}

// ===================================
// 起動
// ===================================
document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => console.error('Init error:', err));
});
