import DirectionsExperience from '@/components/DirectionsExperience';

export default async function DirectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string }>;
}) {
  const params = await searchParams;

  return <DirectionsExperience initialDestination={params.destination || ''} />;
}