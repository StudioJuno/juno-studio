import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import http from "node:http";
import { createReviewServer } from "../server/review/server.mjs";

const uid = () => randomUUID(),
  sha = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-review-test-")),
    token = randomBytes(32).toString("base64url");
  const service = await createReviewServer({
    dataDir: root,
    bootstrapToken: token,
    ...options,
  });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  t.after(async () => {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = service.origin();
  const api = async (route, method = "GET", body, options = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(options.client
          ? {
              "X-Juno-Client": "1",
              ...(options.cookie ? { Cookie: options.cookie } : {}),
            }
          : { Authorization: "Bearer " + (options.token || token) }),
        ...(body instanceof Buffer
          ? options.headers
          : body == null
            ? {}
            : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body:
        body == null
          ? undefined
          : Buffer.isBuffer(body)
            ? body
            : JSON.stringify(body),
    });
    const bytes = await response.arrayBuffer();
    let data;
    try {
      data = JSON.parse(Buffer.from(bytes).toString());
    } catch {
      data = Buffer.from(bytes);
    }
    if (options.status != null)
      assert.equal(response.status, options.status, JSON.stringify(data));
    else assert.ok(response.ok, JSON.stringify(data));
    return { data, response };
  };
  async function delivery(projectId = uid()) {
    return (
      await api("/api/admin/deliveries", "POST", {
        opId: uid(),
        projectId,
        projectName: "Projet",
        title: "Votre sélection",
        message: "Vos retours",
      })
    ).data;
  }
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 4, 1, 2, 255, 217]);
  async function version(deliveryId, { publish = true, kind = "photo" } = {}) {
    const revision = (
      await api(`/api/admin/deliveries/${deliveryId}/revisions`, "POST", {
        opId: uid(),
        count: 1,
      })
    ).data;
    const assetId = uid(),
      bytes =
        kind === "video"
          ? Buffer.from([
              0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
              109, 112, 52, 50, 105, 115, 111, 109,
            ])
          : jpeg;
    await api(`/api/admin/revisions/${revision.id}/assets`, "POST", {
      id: assetId,
      logicalId: "original",
      kind,
      name: kind === "photo" ? "Portrait.jpg" : "Film.mp4",
      mime: kind === "photo" ? "image/jpeg" : "video/mp4",
      size: bytes.length,
      sha256: sha(bytes),
      position: 0,
      metadata: {
        width: 100,
        height: 150,
        ...(kind === "video" ? { frames: 100, fps: { n: 25, d: 1 } } : {}),
      },
    });
    const upload = {
      headers: { "Upload-Offset": "0", "X-Chunk-Sha256": sha(bytes) },
    };
    await api(`/api/admin/assets/${assetId}/content`, "PUT", bytes, upload);
    await api(`/api/admin/assets/${assetId}/content`, "PUT", bytes, upload);
    await api(`/api/admin/assets/${assetId}/complete`, "POST", {});
    await api(`/api/admin/assets/${assetId}/thumbnail`, "PUT", jpeg);
    if (publish)
      await api(`/api/admin/revisions/${revision.id}/publish`, "POST", {
        opId: uid(),
      });
    return { revision, assetId, bytes };
  }
  async function guest(deliveryId, options = {}) {
    const share = (
      await api(`/api/admin/deliveries/${deliveryId}/shares`, "POST", {
        name: "Client",
        ...options,
      })
    ).data;
    const access = await api(
      `/api/client/${share.id}/access`,
      "POST",
      {
        token: new URL(share.url).hash.slice(1),
        code: options.code,
        name: "Camille",
      },
      { client: true },
    );
    const cookie = access.response.headers.get("set-cookie").split(";")[0];
    return {
      share,
      cookie,
      call: (suffix, method, value, opts = {}) =>
        api(`/api/client/${share.id}/${suffix}`, method, value, {
          client: true,
          cookie,
          ...opts,
        }),
    };
  }
  return { ...service, api, delivery, version, guest, base, jpeg, root, token };
}

