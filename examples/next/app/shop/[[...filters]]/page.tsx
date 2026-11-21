import { Suspense } from "react";

async function Shop({ params }: { params: Promise<{ filters?: string[] }> }) {
  const { filters } = await params;
  return <h1>Shop {filters?.join(" / ") ?? "everything"}</h1>;
}

export default function Page({ params }: { params: Promise<{ filters?: string[] }> }) {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Shop params={params} />
    </Suspense>
  );
}
