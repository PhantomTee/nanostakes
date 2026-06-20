"use client";

import { useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";

export default function WardenStatus() {
  const dotRef = useRef<HTMLSpanElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const res = await fetch(apiUrl("/health"));
        if (!res.ok) throw new Error("down");
        const data = await res.json();
        if (cancelled) return;
        if (dotRef.current) dotRef.current.style.color = "#3f8f7d";
        if (linkRef.current) linkRef.current.title = `Warden online — ${data.warden}`;
        const docket = document.getElementById("footerDocket");
        if (docket) docket.textContent = `Docket no. ${data.warden.slice(0, 10)}…`;
      } catch {
        if (cancelled) return;
        if (dotRef.current) dotRef.current.style.color = "#b3331f";
        if (linkRef.current) linkRef.current.title = "Warden unreachable";
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a id="wardenStatus" href="/concourse" ref={linkRef}>
      <span className="pulse-dot" ref={dotRef}></span>
      <span className="label">Warden</span>
    </a>
  );
}
