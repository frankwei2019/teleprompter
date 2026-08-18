import { invoke } from '@tauri-apps/api/core';

type PrompterSettings = {
  scrollSpeed: number;
  fontSize: number;
  bgTransparency: number;
  fontColor: string;
  mirrorMode: boolean;
  loopPlayback: boolean;
};

type Prompt = {
  id: string;
  title: string;
  text: string;
};

type WindowSize = 'small' | 'medium' | 'large';

type PrompterState = {
  prompts: Prompt[];
  currentIndex: number;
  settings: PrompterSettings;
  windowSize: WindowSize;
};

const STORAGE_KEY = 'prompter-state';

const SIZES: Record<WindowSize, { width: number; height: number; label: string }> = {
  small:  { width: 600,  height: 400, label: '小' },
  medium: { width: 800,  height: 480, label: '中' },
  large:  { width: 1200, height: 720, label: '大' },
};

const DEFAULT_STATE: PrompterState = {
  prompts: [{ id: 'default', title: '预设 1', text: '' }],
  currentIndex: 0,
  settings: {
    scrollSpeed: 30,
    fontSize: 48,
    bgTransparency: 70,
    fontColor: '#ffffff',
    mirrorMode: false,
    loopPlayback: true,
  },
  windowSize: 'medium',
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultTitle(text: string): string {
  const first = text.split('\n')[0].trim();
  if (!first) return '新预设';
  return first.length > 20 ? first.slice(0, 20) + '…' : first;
}

function migrate(parsed: any): PrompterState {
  if (parsed && typeof parsed.text === 'string' && !Array.isArray(parsed.prompts)) {
    return {
      prompts: [{ id: genId(), title: defaultTitle(parsed.text), text: parsed.text }],
      currentIndex: 0,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings ?? {}) },
      windowSize: parsed.windowSize ?? DEFAULT_STATE.windowSize,
    };
  }
  return {
    prompts: Array.isArray(parsed?.prompts) && parsed.prompts.length > 0
      ? parsed.prompts.map((p: any) => ({
          id: typeof p?.id === 'string' ? p.id : genId(),
          title: typeof p?.title === 'string' ? p.title : defaultTitle(p?.text ?? ''),
          text: typeof p?.text === 'string' ? p.text : '',
        }))
      : [...DEFAULT_STATE.prompts],
    currentIndex: typeof parsed?.currentIndex === 'number'
      ? Math.max(0, Math.min(parsed.currentIndex, (parsed.prompts?.length ?? 1) - 1))
      : 0,
    settings: { ...DEFAULT_STATE.settings, ...(parsed?.settings ?? {}) },
    windowSize: parsed?.windowSize ?? DEFAULT_STATE.windowSize,
  };
}

function loadState(): PrompterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    return migrate(JSON.parse(raw));
  } catch {
    return cloneDefault();
  }
}

function cloneDefault(): PrompterState {
  return {
    prompts: [{ id: genId(), title: '预设 1', text: '' }],
    currentIndex: 0,
    settings: { ...DEFAULT_STATE.settings },
    windowSize: DEFAULT_STATE.windowSize,
  };
}

function saveState(s: PrompterState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
  }
}

export type { PrompterSettings, PrompterState, Prompt, WindowSize };
export { loadState, saveState, DEFAULT_STATE, SIZES };

const state: PrompterState = loadState();

