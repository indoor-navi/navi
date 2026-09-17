import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();

  if (!apiKey || !voiceId) {
    return NextResponse.json({ error: 'Malawian voice is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  if (!body || typeof body.text !== 'string' || !body.text.trim()) {
    return NextResponse.json({ error: 'Text is required' }, { status: 400 });
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: body.text.trim(),
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.8,
        style: 0.35,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'Voice provider request failed' }, { status: response.status });
  }

  return new Response(response.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
  });
}
