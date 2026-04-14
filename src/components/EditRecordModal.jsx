import { useMemo, useState, useEffect } from "react";
import CoverArtPicker from "./CoverArtPicker";
import SubGenrePicker from "./SubGenrePicker";
import "./EditRecordModal.css";

function EditRecordModal({
  record,
  onSave,
  onDelete = null,
  onClose,
  readOnly = false,
  genres = [],
  subGenres: subGenreOptions = [],
  onAddSubGenre,
  onDeleteSubGenre,
  onAddGenre,
}) {
  function getInitialFormData(nextRecord) {
    return {
      artist: nextRecord.artist || "",
      title: nextRecord.title || "",
      year:
        nextRecord.year === null || nextRecord.year === undefined
          ? ""
          : String(nextRecord.year),
      genre: nextRecord.genre || "",
      subGenres: Array.isArray(nextRecord.subGenres)
        ? nextRecord.subGenres
        : nextRecord.subGenres
          ? nextRecord.subGenres
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      location: nextRecord.location || "",
      coverUrl: nextRecord.coverUrl || "",
      vinylUrl: nextRecord.vinylUrl || "",
      vinylUrl2: nextRecord.vinylUrl2 || "",
    };
  }

  function normalizeFormData(data) {
    return {
      artist: String(data.artist ?? ""),
      title: String(data.title ?? ""),
      year:
        data.year === null || data.year === undefined ? "" : String(data.year),
      genre: String(data.genre ?? ""),
      subGenres: Array.isArray(data.subGenres) ? [...data.subGenres] : [],
      location: String(data.location ?? ""),
      coverUrl: String(data.coverUrl ?? ""),
      vinylUrl: String(data.vinylUrl ?? ""),
      vinylUrl2: String(data.vinylUrl2 ?? ""),
    };
  }

  const [formData, setFormData] = useState(() => getInitialFormData(record));
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const [initialFormJson] = useState(() =>
    JSON.stringify(normalizeFormData(getInitialFormData(record))),
  );

  const [tracklist, setTracklist] = useState(null);
  const [tracklistLoading, setTracklistLoading] = useState(
    () => !!(readOnly && record.discogsId),
  );

  useEffect(() => {
    if (!readOnly || !record.discogsId) return;
    fetch(`/api/discogs/release?id=${encodeURIComponent(record.discogsId)}`)
      .then((r) => r.json())
      .then((data) => {
        setTracklist(Array.isArray(data.tracklist) ? data.tracklist : null);
      })
      .catch(() => setTracklist(null))
      .finally(() => setTracklistLoading(false));
  }, [readOnly, record.discogsId]);

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!formData.artist.trim() || !formData.title.trim()) return;
    onSave(record.id, {
      artist: formData.artist.trim(),
      title: formData.title.trim(),
      year: formData.year ? parseInt(formData.year, 10) : null,
      genre: formData.genre.trim(),
      subGenres: formData.subGenres,
      location: formData.location.trim(),
      coverUrl: formData.coverUrl.trim(),
      vinylUrl: formData.vinylUrl.trim(),
      vinylUrl2: formData.vinylUrl2.trim(),
    });
  }

  const canDelete = !readOnly && typeof onDelete === "function";

  const isDirty = useMemo(() => {
    const current = JSON.stringify(normalizeFormData(formData));
    return current !== initialFormJson;
  }, [formData, initialFormJson]);

  function handleDeleteClick() {
    if (!canDelete) return;
    const label = `${record.artist || "Unknown Artist"} — ${record.title || "Untitled"}`;
    const ok = confirm(`Delete this record?\n\n${label}`);
    if (!ok) return;
    onDelete(record.id);
    onClose();
  }

  if (showCoverPicker) {
    return (
      <CoverArtPicker
        artist={formData.artist}
        title={formData.title}
        onSelect={(url) => {
          setFormData((prev) => ({ ...prev, coverUrl: url }));
          setShowCoverPicker(false);
        }}
        onClose={() => setShowCoverPicker(false)}
      />
    );
  }

  if (readOnly) {
    return (
      <div className="edit-modal-overlay" onClick={onClose}>
        <div
          className="edit-modal edit-modal--readonly"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="edit-modal-header">
            <h3>Record Details</h3>
            <button className="edit-modal-close" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="readonly-body">
            {formData.coverUrl ? (
              <div className="readonly-carousel">
                {(() => {
                  const images = [
                    formData.coverUrl,
                    formData.vinylUrl,
                    formData.vinylUrl2,
                  ].filter(Boolean);
                  return (
                    <>
                      {images.length > 1 && (
                        <button
                          className="carousel-btn carousel-btn-left"
                          onClick={() =>
                            setCarouselIndex(
                              (i) => (i - 1 + images.length) % images.length,
                            )
                          }
                          aria-label="Previous image"
                        >
                          ◀
                        </button>
                      )}
                      <div className="readonly-carousel-image">
                        <img
                          className="readonly-cover"
                          src={images[carouselIndex] || images[0]}
                          alt={carouselIndex === 0 ? "Cover" : "Vinyl"}
                        />
                        {images.length > 1 && (
                          <div className="carousel-dots">
                            {images.map((_, i) => (
                              <span
                                key={i}
                                className={`carousel-dot${i === carouselIndex ? " active" : ""}`}
                                onClick={() => setCarouselIndex(i)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      {images.length > 1 && (
                        <button
                          className="carousel-btn carousel-btn-right"
                          onClick={() =>
                            setCarouselIndex((i) => (i + 1) % images.length)
                          }
                          aria-label="Next image"
                        >
                          ▶
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="readonly-cover-placeholder">🎵</div>
            )}

            <div className="readonly-details">
              <div className="readonly-field">
                <span className="readonly-label">Artist</span>
                <span className="readonly-value">{formData.artist || "—"}</span>
              </div>
              <div className="readonly-field">
                <span className="readonly-label">Album</span>
                <span className="readonly-value">{formData.title || "—"}</span>
              </div>
              <div className="readonly-row">
                {formData.year && (
                  <div className="readonly-field">
                    <span className="readonly-label">Year</span>
                    <span className="readonly-value">{formData.year}</span>
                  </div>
                )}
                {formData.genre && (
                  <div className="readonly-field">
                    <span className="readonly-label">Genre</span>
                    <span className="readonly-value">{formData.genre}</span>
                  </div>
                )}
              </div>
              {formData.subGenres.length > 0 && (
                <div className="readonly-field">
                  <span className="readonly-label">Sub Genres</span>
                  <span className="readonly-value">
                    {formData.subGenres.join(", ")}
                  </span>
                </div>
              )}
              {formData.location && (
                <div className="readonly-field">
                  <span className="readonly-label">Location</span>
                  <span className="readonly-value">{formData.location}</span>
                </div>
              )}
            </div>

            {(tracklistLoading || (tracklist && tracklist.length > 0)) && (
              <div className="readonly-tracklist">
                <span className="readonly-label">Tracklist</span>
                {tracklistLoading ? (
                  <span className="readonly-tracklist-loading">Loading…</span>
                ) : (
                  <div className="readonly-tracklist-list">
                    {tracklist.map((track, i) => {
                      if (track.type_ === "heading") {
                        return (
                          <div key={i} className="readonly-tracklist-heading">
                            {track.title}
                          </div>
                        );
                      }
                      if (track.type_ !== "track") return null;
                      return (
                        <div key={i} className="readonly-tracklist-item">
                          <span className="readonly-tracklist-position">
                            {track.position}
                          </span>
                          <span className="readonly-tracklist-title">
                            {track.title}
                          </span>
                          {track.duration && (
                            <span className="readonly-tracklist-duration">
                              {track.duration}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <a
                  className="readonly-tracklist-attribution"
                  href={`https://www.discogs.com/release/${record.discogsId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Data provided by Discogs
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-modal-overlay" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-header">
          <h3>Edit Record</h3>
          <div className="edit-modal-header-actions">
            <button
              type="button"
              className="edit-modal-close"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="edit-modal-cover">
          <div className="edit-modal-cover-image-previews">
            {formData.coverUrl ? (
              <img src={formData.coverUrl} alt="Cover" />
            ) : (
              <div className="edit-modal-cover-placeholder">🎵</div>
            )}
            {formData.vinylUrl && <img src={formData.vinylUrl} alt="Vinyl" />}
            {formData.vinylUrl2 && (
              <img src={formData.vinylUrl2} alt="Vinyl 2" />
            )}
          </div>
          <div className="edit-modal-cover-actions">
            <button
              type="button"
              className="edit-modal-cover-btn"
              onClick={() => setShowCoverPicker(true)}
            >
              {formData.coverUrl
                ? "Change Cover Artwork"
                : "Find Cover Artwork"}
            </button>
            <a
              className="edit-modal-cover-link"
              href={`https://bendodson.com/projects/itunes-artwork-finder/?entity=album&country=us&query=${encodeURIComponent(formData.artist + " " + formData.title)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Search Artwork Finder ↗
            </a>
          </div>
        </div>

        <form className="edit-modal-form" onSubmit={handleSubmit}>
          <label>
            Artist *
            <input
              type="text"
              name="artist"
              value={formData.artist}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Album Title *
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
            />
          </label>
          <div className="edit-modal-row">
            <label>
              Year
              <input
                type="number"
                name="year"
                min="1900"
                max={new Date().getFullYear()}
                value={formData.year}
                onChange={handleChange}
              />
            </label>
            <label>
              Genre
              <select
                name="genre"
                className={formData.genre === "" ? "placeholder" : ""}
                value={formData.genre}
                onChange={(e) => {
                  if (e.target.value === "__add_new__") {
                    const name = prompt("Enter new genre:");
                    if (name?.trim()) {
                      onAddGenre(name.trim());
                      setFormData((prev) => ({ ...prev, genre: name.trim() }));
                    }
                  } else {
                    handleChange(e);
                  }
                }}
              >
                <option value="">Select genre</option>
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value="__add_new__">+ Add new…</option>
              </select>
            </label>
          </div>
          <div className="edit-modal-field">
            <span className="edit-modal-label">Sub Genres</span>
            <SubGenrePicker
              options={subGenreOptions}
              value={formData.subGenres}
              onChange={(selected) =>
                setFormData((prev) => ({ ...prev, subGenres: selected }))
              }
              onAddNew={onAddSubGenre}
              onDeleteOption={onDeleteSubGenre}
            />
          </div>
          <label>
            Location
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="e.g. Record Cabinet 1st Section"
            />
          </label>
          <label>
            Cover URL
            <input
              type="url"
              name="coverUrl"
              value={formData.coverUrl}
              onChange={handleChange}
              placeholder="https://..."
            />
          </label>
          <label>
            Vinyl URL
            <input
              type="url"
              name="vinylUrl"
              value={formData.vinylUrl}
              onChange={handleChange}
              placeholder="https://... (shown on hover)"
            />
          </label>
          <label>
            Vinyl URL 2
            <input
              type="url"
              name="vinylUrl2"
              value={formData.vinylUrl2}
              onChange={handleChange}
              placeholder="https://... (shown in carousel)"
            />
          </label>
          <div className="edit-modal-actions">
            <button type="submit">Save</button>
            {canDelete && !isDirty ? (
              <button
                type="button"
                className="edit-modal-delete"
                onClick={handleDeleteClick}
              >
                Delete
              </button>
            ) : (
              <button type="button" className="cancel-btn" onClick={onClose}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditRecordModal;
