export function generateStaticParams() {
  return [{ slug: "hello" }];
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <h1>Blog {slug}</h1>;
}
