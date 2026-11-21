import { Suspense } from "react";

async function Doc({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return <h1>Docs {slug.join(" / ")}</h1>;
}

export default function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Doc params={params} />
    </Suspense>
  );
}
