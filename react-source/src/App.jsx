import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { CARDS } from "./cards.js";

// Lesson 0 is the Starter unit (colours, numbers, characters, first words).
const LESSONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const lessonName = (n) => (n === 0 ? "Starter" : `Lesson ${n}`);
const lessonShort = (n) => (n === 0 ? "S" : String(n));
const STORE_KEY = "pu0-flashcards";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}
function savePrefs(p) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) {}
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Pronunciation (Web Speech API) ----
// The app picks the best voice on the device by itself. For young learners we want a clear,
// natural-sounding British woman's voice; browsers don't label gender, so we go by voice names.
const FEMALE = /\b(female|Libby|Sonia|Maisie|Hazel|Susan|Serena|Kate|Stephanie|Martha|Amy|Emma|Olivia|Samantha|Karen|Moira|Tessa|Fiona|Victoria|Allison|Ava|Zira|Aria|Jenny|Michelle|Natasha|Clara|Emily|Joanna|Salli|Kendra|Kimberly|Ivy|Catherine|Hayley|Google US English|en-gb-x-gba|en-gb-x-gbc|en-gb-x-gbg)\b/i;
const MALE = /\b(male|Daniel|Arthur|George|Ryan|Thomas|Oliver|Alfie|Elliot|Noah|Ethan|Guy|David|Mark|Alex|Fred|Aaron|Rishi|Gordon|Lee|Tom|Eric|Brian|Christopher|Davis|Roger|Steffan|Tony|Liam|William|James|Mitchell|en-gb-x-gbb|en-gb-x-gbd|en-gb-x-rjs)\b/i;

function isFemale(v) {
  return FEMALE.test(v.name) && !MALE.test(v.name.replace(/female/gi, ""));
}
function voiceScore(v) {
  const lang = (v.lang || "").toLowerCase().replace("_", "-");
  let s = lang === "en-gb" ? 30 : lang.startsWith("en") ? 10 : -100; // British English first
  if (isFemale(v)) s += 20;                                            // warm woman's voice
  else if (MALE.test(v.name)) s -= 20;
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 15; // most natural-sounding
  else if (/google/i.test(v.name)) s += 8;
  if (/espeak|compact/i.test(v.name)) s -= 10;                         // robotic voices last
  return s;
}
function bestVoice(all) {
  const best = all.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  return best && voiceScore(best) > -50 ? best : null; // no English voice: let the browser choose
}

function useSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const voiceRef = useRef(null);

  useEffect(() => {
    if (!supported) return;
    const load = () => { voiceRef.current = bestVoice(window.speechSynthesis.getVoices()); };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  // speaking: null | "normal" | "slow" — lets the button light up while the word plays.
  const [speaking, setSpeaking] = useState(null);
  const [error, setError] = useState("");

  const say = useCallback((text, slow) => {
    if (!supported) {
      setError("This browser can't read words aloud. Try Chrome, Edge or Safari.");
      return;
    }
    setError("");
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    if (voiceRef.current) u.voice = voiceRef.current;
    // A little slower than normal speech so children hear every sound.
    u.rate = slow ? 0.55 : 0.85;
    // Slightly brighter tone; a bit more if the device has no woman's voice.
    u.pitch = voiceRef.current && isFemale(voiceRef.current) ? 1.05 : 1.2;
    const mode = slow ? "slow" : "normal";
    u.onstart = () => setSpeaking(mode);
    u.onend = () => setSpeaking(null);
    u.onerror = (e) => {
      setSpeaking(null);
      if (e.error !== "interrupted" && e.error !== "canceled") {
        setError("The word couldn't be played. Check that your sound is on and try again.");
      }
    };
    setSpeaking(mode);
    // A short delay after cancel() avoids a Chrome bug where the next word is silently dropped.
    setTimeout(() => {
      if (synth.paused) synth.resume();
      synth.speak(u);
      // Some browsers never fire onend; reset the button once nothing is playing.
      const check = setInterval(() => {
        if (!synth.speaking && !synth.pending) {
          clearInterval(check);
          setSpeaking((m) => (m === mode ? null : m));
        }
      }, 400);
    }, 60);
  }, [supported]);
  return { supported, say, speaking, error };
}

// ---- Voice check (Web Speech API: SpeechRecognition) ----
// The child says the word; we compare what the browser heard with the card and react.
const NUM_WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty"];
// Words that sound the same, so recognition may return the other spelling.
const SOUNDS_LIKE = {
  one: ["won"], two: ["to", "too"], four: ["for", "fore"], eight: ["ate"], ten: ["tan"],
  blue: ["blew"], red: ["read"], no: ["know"], write: ["right"], see: ["sea"], eye: ["i"],
  hair: ["hare"], bear: ["bare"], there: ["their"], here: ["hear"], pear: ["pair"], son: ["sun"],
  sun: ["son"], tail: ["tale"], whale: ["wale"], knee: ["nee"], nose: ["knows"], meet: ["meat"],
};
const PRAISE = ["Great job!", "Well done!", "Perfect!", "Super!", "Brilliant!", "Fantastic!"];
const TRY_AGAIN = ["Almost! Try again.", "Not quite. Try again!", "Good try! Say it once more."];

function tokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/\d+/g, (d) => " " + (NUM_WORDS[+d] || d) + " ")
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Kind to young learners: "a dog" counts for "dog", homophones count, and one slip
// in a long word (5+ letters) is forgiven because speech recognition isn't perfect.
function matches(heard, target) {
  const want = tokens(target).join("");
  if (!want) return false;
  const words = tokens(heard);
  const joined = words.join("");
  const alts = [want, ...(SOUNDS_LIKE[want] || [])];
  if (alts.includes(joined)) return true;
  return words.some((w) => alts.includes(w) || (want.length >= 5 && editDistance(w, want) <= 1));
}