function currentPrompt(): Prompt {
  return state.prompts[state.currentIndex];
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

function applyVisualSettings(settings: PrompterSettings) {
  const scrollContent = $('scrollContent') as HTMLDivElement;
  scrollContent.style.fontSize = `${settings.fontSize}px`;
  scrollContent.style.color = settings.fontColor;
  scrollContent.style.lineHeight = '1.4';
  scrollContent.classList.toggle('mirrored', settings.mirrorMode);
  document.documentElement.style.setProperty('--bg-alpha', String(1 - settings.bgTransparency / 100));
}

function renderPromptsList() {
  const list = $('promptsList') as HTMLDivElement;
  list.innerHTML = '';
  state.prompts.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'prompt-row' + (idx === state.currentIndex ? ' active' : '');

    const title = document.createElement('button');
    title.className = 'prompt-title';
    title.textContent = `${idx + 1}. ${p.title || '未命名'}`;
    title.title = '点击切换到此预设';
    title.addEventListener('click', () => switchPrompt(idx));

    const rename = document.createElement('button');
    rename.className = 'prompt-rename';
    rename.textContent = '✎';
    rename.title = '重命名';
    rename.addEventListener('click', () => renamePrompt(idx));

    const del = document.createElement('button');
    del.className = 'prompt-delete';
    del.textContent = '×';
    del.title = '删除';
    del.disabled = state.prompts.length <= 1;
    del.addEventListener('click', () => deletePrompt(idx));

    row.append(title, rename, del);
    list.appendChild(row);
  });
}

function renderControlBar() {
}

function paintUI() {
  const p = currentPrompt();
  ($('textInput') as HTMLTextAreaElement).value = p.text;
  ($('scrollContent') as HTMLDivElement).textContent = p.text;
  ($('speedSlider') as HTMLInputElement).value = String(state.settings.scrollSpeed);
  ($('speedValue') as HTMLSpanElement).textContent = String(state.settings.scrollSpeed);
  ($('fontSizeSlider') as HTMLInputElement).value = String(state.settings.fontSize);
  ($('fontSizeValue') as HTMLSpanElement).textContent = String(state.settings.fontSize);
  ($('bgSlider') as HTMLInputElement).value = String(state.settings.bgTransparency);
  ($('bgValue') as HTMLSpanElement).textContent = String(state.settings.bgTransparency);
  ($('mirrorToggle') as HTMLInputElement).checked = state.settings.mirrorMode;
  ($('loopToggle') as HTMLInputElement).checked = state.settings.loopPlayback;
  document.querySelectorAll('.swatch').forEach((el) => {
    const btn = el as HTMLButtonElement;
    btn.classList.toggle('active', btn.dataset.color === state.settings.fontColor);
  });
  applyVisualSettings(state.settings);
  renderPromptsList();
  renderControlBar();
  updatePlayPauseButton();
}

function updateSwatchActive() {
  document.querySelectorAll('.swatch').forEach((el) => {
    const btn = el as HTMLButtonElement;
    btn.classList.toggle('active', btn.dataset.color === state.settings.fontColor);
  });
}

function showStatus(msg: string) {
  const el = $('status') as HTMLDivElement;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}

// Visible version marker so users can verify which build they installed
// (download caching of the old apk made it look like nothing changed).
// APP_VERSION and BUILD_DATE are hardcoded at build time — the date is NOT the
// runtime clock, so a user can trust it reflects the actual packaged build.
const APP_VERSION = 'v1.5.1';
const BUILD_DATE = '2026-08-18';
function renderVersion() {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = `词悬浮 ${APP_VERSION} · 构建 ${BUILD_DATE}`;
  const helpVer = document.getElementById('helpVersion');
  if (helpVer) helpVer.textContent = `版本 ${APP_VERSION}`;
  const bd = document.getElementById('buildDate');
  if (bd) bd.textContent = BUILD_DATE;
}

function switchPrompt(idx: number) {
  if (idx < 0 || idx >= state.prompts.length) return;
  if (idx === state.currentIndex) return;
  cancelCountdown();
  pauseScroll();
  resetScroll();
  state.currentIndex = idx;
  saveState(state);
  paintUI();
  showStatus(`已切换: ${currentPrompt().title}`);
}

function addPrompt() {
  pauseScroll();
  resetScroll();
  const newPrompt: Prompt = { id: genId(), title: '新预设', text: '' };
  state.prompts.push(newPrompt);
  state.currentIndex = state.prompts.length - 1;
  saveState(state);
  paintUI();
  showStatus(`已新建预设 (共 ${state.prompts.length})`);
}

