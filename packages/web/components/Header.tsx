"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import WardenStatus from "./WardenStatus";
import ThemeToggle from "./ThemeToggle";
import { useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/concourse", label: "Concourse" },
  { href: "/ledger", label: "Ledger" },
  { href: "/agents", label: "Agents" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/tutorial", label: "Tutorial" },
  { href: "/how-it-works", label: "How it works" },
] as const;

const NAV_EXTERNAL = [
  { href: "/stream", label: "Stream", target: "_blank" as const },
] as const;

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ConnectWalletButton() {
  const { address, connecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button className="btn btn--ghost" type="button" onClick={disconnect} title="Click to disconnect">
        {short(address)}
      </button>
    );
  }

  return (
    <button className="btn btn--primary" type="button" onClick={connect} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

export default function Header({ active }: { active?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [active]);

  return (
    <header className="topbar">
      <div className="wrap">
        <Link className="brand" href="/">
          <span className="globe-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.4 2.5 3.8 6 3.8 9s-1.4 6.5-3.8 9c-2.4-2.5-3.8-6-3.8-9s1.4-6.5 3.8-9z" />
            </svg>
          </span>
          <b>NANOSTAKES</b>
          <i>&gt;ARENA</i>
        </Link>

        <div className="topbar-actions">
          <ThemeToggle />
          <button
            className="menu-toggle"
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>

        <nav className={`topnav ${menuOpen ? "is-open" : ""}`}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={active === item.href ? "is-active" : undefined}>
              {item.label}
            </Link>
          ))}
          {NAV_EXTERNAL.map((item) => (
            <a key={item.href} href={item.href} target={item.target} rel="noopener noreferrer">
              {item.label}
            </a>
          ))}
          {active === "/" ? <WardenStatus /> : null}
          <ConnectWalletButton />
        </nav>
      </div>
    </header>
  );
}
