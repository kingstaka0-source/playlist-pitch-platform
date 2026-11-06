
"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const crypto = require("node:crypto");

require("typescript");

const originalLoad = Module._load;
const originalEnv = { ...process.env };

const TEST_SECRET = "local-test-secret-not-for-production";
const CLAIM_ID = "test-claim-001";
const OWNER_ID = "spotify-owner-123";
const CLAIMANT_ID = "clerk-owner-123";

const state = {
  spotifyUserId: OWNER_ID,
  clerkUserId: CLAIMANT_ID,
  claimStatus: "PENDING",
  curatorClerkUserId: null,
  transactions: 0,
  updates: 0,
};

const claim = () => ({
  id: CLAIM_ID,
  curatorId: "test-curator-001",
  claimantClerkUserId: CLAIMANT_ID,
  status: state.claimStatus,
  playlist: {
    id: "test-playlist-001",
    ownerSpotifyId: OWNER_ID,
  },
  curator: {
    id: "test-curator-001",
    clerkUserId: state.curatorClerkUserId,
  },
});

const prismaMock = {
  playlistClaim: {
    findUnique: async () => claim(),
  },
  $transaction: async (callback) => {
    state.transactions++;

    const tx = {
      playlistClaim: {
        findUnique: async () => claim(),
        updateMany: async () => {
          state.claimStatus = "VERIFIED";
          state.updates++;
          return { count: 1 };
        },
      },
      curator: {
        update: async ({ data }) => {
          state.curatorClerkUserId = data.clerkUserId;
          state.updates++;
          return {};
        },
      },
    };

    return callback(tx);
  },
};

const axiosMock = {
  post: async () => ({
    data: { access_token: "fake-access-token" },
  }),
  get: async () => ({
    data: { id: state.spotifyUserId },
  }),
};

const clerkMock = {
  getAuth: () => ({
    userId: state.clerkUserId,
  }),
};

const envMock = {
  env: {
    SPOTIFY_CLIENT_ID: "test-client",
    SPOTIFY_CLIENT_SECRET: TEST_SECRET,
    SPOTIFY_CURATOR_REDIRECT_URI:
      "http://localhost:3100/curator-claims/spotify/callback",
    FRONTEND_URL: "http://localhost:3000",
  },
};

const reset = () => {
  state.spotifyUserId = OWNER_ID;
  state.clerkUserId = CLAIMANT_ID;
  state.claimStatus = "PENDING";
  state.curatorClerkUserId = null;
  state.transactions = 0;
  state.updates = 0;
};

function signedState() {
  const payload = Buffer.from(
    JSON.stringify({
      claimId: CLAIM_ID,
      claimantClerkUserId: CLAIMANT_ID,
      createdAt: Date.now(),
    }),
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", TEST_SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function mockResponse() {
  const result = {
    statusCode: 200,
    body: null,
    redirectUrl: null,
  };

  const res = {
    status(code) {
      result.statusCode = code;
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
    redirect(url) {
      result.redirectUrl = url;
      result.statusCode = 302;
      return res;
    },
  };

  return { res, result };
}

async function runHandler(handler, req) {
  const { res, result } = mockResponse();
  await handler(req, res);
  return result;
}

async function main() {
  // Register TypeScript only after module interception is ready.
  process.env.SPOTIFY_CLIENT_ID = "test-client";
  process.env.SPOTIFY_CLIENT_SECRET = TEST_SECRET;
  process.env.SPOTIFY_CURATOR_REDIRECT_URI =
    "http://localhost:3100/curator-claims/spotify/callback";

  Module._load = function (request, parent, isMain) {
    if (request === "axios") {
      return { __esModule: true, default: axiosMock };
    }

    if (request === "@clerk/express") {
      return clerkMock;
    }

    if (request === "../db" &&
        parent?.filename?.endsWith("curatorClaims.ts")) {
      return { prisma: prismaMock };
    }

    if (request === "../env" &&
        parent?.filename?.endsWith("curatorClaims.ts")) {
      return envMock;
    }

    return originalLoad.apply(this, arguments);
  };

  let router;

  try {
    require("ts-node/register/transpile-only");
    router = require("../src/routes/curatorClaims").default;
  } finally {
    Module._load = originalLoad;
    process.env = originalEnv;
  }

  assert.ok(router, "Curator claims router must load");

  function routeHandler(method, path) {
    const layer = router.stack.find(
      (item) =>
        item.route?.path === path &&
        item.route.methods[method],
    );

    assert.ok(layer, `Route missing: ${method} ${path}`);
    return layer.route.stack[0].handle;
  }

  const callback = routeHandler("get", "/spotify/callback");
  const start = routeHandler("post", "/:claimId/spotify/start");

  const callbackRequest = () => ({
    query: {
      code: "fake-code",
      state: signedState(),
    },
  });

  function check(name, fn) {
    return Promise.resolve()
      .then(fn)
      .then(() => console.log(`PASS | ${name}`));
  }

  reset();

  await check("Correct Spotify owner becomes VERIFIED", async () => {
    const result = await runHandler(callback, callbackRequest());

    assert.equal(result.statusCode, 302);
    assert.match(result.redirectUrl, /spotifyVerification=verified/);
    assert.equal(state.claimStatus, "VERIFIED");
    assert.equal(state.transactions, 1);
    assert.equal(state.updates, 2);
  });

  reset();
  state.spotifyUserId = "different-spotify-user";

  await check("Wrong Spotify owner is rejected", async () => {
    const result = await runHandler(callback, callbackRequest());

    assert.equal(result.statusCode, 302);
    assert.match(result.redirectUrl, /spotifyVerification=owner-mismatch/);
  });

  await check("Wrong owner cannot update database", async () => {
    assert.equal(state.claimStatus, "PENDING");
    assert.equal(state.transactions, 0);
    assert.equal(state.updates, 0);
  });

  reset();
  state.clerkUserId = "another-clerk-user";

  await check("Different Clerk user receives 403", async () => {
    const result = await runHandler(start, {
      params: { claimId: CLAIM_ID },
    });

    assert.equal(result.statusCode, 403);
    assert.equal(result.body?.error, "CLAIM_ACCESS_DENIED");
    assert.equal(state.transactions, 0);
    assert.equal(state.updates, 0);
  });

  console.log("\nALL SPOTIFY SECURITY TESTS PASSED");
}

main().catch((error) => {
  console.error("FAIL | Spotify security test", error);
  process.exitCode = 1;
});
