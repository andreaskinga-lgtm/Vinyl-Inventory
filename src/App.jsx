import { useState, useEffect, useRef, useCallback } from "react";
import AddRecordForm from "./components/AddRecordForm";
import EditRecordModal from "./components/EditRecordModal";
import ListeningRoom from "./components/ListeningRoom";
import { sampleRecords, generateId } from "./data/records.js";
import {
  GENRES as DEFAULT_GENRES,
  SUB_GENRES as DEFAULT_SUB_GENRES,
} from "./data/genreOptions";
import DiscogsImport from "./components/DiscogsImport";
import UpdatePrompt from "./components/UpdatePrompt";
import ShareCollectionModal from "./components/ShareCollectionModal";
import { useRegisterSW } from "virtual:pwa-register/react";
import "./App.css";

const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000;

function normalizeDiscogsConfig(data) {
  const validSources = new Set(["environment", "saved", "none"]);
  if (
    !data ||
    typeof data.username !== "string" ||
    typeof data.hasToken !== "boolean" ||
    !validSources.has(data.source) ||
    typeof data.canEdit !== "boolean"
  ) {
    throw new Error("Invalid Discogs credential response.");
  }
  return data;
}

async function requestDiscogsConfig() {
  const response = await fetch("/api/discogs-config");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body?.error ||
        `Unable to load Discogs credentials (HTTP ${response.status}).`,
    );
  }
  return normalizeDiscogsConfig(body);
}

function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [genres, setGenres] = useState(DEFAULT_GENRES);
  const [subGenres, setSubGenres] = useState(DEFAULT_SUB_GENRES);
  const [showDiscogsImport, setShowDiscogsImport] = useState(false);
  const [showShareCollection, setShowShareCollection] = useState(false);
  const [discogsConfig, setDiscogsConfig] = useState(null);
  const [discogsConfigLoading, setDiscogsConfigLoading] = useState(true);
  const [discogsConfigError, setDiscogsConfigError] = useState(null);
  const initialized = useRef(false);
  const optionsInitialized = useRef(false);
  const registrationRef = useRef(null);
  const {
    needRefresh: [isUpdateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_swUrl, registration) => {
      registrationRef.current = registration ?? null;
    },
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const registration = registrationRef.current;
      if (!registration) return;

      registration.update().catch((error) => {
        console.error("Unable to check for a PWA update:", error);
      });
    }, UPDATE_CHECK_INTERVAL);

    return () => window.clearInterval(intervalId);
  }, []);

  function handleReload() {
    updateServiceWorker(true).catch((error) => {
      console.error("Unable to activate the available PWA update:", error);
    });
  }

  const handleCloseShareCollection = useCallback(
    () => setShowShareCollection(false),
    [],
  );

  const loadDiscogsConfig = useCallback(async () => {
    setDiscogsConfig(await requestDiscogsConfig());
  }, []);

  useEffect(() => {
    requestDiscogsConfig()
      .then((config) => setDiscogsConfig(config))
      .catch((error) => {
        setDiscogsConfigError(
          error instanceof Error
            ? error.message
            : "Unable to load Discogs credentials.",
        );
      })
      .finally(() => setDiscogsConfigLoading(false));
  }, []);

  const handleSaveDiscogsConfig = useCallback(
    async ({ username, token }) => {
      const response = await fetch("/api/discogs-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          body?.error ||
            `Unable to save Discogs credentials (HTTP ${response.status}).`,
        );
      }
      await loadDiscogsConfig();
    },
    [loadDiscogsConfig],
  );

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

  function handleDiscogsImport(newRecs, updates, deletions = []) {
    // Collect any new genre / subGenre values from imported records
    const incomingGenres = newRecs.map((r) => r.genre).filter(Boolean);
    const incomingSubGenres = newRecs.flatMap((r) => r.subGenres ?? []);
    for (const g of incomingGenres) handleAddGenre(g);
    for (const sg of incomingSubGenres) handleAddSubGenre(sg);

    const deletionSet = new Set(deletions);
    setRecords((prev) => {
      // Apply enrichment to existing records, excluding deletions
      const enriched = prev
        .filter((r) => !deletionSet.has(r.id))
        .map((r) => {
          const update = updates.find((u) => u.existingId === r.id);
          return update ? { ...r, ...update.fields } : r;
        });
      // Prepend new records
      const created = newRecs.map((r) => ({ id: generateId(), ...r }));
      return [...created, ...enriched];
    });

    setShowDiscogsImport(false);
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

  const updatePrompt = (
    <UpdatePrompt
      isUpdateAvailable={isUpdateAvailable}
      onReload={handleReload}
    />
  );

  if (loading) {
    return (
      <div className="variant-c app-loading">
        {updatePrompt}
        <p>Loading collection…</p>
      </div>
    );
  }

  return (
    <>
      {updatePrompt}
      <ListeningRoom
        records={records}
        editMode={editMode}
        onEditRecord={setEditingRecord}
        onRequestEditMode={() => {
          setPasswordInput("");
          setShowPasswordPrompt(true);
        }}
        onLockEditMode={() => setEditMode(false)}
        onShare={() => setShowShareCollection(true)}
        onSync={() => setShowDiscogsImport(true)}
        addRecordControl={
          <AddRecordForm
            onAdd={handleAdd}
            genres={genres}
            subGenres={subGenres}
            onAddSubGenre={handleAddSubGenre}
            onDeleteSubGenre={handleDeleteSubGenre}
            onAddGenre={handleAddGenre}
          />
        }
      />

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
      {showDiscogsImport && (
        <DiscogsImport
          existingRecords={records}
          onImport={handleDiscogsImport}
          onClose={() => setShowDiscogsImport(false)}
          discogsConfig={discogsConfig}
          discogsConfigLoading={discogsConfigLoading}
          discogsConfigError={discogsConfigError}
          onSaveDiscogsConfig={handleSaveDiscogsConfig}
        />
      )}
      {showShareCollection && (
        <ShareCollectionModal onClose={handleCloseShareCollection} />
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
