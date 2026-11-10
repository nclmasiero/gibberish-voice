import { DEFAULT_VOICE, presets, speak, type PresetName, type Speech, type Voice } from '../src/index.js';
import { Creature, hueForPitch } from './creature.js';

type VoiceState = Required<Voice>;
type KnobKey = keyof VoiceState;

interface Knob {
  key: KnobKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  log?: boolean;
  format: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const KNOBS: Knob[] = [
  { key: 'pitch', label: 'Pitch', hint: 'How high the voice sits.', min: 40, max: 700, step: 1, log: true, format: (v) => `${Math.round(v)} Hz` },
  { key: 'size', label: 'Size', hint: 'Throat size. Bigger sounds big, not just low.', min: 0.5, max: 2, step: 0.01, format: (v) => `${v.toFixed(2)}×` },
  { key: 'rate', label: 'Rate', hint: 'Talking speed.', min: 0.25, max: 3, step: 0.01, format: (v) => `${v.toFixed(2)}×` },
  { key: 'melody', label: 'Melody', hint: 'From flat and robotic to sing-song.', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'breathiness', label: 'Breathiness', hint: 'From a clear voice to a whisper.', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'roughness', label: 'Roughness', hint: 'Grit and growl.', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'shakiness', label: 'Shakiness', hint: 'From steady to quavering, like an old or scared voice.', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'mouth', label: 'Mouth', hint: 'Mutter through closed lips, or speak up clearly.', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'volume', label: 'Volume', hint: '', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'seed', label: 'Seed', hint: 'Same line, different take.', min: 0, max: 99, step: 1, format: (v) => String(Math.round(v)) },
];

const NAMES: Record<PresetName, string> = {
  man: 'Man',
  woman: 'Woman',
  child: 'Child',
  elder: 'Elder',
  orc: 'Orc',
  giant: 'Giant',
  goblin: 'Goblin',
  fairy: 'Fairy',
  pirate: 'Pirate',
  robot: 'Robot',
  ghost: 'Ghost',
  sage: 'Sage',
};

const LINES: Record<PresetName, string> = {
  man: 'Morning! The road north is clear, but keep your sword close.',
  woman: "Oh, you're back! Did you find the lantern I asked about?",
  child: 'Mister, mister! Can you help me find my frog? His name is Biscuit!',
  elder: 'In my day... we walked to the castle. Uphill. Both ways.',
  orc: 'You smell like elf. Pay the toll, or GO AROUND.',
  giant: 'Tiny... person. Why... are you... standing on my foot?',
  goblin: 'Shiny shiny! You buy? Very good price, only slightly cursed!',
  fairy: 'Over here! The mushrooms are glowing again, come and see!',
  pirate: "Arr, the treasure be buried where the moon don't shine, savvy?",
  robot: 'Greetings, traveller. Your request has been processed. Have a pleasant day.',
  ghost: 'Who disturbs my rest... leave this place... while you still can...',
  sage: 'The answer you seek is not in the book, young one. It is in the question.',
};
const EXTRA_LINES = [
  'Have you seen my cat? She ran off again, the little rascal.',
  'Welcome to my shop! Everything is half price, except the things you want.',
  'I used to be a hero, you know. Then I took a nap.',
  'Hmm... interesting. Very interesting. Tell me more?',
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textarea = $<HTMLTextAreaElement>('line');
const typed = $<HTMLParagraphElement>('typed');
const dialogue = $<HTMLDivElement>('dialogue');
const nametag = $<HTMLSpanElement>('nametag');
const castEl = $<HTMLDivElement>('cast');
const knobsEl = $<HTMLDivElement>('knobs');
const codeEl = $<HTMLElement>('code');

const fullVoice = (v: Voice): VoiceState => ({ ...DEFAULT_VOICE, volume: 0.8, ...v });

let preset: PresetName | null = 'orc';
let voice: VoiceState = fullVoice(presets.orc);
textarea.value = LINES.orc;

const creature = new Creature($<HTMLCanvasElement>('creature'), voice);

// ---- Audio --------------------------------------------------------------------

let audio: { ctx: AudioContext; analyser: AnalyserNode } | null = null;
let current: Speech | null = null;
let backToEdit: number | undefined;

function ensureAudio() {
  if (audio) return audio;
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.connect(ctx.destination);
  creature.attach(analyser);
  audio = { ctx, analyser };
  return audio;
}

function showTyped(text: string, caret: boolean) {
  typed.replaceChildren(document.createTextNode(text));
  if (caret) {
    const c = document.createElement('span');
    c.className = 'caret';
    typed.append(c);
  }
}

function say() {
  const { ctx, analyser } = ensureAudio();
  current?.stop();
  clearTimeout(backToEdit);
  const text = textarea.value.trim() || LINES[preset ?? 'man'];
  let shown = '';
  dialogue.classList.add('is-speaking');
  showTyped('', true);

  const speech = speak(text, {
    ...voice,
    context: ctx,
    destination: analyser,
    onChar: (char) => {
      shown += char;
      showTyped(shown, true);
    },
  });
  current = speech;
  speech.done.then(() => {
    if (current !== speech) return;
    showTyped(text, false);
    backToEdit = window.setTimeout(() => {
      if (current === speech) endSpeaking();
    }, 1200);
  });
}

function endSpeaking() {
  current = null;
  dialogue.classList.remove('is-speaking');
}

// Clicking the box mid-line skips to the end, like in a game.
typed.addEventListener('click', () => {
  current?.stop();
  endSpeaking();
  textarea.focus();
});

textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    say();
  }
});
$('speak').addEventListener('click', say);

