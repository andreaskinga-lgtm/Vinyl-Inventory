import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SORTS,
  filterRecords,
  imagesFor,
  metaLine,
  shuffle,
  sortRecords,
  useTracklist,
} from "../utils/collectionView.js";
import "./ListeningRoom.css";

function Art({ record, revealed = false }) {
  return (
    <div className={`c-art${revealed ? " is-revealed" : ""}`}>
      {record.vinylUrl && (
        <img className="c-art-wax" src={record.vinylUrl} alt="" loading="lazy" />
      )}
      {record.coverUrl ? (
        <img
          className="c-art-front"
          src={record.coverUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="c-art-blank">♪</div>
      )}
    </div>
  );
}

// Touch: a quick tap activates, a long press reveals the vinyl instead — and
// neither is allowed to raise the native context menu / callout.
const TAP_MAX_MS = 250;
const HOLD_MS = 280;

function usePressReveal(onActivate) {
  const [held, setHeld] = useState(false);
  const startedAt = useRef(0);
  const holdTimer = useRef(null);
  const swallowClick = useRef(false);

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  useEffect(() => clearHold, [clearHold]);

  return {
    held,
    handlers: {
      onContextMenu: (e) => e.preventDefault(),
      onPointerDown: (e) => {
        if (e.pointerType !== "touch") return;
        startedAt.current = performance.now();
        swallowClick.current = true;
        clearHold();
        holdTimer.current = setTimeout(() => setHeld(true), HOLD_MS);
      },
      onPointerUp: (e) => {
        if (e.pointerType !== "touch") return;
        clearHold();
        const elapsed = performance.now() - startedAt.current;
        setHeld(false);
        // Queue behind the native click so it can't land on what we open.
        if (elapsed <= TAP_MAX_MS) setTimeout(() => onActivate(), 0);
      },
      onPointerCancel: (e) => {
        if (e.pointerType !== "touch") return;
        clearHold();
        setHeld(false);
        swallowClick.current = false;
      },
      onClick: (e) => {
        if (swallowClick.current) {
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onActivate();
      },
    },
  };
}

function Cell({ record, active, onActivate }) {
  const { held, handlers } = usePressReveal(onActivate);

  return (
    <button
      type="button"
      className={`c-cell${active ? " on" : ""}`}
      {...handlers}
    >
      <Art record={record} revealed={held} />
      <span className="c-cell-label">
        <span>{record.title}</span>
        <em>{record.artist}</em>
      </span>
      <span className="c-cell-hold" aria-hidden>
        hold to see the vinyl
      </span>
    </button>
  );
}

function InlineDetail({ record, onClose, onEdit }) {
  const { loading, tracks } = useTracklist(record.discogsId);
  const images = imagesFor(record);
  const [imageIndex, setImageIndex] = useState(0);
  const ref = useRef(null);
  const artRef = useRef(null);

  const step = useCallback(
    (delta) =>
      setImageIndex((i) => (i + delta + images.length) % images.length),
    [images.length],
  );

  useLayoutEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Swipe the artwork to reach the vinyl shots — no tiny targets required.
  useEffect(() => {
    const el = artRef.current;
    if (!el || images.length < 2) return undefined;
    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    const start = (e) => {
      x0 = x1 = e.touches[0].clientX;
      y0 = y1 = e.touches[0].clientY;
    };
    const move = (e) => {
      x1 = e.touches[0].clientX;
      y1 = e.touches[0].clientY;
    };
    const end = () => {
      const dx = x1 - x0;
      if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(y1 - y0) * 1.4)
        step(dx > 0 ? -1 : 1);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
    };
  }, [images.length, step]);

  return (
    <div className="c-detail" ref={ref}>
      <button
        type="button"
        className="c-detail-close"
        onClick={onClose}
        aria-label="Close"
      >
        ✕
      </button>

      <div className="c-detail-art" ref={artRef}>
        {images.length ? (
          <img src={images[imageIndex] ?? images[0]} alt="" />
        ) : (
          <div className="c-art-blank">♪</div>
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="c-detail-arrow c-detail-arrow--prev"
              onClick={() => step(-1)}
              aria-label="Previous image"
            >
              ‹
            </button>
            <button
              type="button"
              className="c-detail-arrow c-detail-arrow--next"
              onClick={() => step(1)}
              aria-label="Next image"
            >
              ›
            </button>
            <span className="c-detail-counter">
              {imageIndex + 1}/{images.length}
            </span>
          </>
        )}
      </div>

      <div className="c-detail-copy">
        <p className="c-detail-artist">{record.artist}</p>
        <h2 className="c-detail-title">{record.title}</h2>
        <p className="c-detail-meta">{metaLine(record)}</p>
        {record.location && (
          <p className="c-detail-loc">Shelf: {record.location}</p>
        )}

        {/* Fixed-height scroller: the tracklist arriving late can't reflow the page. */}
        <div className="c-detail-tracks">
          {!record.discogsId ? (
            <p className="c-detail-note">No tracklist linked.</p>
          ) : loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="c-track c-track--skeleton">
                <span />
              </div>
            ))
          ) : tracks?.length ? (
            tracks.map((t, i) =>
              t.type_ === "heading" ? (
                <div key={i} className="c-track-heading">
                  {t.title}
                </div>
              ) : t.type_ === "track" ? (
                <div key={i} className="c-track">
                  <span className="c-track-pos">{t.position}</span>
                  <span className="c-track-title">{t.title}</span>
                  {t.duration && (
                    <span className="c-track-dur">{t.duration}</span>
                  )}
                </div>
              ) : null,
            )
          ) : (
            <p className="c-detail-note">No tracklist available.</p>
          )}
        </div>

        {record.discogsId && (
          <a
            className="c-detail-credit"
            href={`https://www.discogs.com/release/${record.discogsId}`}
            target="_blank"
            rel="noreferrer"
          >
            Data provided by Discogs ↗
          </a>
        )}
        {onEdit && (
          <button type="button" className="c-detail-edit" onClick={onEdit}>
            Edit record
          </button>
        )}
      </div>
    </div>
  );
}

