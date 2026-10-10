(() => {
  'use strict';

  const slides = [...document.querySelectorAll('.slide')];
  const deck = document.querySelector('.deck');
  const isPresenter = new URLSearchParams(location.search).has('presenter');
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('cp-deck') : null;
  // The kit sits next to the slides, so it works on any host or subfolder
  const kitUrl = new URL('kit.html', location.href);
  const kitLabel = kitUrl.host + kitUrl.pathname;
  let idx = 0;

  // ---------- Decorate slides: corner byline, page number, kit link ----------
  slides.forEach((s, i) => {
    if (!s.classList.contains('endcover')) {
      const b = document.createElement('a');
      b.className = 'byline';
      b.href = 'https://piermadsen.com';
      b.target = '_blank';
      b.rel = 'noopener';
      b.textContent = 'piermadsen.com';
      s.appendChild(b);
    }
    if (!s.classList.contains('cover') && !s.classList.contains('endcover')) {
      const n = document.createElement('div');
      n.className = 'pnum';
      n.textContent = i + 1;
      s.appendChild(n);
    }
    if (s.hasAttribute('data-kit')) {
      const f = document.createElement('div');
      f.className = 'foot';
      f.innerHTML = '<strong>Kit:</strong><a></a>';
      const a = f.querySelector('a');
      a.href = kitUrl.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = kitLabel;
      a.style.color = 'inherit';
      s.appendChild(f);
    }
  });
  document.querySelectorAll('[data-kitlink]').forEach(a => { a.href = kitUrl.href; a.textContent = kitLabel; });

// ---------- Scale the 1280x720 canvas to the window ----------
  function fit() {
    if (window.matchMedia('(max-width: 760px), (max-height: 420px) and (orientation: landscape)').matches) {
      deck.style.transform = '';
      return;
    }
    const k = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    deck.style.transform = 'translate(-50%, -50%) scale(' + k + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- Navigation ----------
  function show(i, fromRemote) {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, j) => s.classList.toggle('active', j === idx));
    // Fill the space around the 16:9 slide with the slide's own color, so no bars show
    const narrow = window.matchMedia('(max-width: 760px), (max-height: 420px) and (orientation: landscape)').matches;
    document.body.style.backgroundColor = isPresenter || narrow ? '' : getComputedStyle(slides[idx]).backgroundColor;
    if (location.hash !== '#' + (idx + 1)) history.replaceState(null, '', '#' + (idx + 1));
    if (!fromRemote && channel) channel.postMessage({ type: 'goto', idx });
    if (isPresenter) renderPresenter();
  }
  window.addEventListener('hashchange', () => {
    const h = parseInt((location.hash || '').slice(1), 10);
    if (Number.isFinite(h) && h - 1 !== idx) show(h - 1);
  });

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(idx + 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if (e.key === 'p' || e.key === 'P') openPresenter();
    else if ((e.key === 'f' || e.key === 'F') && !isPresenter) toggleFullscreen();
    else if (e.key === 't' || e.key === 'T') timerPrimary(idx);
    else if (e.key === 'r' || e.key === 'R') timerReset(idx);
  });
  const navPrev = document.getElementById('prev');
  const navNext = document.getElementById('next');
  const navPres = document.getElementById('pres');
  if (navPrev) navPrev.onclick = () => show(idx - 1);
  if (navNext) navNext.onclick = () => show(idx + 1);
  if (navPres) navPres.onclick = openPresenter;

  // F toggles true full screen (hides the browser's tab and address bars). Esc also exits.
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    const on = d.fullscreenElement || d.webkitFullscreenElement;
    const fn = on ? (d.exitFullscreen || d.webkitExitFullscreen) : (el.requestFullscreen || el.webkitRequestFullscreen);
    if (!fn) return;
    try { const p = fn.call(on ? d : el); if (p && p.catch) p.catch(() => {}); } catch (err) { /* browser refused; nothing to do */ }
  }

  function openPresenter() {
    const u = new URL(location.href);
    u.searchParams.set('presenter', '1');
    const w = window.open(u.href, 'cp-presenter', 'width=1100,height=800');
    if (!w) alert('Your browser blocked the presenter window. Allow pop-ups for this site, then press P again.');
  }

