import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { GENRES, SUB_GENRES } from "../src/data/genreOptions.js";
import { createApiHandler } from "./api-handler.js";

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vinyl-api-handler-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createRequest({ method = "GET", url, body = "" }) {
  const request = new EventEmitter();
  request.method = method;
  request.url = url;

  queueMicrotask(() => {
    if (method === "POST") {
      request.emit("data", body);
      request.emit("end");
    }
  });

  return request;
}

function createResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

function responseJson(response) {
  return JSON.parse(response.body);
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("createApiHandler", () => {
  it("serves the records collection using the browser response shape", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(createRequest({ url: "/api/records" }), response, () => {
      throw new Error("unexpected next");
    });

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(responseJson(response)).toEqual({ records: [] });
  });

  it("replaces records and returns the existing save response shape", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const records = [{ id: "record-1", title: "Kind of Blue" }];
    const response = createResponse();

    await handler(
      createRequest({
        method: "POST",
        url: "/api/records",
        body: JSON.stringify({ records }),
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });

    const readResponse = createResponse();
    await handler(createRequest({ url: "/api/records" }), readResponse, () => {
      throw new Error("unexpected next");
    });
    expect(responseJson(readResponse)).toEqual({ records });
  });

  it.each([
    ["malformed JSON", '{"records":', "Malformed JSON body"],
    [
      "an invalid top-level shape",
      JSON.stringify({ records: { id: "not-an-array" } }),
      "records must be an array",
    ],
  ])("rejects %s for records", async (_name, body, error) => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "POST", url: "/api/records", body }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error });
  });

  it("rejects unsupported methods for records with an explicit JSON response", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "PATCH", url: "/api/records" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(405);
    expect(response.headers.Allow).toBe("GET, POST");
    expect(responseJson(response)).toEqual({ error: "Method not allowed" });
  });

  it("returns a JSON storage failure for records", async () => {
    const parentDirectory = await createTemporaryDirectory();
    const dataDir = path.join(parentDirectory, "data");
    await writeFile(dataDir, "not a directory");
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(createRequest({ url: "/api/records" }), response, () => {
      throw new Error("unexpected next");
    });

    expect(response.status).toBe(500);
    expect(responseJson(response).error).toMatch(/already exists|not a directory/);
  });

  it("serves genre options from the seeded JSON resource", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ url: "/api/genre-options?source=browser" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({
      genres: GENRES,
      subGenres: SUB_GENRES,
    });
  });

  it("replaces genre options and returns the existing save response shape", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const genreOptions = {
      genres: ["Jazz"],
      subGenres: ["Modal"],
    };
    const response = createResponse();

    await handler(
      createRequest({
        method: "POST",
        url: "/api/genre-options",
        body: JSON.stringify(genreOptions),
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });

    const readResponse = createResponse();
    await handler(
      createRequest({ url: "/api/genre-options" }),
      readResponse,
      () => {
        throw new Error("unexpected next");
      },
    );
    expect(responseJson(readResponse)).toEqual(genreOptions);
  });

  it.each([
    ["malformed JSON", '{"genres":', "Malformed JSON body"],
    [
      "an invalid top-level shape",
      JSON.stringify({ genres: ["Jazz"], subGenres: "not-an-array" }),
      "genres and subGenres must both be arrays",
    ],
  ])("rejects %s for genre options", async (_name, body, error) => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "POST", url: "/api/genre-options", body }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error });
  });

  it("rejects unsupported methods for genre options with an explicit JSON response", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "DELETE", url: "/api/genre-options" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(405);
    expect(response.headers.Allow).toBe("GET, POST");
    expect(responseJson(response)).toEqual({ error: "Method not allowed" });
  });

  it("returns a JSON storage failure for genre options", async () => {
    const parentDirectory = await createTemporaryDirectory();
    const dataDir = path.join(parentDirectory, "data");
    await writeFile(dataDir, "not a directory");
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ url: "/api/genre-options" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(500);
    expect(responseJson(response).error).toMatch(/already exists|not a directory/);
  });

  it("passes unrelated paths to the next middleware exactly once", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();
    let nextCalls = 0;

    await handler(createRequest({ url: "/shelves" }), response, () => {
      nextCalls += 1;
    });

    expect(nextCalls).toBe(1);
    expect(response.body).toBeNull();
  });

  it.each(["/api/unknown", "/api.php"])(
    "returns a JSON 404 for unknown owned path %s",
    async (url) => {
      const dataDir = await createTemporaryDirectory();
      const handler = createApiHandler({ dataDir });
      const response = createResponse();
      let nextCalls = 0;

      await handler(createRequest({ url }), response, () => {
        nextCalls += 1;
      });

      expect(nextCalls).toBe(0);
      expect(response.status).toBe(404);
      expect(responseJson(response)).toEqual({ error: "Not found" });
    },
  );
});
