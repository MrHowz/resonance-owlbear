import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import Fuse from 'fuse.js';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  CloudRain,
  Disc3,
  Ellipsis,
  FileJson,
  FolderInput,
  Headphones,
  Heart,
  Layers3,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat2,
  Search,
  Settings2,
  ShieldCheck,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { DEFAULT_PREFS, ref, type Bus, type Cue, type Kind, type Track } from '../core/model';
import * as library from '../core/library';
import { parseTrack } from '../core/validation';
import { sampleTracks } from '../core/samples';
import { useDesk } from './useDesk';
import { PlaybackProgress } from './PlaybackProgress';
import { SmoothSlider } from './SmoothSlider';

const kindLabel = { music: 'Music', ambience: 'Ambience', sfx: 'Sound effect' };
const KindIcon = ({ kind, size = 18 }: { kind: Kind; size?: number }) =>
  kind === 'ambience' ? (
    <CloudRain size={size} />
  ) : kind === 'sfx' ? (
    <Zap size={size} />
  ) : (
    <Music2 size={size} />
  );
type Tab = 'library' | 'scenes' | 'session';
function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      className={`modal ${wide ? 'wide' : ''}`}
      ref={dialog}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function App() {
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const onError = useCallback((text: string) => notify(text, true), [notify]);
  const { bridge, status, connected, command, preferences, unlock } = useDesk(onError);
  const [tracks, setTracks] = useState<Track[]>([]),
    [cues, setCues] = useState<Cue[]>([]),
    [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [temporaryStorage, setTemporaryStorage] = useState(false);
  const [tab, setTab] = useState<Tab>('library'),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState<Kind | 'all' | 'favorites'>('all'),
    [sort, setSort] = useState(false),
    [limit, setLimit] = useState(50);
  const [editing, setEditing] = useState<Track | 'new' | null>(null),
    [help, setHelp] = useState(false),
    [settings, setSettings] = useState(false),
    [saveScene, setSaveScene] = useState(false),
    [sceneName, setSceneName] = useState('');
  const [deleting, setDeleting] = useState<{
    id: string;
    title: string;
    kind: 'track' | 'cue';
  } | null>(null);
  const [importing, setImporting] = useState<{ tracks: Track[]; cues: Cue[] } | null>(null),
    [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    search = useRef<HTMLInputElement>(null);
  const isGM = bridge?.self.role === 'GM';
  const conductor = status.state.controller;
  const offline = !!conductor && !status.controllerOnline;
  const canControl = !!isGM && connected && (!conductor || status.controllerOnline);
  const { state, preferences: prefs, engine } = status;
  const refresh = useCallback(async () => {
    try {
      const data = await library.loadLibrary();
      setTracks(data.tracks);
      setCues(data.cues);
      setTemporaryStorage(library.storageIsTemporary());
      setStorageError('');
    } catch {
      setStorageError(
        'Library storage is unavailable. Enable site storage, then reload. Playback can still follow your room.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel('resonance-library-changes');
      channel.onmessage = () => {
        void refresh();
      };
    } catch {
      /* A temporary library can be used without cross-tab messaging. */
    }
    return () => channel?.close();
  }, [refresh]);
  const changed = useCallback(async () => {
    await refresh();
    try {
      const c = new BroadcastChannel('resonance-library-changes');
      c.postMessage('changed');
      c.close();
    } catch {
      /* Cross-tab notification is optional. */
    }
  }, [refresh]);
  const seed = useCallback(async () => {
    try {
      await library.importLibrary({ tracks: sampleTracks(), cues: [] });
      await library.setSetting('demo-seeded', true);
      await changed();
      notify('8 original demo sounds added.');
    } catch (e) {
      onError((e as Error).message);
    }
  }, [changed, notify, onError]);
  const seeded = useRef(false);
  useEffect(() => {
    if (bridge?.demo && !loading && !tracks.length && !storageError && !seeded.current) {
      seeded.current = true;
      void library
        .getSetting('demo-seeded')
        .then((done) => {
          if (!done) void seed();
        })
        .catch(() => {});
    }
  }, [bridge, loading, tracks.length, seed, storageError]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.error ? 8000 : 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setLimit(50);
  }, [filter, query]);
  const seekMusic = useCallback(
    (position: number) => command({ type: 'seek', bus: 'music', position }),
    [command],
  );
  const play = useCallback(
    (track: Track) => {
      if (track.kind === 'sfx') command({ type: 'sfx', track: ref(track), gain: 1 });
      else
        command({ type: 'play', bus: track.kind, track: ref(track), loop: true, fade: prefs.fade });
    },
    [command, prefs.fade],
  );
  const soundEffects = useMemo(() => tracks.filter((t) => t.kind === 'sfx').slice(0, 8), [tracks]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
        target.isContentEditable ||
        document.querySelector('dialog[open]')
      )
        return;
      if (e.key === '/') {
        e.preventDefault();
        setTab('library');
        search.current?.focus();
      }
      if (e.code === 'Space' && canControl && state.music.track) {
        e.preventDefault();
        command({ type: state.music.playing ? 'pause' : 'resume', bus: 'music' });
      }
      const index = Number(e.key) - 1;
      if (canControl && /^[1-8]$/.test(e.key) && soundEffects[index]) {
        e.preventDefault();
        play(soundEffects[index]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canControl, command, play, soundEffects, state.music]);
  const fuse = useMemo(
    () =>
      new Fuse(tracks, {
        keys: [{ name: 'title', weight: 2 }, 'tags'],
        threshold: 0.34,
        ignoreLocation: true,
      }),
    [tracks],
  );
  const visible = useMemo(() => {
    let result = query.trim() ? fuse.search(query.trim()).map((r) => r.item) : [...tracks];
    result = result.filter(
      (t) => filter === 'all' || (filter === 'favorites' ? t.favorite : t.kind === filter),
    );
    if (sort) result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [tracks, fuse, query, filter, sort]);
  async function toggleFavorite(track: Track) {
    try {
      await library.saveTrack({ ...track, favorite: !track.favorite });
      await changed();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function importFile(f?: File) {
    if (!f) return;
    try {
      if (f.size > 8 * 1024 * 1024) throw new Error('Maximum file size is 8 MB.');
      const data = library.parseImport(
        await f.text(),
        f.name.toLowerCase().endsWith('.json') ? 'json' : 'csv',
      );
      setImporting(data);
    } catch (e) {
      onError((e as Error).message);
    }
    if (file.current) file.current.value = '';
  }
  async function confirmImport() {
    if (!importing) return;
    setBusy(true);
    try {
      const result = await library.importLibrary(importing);
      await changed();
      setImporting(null);
      notify(`Imported ${result.added} new tracks; updated ${result.updated}.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function doDelete() {
    if (!deleting) return;
    try {
      if (deleting.kind === 'track') await library.deleteTrack(deleting.id);
      else await library.deleteCue(deleting.id);
      await changed();
      setDeleting(null);
      notify('Removed from your library.');
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function createScene(e: FormEvent) {
    e.preventDefault();
    try {
      const cue: Cue = {
        id: crypto.randomUUID(),
        name: sceneName.trim(),
        music: state.music.track,
        ambience: state.ambience.track,
        musicGain: state.music.gain,
        ambienceGain: state.ambience.gain,
      };
      await library.saveCue(cue);
      await changed();
      setSaveScene(false);
      setSceneName('');
      notify('Scene saved. Recall the whole mix in one click.');
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const blocked = engine.music.phase === 'blocked' || engine.ambience.phase === 'blocked';
  return (
    <div className="app-shell">
      <aside className="rail">
        <a className="brand" href="/" aria-label="Resonance home">
          <span className="brand-mark">
            <AudioLines size={24} />
          </span>
          <span>
            resonance<span className="brand-sub">SOUND FOR YOUR STORY</span>
          </span>
        </a>
        <div className="rail-label">YOUR AUDIO DESK</div>
        <nav aria-label="Main navigation">
          {(
            [
              { key: 'library', label: 'Library', icon: <ListMusic size={19} /> },
              { key: 'scenes', label: 'Scenes', icon: <Layers3 size={19} /> },
              { key: 'session', label: 'Session', icon: <Radio size={19} /> },
            ] as const
          ).map((t) => (
            <button
              className={`nav-item ${tab === t.key ? 'selected' : ''}`}
              key={t.key}
              onClick={() => setTab(t.key)}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.key === 'library' && <span className="nav-count">{tracks.length}</span>}
            </button>
          ))}
        </nav>
        <div className="rail-note">
          <span className="tiny-orbit" />
          <p>
            A little atmosphere.
            <br />A whole other world.
          </p>
        </div>
        <div className="rail-bottom">
          <button onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            Getting started
          </button>
          <button onClick={() => setSettings(true)}>
            <Settings2 size={17} />
            Preferences
          </button>
          <div className="version">RESONANCE / 1.0</div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Audio desk <span>/</span> <strong>{tab[0].toUpperCase() + tab.slice(1)}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection ${connected ? 'online' : ''}`}>
              <i />
              {bridge?.demo ? 'LOCAL PREVIEW' : connected ? 'ROOM CONNECTED' : 'CONNECTING'}
            </span>
            <span className="role-chip">
              <ShieldCheck size={13} />
              {isGM ? 'GAME MASTER' : bridge ? 'LISTENER' : '…'}
            </span>
            <IconButton
              label="Audio settings"
              className="mobile-audio-settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={17} />
            </IconButton>
            <IconButton label="Help" onClick={() => setHelp(true)}>
              <CircleHelp size={18} />
            </IconButton>
          </div>
        </header>
        {bridge?.demo && (
          <div className="preview-notice">
            Standalone preview · test the desk here, or install it in Owlbear Rodeo to share audio.
            <button onClick={() => setHelp(true)}>
              Setup <ArrowRight size={13} />
            </button>
          </div>
        )}
        {storageError && <div className="notice danger">{storageError}</div>}
        {temporaryStorage && (
          <div className="notice">
            Site storage is blocked. Your library is temporary. Export a backup before closing this
            page.
          </div>
        )}
        {bridge && !connected && (
          <div className="notice">
            Waiting for the audio background service. Check that Resonance is enabled in this room.
          </div>
        )}
        {offline && (
          <div className="notice">
            The conductor is offline. Audio keeps its last timeline.
            {isGM && <button onClick={() => command({ type: 'takeover' })}>Take control</button>}
          </div>
        )}
        {blocked && (
          <div className="notice">
            Your browser blocked audio playback.<button onClick={unlock}>Enable audio</button>
          </div>
        )}
        <div className="desk-grid">
          <main className="main-column">
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  {tab === 'library'
                    ? 'SET THE SCENE'
                    : tab === 'scenes'
                      ? 'EVERY WORLD HAS A SOUND'
                      : 'BETTER, TOGETHER'}
                </div>
                <h1>
                  {tab === 'library' ? (
                    <>
                      Your soundtrack.
                      <br />
                      <em>Their adventure.</em>
                    </>
                  ) : tab === 'scenes' ? (
                    <>
                      A world,
                      <br />
                      <em>one click away.</em>
                    </>
                  ) : (
                    <>
                      Around the table.
                      <br />
                      <em>In the moment.</em>
                    </>
                  )}
                </h1>
                <p>
                  {tab === 'library'
                    ? 'Music, ambience, and a little bit of magic.'
                    : tab === 'scenes'
                      ? 'Save a mix. Bring the whole atmosphere back.'
                      : 'Shared playback. A personal mix for every listener.'}
                </p>
              </div>
              <div className="heading-art" aria-hidden="true">
                <div />
                <div />
                <div />
                <span>
                  <AudioLines size={38} />
                </span>
              </div>
            </section>
            <section
              className={`now-playing ${state.music.playing ? 'is-playing' : ''}`}
              aria-label="Music player"
            >
              <div className="album-art">
                <span className="album-orbit" />
                <Disc3 size={43} />
                <span className="album-caption">
                  RESONANCE
                  <br />
                  ORIGINAL MIX
                </span>
              </div>
              <div className="player-content">
                <div className="overline">
                  <span className={`live-dot ${state.music.playing ? 'live' : ''}`} />
                  {state.music.track
                    ? state.music.playing
                      ? 'NOW PLAYING'
                      : 'PAUSED'
                    : 'READY WHEN YOU ARE'}
                  <span className="layer-pill">MUSIC</span>
                </div>
                <h2>{state.music.track?.title ?? 'Let the story begin'}</h2>
                <div className="player-sub">
                  {state.music.track
                    ? engine.music.phase === 'loading'
                      ? 'Loading your track…'
                      : 'Shared with your room'
                    : 'Choose a track from your library below'}
                </div>
                <div className="transport">
                  <IconButton
                    label={state.music.playing ? 'Pause music' : 'Resume music'}
                    className="play-main"
                    disabled={!canControl || !state.music.track}
                    onClick={() =>
                      command({ type: state.music.playing ? 'pause' : 'resume', bus: 'music' })
                    }
                  >
                    {state.music.playing ? (
                      <Pause size={18} fill="currentColor" />
                    ) : (
                      <Play size={18} fill="currentColor" />
                    )}
                  </IconButton>
                  <IconButton
                    label="Stop music"
                    disabled={!canControl || !state.music.track}
                    onClick={() => command({ type: 'stop', bus: 'music' })}
                  >
                    <Square size={16} />
                  </IconButton>
                  <IconButton
                    label="Next queued track"
                    disabled={!canControl || !state.queue.length}
                    onClick={() => command({ type: 'next' })}
                  >
                    <SkipForward size={18} />
                  </IconButton>
                  <div className="player-divider" />
                  <IconButton
                    label="Repeat music"
                    active={state.music.loop}
                    disabled={!canControl || !state.music.track}
                    onClick={() => command({ type: 'loop', bus: 'music', loop: !state.music.loop })}
                  >
                    <Repeat2 size={17} />
                  </IconButton>
                  <span className="fade-label">{prefs.fade}s fade</span>
                  <div className="equalizer" aria-hidden="true">
                    {[9, 19, 12, 23, 16].map((h, i) => (
                      <i key={i} style={{ height: h, animationDelay: `${i * -0.17}s` }} />
                    ))}
                  </div>
                </div>
                <PlaybackProgress
                  key={`${state.epoch}/${state.music.track?.id}/${state.music.track?.url}`}
                  layer={state.music}
                  duration={engine.music.duration}
                  clockOffset={status.clockOffset}
                  canSeek={canControl}
                  onSeek={seekMusic}
                />
              </div>
            </section>
            {engine.music.error && (
              <div className="inline-error">
                {engine.music.error}
                <button onClick={unlock}>Retry playback</button>
              </div>
            )}
            {tab === 'library' && (
              <section className="library-section">
                <div className="section-heading">
                  <h2>
                    Your library <span>{tracks.length}</span>
                  </h2>
                  <div className="section-actions">
                    <button className="text-button" onClick={() => file.current?.click()}>
                      <FolderInput size={16} />
                      <span>Import</span>
                    </button>
                    <button
                      className="button primary small"
                      onClick={() => setEditing('new')}
                      disabled={!!storageError}
                    >
                      <Plus size={16} />
                      Add track
                    </button>
                  </div>
                </div>
                <div className="search-row">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      ref={search}
                      aria-label="Search library"
                      placeholder="Search tracks, moods, or tags…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query ? (
                      <IconButton label="Clear search" onClick={() => setQuery('')}>
                        <X size={14} />
                      </IconButton>
                    ) : (
                      <kbd>/</kbd>
                    )}
                  </div>
                  <IconButton
                    label="Sort alphabetically"
                    active={sort}
                    onClick={() => setSort(!sort)}
                  >
                    <SlidersHorizontal size={17} />
                  </IconButton>
                </div>
                <div className="filter-tabs" role="tablist" aria-label="Track category">
                  {(['all', 'music', 'ambience', 'sfx', 'favorites'] as const).map((f) => (
                    <button
                      role="tab"
                      aria-selected={filter === f}
                      className={filter === f ? 'active' : ''}
                      key={f}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'all' ? (
                        'All tracks'
                      ) : f === 'favorites' ? (
                        <>
                          <Heart size={13} />
                          Favorites
                        </>
                      ) : (
                        kindLabel[f]
                      )}
                      {f === 'all' && <span>{tracks.length}</span>}
                    </button>
                  ))}
                </div>
                <div className="track-table">
                  <div className="table-head">
                    <span>TRACK / ATMOSPHERE</span>
                    <span>TYPE</span>
                    <span />
                  </div>
                  {loading ? (
                    <div className="empty">
                      <LoaderCircle className="spin" />
                      Loading your library…
                    </div>
                  ) : !visible.length ? (
                    <div className="empty">
                      <Music2 size={29} />
                      <h3>{query ? 'No tracks found' : 'Room for a little atmosphere'}</h3>
                      <p>
                        {query
                          ? 'Try another title or mood.'
                          : 'Add a public audio link, import a Tracks CSV, or try the demo sounds.'}
                      </p>
                      {!query && (
                        <button className="button subtle" onClick={() => void seed()}>
                          Load demo library
                        </button>
                      )}
                    </div>
                  ) : (
                    visible.slice(0, limit).map((track, index) => {
                      const active =
                        state.music.track?.id === track.id || state.ambience.track?.id === track.id;
                      return (
                        <div className={`track-row ${active ? 'current' : ''}`} key={track.id}>
                          <button
                            className={`track-art ${track.kind} tone-${index % 4}`}
                            disabled={!canControl}
                            aria-label={`Play ${track.title}`}
                            onClick={() => play(track)}
                          >
                            {active ? <AudioLines size={20} /> : <KindIcon kind={track.kind} />}
                            <Play className="art-play" size={17} fill="currentColor" />
                          </button>
                          <div className="track-info">
                            <button
                              disabled={!canControl}
                              className="track-title"
                              onClick={() => play(track)}
                            >
                              {track.title}
                              {active && <span className="playing-tag">ACTIVE</span>}
                            </button>
                            <div className="tag-list">
                              {track.tags.slice(0, 3).map((t) => (
                                <button
                                  key={t}
                                  onClick={() => {
                                    setQuery(t);
                                    setFilter('all');
                                  }}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                          <span className={`type-label ${track.kind}`}>
                            {kindLabel[track.kind]}
                          </span>
                          <div className="row-actions">
                            <IconButton
                              label={`Favorite ${track.title}`}
                              active={track.favorite}
                              onClick={() => void toggleFavorite(track)}
                            >
                              <Heart size={16} fill={track.favorite ? 'currentColor' : 'none'} />
                            </IconButton>
                            {track.kind === 'music' && (
                              <IconButton
                                label={`Queue ${track.title}`}
                                disabled={!canControl}
                                onClick={() => command({ type: 'enqueue', track: ref(track) })}
                              >
                                <ListMusic size={16} />
                              </IconButton>
                            )}
                            <details className="track-menu">
                              <summary
                                title={`Options for ${track.title}`}
                                aria-label={`Options for ${track.title}`}
                              >
                                <Ellipsis size={19} />
                              </summary>
                              <div>
                                <button
                                  onClick={(e) => {
                                    e.currentTarget.closest('details')?.removeAttribute('open');
                                    setEditing(track);
                                  }}
                                >
                                  Edit track
                                </button>
                                <button
                                  className="danger-text"
                                  onClick={(e) => {
                                    e.currentTarget.closest('details')?.removeAttribute('open');
                                    setDeleting({
                                      id: track.id,
                                      title: track.title,
                                      kind: 'track',
                                    });
                                  }}
                                >
                                  Delete track
                                </button>
                              </div>
                            </details>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                {visible.length > limit && (
                  <button className="button subtle load-more" onClick={() => setLimit(limit + 50)}>
                    Show 50 more · {visible.length - limit} remaining
                  </button>
                )}
                <div className="library-footer">
                  <span>{visible.length} tracks · stored on this device</span>
                  <div>
                    <button
                      onClick={() =>
                        library.download(
                          'tracks.csv',
                          library.exportCSV(tracks),
                          'text/csv;charset=utf-8',
                        )
                      }
                      disabled={!tracks.length}
                    >
                      <ArrowDownToLine size={13} />
                      CSV
                    </button>
                    <button
                      onClick={() =>
                        library.download(
                          'resonance-backup.json',
                          library.exportJSON(tracks, cues),
                          'application/json',
                        )
                      }
                      disabled={!tracks.length && !cues.length}
                    >
                      <FileJson size={13} />
                      Backup
                    </button>
                  </div>
                </div>
              </section>
            )}
            {tab === 'scenes' && (
              <section className="scene-section">
                <div className="section-heading">
                  <h2>
                    Saved scenes <span>{cues.length}</span>
                  </h2>
                  <button
                    className="button primary small"
                    disabled={!state.music.track && !state.ambience.track}
                    onClick={() => setSaveScene(true)}
                  >
                    <Plus size={15} />
                    Save current mix
                  </button>
                </div>
                {!cues.length ? (
                  <div className="empty scene-empty">
                    <Layers3 size={34} />
                    <h3>Build an atmosphere. Keep it close.</h3>
                    <p>
                      Play music and ambience, then save the mix as a scene.
                      <br />
                      Recall both layers with their room levels in one click.
                    </p>
                  </div>
                ) : (
                  <div className="scene-grid">
                    {cues.map((cue, i) => (
                      <article className={`scene-card tone-${i % 4}`} key={cue.id}>
                        <div className="scene-card-top">
                          <Layers3 size={27} />
                          <IconButton
                            label={`Delete scene ${cue.name}`}
                            onClick={() =>
                              setDeleting({ id: cue.id, title: cue.name, kind: 'cue' })
                            }
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                        <h3>{cue.name}</h3>
                        <p>
                          <Music2 size={13} />
                          {cue.music?.title ?? 'No music'}
                        </p>
                        <p>
                          <CloudRain size={13} />
                          {cue.ambience?.title ?? 'No ambience'}
                        </p>
                        <button
                          className="button subtle"
                          disabled={!canControl}
                          onClick={() => command({ type: 'cue', cue, fade: prefs.fade })}
                        >
                          <Play size={14} />
                          Launch scene <ArrowRight size={14} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            {tab === 'session' && (
              <section className="session-section">
                <div className="section-heading">
                  <h2>Your session</h2>
                  <span className="muted">{status.people.length} connected</span>
                </div>
                <div className="session-card">
                  <div className="session-icon">
                    <Radio size={22} />
                  </div>
                  <div>
                    <h3>
                      {state.controllerName
                        ? `${state.controllerName} is conducting`
                        : 'Ready for a conductor'}
                    </h3>
                    <p>
                      {status.controllerOnline
                        ? 'Playback follows the conductor’s timeline.'
                        : 'A GM can take control to start or continue playback.'}
                    </p>
                  </div>
                  {isGM && (
                    <button className="button subtle" onClick={() => command({ type: 'takeover' })}>
                      {conductor === bridge?.self.connectionId ? 'Refresh control' : 'Take control'}
                    </button>
                  )}
                </div>
                <div className="participant-list">
                  {status.people.map((p) => (
                    <div key={p.connectionId}>
                      <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                      <strong>
                        {p.name}
                        {p.connectionId === bridge?.self.connectionId ? ' (you)' : ''}
                      </strong>
                      <span>{p.role === 'GM' ? 'Game master' : 'Listener'}</span>
                      <i className="person-online" />
                    </div>
                  ))}
                </div>
                <div className="session-facts">
                  <div>
                    <Activity size={18} />
                    <span>
                      Clock round trip
                      <strong>
                        {status.clockRtt === null
                          ? 'Measuring…'
                          : `${Math.round(status.clockRtt)} ms`}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <Headphones size={18} />
                    <span>
                      This device
                      <strong>
                        {blocked
                          ? 'Audio blocked'
                          : engine.music.phase === 'playing' || engine.ambience.phase === 'playing'
                            ? 'Playing'
                            : 'Ready'}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <Layers3 size={18} />
                    <span>
                      Transport revision<strong>{state.revision}</strong>
                    </span>
                  </div>
                </div>
                <p className="session-note">
                  Listeners control their own volume. Shared music, ambience, and sound effects are
                  controlled by GMs. Library files stay on each device; only the active mix is
                  shared.
                </p>
              </section>
            )}
          </main>
          <aside className="mixer-column" aria-label="Mixer and queue">
            <section className="mixer panel">
              <div className="panel-heading">
                <h2>
                  <SlidersHorizontal size={17} />
                  The mix
                </h2>
                <span>ROOM LEVELS</span>
              </div>
              {(['music', 'ambience'] as const).map((bus) => (
                <div className="bus-strip" key={bus}>
                  <div className="bus-top">
                    <span className={`bus-icon ${bus}`}>
                      <KindIcon kind={bus} size={16} />
                    </span>
                    <strong>{kindLabel[bus]}</strong>
                  </div>
                  <p className="bus-track">
                    {state[bus].track?.title ??
                      (bus === 'music' ? 'No music playing' : 'Add a little texture')}
                  </p>
                  <div className="bus-fader">
                    <SmoothSlider
                      key={`${state.epoch}/${state[bus].track?.id}`}
                      label={`${kindLabel[bus]} room volume`}
                      value={state[bus].gain}
                      disabled={!canControl}
                      onChange={(gain, final) => command({ type: 'gain', bus, gain }, final)}
                    />
                    <IconButton
                      label={`${state[bus].playing ? 'Pause' : 'Resume'} ${bus} layer`}
                      disabled={!canControl || !state[bus].track}
                      onClick={() =>
                        command({ type: state[bus].playing ? 'pause' : 'resume', bus })
                      }
                    >
                      {state[bus].playing ? <Pause size={14} /> : <Play size={14} />}
                    </IconButton>
                    {bus === 'ambience' && (
                      <IconButton
                        label="Stop ambience"
                        disabled={!canControl || !state.ambience.track}
                        onClick={() => command({ type: 'stop', bus })}
                      >
                        <Square size={13} />
                      </IconButton>
                    )}
                  </div>
                  {engine[bus].error && <div className="bus-error">{engine[bus].error}</div>}
                </div>
              ))}
              <button
                className="save-scene"
                onClick={() => setSaveScene(true)}
                disabled={!state.music.track && !state.ambience.track}
              >
                <Layers3 size={15} />
                Save as a scene
                <Plus size={15} />
              </button>
            </section>
            <section className="soundboard panel">
              <div className="panel-heading">
                <h2>
                  <Zap size={17} />A little magic
                </h2>
                <span>SOUNDBOARD</span>
              </div>
              <div className="sound-pads">
                {soundEffects.length ? (
                  soundEffects.map((track, i) => (
                    <button
                      className={`sound-pad tone-${i % 4}`}
                      key={track.id}
                      disabled={!canControl}
                      onClick={() => play(track)}
                      aria-label={`Trigger ${track.title}`}
                    >
                      <span>
                        <KindIcon kind="sfx" size={20} />
                        <kbd>{i + 1}</kbd>
                      </span>
                      <strong>{track.title}</strong>
                      <span>ONE SHOT</span>
                    </button>
                  ))
                ) : (
                  <button className="empty-pad" onClick={() => setEditing('new')}>
                    <Plus size={20} />
                    <span>Add a sound effect</span>
                  </button>
                )}
              </div>
              <div className="panel-footnote">
                {engine.activeEffects
                  ? `${engine.activeEffects} sounds playing`
                  : 'Small sounds. Big moments.'}
              </div>
            </section>
            <section className="queue panel">
              <div className="panel-heading">
                <h2>
                  <ListMusic size={17} />
                  Up next
                </h2>
                <span>{state.queue.length} TRACKS</span>
              </div>
              {!state.queue.length ? (
                <div className="queue-empty">
                  <ListMusic size={24} />
                  <p>Let the story unfold.</p>
                  <span>Queue music from your library.</span>
                </div>
              ) : (
                <ol className="queue-list">
                  {state.queue.map((track, index) => (
                    <li key={`${track.id}-${index}`}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{track.title}</strong>
                      <IconButton
                        label={`Remove queued ${track.title}`}
                        disabled={!canControl}
                        onClick={() => command({ type: 'removeQueue', index })}
                      >
                        <X size={14} />
                      </IconButton>
                    </li>
                  ))}
                </ol>
              )}
              {!!state.queue.length && (
                <button
                  className="queue-next"
                  disabled={!canControl}
                  onClick={() => command({ type: 'next' })}
                >
                  Play next
                  <SkipForward size={15} />
                </button>
              )}
            </section>
            <div className="desk-tip">
              <Sparkles size={17} />
              <p>
                Good sound sets the scene.
                <br />
                <strong>You tell the story.</strong>
              </p>
            </div>
          </aside>
        </div>
        <footer className="monitor-bar">
          <span className="monitor-icon">
            <Headphones size={20} />
          </span>
          <div className="monitor-label">
            <strong>Your listening level</strong>
            <span>Only changes what you hear</span>
          </div>
          <IconButton
            label={prefs.muted ? 'Unmute your audio' : 'Mute your audio'}
            active={prefs.muted}
            onClick={() => preferences({ muted: !prefs.muted })}
          >
            {prefs.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </IconButton>
          <SmoothSlider
            className="master-slider"
            label="Personal volume"
            value={prefs.master}
            onChange={(master, final) => preferences({ master }, final)}
          />
          <div className="monitor-spacer" />
          <button className="monitor-settings" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
            <span>Audio settings</span>
          </button>
          <button
            className="panic-button"
            disabled={!canControl}
            onClick={() => command({ type: 'stopAll' })}
          >
            <Square size={13} />
            Stop all
          </button>
        </footer>
      </div>
      <input
        ref={file}
        type="file"
        className="visually-hidden"
        accept=".csv,.json,text/csv,application/json"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {editing && (
        <TrackEditor
          track={editing === 'new' ? undefined : editing}
          tracks={tracks}
          onClose={() => setEditing(null)}
          onSave={async (track) => {
            await library.saveTrack(track);
            await changed();
            setEditing(null);
            notify('Track saved to your library.');
          }}
          onError={onError}
        />
      )}
      {deleting && (
        <Modal title="Remove from your library?" onClose={() => setDeleting(null)}>
          <p className="modal-copy">
            “{deleting.title}” will be removed from this device. You can import it again later.
          </p>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setDeleting(null)}>
              Keep it
            </button>
            <button className="button danger-button" onClick={() => void doDelete()}>
              <Trash2 size={15} />
              Remove
            </button>
          </div>
        </Modal>
      )}
      {importing && (
        <Modal title="Bring your library along" onClose={() => setImporting(null)}>
          <p className="modal-copy">
            Ready to import <strong>{importing.tracks.length} tracks</strong> and{' '}
            <strong>{importing.cues.length} scenes</strong>. Matching audio URLs update existing
            tracks; your other tracks stay in place.
          </p>
          <div className="import-preview">
            {importing.tracks.slice(0, 5).map((t, i) => (
              <div key={i}>
                <KindIcon kind={t.kind} size={15} />
                <span>{t.title}</span>
                <small>{kindLabel[t.kind]}</small>
              </div>
            ))}
            {importing.tracks.length > 5 && <p>+ {importing.tracks.length - 5} more tracks</p>}
          </div>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setImporting(null)} disabled={busy}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void confirmImport()} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <FolderInput size={15} />}Import
              library
            </button>
          </div>
        </Modal>
      )}
      {saveScene && (
        <Modal title="Keep this atmosphere" onClose={() => setSaveScene(false)}>
          <form onSubmit={(e) => void createScene(e)}>
            <label className="field">
              Scene name
              <input
                autoFocus
                maxLength={120}
                placeholder="A storm at the old inn"
                required
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
              />
            </label>
            <div className="scene-preview">
              <p>
                <Music2 size={16} />
                {state.music.track?.title ?? 'No music'}
              </p>
              <p>
                <CloudRain size={16} />
                {state.ambience.track?.title ?? 'No ambience'}
              </p>
            </div>
            <p className="small-copy">
              Saves both tracks and room levels. Launching a scene starts both layers from the
              beginning.
            </p>
            <div className="modal-actions">
              <button type="button" className="button subtle" onClick={() => setSaveScene(false)}>
                Cancel
              </button>
              <button className="button primary" disabled={!sceneName.trim()}>
                <Check size={15} />
                Save scene
              </button>
            </div>
          </form>
        </Modal>
      )}
      {settings && (
        <Modal title="Make yourself comfortable" onClose={() => setSettings(false)}>
          <p className="modal-copy">
            Personal levels change only this device. The fade duration applies when you launch music
            or a scene.
          </p>
          {(['music', 'ambience', 'sfx'] as const).map((key) => (
            <label className="preference-slider" key={key}>
              <span>
                <KindIcon kind={key} size={16} />
                {kindLabel[key]}
              </span>
              <SmoothSlider
                label={`Personal ${key} volume`}
                value={prefs[key]}
                onChange={(gain, final) => preferences({ [key]: gain }, final)}
              />
            </label>
          ))}
          <label className="field fade-setting">
            Crossfade duration
            <select
              value={prefs.fade}
              onChange={(e) => preferences({ fade: Number(e.target.value) })}
            >
              {[0, 1, 2.5, 5, 10].map((v) => (
                <option value={v} key={v}>
                  {v === 0 ? 'Instant' : `${v} seconds`}
                </option>
              ))}
            </select>
          </label>
          <button className="button subtle full-width" onClick={unlock}>
            <Volume2 size={16} />
            Enable / retry audio
          </button>
          <p className="small-copy">
            Some mobile browsers restrict volume fades. If enabling audio here does not work, allow
            autoplay for Owlbear Rodeo in your browser and rejoin the room.
          </p>
          <div className="modal-actions">
            <button className="button primary" onClick={() => setSettings(false)}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="Sound for your story" onClose={() => setHelp(false)} wide>
          <div className="help-grid">
            <div>
              <h3>
                <span>01</span>Bring your sounds
              </h3>
              <p>
                Add a public HTTPS audio link, or import a Tracks CSV (<code>title,url,tags</code>,
                with tags separated by <code>|</code>). Dropbox share links are converted for
                playback.
              </p>
              <h3>
                <span>02</span>Build the atmosphere
              </h3>
              <p>
                Music and ambience play independently. Use the room faders to mix them, queue music,
                or fire one-shot effects with keys 1–8. Save a mix as a scene to recall it later.
              </p>
              <h3>
                <span>03</span>Share the moment
              </h3>
              <p>
                Install <code>/manifest.json</code> from your HTTPS host in Owlbear Rodeo, then
                enable it in your room. The background service keeps playing as you close the panel.
              </p>
            </div>
            <aside>
              <h3>A few things to know</h3>
              <p>
                Audio files must be public for every listener. Google Drive, YouTube, and Spotify
                page URLs cannot be used as direct audio.
              </p>
              <p>
                Your library stays on this device. Export a JSON backup to save tracks and scenes,
                or CSV to share with Tracks users.
              </p>
              <p>
                Demo sounds are short, original synthesized loops. Use your own hosted audio for a
                full session.
              </p>
              <div className="shortcut-row">
                <kbd>Space</kbd>Play / pause music
              </div>
              <div className="shortcut-row">
                <kbd>/</kbd>Search your library
              </div>
              <div className="shortcut-row">
                <kbd>1–8</kbd>Trigger sound effects
              </div>
            </aside>
          </div>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => void seed()}>
              Load demo sounds
            </button>
            <button className="button primary" onClick={() => setHelp(false)}>
              Let's set the scene
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={`toast ${toast.error ? 'error' : ''}`}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <IconButton label="Dismiss message" onClick={() => setToast(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
function TrackEditor({
  track,
  tracks,
  onClose,
  onSave,
  onError,
}: {
  track?: Track;
  tracks: Track[];
  onClose: () => void;
  onSave: (t: Track) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [title, setTitle] = useState(track?.title ?? ''),
    [url, setUrl] = useState(track?.url ?? ''),
    [tags, setTags] = useState(track?.tags.join(', ') ?? ''),
    [kind, setKind] = useState<Kind>(track?.kind ?? 'music'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const parsed = parseTrack({
        ...track,
        id: track?.id,
        title,
        url,
        tags: tags.split(/[,|]/),
        kind,
      });
      const existing = tracks.find((t) => t.url === parsed.url && t.id !== parsed.id);
      if (existing)
        throw new Error(
          'This audio URL is already in your library. Edit the existing track instead.',
        );
      await onSave(parsed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={track ? 'Fine-tune your track' : 'Add a little atmosphere'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          Track title
          <input
            aria-label="Track title"
            autoFocus
            required
            maxLength={160}
            placeholder="A quiet evening at the inn"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          Public audio URL
          <input
            aria-label="Public audio URL"
            aria-describedby="url-help"
            required
            type="url"
            maxLength={1500}
            placeholder="https://…/your-audio.mp3"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <small id="url-help">A direct file link or a public Dropbox share link.</small>
        </label>
        <label className="field">
          Play as
          <select
            aria-label="Play as"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="music">Music · looping main soundtrack</option>
            <option value="ambience">Ambience · a second looping layer</option>
            <option value="sfx">Sound effect · one-shot soundboard</option>
          </select>
        </label>
        <label className="field">
          Tags
          <input
            aria-label="Tags"
            aria-describedby="tags-help"
            maxLength={980}
            placeholder="tavern, peaceful, night"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <small id="tags-help">Separate moods and tags with commas.</small>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button subtle" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Save track
          </button>
        </div>
      </form>
    </Modal>
  );
}
