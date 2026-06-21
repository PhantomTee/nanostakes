"use client";

import Link from "next/link";
import WardenStatus from "./WardenStatus";
import { useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/concourse", label: "Concourse" },
  { href: "/ledger", label: "Ledger" },
  { href: "/agents", label: "Agents" },
  { href: "/how-it-works", label: "How it works" },
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
  return (
    <header className="topbar">
      <div className="wrap">
        <Link className="brand" href="/">
          <b>NANOSTAKES</b> <i>Arena</i>
        </Link>
        <nav className="topnav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={active === item.href ? "is-active" : undefined}>
              {item.label}
            </Link>
          ))}
          {active === "/" ? <WardenStatus /> : null}
          <ConnectWalletButton />
        </nav>
      </div>
    </header>
  );
}
