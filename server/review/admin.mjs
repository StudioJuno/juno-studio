import fs from "node:fs/promises";
import path from "node:path";
const [url, keyFile, command, ...args] = process.argv.slice(2);
if (!url || !keyFile || !command)
  throw Error(
    "Usage : node admin.mjs URL FICHIER_CLE list | create NOM NOUVEAU_FICHIER_CLE | grant LIVRAISON_ID OPERATEUR_ID | disable OPERATEUR_ID",
  );
const target = new URL(url);
if (
  target.username ||
  target.password ||
  target.pathname !== "/" ||
  target.search ||
  target.hash ||
  !(
    target.protocol === "https:" ||
    (target.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(target.hostname))
  )
)
  throw Error("Adresse de portail invalide.");
const content = await fs.readFile(keyFile, "utf8");
let token;
try {
  token = JSON.parse(content).token;
} catch {
  token =
    content.match(/^JUNO_REVIEW_BOOTSTRAP_TOKEN=([A-Za-z0-9_-]+)$/m)?.[1] ||
    content.trim();
}
if (!/^[A-Za-z0-9_-]{43,100}$/.test(token || ""))
  throw Error("Fichier de clé invalide.");
const request = async (route, method = "GET", body) => {
  const response = await fetch(target.origin + "/api/admin/" + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Action impossible");
  return data;
};
const id = (value) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value || ""))
    throw Error("Identifiant invalide.");
  return value;
};
if (command === "list")
  console.log(JSON.stringify(await request("operators"), null, 2));
else if (command === "create") {
  const [name, destination] = args;
  if (!name || !destination)
    throw Error("Nom et nouveau fichier de clé requis.");
  // Reserve the destination before creating an account; never overwrite a key.
  const file = await fs.open(path.resolve(destination), "wx", 0o600);
  try {
    const operator = await request("operators", "POST", { name });
    await file.writeFile(
      JSON.stringify({ url: target.origin, name, ...operator }, null, 2),
    );
    await file.sync();
    console.log(
      "Accès créé : " + operator.id + ". La clé reste dans le fichier protégé.",
    );
  } finally {
    await file.close();
  }
} else if (command === "grant") {
  await request("deliveries/" + id(args[0]) + "/members", "POST", {
    operatorId: id(args[1]),
  });
  console.log("Accès au projet accordé.");
} else if (command === "disable") {
  await request("operators/" + id(args[0]), "PATCH", { disabled: true });
  console.log("Accès désactivé.");
} else throw Error("Commande inconnue.");
