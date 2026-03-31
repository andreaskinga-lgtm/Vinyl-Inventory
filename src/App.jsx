import { useState, useEffect, useRef, useCallback } from "react";
import bgImage from "./assets/RecordCollectionBG.png";
import RecordList from "./components/RecordList";
import RandomStack from "./components/RandomStack";
import AddRecordForm from "./components/AddRecordForm";
import EditRecordModal from "./components/EditRecordModal";
import { sampleRecords, generateId } from "./data/records.js";
import {
  GENRES as DEFAULT_GENRES,
  SUB_GENRES as DEFAULT_SUB_GENRES,
} from "./data/genreOptions";
import "./App.css";

function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("artist-asc");
  const [editingRecord, setEditingRecord] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [genres, setGenres] = useState(DEFAULT_GENRES);
  const [subGenres, setSubGenres] = useState(DEFAULT_SUB_GENRES);
  const [randomMode, setRandomMode] = useState(false);
  const initialized = useRef(false);
  const optionsInitialized = useRef(false);
  const bgRef = useRef(null);

  // Load genre options from server on mount
  useEffect(() => {
    fetch("/api/genre-options")
      .then((r) => r.json())
      .then((data) => {
        if (data?.genres) setGenres(data.genres);
        if (data?.subGenres) setSubGenres(data.subGenres);
        optionsInitialized.current = true;
      })
      .catch((e) => {
        console.error("Failed to load genre options:", e);
        optionsInitialized.current = true;
      });
  }, []);

  // Load records from server on mount
  useEffect(() => {
    fetch("/api/records")
      .then((r) => r.json())
      .then((data) => {
        // If server has saved data use it, otherwise seed with defaults
        setRecords(data.records ?? sampleRecords);
        setLoading(false);
        initialized.current = true;
      })
      .catch((e) => {
        console.error("Failed to load records:", e);
        setRecords(sampleRecords);
        setLoading(false);
        initialized.current = true;
      });
  }, []);

  // Save records to server whenever they change (skip the initial load)
  useEffect(() => {
    if (!initialized.current) return;
    fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
    }).catch((e) => console.error("Failed to save records:", e));
  }, [records]);

  function handleAdd(newRecord) {
    setRecords((prev) => [{ id: generateId(), ...newRecord }, ...prev]);
  }

  function handleDelete(id) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  function handleEdit(id, updatedFields) {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updatedFields } : r)),
    );
    setEditingRecord(null);
  }

  function saveGenreOptions(nextGenres, nextSubGenres) {
    fetch("/api/genre-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genres: nextGenres, subGenres: nextSubGenres }),
    }).catch((e) => console.error("Failed to save genre options:", e));
  }

  const handleAddSubGenre = useCallback(
    (newSubGenre) => {
      setSubGenres((prev) => {
        if (prev.includes(newSubGenre)) return prev;
        const next = [...prev, newSubGenre].sort((a, b) => a.localeCompare(b));
        saveGenreOptions(genres, next);
        return next;
      });
    },
    [genres],
  );

  const handleDeleteSubGenre = useCallback(
    (subGenre) => {
      setSubGenres((prev) => {
        const next = prev.filter((sg) => sg !== subGenre);
        saveGenreOptions(genres, next);
        return next;
      });
    },
    [genres],
  );

  const handleAddGenre = useCallback(
    (newGenre) => {
      setGenres((prev) => {
        if (prev.includes(newGenre)) return prev;
        const next = [...prev, newGenre].sort((a, b) => a.localeCompare(b));
        saveGenreOptions(next, subGenres);
        return next;
      });
    },
    [subGenres],
  );

  // Handles parallax effect on background image
  const maxScrollHeightRef = useRef(0);
  useEffect(() => {
    const parallaxFactor = 0.3;
    const updateBg = () => {
      if (!bgRef.current) return;
      const currentScrollHeight = document.documentElement.scrollHeight;
      if (currentScrollHeight > maxScrollHeightRef.current) {
        maxScrollHeightRef.current = currentScrollHeight;
      }
      const maxScroll = maxScrollHeightRef.current - window.innerHeight;
      const extraHeight = maxScroll * parallaxFactor;
      bgRef.current.style.height = `calc(100vh + ${extraHeight}px)`;
      const currentMaxScroll = currentScrollHeight - window.innerHeight;
      const clampedScroll = Math.min(
        window.scrollY,
        Math.max(0, currentMaxScroll),
      );
      bgRef.current.style.transform = `translateY(${clampedScroll * -parallaxFactor}px)`;
    };
    updateBg();
    window.addEventListener("scroll", updateBg, { passive: true });
    window.addEventListener("resize", updateBg, { passive: true });
    const observer = new ResizeObserver(updateBg);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener("scroll", updateBg);
      window.removeEventListener("resize", updateBg);
      observer.disconnect();
    };
  }, []);

  // Searching logic - filter records by search query across multiple fields
  const filtered = records.filter((r) => {
    const q = search.toLowerCase();
    return (
      r.title.toLowerCase().includes(q) ||
      r.artist.toLowerCase().includes(q) ||
      r.genre.toLowerCase().includes(q) ||
      (Array.isArray(r.subGenres) &&
        r.subGenres.some((sg) => sg.toLowerCase().includes(q))) ||
      (r.location && r.location.toLowerCase().includes(q))
    );
  });

  if (loading) {
    return (
      <>
        <div
          className="parallax-bg"
          ref={bgRef}
          style={{ backgroundImage: `url(${bgImage})` }}
        />
        <div
          style={{ textAlign: "center", marginTop: "4rem", fontSize: "1.2rem" }}
        >
          Loading collection…
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="parallax-bg"
        ref={bgRef}
        style={{ backgroundImage: `url(${bgImage})` }}
      />
      <header className="app-header">
        <div className="app-header-top">
          <h1>Vinyl Collection</h1>
        </div>
        {!randomMode && (
          <p className="collection-count">{filtered.length} records</p>
        )}
      </header>

      {!randomMode && (
        <div className="search-sort-row">
          <input
            className="search-input"
            type="search"
            autoComplete="off"
            placeholder="Search by title, artist, genre, or location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!randomMode && (
            <select
              className="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="artist-asc">Artist A–Z</option>
              <option value="artist-desc">Artist Z–A</option>
              <option value="year-asc">Year Asc</option>
              <option value="year-desc">Year Desc</option>
              <option value="genre-asc">Genre A–Z</option>
              <option value="genre-desc">Genre Z–A</option>
            </select>
          )}

          {!randomMode && !editMode && (
            <button
              className="random-mode-btn"
              onClick={() => setRandomMode(true)}
            >
              Random
            </button>
          )}
          <button
            className={`edit-mode-btn${editMode ? " active" : ""}`}
            onClick={() => {
              if (editMode) {
                setEditMode(false);
              } else {
                setPasswordInput("");
                setShowPasswordPrompt(true);
              }
            }}
          >
            {editMode ? "Lock" : "Edit Mode"}
          </button>
          {editMode && (
            <AddRecordForm
              onAdd={handleAdd}
              genres={genres}
              subGenres={subGenres}
              onAddSubGenre={handleAddSubGenre}
              onDeleteSubGenre={handleDeleteSubGenre}
              onAddGenre={handleAddGenre}
            />
          )}
        </div>
      )}

      {randomMode ? (
        <RandomStack
          records={filtered}
          onBack={() => setRandomMode(false)}
          onClickRecord={(record) => setEditingRecord(record)}
        />
      ) : (
        <RecordList
          records={filtered}
          sort={sort}
          onClickRecord={(record) => setEditingRecord(record)}
        />
      )}

      {editingRecord && (
        <EditRecordModal
          key={editingRecord.id}
          record={editingRecord}
          onSave={handleEdit}
          onDelete={editMode ? handleDelete : null}
          onClose={() => setEditingRecord(null)}
          readOnly={!editMode}
          genres={genres}
          subGenres={subGenres}
          onAddSubGenre={handleAddSubGenre}
          onDeleteSubGenre={handleDeleteSubGenre}
          onAddGenre={handleAddGenre}
        />
      )}
      {showPasswordPrompt && (
        <div
          className="pw-overlay"
          onClick={() => setShowPasswordPrompt(false)}
        >
          <div className="pw-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Enter password to enable editing:</p>
            <input
              type="password"
              className="pw-input"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (passwordInput === "EditRecords") setEditMode(true);
                  setShowPasswordPrompt(false);
                } else if (e.key === "Escape") {
                  setShowPasswordPrompt(false);
                }
              }}
              autoFocus
            />
            <div className="pw-actions">
              <button onClick={() => setShowPasswordPrompt(false)}>
                Cancel
              </button>
              <button
                className="pw-submit"
                onClick={() => {
                  if (passwordInput === "EditRecords") setEditMode(true);
                  setShowPasswordPrompt(false);
                }}
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