function deletePrompt(idx: number) {
  if (state.prompts.length <= 1) {
    showStatus('至少保留一个预设');
    return;
  }
  state.prompts.splice(idx, 1);
  if (state.currentIndex >= state.prompts.length) {
    state.currentIndex = state.prompts.length - 1;
  } else if (idx < state.currentIndex) {
    state.currentIndex--;
  }
  pauseScroll();
  resetScroll();
  saveState(state);
  paintUI();
  showStatus(`已删除 (剩 ${state.prompts.length})`);
}

function renamePrompt(idx: number) {
  const p = state.prompts[idx];
  const next = window.prompt('重命名预设', p.title);
  if (next === null) return;
  p.title = next.trim() || p.title;
  saveState(state);
  renderPromptsList();
}

function prevPrompt() {
  if (state.currentIndex > 0) switchPrompt(state.currentIndex - 1);
  resetAndCountdown();
}

function nextPrompt() {
  if (state.currentIndex < state.prompts.length - 1) switchPrompt(state.currentIndex + 1);
  resetAndCountdown();
}

function toggleSettings() {
  const panel = $('settingsPanel') as HTMLDivElement;
  const btn = $('settingsToggle') as HTMLButtonElement;
  const willHide = !panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed', willHide);
  btn.classList.toggle('active', !willHide);
  document.body.classList.toggle('settings-open', !willHide);
}

let scrolling = false;
let scrollOffset = 0;
let lastFrameTime = 0;
let rafId: number | null = null;

// --- Display-area interaction: click to pause/resume, drag up/down to fast-scroll ---
let pointerDown = false;
let pointerStartY = 0;
let pointerStartOffset = 0;
let isPointerDragging = false;
const DRAG_THRESHOLD = 6;     // px of motion before mousedown becomes a drag
const DRAG_MULTIPLIER = 1.5;  // drag distance → scroll distance

function paintScrollOffset(): void {
  const content = $('scrollContent') as HTMLDivElement;
  const mirror = state.settings.mirrorMode ? ' scaleX(-1)' : '';
  content.style.transform = `translateY(${-scrollOffset}px)${mirror}`;
}

function getMaxOffset(): number {
  const scrollArea = $('scrollArea') as HTMLDivElement;
  const content = $('scrollContent') as HTMLDivElement;
  return content.scrollHeight + scrollArea.clientHeight;
}

function attachScrollInteraction(): void {
  const scrollAreaEl = $('scrollArea') as HTMLDivElement;
  scrollAreaEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // left button only
    pointerDown = true;
    isPointerDragging = false;
    pointerStartY = e.clientY;
    pointerStartOffset = scrollOffset;
  });
  scrollAreaEl.addEventListener('mousemove', (e) => {
    if (!pointerDown) return;
    const dy = e.clientY - pointerStartY;
    if (!isPointerDragging && Math.abs(dy) > DRAG_THRESHOLD) {
      isPointerDragging = true;
      pauseScroll(); // drag overrides auto-scroll
    }
    if (isPointerDragging) {
      // Drag up (negative dy) → forward (advance, scrollOffset increases);
      // drag down → backward (rewind, scrollOffset decreases)
      const max = getMaxOffset();
      const next = pointerStartOffset - dy * DRAG_MULTIPLIER;
      scrollOffset = Math.max(0, Math.min(max, next));
      paintScrollOffset();
    }
  });
  document.addEventListener('mouseup', () => {
    if (pointerDown && !isPointerDragging) {
      // Pure click (no drag) → toggle play/pause
      togglePlayPause();
    }
    pointerDown = false;
    isPointerDragging = false;
  });
}

