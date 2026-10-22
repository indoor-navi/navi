import Nav3DExperience from '@/components/Nav3DExperience';

export default async function DirectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string }>;
}) {
  const params = await searchParams;
  return <Nav3DExperience initialDestination={params.destination || ''} />;
}