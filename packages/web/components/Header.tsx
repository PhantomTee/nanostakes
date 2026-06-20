import Link from "next/link";
import WardenStatus from "./WardenStatus";

const NAV = [
  { href: "/concourse", label: "Concourse" },
  { href: "/ledger", label: "Ledger" },
  { href: "/how-it-works", label: "How it works" },
] as const;

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
        </nav>
      </div>
    </header>
  );
}
