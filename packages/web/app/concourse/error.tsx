"use client";

import { useEffect } from "react";

export default function ConcourseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError =
    error?.name === "ChunkLoadError" ||
    error?.message?.includes("ChunkLoadError") ||
    error?.message?.includes("Loading chunk") ||
    error?.message?.includes("Failed to fetch");

  useEffect(() => {
    // Chunk errors happen when a new deploy invalidates cached chunks.
    // A hard reload fetches the fresh manifest and chunk hashes.
    if (isChunkError) {
      window.location.reload();
    }
  }, [isChunkError]);

  if (isChunkError) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ fontSize: "0.85rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Refreshing after deploy…
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.78rem",
          color: "var(--stamp)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: 0,
        }}
      >
        Something went wrong loading the Concourse
      </p>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)", maxWidth: 420, margin: 0 }}>
        {error?.message ?? "An unexpected error occurred."}
      </p>
      <button
        className="btn btn--primary"
        onClick={reset}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}
