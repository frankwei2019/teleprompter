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

type PrompterState = {
  prompts: Prompt[];
  currentIndex: number;
  settings: PrompterSettings;
};

const STORAGE_KEY = 'prompter-state';

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
  };
}

function saveState(s: PrompterState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
  }
}

export type { PrompterSettings, PrompterState, Prompt };
export { loadState, saveState, DEFAULT_STATE };

const state: PrompterState = loadState();

const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

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

    const imp = document.createElement('button');
    imp.className = 'prompt-import';
    imp.textContent = '📂';
    imp.title = '导入文件到此预设';
    imp.addEventListener('click', () => importFile(idx));

    row.append(title, rename, imp, del);
    list.appendChild(row);
  });
}

function paintUI() {
  const p = currentPrompt();
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
// APP_VERSION and BUILD_DATE are both injected at build time via vite define
// (see src/globals.d.ts). APP_VERSION comes from tauri.conf.json, so what the
// UI shows is always the version actually stamped into the package.
const APP_VERSION = `v${__APP_VERSION__}`;
function renderVersion() {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = `词悬浮 ${APP_VERSION} · 构建 ${__BUILD_DATE__}`;
  const helpVer = document.getElementById('helpVersion');
  if (helpVer) helpVer.textContent = `版本 ${APP_VERSION}`;
  const bd = document.getElementById('buildDate');
  if (bd) bd.textContent = __BUILD_DATE__;
}

function switchPrompt(idx: number) {
  if (idx < 0 || idx >= state.prompts.length) return;
  if (idx === state.currentIndex) return;
  syncTextFromScreen();
  cancelCountdown();
  pauseScroll();
  resetScroll();
  state.currentIndex = idx;
  saveState(state);
  paintUI();
  showStatus(`已切换: ${currentPrompt().title}`);
}

function addPrompt() {
  syncTextFromScreen();
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
  syncTextFromScreen();
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
  syncTextFromScreen();
  const p = state.prompts[idx];
  const next = window.prompt('重命名预设', p.title);
  if (next === null) return;
  p.title = next.trim() || p.title;
  saveState(state);
  renderPromptsList();
}

function prevPrompt() {
  // 已在第一条时直接返回：switchPrompt 自己会 no-op，但 resetAndCountdown
  // 仍会倒数 3 秒重播当前这条，看起来像卡住了。
  if (state.currentIndex <= 0) return;
  switchPrompt(state.currentIndex - 1);
  resetAndCountdown();
}

function nextPrompt() {
  if (state.currentIndex >= state.prompts.length - 1) return;
  switchPrompt(state.currentIndex + 1);
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

// 强制收起设置面板（进入悬浮模式时调用）
function collapseSettings(): void {
  const panel = $('settingsPanel') as HTMLDivElement;
  const btn = $('settingsToggle') as HTMLButtonElement;
  if (panel.classList.contains('collapsed')) return;
  panel.classList.add('collapsed');
  btn.classList.remove('active');
  document.body.classList.remove('settings-open');
  ($('scrollArea') as HTMLDivElement).style.flex = '';
}

// 悬浮按钮外观随 floating 变化（按钮自带 inline style，必须直接改 style 才盖得住）
// 用「文字 + 配色」双重区分，避免只靠颜色分不清状态
function updateFloatingButton(): void {
  // $() 找不到元素会直接抛错、不会返回 null —— 原来的 null 判断是死代码
  const btn = $('startFloatingBtn') as HTMLButtonElement;
  if (floating) {
    btn.textContent = '退出悬浮';
    // 半透明琥珀底：能透出背后内容，不糊住文字；字改用浅黄保证可读
    btn.style.background = 'rgba(251, 191, 36, 0.28)';
    btn.style.borderColor = 'rgba(251, 191, 36, 0.8)';
    btn.style.color = '#ffd66b';
    btn.style.fontWeight = 'bold';
    btn.title = '退出悬浮（停止滚动并进入编辑状态）';
  } else {
    btn.textContent = '悬浮';
    btn.style.background = 'rgba(74, 158, 255, 0.4)';
    btn.style.borderColor = 'rgba(74, 158, 255, 0.7)';
    btn.style.color = 'white';
    btn.style.fontWeight = 'bold';
    btn.title = '悬浮模式（置顶、收起设置，并直接开始滚动）';
  }
}

let scrolling = false;
// Windows 悬浮模式：窗口置顶 + 设置自动收起 + 播放中（拖动快滚有效）。
// 退出悬浮时回到编辑态。Android 不使用此标记（那里是系统悬浮窗 + 原窗缩成小圆）。
let floating = false;
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
  // Pointer Events handle both mouse and touch in one code path. Android
  // WebView does NOT fire mousedown on touch, so the original mouse-only
  // listeners were inert on phones — using pointer events fixes both.
  scrollAreaEl.addEventListener('pointerdown', (e) => {
    // 暂停（编辑）态：把触摸/点击交给浏览器处理（光标、选词、原生滚动），不要抢占
    if (document.body.classList.contains('editing')) return;
    // Touch on scrollArea: let the WebView scroll natively if the user is
    // just flicking through text. We only take over on pointerdown for the
    // PRIMARY button / first finger.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerDown = true;
    isPointerDragging = false;
    pointerStartY = e.clientY;
    pointerStartOffset = scrollOffset;
    // Capture so we keep getting move/up events even if the finger leaves
    // the scrollArea (e.g. over the control bar).
    try {
      scrollAreaEl.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already released;
      // safe to ignore.
    }
  });
  scrollAreaEl.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    const dy = e.clientY - pointerStartY;
    if (!isPointerDragging && Math.abs(dy) > DRAG_THRESHOLD) {
      isPointerDragging = true;
      // Android 维持原行为；Windows 拖动快滚只暂停自动滚动，不回编辑态
      if (isWindows) pauseAutoScroll();
      else pauseScroll(); // drag overrides auto-scroll
      // Prevent the WebView from interpreting the gesture as a vertical
      // scroll/swipe once we've taken it over for fast-scroll.
      e.preventDefault();
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
  const endDrag = (e: PointerEvent) => {
    if (!pointerDown) return;
    // Only treat as a tap if the pointer that ended was the one we captured.
    if (e.pointerId !== undefined) {
      try { scrollAreaEl.releasePointerCapture(e.pointerId); } catch {}
    }
    if (pointerDown && !isPointerDragging) {
      // Pure click/tap (no drag) → toggle play/pause
      togglePlayPause();
    }
    pointerDown = false;
    isPointerDragging = false;
  };
  scrollAreaEl.addEventListener('pointerup', endDrag);
  scrollAreaEl.addEventListener('pointercancel', endDrag);
  // Some Android WebViews still fire mouse* events for the very first tap
  // before the pointer events stream takes over. Keeping these as a no-op
  // safety net so a stray mousedown doesn't double-toggle.
  scrollAreaEl.addEventListener('mousedown', (e) => {
    if (!document.body.classList.contains('editing')) e.preventDefault();
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
      // 滚到头且未开循环：必须回到编辑态。只置 scrolling=false 会停在
      // 「既不在滚、也不能编辑」的状态，此时点屏幕会重新 startScroll 又立刻
      // 撞到末尾停下，用户会以为卡死。
      pauseScroll();
    }
  }
  const mirror = state.settings.mirrorMode ? ' scaleX(-1)' : '';
  content.style.transform = `translateY(${-scrollOffset}px)${mirror}`;
  if (scrolling) rafId = requestAnimationFrame(step);
}

// --- 屏上编辑：暂停时滚动屏变成可直接编辑的文本块，可原生滚动浏览全文；
// 播放（滚动）时恢复绝对定位 + 位移的显示模式。 ---
function setEditMode(on: boolean): void {
  const content = $('scrollContent') as HTMLDivElement;
  const area = $('scrollArea') as HTMLDivElement;
  content.contentEditable = on ? 'true' : 'false';
  document.body.classList.toggle('editing', on);
  if (on) area.scrollTop = 0;
  // Windows：一旦回到编辑态就视为退出悬浮，避免按钮状态与实际不一致
  // （例如悬浮中点屏暂停进入编辑后，再按悬浮键应能重新进入悬浮）
  if (on && isWindows && floating) {
    floating = false;
    updateFloatingButton();
  }
}

function syncTextFromScreen(): void {
  const content = $('scrollContent') as HTMLDivElement;
  if (content.contentEditable !== 'true') return; // 仅在暂停编辑态生效
  const p = currentPrompt();
  let t = content.innerText.replace(/ /g, ' ');
  t = t.replace(/[\s ]+$/, ''); // 去掉结尾多余空行
  if (t !== p.text) {
    p.text = t;
    if (['预设 1', '新预设', '未命名'].includes(p.title)) {
      p.title = defaultTitle(p.text);
      renderPromptsList();
    }
    saveState(state);
  }
}

function startScroll() {
  syncTextFromScreen();
  if (!currentPrompt().text.trim()) {
    showStatus('请输入或修改提示词文本');
    return;
  }
  scrolling = true;
  lastFrameTime = 0;
  rafId = requestAnimationFrame(step);
  setEditMode(false);
  updatePlayPauseButton();
}

function pauseScroll() {
  scrolling = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  setEditMode(true);
  updatePlayPauseButton();
}

// 仅暂停自动滚动、不进入编辑态——Windows 拖动快滚专用，避免拖动时误回编辑
function pauseAutoScroll() {
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
if (isWindows) {
  document.body.classList.add('windows');
  document.documentElement.classList.add('windows');
  const sp = $('settingsPanel') as HTMLDivElement | null;
  if (sp) sp.classList.add('collapsed');
}

paintUI();
setEditMode(true);
attachScrollInteraction();
renderVersion();

$('closeBtn').addEventListener('click', () => invoke('exit_app'));

$('helpBtn').addEventListener('click', () => {
  // buildDate is already set by renderVersion() at startup from the build-time
  // injected __BUILD_DATE__; do not overwrite it with the runtime clock.
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

async function importFile(targetIdx: number) {
  try {
    syncTextFromScreen();
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const selected = await open({
      multiple: false,
      filters: [{ name: '文本文件', extensions: ['txt', 'md'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    const MAX_BYTES = 1024 * 1024;
    const text = await readTextFile(selected);
    // 按 UTF-8 字节数算，不能用 text.length —— 那是字符数，中文一字占 3 字节，
    // 会把 1MB 的上限悄悄放大到约 3MB。
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_BYTES) {
      showStatus(`文件过大（${(bytes / 1024 / 1024).toFixed(1)} MB），请使用 ≤1MB 的文件`);
      return;
    }
    const p = state.prompts[targetIdx];
    p.text = text;
    p.title = defaultTitle(text);
    state.currentIndex = targetIdx;
    resetScroll();
    saveState(state);
    paintUI();
    const filename = selected.split(/[\\/]/).pop() ?? selected;
    showStatus(`已导入 ${filename} → "${p.title}"`);
  } catch (err) {
    showStatus(`读取失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 窗口置顶：单独 try，失败也不影响悬浮状态的切换与按钮反馈
async function trySetAlwaysOnTop(on: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setAlwaysOnTop(on);
  } catch {
    if (on) showStatus('提示：窗口置顶未生效（悬浮其余功能正常）');
  }
}

async function startFloating() {
  syncTextFromScreen();
  const p = currentPrompt();
  if (!p.text.trim()) {
    showStatus('请先输入文本');
    return;
  }
  // --- Windows：单窗悬浮模式（始终 1 个窗，置顶播放，不新增悬浮窗）---
  if (isWindows) {
    if (!floating) {
      collapseSettings();            // 自动隐藏设置窗
      floating = true;
      scrollOffset = 0;              // 每次进入悬浮都从开头滚
      paintScrollOffset();
      startScroll();                 // 立即开始滚动，不用先按播放
      updateFloatingButton();        // 先更新按钮状态，保证点了就有反馈
      showStatus('✓ 悬浮模式：设置已收起，正在滚动（拖动可快滚）');
      void trySetAlwaysOnTop(true);  // 置顶放最后：失败也不影响上面
    } else {
      floating = false;
      pauseScroll();                 // 停止滚动 → 进入编辑状态
      updateFloatingButton();
      showStatus('已退出悬浮，进入编辑状态');
      void trySetAlwaysOnTop(false);
    }
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
updateFloatingButton();
