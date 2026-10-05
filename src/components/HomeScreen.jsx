import { useMemo } from "react";
import { shuffle } from "../utils/collectionView.js";
import "./HomeScreen.css";

function HomeScreen({ records = [], onBrowse, onOpenPhone }) {
  const coverArt = useMemo(
    () => shuffle(records.filter((record) => record.coverUrl)).slice(0, 4),
    [records],
  );

  return (
    <main className="home-screen" aria-labelledby="home-screen-title">
      <div className="home-screen-shell">
        <div className="home-screen-art-stage" aria-hidden="true">
          {coverArt.map((record, index) => (
            <div
              className={`home-screen-art home-screen-art--${index + 1}`}
              key={record.id}
            >
              <img src={record.coverUrl} alt="" />
            </div>
          ))}
          {coverArt.length === 0 && (
            <>
              <div className="home-screen-art home-screen-art--1" />
              <div className="home-screen-art home-screen-art--2" />
              <div className="home-screen-art home-screen-art--3" />
            </>
          )}
        </div>

        <div className="home-screen-panel">
          <p className="home-screen-kicker">Vinyl Collection</p>
          <h1 id="home-screen-title">Explore the collection.</h1>
          <p className="home-screen-copy">
            Browse my collection of records here or open the collection on your
            phone.
          </p>
          <div className="home-screen-actions">
            <button
              type="button"
              className="home-screen-primary"
              onClick={onBrowse}
            >
              Browse on this device
            </button>
            <button
              type="button"
              className="home-screen-secondary"
              onClick={onOpenPhone}
            >
              Open on your phone
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default HomeScreen;