function step(now: number) {
  if (!scrolling) return;
  const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;
  scrollOffset += state.settings.scrollSpeed * dt;
  const scrollArea = $('scrollArea') as HTMLDivElement;
  const content = $('scrollContent') as HTMLDivElement;
  const maxOffset = content.scrollHeight + scrollArea.clientHeight;
  if (scrollOffset >= maxOffset) {
    if (state.settings.loopPlayback && maxOffset > 0) {
      scrollOffset = 0;
    } else {
      scrollOffset = Math.max(0, maxOffset);
      scrolling = false;
      updatePlayPauseButton();
    }
  }
  const mirror = state.settings.mirrorMode ? ' scaleX(-1)' : '';
  content.style.transform = `translateY(${-scrollOffset}px)${mirror}`;
  if (scrolling) rafId = requestAnimationFrame(step);
}

function startScroll() {
  if (!currentPrompt().text.trim()) {
    showStatus('请输入或导入提示词文本');
    return;
  }
  scrolling = true;
  lastFrameTime = 0;
  rafId = requestAnimationFrame(step);
  updatePlayPauseButton();
}

function pauseScroll() {
  scrolling = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  updatePlayPauseButton();
}

function resetScroll() {
  pauseScroll();
  scrollOffset = 0;
  const content = $('scrollContent') as HTMLDivElement;
  const mirror = state.settings.mirrorMode ? ' scaleX(-1)' : '';
  content.style.transform = `translateY(0px)${mirror}`;
}

let countdownTimer: number | null = null;

function cancelCountdown() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function resetAndCountdown() {
  if (!currentPrompt().text.trim()) {
    showStatus('请输入或导入提示词文本');
    return;
  }
  resetScroll();
  cancelCountdown();

  const overlay = $('countdownOverlay') as HTMLDivElement;
  let count = 3;
  overlay.textContent = String(count);
  overlay.hidden = false;
  overlay.style.animation = 'none';
  void overlay.offsetWidth;
  overlay.style.animation = '';

  countdownTimer = window.setInterval(() => {
    count--;
    if (count > 0) {
      overlay.textContent = String(count);
      overlay.style.animation = 'none';
      void overlay.offsetWidth;
      overlay.style.animation = '';
    } else {
      cancelCountdown();
      overlay.hidden = true;
      startScroll();
    }
  }, 1000);
}

function togglePlayPause() {
  if (scrolling) pauseScroll();
  else startScroll();
}

function updatePlayPauseButton() {
  const btn = $('playPauseBtn') as HTMLButtonElement;
  btn.textContent = scrolling ? '⏸' : '▶';
  btn.title = scrolling ? '暂停' : '播放';
  btn.classList.toggle('playing', scrolling);
}

// On Windows desktop, default to the legacy v1.0.0 layout (settings panel
// collapsed, compact drag-handle/control-bar, transparent background so the
// window blends with the desktop). Android keeps the modern expanded layout.
if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')) {
  document.body.classList.add('windows');
  document.documentElement.classList.add('windows');
  const sp = $('settingsPanel') as HTMLDivElement | null;
  if (sp) sp.classList.add('collapsed');
}

paintUI();
attachScrollInteraction();
renderVersion();

$('closeBtn').addEventListener('click', () => invoke('exit_app'));

$('helpBtn').addEventListener('click', () => {
  // buildDate is already set by renderVersion() at startup from the hardcoded
  // BUILD_DATE; do not overwrite it with the runtime clock.
  ($('helpModal') as HTMLDivElement).hidden = false;
});
$('helpClose').addEventListener('click', () => {
  ($('helpModal') as HTMLDivElement).hidden = true;
});
$('settingsToggle').addEventListener('click', toggleSettings);

$('resetBtn').addEventListener('click', resetAndCountdown);
$('prevBtn').addEventListener('click', prevPrompt);
$('playPauseBtn').addEventListener('click', togglePlayPause);
$('nextBtn').addEventListener('click', nextPrompt);

$('addPromptBtn').addEventListener('click', addPrompt);