test("photo review, resumable upload, private comments, selection, approval and immutable versions", async (t) => {
  const f = await fixture(t),
    d = await f.delivery(),
    v1 = await f.version(d.id),
    g = await f.guest(d.id, { code: "Juno2026" });
  const submit = {
    opId: uid(),
    revisionId: v1.revision.id,
    comments: [
      {
        assetId: v1.assetId,
        anchor: { point: { x: 0.25, y: 0.5 } },
        body: "Un peu plus lumineux",
      },
    ],
    selection: [v1.assetId],
    selectionRevision: 0,
  };
  const a = (await g.call("submit", "POST", submit)).data;
  assert.deepEqual((await g.call("submit", "POST", submit)).data, a);
  await g.call("submit", "POST", { ...submit, comments: [] }, { status: 409 });
  const thread = a.threadIds[0];
  await f.api(`/api/admin/threads/${thread}/reply`, "POST", {
    opId: uid(),
    internal: true,
    body: "NOTE STRICTEMENT INTERNE",
  });
  await f.api(`/api/admin/threads/${thread}/reply`, "POST", {
    opId: uid(),
    body: "Nous préparons la correction.",
  });
  const external = JSON.stringify(
    (await g.call("threads?revision=" + v1.revision.id)).data,
  );
  assert.ok(!external.includes("STRICTEMENT"));
  assert.ok(external.includes("Nous préparons"));
  await g.call("approve", "POST", {
    opId: uid(),
    revisionId: v1.revision.id,
    decision: "approved",
  });
  assert.equal((await g.call("manifest")).data.decision.state, "approved");
  await f.guest(d.id, { name: "Deuxième destinataire", required: true });
  assert.equal(
    (await g.call("manifest")).data.decision.state,
    "approved",
    "Adding a future approver must not invalidate a signed version",
  );
  const v2 = await f.version(d.id);
  assert.equal((await g.call("manifest")).data.decision.state, "review");
  assert.equal(
    (await g.call("manifest?revision=" + v1.revision.id)).data.decision.state,
    "approved",
  );
  await g.call(
    "approve",
    "POST",
    { opId: uid(), revisionId: v1.revision.id, decision: "approved" },
    { status: 409 },
  );
  await f.api(
    `/api/admin/revisions/${v1.revision.id}/assets`,
    "POST",
    {},
    { status: 409 },
  );
  assert.equal(
    (await g.call("threads?revision=" + v2.revision.id)).data.items.length,
    0,
  );
  await g.call(`assets/${v1.assetId}/file?download=1`, "GET", undefined, {
    status: 403,
  });
  const ranged = await g.call(`assets/${v1.assetId}/file`, "GET", undefined, {
    headers: { Range: "bytes=0-3" },
    status: 206,
  });
  assert.deepEqual(ranged.data, v1.bytes.subarray(0, 4));
  await f.api(`/api/admin/shares/${g.share.id}`, "PATCH", { revoked: true });
  await g.call(`assets/${v1.assetId}/file`, "GET", undefined, { status: 404 });
});

test("cross-project access, viewer permissions, invalid anchors and code protection", async (t) => {
  const f = await fixture(t),
    a = await f.delivery(),
    b = await f.delivery(),
    va = await f.version(a.id, { kind: "video" }),
    vb = await f.version(b.id),
    g = await f.guest(a.id, { code: "secret", canApprove: false });
  await g.call(`assets/${vb.assetId}/file`, "GET", undefined, { status: 404 });
  await g.call("manifest?revision=" + vb.revision.id, "GET", undefined, {
    status: 404,
  });
  await g.call(
    "approve",
    "POST",
    { opId: uid(), revisionId: va.revision.id, decision: "approved" },
    { status: 403 },
  );
  await g.call(
    "submit",
    "POST",
    {
      opId: uid(),
      revisionId: va.revision.id,
      comments: [
        { assetId: va.assetId, body: "Passage", anchor: { frame: 100 } },
      ],
    },
    { status: 400 },
  );
  await g.call("submit", "POST", {
    opId: uid(),
    revisionId: va.revision.id,
    comments: [
      {
        assetId: va.assetId,
        body: "Passage",
        anchor: { frame: 24, endFrame: 50 },
      },
    ],
  });
  const thread = (await g.call("threads?revision=" + va.revision.id)).data
    .items[0];
  assert.equal(thread.anchor.pts, 0.96);
  assert.equal(thread.anchor.endFrame, 50);
  await f.api(
    `/api/client/${g.share.id}/access`,
    "POST",
    { token: new URL(g.share.url).hash.slice(1), code: "wrong" },
    { client: true, status: 403 },
  );
  await f.api("/api/admin/status", "GET", undefined, {
    token: "wrong",
    status: 401,
  });
  const editor = (
    await f.api("/api/admin/operators", "POST", { name: "Autre photographe" })
  ).data;
  await f.api("/api/admin/deliveries/" + a.id, "GET", undefined, {
    token: editor.token,
    status: 404,
  });
  await f.api("/api/admin/deliveries/" + a.id + "/members", "POST", {
    operatorId: editor.id,
  });
  await f.api("/api/admin/deliveries/" + a.id, "GET", undefined, {
    token: editor.token,
  });
});

