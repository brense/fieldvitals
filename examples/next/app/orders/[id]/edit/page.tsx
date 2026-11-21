import { Suspense } from "react";

async function Order({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <h1>Order {id}</h1>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Order params={params} />
    </Suspense>
  );
}
