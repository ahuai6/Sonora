import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { MetadataMatcher } from "../main/services/metadata-match.mjs";
test("public metadata candidates preserve album editions, credits and lyrics while remaining read-only", async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url,
      cookie: req.headers.cookie,
      agent: req.headers["user-agent"],
    });
    res.setHeader("Content-Type", "application/json");
    const p = new URL(req.url, "http://localhost");
    if (p.pathname === "/mb/recording")
      res.end(
        JSON.stringify({
          recordings: [
            {
              id: "recording-id",
              title: "Title",
              length: 100000,
              isrcs: ["ISRC-CODE"],
              "artist-credit": [
                { name: "A", joinphrase: " & " },
                { name: "B" },
              ],
              releases: [
                { id: "edition-1", title: "First Album", date: "2026-01-01" },
                { id: "edition-2", title: "Other Edition", date: "2025-01-01" },
              ],
            },
          ],
        }),
      );
    else if (p.pathname.startsWith("/cover/"))
      res.end(
        JSON.stringify({
          images: [
            {
              front: true,
              thumbnails: { large: "https://example.com/front.jpg" },
            },
          ],
        }),
      );
    else
      res.end(
        JSON.stringify([
          {
            id: 1,
            trackName: "Title",
            artistName: "Artist",
            albumName: "Album",
            duration: 100,
            syncedLyrics: "[00:01]Actual lyrics",
          },
        ]),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const providers = {
    config: {
      metadataSources: {
        musicbrainz: base + "/mb",
        coverart: base + "/cover",
        lrclib: base + "/lr",
      },
    },
    search: async ({ platform }) => ({
      items: [],
      errors: [{ message: platform + " unavailable" }],
    }),
  };
  const matcher = new MetadataMatcher(providers, {
    known: () => ({ title: "Title", artist: "Artist", duration: 98 }),
  });
  const r = await matcher.search({
    localId: "local-id",
    source: "musicbrainz",
    query: "Title Artist",
  });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].tags.artist, "A & B");
  assert.equal(r.items[0].tags.year, 2026);
  assert.equal(r.items[0].durationDifference, 2);
  assert.notEqual(r.items[0].matchId, r.items[1].matchId);
  assert.equal(
    await matcher.cover(r.items[0].matchId),
    "https://example.com/front.jpg",
  );
  await assert.rejects(() => matcher.lyrics(r.items[0].matchId), /不提供歌词/);
  const l = await matcher.search({
    localId: "local-id",
    source: "lrclib",
    query: "Title",
  });
  assert.equal(
    (await matcher.lyrics(l.items[0].matchId)).text.includes("Actual lyrics"),
    true,
  );
  await assert.rejects(() => matcher.cover("renderer-forged-id"), /已过期/);
  const all = await matcher.search({
    localId: "local-id",
    source: "all",
    query: "Title",
  });
  assert.equal(all.errors.length, 3);
  assert.equal(all.items.length, 2);
  assert(requests.every((r) => !r.cookie && r.agent.includes("Sonora")));
});