test("partial publication, selection conflict, stale publishing and concurrent budget reservations", async (t) => {
  const f = await fixture(t),
    projectId = uid(),
    d = await f.delivery(projectId),
    a = await f.version(d.id, { publish: false }),
    b = await f.version(d.id, { publish: false });
  const partial = (
    await f.api(`/api/admin/deliveries/${d.id}/revisions`, "POST", {
      opId: uid(),
      count: 2,
    })
  ).data;
  await f.api(
    `/api/admin/revisions/${partial.id}/publish`,
    "POST",
    { opId: uid() },
    { status: 409 },
  );
  await f.api(`/api/admin/revisions/${a.revision.id}/publish`, "POST", {
    opId: uid(),
  });
  await f.api(
    `/api/admin/revisions/${b.revision.id}/publish`,
    "POST",
    { opId: uid() },
    { status: 409 },
  );
  const g = await f.guest(d.id);
  await g.call("submit", "POST", {
    opId: uid(),
    revisionId: a.revision.id,
    comments: [],
    selection: [a.assetId],
    selectionRevision: 0,
  });
  await g.call(
    "submit",
    "POST",
    {
      opId: uid(),
      revisionId: a.revision.id,
      comments: [{ body: "Ce commentaire doit être annulé avec le conflit" }],
      selection: [],
      selectionRevision: 0,
    },
    { status: 409 },
  );
  assert.equal(
    (await g.call("threads?revision=" + a.revision.id)).data.items.length,
    0,
  );
  const ids = Array.from({ length: 8 }, uid);
  const reservations = await Promise.all(
    ids.map((id) =>
      fetch(f.base + "/api/admin/budget/" + projectId + "/reserve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + f.token,
        },
        body: JSON.stringify({ id, maxCents: 100 }),
      }),
    ),
  );
  assert.equal(
    reservations.filter((r) => r.status === 200 || r.status === 201).length,
    5,
  );
  assert.equal(reservations.filter((r) => r.status === 402).length, 3);
  const accepted = ids.filter((_, i) => reservations[i].ok),
    rejected = ids.filter((_, i) => !reservations[i].ok);
  await f.api(
    `/api/admin/budget/${projectId}/reserve`,
    "POST",
    { id: rejected[0], maxCents: 1 },
    { status: 402 },
  );
  await f.api(`/api/admin/budget/${projectId}/settle`, "POST", {
    id: accepted[0],
    actualCents: 60,
  });
  const ledger = (await f.api("/api/admin/budget/" + projectId)).data;
  assert.equal(ledger.spent_cents, 60);
  assert.equal(ledger.reserved_cents, 400);
  await f.api(`/api/admin/budget/${projectId}/reserve`, "POST", {
    id: rejected[1],
    maxCents: 40,
  });
  await f.api(
    `/api/admin/budget/${projectId}/reserve`,
    "POST",
    { id: rejected[2], maxCents: 1 },
    { status: 402 },
  );
});

