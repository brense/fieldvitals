import { Suspense } from "react";

type Params = Promise<{ team: string; member: string }>;

async function Member({ params }: { params: Params }) {
  const { team, member } = await params;
  return (
    <h1>
      {member} in {team}
    </h1>
  );
}

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Member params={params} />
    </Suspense>
  );
}
