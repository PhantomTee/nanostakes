import type { Metadata } from "next";
import Header from "@/components/Header";
import ConcourseApp from "@/components/concourse/ConcourseApp";

export const metadata: Metadata = {
  title: "Concourse — Nanostakes Arena",
};

export default function ConcoursePage() {
  return (
    <>
      <Header active="/concourse" />
      <ConcourseApp />
    </>
  );
}