test(
  "5,000-media catalogue and 50 concurrent reviewers keep isolated selections and bounded pages",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t),
      d = await f.delivery();
    const revision = (
      await f.api(`/api/admin/deliveries/${d.id}/revisions`, "POST", {
        opId: uid(),
        count: 5000,
      })
    ).data;
    const ids = Array.from({ length: 5000 }, uid);
    // Catalogue scale uses synthetic metadata; real JPEG decoding and publication are covered by native/UI tests.
    f.store.transaction(() => {
      for (let i = 0; i < ids.length; i++)
        f.store.run(
          "INSERT INTO assets(id,revision_id,logical_id,kind,name,mime,size,sha256,metadata,position,state,received,thumbnail_size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            ids[i],
            revision.id,
            "photo_" + i,
            "photo",
            `Photo ${i}.jpg`,
            "image/jpeg",
            10,
            sha(f.jpeg),
            JSON.stringify({ width: 600, height: 900 }),
            i,
            "ready",
            10,
            10,
          ],
        );
    });
    await f.api(`/api/admin/revisions/${revision.id}/publish`, "POST", {
      opId: uid(),
    });
    const guests = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        f.guest(d.id, { name: "Client " + i, required: i === 0 }),
      ),
    );
    const start = performance.now();
    await Promise.all(
      guests.map((g, i) =>
        g.call("submit", "POST", {
          opId: uid(),
          revisionId: revision.id,
          comments: [
            {
              assetId: ids[i],
              body: "Retour " + i,
              anchor: { point: { x: 0.5, y: 0.5 } },
            },
          ],
          selection: [ids[i]],
          selectionRevision: 0,
        }),
      ),
    );
    const manifests = await Promise.all(guests.map((g) => g.call("manifest")));
    manifests.forEach((m, i) => assert.deepEqual(m.data.selection, [ids[i]]));
    const page = (
      await guests[0].call(
        "assets?revision=" + revision.id + "&cursor=4980&limit=60",
      )
    ).data;
    assert.equal(page.total, 5000);
    assert.equal(page.items.length, 20);
    assert.equal(page.items[0].name, "Photo 4980.jpg");
    const selected = await guests[0].call("submit", "POST", {
      opId: uid(),
      revisionId: revision.id,
      comments: [],
      selection: ids,
      selectionRevision: 1,
    });
    assert.equal(selected.data.selectionRevision, 2);
    assert.equal(
      (await guests[0].call("manifest")).data.selection.length,
      5000,
    );
    assert.equal(
      (await f.api(`/api/admin/revisions/${revision.id}/threads?limit=100`))
        .data.items.length,
      50,
    );
    t.diagnostic(
      JSON.stringify({
        syntheticAssets: 5000,
        concurrentReviewers: 50,
        roundTripMs: Math.round(performance.now() - start),
      }),
    );
  },
);

test("cancelled drafts cannot publish and do not exhaust the five-draft allowance", async (t) => {
  const f = await fixture(t),
    d = await f.delivery();
  for (let i = 0; i < 7; i++) {
    const v = await f.version(d.id, { publish: false });
    await f.api(`/api/admin/revisions/${v.revision.id}/abandon`, "POST", {});
    await f.api(
      `/api/admin/revisions/${v.revision.id}/publish`,
      "POST",
      { opId: uid() },
      { status: 409 },
    );
  }
  const v = await f.version(d.id);
  await f.api(
    `/api/admin/revisions/${v.revision.id}/abandon`,
    "POST",
    {},
    { status: 409 },
  );
});

test("exclusive service ownership and verified backup/restore preserve published feedback", async (t) => {
  const { backupReview, restoreReview } = await import(
    "../server/review/backup.mjs"
  );
  const f = await fixture(t),
    d = await f.delivery(),
    v = await f.version(d.id),
    g = await f.guest(d.id);
  await g.call("submit", "POST", {
    opId: uid(),
    revisionId: v.revision.id,
    comments: [{ body: "À conserver dans la sauvegarde" }],
  });
  await assert.rejects(
    createReviewServer({ dataDir: f.root, bootstrapToken: f.token }),
    /déjà ouvert/,
  );
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "juno-review-backup-"),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  await assert.rejects(
    backupReview(f.root, path.join(parent, "blocked")),
    /déjà ouvert/,
  );
  await f.close();
  const result = await backupReview(f.root, path.join(parent, "backup"));
  assert(result.files >= 3);
  await restoreReview(
    path.join(parent, "backup"),
    path.join(parent, "restored"),
  );
  const service = await createReviewServer({
    dataDir: path.join(parent, "restored"),
    bootstrapToken: f.token,
  });
  try {
    assert.equal(
      service.store.get("SELECT body FROM comments").body,
      "À conserver dans la sauvegarde",
    );
    assert.equal(
      service.store.get("SELECT state FROM revisions").state,
      "published",
    );
  } finally {
    await service.close();
  }
  await fs.appendFile(
    path.join(parent, "backup", "media", v.assetId + ".media"),
    "corrupted",
  );
  await assert.rejects(
    restoreReview(path.join(parent, "backup"), path.join(parent, "bad")),
    /altérée/,
  );
});

