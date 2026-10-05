import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, CloudRain, FileText, Headphones, Leaf, Minus, Music2, Pause, Play, Plus, RotateCcw, Settings2, Sprout, Timer, Trash2, Waves, Wind, X } from 'lucide-react';
import { clearMediaStore, deleteMediaBlob, getMediaBlob, migrateLegacyMedia, putMediaBlob, type LegacyMediaRecord } from './media-store';

type Mode = 'focus' | 'short' | 'long';
type Scene = 'Rainy window' | 'Beach' | 'Mountain' | 'Study room';
type Session = { id: string; start: number; end: number; seconds: number; status: 'completed' | 'abandoned' };
type Plant = { id: string; species: string; name: string; seconds: number; plantedAt: number };
type Note = { id: string; title: string; body: string; updatedAt: number; mediaId?: string };
type EventItem = { id: string; subject: string; day: string; start: string; end: string; color: string };
type MediaItem = { id: string; name: string; type: string; size: number };
type LegacyMediaItem = MediaItem & { data?: string };
type Settings = { focus: number; short: number; long: number; scene: Scene; volumes: Record<string, number> };
type Saved = { settings: Settings; sessions: Session[]; plant: Plant | null; notes: Note[]; events: EventItem[]; media: MediaItem[] };
const KEY = 'study-garden-v1';
const defaults = { focus: 25, short: 5, long: 15, scene: 'Rainy window' as Scene, volumes: {} as Record<string, number> };
const plants = [{ species: 'fern', label: 'Lemon fern', detail: 'Unfurls slowly, one frond at a time.' }, { species: 'monstera', label: 'Monstera', detail: 'A patient climber with broad leaves.' }, { species: 'wildflower', label: 'Wildflower', detail: 'Small bright blooms for steady days.' }, { species: 'olive', label: 'Olive sapling', detail: 'A quiet tree that rewards consistency.' }];
const soundscapes = [{ id: 'rain', label: 'Soft rain', Icon: CloudRain }, { id: 'ocean', label: 'Ocean tide', Icon: Waves }, { id: 'wind', label: 'Mountain wind', Icon: Wind }, { id: 'room', label: 'Study room', Icon: Music2 }];
const todayKey = () => new Date().toISOString().slice(0, 10);
const readable = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const dateLabel = (time: number) => new Intl.DateTimeFormat('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(time);
let legacyMediaRecords: LegacyMediaRecord[] = [];
function readSaved(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const storedMedia: LegacyMediaItem[] = Array.isArray(saved.media) ? saved.media : [];
    legacyMediaRecords = storedMedia.filter((item): item is LegacyMediaItem & { data: string } => typeof item.data === 'string').map(item => ({ id: item.id, data: item.data }));
    const media = storedMedia.map(item => ({ id: item.id, name: item.name, type: item.type, size: item.size }));
    return { settings: { ...defaults, ...saved.settings }, sessions: saved.sessions || [], plant: saved.plant || null, notes: saved.notes || [], events: saved.events || [], media };
  } catch { return { settings: defaults, sessions: [], plant: null, notes: [], events: [], media: [] }; }
}
function App() {
  const [saved, setSaved] = useState<Saved>(readSaved);
  const { settings, sessions, plant, notes, events, media } = saved;
  const [mode, setMode] = useState<Mode>('focus');
  const [remaining, setRemaining] = useState(settings.focus * 60);
  const [running, setRunning] = useState(false);
  const [focusView, setFocusView] = useState(false);
  const [away, setAway] = useState(false);
  const [soundsPlaying, setSoundsPlaying] = useState(false);
  const [activeSounds, setActiveSounds] = useState<string[]>([]);
  const [panel, setPanel] = useState<'garden' | 'notes' | 'timetable' | 'settings' | null>(null);
  const [selectedPlant, setSelectedPlant] = useState(plants[0].species);
  const [noteDraft, setNoteDraft] = useState<Note | null>(null);
  const [eventDraft, setEventDraft] = useState<EventItem | null>(null);
  const [weekShift, setWeekShift] = useState(0);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const audioRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);
  const lastTick = useRef(Date.now());
  const sessionStartedAt = useRef<number | null>(null);
  const update = useCallback((patch: Partial<typeof saved>) => setSaved(prev => {
    const next = { ...prev, ...patch };
    return next;
  }), []);
  const latest = useRef({ plant, sessions, update });
  latest.current = { plant, sessions, update };
  useEffect(() => {
    let active = true;
    const migrate = async () => {
      await migrateLegacyMedia(legacyMediaRecords);
      legacyMediaRecords = [];
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        const storedMedia: LegacyMediaItem[] = Array.isArray(stored.media) ? stored.media : [];
        stored.media = storedMedia.map(item => ({ id: item.id, name: item.name, type: item.type, size: item.size }));
        localStorage.setItem(KEY, JSON.stringify(stored));
      }
    };
    void migrate().catch(() => {
      if (active) setMediaError('Could not open older lesson files. Try attaching the file again.');
    }).finally(() => { if (active) setMediaReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!mediaReady) return;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* Saved study data remains available in memory. */ }
  }, [saved, mediaReady]);
  useEffect(() => {
    const id = noteDraft?.mediaId;
    let cancelled = false;
    let objectUrl: string | undefined;
    setMediaUrl('');
    setMediaError('');
    if (!id) { setMediaLoading(false); return; }
    if (!mediaReady) { setMediaLoading(true); return; }
    setMediaLoading(true);
    void getMediaBlob(id).then(blob => {
      if (cancelled) return;
      if (!blob) {
        setMediaError('This lesson file is not available in this browser. Please attach it again.');
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setMediaUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setMediaError('Could not open this lesson file from local browser storage.');
    }).finally(() => { if (!cancelled) setMediaLoading(false); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [noteDraft?.mediaId, mediaReady]);
  const duration = (mode === 'focus' ? settings.focus : mode === 'short' ? settings.short : settings.long) * 60;
  const progress = Math.max(0, Math.min(1, (duration - remaining) / duration));
  const focusedToday = sessions.filter(s => new Date(s.start).toISOString().slice(0, 10) === todayKey()).reduce((t, s) => t + s.seconds, 0);
  const weekly = sessions.filter(s => Date.now() - s.start < 7 * 86400000).reduce((t, s) => t + s.seconds, 0);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      const now = Date.now(), elapsed = Math.max(0, (now - lastTick.current) / 1000);
      lastTick.current = now;
      if (mode === 'focus' && latest.current.plant) setSaved(prev => ({ ...prev, plant: prev.plant ? { ...prev.plant, seconds: prev.plant.seconds + elapsed } : null }));
      setRemaining(prev => {
        const next = prev - elapsed;
        if (next > 0) return next;
        setRunning(false);
        if (mode === 'focus') {
          const end = Date.now();
          const session: Session = { id: crypto.randomUUID(), start: sessionStartedAt.current ?? end - duration * 1000, end, seconds: duration, status: 'completed' };
          latest.current.update({ sessions: [session, ...latest.current.sessions] });
          sessionStartedAt.current = null;
        }
        try { window.navigator.vibrate?.([100, 80, 180]); } catch { /* optional */ }
        return 0;
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [running, duration, mode]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden && running) { setRunning(false); setAway(true); }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [running]);
  useEffect(() => () => { nodesRef.current.forEach(node => { try { node.disconnect(); } catch { /* already disconnected */ } }); audioRef.current?.close(); }, []);

  const setModeTo = (next: Mode) => { setRunning(false); sessionStartedAt.current = null; setMode(next); setRemaining((next === 'focus' ? settings.focus : next === 'short' ? settings.short : settings.long) * 60); };
  const start = () => { if (remaining <= 0) setRemaining(duration); if (mode === 'focus' && (!sessionStartedAt.current || remaining <= 0)) sessionStartedAt.current = Date.now(); lastTick.current = Date.now(); setRunning(true); setAway(false); if (mode === 'focus') setFocusView(true); };
  const reset = () => { setRunning(false); sessionStartedAt.current = null; setRemaining(duration); };
  const finishSession = (status: 'completed' | 'abandoned') => {
    const spent = Math.max(0, duration - remaining);
    if (mode === 'focus' && spent > 0 && remaining > 0) { const end = Date.now(); update({ sessions: [{ id: crypto.randomUUID(), start: sessionStartedAt.current ?? end - spent * 1000, end, seconds: spent, status }, ...sessions] }); }
    sessionStartedAt.current = null;
    setRunning(false); setFocusView(false);
  };
  const changeSettings = (changes: Partial<Settings>) => {
    const next = { ...settings, ...changes }; update({ settings: next });
    if ('focus' in changes && mode === 'focus' && !running) setRemaining(next.focus * 60);
    if ('short' in changes && mode === 'short' && !running) setRemaining(next.short * 60);
    if ('long' in changes && mode === 'long' && !running) setRemaining(next.long * 60);
  };
  const toggleSound = async () => {
    if (soundsPlaying) {
      nodesRef.current.forEach(node => { try { node.disconnect(); } catch { /* no-op */ } }); nodesRef.current = []; setSoundsPlaying(false); return;
    }
    if (!activeSounds.length) return;
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = audioRef.current || new Ctx(); audioRef.current = ctx; await ctx.resume();
    activeSounds.forEach((sound, index) => {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), samples = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < samples.length; i++) { brown = (brown + .025 * (Math.random() * 2 - 1)) / 1.025; samples[i] = brown * 3.4; }
      const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      source.buffer = buffer; source.loop = true;
      filter.type = sound === 'rain' ? 'highpass' : 'lowpass';
      filter.frequency.value = sound === 'rain' ? 680 : sound === 'wind' ? 380 : sound === 'room' ? 230 : 560;
      const vol = (settings.volumes[sound] ?? 30) / 100; gain.gain.value = vol * (sound === 'room' ? .028 : .11);
      source.connect(filter); filter.connect(gain); gain.connect(ctx.destination); source.start(); nodesRef.current.push(source, filter, gain);
      if (sound === 'ocean') {
        const lfo = ctx.createOscillator(), swell = ctx.createGain();
        lfo.frequency.value = .075; swell.gain.value = vol * .025; lfo.connect(swell); swell.connect(gain.gain); lfo.start(); nodesRef.current.push(lfo, swell);
      }
    });
    setSoundsPlaying(true);
  };
  const toggleLayer = (id: string) => setActiveSounds(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  const saveNote = () => {
    if (!noteDraft) return;
    const next = { ...noteDraft, updatedAt: Date.now() };
    const list = notes.some(n => n.id === next.id) ? notes.map(n => n.id === next.id ? next : n) : [next, ...notes];
    update({ notes: list }); setNoteDraft(null);
  };
  const uploadMedia = async (file?: File) => {
    if (!file) return;
    const isPdf = file.type.includes('pdf') || /\.pdf$/i.test(file.name);
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v|avi)$/i.test(file.name);
    if (!isPdf && !isVideo) { window.alert('Choose a PDF or video file. This file type is not supported.'); return; }
    const id = crypto.randomUUID();
    try {
      await putMediaBlob(id, file);
    } catch (error) {
      const isFull = error instanceof DOMException && error.name === 'QuotaExceededError';
      window.alert(isFull
        ? 'Your browser is low on local storage. Remove an older lesson file or choose a smaller one.'
        : 'This browser could not save the lesson file. Check that local storage is available and try again.');
      return;
    }
    const item: MediaItem = { id, name: file.name, type: isPdf ? 'application/pdf' : file.type || 'video/mp4', size: file.size };
    update({ media: [item, ...media] });
    if (noteDraft) setNoteDraft({ ...noteDraft, mediaId: item.id });
    setMediaError('');
  };
  const removeMedia = async () => {
    if (!noteDraft?.mediaId) return;
    try {
      await deleteMediaBlob(noteDraft.mediaId);
    } catch {
      window.alert('Could not remove this lesson file from local browser storage.');
      return;
    }
    update({ media: media.filter(m => m.id !== noteDraft.mediaId) });
    setNoteDraft({ ...noteDraft, mediaId: undefined });
  };
  const plantNow = () => {
    const spec = plants.find(p => p.species === selectedPlant) || plants[0];
    update({ plant: { id: crypto.randomUUID(), species: spec.species, name: spec.label, seconds: 0, plantedAt: Date.now() } });
    setPanel(null);
  };
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7) + weekShift * 7); weekStart.setHours(0, 0, 0, 0);
  const weekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const eventsForWeek = useMemo(() => events.filter(e => weekDates.some(d => d.toISOString().slice(0, 10) === e.day)), [events, weekShift]);
  const hourSlots = Array.from({ length: 13 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`);

  return <main className="garden-app" data-testid="page-study-garden">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Sprout size={19} /></span><span>study garden</span></div>
      <div className="top-meta"><span className="privacy"><span className="privacy-dot" /> Your private study space</span><button className="icon-button" aria-label="Settings" data-testid="open-settings" onClick={() => setPanel('settings')}><Settings2 size={18} /></button></div>
    </header>
    <div className="page-wrap">
      <section className="greeting">
        <div><p className="eyebrow">{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</p><h1>A little room to grow.</h1><p className="subcopy">Settle in, find your rhythm, and let the minutes add up.</p></div>
        <div className="today-chip"><span className="today-icon"><Leaf size={17} /></span><span><strong>{Math.floor(focusedToday / 60)} min</strong><small>rooted today</small></span></div>
      </section>
      {away && <div className="away-banner" role="status" data-testid="status-away"><span>Your garden paused while you were away.</span><button onClick={start} data-testid="button-resume-away">Resume when you’re ready</button><button aria-label="Dismiss pause notice" className="bare-icon" onClick={() => setAway(false)}><X size={16} /></button></div>}
      <section className="main-grid">
        <div className="left-stack">
          <article className={`focus-card scene-${settings.scene.toLowerCase().replace(' ', '-')}`}>
            <div className="scene-art"><div className="scene-moon" /><div className="scene-hill hill-back" /><div className="scene-hill hill-front" /><div className="scene-window"><div className="window-cross" /></div><span className="scene-glow" /></div>
            <div className="focus-content">
              <div className="focus-top"><span className="focus-kicker"><span className="live-dot" /> your quiet corner</span><button className="scene-button" onClick={() => setPanel('settings')} data-testid="button-change-scene"><span>{settings.scene}</span><ChevronRight size={15} /></button></div>
              <div className="timer-display"><span className="mode-label">{remaining === 0 ? 'A lovely bit of progress' : mode === 'focus' ? 'A moment for focus' : mode === 'short' ? 'A little breathing room' : 'A longer pause'}</span><div className="timer-number" data-testid="text-timer">{readable(remaining)}</div><div className="progress-track"><span style={{ transform: `scaleX(${progress})` }} /></div></div>
              <div className="timer-actions">
                <button className="start-button" onClick={running ? () => setRunning(false) : start} data-testid={running ? 'button-pause-timer' : 'button-start-timer'}>{running ? <Pause size={17} fill="currentColor" /> : remaining === 0 ? <RotateCcw size={17} /> : <Play size={17} fill="currentColor" />}<span>{running ? 'Pause' : remaining === 0 ? 'Begin again' : remaining < duration ? 'Resume focus' : 'Begin focus'}</span></button>
                <button className="timer-reset" onClick={reset} aria-label="Reset timer" data-testid="button-reset-timer"><RotateCcw size={16} /></button>
              </div>
              <div className="mode-switch" role="group" aria-label="Timer mode">{(['focus', 'short', 'long'] as Mode[]).map(m => <button key={m} aria-pressed={mode === m} className={mode === m ? 'selected' : ''} onClick={() => setModeTo(m)} data-testid={`mode-${m}`}>{m === 'focus' ? 'Focus' : m === 'short' ? 'Short break' : 'Long break'}</button>)}</div>
            </div>
          </article>
          <article className="card sound-card">
            <div className="card-heading"><div><span className="section-icon sound-icon"><Headphones size={17} /></span><div><h2>Sound garden</h2><p>Layer a little atmosphere.</p></div></div><button className={`sound-play ${soundsPlaying ? 'is-playing' : ''}`} disabled={!activeSounds.length && !soundsPlaying} onClick={toggleSound} aria-label={soundsPlaying ? 'Pause ambient sound' : 'Play ambient sound'} data-testid="button-play-sounds">{soundsPlaying ? <Pause size={15} /> : <Play size={15} />}</button></div>
            <div className="sound-list">{soundscapes.map(({ id, label, Icon }) => <div className={`sound-row ${activeSounds.includes(id) ? 'sound-active' : ''}`} key={id}>
              <button className="sound-select" aria-pressed={activeSounds.includes(id)} onClick={() => toggleLayer(id)} data-testid={`sound-toggle-${id}`}><span className="sound-icon-wrap"><Icon size={17} /></span><span>{label}</span><span className={`sound-check ${activeSounds.includes(id) ? 'checked' : ''}`}>{activeSounds.includes(id) && <Check size={12} />}</span></button>
              <input aria-label={`${label} volume`} type="range" min="0" max="100" value={settings.volumes[id] ?? 30} onChange={e => changeSettings({ volumes: { ...settings.volumes, [id]: Number(e.target.value) } })} data-testid={`volume-${id}`} />
            </div>)}</div>
            <p className="sound-caption"><span className="sound-wave">{soundsPlaying ? '●' : '◌'}</span>{activeSounds.length ? `${activeSounds.length} layer${activeSounds.length > 1 ? 's' : ''} selected · generated here, stays on this device` : 'Choose one or more sounds to build your mix.'}</p>
          </article>
        </div>
        <div className="right-stack">
          <article className="card garden-card">
            <div className="card-heading"><div><span className="section-icon plant-icon"><Sprout size={18} /></span><div><h2>Your garden</h2><p>Focus time, made visible.</p></div></div><button className="text-action" onClick={() => setPanel('garden')} data-testid="button-choose-plant">{plant ? 'Change plant' : 'Choose a plant'}<ChevronRight size={15} /></button></div>
            <div className="plant-landscape">
              {plant ? <><div className={`plant-illustration ${plant.species}`} data-testid="plant-current" aria-label={`${plant.name}, growing`}><span className="stem" /><span className="leaf leaf-one" /><span className="leaf leaf-two" /><span className="leaf leaf-three" /><span className="leaf leaf-four" /><span className="flower" /></div><div className="plant-info"><strong>{plant.name}</strong><span>{plant.seconds < 3600 ? `${Math.floor(plant.seconds / 60)} focused minutes` : `${(plant.seconds / 3600).toFixed(1)} hours`} tended</span><div className="growth-meter"><span style={{ transform: `scaleX(${Math.min(.98, (plant.seconds % 3600) / 3600 + .08)})` }} /></div><small>{plant.seconds < 1800 ? 'Taking root' : plant.seconds < 7200 ? 'Finding its leaves' : 'Growing steadily'}</small></div></> : <div className="garden-empty"><div className="empty-seed"><Sprout size={23} /></div><span>A place for something to grow.</span><button onClick={() => setPanel('garden')} data-testid="button-plant-first">Plant your first seed <Plus size={14} /></button></div>}
              <div className="ground-line" /><span className="tiny-sprout sprout-left">✳</span><span className="tiny-sprout sprout-right">✧</span>
            </div>
            <div className="garden-foot"><span><span className="tiny-leaf" /> Grows only while you’re here, focused.</span><button aria-label="Garden information" title="Your plant grows only during visible focus time." data-testid="button-garden-info"><CircleHelp size={15} /></button></div>
          </article>
          <article className="card stats-card">
            <div className="card-heading"><div><span className="section-icon stats-icon"><Timer size={17} /></span><div><h2>Time well spent</h2><p>A small practice adds up.</p></div></div></div>
            <div className="stats-totals"><div className="stat-total"><span>Today</span><strong data-testid="text-today-total">{Math.floor(focusedToday / 3600)}<small>h</small> {Math.floor(focusedToday % 3600 / 60)}<small>m</small></strong></div><div className="stat-divider" /><div className="stat-total"><span>This week</span><strong data-testid="text-week-total">{Math.floor(weekly / 3600)}<small>h</small> {Math.floor(weekly % 3600 / 60)}<small>m</small></strong></div></div>
            <div className="recent-sessions"><div className="mini-heading"><span>Recent sessions</span><button onClick={() => setPanel('timetable')} data-testid="button-open-timetable">View week <ChevronRight size={13} /></button></div>{sessions.slice(0, 3).length ? sessions.slice(0, 3).map(s => <div className="session-line" key={s.id} data-testid={`session-${s.id}`}><span className={`session-dot ${s.status}`} /><span>{dateLabel(s.start)}</span><strong>{Math.floor(s.seconds / 60)} min</strong><span className={`session-status ${s.status}`}>{s.status === 'completed' ? 'finished' : 'paused early'}</span></div>) : <div className="session-empty"><span>No sessions yet.</span><span>Your first one can be small.</span></div>}</div>
          </article>
          <article className="quick-links">
            <button onClick={() => setPanel('notes')} data-testid="button-open-notes"><span className="quick-icon"><BookOpen size={16} /></span><span><strong>Study notes</strong><small>{notes.length ? `${notes.length} saved` : 'Write alongside a lesson'}</small></span><ChevronRight size={16} /></button>
            <button onClick={() => setPanel('timetable')} data-testid="button-open-schedule"><span className="quick-icon schedule"><CalendarDays size={16} /></span><span><strong>My timetable</strong><small>{events.length ? `${events.length} planned` : 'Make a gentle plan'}</small></span><ChevronRight size={16} /></button>
          </article>
        </div>
      </section>
      <footer className="privacy-footer"><span className="privacy-lock">◈</span><span>Your notes, sessions, and garden stay on this device. Nothing is uploaded.</span><span className="footer-separator">·</span><span>Leaving this tab pauses your focus.</span></footer>
    </div>

    {focusView && <div className={`focus-overlay scene-${settings.scene.toLowerCase().replace(' ', '-')}`} data-testid="focus-view">
      <div className="overlay-art"><div className="scene-moon" /><div className="scene-hill hill-back" /><div className="scene-hill hill-front" /><div className="scene-window"><div className="window-cross" /></div></div>
      <div className="overlay-head"><span className="brand"><span className="brand-mark"><Sprout size={17} /></span>study garden</span><button onClick={() => finishSession('abandoned')} className="exit-focus" data-testid="button-exit-focus"><X size={17} /> Leave focus</button></div>
      <div className="overlay-center"><span className="overlay-kicker"><span className="live-dot" /> {remaining === 0 ? 'a moment well tended' : `${settings.scene} · ${mode === 'focus' ? 'quiet focus' : 'a soft pause'}`}</span><div className="overlay-timer" data-testid="text-focus-timer">{readable(remaining)}</div><div className="overlay-progress"><span style={{ transform: `scaleX(${progress})` }} /></div><p>{remaining === 0 ? 'You kept a promise to yourself. Take a breath before the next thing.' : away ? 'You were away for a moment. Resume only when you feel ready.' : plant ? `Your ${plant.name.toLowerCase()} is growing with you.` : 'One calm minute at a time.'}</p><div className="overlay-controls"><button onClick={running ? () => setRunning(false) : start} data-testid="button-overlay-pause">{running ? <Pause size={18} /> : <Play size={18} />}{running ? 'Pause gently' : remaining === 0 ? 'Begin another session' : 'Resume focus'}</button><button aria-label="Reset timer" onClick={reset} data-testid="button-overlay-reset"><RotateCcw size={17} /></button></div></div>
      <div className="overlay-bottom"><span><span className="privacy-dot" /> Focus pauses when this tab is hidden</span><button onClick={() => { setFocusView(false); setPanel('settings'); }} data-testid="button-overlay-scene">{settings.scene} <ChevronRight size={14} /></button></div>
    </div>}

    {panel && <div className="drawer-scrim" onMouseDown={e => { if (e.target === e.currentTarget) setPanel(null); }}><section className="drawer" role="dialog" aria-modal="true" aria-label={panel === 'garden' ? 'Choose a plant' : panel === 'notes' ? 'Study notes' : panel === 'timetable' ? 'My timetable' : 'Study settings'} data-testid={`drawer-${panel}`}>
      <div className="drawer-head"><div><span className="drawer-eyebrow">STUDY GARDEN</span><h2>{panel === 'garden' ? 'Choose something to grow' : panel === 'notes' ? 'Notes beside your lesson' : panel === 'timetable' ? 'A softer kind of schedule' : 'Your study settings'}</h2></div><button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)} data-testid="button-close-drawer"><X size={18} /></button></div>
      {panel === 'garden' && <div className="drawer-body"><p className="drawer-intro">Your plant grows a little with every visible minute of focus. Pick the one you’d like to tend.</p><div className="plant-choices">{plants.map(p => <button className={`plant-choice ${selectedPlant === p.species ? 'chosen' : ''}`} key={p.species} onClick={() => setSelectedPlant(p.species)} data-testid={`plant-option-${p.species}`}><div className={`choice-plant ${p.species}`}><span className="stem" /><span className="leaf leaf-one" /><span className="leaf leaf-two" /><span className="leaf leaf-three" /><span className="leaf leaf-four" /><span className="flower" /></div><span><strong>{p.label}</strong><small>{p.detail}</small></span><span className="radio-dot">{selectedPlant === p.species && <Check size={12} />}</span></button>)}</div><button className="drawer-primary" onClick={plantNow} data-testid="button-confirm-plant">{plant ? 'Grow this plant' : 'Plant this seed'} <Sprout size={17} /></button></div>}
      {panel === 'settings' && <div className="drawer-body"><p className="drawer-intro">Make your study corner feel right for you. Everything is saved on this device.</p><label className="field-label">Your scene</label><div className="scene-options">{(['Rainy window', 'Beach', 'Mountain', 'Study room'] as Scene[]).map((scene, i) => <button key={scene} className={`scene-option ${settings.scene === scene ? 'selected' : ''}`} onClick={() => changeSettings({ scene })} data-testid={`scene-${scene.toLowerCase().replace(' ', '-')}`}><span className={`scene-swatch swatch-${i}`} />{scene}{settings.scene === scene && <Check size={15} />}</button>)}</div><label className="field-label duration-label">Timer lengths <small>minutes</small></label>{([{ key: 'focus', title: 'Focus session' }, { key: 'short', title: 'Short break' }, { key: 'long', title: 'Long break' }] as const).map(({ key, title }) => <div className="duration-row" key={key}><span>{title}</span><div><button aria-label={`Decrease ${title}`} onClick={() => changeSettings({ [key]: Math.max(1, settings[key] - 1) })} data-testid={`decrease-${key}`}><Minus size={14} /></button><input aria-label={`${title} minutes`} type="number" min="1" max="180" value={settings[key]} onChange={e => changeSettings({ [key]: Math.min(180, Math.max(1, Number(e.target.value) || 1)) })} data-testid={`duration-${key}`} /><button aria-label={`Increase ${title}`} onClick={() => changeSettings({ [key]: Math.min(180, settings[key] + 1) })} data-testid={`increase-${key}`}><Plus size={14} /></button></div></div>)}<div className="privacy-note"><span>◈</span><p><strong>Just yours.</strong> Settings, sessions, notes, and uploaded lesson files are stored locally in your browser. No account, no tracking, no upload.</p></div><button className="drawer-secondary" onClick={async () => { if (window.confirm('Clear all local Study Garden data? This cannot be undone.')) { try { await clearMediaStore(); } catch { window.alert('Could not clear locally stored lesson files. Your study data was kept.'); return; } localStorage.removeItem(KEY); setSaved({ settings: defaults, sessions: [], plant: null, notes: [], events: [], media: [] }); setNoteDraft(null); setMediaUrl(''); setMediaError(''); } }} data-testid="button-clear-data"><Trash2 size={15} /> Clear local data</button></div>}
      {panel === 'notes' && <div className="drawer-body notes-body"><div className="notes-layout"><aside className="note-list"><button className="new-note" onClick={() => setNoteDraft({ id: crypto.randomUUID(), title: '', body: '', updatedAt: Date.now() })} data-testid="button-new-note"><Plus size={15} /> New note</button>{notes.map(n => <button className={`note-list-item ${noteDraft?.id === n.id ? 'current' : ''}`} key={n.id} onClick={() => setNoteDraft(n)} data-testid={`note-item-${n.id}`}><strong>{n.title || 'Untitled note'}</strong><small>{new Date(n.updatedAt).toLocaleDateString()}</small></button>)}</aside><div className="note-editor">{noteDraft ? <><input className="note-title-input" placeholder="A note to keep..." value={noteDraft.title} onChange={e => setNoteDraft({ ...noteDraft, title: e.target.value })} data-testid="input-note-title" /><textarea className="note-textarea" placeholder="Write what you’re learning, questions to revisit, or a thought worth keeping…" value={noteDraft.body} onChange={e => setNoteDraft({ ...noteDraft, body: e.target.value })} data-testid="input-note-body" /><div className="lesson-media"><div className="media-heading"><div><strong>Lesson material</strong><small>PDF or video · stays on this device</small></div><label className="upload-label" htmlFor="lesson-upload" role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('lesson-upload')?.click(); } }} data-testid="label-upload-media"><Plus size={14} /> Add file</label><input id="lesson-upload" type="file" accept="video/*,application/pdf,.pdf" onChange={e => { void uploadMedia(e.target.files?.[0]); e.currentTarget.value = ''; }} data-testid="input-upload-media" /></div>{noteDraft.mediaId && mediaUrl ? <div className="media-preview">{media.find(m => m.id === noteDraft.mediaId)?.type.includes('pdf') ? <iframe src={mediaUrl} title="PDF lesson preview" /> : <video src={mediaUrl} controls /> }<div><span>{media.find(m => m.id === noteDraft.mediaId)?.name}</span><button onClick={() => { void removeMedia(); }} aria-label="Remove attached file" data-testid="button-remove-media"><Trash2 size={15} /></button></div></div> : mediaLoading ? <p className="media-empty" role="status"><FileText size={18} /> Opening your lesson file…</p> : mediaError ? <p className="media-empty" role="status"><FileText size={18} /> {mediaError}</p> : <p className="media-empty"><FileText size={18} /> Add a PDF or video to keep your notes beside the lesson.</p>}</div><div className="note-actions">{notes.some(n => n.id === noteDraft.id) && <button className="delete-note" onClick={async () => { if (window.confirm('Delete this note?')) { if (noteDraft.mediaId) { try { await deleteMediaBlob(noteDraft.mediaId); } catch { window.alert('Could not remove this lesson file from local browser storage.'); return; } } update({ notes: notes.filter(n => n.id !== noteDraft.id), media: media.filter(m => m.id !== noteDraft.mediaId) }); setNoteDraft(null); } }} data-testid="button-delete-note"><Trash2 size={15} /> Delete</button>}<button className="save-note" onClick={saveNote} data-testid="button-save-note">Save note <Check size={15} /></button></div></> : <div className="notes-empty"><BookOpen size={25} /><strong>A quiet page to begin.</strong><span>Make a note while you learn.</span><button onClick={() => setNoteDraft({ id: crypto.randomUUID(), title: '', body: '', updatedAt: Date.now() })} data-testid="button-create-first-note">Write your first note</button></div>}</div></div></div>}
      {panel === 'timetable' && <div className="drawer-body schedule-body"><div className="week-controls"><button onClick={() => setWeekShift(weekShift - 1)} aria-label="Previous week" data-testid="button-previous-week"><ChevronLeft size={17} /></button><strong>{weekDates[0].toLocaleDateString('en', { month: 'short', day: 'numeric' })} — {weekDates[6].toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}</strong><button onClick={() => setWeekShift(weekShift + 1)} aria-label="Next week" data-testid="button-next-week"><ChevronRight size={17} /></button><button className="today-button" onClick={() => setWeekShift(0)} data-testid="button-this-week">This week</button><button className="add-event" onClick={() => setEventDraft({ id: crypto.randomUUID(), subject: '', day: todayKey(), start: '09:00', end: '10:00', color: 'sage' })} data-testid="button-add-event"><Plus size={15} /> Add</button></div><div className="week-strip">{weekDates.map(d => <button key={d.toISOString()} className={`week-day ${d.toDateString() === new Date().toDateString() ? 'today' : ''}`} onClick={() => { setEventDraft({ id: crypto.randomUUID(), subject: '', day: d.toISOString().slice(0, 10), start: '09:00', end: '10:00', color: 'sage' }); }} data-testid={`day-${d.toISOString().slice(0, 10)}`}><small>{d.toLocaleDateString('en', { weekday: 'short' })}</small><strong>{d.getDate()}</strong></button>)}</div>{eventDraft && <form className="event-form" onSubmit={e => { e.preventDefault(); if (!eventDraft.subject.trim()) return; update({ events: events.some(x => x.id === eventDraft.id) ? events.map(x => x.id === eventDraft.id ? eventDraft : x) : [...events, eventDraft] }); setEventDraft(null); }}><div className="event-form-title"><strong>{events.some(x => x.id === eventDraft.id) ? 'Edit a study plan' : 'Plan a study moment'}</strong><button type="button" aria-label="Close event form" onClick={() => setEventDraft(null)}><X size={15} /></button></div><input required placeholder="Subject or intention" value={eventDraft.subject} onChange={e => setEventDraft({ ...eventDraft, subject: e.target.value })} data-testid="input-event-subject" /><div className="event-fields"><label>Date<input type="date" value={eventDraft.day} onChange={e => setEventDraft({ ...eventDraft, day: e.target.value })} data-testid="input-event-day" /></label><label>From<input type="time" value={eventDraft.start} onChange={e => setEventDraft({ ...eventDraft, start: e.target.value })} data-testid="input-event-start" /></label><label>Until<input type="time" value={eventDraft.end} onChange={e => setEventDraft({ ...eventDraft, end: e.target.value })} data-testid="input-event-end" /></label></div><button className="save-note" type="submit" data-testid="button-save-event">Save to week <Check size={15} /></button></form>}<div className="timeline">{hourSlots.map(hour => <div className="timeline-row" key={hour}><span>{hour}</span><div>{eventsForWeek.filter(e => e.start.slice(0, 2) === hour.slice(0, 2)).map(e => <div className={`event-chip ${e.color}`} key={e.id}><button className="event-edit" onClick={() => setEventDraft(e)} data-testid={`edit-event-${e.id}`}><strong>{e.subject}</strong><small>{e.day.slice(5)} · {e.start} – {e.end}</small></button><button aria-label={`Delete ${e.subject}`} onClick={() => { if (window.confirm(`Remove ${e.subject} from your timetable?`)) update({ events: events.filter(x => x.id !== e.id) }); }} data-testid={`delete-event-${e.id}`}><Trash2 size={14} /></button></div>)}</div></div>)}</div>{!eventsForWeek.length && <div className="schedule-empty"><CalendarDays size={22} /><span>A little space for what matters.</span><small>Add a study block whenever you’re ready.</small></div>}<p className="schedule-foot">A plan is a gentle invitation, not a promise.</p></div>}
    </section></div>}
  </main>;
}
export default App;
