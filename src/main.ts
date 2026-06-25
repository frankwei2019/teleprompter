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
    bgTransparency: 30,
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
}

let scrolling = false;
let scrollOffset = 0;
let lastFrameTime = 0;
let rafId: number | null = null;

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

paintUI();

$('closeBtn').addEventListener('click', () => invoke('exit_app'));

$('helpBtn').addEventListener('click', () => {
  const d = new Date();
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  ($('buildDate') as HTMLSpanElement).textContent = ds;
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