// Short happy chime / soft "boop", made with the Web Audio API (no sound files needed).
function playTone(ok) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = ok ? [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]] : [[330, 0], [262, 0.18]];
    notes.forEach(([freq, t]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = ok ? "triangle" : "sine";
      o.frequency.value = freq;
      const at = ctx.currentTime + t;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
      o.connect(g); g.connect(ctx.destination);
      o.start(at); o.stop(at + 0.3);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (e) {}
}

// status: "idle" | "listening" | "correct" | "wrong" | "error"
function useListen() {
  const Rec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const recRef = useRef(null);
  const [state, setState] = useState({ status: "idle", heard: "", msg: "", n: 0 });

  const stop = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    if (r) { r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (e) {} }
  }, []);
  const reset = useCallback(() => { stop(); setState((s) => ({ status: "idle", heard: "", msg: "", n: s.n })); }, [stop]);

  const listen = useCallback((target) => {
    if (!Rec) {
      setState((s) => ({ ...s, status: "error", heard: "", msg: "Voice check needs Chrome, Edge or Safari." }));
      return;
    }
    stop();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel(); // don't hear our own voice
    const r = new Rec();
    r.lang = "en-GB";
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 5;
    let done = false;
    const fail = (msg) => { done = true; setState((s) => ({ ...s, status: "error", heard: "", msg })); };
    r.onresult = (e) => {
      done = true;
      const alts = Array.from(e.results[0] || []).map((a) => a.transcript);
      const ok = alts.some((a) => matches(a, target));
      playTone(ok);
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      setState((s) => ({ status: ok ? "correct" : "wrong", heard: alts[0] || "", msg: ok ? pick(PRAISE) : pick(TRY_AGAIN), n: s.n + 1 }));
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") fail("The microphone is blocked. Allow it in your browser, then try again.");
      else if (e.error === "no-speech") fail("I didn't hear anything. Tap the microphone and try again!");
      else if (e.error === "audio-capture") fail("No microphone found.");
      else if (e.error === "network") fail("Voice check needs an internet connection.");
      else fail("Voice check didn't work. Please try again.");
    };
    r.onend = () => {
      if (recRef.current === r) recRef.current = null;
      if (!done) fail("I didn't hear anything. Tap the microphone and try again!");
    };
    recRef.current = r;
    setState((s) => ({ ...s, status: "listening", heard: "", msg: "" }));
    try { r.start(); } catch (e) { fail("Voice check didn't work. Please try again."); }
  }, [Rec, stop]);

  useEffect(() => stop, [stop]);
  return { listen, reset, ...state };
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h3c4 0 6 10 10 10h5M18 14l3 3-3 3M3 17h3c1.6 0 2.8-1.6 3.9-3.5M13.6 9.2C14.4 8 15.2 7 16 7h5M18 4l3 3-3 3" />
    </svg>
  );
}
function Arrow({ dir }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}
    </svg>
  );
}