// Corrections de l'audit du catalogue (29/09/2026).
/** Des requêtes en rafale, comme un anonyme qui invente des liens. */
async function rafale(base, n, requete) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64 }),
    { port } = new URL(base),
    codes = {};
  const envoyer = (i) =>
    new Promise((resolve, reject) => {
      const { chemin, entetes = {}, methode = "POST" } = requete(i);
      const q = http.request(
        {
          host: "127.0.0.1",
          port,
          path: chemin,
          method: methode,
          agent,
          headers: {
            "X-Juno-Client": "1",
            "Content-Type": "application/json",
            ...entetes,
          },
        },
        (r) => {
          r.resume();
          r.on("end", () => resolve((codes[r.statusCode] = (codes[r.statusCode] || 0) + 1)));
        },
      );
      q.on("error", reject);
      q.end(methode === "GET" ? undefined : "{}");
    });
  try {
    for (let i = 0; i < n; i += 500)
      await Promise.all(
        Array.from({ length: Math.min(500, n - i) }, (_, k) => envoyer(i + k)),
      );
  } finally {
    agent.destroy();
  }
  return codes;
}

test("12 001 liens inventés ne ferment plus le portail aux clients ni au photographe", async (t) => {
  const f = await fixture(t, { trustProxy: true }),
    d = await f.delivery(),
    v = await f.version(d.id),
    g = await f.guest(d.id);
  // Derrière le proxy TLS, chaque requête arrive de 127.0.0.1 avec l'adresse
  // réelle en dernier dans X-Forwarded-For.
  const codes = await rafale(f.base, 12001, () => ({
    chemin: "/api/client/" + uid() + "/access",
    entetes: { "X-Forwarded-For": "203.0.113.9" },
  }));
  assert.equal(codes[404] + (codes[429] || 0), 12001);
  assert.equal((await g.call("manifest")).response.status, 200);
  await g.call(`assets/${v.assetId}/thumbnail`);
  await f.api("/api/admin/status");
  // L'adresse qui a inondé le portail, elle, reste freinée.
  await f.api("/api/admin/status", "GET", null, {
    headers: { "X-Forwarded-For": "203.0.113.9" },
    status: 429,
  });
});

test("une table des limites pleine évince ses plus anciennes entrées au lieu de tout refuser", async (t) => {
  const f = await fixture(t, { maxRateEntries: 60, trustProxy: true }),
    d = await f.delivery();
  await f.version(d.id);
  const g = await f.guest(d.id);
  const codes = await rafale(f.base, 400, (i) => ({
    chemin: "/api/client/" + g.share.id + "/manifest",
    methode: "GET",
    // 400 adresses différentes : 400 entrées pour une table de 60.
    entetes: { "X-Forwarded-For": "10.0." + (i >> 8) + "." + (i & 255) },
  }));
  assert.equal(codes[401], 400);
  assert.equal((await g.call("manifest")).response.status, 200);
  await f.api("/api/admin/status");
});

test("les essais d'une adresse ne bloquent pas l'accès d'une autre derrière le proxy", async (t) => {
  const f = await fixture(t, { trustProxy: true }),
    d = await f.delivery(),
    share = (
      await f.api(`/api/admin/deliveries/${d.id}/shares`, "POST", {
        name: "Mariés",
        code: "Juno2026",
      })
    ).data;
  const essai = (code, adresse, status) =>
    f.api(
      `/api/client/${share.id}/access`,
      "POST",
      { token: new URL(share.url).hash.slice(1), code, name: "Léa" },
      { client: true, headers: { "X-Forwarded-For": adresse }, status },
    );
  for (let i = 0; i < 20; i++) await essai("mauvais", "203.0.113.9", 403);
  await essai("mauvais", "203.0.113.9", 429);
  await essai("Juno2026", "203.0.113.9", 429);
  await essai("Juno2026", "198.51.100.7", 200);
});