// ---------- Timers (one per sprint slide, synced across windows) ----------
// State per slide index: { state: 'running', end } or { state: 'paused', left }. No entry = not started.
// At zero the timer keeps going as overtime (shown as +m:ss on a light red panel).
const timers = {};
try { Object.assign(timers, JSON.parse(localStorage.getItem('cp-timers') || '{}')); } catch (err) { /* ignore bad storage */ }

function saveTimers() {
  try { localStorage.setItem('cp-timers', JSON.stringify(timers)); } catch (err) { /* storage may be off */ }
}
function timerBox(i) { return slides[i] && slides[i].querySelector('.timerbox'); }
function secondsLeft(i) {
  const box = timerBox(i);
  const t = timers[i];
  if (!t) return box ? Number(box.dataset.seconds) : 0;
  return t.state === 'running' ? (t.end - Date.now()) / 1000 : t.left;
}
function setTimer(i, value, fromRemote) {
  if (value) timers[i] = value; else delete timers[i];
  saveTimers();
  if (!fromRemote && channel) channel.postMessage({ type: 'timer', i, value: value || null });
  tick();
}
// Primary action: Start -> Stop -> Continue
function timerPrimary(i) {
  if (!timerBox(i)) return;
  const t = timers[i];
  if (!t) setTimer(i, { state: 'running', end: Date.now() + secondsLeft(i) * 1000 });
  else if (t.state === 'running') setTimer(i, { state: 'paused', left: secondsLeft(i) });
  else setTimer(i, { state: 'running', end: Date.now() + t.left * 1000 });
}
function timerReset(i) { if (timerBox(i)) setTimer(i, null); }

