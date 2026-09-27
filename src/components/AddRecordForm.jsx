import { useState } from "react";
import SubGenrePicker from "./SubGenrePicker";
import "./RecordModal.css";
import "./AddRecordForm.css";

const emptyForm = {
  artist: "",
  title: "",
  year: "",
  genre: "",
  subGenres: [],
  location: "",
  coverUrl: "",
  vinylUrl: "",
  vinylUrl2: "",
};

function AddRecordForm({
  onAdd,
  onClose,
  genres,
  subGenres,
  onAddSubGenre,
  onDeleteSubGenre,
  onAddGenre,
}) {
  const [formData, setFormData] = useState(emptyForm);

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!formData.artist.trim() || !formData.title.trim()) return;

    onAdd({
      artist: formData.artist.trim(),
      title: formData.title.trim(),
      year: formData.year ? parseInt(formData.year, 10) : null,
      genre: formData.genre || "Unknown",
      subGenres: formData.subGenres,
      location: formData.location.trim(),
      coverUrl: formData.coverUrl.trim() || "",
      vinylUrl: formData.vinylUrl.trim(),
      vinylUrl2: formData.vinylUrl2.trim(),
    });

    setFormData(emptyForm);
    onClose();
  }

  function handleClose() {
    setFormData(emptyForm);
    onClose();
  }

  return (
    <div className="record-modal-overlay" onClick={handleClose}>
      <div className="record-modal" onClick={(e) => e.stopPropagation()}>
        <div className="record-modal-header">
          <h3>Add Record</h3>
          <button
            type="button"
            className="record-modal-close"
            onClick={handleClose}
            aria-label="Close add record form"
          >
            ✕
          </button>
        </div>

        <form className="record-modal-form" onSubmit={handleSubmit}>
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
          <div className="record-modal-row">
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
                      setFormData((prev) => ({
                        ...prev,
                        genre: name.trim(),
                      }));
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
          <div className="record-modal-field">
            <span className="record-modal-label">Sub Genres</span>
            <SubGenrePicker
              options={subGenres}
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
          <div className="record-modal-actions">
            <button type="submit">Add to Collection</button>
            <button
              type="button"
              className="cancel-btn"
              onClick={handleClose}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddRecordForm;
