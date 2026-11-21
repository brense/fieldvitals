import { FieldVitals } from "@brows/fieldvitals/next";
import Link from "next/link";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "1.5rem" }}>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
          <Link href="/">Home</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/orders/8731/edit">Order</Link>
          <Link href="/docs/a/b">Docs</Link>
          <Link href="/shop">Shop</Link>
          <Link href="/shop/red/large">Shop filtered</Link>
          <Link href="/about">About</Link>
          <Link href="/blog/hello">Blog</Link>
          <Link href="/teams/x/members/x">Team</Link>
          <Link href="/share/abc123">Shared</Link>
          <Link href="/u/hello">Rewritten</Link>
          <Link href="/nope/secret-token">Missing</Link>
          <Link href="/vitals">Web vitals</Link>
        </nav>
        <FieldVitals />
        {children}
      </body>
    </html>
  );
}