slides.forEach((s, i) => {
  const box = s.querySelector('.timerbox');
  if (!box) return;
  const old = box.querySelector('button');
  const wrap = document.createElement('div');
  wrap.className = 'tbtns';
  wrap.innerHTML = '<button type="button" class="tb-main">Start timer</button><button type="button" class="tb-reset">Reset</button>';
  if (old) old.replaceWith(wrap); else box.appendChild(wrap);
  wrap.querySelector('.tb-main').onclick = () => timerPrimary(i);
  wrap.querySelector('.tb-reset').onclick = () => timerReset(i);
});
const fmt = sec => { const s = Math.max(0, Math.round(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtSigned = sec => (sec < 0 ? '+' + fmt(-sec) : fmt(sec));

function tick() {
  slides.forEach((s, i) => {
    const box = timerBox(i);
    if (!box) return;
    const t = timers[i];
    const left = secondsLeft(i);
    box.querySelector('.timer').textContent = fmtSigned(left);
    box.classList.toggle('over', !!t && left < 0);
    box.classList.toggle('low', !!t && left >= 0 && left <= 60);
    const main = box.querySelector('.tb-main');
    const reset = box.querySelector('.tb-reset');
    if (main) main.textContent = !t ? 'Start timer' : (t.state === 'running' ? 'Stop' : 'Continue');
    if (reset) reset.hidden = !t || t.state === 'running';
    const cp = box.querySelector('.checkpoint');
    if (cp) {
      const points = (box.dataset.checkpoints || '').split('|').filter(Boolean).map(p => {
        const [at, ...msg] = p.split(':');
        return { at: Number(at), msg: msg.join(':') };
      });
      const hit = t ? points.filter(p => left <= p.at).pop() : null;
      cp.textContent = t && left < 0 ? 'Over time. Wrap up and move on.' : (hit ? hit.msg : (box.dataset.hint || ''));
    }
  });
  if (isPresenter) renderClock();
}
setInterval(tick, 500);
tick();

  // ---------- Sync between audience and presenter windows ----------
  if (channel) {
    channel.onmessage = e => {
      const m = e.data || {};
      if (m.type === 'goto') show(m.idx, true);
      if (m.type === 'timer') setTimer(m.i, m.value, true);
      if (m.type === 'clock') { renderClock(); }
    };
  }

  // ---------- Presenter view ----------
  function clockStart() { return Number(localStorage.getItem('cp-start') || 0); }
  function renderClock() {
    const el = document.getElementById('pv-clock');
    if (!el) return;
    const start = clockStart();
    const planned = Number(slides[idx].dataset.at || 0);
    if (!start) { el.textContent = 'Not started'; document.getElementById('pv-drift').textContent = 'Planned start of this slide: ' + fmt(planned * 60); return; }
    const elapsed = (Date.now() - start) / 1000;
    el.textContent = fmt(elapsed);
    const drift = elapsed / 60 - planned;
    const d = document.getElementById('pv-drift');
    d.textContent = 'Planned start of this slide: ' + fmt(planned * 60) + (Math.abs(drift) >= 1 ? (drift > 0 ? ' (you are ' + Math.round(drift) + ' min behind)' : ' (' + Math.round(-drift) + ' min ahead)') : ' (on time)');
    d.className = drift >= 2 ? 'late' : '';
    const tb = timerBox(idx);
    const pt = document.getElementById('pv-timer');
    if (tb) {
      const t = timers[idx];
      const left = secondsLeft(idx);
      pt.textContent = 'Sprint timer' + (!t ? ' (not started)' : (t.state === 'paused' ? ' (stopped)' : '')) + ': ' + (left < 0 ? fmt(-left) + ' over' : fmtSigned(left));
      document.getElementById('pv-timerbtn').textContent = !t ? 'Start timer (T)' : (t.state === 'running' ? 'Stop timer (T)' : 'Continue timer (T)');
    } else pt.textContent = '';
  }
  function renderPresenter() {
    const s = slides[idx];
    const title = s.dataset.title || (s.querySelector('h2, h1') || {}).textContent || 'Slide ' + (idx + 1);
    const next = slides[idx + 1];
    const nextTitle = next ? (next.dataset.title || (next.querySelector('h2, h1') || {}).textContent || '') : 'End';
    const cue = s.querySelector('.cue');
    const notes = s.querySelector('.notes');
    document.getElementById('pv-title').textContent = (idx + 1) + '. ' + title;
    document.getElementById('pv-meta').textContent = 'Slide ' + (idx + 1) + ' of ' + slides.length + (s.dataset.block ? ' | ' + s.dataset.block : '');
    const cb = document.getElementById('pv-cue');
    cb.style.display = cue ? 'block' : 'none';
    cb.querySelector('div').innerHTML = cue ? cue.innerHTML : '';
    document.getElementById('pv-notes').innerHTML = notes ? notes.innerHTML : '<p>No notes for this slide.</p>';
    document.getElementById('pv-next').textContent = nextTitle;
    renderClock();
  }
  if (isPresenter) {
    document.body.classList.add('presenter');
    document.title = 'Presenter - ' + document.title;
    document.getElementById('pv-prev').onclick = () => show(idx - 1);
    document.getElementById('pv-nextbtn').onclick = () => show(idx + 1);
    document.getElementById('pv-timerbtn').onclick = () => timerPrimary(idx);
    document.getElementById('pv-timerreset').onclick = () => timerReset(idx);
    document.getElementById('pv-start').onclick = () => {
      if (clockStart() && !confirm('Restart the session clock from 0:00?')) return;
      localStorage.setItem('cp-start', String(Date.now()));
      if (channel) channel.postMessage({ type: 'clock' });
      renderClock();
    };
  }

  // ---------- Start on the slide in the URL (#n) ----------
  const fromHash = parseInt((location.hash || '').slice(1), 10);
  show(Number.isFinite(fromHash) ? fromHash - 1 : 0, true);
})();
