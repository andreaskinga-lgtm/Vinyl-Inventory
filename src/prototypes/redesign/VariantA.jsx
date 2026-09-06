// PROTOTYPE — throwaway. Variant A: "Crate Rail".
// Thesis: every control collapses into ONE sticky rail across the top of the
// crate. Art is edge-to-edge and unframed. Detail opens as a fixed-height
// bottom sheet on mobile (never resizes when the tracklist lands) and a
// two-column dialog on desktop.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SORTS,
  filterRecords,
  imagesFor,
  shuffle,
  sortRecords,
  useTracklist,
} from "./shared";
import "./VariantA.css";

export const name = "Crate Rail";

function Sleeve({ record }) {
  return (
    <div className="a-sleeve">
      {record.coverUrl ? (
        <>
          <img className="a-sleeve-front" src={record.coverUrl} alt="" loading="lazy" />
          {record.vinylUrl && (
            <img className="a-sleeve-wax" src={record.vinylUrl} alt="" loading="lazy" />
          )}
        </>
      ) : (
        <div className="a-sleeve-blank">♪</div>
      )}
    </div>
  );
}

function Tile({ record, onOpen }) {
  return (
    <button type="button" className="a-tile" onClick={() => onOpen(record)}>
      <Sleeve record={record} />
      <span className="a-tile-caption">
        <span className="a-tile-title">{record.title}</span>
        <span className="a-tile-artist">{record.artist}</span>
      </span>
    </button>
  );
}

function TrackRows({ discogsId }) {
  const { loading, tracks } = useTracklist(discogsId);

  if (!discogsId) return <p className="a-tracks-empty">No tracklist linked.</p>;
  if (loading) {
    return (
      <div className="a-tracks">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="a-track a-track--skeleton">
            <span />
            <span />
          </div>
        ))}
      </div>
    );
  }
  if (!tracks?.length)
    return <p className="a-tracks-empty">No tracklist available.</p>;

  return (
    <div className="a-tracks">
      {tracks.map((t, i) =>
        t.type_ === "heading" ? (
          <div key={i} className="a-track-heading">
            {t.title}
          </div>
        ) : t.type_ === "track" ? (
          <div key={i} className="a-track">
            <span className="a-track-pos">{t.position}</span>
            <span className="a-track-title">{t.title}</span>
            {t.duration && <span className="a-track-dur">{t.duration}</span>}
          </div>
        ) : null,
      )}
    </div>
  );
}

