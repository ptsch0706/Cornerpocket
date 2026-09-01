/* ============================================================
   Shared arcade kit — aim pad input, per-game stats, settings
   modal wiring, and service worker registration. Every game
   page includes this after shared.css and before its own
   game-specific <script>.
   ============================================================ */
window.Arcade = (function () {
  "use strict";

  const PAD_RADIUS_FRAC = 0.42;

  /**
   * Wires up a circular drag pad. Reports the RAW drag vector (dx,dy as a
   * unit vector) and power (0..1) to the caller on every move and on
   * release — the caller decides what that vector means (e.g. pool/
   * shuffleboard treat it as a pull-back-then-fire-opposite vector;
   * darts/cornhole treat it as a direct aim offset). This module doesn't
   * bake in that convention so it can serve every game.
   *
   * options:
   *   padEl, knobEl       - DOM elements (required)
   *   powerBarEl          - optional, width% is updated live
   *   canShoot()          - return true/false; drag is ignored when false
   *   onMove(dx,dy,power) - called continuously while dragging
   *   onRelease(dx,dy,power) - called once on release, if power > deadzone
   *   deadzone            - minimum power to count as a real release (default 0.07)
   */
  function createAimPad(options) {
    const { padEl, knobEl, powerBarEl, canShoot, onMove, onRelease } = options;
    const deadzone = options.deadzone != null ? options.deadzone : 0.07;
    let active = false;
    let lastDX = 0, lastDY = 0, lastPower = 0;

    function point(evt) {
      const t = evt.touches ? evt.touches[0] : evt;
      return { x: t.clientX, y: t.clientY };
    }

    function update(evt) {
      const rect = padEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const maxR = rect.width * PAD_RADIUS_FRAC;
      const p = point(evt);
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, maxR);
      const ux = dist > 0 ? dx / dist : 0;
      const uy = dist > 0 ? dy / dist : 0;
      lastDX = ux; lastDY = uy;
      lastPower = maxR > 0 ? clamped / maxR : 0;
      knobEl.style.transform = `translate(calc(-50% + ${ux * clamped}px), calc(-50% + ${uy * clamped}px))`;
      if (dist > 0) {
        const angleDeg = Math.atan2(uy, ux) * 180 / Math.PI + 90; // convert to conic-gradient's convention (0deg = top)
        padEl.style.setProperty('--pull-angle', angleDeg + 'deg');
      }
      padEl.style.setProperty('--pull-power', lastPower);
      if (powerBarEl) powerBarEl.style.width = (lastPower * 100).toFixed(0) + '%';
      if (onMove) onMove(lastDX, lastDY, lastPower);
    }

    function down(evt) {
      if (canShoot && !canShoot()) return;
      evt.preventDefault();
      active = true;
      update(evt);
    }
    function move(evt) {
      if (!active) return;
      evt.preventDefault();
      update(evt);
    }
    function up(evt) {
      if (!active) return;
      active = false;
      evt.preventDefault();
      knobEl.style.transform = 'translate(-50%,-50%)';
      padEl.style.setProperty('--pull-power', 0);
      if (powerBarEl) powerBarEl.style.width = '0%';
      if (lastPower > deadzone && onRelease) onRelease(lastDX, lastDY, lastPower);
      lastPower = 0;
    }

    padEl.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    padEl.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up, { passive: false });

    return {
      setDisabled(disabled) { padEl.classList.toggle('disabled', !!disabled); }
    };
  }

  /**
   * Per-game Wins/Losses/Win-Rate, persisted to localStorage under a
   * game-specific key so games never share a record.
   */
  function createStats(storageKey) {
    function load() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.wins === 'number' && typeof parsed.losses === 'number') return parsed;
        }
      } catch (e) {}
      return { wins: 0, losses: 0 };
    }
    let stats = load();
    function save() {
      try { localStorage.setItem(storageKey, JSON.stringify(stats)); } catch (e) {}
    }
    return {
      get wins() { return stats.wins; },
      get losses() { return stats.losses; },
      addWin() { stats.wins++; save(); },
      addLoss() { stats.losses++; save(); },
      reset() { stats = { wins: 0, losses: 0 }; save(); },
      render(winsEl, lossesEl, rateEl) {
        winsEl.textContent = stats.wins;
        lossesEl.textContent = stats.losses;
        const total = stats.wins + stats.losses;
        rateEl.textContent = total > 0 ? Math.round((stats.wins / total) * 100) + '%' : '—';
      }
    };
  }

  /** Generic open/close wiring for the settings modal. */
  function wireSettingsModal(openBtnId, modalId, closeBtnId) {
    const modal = document.getElementById(modalId);
    const openBtn = document.getElementById(openBtnId);
    const closeBtn = document.getElementById(closeBtnId);
    if (openBtn) openBtn.addEventListener('click', () => modal.classList.add('open'));
    if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  }

  /**
   * Wires up the shared coin-flip overlay used to decide who goes first.
   * Call .show() whenever a match is starting (page load, "New Game", "Play Again").
   * The user taps the coin to flip it, then taps the start button, which fires
   * onStart('player'|'ai') and hides the overlay — the caller uses that value to
   * actually begin play.
   *
   * options:
   *   overlayId, coinId, promptId, resultId, startBtnId — element ids (required)
   *   startLabel  - text for the start button, e.g. "Start Match" (required)
   *   resultText  - { player: "...", ai: "..." } messages shown after the flip (required)
   *   onStart(startingPlayer) - called once the user taps start
   */
  function createCoinFlip(options) {
    const { overlayId, coinId, promptId, resultId, startBtnId, startLabel, resultText, onStart } = options;
    const overlay = document.getElementById(overlayId);
    const coinEl = document.getElementById(coinId);
    const promptEl = document.getElementById(promptId);
    const resultEl = document.getElementById(resultId);
    const startBtn = document.getElementById(startBtnId);
    if (startBtn && startLabel) startBtn.textContent = startLabel;

    // Difficulty pills (optional) — a convenience picker that mirrors whatever
    // the single #difficulty <select> (in Settings) currently holds, so there's
    // only ever one source of truth for the value.
    const difficultySel = document.getElementById('difficulty');
    const diffPills = overlay.querySelectorAll('.diffPill');
    function syncDiffPills() {
      if (!difficultySel) return;
      diffPills.forEach((p) => p.classList.toggle('active', p.dataset.diff === difficultySel.value));
    }
    diffPills.forEach((p) => {
      p.addEventListener('click', () => {
        if (difficultySel) difficultySel.value = p.dataset.diff;
        syncDiffPills();
      });
    });

    let flipping = false;
    let pendingTurn = null;

    function show() {
      flipping = false;
      pendingTurn = null;
      coinEl.style.transition = 'none';
      coinEl.style.transform = 'rotateY(0deg)';
      promptEl.textContent = 'Tap the coin to flip';
      resultEl.textContent = '';
      startBtn.style.display = 'none';
      syncDiffPills();
      overlay.classList.add('open');
      void coinEl.offsetWidth; // force reflow so the next flip transitions cleanly
      coinEl.style.transition = '';
    }

    function flip() {
      if (flipping) return;
      flipping = true;
      promptEl.textContent = 'Flipping…';
      const result = Math.random() < 0.5 ? 'player' : 'ai';
      pendingTurn = result;
      const spins = 5 + Math.floor(Math.random() * 3);
      const finalDeg = spins * 360 + (result === 'player' ? 0 : 180);
      coinEl.style.transform = `rotateY(${finalDeg}deg)`;
      setTimeout(() => {
        resultEl.textContent = result === 'player' ? resultText.player : resultText.ai;
        promptEl.textContent = '';
        startBtn.style.display = 'inline-block';
        flipping = false;
      }, 1750);
    }

    coinEl.addEventListener('click', flip);
    startBtn.addEventListener('click', () => {
      overlay.classList.remove('open');
      onStart(pendingTurn);
    });

    return { show };
  }

  /**
   * Fires a short vibration if the device/browser supports it. Note: iOS Safari
   * (including installed PWAs) has never implemented the Vibration API, so this
   * is silently a no-op there — it only does anything on Android. Safe to call
   * unconditionally either way.
   */
  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  /** Wires a light haptic tick to every button/tile/icon-btn press on the page. */
  function wireHaptics() {
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .icon-btn, .game-tile, .coin')) vibrate(8);
    });
  }

  /** Registers the shared service worker and reloads once a new version takes over. */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  return { createAimPad, createStats, wireSettingsModal, createCoinFlip, vibrate, wireHaptics, registerServiceWorker };
})();