function TrackLines({ record }) {
  const { loading, tracks } = useTracklist(record.discogsId);

  if (!record.discogsId)
    return <p className="c-flip-note">No tracklist linked to this pressing.</p>;
  if (loading)
    return (
      <>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="c-track c-track--skeleton">
            <span />
          </div>
        ))}
      </>
    );
  if (!tracks?.length)
    return <p className="c-flip-note">No tracklist available.</p>;

  return (
    <>
      {tracks.map((t, i) =>
        t.type_ === "heading" ? (
          <div key={i} className="c-track-heading">
            {t.title}
          </div>
        ) : t.type_ === "track" ? (
          <div key={i} className="c-track">
            <span className="c-track-pos">{t.position}</span>
            <span className="c-track-title">{t.title}</span>
            {t.duration && <span className="c-track-dur">{t.duration}</span>}
          </div>
        ) : null,
      )}
    </>
  );
}

// The reverse of the sleeve: details up top, tracklist scrolling underneath.
// Tapping the card anywhere turns it back over.
function SleeveBack({ record }) {
  return (
    <div className="c-back">
      <div className="c-back-head">
        <p className="c-back-artist">{record.artist}</p>
        <h3>{record.title}</h3>
        <p className="c-back-meta">{metaLine(record)}</p>
        {record.location && <p className="c-back-loc">📍 {record.location}</p>}
      </div>

      <div className="c-back-tracks">
        <TrackLines record={record} />
      </div>
    </div>
  );
}