test("le remplaçant d'un lien « doit valider » révoqué est attendu à son tour", async (t) => {
  // Révoquer le lien des mariés (transféré par erreur) puis leur en donner un
  // nouveau faisait passer la version « Validée » sur la seule validation de
  // Maman (relecture du 29/09/2026).
  const f = await fixture(t),
    d = await f.delivery(),
    maries = await f.guest(d.id, { name: "Mariés" }),
    maman = await f.guest(d.id, { name: "Maman" });
  const v = await f.version(d.id);
  const decision = async () =>
    (await f.api(`/api/admin/deliveries/${d.id}`)).data.decision;
  await maman.call("approve", "POST", { opId: uid(), revisionId: v.revision.id, decision: "approved" });
  assert.deepEqual([(await decision()).state, (await decision()).approved, (await decision()).required], ["review", 1, 2]);
  await f.api(`/api/admin/shares/${maries.share.id}`, "PATCH", { revoked: true });
  const nouveau = await f.guest(d.id, { name: "Mariés, nouveau lien" });
  assert.deepEqual([(await decision()).state, (await decision()).approved, (await decision()).required], ["review", 1, 2]);
  await nouveau.call("approve", "POST", { opId: uid(), revisionId: v.revision.id, decision: "approved" });
  assert.equal((await decision()).state, "approved");
  // Un lien ajouté après la validation ne la défait pas : il attendra la version suivante.
  await f.guest(d.id, { name: "Témoin" });
  assert.equal((await decision()).state, "approved");
});

test("sans proxy déclaré, un X-Forwarded-For forgé ne contourne pas le frein des codes", async (t) => {
  // Un proxy qui transmet l'en-tête du client tel quel lui laisserait choisir
  // son adresse : 10 000 codes essayés en 90 s (relecture du 29/09/2026).
  const f = await fixture(t),
    d = await f.delivery(),
    share = (
      await f.api(`/api/admin/deliveries/${d.id}/shares`, "POST", {
        name: "Mariés",
        code: "4821",
      })
    ).data;
  const essai = (code, adresse, status) =>
    f.api(
      `/api/client/${share.id}/access`,
      "POST",
      { token: new URL(share.url).hash.slice(1), code, name: "Léa" },
      { client: true, headers: { "X-Forwarded-For": adresse }, status },
    );
  for (let i = 0; i < 20; i++) await essai("0000", "203.0.113." + i, 403);
  await essai("0000", "198.51.100." + 1, 429);
});

test("un lien « doit valider » révoqué ou rendu facultatif ne bloque plus la version", async (t) => {
  const f = await fixture(t),
    d = await f.delivery(),
    maries = await f.guest(d.id, { name: "Mariés" });
  await f.version(d.id);
  const maman = (
    await f.api(`/api/admin/deliveries/${d.id}/shares`, "POST", {
      name: "Maman",
    })
  ).data;
  const v2 = await f.version(d.id);
  const decision = async () =>
    (await f.api(`/api/admin/deliveries/${d.id}`)).data.decision;
  assert.deepEqual(
    [(await decision()).state, (await decision()).required],
    ["review", 2],
  );
  await f.api(`/api/admin/shares/${maman.id}`, "PATCH", { revoked: true });
  const validation = await maries.call("approve", "POST", {
    opId: uid(),
    revisionId: v2.revision.id,
    decision: "approved",
  });
  assert.deepEqual(
    [
      validation.data.decision.state,
      validation.data.decision.approved,
      validation.data.decision.required,
    ],
    ["approved", 1, 1],
  );
  // Même issue quand le lien reste ouvert mais devient facultatif.
  const tante = (
    await f.api(`/api/admin/deliveries/${d.id}/shares`, "POST", {
      name: "Tante",
    })
  ).data;
  const v3 = await f.version(d.id);
  await maries.call("approve", "POST", {
    opId: uid(),
    revisionId: v3.revision.id,
    decision: "approved",
  });
  assert.equal((await decision()).state, "review");
  await f.api(`/api/admin/shares/${tante.id}`, "PATCH", { required: false });
  assert.deepEqual(
    [(await decision()).state, (await decision()).required],
    ["approved", 1],
  );
});
