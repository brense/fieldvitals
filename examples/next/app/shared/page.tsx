export default function Page() {
  return (
    <>
      <h1>Shared with you</h1>
      <p>
        One fixed page behind every <code>/share/…</code> address (a rewrite in{" "}
        <code>next.config.ts</code>). Its measurements are counted as <code>/shared</code>: the part
        of the address that differs per visitor never leaves the browser.
      </p>
    </>
  );
}
