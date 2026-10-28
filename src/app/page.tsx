import Image from "next/image";
import Link from "next/link";
import { SearchApp } from "@/components/search-app";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to search</a>
      <header className="site-header"><Link className="wordmark" href="/" aria-label="I Saw It Somewhere home"><Image src="/memory-mark.svg" alt="" width={34} height={38} priority /><span>somewhere<span className="wordmark-dot">.</span></span></Link><span className="header-note">A little memory goes a long way.</span></header>
      <SearchApp />
    </>
  );
}
