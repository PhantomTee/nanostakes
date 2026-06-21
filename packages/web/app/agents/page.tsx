import type { Metadata } from "next";
import Header from "@/components/Header";
import AgentsApp from "@/components/agents/AgentsApp";

export const metadata: Metadata = {
  title: "Agents: Nanostakes Arena",
};

export default function AgentsPage() {
  return (
    <>
      <Header active="/agents" />
      <AgentsApp />
    </>
  );
}
