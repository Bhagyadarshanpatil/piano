"use client";
import dynamic from "next/dynamic";

const MobileApp = dynamic(() => import("./MobileApp"), { ssr: false });

export default function MobileWrapper() {
  return <MobileApp />;
}
