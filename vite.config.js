import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import querystring from "node:querystring";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";

// ---------------------------------------------------------------------------
// Helper: outbound HTTPS GET for server-side proxy plugins
// ---------------------------------------------------------------------------
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () =>
      req.destroy(new Error("Discogs request timed out")),
    );
  });
}

// ---------------------------------------------------------------------------
// Simple JSON-file-backed records API so all devices share the same data.
// GET  /api/records        → returns the records array
// POST /api/records        → replaces the entire records array
// The data lives in <project>/data/records.json (created on first save).
// ---------------------------------------------------------------------------
function recordsApiPlugin() {
  const DATA_DIR = path.resolve(process.cwd(), "data");
  const DATA_FILE = path.join(DATA_DIR, "records.json");

  function readRecords() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("[records-api] Failed to read", DATA_FILE, e);
    }
    return null; // null means "no server data yet, use defaults"
  }

  function writeRecords(records) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
  }

  return {
    name: "records-api",
    configureServer(server) {
      // GET /api/records
      server.middlewares.use("/api/records", (req, res, next) => {
        if (req.method !== "GET") return next();
        const records = readRecords();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ records })); // records: null means "use defaults"
      });

      // POST /api/records
      server.middlewares.use("/api/records", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const { records } = JSON.parse(body);
            writeRecords(records);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// JSON-file-backed genre-options API.
// GET  /api/genre-options   → returns { genres, subGenres }
// POST /api/genre-options   → replaces the stored options
// ---------------------------------------------------------------------------
function genreOptionsApiPlugin() {
  const DATA_DIR = path.resolve(process.cwd(), "data");
  const DATA_FILE = path.join(DATA_DIR, "genreOptions.json");

  function readOptions() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("[genre-options-api] Failed to read", DATA_FILE, e);
    }
    return null;
  }

  function writeOptions(data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }

  return {
    name: "genre-options-api",
    configureServer(server) {
      server.middlewares.use("/api/genre-options", (req, res, next) => {
        if (req.method !== "GET") return next();
        const data = readOptions();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      });

      server.middlewares.use("/api/genre-options", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            writeOptions(data);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Line-for-line Node.js port of bendodson's api.php.
// Handles both GET ?type=request and POST type=data exactly as the PHP does.
// ---------------------------------------------------------------------------
function itunesApiPlugin() {
  return {
    name: "itunes-api",
    configureServer(server) {
      // ---------- GET ?type=request  (builds the iTunes search URL) ----------
      server.middlewares.use("/api.php", (req, res, next) => {
        if (req.method !== "GET") return next();
        const url = new URL(req.url, "http://localhost");
        const params = Object.fromEntries(url.searchParams);

        if (params.type !== "request") return next();

        const search = params.query;
        if (!search) {
          res.writeHead(400, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ error: "missing query" }));
          return;
        }

        let entity = params.entity;
        const country = params.country;

        // PHP urlencode() encodes spaces as +
        let itunesUrl;
        if (params.entity === "id" || params.entity === "idAlbum") {
          itunesUrl =
            "https://itunes.apple.com/lookup?id=" +
            encodeURIComponent(search).replace(/%20/g, "+") +
            "&country=" +
            params.country;
        } else {
          itunesUrl =
            "https://itunes.apple.com/search?term=" +
            encodeURIComponent(search).replace(/%20/g, "+") +
            "&country=" +
            country +
            "&entity=" +
            entity;
        }
        itunesUrl += "&limit=25";

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ url: itunesUrl }));
      });

      // ---------- POST type=data  (processes iTunes JSON results) ----------
      server.middlewares.use("/api.php", (req, res, next) => {
        if (req.method !== "POST") return next();

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const post = querystring.parse(body);
          if (post.type !== "data") {
            next();
            return;
          }

          let json;
          try {
            json = JSON.parse(post.json);
          } catch {
            res.writeHead(400, {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(JSON.stringify({ error: "bad json" }));
            return;
          }

          const entity = post.entity || "tvSeason";
          const output = [];

          for (const result of json.results || []) {
            // Filters from the PHP
            if (
              post.entity === "id" &&
              result.kind !== "feature-movie" &&
              result.wrapperType !== "collection"
            )
              continue;
            if (post.entity === "idAlbum" && result.collectionType !== "Album")
              continue;

            const data = {};
            data.url = (result.artworkUrl100 || "").replace(
              "100x100",
              "600x600",
            );

            // Hi-res URL construction (same as PHP)
            let hires = (result.artworkUrl100 || "").replace(
              "100x100bb",
              "100000x100000-999",
            );
            try {
              const parsed = new URL(hires);
              hires = "https://is5-ssl.mzstatic.com" + parsed.pathname;
            } catch {
              /* keep as-is */
            }
            data.hires = hires;
            data.title =
              entity === "movie" ? result.trackName : result.collectionName;

            // Uncompressed URL for albums
            if (post.entity === "album") {
              const parts = hires.split("/image/thumb/");
              if (parts.length === 2) {
                const segs = parts[1].split("/");
                segs.pop();
                data.uncompressed =
                  "https://a5.mzstatic.com/us/r1000/0/" + segs.join("/");
              }
            }

            // Entity-specific title formatting (same switch as PHP)
            switch (entity) {
              case "album":
                data.title =
                  result.collectionName + " (by " + result.artistName + ")";
                break;
            }

            if (data.title) {
              // Also pass through the raw fields the UI needs
              data.artworkUrl100 = result.artworkUrl100;
              data.collectionName = result.collectionName;
              data.artistName = result.artistName;
              output.push(data);
            }
          }

          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify(output));
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Discogs config API — persists { username, token } to data/discogsConfig.json
// GET  /api/discogs-config  → { username, hasToken }
// POST /api/discogs-config  → saves { username, token }
// ---------------------------------------------------------------------------
function discogsConfigApiPlugin() {
  const DATA_DIR = path.resolve(process.cwd(), "data");
  const DATA_FILE = path.join(DATA_DIR, "discogsConfig.json");

  function readConfig() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("[discogs-config-api] Failed to read", DATA_FILE, e);
    }
    return null;
  }

  function writeConfig(cfg) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2));
  }

  return {
    name: "discogs-config-api",
    configureServer(server) {
      // GET — return username + whether a token is saved (never expose token itself)
      server.middlewares.use("/api/discogs-config", (req, res, next) => {
        if (req.method !== "GET") return next();
        const cfg = readConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            username: cfg?.username ?? "",
            hasToken: !!cfg?.token,
          }),
        );
      });

      // POST — save username + token
      server.middlewares.use("/api/discogs-config", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (
              typeof data.username !== "string" ||
              typeof data.token !== "string"
            ) {
              throw new Error("username and token must be strings");
            }
            writeConfig({
              username: data.username.trim(),
              token: data.token.trim(),
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Discogs proxy API — server-side HTTPS calls so the token stays off the client
// GET /api/discogs/collection?username=X&page=1&per_page=100
// GET /api/discogs/search?artist=X&title=Y
// ---------------------------------------------------------------------------
function discogsApiPlugin() {
  const DATA_DIR = path.resolve(process.cwd(), "data");
  const DATA_FILE = path.join(DATA_DIR, "discogsConfig.json");

  function readToken() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"))?.token ?? null;
      }
    } catch (e) {
      console.error("[discogs-api] Failed to read config", e);
    }
    return null;
  }

  function discogsHeaders(token) {
    return {
      Authorization: `Discogs token=${token}`,
      "User-Agent": "VinylInventory/1.0",
      Accept: "application/vnd.discogs.v2.discogs+json",
    };
  }

  return {
    name: "discogs-api",
    configureServer(server) {
      // GET /api/discogs/collection
      server.middlewares.use("/api/discogs/collection", (req, res, next) => {
        if (req.method !== "GET") return next();
        const qs = new URL(req.url ?? "", "http://localhost");

        const username = qs.searchParams.get("username") ?? "";
        const page = parseInt(qs.searchParams.get("page") ?? "1", 10) || 1;
        const perPage = Math.min(
          parseInt(qs.searchParams.get("per_page") ?? "100", 10) || 100,
          100,
        );

        if (!username) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "username is required" }));
          return;
        }

        // Accept an inline token passed from the client, fall back to saved one
        const inlineToken = qs.searchParams.get("token") ?? "";
        const token = inlineToken || readToken();
        if (!token) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No Discogs token configured" }));
          return;
        }

        const discogsUrl =
          `https://api.discogs.com/users/${encodeURIComponent(username)}` +
          `/collection/folders/0/releases?page=${page}&per_page=${perPage}`;

        httpsGet(discogsUrl, discogsHeaders(token))
          .then(({ status, body }) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(body);
          })
          .catch((e) => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          });
      });

      // GET /api/discogs/search
      server.middlewares.use("/api/discogs/search", (req, res, next) => {
        if (req.method !== "GET") return next();
        const qs = new URL(req.url ?? "", "http://localhost");

        const artist = qs.searchParams.get("artist") ?? "";
        const title = qs.searchParams.get("title") ?? "";

        const inlineToken = qs.searchParams.get("token") ?? "";
        const token = inlineToken || readToken();
        if (!token) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No Discogs token configured" }));
          return;
        }

        const params = new URLSearchParams({
          artist,
          release_title: title,
          type: "release",
          per_page: "5",
        });
        const discogsUrl = `https://api.discogs.com/database/search?${params}`;

        httpsGet(discogsUrl, discogsHeaders(token))
          .then(({ status, body }) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(body);
          })
          .catch((e) => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          });
      });

      // GET /api/discogs/release?id=12345
      server.middlewares.use("/api/discogs/release", (req, res, next) => {
        if (req.method !== "GET") return next();
        const qs = new URL(req.url ?? "", "http://localhost");

        const id = qs.searchParams.get("id") ?? "";
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "id is required" }));
          return;
        }

        const token = readToken();
        if (!token) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No Discogs token configured" }));
          return;
        }

        const discogsUrl = `https://api.discogs.com/releases/${encodeURIComponent(id)}`;

        httpsGet(discogsUrl, discogsHeaders(token))
          .then(({ status, body }) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(body);
          })
          .catch((e) => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true, // enables SW in dev mode
      },
      includeAssets: [
        "vinyl-icon.svg",
        "vinyl-icon-192.png",
        "vinyl-icon-512.png",
      ],
      manifest: {
        name: "Vinyl Collection",
        short_name: "Vinyl",
        description: "Browse and manage your vinyl record collection",
        start_url: "/",
        display: "standalone",
        background_color: "#242424",
        theme_color: "#242424",
        orientation: "any",
        icons: [
          {
            src: "/vinyl-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/vinyl-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/vinyl-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    recordsApiPlugin(),
    genreOptionsApiPlugin(),
    itunesApiPlugin(),
    discogsConfigApiPlugin(),
    discogsApiPlugin(),
  ],
  server: {
    host: true, // listen on all network interfaces (0.0.0.0)
  },
});
