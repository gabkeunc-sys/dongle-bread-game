(() => {
  'use strict';

  // ---------- 화면 ----------
  const W = 540, H = 960;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.round(W * scale) + 'px';
    canvas.style.height = Math.round(H * scale) + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const FONT = '"Jua", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  // ---------- 이미지 ----------
  const IMG_NAMES = ['dongle_normal', 'dongle_happy', 'dongle_sad', 'bread_toast', 'bread_croissant',
    'bread_cake', 'bad_burnt', 'bad_moldy', 'bad_alarm', 'ui_heart', 'fx_bonk', 'bg_game', 'bg_title'];
  const img = {};
  let loaded = 0;
  IMG_NAMES.forEach(n => {
    const i = new Image();
    i.onload = i.onerror = () => { loaded++; };
    i.src = 'assets/' + n + '.webp';
    img[n] = i;
  });

  // ---------- 아이템 정의 ----------
  const TYPES = {
    toast:     { img: 'bread_toast',     pts: 1,  good: true,  name: '식빵',   size: 74 },
    croissant: { img: 'bread_croissant', pts: 3,  good: true,  name: '크루아상', size: 80 },
    cake:      { img: 'bread_cake',      pts: 10, good: true,  name: '케이크', size: 88, bonus: true },
    burnt:     { img: 'bad_burnt',       good: false, size: 72 },
    moldy:     { img: 'bad_moldy',       good: false, size: 80 },
    alarm:     { img: 'bad_alarm',       good: false, size: 76 }
  };

  // ---------- 소리 (Web Audio 합성) ----------
  const Sound = {
    ac: null, master: null, muted: false, bgmTimer: null, step: 0, nextTime: 0, mode: null,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ac.destination);
    },
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ac.currentTime, 0.02);
    },
    tone(freq, t, dur, type = 'triangle', vol = 0.2, slideTo = null) {
      if (!this.ac) return;
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    yum() {
      if (!this.ac) return; const t = this.ac.currentTime;
      this.tone(520, t, 0.08, 'square', 0.08, 300);
      this.tone(880, t + 0.06, 0.12, 'triangle', 0.18, 1320);
    },
    bonus() {
      if (!this.ac) return; const t = this.ac.currentTime;
      [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, t + i * 0.08, 0.35, 'sine', 0.16));
    },
    bonk() {
      if (!this.ac) return; const t = this.ac.currentTime;
      this.tone(220, t, 0.25, 'square', 0.15, 70);
      this.tone(160, t + 0.02, 0.2, 'triangle', 0.2, 60);
    },
    miss() {
      if (!this.ac) return; const t = this.ac.currentTime;
      this.tone(600, t, 0.25, 'sine', 0.08, 250);
    },
    over() {
      if (!this.ac) return; const t = this.ac.currentTime;
      [784, 659, 523, 392].forEach((f, i) => this.tone(f, t + i * 0.22, 0.4, 'triangle', 0.2));
    },
    // 배경음악: 단순한 실로폰풍 루프
    SONGS: {
      title: { bpm: 90, mel: [72, 0, 76, 0, 79, 0, 76, 0, 77, 0, 74, 0, 72, 0, 0, 0, 69, 0, 72, 0, 76, 0, 74, 0, 72, 0, 71, 0, 72, 0, 0, 0],
               bass: [48, 48, 53, 53, 45, 45, 43, 43] },
      game:  { bpm: 130, mel: [76, 79, 84, 79, 76, 0, 72, 74, 76, 74, 72, 0, 67, 69, 72, 0, 77, 81, 84, 81, 79, 0, 76, 77, 79, 77, 76, 74, 72, 0, 0, 0],
               bass: [48, 55, 53, 55, 50, 57, 55, 43] }
    },
    playBgm(mode) {
      if (!this.ac) return;
      this.stopBgm();
      this.mode = mode; this.step = 0; this.nextTime = this.ac.currentTime + 0.05;
      this.bgmTimer = setInterval(() => this.schedule(), 25);
    },
    stopBgm() { clearInterval(this.bgmTimer); this.bgmTimer = null; this.mode = null; },
    schedule() {
      const song = this.SONGS[this.mode]; if (!song) return;
      const stepDur = 60 / song.bpm / 2;
      const midi = n => 440 * Math.pow(2, (n - 69) / 12);
      while (this.nextTime < this.ac.currentTime + 0.12) {
        const s = this.step % song.mel.length;
        const n = song.mel[s];
        if (n) this.tone(midi(n), this.nextTime, stepDur * 1.8, 'triangle', 0.07);
        if (s % 4 === 0) this.tone(midi(song.bass[(s / 4) % song.bass.length]), this.nextTime, stepDur * 3, 'sine', 0.09);
        this.nextTime += stepDur; this.step++;
      }
    }
  };

  // ---------- 저장 ----------
  function loadBest() { try { return +localStorage.getItem('dongle_best') || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('dongle_best', String(v)); } catch (e) { } }

  // ---------- 게임 상태 ----------
  let state = 'loading';
  let best = loadBest();
  let score, lives, items, particles, texts, elapsed, spawnTimer, tally, shake, overAt, newBest;
  const player = { x: W / 2, y: H - 150, tx: W / 2, size: 150, face: 'dongle_normal', faceTimer: 0, pop: 0 };
  const keys = {};
  let titleT = 0;

  function reset() {
    score = 0; lives = 3; items = []; particles = []; texts = []; elapsed = 0; spawnTimer = 0.6;
    tally = { toast: 0, croissant: 0, cake: 0 }; shake = 0; newBest = false;
    player.x = player.tx = W / 2; player.face = 'dongle_normal'; player.faceTimer = 0; player.pop = 0;
  }

  reset();

  function startGame() {
    Sound.init(); reset(); state = 'play'; Sound.playBgm('game');
  }

  function endGame() {
    state = 'over'; overAt = performance.now();
    Sound.stopBgm(); Sound.over();
    if (score > best) { best = score; newBest = true; saveBest(best); }
  }

  // ---------- 입력 ----------
  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  const muteBtn = { x: W - 62, y: 18, w: 46, h: 46 };
  function inMute(p) { return p.x > muteBtn.x && p.x < muteBtn.x + muteBtn.w && p.y > muteBtn.y && p.y < muteBtn.y + muteBtn.h; }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = toGame(e);
    Sound.init();
    if (inMute(p)) { Sound.setMuted(!Sound.muted); return; }
    if (state === 'title') { startGame(); return; }
    if (state === 'over') {
      if (performance.now() - overAt > 900) { state = 'title'; Sound.playBgm('title'); }
      return;
    }
    if (state === 'play') player.tx = p.x;
  });
  canvas.addEventListener('pointermove', e => {
    if (state !== 'play') return;
    if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) player.tx = toGame(e).x;
  });
  window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (e.key === ' ' || e.key === 'Enter') {
      Sound.init();
      if (state === 'title') startGame();
      else if (state === 'over' && performance.now() - overAt > 900) { state = 'title'; Sound.playBgm('title'); }
    }
  });
  window.addEventListener('keyup', e => { keys[e.key] = false; });

  // ---------- 생성 ----------
  function pickType() {
    const lvl = Math.min(elapsed / 60, 1);           // 60초에 걸쳐 난이도 상승
    const table = [
      ['toast', 46], ['croissant', 22], ['cake', 4],
      ['burnt', 10 + 14 * lvl], ['moldy', 8 + 12 * lvl], ['alarm', 6 + 10 * lvl]
    ];
    const sum = table.reduce((a, b) => a + b[1], 0);
    let r = Math.random() * sum;
    for (const [k, w] of table) { if ((r -= w) < 0) return k; }
    return 'toast';
  }

  function spawn() {
    const kind = pickType(), t = TYPES[kind];
    const speed = 210 + elapsed * 4.2 + Math.random() * 60;
    items.push({
      kind, x: 50 + Math.random() * (W - 100), y: -60,
      vy: Math.min(speed, 620) * (t.bonus ? 1.25 : 1),
      rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 2.4,
      wob: Math.random() * Math.PI * 2
    });
  }

  function sparkle(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 260;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.7 + Math.random() * 0.4,
        age: 0, size: 7 + Math.random() * 9, color: colors[i % colors.length], star: Math.random() < 0.6 });
    }
  }
  function floatText(x, y, str, color, big) { texts.push({ x, y, str, color, age: 0, big }); }

  function setFace(f, t) { player.face = f; player.faceTimer = t; }

  // ---------- 업데이트 ----------
  function update(dt) {
    titleT += dt;
    if (state !== 'play') { updateFx(dt); return; }
    elapsed += dt;

    // 이동
    const kdir = (keys.ArrowLeft || keys.a ? -1 : 0) + (keys.ArrowRight || keys.d ? 1 : 0);
    if (kdir) player.tx = Math.max(60, Math.min(W - 60, player.tx + kdir * 620 * dt));
    player.tx = Math.max(60, Math.min(W - 60, player.tx));
    player.x += (player.tx - player.x) * Math.min(1, dt * 14);

    if (player.faceTimer > 0 && (player.faceTimer -= dt) <= 0) player.face = 'dongle_normal';
    player.pop = Math.max(0, player.pop - dt * 4);

    // 생성
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = Math.max(0.32, 0.95 - elapsed * 0.011) * (0.7 + Math.random() * 0.6);
    }

    // 낙하·충돌
    const mouthX = player.x, mouthY = player.y - 6, catchR = 70;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i], t = TYPES[it.kind];
      it.y += it.vy * dt; it.rot += it.vr * dt; it.wob += dt * 3;
      const ix = it.x + Math.sin(it.wob) * 6;
      const dx = ix - mouthX, dy = it.y - mouthY;
      if (dx * dx + dy * dy < catchR * catchR && it.y < player.y + 40) {
        items.splice(i, 1);
        if (t.good) {
          score += t.pts; tally[it.kind]++;
          player.pop = 1; setFace('dongle_happy', 0.45);
          if (t.bonus) {
            Sound.bonus(); sparkle(ix, it.y, 26, ['#ffd84d', '#ff9ec7', '#fff3a8', '#ffb347']);
            floatText(ix, it.y - 30, '+' + t.pts + ' 케이크!', '#ff5f8f', true);
          } else {
            Sound.yum(); sparkle(ix, it.y, 12, ['#ffd84d', '#fff3a8', '#ffb347']);
            floatText(ix, it.y - 20, '냠! +' + t.pts, '#e8892b');
          }
        } else {
          lives--; shake = 0.35; setFace('dongle_sad', 0.9);
          Sound.bonk();
          particles.push({ bonk: true, x: ix, y: it.y, age: 0, life: 0.45 });
          floatText(ix, it.y - 20, t === TYPES.alarm ? '따르릉!' : '으악!', '#7a5a4a');
          if (lives <= 0) { endGame(); break; }
        }
        continue;
      }
      if (it.y > H + 60) {
        items.splice(i, 1);
        if (t.good) { Sound.miss(); if (player.face !== 'dongle_sad') setFace('dongle_sad', 0.4); }
      }
    }
    updateFx(dt);
  }

  function updateFx(dt) {
    shake = Math.max(0, shake - dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt;
      if (!p.bonk) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; }
      if (p.age > p.life) particles.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      texts[i].age += dt; texts[i].y -= 70 * dt;
      if (texts[i].age > 0.9) texts.splice(i, 1);
    }
  }

  // ---------- 그리기 도우미 ----------
  function drawImg(name, x, y, size, rot = 0, alpha = 1) {
    const im = img[name]; if (!im || !im.naturalWidth) return;
    const k = size / Math.max(im.naturalWidth, im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(im, -w / 2, -h / 2, w, h); ctx.restore();
  }
  function cover(name, dim = 0) {
    const im = img[name]; if (!im || !im.naturalWidth) { ctx.fillStyle = '#f6e2cc'; ctx.fillRect(0, 0, W, H); return; }
    const k = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
    if (dim) { ctx.fillStyle = `rgba(255,248,240,${dim})`; ctx.fillRect(0, 0, W, H); }
  }
  function text(str, x, y, size, color, align = 'center', stroke = '#fff', sw = 8) {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function star(x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }
  function roundRect(x, y, w, h, r, fill, strokeC) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (strokeC) { ctx.lineWidth = 4; ctx.strokeStyle = strokeC; ctx.stroke(); }
  }
  function drawMute() {
    roundRect(muteBtn.x, muteBtn.y, muteBtn.w, muteBtn.h, 14, 'rgba(255,255,255,.85)', '#e2b48a');
    const cx = muteBtn.x + 23, cy = muteBtn.y + 23;
    ctx.fillStyle = '#8a5a3a'; ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 5); ctx.lineTo(cx - 6, cy - 5); ctx.lineTo(cx + 2, cy - 12);
    ctx.lineTo(cx + 2, cy + 12); ctx.lineTo(cx - 6, cy + 5); ctx.lineTo(cx - 12, cy + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (Sound.muted) {
      ctx.beginPath(); ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx + 14, cy + 6);
      ctx.moveTo(cx + 14, cy - 6); ctx.lineTo(cx + 6, cy + 6); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(cx + 3, cy, 8, -0.8, 0.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 3, cy, 13, -0.8, 0.8); ctx.stroke();
    }
  }
  function drawFx() {
    for (const p of particles) {
      const k = 1 - p.age / p.life;
      if (p.bonk) { drawImg('fx_bonk', p.x, p.y, 150 * (0.7 + 0.5 * (1 - k)), 0, k); continue; }
      ctx.globalAlpha = k;
      if (p.star) star(p.x, p.y, p.size, p.color);
      else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    for (const t of texts) {
      ctx.globalAlpha = Math.min(1, (0.9 - t.age) * 3);
      text(t.str, t.x, t.y, t.big ? 40 : 32, t.color);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 화면 ----------
  function drawLoading() {
    ctx.fillStyle = '#f6e2cc'; ctx.fillRect(0, 0, W, H);
    text('불러오는 중…', W / 2, H / 2, 34, '#8a5a3a');
    const k = loaded / IMG_NAMES.length;
    roundRect(120, H / 2 + 40, 300, 18, 9, '#fff');
    if (k > 0) roundRect(120, H / 2 + 40, 300 * k, 18, 9, '#f2a65a');
  }

  function drawTitle() {
    cover('bg_title', 0.15);
    const bob = Math.sin(titleT * 3) * 10;
    text('동글이', W / 2, 150, 84, '#ff7aa2', 'center', '#fff', 14);
    text('빵 받기', W / 2, 238, 84, '#e8892b', 'center', '#fff', 14);
    const orbit = ['bread_toast', 'bread_croissant', 'bread_cake'].map((n, i) => ({ n, a: titleT * 1.4 + i * 2.1 }));
    const drawOrbit = o => drawImg(o.n, W / 2 + Math.cos(o.a) * 195, 430 + Math.sin(o.a) * 50, 64, Math.sin(o.a) * 0.3);
    orbit.filter(o => Math.sin(o.a) < 0).forEach(drawOrbit);
    drawImg('dongle_happy', W / 2, 430 + bob, 230);
    orbit.filter(o => Math.sin(o.a) >= 0).forEach(drawOrbit);

    roundRect(50, 600, W - 100, 220, 26, 'rgba(255,255,255,.88)', '#efc59b');
    text('받으면 점수', 150, 638, 26, '#8a5a3a', 'center', null);
    text('맞으면 하트 -1', 390, 638, 26, '#8a5a3a', 'center', null);
    [['bread_toast', '1점'], ['bread_croissant', '3점'], ['bread_cake', '10점']].forEach(([n, s], i) => {
      drawImg(n, 85 + i * 65, 700, 54); text(s, 85 + i * 65, 750, 22, '#e8892b', 'center', null);
    });
    ['bad_burnt', 'bad_moldy', 'bad_alarm'].forEach((n, i) => drawImg(n, 325 + i * 65, 700, 54));
    ctx.strokeStyle = '#efc59b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2, 625); ctx.lineTo(W / 2, 780); ctx.stroke();
    text('좌우로 끌어서 동글이를 움직이세요', W / 2, 795, 22, '#9b7a62', 'center', null);

    const pulse = 1 + Math.sin(titleT * 5) * 0.04;
    ctx.save(); ctx.translate(W / 2, 880); ctx.scale(pulse, pulse);
    roundRect(-150, -38, 300, 76, 38, '#ff8fb1', '#fff');
    text('시작하기', 0, 2, 38, '#fff', 'center', null);
    ctx.restore();
    if (best) text('최고 기록 ' + best + '점', W / 2, 940, 22, '#8a5a3a', 'center', '#fff', 6);
    drawMute();
  }

  function drawPlay() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 16 * shake / 0.35, (Math.random() - 0.5) * 16 * shake / 0.35);
    cover('bg_game', 0.1);

    for (const it of items) {
      const t = TYPES[it.kind];
      if (t.bonus) {
        ctx.globalAlpha = 0.5 + Math.sin(titleT * 12) * 0.3;
        star(it.x + Math.sin(it.wob) * 6 + 40, it.y - 30, 9, '#ffe066');
        ctx.globalAlpha = 1;
      }
      drawImg(t.img, it.x + Math.sin(it.wob) * 6, it.y, t.size, it.rot);
    }

    // 그림자 + 동글이
    ctx.fillStyle = 'rgba(90,50,20,.18)';
    ctx.beginPath(); ctx.ellipse(player.x, player.y + 82, 70, 14, 0, 0, Math.PI * 2); ctx.fill();
    const sq = 1 + player.pop * 0.18;
    const lean = (player.tx - player.x) * 0.0025;
    drawImg(player.face, player.x, player.y, player.size * sq, Math.max(-0.25, Math.min(0.25, lean)));

    drawFx();
    ctx.restore();

    // HUD
    roundRect(16, 18, 190, 56, 20, 'rgba(255,255,255,.88)', '#efc59b');
    text(score + '점', 111, 48, 34, '#e8892b', 'center', null);
    for (let i = 0; i < 3; i++) drawImg('ui_heart', 240 + i * 52, 46, 44, 0, i < lives ? 1 : 0.22);
    drawMute();
  }

  function drawOver() {
    cover('bg_game', 0.55);
    text('게임 끝', W / 2, 120, 76, '#ff7aa2', 'center', '#fff', 14);
    drawImg('dongle_happy', W / 2, 270, 180);

    roundRect(50, 380, W - 100, 420, 30, 'rgba(255,255,255,.93)', '#efc59b');
    text(score + '점', W / 2, 440, 64, '#e8892b', 'center', null);
    text(newBest ? '최고 기록 달성!' : '최고 기록 ' + best + '점', W / 2, 500, 26, newBest ? '#ff5f8f' : '#9b7a62', 'center', null);
    text('오늘 동글이가 먹은 빵', W / 2, 565, 30, '#8a5a3a', 'center', null);
    [['bread_toast', 'toast'], ['bread_croissant', 'croissant'], ['bread_cake', 'cake']].forEach(([n, k], i) => {
      const y = 625 + i * 58;
      drawImg(n, 170, y, 50);
      text(TYPES[k].name, 215, y, 28, '#8a5a3a', 'left', null);
      text(tally[k] + '개', 380, y, 30, '#e8892b', 'right', null);
    });

    if (performance.now() - overAt > 900) {
      const pulse = 1 + Math.sin(titleT * 5) * 0.04;
      ctx.save(); ctx.translate(W / 2, 870); ctx.scale(pulse, pulse);
      roundRect(-150, -38, 300, 76, 38, '#ff8fb1', '#fff');
      text('다시 하기', 0, 2, 38, '#fff', 'center', null);
      ctx.restore();
    }
    drawFx();
    drawMute();
  }

  // ---------- 루프 ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state === 'loading' && loaded >= IMG_NAMES.length) state = 'title';
    update(dt);
    if (state === 'loading') drawLoading();
    else if (state === 'title') drawTitle();
    else if (state === 'play') drawPlay();
    else drawOver();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
