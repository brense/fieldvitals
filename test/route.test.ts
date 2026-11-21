import { describe, expect, it } from "vitest";
import { MAX_ROUTE_LENGTH } from "../src/protocol.js";
import { NOT_FOUND_ROUTE, routePattern, treePattern } from "../src/route.js";

describe("routePattern", () => {
  it("leaves an address without parameters as it is", () => {
    expect(routePattern("/", {})).toBe("/");
    expect(routePattern("/pricing", {})).toBe("/pricing");
    expect(routePattern("/about/team", {})).toBe("/about/team");
  });

  it("drops a slash at the end", () => {
    expect(routePattern("/pricing/", {})).toBe("/pricing");
    expect(routePattern("/orders/8731/", { id: "8731" })).toBe("/orders/[id]");
  });

  it("puts the name of a parameter where its value is", () => {
    expect(routePattern("/orders/8731/edit", { id: "8731" })).toBe("/orders/[id]/edit");
    expect(routePattern("/8731", { id: "8731" })).toBe("/[id]");
  });

  it("handles several parameters", () => {
    expect(routePattern("/teams/red/members/42", { team: "red", member: "42" })).toBe(
      "/teams/[team]/members/[member]",
    );
  });

  it("keeps parameters with the same value apart", () => {
    expect(routePattern("/teams/x/members/x", { team: "x", member: "x" })).toBe(
      "/teams/[team]/members/[member]",
    );
    expect(routePattern("/x/x", { a: "x", b: "x" })).toBe("/[a]/[b]");
  });

  it("turns a parameter with several values into a catch-all", () => {
    expect(routePattern("/docs/a/b", { slug: ["a", "b"] })).toBe("/docs/[...slug]");
    expect(routePattern("/docs/a", { slug: ["a"] })).toBe("/docs/[...slug]");
    expect(routePattern("/shop/red/large/sale", { filters: ["red", "large"] })).toBe(
      "/shop/[...filters]/sale",
    );
  });

  it("treats an optional catch-all without values as absent", () => {
    expect(routePattern("/shop", {})).toBe("/shop");
    expect(routePattern("/shop", { filters: [] })).toBe("/shop");
    expect(routePattern("/shop", { filters: undefined })).toBe("/shop");
  });

  it("matches values whether or not they are percent-encoded", () => {
    expect(routePattern("/orders/caf%C3%A9%20x/edit", { id: "caf%C3%A9%20x" })).toBe(
      "/orders/[id]/edit",
    );
    expect(routePattern("/orders/caf%C3%A9%20x/edit", { id: "café x" })).toBe("/orders/[id]/edit");
    expect(routePattern("/docs/a%2Fb/c", { slug: ["a%2Fb", "c"] })).toBe("/docs/[...slug]");
    expect(routePattern("/docs/a%2Fb/c", { slug: ["a/b", "c"] })).toBe("/docs/[...slug]");
  });

  it("survives a value that is not valid percent-encoding", () => {
    expect(routePattern("/orders/100%/edit", { id: "100%" })).toBe("/orders/[id]/edit");
  });

  it("gives nothing when a value is not in the address", () => {
    expect(routePattern("/orders/8731/edit", { id: "9999" })).toBeNull();
    expect(routePattern("/docs/a/b", { slug: ["b", "a"] })).toBeNull();
    expect(routePattern("/a/b", { first: "b", second: "a" })).toBeNull();
  });

  it("never returns a value of a parameter that it could place", () => {
    const pattern = routePattern("/reset/s3cr3t-token/done", { token: "s3cr3t-token" });
    expect(pattern).toBe("/reset/[token]/done");
  });

  it("picks the last possible place when a value equals a fixed part", () => {
    expect(routePattern("/orders/edit/edit", { id: "edit" })).toBe("/orders/edit/[id]");
  });

  it("gives nothing for a pattern that is too long to send", () => {
    const long = "/" + "a".repeat(MAX_ROUTE_LENGTH);
    expect(routePattern(long, {})).toBeNull();
    expect(routePattern("/" + "a".repeat(MAX_ROUTE_LENGTH - 1), {})).not.toBeNull();
  });
});

describe("treePattern", () => {
  it("gives the pattern of the page that was rendered", () => {
    expect(treePattern([], {})).toBe("/");
    expect(treePattern(["pricing"], {})).toBe("/pricing");
    expect(treePattern(["blog", "hello-world"], { slug: "hello-world" })).toBe("/blog/[slug]");
    expect(treePattern(["orders", "8731", "edit"], { id: "8731" })).toBe("/orders/[id]/edit");
    expect(treePattern(["teams", "red", "members", "42"], { team: "red", member: "42" })).toBe(
      "/teams/[team]/members/[member]",
    );
  });

  it("handles catch-all segments, which the tree holds as one segment", () => {
    expect(treePattern(["docs", "guides/install"], { slug: ["guides", "install"] })).toBe(
      "/docs/[...slug]",
    );
    expect(treePattern(["shop", "shoes/red"], { filters: ["shoes", "red"] })).toBe(
      "/shop/[...filters]",
    );
    expect(treePattern(["shop"], {})).toBe("/shop");
  });

  it("leaves out route groups and the router's own markers", () => {
    expect(treePattern(["(marketing)", "about"], {})).toBe("/about");
    expect(treePattern(["(shop)", "(checkout)", "orders", "7"], { id: "7" })).toBe("/orders/[id]");
    expect(treePattern(["pricing", "__PAGE__"], {})).toBe("/pricing");
    expect(treePattern(["pricing", '__PAGE__?{"plan":"pro"}'], {})).toBe("/pricing");
    expect(treePattern(["__DEFAULT__"], {})).toBe("/");
  });

  it("names an intercepted route after the folder, without the marker", () => {
    expect(treePattern(["feed", "(.)photo", "12"], { id: "12" })).toBe("/feed/photo/[id]");
    expect(treePattern(["(..)(..)photo", "12"], { id: "12" })).toBe("/photo/[id]");
    expect(treePattern(["(...)photo", "12"], { id: "12" })).toBe("/photo/[id]");
  });

  it("goes by what was rendered, whatever the address in the browser is", () => {
    // /share/<token> rewritten to a fixed page: the token is nowhere in the tree
    expect(treePattern(["shared"], {})).toBe("/shared");
    // /u/<name> rewritten to /blog/<name>
    expect(treePattern(["blog", "alice"], { slug: "alice" })).toBe("/blog/[slug]");
  });

  it("knows the page for an address that matches nothing", () => {
    expect(treePattern([NOT_FOUND_ROUTE], {})).toBe("/_not-found");
    expect(treePattern(["(site)", NOT_FOUND_ROUTE], {})).toBe("/_not-found");
  });

  it("gives nothing without a tree, as in the Pages Router", () => {
    expect(treePattern(null, {})).toBeNull();
    expect(treePattern(undefined, {})).toBeNull();
    expect(treePattern(["pricing"], null)).toBeNull();
  });

  it("gives nothing when a parameter is not in the tree", () => {
    expect(treePattern(["feed"], { id: "12" })).toBeNull();
  });
});
