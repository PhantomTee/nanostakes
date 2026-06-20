import type { Metadata } from "next";
import Header from "@/components/Header";
import LedgerApp from "@/components/ledger/LedgerApp";

export const metadata: Metadata = {
  title: "Ledger — Nanostakes Arena",
};

export default function LedgerPage() {
  return (
    <>
      <Header active="/ledger" />
      <LedgerApp />
    </>
  );
}
