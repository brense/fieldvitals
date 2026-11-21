import { createHandler } from "@brows/fieldvitals/server";
import { store } from "../../../lib/store";

export const POST = createHandler({
  store,
  onError: (error) => console.error("[vitals] could not store a report", error),
});
