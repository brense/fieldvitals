import { libsqlStore } from "@brows/fieldvitals/store/libsql";
import { createClient } from "@libsql/client";

/** A file next to the app. A real site hands over the client it already has */
const client = createClient({ url: process.env.DATABASE_URL ?? "file:./vitals.db" });

export const store = libsqlStore(client);
