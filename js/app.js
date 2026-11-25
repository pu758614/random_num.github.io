(() => {
  'use strict';

  const STORAGE_KEY = 'brain-scale:v1';
  const RANGE_MIN = 0;
  const RANGE_MAX = 999;

  // ───────── 題目解析 ─────────
  // 題目格式：「題目內容(最低是…，最高是…)」，把兩端說明拆出來當量表標籤。
  const QUESTION_RE = /^(.*?)\s*[(（]\s*(?:最低|1)(?:是|會讓)?(.*?)[，,]\s*最高是(.*?)[)）]\s*$/;

  const questions = (window.QUESTIONS || []).map((raw, index) => {
    const m = raw.match(QUESTION_RE);
    return m
      ? { index, raw, prompt: m[1].trim(), low: m[2].trim(), high: m[3].trim() }
      : { index, raw, prompt: raw, low: '', high: '' };
  });

  // ───────── DOM helpers ─────────
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const views = { setup: $('setupView'), game: $('gameView') };

  // ───────── 狀態 ─────────
  let state = loadState() || {
    phase: 'setup',      // 'setup' | 'game'
    qIndex: randomIndex(),
    min: 1,
    max: 10,
    playerCount: 4,      // 本輪玩家人數（不可多於數字數量）
    pool: [],            // 尚未被抽走的數字
    players: [],         // [{ code, number }]
    showing: false,      // 目前是否正在顯示某位玩家的數字
  };

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 無痕模式等情況忽略 */ }
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && questions[s.qIndex] && Array.isArray(s.pool) && Array.isArray(s.players)) {
        // 舊版存檔沒有人數設定：沿用舊行為（人數 = 數字數量）
        if (!Number.isInteger(s.playerCount)) s.playerCount = s.max - s.min + 1;
        return s;
      }
    } catch { /* ignore */ }
    return null;
  }

  // ───────── 小工具 ─────────
  function randomIndex(exclude) {
    if (questions.length < 2) return 0;
    let i;
    do { i = Math.floor(Math.random() * questions.length); } while (i === exclude);
    return i;
  }

  // 0 → A, 25 → Z, 26 → AA …
  function codeFor(n) {
    let s = '';
    n += 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function ratio(num) {
    return state.max === state.min ? 0.5 : (num - state.min) / (state.max - state.min);
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function vibrate(ms = 20) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  // 量表：像尺一樣的刻度線，兩端標出數字與說明
  function renderScale(container, q, markValue = null) {
    const count = state.max - state.min + 1;
    // 刻度太多時改成每隔幾格一條，最多約 20 條
    const stepSize = count <= 21 ? 1 : Math.ceil((count - 1) / 20);
    const track = el('div', { className: 'ruler-track' });
    for (let n = state.min; n <= state.max; n += stepSize) {
      const tick = el('span', { className: 'ruler-tick' });
      if (n === state.min) tick.classList.add('major');
      tick.style.left = `${ratio(n) * 100}%`;
      track.append(tick);
    }
    const last = el('span', { className: 'ruler-tick major' });
    last.style.left = '100%';
    track.append(last);

    // 抽到數字時，在刻度上標出位置
    container.classList.toggle('marked', markValue !== null);
    if (markValue !== null) {
      const mark = el('span', { className: 'ruler-mark' }, [
        el('span', { className: 'ruler-mark-num', textContent: markValue }),
      ]);
      mark.style.left = `${ratio(markValue) * 100}%`;
      track.append(mark);
    }

    container.replaceChildren(
      track,
      el('div', { className: 'ruler-ends' }, [
        el('div', { className: 'low' }, [el('span', { className: 'num', textContent: state.min }), q.low]),
        el('div', { className: 'high' }, [el('span', { className: 'num', textContent: state.max }), q.high]),
      ]),
    );
  }

  // ───────── Dialog helpers ─────────
  function openDialog(id) {
    const d = $(id);
    if (!d.open) d.showModal();
  }
  function closeDialog(id) {
    const d = $(id);
    if (d.open) d.close();
  }
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  let confirmAction = null;
  function askConfirm(title, text, okLabel, action) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmOk').textContent = okLabel;
    confirmAction = action;
    openDialog('confirmDialog');
  }
  $('confirmOk').addEventListener('click', () => {
    closeDialog('confirmDialog');
    const fn = confirmAction;
    confirmAction = null;
    if (fn) fn();
  });

  // ───────── 設定畫面 ─────────
  const minInput = $('minInput');
  const maxInput = $('maxInput');
  const playersInput = $('playersInput');

  function renderSetup() {
    const q = questions[state.qIndex];
    $('setupQuestion').textContent = q.prompt;
    $('setupNo').textContent = `No. ${q.index + 1} / ${questions.length}`;
    minInput.value = state.min;
    maxInput.value = state.max;
    playersInput.value = state.playerCount;
    validateRange();
  }

  function readRange() {
    return {
      min: parseInt(minInput.value, 10),
      max: parseInt(maxInput.value, 10),
      players: parseInt(playersInput.value, 10),
    };
  }

  function validateRange() {
    const { min, max, players } = readRange();
    const hint = $('rangeHint');
    let error = '';
    const count = max - min + 1;
    if (Number.isNaN(min) || Number.isNaN(max) || Number.isNaN(players)) error = '請輸入數字';
    else if (min < RANGE_MIN || max > RANGE_MAX) error = `範圍需在 ${RANGE_MIN}～${RANGE_MAX} 之間`;
    else if (min >= max) error = '最小值必須小於最大值';
    else if (players < 1) error = '至少要 1 位玩家';
    else if (players > count) error = `玩家人數不能多於數字數量（共 ${count} 個數字）`;

    hint.classList.toggle('error', Boolean(error));
    hint.textContent = error || `${players} 位玩家從 ${min}～${max} 共 ${count} 個數字中各抽一個`;
    $('startBtn').disabled = Boolean(error);

    if (!error) {
      state.min = min;
      state.max = max;
      state.playerCount = players;
      renderScale($('setupScale'), questions[state.qIndex]);
    }
    return !error;
  }

  minInput.addEventListener('input', validateRange);
  maxInput.addEventListener('input', validateRange);
  playersInput.addEventListener('input', validateRange);

  document.querySelectorAll('.step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      const next = (parseInt(input.value, 10) || 0) + Number(btn.dataset.delta);
      input.value = Math.min(Number(input.max), Math.max(Number(input.min), next));
      validateRange();
    });
  });

  $('shuffleBtn').addEventListener('click', () => {
    state.qIndex = randomIndex(state.qIndex);
    renderSetup();
    saveState();
    vibrate();
  });

  // 題庫瀏覽
  const searchInput = $('searchInput');
  function renderQuestionList() {
    const keyword = searchInput.value.trim();
    const list = $('questionList');
    const matched = keyword ? questions.filter((q) => q.raw.includes(keyword)) : questions;
    $('browseCount').textContent = `（${matched.length} / ${questions.length}）`;
    list.replaceChildren(...matched.map((q) => {
      const btn = el('button', { type: 'button' }, [
        el('span', { className: 'q-no', textContent: q.index + 1 }),
        el('span', { className: 'q-text', textContent: q.prompt }),
        el('span', { className: 'q-ends', textContent: q.low ? `${q.low} ／ ${q.high}` : '' }),
      ]);
      if (q.index === state.qIndex) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => {
        state.qIndex = q.index;
        renderSetup();
        saveState();
        closeDialog('browseDialog');
      });
      return el('li', {}, [btn]);
    }));
  }
  searchInput.addEventListener('input', renderQuestionList);
  $('browseBtn').addEventListener('click', () => {
    searchInput.value = '';
    renderQuestionList();
    openDialog('browseDialog');
    const current = $('questionList').querySelector('[aria-current="true"]');
    if (current) current.scrollIntoView({ block: 'center' });
  });

  $('startBtn').addEventListener('click', () => {
    if (!validateRange()) return;
    startGame();
  });

  function startGame() {
    state.pool = Array.from({ length: state.max - state.min + 1 }, (_, i) => state.min + i);
    state.players = [];
    state.showing = false;
    state.phase = 'game';
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ───────── 遊戲畫面 ─────────
  const flip = $('flipCard');

  function renderGame() {
    const q = questions[state.qIndex];
    const total = state.playerCount;
    const drawn = state.players.length;
    const current = state.players[drawn - 1];

    $('gameQuestion').textContent = q.prompt;
    renderScale($('gameScale'), q, state.showing && current ? current.number : null);
    $('progressText').textContent = `${drawn} / ${total} 人`;

    if (state.showing && current) {
      const corner = `${current.number}\n${current.code}`;
      $('cornerTL').textContent = corner;
      $('cornerBR').textContent = corner;
      $('bigNumber').textContent = current.number;
      $('miniDot').style.left = `${ratio(current.number) * 100}%`;
      flip.dataset.state = 'revealed';
      $('drawBtn').hidden = true;
      $('hideBtn').hidden = false;
      $('reminder').textContent = `你是 ${current.code}。記住數字，蓋牌後傳給下一位。`;
    } else {
      flip.dataset.state = 'idle';
      $('drawBtn').hidden = false;
      $('hideBtn').hidden = true;
      const empty = drawn >= total || state.pool.length === 0;
      $('drawBtn').disabled = empty;
      $('frontPlayer').textContent = empty ? '—' : codeFor(drawn);
      $('frontNote').textContent = empty ? '所有玩家都抽完了' : '其他人請先別看';
      $('reminder').textContent = empty
        ? '開始輪流回答或表演吧。'
        : drawn === 0 ? '從第一位玩家開始。' : '傳給下一位玩家。';
    }

    const list = $('playerList');
    if (drawn === 0) {
      list.replaceChildren(el('li', { className: 'empty', textContent: '還沒有人抽數字' }));
    } else {
      list.replaceChildren(...state.players.map((p) => {
        const btn = el('button', { type: 'button', textContent: p.code, title: `找回玩家 ${p.code} 的數字` });
        btn.addEventListener('click', () => openPeek(p));
        return el('li', {}, [btn]);
      }));
    }
    $('revealBtn').disabled = drawn === 0;
  }

  $('drawBtn').addEventListener('click', () => {
    if (state.players.length >= state.playerCount || state.pool.length === 0) return;
    const i = Math.floor(Math.random() * state.pool.length);
    const number = state.pool.splice(i, 1)[0];
    state.players.push({ code: codeFor(state.players.length), number });
    state.showing = true;
    saveState();
    renderGame();
    vibrate(30);
  });

  $('hideBtn').addEventListener('click', () => {
    state.showing = false;
    saveState();
    renderGame();
  });

  // 找回數字
  let peekTarget = null;
  function openPeek(player) {
    if (state.showing) { toast('請先把目前的數字蓋起來'); return; }
    peekTarget = player;
    $('peekTitle').textContent = `玩家 ${player.code}`;
    $('peekNumber').hidden = true;
    $('peekShowBtn').hidden = false;
    $('peekDoneBtn').hidden = true;
    openDialog('peekDialog');
  }
  $('peekShowBtn').addEventListener('click', () => {
    if (!peekTarget) return;
    $('peekNumber').textContent = peekTarget.number;
    $('peekNumber').hidden = false;
    $('peekShowBtn').hidden = true;
    $('peekDoneBtn').hidden = false;
  });
  $('peekDialog').addEventListener('close', () => {
    peekTarget = null;
    $('peekNumber').textContent = '';
  });

  // 公布結果
  function showResults() {
    state.showing = false;
    saveState();
    renderGame();
    renderScale($('resultScale'), questions[state.qIndex]);
    const sorted = [...state.players].sort((a, b) => b.number - a.number);
    $('resultList').replaceChildren(...sorted.map((p, i) => {
      const dot = el('span', { className: 'r-dot' });
      dot.style.left = `${ratio(p.number) * 100}%`;
      const li = el('li', {}, [
        el('span', { className: 'r-code', textContent: p.code }),
        el('span', { className: 'r-track' }, [dot]),
        el('span', { className: 'r-num', textContent: p.number }),
      ]);
      li.style.animationDelay = `${i * 70}ms`;
      return li;
    }));
    openDialog('resultDialog');
  }

  $('revealBtn').addEventListener('click', () => {
    if (state.players.length === 0) return;
    askConfirm('公布結果？', '所有人的數字都會顯示在螢幕上。', '公布', showResults);
  });

  function backToSetup() {
    state.phase = 'setup';
    state.pool = [];
    state.players = [];
    state.showing = false;
    state.qIndex = randomIndex(state.qIndex);
    saveState();
    render();
  }

  $('restartBtn').addEventListener('click', () => {
    if (state.players.length === 0) { backToSetup(); return; }
    askConfirm('重新開始？', '目前這一輪的數字將會清除。', '重新開始', backToSetup);
  });

  $('newRoundBtn').addEventListener('click', () => {
    closeDialog('resultDialog');
    backToSetup();
  });

  $('helpBtn').addEventListener('click', () => openDialog('helpDialog'));

  // ───────── Render ─────────
  function render() {
    const inGame = state.phase === 'game';
    views.setup.hidden = inGame;
    views.game.hidden = !inGame;
    if (inGame) renderGame(); else renderSetup();
  }

  render();
})();