let extra = 0;
$('shuffle').addEventListener('click', () => {
  const pool = [...(preset ? [LINES[preset]] : []), ...EXTRA_LINES, ...Object.values(LINES)];
  const unique = [...new Set(pool)].filter((l) => l !== textarea.value);
  textarea.value = unique[extra++ % unique.length]!;
  say();
});

// ---- Knobs ----------------------------------------------------------------------

const toSlider = (k: Knob, v: number) =>
  k.log ? (Math.log(v / k.min) / Math.log(k.max / k.min)) * 1000 : v;
const fromSlider = (k: Knob, s: number) => (k.log ? k.min * (k.max / k.min) ** (s / 1000) : s);

const inputs = new Map<KnobKey, { input: HTMLInputElement; output: HTMLOutputElement; knob: Knob }>();

for (const knob of KNOBS) {
  const id = `knob-${knob.key}`;
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  wrap.innerHTML = `
    <label for="${id}">${knob.label}</label>
    <output for="${id}"></output>
    <input id="${id}" type="range" />
    ${knob.hint ? `<p class="hint">${knob.hint}</p>` : ''}`;
  const input = wrap.querySelector('input')!;
  const output = wrap.querySelector('output')!;
  if (knob.log) {
    input.min = '0';
    input.max = '1000';
    input.step = '1';
  } else {
    input.min = String(knob.min);
    input.max = String(knob.max);
    input.step = String(knob.step);
  }
  input.addEventListener('input', () => {
    voice = { ...voice, [knob.key]: fromSlider(knob, Number(input.value)) };
    preset = null;
    sync();
  });
  // Audition the change when the slider is released.
  input.addEventListener('change', say);
  knobsEl.append(wrap);
  inputs.set(knob.key, { input, output, knob });
}

function syncKnobs(v: VoiceState) {
  for (const { input, output, knob } of inputs.values()) {
    const s = toSlider(knob, v[knob.key]);
    input.value = String(s);
    const lo = knob.log ? 0 : knob.min;
    const hi = knob.log ? 1000 : knob.max;
    input.style.setProperty('--fill', `${((s - lo) / (hi - lo)) * 100}%`);
    output.value = knob.format(v[knob.key]);
  }
}

// ---- Cast -----------------------------------------------------------------------

const castButtons = new Map<PresetName, HTMLButtonElement>();
for (const name of Object.keys(presets) as PresetName[]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.style.setProperty('--swatch', `hsl(${hueForPitch(presets[name].pitch)} 70% 60%)`);
  b.innerHTML = `<span class="swatch"></span>${NAMES[name]}`;
  b.addEventListener('click', () => choose(name));
  castEl.append(b);
  castButtons.set(name, b);
}

let tween = 0;
function choose(name: PresetName) {
  preset = name;
  const from = { ...voice };
  const to = fullVoice({ ...presets[name], seed: 0, volume: voice.volume });
  textarea.value = LINES[name];
  const start = performance.now();
  const id = ++tween;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Sliders glide to the new voice so you can see what changed.
  const step = (now: number) => {
    if (id !== tween) return;
    const t = reduce ? 1 : Math.min(1, (now - start) / 380);
    const e = 1 - (1 - t) ** 3;
    const mid = { ...to };
    for (const k of Object.keys(to) as KnobKey[]) mid[k] = from[k] + (to[k] - from[k]) * e;
    syncKnobs(mid);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  voice = to;
  sync(false);
  say();
}

// ---- Code snippet ---------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function renderCode() {
  const raw = textarea.value.trim() || '…';
  const line = raw.length > 42 ? `${raw.slice(0, 40)}…` : raw;
  const str = `<span class="str">'${esc(line.replace(/'/g, "\\'"))}'</span>`;
  let body: string;
  if (preset) {
    body = `speak(${str}, presets.${preset});`;
  } else {
    const fields = KNOBS.map((k) => {
      const v = voice[k.key];
      const n = k.key === 'pitch' || k.key === 'seed' ? Math.round(v) : Math.round(v * 100) / 100;
      return `  <span class="key">${k.key}:</span> <span class="num">${n}</span>,`;
    }).join('\n');
    body = `speak(${str}, {\n${fields}\n});`;
  }
  const imports = preset ? '{ speak, presets }' : '{ speak }';
  codeEl.innerHTML = `import ${imports} from <span class="str">'gibberish-voice'</span>;\n\n${body}`;
}

function sync(updateKnobs = true) {
  if (updateKnobs) syncKnobs(voice);
  creature.setVoice(voice);
  nametag.textContent = preset ? NAMES[preset] : 'Custom';
  nametag.style.backgroundColor = `hsl(${hueForPitch(voice.pitch)} 85% 68%)`;
  for (const [name, b] of castButtons) b.setAttribute('aria-checked', String(name === preset));
  renderCode();
}

textarea.addEventListener('input', renderCode);

// ---- Copy buttons ----------------------------------------------------------------

async function copy(text: string, el: HTMLElement, label?: string) {
  try {
    await navigator.clipboard.writeText(text);
    if (label) {
      el.textContent = 'Copied';
      setTimeout(() => (el.textContent = label), 1400);
    } else {
      el.setAttribute('data-copied', '');
      setTimeout(() => el.removeAttribute('data-copied'), 1400);
    }
  } catch {
    /* Clipboard unavailable (insecure context); nothing to do. */
  }
}

const install = document.querySelector<HTMLButtonElement>('.install')!;
install.addEventListener('click', () => copy(install.dataset.copy!, install));
const copyCode = $<HTMLButtonElement>('copy-code');
copyCode.addEventListener('click', () => copy(codeEl.textContent ?? '', copyCode, 'Copy'));

sync();