const textInput = $('textInput') as HTMLTextAreaElement;
textInput.addEventListener('input', () => {
  const p = currentPrompt();
  p.text = textInput.value;
  ($('scrollContent') as HTMLDivElement).textContent = p.text;
  if (p.title === '预设 1' || p.title === '新预设' || p.title === '未命名') {
    p.title = defaultTitle(p.text);
    renderPromptsList();
  }
  saveState(state);
});

function persistAndApply() {
  saveState(state);
  applyVisualSettings(state.settings);
}

const speedSlider = $('speedSlider') as HTMLInputElement;
speedSlider.addEventListener('input', () => {
  state.settings.scrollSpeed = Number(speedSlider.value);
  ($('speedValue') as HTMLSpanElement).textContent = speedSlider.value;
  persistAndApply();
});

const fontSizeSlider = $('fontSizeSlider') as HTMLInputElement;
fontSizeSlider.addEventListener('input', () => {
  state.settings.fontSize = Number(fontSizeSlider.value);
  ($('fontSizeValue') as HTMLSpanElement).textContent = fontSizeSlider.value;
  persistAndApply();
});

const bgSlider = $('bgSlider') as HTMLInputElement;
bgSlider.addEventListener('input', () => {
  state.settings.bgTransparency = Number(bgSlider.value);
  ($('bgValue') as HTMLSpanElement).textContent = bgSlider.value;
  persistAndApply();
});

document.querySelectorAll('.swatch').forEach((el) => {
  const btn = el as HTMLButtonElement;
  btn.addEventListener('click', () => {
    state.settings.fontColor = btn.dataset.color ?? '#ffffff';
    updateSwatchActive();
    persistAndApply();
  });
});

const mirrorToggle = $('mirrorToggle') as HTMLInputElement;
mirrorToggle.addEventListener('change', () => {
  state.settings.mirrorMode = mirrorToggle.checked;
  persistAndApply();
});

const loopToggle = $('loopToggle') as HTMLInputElement;
loopToggle.addEventListener('change', () => {
  state.settings.loopPlayback = loopToggle.checked;
  saveState(state);
});

async function importFile() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const selected = await open({
      multiple: false,
      filters: [{ name: '文本文件', extensions: ['txt', 'md'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    const MAX_BYTES = 1024 * 1024;
    const text = await readTextFile(selected);
    if (text.length > MAX_BYTES) {
      showStatus('文件过大，请使用 ≤1MB 的文件');
      return;
    }
    const p = currentPrompt();
    p.text = text;
    p.title = defaultTitle(text);
    textInput.value = text;
    ($('scrollContent') as HTMLDivElement).textContent = text;
    resetScroll();
    saveState(state);
    renderPromptsList();
    const filename = selected.split(/[\\/]/).pop() ?? selected;
    showStatus(`已导入 ${filename} → "${p.title}"`);
  } catch (err) {
    showStatus(`读取失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

$('importBtn').addEventListener('click', importFile);

async function startFloating() {
  const p = currentPrompt();
  if (!p.text.trim()) {
    showStatus('请先输入文本');
    return;
  }
  const s = state.settings;
  // bgTransparency: 0=完全不透明黑底, 100=完全透明（只剩文字浮在所有 App 上）
  const payload = [
    p.text.replace(/\x1F/g, ' '),
    String(s.fontSize),
    s.fontColor,
    String(s.scrollSpeed),
    String(s.bgTransparency)  // 直接传 0-100，不再 100- 翻转
  ].join('\x1F');
  try {
    // Permission state is checked inside Kotlin (MainActivity.onFloatingBridgeCall):
    // if overlay permission is missing it opens the system settings and shows a toast.
    await invoke('floating_bridge', { action: 'start', payload });
    showStatus('✓ 已请求启动悬浮窗（若无权限会跳转设置，开启后再次点击）');
  } catch (e) {
    showStatus('启动失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}
$('startFloatingBtn')?.addEventListener('click', startFloating);
