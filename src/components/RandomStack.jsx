import { useState, useRef, useEffect } from "react";
import RecordCard from "./RecordCard";
import "./RandomStack.css";

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function recordsKey(recs) {
  return recs.map((r) => r.id).join(",");
}

function RandomStack({ records, onBack, onClickRecord }) {
  const [stack, setStack] = useState(() => shuffleArray(records));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [prevKey, setPrevKey] = useState(() => recordsKey(records));
  const currentKey = recordsKey(records);
  if (prevKey !== currentKey) {
    setPrevKey(currentKey);
    setStack(shuffleArray(records));
    setCurrentIndex(0);
    setExiting(false);
  }

  function handleNext() {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => {
      setCurrentIndex((i) => i + 1);
      setExiting(false);
    }, 180);
  }

  const stageRef = useRef(null);
  const exitingRef = useRef(false);
  useEffect(() => {
    exitingRef.current = exiting;
  }, [exiting]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let startX = 0,
      curX = 0;

    function onTouchStart(e) {
      startX = e.touches[0].clientX;
      curX = startX;
    }
    function onTouchMove(e) {
      curX = e.touches[0].clientX;
    }
    function onTouchEnd() {
      const dx = curX - startX;
      if (dx > 50 && !exitingRef.current) {
        exitingRef.current = true;
        setExiting(true);
        setTimeout(() => {
          setCurrentIndex((i) => i + 1);
          setExiting(false);
          exitingRef.current = false;
        }, 180);
      }
    }

    stage.addEventListener("touchstart", onTouchStart, { passive: true });
    stage.addEventListener("touchmove", onTouchMove, { passive: true });
    stage.addEventListener("touchend", onTouchEnd, { passive: true });
    stage.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      stage.removeEventListener("touchstart", onTouchStart);
      stage.removeEventListener("touchmove", onTouchMove);
      stage.removeEventListener("touchend", onTouchEnd);
      stage.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  function handleReshuffle() {
    setStack(shuffleArray(records));
    setCurrentIndex(0);
    setExiting(false);
  }

  const remaining = stack.length - currentIndex;
  const isDone = remaining <= 0;

  const VISIBLE = 6;
  const visibleCards = isDone
    ? []
    : stack.slice(currentIndex, currentIndex + VISIBLE);

  return (
    <div className="random-stack-wrapper">
      <div className="random-stack-stage" ref={stageRef}>
        {isDone ? (
          <div className="random-stack-done">
            <p>
              You&rsquo;ve flipped through all {stack.length} records! Refresh
              to start fresh.
            </p>
            <button
              className="random-btn random-btn-reshuffle"
              onClick={handleReshuffle}
            >
              Reshuffle
            </button>
          </div>
        ) : (
          <>
            {visibleCards
              .map((record, i) => (
                <div
                  key={record.id}
                  className={`random-stack-card${i === 0 && exiting ? " exiting" : ""}`}
                  style={{ "--stack-index": i }}
                >
                  <RecordCard
                    record={record}
                    onClick={
                      i === 0 ? () => onClickRecord?.(record) : undefined
                    }
                  />
                </div>
              ))
              .reverse()}
          </>
        )}
      </div>

      <div className="random-stack-controls">
        {!isDone && (
          <>
            <button
              className="random-btn random-btn-next"
              onClick={handleNext}
              disabled={exiting}
            >
              Next
            </button>
            <button
              className="random-btn random-btn-reshuffle"
              onClick={handleReshuffle}
            >
              Reshuffle
            </button>
            <span className="random-stack-count">
              {currentIndex + 1} / {stack.length}
            </span>
          </>
        )}
        <button className="random-btn random-btn-back" onClick={onBack}>
          ← Back to Collection
        </button>
      </div>
    </div>
  );
}

export default RandomStack;