function FlipView({ records, onExit }) {
  const [stack, setStack] = useState(() => shuffle(records));
  const [index, setIndex] = useState(0);
  const [exit, setExit] = useState(null);
  const [showBack, setShowBack] = useState(false);
  const busy = useRef(false);
  const stageRef = useRef(null);
  // A drag must never register as a tap, or scrolling the tracklist flips the
  // record back out from under you.
  const tap = useRef({ x: 0, y: 0, moved: false });

  const cardHandlers = {
    onContextMenu: (e) => e.preventDefault(),
    onPointerDown: (e) => {
      tap.current = { x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove: (e) => {
      const g = tap.current;
      if (Math.abs(e.clientX - g.x) > 10 || Math.abs(e.clientY - g.y) > 10)
        g.moved = true;
    },
    // Fires the moment the browser takes the gesture over for scrolling.
    onPointerCancel: () => {
      tap.current.moved = true;
    },
    onClick: () => {
      if (tap.current.moved) return;
      setShowBack((v) => !v);
    },
  };

  function advance(dir) {
    if (busy.current) return;
    busy.current = true;
    setShowBack(false);
    setExit(dir);
    setTimeout(() => {
      setIndex((i) => i + 1);
      setExit(null);
      busy.current = false;
    }, 210);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let startX = 0;
    let startY = 0;
    let curX = 0;
    let curY = 0;
    const start = (e) => {
      startX = curX = e.touches[0].clientX;
      startY = curY = e.touches[0].clientY;
    };
    const move = (e) => {
      curX = e.touches[0].clientX;
      curY = e.touches[0].clientY;
    };
    const end = () => {
      const dx = curX - startX;
      const dy = curY - startY;
      // Horizontal intent only — vertical drags belong to the tracklist.
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4)
        advance(dx > 0 ? "right" : "left");
    };
    stage.addEventListener("touchstart", start, { passive: true });
    stage.addEventListener("touchmove", move, { passive: true });
    stage.addEventListener("touchend", end, { passive: true });
    return () => {
      stage.removeEventListener("touchstart", start);
      stage.removeEventListener("touchmove", move);
      stage.removeEventListener("touchend", end);
    };
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.altKey) return;
      if (e.key === "ArrowRight" || e.key === " ") advance("left");
      if (e.key === "ArrowLeft") advance("right");
      if (e.key === "Escape") onExit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const visible = stack.slice(index, index + 6);
  const front = visible[0];

  return (
    <div className="c-flip">
      <div
        className="c-flip-glow"
        style={
          front?.coverUrl
            ? { backgroundImage: `url(${front.coverUrl})` }
            : undefined
        }
      />

      <button type="button" className="c-flip-exit" onClick={onExit}>
        ✕ Done flipping
      </button>

      <div className="c-flip-stage" ref={stageRef}>
        {!front ? (
          <div className="c-flip-done">
            <p>You&rsquo;ve seen every record.</p>
            <button
              type="button"
              onClick={() => {
                setStack(shuffle(records));
                setIndex(0);
              }}
            >
              Shuffle again
            </button>
          </div>
        ) : (
          visible
            .map((r, i) => (
              <div
                key={r.id}
                className={`c-flip-card${i === 0 && exit ? ` out-${exit}` : ""}${
                  i === 0 && showBack ? " flipped" : ""
                }`}
                style={{ "--i": i }}
                {...(i === 0 ? cardHandlers : {})}
              >
                <div className="c-flip-face c-flip-face--front">
                  <Art record={r} />
                </div>
                <div className="c-flip-face c-flip-face--back">
                  {i === 0 && showBack && <SleeveBack record={r} />}
                </div>
              </div>
            ))
            .reverse()
        )}
      </div>

      {front && (
        <>
          <div className="c-flip-meta">
            <strong>{front.title}</strong>
            <span>{front.artist}</span>
          </div>
          <div className="c-flip-controls">
            <button
              type="button"
              className="c-flip-secondary"
              onClick={() => {
                setStack(shuffle(records));
                setIndex(0);
                setShowBack(false);
              }}
            >
              ⟳
            </button>
            <button
              type="button"
              className="c-flip-primary"
              onClick={() => advance("left")}
            >
              Next
            </button>
            <span className="c-flip-count">
              {index + 1}/{stack.length}
            </span>
          </div>
          <p className="c-flip-hint">tap the sleeve to turn it over</p>
        </>
      )}
    </div>
  );
}

function ListeningRoom({
  records,
  editMode,
  addRecordControl,
  onEditRecord,
  onRequestEditMode,
  onLockEditMode,
  onShare,
  onSync,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("artist-asc");
  const [dockPanel, setDockPanel] = useState(null); // 'search' | 'sort' | 'more'
  const [activeId, setActiveId] = useState(null);
  const [flipping, setFlipping] = useState(false);
  const [cols, setCols] = useState(3);
  const gridRef = useRef(null);
  const rootRef = useRef(null);

  const visible = useMemo(
    () => sortRecords(filterRecords(records, query), sort),
    [records, query, sort],
  );

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const n = getComputedStyle(el)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      if (n > 0) setCols(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeIndex = activeId
    ? visible.findIndex((r) => r.id === activeId)
    : -1;
  const active = activeIndex >= 0 ? visible[activeIndex] : null;
  const detailAfter =
    activeIndex >= 0
      ? Math.min(visible.length, (Math.floor(activeIndex / cols) + 1) * cols) - 1
      : -1;

  if (flipping) {
    return (
      <div className="variant-c">
        <FlipView records={visible} onExit={() => setFlipping(false)} />
      </div>
    );
  }

  return (
    <div className="variant-c" ref={rootRef}>
      <div className="c-topline">
        <span>Vinyl Collection</span>
        <span>{visible.length} records</span>
      </div>

      <main className="c-room">
        {visible.length === 0 ? (
          <p className="c-empty">Nothing here. Try a different search.</p>
        ) : (
          <div className="c-grid" ref={gridRef}>
            {visible.map((r, i) => (
              <div key={r.id} className="c-cell-wrap" style={{ display: "contents" }}>
                <Cell
                  record={r}
                  active={r.id === activeId}
                  onActivate={() =>
                    setActiveId((id) => (id === r.id ? null : r.id))
                  }
                />
                {i === detailAfter && active && (
                  <InlineDetail
                    record={active}
                    onClose={() => setActiveId(null)}
                    onEdit={
                      editMode
                        ? () => {
                            setActiveId(null);
                            onEditRecord(active);
                          }
                        : null
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── The dock: the only chrome in the app ── */}
      <div className="c-dock-zone">
        {dockPanel === "search" && (
          <div className="c-panel">
            <input
              autoFocus
              type="search"
              placeholder="Search artist, album, genre…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        {dockPanel === "sort" && (
          <div className="c-panel c-panel--list">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={sort === s.key ? "on" : ""}
                onClick={() => {
                  setSort(s.key);
                  setDockPanel(null);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {dockPanel === "more" && (
          <div className="c-panel c-panel--list">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                setDockPanel(null);
                onShare();
              }}
            >
              Share collection
            </button>
            <button
              type="button"
              onClick={() => {
                setDockPanel(null);
                if (editMode) onLockEditMode();
                else onRequestEditMode();
              }}
            >
              {editMode ? "Lock edit mode" : "Edit mode"}
            </button>
            {editMode && addRecordControl}
            {editMode && (
              <button
                type="button"
                onClick={() => {
                  setDockPanel(null);
                  onSync();
                }}
              >
                Sync with Discogs
              </button>
            )}
          </div>
        )}

        <div className="c-dock">
          <button
            type="button"
            className={`c-dock-btn${dockPanel === "search" ? " on" : ""}${query ? " has" : ""}`}
            onClick={() =>
              setDockPanel((p) => (p === "search" ? null : "search"))
            }
            aria-label="Search"
          >
            ⌕
          </button>
          <button
            type="button"
            className={`c-dock-btn${dockPanel === "sort" ? " on" : ""}`}
            onClick={() => setDockPanel((p) => (p === "sort" ? null : "sort"))}
            aria-label="Sort"
          >
            ⇅
          </button>

          <button
            type="button"
            className="c-dock-flip"
            onClick={() => setFlipping(true)}
            disabled={visible.length === 0}
          >
            <span className="c-dock-disc" />
            Flip
          </button>

          <button
            type="button"
            className={`c-dock-btn${dockPanel === "more" ? " on" : ""}`}
            onClick={() => setDockPanel((p) => (p === "more" ? null : "more"))}
            aria-label="More"
          >
            ⋯
          </button>
          <button
            type="button"
            className="c-dock-btn"
            onClick={() =>
              rootRef.current?.scrollTo({ top: 0, behavior: "smooth" })
            }
            aria-label="Back to top"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

export default ListeningRoom;