function Sheet({ record, onClose }) {
  const images = imagesFor(record);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="a-scrim" onClick={onClose}>
      <div
        className="a-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="a-sheet-grip" />
        <header className="a-sheet-head">
          <div>
            <h2>{record.title}</h2>
            <p>{record.artist}</p>
          </div>
          <button type="button" className="a-sheet-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="a-sheet-body">
          <div className="a-sheet-art">
            {images.length ? (
              <>
                <img src={images[imageIndex] ?? images[0]} alt="" />
                {images.length > 1 && (
                  <div className="a-sheet-dots">
                    {images.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        className={i === imageIndex ? "on" : ""}
                        onClick={() => setImageIndex(i)}
                        aria-label={`Image ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="a-sleeve-blank">♪</div>
            )}
          </div>

          <div className="a-sheet-facts">
            {record.year && <span className="a-chip">{record.year}</span>}
            {record.genre && <span className="a-chip">{record.genre}</span>}
            {(record.subGenres ?? []).map((sg) => (
              <span key={sg} className="a-chip a-chip--soft">
                {sg}
              </span>
            ))}
            {record.location && (
              <span className="a-chip a-chip--soft">📍 {record.location}</span>
            )}
          </div>

          <h3 className="a-sheet-subhead">Tracklist</h3>
          <TrackRows discogsId={record.discogsId} />
          {record.discogsId && (
            <a
              className="a-sheet-credit"
              href={`https://www.discogs.com/release/${record.discogsId}`}
              target="_blank"
              rel="noreferrer"
            >
              Data provided by Discogs ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function FlipView({ records, onExit, onOpen }) {
  const [stack, setStack] = useState(() => shuffle(records));
  const [index, setIndex] = useState(0);
  const [exit, setExit] = useState(null);
  const stageRef = useRef(null);
  const busy = useRef(false);

  function advance(dir) {
    if (busy.current) return;
    busy.current = true;
    setExit(dir);
    setTimeout(() => {
      setIndex((i) => i + 1);
      setExit(null);
      busy.current = false;
    }, 220);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let startX = 0;
    let curX = 0;
    const start = (e) => {
      startX = e.touches[0].clientX;
      curX = startX;
    };
    const move = (e) => {
      curX = e.touches[0].clientX;
    };
    const end = () => {
      const dx = curX - startX;
      if (Math.abs(dx) > 45) advance(dx > 0 ? "right" : "left");
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

  const remaining = stack.slice(index, index + 5);
  const done = remaining.length === 0;

  return (
    <div className="a-flip">
      <div className="a-flip-bar">
        <button type="button" onClick={onExit}>
          ← Back to crate
        </button>
        <span>
          {Math.min(index + 1, stack.length)} / {stack.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setStack(shuffle(records));
            setIndex(0);
          }}
        >
          Reshuffle
        </button>
      </div>

      <div className="a-flip-stage" ref={stageRef}>
        {done ? (
          <div className="a-flip-done">
            <p>That&rsquo;s the whole crate.</p>
            <button
              type="button"
              onClick={() => {
                setStack(shuffle(records));
                setIndex(0);
              }}
            >
              Go again
            </button>
          </div>
        ) : (
          remaining
            .map((r, i) => (
              <div
                key={r.id}
                className={`a-flip-card${i === 0 && exit ? ` out-${exit}` : ""}`}
                style={{ "--i": i }}
                onClick={i === 0 ? () => onOpen(r) : undefined}
              >
                <Sleeve record={r} />
                <div className="a-flip-caption">
                  <strong>{r.title}</strong>
                  <span>{r.artist}</span>
                </div>
              </div>
            ))
            .reverse()
        )}
      </div>

      <div className="a-flip-hint">Swipe, tap Next, or press →</div>
      {!done && (
        <button
          type="button"
          className="a-flip-next"
          onClick={() => advance("left")}
        >
          Next record
        </button>
      )}
    </div>
  );
}

function VariantA({ records }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("artist-asc");
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState(null);
  const [flipping, setFlipping] = useState(false);

  const visible = useMemo(
    () => sortRecords(filterRecords(records, query), sort),
    [records, query, sort],
  );

  if (flipping) {
    return (
      <div className="variant-a">
        <FlipView
          records={visible}
          onExit={() => setFlipping(false)}
          onOpen={setActive}
        />
        {active && <Sheet record={active} onClose={() => setActive(null)} />}
      </div>
    );
  }

  return (
    <div className="variant-a">
      <header className="a-rail">
        <div className="a-rail-main">
          <div className="a-mark">
            <span className="a-mark-name">Vinyl Collection</span>
            <span className="a-mark-count">{visible.length} records</span>
          </div>

          <label className="a-search">
            <span aria-hidden>⌕</span>
            <input
              type="search"
              placeholder="Search artist, album, genre…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <button
            type="button"
            className="a-flip-btn"
            onClick={() => setFlipping(true)}
          >
            <span aria-hidden>⇄</span> Flip
          </button>

          <button
            type="button"
            className={`a-more${menuOpen ? " on" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More"
          >
            ⋯
          </button>
        </div>

        <div className="a-rail-sorts">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`a-sort${sort === s.key ? " on" : ""}`}
              onClick={() => setSort(s.key)}
              title={s.label}
            >
              {s.short}
            </button>
          ))}
        </div>

        {menuOpen && (
          <div className="a-menu">
            <button type="button">Share collection</button>
            <button type="button">Enter edit mode</button>
            <button type="button">Sync with Discogs</button>
          </div>
        )}
      </header>

      <main className="a-crate">
        {visible.length === 0 ? (
          <p className="a-empty">Nothing in the crate matches that.</p>
        ) : (
          <div className="a-grid">
            {visible.map((r) => (
              <Tile key={r.id} record={r} onOpen={setActive} />
            ))}
          </div>
        )}
      </main>

      {active && <Sheet record={active} onClose={() => setActive(null)} />}
    </div>
  );
}

export default VariantA;