export default function App() {
  const saved = loadPrefs();
  const [selected, setSelected] = useState(saved?.selected?.length ? saved.selected : [1]);
  const [frontSide, setFrontSide] = useState(saved?.frontSide || "picture"); // "picture" | "word"
  const [autoSay, setAutoSay] = useState(saved?.autoSay ?? false);
  const [order, setOrder] = useState(null); // null = book order; array of ids = shuffled
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const { say, speaking, error: speechError } = useSpeech();
  const voice = useListen();
  const resetVoice = voice.reset;

  useEffect(() => savePrefs({ selected, frontSide, autoSay }), [selected, frontSide, autoSay]);

  const pool = useMemo(
    () => CARDS.filter((c) => selected.includes(c.lesson)),
    [selected]
  );
  const deck = useMemo(() => {
    if (!order) return pool;
    const byId = new Map(pool.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)).filter(Boolean);
  }, [pool, order]);

  // When the lesson selection changes, start the deck again.
  useEffect(() => {
    setOrder((o) => (o ? shuffleArray(pool.map((c) => c.id)) : null));
    setIndex(0);
    setFlipped(false);
  }, [pool]);

  const card = deck[index];

  // A new card starts with a clean voice check.
  useEffect(() => { resetVoice(); }, [card && card.id, resetVoice]);

  const go = useCallback((delta) => {
    if (!deck.length) return;
    setFlipped(false);
    setIndex((i) => (i + delta + deck.length) % deck.length);
  }, [deck.length]);

  const flip = useCallback(() => setFlipped((f) => !f), []);

  const doShuffle = () => {
    setOrder(shuffleArray(pool.map((c) => c.id)));
    setIndex(0);
    setFlipped(false);
  };
  const resetOrder = () => {
    setOrder(null);
    setIndex(0);
    setFlipped(false);
  };

  const toggleLesson = (n) => {
    setSelected((s) => {
      if (s.includes(n)) return s.length === 1 ? s : s.filter((x) => x !== n);
      return [...s, n].sort((a, b) => a - b);
    });
  };
  const allSelected = selected.length === LESSONS.length;
  const selectAll = () => setSelected(allSelected ? [selected[0] ?? 1] : LESSONS.slice());

  // Say the word automatically when the word side becomes visible.
  const wordVisible = (frontSide === "word") !== flipped;
  useEffect(() => {
    if (autoSay && wordVisible && card) say(card.word);
  }, [autoSay, wordVisible, card, say]);

  // Keyboard: ← → navigate, Space flips, P pronounces, M listens.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest && e.target.closest("input, select, textarea")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === " " && !(e.target.tagName === "BUTTON")) { e.preventDefault(); flip(); }
      else if (e.key.toLowerCase() === "p" && card) say(card.word);
      else if (e.key.toLowerCase() === "m" && card) voice.listen(card.word);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, flip, say, card, voice.listen]);

  // Swipe on touch screens.
  const touch = useRef(null);
  const onTouchStart = (e) => { touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touch.current == null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  };

  const countFor = (n) => CARDS.filter((c) => c.lesson === n).length;

  const picture = card && (
    <span className="face face-picture">
      <img src={card.img} alt={frontSide === "picture" && !flipped ? "Flashcard picture" : card.word} draggable="false" />
    </span>
  );
  const word = card && (
    <span className="face face-word">
      <span className={"word" + (card.word.length > 11 ? " long" : "")}>{card.word}</span>
    </span>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i style={{ background: "var(--c-blue)" }} />
            <i style={{ background: "var(--c-red)" }} />
            <i style={{ background: "var(--c-yellow)" }} />
          </span>
          <div>
            <h1>Power Up 0 Flashcards</h1>
            <p className="sub">{CARDS.length} picture cards · Starter + Lessons 1–9</p>
          </div>
        </div>
      </header>

      <section className="picker" aria-label="Choose lessons">
        <div className="picker-head">
          <h2>Lessons</h2>
          <button type="button" className="link" onClick={selectAll}>
            {allSelected ? "Clear" : "Select all"}
          </button>
        </div>
        <div className="chips">
          {LESSONS.map((n) => {
            const on = selected.includes(n);
            return (
              <button
                key={n}
                id={`lesson-${n}`}
                type="button"
                className={"chip l" + n + (on ? " on" : "")}
                aria-pressed={on}
                onClick={() => toggleLesson(n)}
                title={`${lessonName(n)} · ${countFor(n)} cards`}
              >
                <span className="chip-num">{lessonShort(n)}</span>
                <span className="chip-label">{n === 0 ? "Starter" : "Lesson"}</span>
              </button>
            );
          })}
        </div>
      </section>

      {deck.length > 0 && (
        <section className="strip" aria-label="Cards in this deck">
          <h2>In this deck</h2>
          <div className="thumbs">
            {deck.map((c, i) => (
              <button
                type="button"
                key={c.id}
                className={"thumb" + (i === index ? " current" : "")}
                onClick={() => { setIndex(i); setFlipped(false); }}
                aria-label={`Go to card ${i + 1}`}
                title={c.word}
              >
                <img src={c.img} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      )}

      <main className="stage">
        <div className="deck-bar">
          <span className="count">
            <b>{deck.length ? index + 1 : 0}</b> / {deck.length}
            <span className="muted"> {order ? "· shuffled" : "· book order"}</span>
          </span>
          <div className="bar-actions">
            <button type="button" id="shuffle" className={"pill" + (order ? " active" : "")} onClick={doShuffle}>
              <ShuffleIcon /> {order ? "Shuffle again" : "Shuffle"}
            </button>
            {order && (
              <button type="button" className="pill ghost" onClick={resetOrder}>Book order</button>
            )}
          </div>
        </div>

        <div className="progress" aria-hidden="true">
          <span style={{ width: deck.length ? `${((index + 1) / deck.length) * 100}%` : 0 }} />
        </div>

        {card ? (
          <div className={"card-wrap" + (voice.status === "correct" || voice.status === "wrong" ? " " + voice.status : "")} key={card.id} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <button
              type="button"
              className={"card" + (flipped ? " flipped" : "")}
              onClick={flip}
              aria-label={flipped || frontSide === "word" ? `Card: ${card.word}. Click to flip.` : "Card picture. Click to flip and see the word."}
            >
              <span className="card-inner">
                <span className="side front">
                  <span className={"tag l" + card.lesson}>{lessonShort(card.lesson)}</span>
                  {frontSide === "picture" ? picture : word}
                </span>
                <span className="side back">
                  <span className={"tag l" + card.lesson}>{lessonShort(card.lesson)}</span>
                  {frontSide === "picture" ? word : picture}
                </span>
              </span>
            </button>
          </div>
        ) : (
          <p className="empty">Pick at least one lesson to start.</p>
        )}

        {card && (
          <p className="translation" lang="bg">
            <span className="translation-label">БГ</span>
            {card.bg}
          </p>
        )}

        <div className="controls">
          <button type="button" className="round" onClick={() => go(-1)} aria-label="Previous card">
            <Arrow dir="left" />
          </button>
          <button
            type="button"
            id="say-it"
            className={"say" + (speaking === "normal" ? " speaking" : "")}
            onClick={() => card && say(card.word)}
            disabled={!card}
            aria-pressed={speaking === "normal"}
            title="Hear the word (P)"
          >
            <SpeakerIcon /> {speaking === "normal" ? "Saying…" : "Say it"}
          </button>
          <button
            type="button"
            id="check-voice"
            className={"mic" + (voice.status === "listening" ? " listening" : "")}
            onClick={() => card && voice.listen(card.word)}
            disabled={!card}
            aria-pressed={voice.status === "listening"}
            title="Say the word and check it (M)"
          >
            <MicIcon /> {voice.status === "listening" ? "Listening…" : "Say it yourself"}
          </button>
          <button type="button" className="round" onClick={() => go(1)} aria-label="Next card">
            <Arrow dir="right" />
          </button>
        </div>
        <div className={"feedback " + voice.status} role="status" aria-live="polite">
          {voice.status === "listening" && <><span className="emoji">🎤</span> Listening… say the word!</>}
          {voice.status === "correct" && <><span className="emoji">🎉</span> {voice.msg} <b>{card && card.word}</b></>}
          {voice.status === "wrong" && (
            <>
              <span className="emoji">🤔</span> {voice.msg}
              {voice.heard && <span className="heard">I heard “{voice.heard}”</span>}
            </>
          )}
          {voice.status === "error" && voice.msg}
        </div>
        {voice.status === "correct" && (
          <div className="confetti" key={voice.n} aria-hidden="true">
            {Array.from({ length: 18 }, (_, i) => (
              <i key={i} style={{ "--a": `${(i / 18) * 360}deg`, "--d": `${90 + (i % 4) * 28}px`, "--c": ["#3d8fd9", "#d9363a", "#7cbb2c", "#f2c418", "#ef7d1e", "#8a3fa0"][i % 6] }} />
            ))}
          </div>
        )}
        {speechError && <p className="speech-error" role="status">{speechError}</p>}
        <p className="hint">Tap the card to flip · ← → to move · Space flips · P says the word · M checks your voice</p>
      </main>

      <section className="options" aria-label="Options">
        <div className="seg" role="group" aria-label="Show first">
          <span className="seg-label">Show first</span>
          <button type="button" id="front-picture" aria-pressed={frontSide === "picture"} onClick={() => { setFrontSide("picture"); setFlipped(false); }}>Picture</button>
          <button type="button" id="front-word" aria-pressed={frontSide === "word"} onClick={() => { setFrontSide("word"); setFlipped(false); }}>Word</button>
        </div>
        <label className="toggle" htmlFor="auto-say">
          <input id="auto-say" type="checkbox" checked={autoSay} onChange={(e) => setAutoSay(e.target.checked)} />
          <span className="track"><span /></span>
          Say the word when it appears
        </label>
      </section>

    </div>
  );
}
