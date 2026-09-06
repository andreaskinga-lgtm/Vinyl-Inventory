// PROTOTYPE — throwaway. Variant B: "Divider Shelf".
// Thesis: the record-store divider card is the *structure*, not decoration.
// Records are grouped under sticky kraft tabs (A, B, C… / genre / decade) with
// a jump strip to skip through the crate. Detail is a full-screen "pull the
// sleeve out" page rather than a modal, so mobile never has a floating box
// that resizes when the tracklist lands.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SORTS,
  filterRecords,
  groupByDivider,
  imagesFor,
  metaLine,
  shuffle,
  sortRecords,
  useTracklist,
} from "./shared";
import "./VariantB.css";

export const name = "Divider Shelf";

function Cover({ record, className = "" }) {
  return (
    <div className={`b-cover ${className}`}>
      {record.coverUrl ? (
        <>
          <img className="b-cover-front" src={record.coverUrl} alt="" loading="lazy" />
          {record.vinylUrl && (
            <img className="b-cover-wax" src={record.vinylUrl} alt="" loading="lazy" />
          )}
        </>
      ) : (
        <div className="b-cover-blank">♪</div>
      )}
    </div>
  );
}

function DetailPage({ record, onClose }) {
  const { loading, tracks } = useTracklist(record.discogsId);
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
    <div className="b-detail" role="dialog" aria-modal="true">
      <div className="b-detail-bar">
        <button type="button" onClick={onClose}>
          ← Back to the crate
        </button>
        <span className="b-detail-tab">{record.genre || "Unfiled"}</span>
      </div>

      <div className="b-detail-scroll">
        <div className="b-detail-hero">
          <div
            className="b-detail-hero-wash"
            style={
              record.coverUrl
                ? { backgroundImage: `url(${record.coverUrl})` }
                : undefined
            }
          />
          <div className="b-detail-hero-inner">
            <div className="b-detail-art">
              {images.length ? (
                <img src={images[imageIndex] ?? images[0]} alt="" />
              ) : (
                <div className="b-cover-blank">♪</div>
              )}
              {images.length > 1 && (
                <div className="b-detail-thumbs">
                  {images.map((src, i) => (
                    <button
                      key={src}
                      type="button"
                      className={i === imageIndex ? "on" : ""}
                      onClick={() => setImageIndex(i)}
                    >
                      <img src={src} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="b-detail-titles">
              <p className="b-detail-artist">{record.artist}</p>
              <h1>{record.title}</h1>
              <p className="b-detail-meta">{metaLine(record)}</p>
              {record.location && (
                <p className="b-detail-loc">Filed under {record.location}</p>
              )}
            </div>
          </div>
        </div>

        <section className="b-detail-tracks">
          <h2>Tracklist</h2>
          {!record.discogsId ? (
            <p className="b-detail-note">No tracklist linked to this pressing.</p>
          ) : loading ? (
            <ol className="b-tracklist">
              {Array.from({ length: 9 }).map((_, i) => (
                <li key={i} className="b-track b-track--skeleton">
                  <span />
                </li>
              ))}
            </ol>
          ) : tracks?.length ? (
            <ol className="b-tracklist">
              {tracks.map((t, i) =>
                t.type_ === "heading" ? (
                  <li key={i} className="b-track-heading">
                    {t.title}
                  </li>
                ) : t.type_ === "track" ? (
                  <li key={i} className="b-track">
                    <span className="b-track-pos">{t.position}</span>
                    <span className="b-track-title">{t.title}</span>
                    {t.duration && (
                      <span className="b-track-dur">{t.duration}</span>
                    )}
                  </li>
                ) : null,
              )}
            </ol>
          ) : (
            <p className="b-detail-note">No tracklist available.</p>
          )}

          {record.discogsId && (
            <a
              className="b-detail-credit"
              href={`https://www.discogs.com/release/${record.discogsId}`}
              target="_blank"
              rel="noreferrer"
            >
              Data provided by Discogs ↗
            </a>
          )}
        </section>
      </div>
    </div>
  );
}

function FlipView({ records, onExit, onOpen }) {
  const [stack, setStack] = useState(() => shuffle(records));
  const [index, setIndex] = useState(0);
  const [exit, setExit] = useState(null);
  const busy = useRef(false);
  const stageRef = useRef(null);

  function advance(dir) {
    if (busy.current) return;
    busy.current = true;
    setExit(dir);
    setTimeout(() => {
      setIndex((i) => i + 1);
      setExit(null);
      busy.current = false;
    }, 200);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let startX = 0;
    let curX = 0;
    const start = (e) => {
      startX = curX = e.touches[0].clientX;
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

  const visible = stack.slice(index, index + 5);
  const done = visible.length === 0;
  const front = visible[0];

  return (
    <div className="b-flip">
      <div className="b-flip-head">
        <button type="button" className="b-flip-back" onClick={onExit}>
          ← Crate
        </button>
        <span className="b-flip-tab">Flipping</span>
        <button
          type="button"
          className="b-flip-back"
          onClick={() => {
            setStack(shuffle(records));
            setIndex(0);
          }}
        >
          Reshuffle
        </button>
      </div>

      <div className="b-flip-bin" ref={stageRef}>
        {done ? (
          <div className="b-flip-done">
            <p>End of the crate.</p>
            <button
              type="button"
              onClick={() => {
                setStack(shuffle(records));
                setIndex(0);
              }}
            >
              Start over
            </button>
          </div>
        ) : (
          visible
            .map((r, i) => (
              <div
                key={r.id}
                className={`b-flip-card${i === 0 && exit ? ` out-${exit}` : ""}`}
                style={{ "--i": i }}
                onClick={i === 0 ? () => onOpen(r) : undefined}
              >
                <Cover record={r} />
              </div>
            ))
            .reverse()
        )}
        <div className="b-flip-lip" />
      </div>

      {front && (
        <div className="b-flip-info">
          <strong>{front.title}</strong>
          <span>{front.artist}</span>
          <em>{metaLine(front)}</em>
        </div>
      )}

      {!done && (
        <div className="b-flip-actions">
          <button type="button" onClick={() => advance("left")}>
            Flip past →
          </button>
          <span>
            {index + 1} of {stack.length}
          </span>
        </div>
      )}
    </div>
  );
}

function VariantB({ records }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("artist-asc");
  const [utilsOpen, setUtilsOpen] = useState(false);
  const [active, setActive] = useState(null);
  const [flipping, setFlipping] = useState(false);
  const scrollRef = useRef(null);

  const groups = useMemo(
    () => groupByDivider(sortRecords(filterRecords(records, query), sort), sort),
    [records, query, sort],
  );
  const total = groups.reduce((n, g) => n + g.records.length, 0);

  function jumpTo(key) {
    const el = scrollRef.current?.querySelector(
      `[data-divider="${CSS.escape(key)}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (flipping) {
    return (
      <div className="variant-b">
        <FlipView
          records={groups.flatMap((g) => g.records)}
          onExit={() => setFlipping(false)}
          onOpen={setActive}
        />
        {active && (
          <DetailPage record={active} onClose={() => setActive(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="variant-b" ref={scrollRef}>
      <header className="b-head">
        <div className="b-head-row">
          <h1 className="b-wordmark">
            Vinyl<span>Collection</span>
          </h1>
          <button
            type="button"
            className="b-utils-toggle"
            onClick={() => setUtilsOpen((v) => !v)}
            aria-label="Collection tools"
          >
            {utilsOpen ? "✕" : "☰"}
          </button>
        </div>

        <div className="b-controls">
          <input
            className="b-search"
            type="search"
            placeholder="Search the crate…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="b-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Divide crate by"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {utilsOpen && (
          <div className="b-utils">
            <button type="button">Share collection</button>
            <button type="button">Edit mode</button>
            <button type="button">Sync with Discogs</button>
            <span className="b-utils-count">{total} records filed</span>
          </div>
        )}
      </header>

      <nav className="b-jump" aria-label="Jump to divider">
        <button
          type="button"
          className="b-jump-flip"
          onClick={() => setFlipping(true)}
        >
          ⇄ Flip
        </button>
        <div className="b-jump-keys">
          {groups.map((g) => (
            <button key={g.key} type="button" onClick={() => jumpTo(g.key)}>
              {g.key}
            </button>
          ))}
        </div>
      </nav>

      <main className="b-shelves">
        {groups.length === 0 && (
          <p className="b-empty">Nothing filed under that.</p>
        )}
        {groups.map((group) => (
          <section
            key={group.key}
            className="b-section"
            data-divider={group.key}
          >
            <div className="b-divider">
              <span className="b-divider-tab">{group.key}</span>
              <span className="b-divider-rule" />
              <span className="b-divider-count">{group.records.length}</span>
            </div>

            <div className="b-shelf">
              {group.records.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="b-slot"
                  onClick={() => setActive(r)}
                >
                  <Cover record={r} />
                  <span className="b-slot-text">
                    <span className="b-slot-title">{r.title}</span>
                    <span className="b-slot-artist">{r.artist}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="b-shelf-lip" />
          </section>
        ))}
      </main>

      {active && <DetailPage record={active} onClose={() => setActive(null)} />}
    </div>
  );
}

export default VariantB;
